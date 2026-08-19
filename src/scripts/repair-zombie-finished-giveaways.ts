/**
 * Repair giveaways stuck after a failed auto-finish transaction.
 *
 * ZOMBIE-A: isActive=false, finishedAt=null, no winners — often after cron tx timeout.
 * ZOMBIE-B: isActive=false, isPlanned=true, finishedAt set — finished but still "planned".
 *
 * Usage:
 *   npx tsx src/scripts/repair-zombie-finished-giveaways.ts --dry-run
 *   npx tsx src/scripts/repair-zombie-finished-giveaways.ts --type=a
 *   npx tsx src/scripts/repair-zombie-finished-giveaways.ts --type=b
 *   npx tsx src/scripts/repair-zombie-finished-giveaways.ts --id=c20c0f1b-7d56-41cd-9179-da8a2850f00a
 *   npx tsx src/scripts/repair-zombie-finished-giveaways.ts
 */

import { prisma } from '@database';
import { giveawayService } from '@giveaways/services';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const idArg = args.find((a) => a.startsWith('--id='));
const targetId = idArg?.slice('--id='.length);
const typeArg = args.find((a) => a.startsWith('--type='))?.slice('--type='.length);
const repairType = typeArg === 'a' || typeArg === 'b' ? typeArg : 'all';

async function findZombieAGiveaways(giveawayId?: string) {
  return prisma.giveaway.findMany({
    where: {
      ...(giveawayId ? { id: giveawayId } : {}),
      isActive: false,
      isPlanned: false,
      finishedAt: null,
      isCancelled: false,
    },
    select: {
      id: true,
      description: true,
      endingAt: true,
      winnerSlots: true,
      createdById: true,
      _count: { select: { participants: true } },
    },
    orderBy: { endingAt: 'desc' },
  });
}

async function findZombieBGiveaways(giveawayId?: string) {
  return prisma.giveaway.findMany({
    where: {
      ...(giveawayId ? { id: giveawayId } : {}),
      isActive: false,
      isPlanned: true,
      finishedAt: { not: null },
      isCancelled: false,
    },
    select: {
      id: true,
      description: true,
      endingAt: true,
      finishedAt: true,
      createdById: true,
    },
    orderBy: { finishedAt: 'desc' },
  });
}

async function repairZombieA(
  zombies: Awaited<ReturnType<typeof findZombieAGiveaways>>,
) {
  if (zombies.length === 0) {
    console.log('No ZOMBIE-A giveaways found');
    return;
  }

  for (const g of zombies) {
    console.log(
      `[ZOMBIE-A] ${g.id} | winnerslots=${g.winnerSlots} | participants=${g._count.participants} | endingAt=${g.endingAt?.toISOString() ?? 'null'}`,
    );
  }
  console.log('');

  if (isDryRun) {
    console.log(
      `Would repair ${zombies.length} ZOMBIE-A giveaway(s) via autoCompleteGiveaway.`,
    );
    return;
  }

  for (const g of zombies) {
    if (g._count.participants === 0) {
      console.warn(`Skipping ${g.id}: no participants`);
      continue;
    }

    console.log(`Repairing ZOMBIE-A ${g.id}...`);
    try {
      const result = await giveawayService.autoCompleteGiveaway(g.id);
      if (result) {
        const after = await prisma.giveaway.findUnique({
          where: { id: g.id },
          select: {
            finishedAt: true,
            isActive: true,
            _count: {
              select: {
                participants: { where: { isWinner: true } },
              },
            },
          },
        });
        console.log(
          `  OK finishedAt=${after?.finishedAt?.toISOString() ?? 'null'} mainWinners=${after?._count.participants ?? 0}`,
        );
      } else {
        console.log('  Skipped (already finished or cancelled)');
      }
    } catch (error) {
      console.error(`  FAILED ${g.id}:`, error);
    }
  }
}

async function repairZombieB(
  zombies: Awaited<ReturnType<typeof findZombieBGiveaways>>,
) {
  if (zombies.length === 0) {
    console.log('No ZOMBIE-B giveaways found');
    return;
  }

  for (const g of zombies) {
    console.log(
      `[ZOMBIE-B] ${g.id} | finishedAt=${g.finishedAt?.toISOString() ?? 'null'} | endingAt=${g.endingAt?.toISOString() ?? 'null'}`,
    );
  }
  console.log('');

  if (isDryRun) {
    console.log(
      `Would clear isPlanned on ${zombies.length} ZOMBIE-B giveaway(s).`,
    );
    return;
  }

  for (const g of zombies) {
    console.log(`Repairing ZOMBIE-B ${g.id}...`);
    try {
      await prisma.giveaway.update({
        where: { id: g.id },
        data: { isPlanned: false },
      });
      console.log('  OK isPlanned=false');
    } catch (error) {
      console.error(`  FAILED ${g.id}:`, error);
    }
  }
}

async function main() {
  console.log('Repair zombie-finished giveaways\n');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'APPLY'} | type=${repairType}\n`);

  if (repairType === 'all' || repairType === 'a') {
    console.log('--- ZOMBIE-A ---');
    const zombiesA = await findZombieAGiveaways(targetId);
    await repairZombieA(zombiesA);
    console.log('');
  }

  if (repairType === 'all' || repairType === 'b') {
    console.log('--- ZOMBIE-B ---');
    const zombiesB = await findZombieBGiveaways(targetId);
    await repairZombieB(zombiesB);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

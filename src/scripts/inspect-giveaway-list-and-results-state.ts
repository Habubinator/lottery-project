/**
 * Inspect giveaway DB state for list visibility (active/completed/zombie) and results posting (issues 5–6).
 *
 * Usage:
 *   npx tsx src/scripts/inspect-giveaway-list-and-results-state.ts
 *   npx tsx src/scripts/inspect-giveaway-list-and-results-state.ts --id=c108faf4-2b95-4e0a-9a51-ed0e337ecc1b
 *   npx tsx src/scripts/inspect-giveaway-list-and-results-state.ts --id=b560420a-1e84-431f-95e9-fec3b412f9b2
 *
 * Requires DATABASE_URL (same as the API).
 */

import { prisma } from '@database';

const DEFAULT_ID = 'c108faf4-2b95-4e0a-9a51-ed0e337ecc1b';
const idArg = process.argv.find((a) => a.startsWith('--id='));
const giveawayId = idArg?.slice('--id='.length) ?? DEFAULT_ID;

type GiveawayFlags = {
  isActive: boolean;
  isPlanned: boolean;
  isCancelled: boolean;
  finishedAt: Date | null;
};

function classifyUiBuckets(g: GiveawayFlags): string[] {
  const buckets: string[] = [];
  if (g.isCancelled) {
    buckets.push('completed tab (cancelled OR branch)');
  }
  if (g.isActive && !g.isPlanned && !g.isCancelled) {
    buckets.push('active tab (running)');
  }
  if (!g.isActive && g.isPlanned && !g.isCancelled) {
    buckets.push('active tab (planned)');
  }
  if (!g.isActive && !g.isPlanned && !g.isCancelled) {
    buckets.push('completed tab (finished)');
  }
  if (buckets.length === 0) {
    buckets.push('NONE — does not match active or completed filters');
  }
  return buckets;
}

function classifyZombie(g: GiveawayFlags): string | null {
  if (g.isCancelled) return null;
  if (!g.isActive && !g.isPlanned && g.finishedAt === null) {
    return 'ZOMBIE-A: isActive=false, isPlanned=false, finishedAt=null (stuck before finish core)';
  }
  if (!g.isActive && g.isPlanned && g.finishedAt !== null) {
    return 'ZOMBIE-B: isPlanned=true after finish — hidden from completed tab, may show as planned';
  }
  if (g.isActive && g.finishedAt !== null) {
    return 'ZOMBIE-C: isActive=true with finishedAt set';
  }
  if (g.isActive && g.isPlanned) {
    return 'ZOMBIE-D: isActive=true and isPlanned=true';
  }
  return null;
}

function fmtChannel(ch: { id: bigint; title: string | null; username: string | null }) {
  const name = ch.title || ch.username || `id:${ch.id}`;
  const handle = ch.username ? ` (@${ch.username})` : '';
  return `${name}${handle} [${ch.id}]`;
}

async function main() {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      id: true,
      description: true,
      language: true,
      banner: true,
      isActive: true,
      isPlanned: true,
      isCancelled: true,
      finishedAt: true,
      startingAt: true,
      endingAt: true,
      createdAt: true,
      createdById: true,
      isResultsInMainPost: true,
      isCommentsOn: true,
      createdBy: {
        select: {
          id: true,
          telegramId: true,
          username: true,
          first_name: true,
        },
      },
      linkedChannels: {
        include: {
          channel: {
            select: {
              id: true,
              title: true,
              username: true,
              addedBy: {
                select: {
                  userId: true,
                  user: {
                    select: {
                      id: true,
                      telegramId: true,
                      username: true,
                      first_name: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { role: 'asc' },
      },
      messages: {
        select: {
          id: true,
          channelId: true,
          messageId: true,
          winnerMessageId: true,
          channel: { select: { id: true, title: true, username: true } },
        },
      },
      _count: { select: { participants: true } },
    },
  });

  if (!giveaway) {
    console.error(`Giveaway not found: ${giveawayId}`);
    process.exit(1);
  }

  const flags: GiveawayFlags = {
    isActive: giveaway.isActive,
    isPlanned: giveaway.isPlanned,
    isCancelled: giveaway.isCancelled,
    finishedAt: giveaway.finishedAt,
  };

  console.log('═'.repeat(72));
  console.log('GIVEAWAY LIST + RESULTS STATE (issues 5–6, zombie check)');
  console.log('═'.repeat(72));
  console.log(`ID:          ${giveaway.id}`);
  console.log(`Description: ${(giveaway.description || '').slice(0, 80)}…`);
  console.log(`Creator:     user ${giveaway.createdById} (@${giveaway.createdBy?.username ?? '—'} tg:${giveaway.createdBy?.telegramId ?? '—'})`);
  console.log(`Participants: ${giveaway._count.participants}`);
  console.log('');
  console.log(' Flags ');
  console.log(`  isActive:    ${giveaway.isActive}`);
  console.log(`  isPlanned:   ${giveaway.isPlanned}`);
  console.log(`  isCancelled: ${giveaway.isCancelled}`);
  console.log(`  finishedAt:  ${giveaway.finishedAt?.toISOString() ?? 'null'}`);
  console.log(`  startingAt:  ${giveaway.startingAt?.toISOString() ?? 'null'}`);
  console.log(`  endingAt:    ${giveaway.endingAt?.toISOString() ?? 'null'}`);
  console.log('');
  console.log(' UI buckets (getUserCreatedGiveaways filters) ');
  for (const b of classifyUiBuckets(flags)) {
    console.log(`  → ${b}`);
  }
  const zombie = classifyZombie(flags);
  console.log('');
  console.log(' Zombie / inconsistent state ');
  console.log(zombie ? `  ⚠ ${zombie}` : '  OK — no known zombie pattern');
  console.log('');
  console.log(' Global results settings (creator channels) ');
  console.log(`  isResultsInMainPost: ${giveaway.isResultsInMainPost}`);
  console.log(`  isCommentsOn:        ${giveaway.isCommentsOn}`);
  const validBanners = (giveaway.banner || []).filter((b) => b && b.trim() !== '');
  console.log(`  banner count:        ${validBanners.length} (${validBanners.length === 0 ? 'would use standart.mp4 in DMs' : 'custom banner'})`);
  console.log('');
  console.log(' Per-channel (co-owner / sponsor) ');
  for (const lc of giveaway.linkedChannels) {
    const isCreatorChannel = lc.channel.addedBy.some(
      (ab) => ab.userId === giveaway.createdById,
    );
    console.log(`  ${fmtChannel(lc.channel)}`);
    console.log(`    role: ${lc.role} | creator-owned: ${isCreatorChannel}`);
    console.log(`    isPostingResults: ${lc.isPostingResults} (false → manual co-owner publish DM)`);
    console.log(`    isResultsInMainPost: ${lc.isResultsInMainPost ?? '(inherit)'}`);
    console.log(`    isCommentsOn: ${lc.isCommentsOn ?? '(inherit)'}`);
    console.log(
      `    addedBy: ${lc.channel.addedBy.map((ab) => `user ${ab.userId} (@${ab.user?.username ?? '—'} tg:${ab.user?.telegramId ?? '—'})`).join(', ') || '(none)'}`,
    );
    const msg = giveaway.messages.find(
      (m) => m.channelId.toString() === lc.channelId.toString(),
    );
    if (msg) {
      console.log(
        `    posted messageId: ${msg.messageId ?? 'null'} | winnerMessageId: ${msg.winnerMessageId ?? 'null'}`,
      );
    } else {
      console.log('    posted: (no message row)');
    }
    console.log('');
  }

  console.log(' Expected results behaviour at finish ');
  for (const lc of giveaway.linkedChannels) {
    if (lc.role === 'Subscription') continue;
    const isCreatorChannel = lc.channel.addedBy.some(
      (ab) => ab.userId === giveaway.createdById,
    );
    const autoPublish = isCreatorChannel || lc.isPostingResults;
    const effectiveMainPost = isCreatorChannel
      ? giveaway.isResultsInMainPost
      : lc.isResultsInMainPost;
    console.log(
      `  ${lc.channelId}: ${autoPublish ? 'AUTO publish at finish' : 'SKIP auto → co-owner DM'} | mode: ${effectiveMainPost ? 'edit main post' : 'separate reply'}`,
    );
  }
  console.log('');
  console.log('Run repair-zombie-finished-giveaways.ts if ZOMBIE-A is reported.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

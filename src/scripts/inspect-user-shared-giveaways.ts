/**
 * Diagnose why shared giveaways appear (or not) for a claimer's profile.
 *
 * Usage:
 *   npx tsx src/scripts/inspect-user-shared-giveaways.ts 3
 */
import { prisma, SponsorApprovalStatus } from '@database';

async function main() {
  const userId = Number(process.argv[2] || 3);
  if (!Number.isFinite(userId)) {
    throw new Error('Usage: npx tsx src/scripts/inspect-user-shared-giveaways.ts <userId>');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      first_name: true,
      telegramId: true,
    },
  });
  if (!user) {
    console.log(`User ${userId} not found`);
    return;
  }
  console.log(
    `User ${user.id} @${user.username ?? '—'} ${user.first_name ?? ''} tg=${user.telegramId ?? '—'}`,
  );

  const [
    managedLinked,
    postlots,
    approvalsApproved,
    approvalsPending,
    ownCreated,
  ] = await Promise.all([
    prisma.linkedChannels.findMany({
      where: { managedByUserId: userId },
      select: {
        giveawayId: true,
        channelId: true,
        role: true,
        giveaway: {
          select: {
            id: true,
            createdById: true,
            isActive: true,
            isPlanned: true,
            isCancelled: true,
            finishedAt: true,
            startingAt: true,
            participiationType: true,
          },
        },
        channel: { select: { title: true, username: true } },
      },
      orderBy: { giveawayId: 'asc' },
    }),
    prisma.postlotPublication.findMany({
      where: { publishedById: userId },
      select: {
        giveawayId: true,
        channelId: true,
        createdAt: true,
        giveaway: {
          select: {
            id: true,
            createdById: true,
            isActive: true,
            isPlanned: true,
            isCancelled: true,
            finishedAt: true,
            participiationType: true,
          },
        },
      },
    }),
    prisma.sponsorApproval.findMany({
      where: { ownerUserId: userId, status: SponsorApprovalStatus.Approved },
      select: {
        id: true,
        giveawayId: true,
        channelId: true,
        respondedAt: true,
        giveaway: {
          select: {
            id: true,
            createdById: true,
            isActive: true,
            isPlanned: true,
            isCancelled: true,
            finishedAt: true,
          },
        },
      },
    }),
    prisma.sponsorApproval.findMany({
      where: { ownerUserId: userId, status: SponsorApprovalStatus.Pending },
      select: {
        id: true,
        giveawayId: true,
        channelId: true,
        giveaway: {
          select: {
            id: true,
            createdById: true,
            isActive: true,
            isPlanned: true,
            isCancelled: true,
          },
        },
      },
    }),
    prisma.giveaway.count({ where: { createdById: userId } }),
  ]);

  const classify = (g: {
    isActive: boolean;
    isPlanned: boolean;
    isCancelled: boolean;
    createdById: number;
  }) => {
    if (g.createdById === userId) return 'OWN (not shared)';
    const activeBucket =
      !g.isCancelled &&
      ((g.isActive && !g.isPlanned) || (!g.isActive && g.isPlanned));
    const completedBucket =
      (!g.isActive && !g.isPlanned) || g.isCancelled;
    if (activeBucket) return 'ACTIVE_TAB';
    if (completedBucket) return 'COMPLETED_TAB';
    return 'NO_TAB';
  };

  console.log(`\nown createdById count: ${ownCreated}`);
  console.log(`managedByUserId linked rows: ${managedLinked.length}`);
  console.log(`postlot as publisher: ${postlots.length}`);
  console.log(`Approved sponsorApprovals: ${approvalsApproved.length}`);
  console.log(`Pending sponsorApprovals: ${approvalsPending.length}`);

  const sharedIds = new Set<string>();

  console.log('linkedChannels.managedByUserId');
  for (const row of managedLinked) {
    const g = row.giveaway;
    sharedIds.add(g.id);
    console.log(
      `  ${g.id.slice(0, 8)}… type=${g.participiationType} creator=${g.createdById} ` +
        `active=${g.isActive} planned=${g.isPlanned} cancelled=${g.isCancelled} ` +
        `finished=${g.finishedAt?.toISOString() ?? 'null'} ` +
        `ch=${row.channel.username || row.channel.title || row.channelId} ` +
        `→ ${classify(g)}`,
    );
  }

  console.log('postlotPublications.publishedById');
  for (const row of postlots) {
    const g = row.giveaway;
    sharedIds.add(g.id);
    console.log(
      `  ${g.id.slice(0, 8)}… creator=${g.createdById} ` +
        `active=${g.isActive} planned=${g.isPlanned} cancelled=${g.isCancelled} ` +
        `→ ${classify(g)}`,
    );
  }

  console.log('SponsorApproval Approved (safety-net source)');
  for (const row of approvalsApproved) {
    const g = row.giveaway;
    const alsoManaged = managedLinked.some(
      (m) =>
        m.giveawayId === row.giveawayId &&
        m.channelId === row.channelId,
    );
    sharedIds.add(g.id);
    console.log(
      `  ${g.id.slice(0, 8)}… creator=${g.createdById} ` +
        `active=${g.isActive} planned=${g.isPlanned} cancelled=${g.isCancelled} ` +
        `managedRow=${alsoManaged} → ${classify(g)}`,
    );
  }

  console.log('SponsorApproval Pending (should NOT show as Shared yet)');
  for (const row of approvalsPending) {
    const g = row.giveaway;
    console.log(
      `  ${g.id.slice(0, 8)}… creator=${g.createdById} ` +
        `active=${g.isActive} planned=${g.isPlanned} cancelled=${g.isCancelled} → ${classify(g)}`,
    );
  }

  // Simulate API merge (claim sources only, same as getUserCreatedGiveaways)
  const notOwn = [...sharedIds].filter((id) => {
    const g =
      managedLinked.find((m) => m.giveawayId === id)?.giveaway ||
      postlots.find((p) => p.giveawayId === id)?.giveaway ||
      approvalsApproved.find((a) => a.giveawayId === id)?.giveaway;
    return g && g.createdById !== userId;
  });

  let activeShared = 0;
  let completedShared = 0;
  for (const id of notOwn) {
    const g =
      managedLinked.find((m) => m.giveawayId === id)?.giveaway ||
      postlots.find((p) => p.giveawayId === id)?.giveaway ||
      approvalsApproved.find((a) => a.giveawayId === id)?.giveaway;
    if (!g) continue;
    const bucket = classify(g);
    if (bucket === 'ACTIVE_TAB') activeShared++;
    if (bucket === 'COMPLETED_TAB') completedShared++;
  }

  console.log('API simulation (createdById≠user + claim signals)');
  console.log(`  distinct shared giveaways: ${notOwn.length}`);
  console.log(`  would appear in ACTIVE tab: ${activeShared}`);
  console.log(`  would appear in COMPLETED tab: ${completedShared}`);

  // Historical gap: Approved but managedByUserId still null on that channel
  const gaps = approvalsApproved.filter(
    (a) =>
      a.giveaway.createdById !== userId &&
      !managedLinked.some(
        (m) => m.giveawayId === a.giveawayId && m.channelId === a.channelId,
      ),
  );
  console.log(`Approved without managedByUserId on same channel: ${gaps.length}`,
  );
  for (const g of gaps.slice(0, 20)) {
    console.log(
      `  ${g.giveawayId} ch=${g.channelId} → ${classify(g.giveaway)} (still in Approved safety net)`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

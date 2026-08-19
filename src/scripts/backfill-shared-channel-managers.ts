/**
 * Backfill the atomic shared-channel manager from historical Approved
 * SponsorApproval rows. Run once after `prisma db push`.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-shared-channel-managers.ts
 */
import { prisma, SponsorApprovalStatus } from '@database';

async function main() {
  const unclaimed = await prisma.linkedChannels.findMany({
    where: { managedByUserId: null },
    select: { giveawayId: true, channelId: true },
  });

  let claimed = 0;
  for (const linked of unclaimed) {
    const firstApproval = await prisma.sponsorApproval.findFirst({
      where: {
        giveawayId: linked.giveawayId,
        channelId: linked.channelId,
        status: SponsorApprovalStatus.Approved,
      },
      orderBy: [{ respondedAt: 'asc' }, { id: 'asc' }],
      select: { ownerUserId: true },
    });
    if (!firstApproval) continue;

    const result = await prisma.linkedChannels.updateMany({
      where: {
        giveawayId: linked.giveawayId,
        channelId: linked.channelId,
        managedByUserId: null,
      },
      data: { managedByUserId: firstApproval.ownerUserId },
    });
    claimed += result.count;

    if (result.count > 0) {
      await prisma.sponsorApproval.updateMany({
        where: {
          giveawayId: linked.giveawayId,
          channelId: linked.channelId,
          ownerUserId: { not: firstApproval.ownerUserId },
          status: {
            in: [SponsorApprovalStatus.Pending, SponsorApprovalStatus.Approved],
          },
        },
        data: {
          status: SponsorApprovalStatus.Rejected,
          respondedAt: new Date(),
        },
      });
    }
  }

  console.log(
    `[BackfillSharedManagers] scanned=${unclaimed.length} claimed=${claimed}`,
  );
}

main()
  .catch((error) => {
    console.error('[BackfillSharedManagers] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

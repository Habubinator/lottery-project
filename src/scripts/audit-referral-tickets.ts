/**
 * Audit referral → additional ticket accounting for a giveaway.
 *
 * Usage:
 *   npx tsx src/scripts/audit-referral-tickets.ts <giveawayId>
 *   npx tsx src/scripts/audit-referral-tickets.ts 1885b81b-ed18-4fb5-a64a-3dfc813ba150
 *
 * Checks whether earned ref tickets match qualifying referrals under
 * countRefsOnParticipation (join required) vs link-click mode.
 */

import { prisma, Prisma } from '@database';

type GiveawayAuditConfig = {
  id: string;
  description: string | null;
  participiationType: string;
  canEarnAdditionalTickets: boolean;
  countRefsOnParticipation: boolean;
  refsPerTicket: number;
  maxAdditionalTickets: number;
  neededReferals: number;
  isActive: boolean;
  isPlanned: boolean;
  startingAt: Date;
  endingAt: Date | null;
};

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `);
  return rows[0]?.exists ?? false;
}

async function loadGiveawayConfig(giveawayId: string): Promise<GiveawayAuditConfig | null> {
  const hasCountRefsOnParticipation = await columnExists(
    'giveaways',
    'count_refs_on_participation',
  );

  const countRefsSelect = hasCountRefsOnParticipation
    ? Prisma.sql`g.count_refs_on_participation`
    : Prisma.sql`false`;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      description: string | null;
      participiationType: string;
      canEarnAdditionalTickets: boolean;
      countRefsOnParticipation: boolean;
      refsPerTicket: number;
      maxAdditionalTickets: number;
      neededReferals: number;
      isActive: boolean;
      isPlanned: boolean;
      startingAt: Date;
      endingAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      g.giveaway_id::text AS id,
      g.giveaway_desc AS description,
      g.giveaway_start_type::text AS "participiationType",
      g.can_earn_additional_tickets AS "canEarnAdditionalTickets",
      ${countRefsSelect} AS "countRefsOnParticipation",
      g.refs_per_ticket AS "refsPerTicket",
      g.max_additional_tickets AS "maxAdditionalTickets",
      g.needed_referals AS "neededReferals",
      g.is_active AS "isActive",
      g.is_planned AS "isPlanned",
      g.starting_at AS "startingAt",
      g.ending_at AS "endingAt"
    FROM giveaways g
    WHERE g.giveaway_id = ${giveawayId}::uuid
    LIMIT 1
  `);

  if (!hasCountRefsOnParticipation && rows[0]) {
    console.warn(
      '⚠ DB has no count_refs_on_participation column — treating as false (link-click mode).',
    );
  }

  return rows[0] ?? null;
}

function expectedTicketsFromRefs(
  qualifyingCount: number,
  refsPerTicket: number,
  maxAdditionalTickets: number,
  earnedFromBoosts: number,
): number {
  if (refsPerTicket <= 0) return 0;
  let earned = Math.floor(qualifyingCount / refsPerTicket);
  if (maxAdditionalTickets > 0) {
    earned = Math.min(earned, Math.max(0, maxAdditionalTickets - earnedFromBoosts));
  }
  return earned;
}

async function main() {
  const giveawayId = process.argv[2];
  if (!giveawayId) {
    console.error('Usage: npx tsx src/scripts/audit-referral-tickets.ts <giveawayId>');
    process.exit(1);
  }

  const giveaway = await loadGiveawayConfig(giveawayId);

  if (!giveaway) {
    console.error(`Giveaway not found: ${giveawayId}`);
    process.exit(1);
  }

  const [
    referrals,
    earnedRecords,
    participantRows,
    distinctParticipants,
  ] = await Promise.all([
    prisma.giveawayReferral.findMany({
      where: { giveawayId },
      select: {
        id: true,
        referrerId: true,
        referredId: true,
        hasParticipated: true,
        createdAt: true,
        referrer: { select: { id: true, username: true, first_name: true } },
        referred: { select: { id: true, username: true, first_name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.giveawayEarnedTickets.findMany({
      where: { giveawayId },
      include: {
        user: { select: { id: true, username: true, first_name: true } },
      },
    }),
    prisma.participant.groupBy({
      by: ['userId'],
      where: { giveawayId },
      _count: { _all: true },
    }),
    prisma.participant.findMany({
      where: { giveawayId },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);

  const referredIds = new Set(referrals.map((r) => r.referredId));
  const joinedReferredIds = new Set(distinctParticipants.map((p) => p.userId));

  const refsWithoutJoin = referrals.filter((r) => !joinedReferredIds.has(r.referredId));
  const refsWithJoinButNotFlagged = referrals.filter(
    (r) => joinedReferredIds.has(r.referredId) && !r.hasParticipated,
  );

  const participantCountByUser = new Map(
    participantRows.map((row) => [row.userId, row._count._all]),
  );

  let totalEarnedFromRefs = 0;
  let totalEarnedFromBoosts = 0;
  let overpaidReferrers = 0;

  type ReferrerAudit = {
    userId: number;
    label: string;
    totalRefs: number;
    participatedRefs: number;
    expectedIfJoinRequired: number;
    expectedIfLinkClick: number;
    earnedFromRefs: number;
    earnedFromBoosts: number;
    participantRows: number;
    surplusJoinMode: number;
    surplusLinkMode: number;
  };

  const referrerIds = [...new Set(referrals.map((r) => r.referrerId))];
  const referrerAudits: ReferrerAudit[] = [];

  for (const referrerId of referrerIds) {
    const userRefs = referrals.filter((r) => r.referrerId === referrerId);
    const participated = userRefs.filter((r) => r.hasParticipated).length;
    const record = earnedRecords.find((e) => e.userId === referrerId);
    const earnedFromRefs = record?.earnedFromRefs ?? 0;
    const earnedFromBoosts = record?.earnedFromBoosts ?? 0;
    totalEarnedFromRefs += earnedFromRefs;
    totalEarnedFromBoosts += earnedFromBoosts;

    const expectedJoin = expectedTicketsFromRefs(
      participated,
      giveaway.refsPerTicket,
      giveaway.maxAdditionalTickets,
      earnedFromBoosts,
    );
    const expectedLink = expectedTicketsFromRefs(
      userRefs.length,
      giveaway.refsPerTicket,
      giveaway.maxAdditionalTickets,
      earnedFromBoosts,
    );

    const surplusJoin = earnedFromRefs - expectedJoin;
    const surplusLink = earnedFromRefs - expectedLink;
    if (giveaway.countRefsOnParticipation ? surplusJoin > 0 : surplusLink > 0) {
      overpaidReferrers++;
    }

    const refUser = userRefs[0]?.referrer;
    referrerAudits.push({
      userId: referrerId,
      label: refUser?.username ?? refUser?.first_name ?? String(referrerId),
      totalRefs: userRefs.length,
      participatedRefs: participated,
      expectedIfJoinRequired: expectedJoin,
      expectedIfLinkClick: expectedLink,
      earnedFromRefs,
      earnedFromBoosts,
      participantRows: participantCountByUser.get(referrerId) ?? 0,
      surplusJoinMode: surplusJoin,
      surplusLinkMode: surplusLink,
    });
  }

  referrerAudits.sort((a, b) => b.earnedFromRefs - a.earnedFromRefs);

  const totalParticipantRows = participantRows.reduce((s, r) => s + r._count._all, 0);
  const qualifyingCount = giveaway.countRefsOnParticipation
    ? referrals.filter((r) => r.hasParticipated).length
    : referrals.length;

  console.log('\n=== Giveaway ===');
  console.log(JSON.stringify(giveaway, null, 2));

  console.log('\n=== Referral / ticket config ===');
  console.log(
    `countRefsOnParticipation=${giveaway.countRefsOnParticipation} ` +
      `(true = ticket only after referred user joins; false = on referral link)`,
  );
  console.log(`refsPerTicket=${giveaway.refsPerTicket}, maxAdditionalTickets=${giveaway.maxAdditionalTickets}`);
  console.log(
    `neededReferals=${giveaway.neededReferals} (premium join gate — always counts link, not join)`,
  );

  console.log('\n=== Totals ===');
  console.log(`Referral rows (link clicks): ${referrals.length}`);
  console.log(`Referrals with hasParticipated=true: ${referrals.filter((r) => r.hasParticipated).length}`);
  console.log(`Referred users who actually joined (participant row): ${referrals.filter((r) => joinedReferredIds.has(r.referredId)).length}`);
  console.log(`Referrals where referred never joined: ${refsWithoutJoin.length}`);
  console.log(`Joined but hasParticipated=false (data bug): ${refsWithJoinButNotFlagged.length}`);
  console.log(`Distinct participant users: ${distinctParticipants.length}`);
  console.log(`Total participant rows (includes extra ref/boost tickets): ${totalParticipantRows}`);
  console.log(`Sum earnedFromRefs (all referrers): ${totalEarnedFromRefs}`);
  console.log(`Sum earnedFromBoosts: ${totalEarnedFromBoosts}`);

  console.log('\n=== Logic check (current flag) ===');
  const mode = giveaway.countRefsOnParticipation ? 'join-required' : 'link-click';
  console.log(`Active mode: ${mode}`);
  console.log(`Qualifying referrals (current rules): ${qualifyingCount}`);

  if (giveaway.countRefsOnParticipation) {
    console.log(
      '\nIf countRefsOnParticipation=true is correct NOW, extra tickets should only come from hasParticipated referrals.',
    );
    if (refsWithoutJoin.length > 0 && totalEarnedFromRefs > 0) {
      console.log(
        `⚠ ${refsWithoutJoin.length} referrals never joined — they must NOT earn tickets under join-required mode.`,
      );
    }
    if (refsWithJoinButNotFlagged.length > 0) {
      console.log(
        `⚠ ${refsWithJoinButNotFlagged.length} referred users joined but hasParticipated=false — possible missed markReferralParticipatedAndAward.`,
      );
    }
  }

  const totalSurplusJoin = referrerAudits.reduce((s, r) => s + Math.max(0, r.surplusJoinMode), 0);
  const totalSurplusLink = referrerAudits.reduce((s, r) => s + Math.max(0, r.surplusLinkMode), 0);

  console.log('\n=== Surplus tickets (earned − expected) ===');
  console.log(`Referrers with surplus under join-required rules: ${referrerAudits.filter((r) => r.surplusJoinMode > 0).length} (total +${totalSurplusJoin} tickets)`);
  console.log(`Referrers with surplus under link-click rules: ${referrerAudits.filter((r) => r.surplusLinkMode > 0).length} (total +${totalSurplusLink} tickets)`);

  if (giveaway.countRefsOnParticipation && totalSurplusJoin > 0 && totalSurplusLink === 0) {
    console.log(
      '\n➜ Likely cause: tickets were granted under link-click rules earlier, or flag was false when referrals were created.',
    );
    console.log('  syncReferralEarnedTickets only adds tickets; toggling the flag does not revoke them.');
  } else if (giveaway.countRefsOnParticipation && totalSurplusJoin === 0) {
    console.log('\n✓ Earned ref tickets match join-required rules (no surplus).');
  } else if (!giveaway.countRefsOnParticipation) {
    console.log('\nNote: flag is OFF — link-click mode is active; referrals count without join.');
  }

  console.log('\n=== Top referrers (by earnedFromRefs) ===');
  for (const r of referrerAudits.slice(0, 15)) {
    if (r.earnedFromRefs === 0 && r.totalRefs === 0) continue;
    console.log(
      `user ${r.userId} (@${r.label}): refs=${r.totalRefs}, participated=${r.participatedRefs}, ` +
        `earnedRefs=${r.earnedFromRefs}, expected(join)=${r.expectedIfJoinRequired}, expected(link)=${r.expectedIfLinkClick}, ` +
        `participantRows=${r.participantRows}, surplus(join)=${r.surplusJoinMode}`,
    );
  }

  if (refsWithJoinButNotFlagged.length > 0 && refsWithJoinButNotFlagged.length <= 20) {
    console.log('\n=== Joined but hasParticipated=false (sample) ===');
    for (const r of refsWithJoinButNotFlagged.slice(0, 20)) {
      console.log(
        `referral ${r.id}: referrer=${r.referrerId} → referred=${r.referredId} (@${r.referred.username ?? r.referred.first_name}), created=${r.createdAt.toISOString()}`,
      );
    }
  }

  const isLottery = giveaway.participiationType === 'Lottery';
  const buttonCountBasis = isLottery
    ? 'total participant rows (each ref/boost ticket counts)'
    : 'distinct users only (extra ref tickets for same user do NOT increase button count)';

  console.log('\n=== Button participant count vs tickets ===');
  console.log(`participiationType=${giveaway.participiationType}`);
  console.log(`Telegram button count uses: ${buttonCountBasis}`);
  if (!isLottery && totalEarnedFromRefs > 0) {
    console.log(
      `⚠ Random giveaway: ${totalEarnedFromRefs} ref ticket rows exist but button shows ${distinctParticipants.length} unique users, not ${totalParticipantRows} rows.`,
    );
  }

  console.log('\n=== Oleksandr expectation ===');
  console.log(
    'Channel subscriber stats (15–20/day) ≠ giveaway participants ≠ ref ticket rows.',
  );
  console.log(
    'With join-required mode, qualifying refs ≈ referred users who joined; earnedFromRefs ≈ floor(qualifying / refsPerTicket).',
  );
  console.log(
    'If surplus under join-required rules > 0, tickets were likely granted under link-click mode earlier (flag default=false, or toggled later). syncReferralEarnedTickets never revokes.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

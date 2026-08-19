/**
 * Audit API Session effectiveness and join spikes for a giveaway.
 *
 * Usage:
 *   npx tsx src/scripts/audit-api-session-giveaway.ts <giveawayId>
 *   npm run script:audit-api-session -- 98c8f479-9bb1-4935-8851-ede00f591b37
 *
 * Requires DATABASE_URL (same as the API).
 *
 * Interprets:
 *   - doApiSessionCheck + apiSessionBlockCount on the giveaway row
 *   - whether joiners had user_sessions rows (session check only blocks users with zero sessions)
 *   - participation timeline (minute buckets) for bot/spike detection
 *   - IP clusters via user_activities
 *   - pending participation confirmations (validate without join yet)
 */

import { prisma, Prisma } from '@database';

type MinuteBucket = {
  minute: Date;
  joins: bigint;
  distinctUsers: bigint;
};

type SessionCoverage = {
  joinedUsers: number;
  withSession: number;
  withoutSession: number;
};

type SpikeUser = {
  userId: number;
  username: string | null;
  firstName: string;
  participatedAt: Date;
  userCreatedAt: Date;
  hasSession: boolean;
};

type IpCluster = {
  ip: string;
  users: number;
};

type UserAgentCluster = {
  userAgent: string;
  users: number;
};

type ConfirmationRow = {
  userId: number;
  username: string | null;
  tickets: number;
  createdAt: Date;
  expiresAt: Date;
  hasSession: boolean;
};

function fmtMinute(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

async function main() {
  const giveawayId = process.argv[2];
  if (!giveawayId) {
    console.error(
      'Usage: npx tsx src/scripts/audit-api-session-giveaway.ts <giveawayId>',
    );
    process.exit(1);
  }

  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      id: true,
      description: true,
      doApiSessionCheck: true,
      apiSessionBlockCount: true,
      twinkBlock: true,
      isCaptchaNeeded: true,
      participiationType: true,
      maxParticipants: true,
      completionType: true,
      isActive: true,
      isPlanned: true,
      isCancelled: true,
      startingAt: true,
      endingAt: true,
      finishedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { participants: true } },
    },
  });

  if (!giveaway) {
    console.error(`Giveaway not found: ${giveawayId}`);
    process.exit(1);
  }

  const [
    distinctUserCount,
    timeline,
    sessionStatsRows,
    freshAccountsInGiveaway,
    ipClusters,
    userAgentClusters,
    pendingConfirmations,
  ] = await Promise.all([
    prisma.participant.findMany({
      where: { giveawayId },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.$queryRaw<MinuteBucket[]>(Prisma.sql`
      SELECT
        date_trunc('minute', participated_at) AS minute,
        COUNT(*)::bigint AS joins,
        COUNT(DISTINCT user_id)::bigint AS "distinctUsers"
      FROM participants
      WHERE giveaway_id = ${giveawayId}::uuid
      GROUP BY 1
      ORDER BY joins DESC
      LIMIT 25
    `),
    prisma.$queryRaw<SessionCoverage[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT p.user_id)::int AS "joinedUsers",
        COUNT(DISTINCT p.user_id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM user_sessions s WHERE s.user_id = p.user_id
          )
        )::int AS "withSession",
        COUNT(DISTINCT p.user_id) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM user_sessions s WHERE s.user_id = p.user_id
          )
        )::int AS "withoutSession"
      FROM participants p
      WHERE p.giveaway_id = ${giveawayId}::uuid
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT p.user_id)::int AS count
      FROM participants p
      JOIN users u ON u.id = p.user_id
      WHERE p.giveaway_id = ${giveawayId}::uuid
        AND u.created_at >= ${giveaway.startingAt}
    `),
    prisma.$queryRaw<IpCluster[]>(Prisma.sql`
      SELECT ua.ip, COUNT(DISTINCT p.user_id)::int AS users
      FROM participants p
      JOIN user_activities ua ON ua.user_id = p.user_id
      WHERE p.giveaway_id = ${giveawayId}::uuid
      GROUP BY ua.ip
      HAVING COUNT(DISTINCT p.user_id) > 3
      ORDER BY users DESC
      LIMIT 25
    `),
    prisma.$queryRaw<UserAgentCluster[]>(Prisma.sql`
      SELECT s.user_agent AS "userAgent", COUNT(DISTINCT p.user_id)::int AS users
      FROM participants p
      JOIN user_sessions s ON s.user_id = p.user_id
      WHERE p.giveaway_id = ${giveawayId}::uuid
      GROUP BY s.user_agent
      HAVING COUNT(DISTINCT p.user_id) > 3
      ORDER BY users DESC
      LIMIT 15
    `),
    prisma.$queryRaw<ConfirmationRow[]>(Prisma.sql`
      SELECT
        c.user_id AS "userId",
        u.username,
        c.tickets,
        c.created_at AS "createdAt",
        c.expires_at AS "expiresAt",
        EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id = c.user_id) AS "hasSession"
      FROM giveaway_participation_confirmations c
      JOIN users u ON u.id = c.user_id
      WHERE c.giveaway_id = ${giveawayId}::uuid
        AND c.is_used = false
        AND c.expires_at > NOW()
      ORDER BY c.created_at DESC
      LIMIT 30
    `),
  ]);

  const sessionStats = sessionStatsRows[0] ?? {
    joinedUsers: 0,
    withSession: 0,
    withoutSession: 0,
  };

  const totalRows = giveaway._count.participants;
  const peakMinute = timeline[0];

  let spikeUsers: SpikeUser[] = [];
  if (peakMinute) {
    spikeUsers = await prisma.$queryRaw<SpikeUser[]>(Prisma.sql`
      SELECT
        p.user_id AS "userId",
        u.username,
        u.first_name AS "firstName",
        p.participated_at AS "participatedAt",
        u.created_at AS "userCreatedAt",
        EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id = p.user_id) AS "hasSession"
      FROM participants p
      JOIN users u ON u.id = p.user_id
      WHERE p.giveaway_id = ${giveawayId}::uuid
        AND date_trunc('minute', p.participated_at) = ${peakMinute.minute}
      ORDER BY p.participated_at ASC
      LIMIT 40
    `);
  }

  console.log('\n=== Giveaway ===');
  console.log(
    JSON.stringify(
      {
        ...giveaway,
        _count: undefined,
        participantRows: totalRows,
        distinctUsers: distinctUserCount.length,
      },
      null,
      2,
    ),
  );

  console.log('\n=== API Session config ===');
  console.log(
    `doApiSessionCheck=${giveaway.doApiSessionCheck} (blocks validate only when user has zero user_sessions rows)`,
  );
  console.log(`apiSessionBlockCount=${giveaway.apiSessionBlockCount} (failed validate attempts logged in DB)`);
  console.log(`twinkBlock=${giveaway.twinkBlock} (stored flag — join path does not enforce twinkBlock yet)`);
  console.log(`isCaptchaNeeded=${giveaway.isCaptchaNeeded}`);
  console.log(
    `giveaway.updatedAt=${giveaway.updatedAt.toISOString()} (last any-field update; not exact API-session toggle time)`,
  );

  console.log('\n=== Session coverage among joiners ===');
  console.log(`Distinct users who joined: ${sessionStats.joinedUsers}`);
  console.log(`With at least one user_sessions row: ${sessionStats.withSession}`);
  console.log(`Without any user_sessions row: ${sessionStats.withoutSession}`);
  if (giveaway.doApiSessionCheck && sessionStats.withoutSession > 0) {
    console.log(
      `⚠ ${sessionStats.withoutSession} joiner(s) have no session — likely validated before flag was on, or join bypassed re-check.`,
    );
  }
  if (giveaway.doApiSessionCheck && sessionStats.withSession === sessionStats.joinedUsers) {
    console.log(
      '➜ All joiners had sessions — API Session would not block them (check only requires any session row).',
    );
  }
  if (giveaway.apiSessionBlockCount === 0 && giveaway.doApiSessionCheck) {
    console.log(
      '➜ apiSessionBlockCount=0 — no failed validate attempts recorded (bots may already have sessions).',
    );
  }

  console.log('\n=== Join timeline (top minutes by row count) ===');
  if (timeline.length === 0) {
    console.log('  (no participants)');
  } else {
    for (const row of timeline) {
      console.log(
        `  ${fmtMinute(row.minute)} UTC: ${row.joins} rows, ${row.distinctUsers} distinct users`,
      );
    }
  }

  if (peakMinute) {
    const peakRows = Number(peakMinute.joins);
    const peakUsers = Number(peakMinute.distinctUsers);
    console.log(
      `\nPeak: ${peakRows} participant row(s), ${peakUsers} distinct user(s) in minute ${fmtMinute(peakMinute.minute)} UTC`,
    );
    const peakWithoutSession = spikeUsers.filter((u) => !u.hasSession).length;
    const peakFreshAccounts = spikeUsers.filter(
      (u) => u.userCreatedAt >= giveaway.startingAt,
    ).length;
    console.log(
      `  In peak sample (up to 40): withoutSession=${peakWithoutSession}, accountsCreatedAfterGiveawayStart=${peakFreshAccounts}`,
    );
  }

  console.log(`\nAccounts created after giveaway.startingAt: ${freshAccountsInGiveaway[0]?.count ?? 0}`);

  if (spikeUsers.length > 0) {
    console.log('\n=== Peak-minute joiners (sample) ===');
    for (const u of spikeUsers.slice(0, 20)) {
      const label = u.username ? `@${u.username}` : u.firstName || String(u.userId);
      console.log(
        `  user ${u.userId} (${label}): joined=${u.participatedAt.toISOString()}, ` +
          `registered=${u.userCreatedAt.toISOString()}, hasSession=${u.hasSession}`,
      );
    }
    if (spikeUsers.length > 20) {
      console.log(`  ... and ${spikeUsers.length - 20} more in peak minute`);
    }
  }

  console.log('\n=== IPs with 4+ distinct joiners (user_activities) ===');
  if (ipClusters.length === 0) {
    console.log('  (none — or no user_activities rows for joiners)');
  } else {
    for (const row of ipClusters) {
      console.log(`  ${row.ip}: ${row.users} users`);
    }
  }

  console.log('\n=== user_agent clusters (4+ joiners sharing same UA) ===');
  if (userAgentClusters.length === 0) {
    console.log('  (none)');
  } else {
    for (const row of userAgentClusters) {
      const ua =
        row.userAgent.length > 80
          ? `${row.userAgent.slice(0, 77)}...`
          : row.userAgent;
      console.log(`  ${row.users} users — ${ua}`);
    }
  }

  console.log('\n=== Pending participation confirmations (unused, not expired) ===');
  if (pendingConfirmations.length === 0) {
    console.log('  (none)');
  } else {
    console.log(`  ${pendingConfirmations.length} shown (max 30):`);
    for (const c of pendingConfirmations) {
      const label = c.username ? `@${c.username}` : String(c.userId);
      console.log(
        `  user ${c.userId} (${label}): tickets=${c.tickets}, created=${c.createdAt.toISOString()}, ` +
          `hasSession=${c.hasSession}`,
      );
    }
  }

  console.log('\n=== PM2 log hints ===');
  console.log(`  grep "${giveawayId}" /path/to/logs/*.log | grep -i ApiSession`);
  console.log(`  grep "${giveawayId}" /path/to/logs/*.log | grep -i "validate\\|joinGiveaway"`);
  console.log(
    '  [ApiSession] Blocked userId=... — only emitted on validate, not stored per-user in DB.',
  );
  console.log(
    '  Session check runs at validateGiveawayParticipation only; joinGiveaway does not re-check.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

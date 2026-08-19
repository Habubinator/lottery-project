import { prisma, Prisma } from '@database';

export type Timeline = '1d' | '1w' | '1m' | '3m' | '6m' | '1y';
export type StatsMode = 'owner' | 'user';

interface TimelineConfig {
  days: number;
  granularity: 'hour' | 'day' | 'week' | 'month';
}

const TIMELINE_CONFIGS: Record<Timeline, TimelineConfig> = {
  '1d': { days: 1, granularity: 'hour' },
  '1w': { days: 7, granularity: 'day' },
  '1m': { days: 30, granularity: 'day' },
  '3m': { days: 90, granularity: 'week' },
  '6m': { days: 180, granularity: 'week' },
  '1y': { days: 365, granularity: 'month' },
};

function getStartDate(timeline: Timeline): Date {
  const config = TIMELINE_CONFIGS[timeline];
  const now = new Date();
  now.setDate(now.getDate() - config.days);
  return now;
}

function truncateDate(date: Date, granularity: string): string {
  const d = new Date(date);
  if (granularity === 'hour') {
    d.setMinutes(0, 0, 0);
  } else if (granularity === 'day') {
    d.setHours(0, 0, 0, 0);
  } else if (granularity === 'week') {
    // truncate to monday of week
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
  } else if (granularity === 'month') {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

function generateSlots(startDate: Date, endDate: Date, granularity: string): string[] {
  const slots: string[] = [];
  const current = new Date(startDate);

  // Truncate current to granularity
  if (granularity === 'hour') {
    current.setMinutes(0, 0, 0);
  } else if (granularity === 'day') {
    current.setHours(0, 0, 0, 0);
  } else if (granularity === 'week') {
    const day = current.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    current.setDate(current.getDate() + diff);
    current.setHours(0, 0, 0, 0);
  } else if (granularity === 'month') {
    current.setDate(1);
    current.setHours(0, 0, 0, 0);
  }

  while (current <= endDate) {
    slots.push(current.toISOString());
    if (granularity === 'hour') {
      current.setHours(current.getHours() + 1);
    } else if (granularity === 'day') {
      current.setDate(current.getDate() + 1);
    } else if (granularity === 'week') {
      current.setDate(current.getDate() + 7);
    } else if (granularity === 'month') {
      current.setMonth(current.getMonth() + 1);
    }
  }
  return slots;
}

function zeroFillOwner(
  raw: Array<{ period: Date; total: bigint; lottery: bigint; random: bigint }>,
  startDate: Date,
  endDate: Date,
  granularity: string,
) {
  const slots = generateSlots(startDate, endDate, granularity);
  const byPeriod = new Map(raw.map((r) => [truncateDate(r.period, granularity), r]));
  return slots.map((slot) => {
    const entry = byPeriod.get(slot);
    return {
      period: slot,
      total: entry ? Number(entry.total) : 0,
      lottery: entry ? Number(entry.lottery) : 0,
      random: entry ? Number(entry.random) : 0,
    };
  });
}

function mergeUserTimeSeries(
  participationRows: Array<{
    period: Date;
    participations: bigint;
    lottery: bigint;
    random: bigint;
  }>,
  winRows: Array<{ period: Date; wins: bigint }>,
  startDate: Date,
  endDate: Date,
  granularity: string,
) {
  const partByPeriod = new Map(
    participationRows.map((r) => [truncateDate(r.period, granularity), r]),
  );
  const winsByPeriod = new Map(
    winRows.map((r) => [truncateDate(r.period, granularity), r]),
  );
  const slots = generateSlots(startDate, endDate, granularity);
  return slots.map((slot) => {
    const part = partByPeriod.get(slot);
    const win = winsByPeriod.get(slot);
    return {
      period: slot,
      participations: part ? Number(part.participations) : 0,
      wins: win ? Number(win.wins) : 0,
      lottery: part ? Number(part.lottery) : 0,
      random: part ? Number(part.random) : 0,
    };
  });
}

const OCCUPIED_PRIZE_SLOT_SQL = Prisma.raw(`
  CASE
    WHEN (p.is_winner = true OR p.is_add_winner = true) AND p.was_replaced = false THEN
      CASE
        WHEN p.is_add_winner THEN p.giveaway_id::text || ':add:' || p."addPlace"::text
        WHEN p."winPlace" > 0 THEN p.giveaway_id::text || ':main:' || p."winPlace"::text
        ELSE p.giveaway_id::text || ':main:row:' || p.uuid::text
      END
  END
`);

/** Ended giveaways, including zombies where finish tx never set finished_at. */
const CONCLUDED_GIVEAWAY_WHERE = Prisma.raw(`
  g.is_planned = false
  AND g.is_cancelled = false
  AND g.is_active = false
`);

/** Bucket wins by actual or scheduled end when finished_at is missing. */
const GIVEAWAY_WIN_PERIOD_SQL = Prisma.raw(`COALESCE(g.finished_at, g.ending_at)`);

class StatsService {
  async getMainStats(timeline: Timeline, mode: StatsMode) {
    const config = TIMELINE_CONFIGS[timeline];
    const startDate = getStartDate(timeline);
    const endDate = new Date();
    const { granularity } = config;

    if (mode === 'owner') {
      return this.getOwnerStats(startDate, endDate, granularity);
    }
    return this.getUserStats(startDate, endDate, granularity);
  }

  private async runQuery<T>(label: string, query: Promise<T>): Promise<T> {
    try {
      return await query;
    } catch (err) {
      console.error(`[StatsService] Raw query failed — ${label}:`, err);
      throw err;
    }
  }

  private async getOwnerStats(
    startDate: Date,
    endDate: Date,
    granularity: string,
  ) {
    const [rawRecords, summaryGroups, boostsAgg, referralsTotal] = await Promise.all([
      this.runQuery('getOwnerStats.rawRecords', prisma.$queryRaw<Array<{ period: Date; total: bigint; lottery: bigint; random: bigint }>>`
        SELECT
          date_trunc(${granularity}, created_at) AS period,
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE giveaway_start_type = 'Lottery')::bigint AS lottery,
          COUNT(*) FILTER (WHERE giveaway_start_type = 'Random')::bigint AS random
        FROM giveaways
        WHERE created_at >= ${startDate}
        GROUP BY period
        ORDER BY period ASC
      `),
      prisma.giveaway.groupBy({
        by: ['participiationType'],
        where: { createdAt: { gte: startDate } },
        _count: { _all: true },
      }),
      prisma.giveawayEarnedTickets.aggregate({
        where: { giveaway: { createdAt: { gte: startDate } } },
        _sum: { earnedFromBoosts: true },
      }),
      prisma.giveawayReferral.count({
        where: { giveaway: { createdAt: { gte: startDate } } },
      }),
    ]);

    const lotteryCreated = summaryGroups.find((g) => g.participiationType === 'Lottery')?._count._all ?? 0;
    const randomCreated = summaryGroups.find((g) => g.participiationType === 'Random')?._count._all ?? 0;

    return {
      summary: {
        giveawaysCreated: lotteryCreated + randomCreated,
        lotteryCreated,
        randomCreated,
        totalBoosts: boostsAgg._sum.earnedFromBoosts ?? 0,
        totalReferrals: referralsTotal,
      },
      records: zeroFillOwner(rawRecords, startDate, endDate, granularity),
    };
  }

  private async getUserStats(
    startDate: Date,
    endDate: Date,
    granularity: string,
  ) {
    const [summaryRow, participationRows, winRows] = await Promise.all([
      this.runQuery('getUserStats.summary', prisma.$queryRaw<Array<{
        total_participations: number;
        lottery_participations: number;
        random_participations: number;
        total_wins: number;
        lottery_wins: number;
        random_wins: number;
      }>>`
        SELECT
          (
            SELECT COUNT(DISTINCT (p.user_id, p.giveaway_id))::int
            FROM participants p
            WHERE p.participated_at >= ${startDate}
          ) AS total_participations,
          (
            SELECT COUNT(DISTINCT (p.user_id, p.giveaway_id))::int
            FROM participants p
            JOIN giveaways g ON g.giveaway_id = p.giveaway_id
            WHERE p.participated_at >= ${startDate}
              AND g.giveaway_start_type = 'Lottery'
          ) AS lottery_participations,
          (
            SELECT COUNT(DISTINCT (p.user_id, p.giveaway_id))::int
            FROM participants p
            JOIN giveaways g ON g.giveaway_id = p.giveaway_id
            WHERE p.participated_at >= ${startDate}
              AND g.giveaway_start_type = 'Random'
          ) AS random_participations,
          (
            SELECT COUNT(DISTINCT ${OCCUPIED_PRIZE_SLOT_SQL})::int
            FROM participants p
            JOIN giveaways g ON g.giveaway_id = p.giveaway_id
            WHERE ${CONCLUDED_GIVEAWAY_WHERE}
              AND ${GIVEAWAY_WIN_PERIOD_SQL} IS NOT NULL
              AND ${GIVEAWAY_WIN_PERIOD_SQL} >= ${startDate}
          ) AS total_wins,
          (
            SELECT COUNT(DISTINCT ${OCCUPIED_PRIZE_SLOT_SQL})::int
            FROM participants p
            JOIN giveaways g ON g.giveaway_id = p.giveaway_id
            WHERE ${CONCLUDED_GIVEAWAY_WHERE}
              AND ${GIVEAWAY_WIN_PERIOD_SQL} IS NOT NULL
              AND ${GIVEAWAY_WIN_PERIOD_SQL} >= ${startDate}
              AND g.giveaway_start_type = 'Lottery'
          ) AS lottery_wins,
          (
            SELECT COUNT(DISTINCT ${OCCUPIED_PRIZE_SLOT_SQL})::int
            FROM participants p
            JOIN giveaways g ON g.giveaway_id = p.giveaway_id
            WHERE ${CONCLUDED_GIVEAWAY_WHERE}
              AND ${GIVEAWAY_WIN_PERIOD_SQL} IS NOT NULL
              AND ${GIVEAWAY_WIN_PERIOD_SQL} >= ${startDate}
              AND g.giveaway_start_type = 'Random'
          ) AS random_wins
      `),
      this.runQuery('getUserStats.participationRecords', prisma.$queryRaw<Array<{
        period: Date;
        participations: bigint;
        lottery: bigint;
        random: bigint;
      }>>`
        SELECT
          date_trunc(${granularity}, p.participated_at) AS period,
          COUNT(DISTINCT (p.user_id, p.giveaway_id))::bigint AS participations,
          COUNT(DISTINCT (p.user_id, p.giveaway_id)) FILTER (
            WHERE g.giveaway_start_type = 'Lottery'
          )::bigint AS lottery,
          COUNT(DISTINCT (p.user_id, p.giveaway_id)) FILTER (
            WHERE g.giveaway_start_type = 'Random'
          )::bigint AS random
        FROM participants p
        JOIN giveaways g ON g.giveaway_id = p.giveaway_id
        WHERE p.participated_at >= ${startDate}
        GROUP BY period
        ORDER BY period ASC
      `),
      this.runQuery('getUserStats.winRecords', prisma.$queryRaw<Array<{
        period: Date;
        wins: bigint;
      }>>`
        SELECT
          date_trunc(${granularity}, ${GIVEAWAY_WIN_PERIOD_SQL}) AS period,
          COUNT(DISTINCT ${OCCUPIED_PRIZE_SLOT_SQL})::bigint AS wins
        FROM participants p
        JOIN giveaways g ON g.giveaway_id = p.giveaway_id
        WHERE ${CONCLUDED_GIVEAWAY_WHERE}
          AND ${GIVEAWAY_WIN_PERIOD_SQL} IS NOT NULL
          AND ${GIVEAWAY_WIN_PERIOD_SQL} >= ${startDate}
        GROUP BY period
        ORDER BY period ASC
      `),
    ]);

    const row = summaryRow[0] ?? {
      total_participations: 0,
      lottery_participations: 0,
      random_participations: 0,
      total_wins: 0,
      lottery_wins: 0,
      random_wins: 0,
    };

    return {
      summary: {
        totalParticipations: row.total_participations,
        lotteryParticipations: row.lottery_participations,
        randomParticipations: row.random_participations,
        totalWins: row.total_wins,
        lotteryWins: row.lottery_wins,
        randomWins: row.random_wins,
      },
      records: mergeUserTimeSeries(
        participationRows,
        winRows,
        startDate,
        endDate,
        granularity,
      ),
    };
  }

  async getTop(mode: StatsMode, timeline?: Timeline) {
    const startDate = timeline ? getStartDate(timeline) : new Date(0);

    if (mode === 'owner') {
      const rows = await this.runQuery('getTop.owner', prisma.$queryRaw<Array<{
        id: number;
        username: string | null;
        first_name: string;
        last_name: string | null;
        photo_url: string;
        giveaways_created: number;
        lottery_created: number;
        random_created: number;
        total_boosts: number;
        total_referrals: number;
      }>>`
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.photo_url,
          COUNT(DISTINCT g.giveaway_id)::int AS giveaways_created,
          COUNT(DISTINCT CASE WHEN g.giveaway_start_type = 'Lottery' THEN g.giveaway_id END)::int AS lottery_created,
          COUNT(DISTINCT CASE WHEN g.giveaway_start_type = 'Random' THEN g.giveaway_id END)::int AS random_created,
          COALESCE(SUM(et.earned_from_boosts), 0)::int AS total_boosts,
          (
            SELECT COUNT(*)::int FROM giveaway_referrals gr
            JOIN giveaways g2 ON g2.giveaway_id = gr.giveaway_id
            WHERE g2.created_by = u.id AND g2.created_at >= ${startDate}
          ) AS total_referrals
        FROM users u
        LEFT JOIN giveaways g ON g.created_by = u.id AND g.created_at >= ${startDate}
        LEFT JOIN giveaway_earned_tickets et ON et.giveaway_id = g.giveaway_id
        GROUP BY u.id, u.username, u.first_name, u.last_name, u.photo_url
        ORDER BY giveaways_created DESC, u.id ASC
        LIMIT 100
      `);

      return {
        mode,
        data: rows.map((row, i) => ({
          rank: i + 1,
          id: row.id,
          username: row.username,
          first_name: row.first_name,
          last_name: row.last_name,
          photo_url: row.photo_url,
          giveawaysCreated: row.giveaways_created,
          lotteryCreated: row.lottery_created,
          randomCreated: row.random_created,
          totalBoosts: row.total_boosts,
          totalReferrals: row.total_referrals,
        })),
      };
    } else {
      const rows = await this.runQuery('getTop.user', prisma.$queryRaw<Array<{
        id: number;
        username: string | null;
        first_name: string;
        last_name: string | null;
        photo_url: string;
        total_participations: number;
        lottery_participations: number;
        random_participations: number;
        total_wins: number;
        lottery_wins: number;
        random_wins: number;
      }>>`
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.photo_url,
          COUNT(DISTINCT p.giveaway_id)::int AS total_participations,
          COUNT(DISTINCT CASE WHEN g.giveaway_start_type = 'Lottery' THEN p.giveaway_id END)::int AS lottery_participations,
          COUNT(DISTINCT CASE WHEN g.giveaway_start_type = 'Random' THEN p.giveaway_id END)::int AS random_participations,
          COUNT(DISTINCT CASE
            WHEN (p.is_winner = true OR p.is_add_winner = true) AND p.was_replaced = false
              AND g.is_planned = false AND g.is_cancelled = false AND g.is_active = false
              AND COALESCE(g.finished_at, g.ending_at) IS NOT NULL
              AND COALESCE(g.finished_at, g.ending_at) >= ${startDate} THEN
              CASE
                WHEN p.is_add_winner THEN p.giveaway_id::text || ':add:' || p."addPlace"::text
                WHEN p."winPlace" > 0 THEN p.giveaway_id::text || ':main:' || p."winPlace"::text
                ELSE p.giveaway_id::text || ':main:row:' || p.uuid::text
              END
          END)::int AS total_wins,
          COUNT(DISTINCT CASE
            WHEN (p.is_winner = true OR p.is_add_winner = true) AND p.was_replaced = false
              AND g.giveaway_start_type = 'Lottery'
              AND g.is_planned = false AND g.is_cancelled = false AND g.is_active = false
              AND COALESCE(g.finished_at, g.ending_at) IS NOT NULL
              AND COALESCE(g.finished_at, g.ending_at) >= ${startDate} THEN
              CASE
                WHEN p.is_add_winner THEN p.giveaway_id::text || ':add:' || p."addPlace"::text
                WHEN p."winPlace" > 0 THEN p.giveaway_id::text || ':main:' || p."winPlace"::text
                ELSE p.giveaway_id::text || ':main:row:' || p.uuid::text
              END
          END)::int AS lottery_wins,
          COUNT(DISTINCT CASE
            WHEN (p.is_winner = true OR p.is_add_winner = true) AND p.was_replaced = false
              AND g.giveaway_start_type = 'Random'
              AND g.is_planned = false AND g.is_cancelled = false AND g.is_active = false
              AND COALESCE(g.finished_at, g.ending_at) IS NOT NULL
              AND COALESCE(g.finished_at, g.ending_at) >= ${startDate} THEN
              CASE
                WHEN p.is_add_winner THEN p.giveaway_id::text || ':add:' || p."addPlace"::text
                WHEN p."winPlace" > 0 THEN p.giveaway_id::text || ':main:' || p."winPlace"::text
                ELSE p.giveaway_id::text || ':main:row:' || p.uuid::text
              END
          END)::int AS random_wins
        FROM users u
        LEFT JOIN participants p ON p.user_id = u.id AND p.participated_at >= ${startDate}
        LEFT JOIN giveaways g ON g.giveaway_id = p.giveaway_id
        GROUP BY u.id, u.username, u.first_name, u.last_name, u.photo_url
        ORDER BY total_participations DESC, u.id ASC
        LIMIT 100
      `);

      return {
        mode,
        data: rows.map((row, i) => ({
          rank: i + 1,
          id: row.id,
          username: row.username,
          first_name: row.first_name,
          last_name: row.last_name,
          photo_url: row.photo_url,
          totalParticipations: row.total_participations,
          lotteryParticipations: row.lottery_participations,
          randomParticipations: row.random_participations,
          totalWins: row.total_wins,
          lotteryWins: row.lottery_wins,
          randomWins: row.random_wins,
        })),
      };
    }
  }
}

export const statsService = new StatsService();

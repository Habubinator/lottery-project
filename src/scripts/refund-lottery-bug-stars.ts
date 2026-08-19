/**
 * Refund Telegram Stars lottery-ticket invoices for the allowMultipleWinPlaces bug window.
 *
 * Phase 1 (default): dry-run — list giveaways + refundable invoice txs (no Telegram calls).
 * Phase 2: --execute — refundStarPayment back to Telegram (invoice path only).
 *
 * Usage:
 *   npx tsx src/scripts/refund-lottery-bug-stars.ts
 *   npx tsx src/scripts/refund-lottery-bug-stars.ts --dry-run
 *   npx tsx src/scripts/refund-lottery-bug-stars.ts --execute
 *   npx tsx src/scripts/refund-lottery-bug-stars.ts --from=2026-06-21 --exclude=extra-id
 *
 * Default excludes: 634c69c8-… (latest fixed) and 0c415333-… (21.06 first lottery).
 *
 * Balance-path ticket buys are reported as out-of-scope and never refunded here.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  prisma,
  Currencies,
  TransactionStatus,
  TransactionType,
  GiveawayStartType,
} from '@database';
import { refundTelegramStarPayment } from '../bot/service/bot.service';

const DEFAULT_FROM = '2026-06-21';
/** Latest fixed lottery + first 21.06 lottery (Oleksandr: skip). */
const DEFAULT_EXCLUDE = [
  '634c69c8-347a-4b22-bb16-a3f74ede1cd5',
  '0c415333-7c8e-4704-b97e-57c1ca6be1f4',
];
const RATE_LIMIT_MS = 750;

type GiveawayRow = {
  id: string;
  description: string | null;
  finishedAt: Date | null;
  endingAt: Date | null;
  startingAt: Date;
};

type TxRow = {
  id: string;
  userId: number;
  value: number;
  telegramPaymentId: string | null;
  additionalInfo: string | null;
  createdAt: Date;
  telegramId: string;
};

type GiveawayReport = {
  id: string;
  description: string;
  finishedAt: string | null;
  refundableTxCount: number;
  refundableStars: number;
  balancePathTxCount: number;
  balancePathStars: number;
  refundable: Array<{
    txId: string;
    userId: number;
    telegramId: string;
    stars: number;
    chargeId: string;
    createdAt: string;
  }>;
};

function parseArgs(argv: string[]) {
  let execute = false;
  let from = DEFAULT_FROM;
  const exclude = new Set<string>(DEFAULT_EXCLUDE);

  for (const arg of argv) {
    if (arg === '--execute') execute = true;
    else if (arg === '--dry-run') execute = false;
    else if (arg.startsWith('--from=')) from = arg.slice('--from='.length);
    else if (arg.startsWith('--exclude=')) {
      // Append to defaults (do not drop built-in skips)
      for (const id of arg.slice('--exclude='.length).split(',')) {
        const trimmed = id.trim();
        if (trimmed) exclude.add(trimmed);
      }
    }
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime())) {
    throw new Error(`Invalid --from date: ${from}`);
  }

  return { execute, fromDate, from, exclude: [...exclude] };
}

function shortDesc(description: string | null): string {
  if (!description) return '(no description)';
  const oneLine = description.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

function giveawayMarker(giveawayId: string): string {
  return `Lottery tickets | giveaway_${giveawayId}`;
}

function isInvoiceLotteryTx(info: string | null): boolean {
  return !!info && info.includes('via Telegram Stars');
}

function isAlreadyRefunded(info: string | null): boolean {
  return !!info && info.includes('REFUNDED:');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadGiveaways(
  fromDate: Date,
  excludeIds: string[],
): Promise<GiveawayRow[]> {
  const rows = await prisma.giveaway.findMany({
    where: {
      participiationType: GiveawayStartType.Lottery,
      isCancelled: false,
      isActive: false,
      id: { notIn: excludeIds },
      OR: [
        { finishedAt: { gte: fromDate } },
        { finishedAt: null, endingAt: { gte: fromDate } },
      ],
    },
    select: {
      id: true,
      description: true,
      finishedAt: true,
      endingAt: true,
      startingAt: true,
    },
    orderBy: [{ finishedAt: 'asc' }, { endingAt: 'asc' }],
  });
  return rows;
}

async function loadTransactionsForGiveaway(
  giveawayId: string,
): Promise<{ invoice: TxRow[]; balance: TxRow[] }> {
  const marker = giveawayMarker(giveawayId);
  const rows = await prisma.transactionHistory.findMany({
    where: {
      currency: Currencies.Stars,
      type: TransactionType.Outcoming,
      additionalInfo: { contains: marker },
    },
    select: {
      id: true,
      userId: true,
      value: true,
      telegramPaymentId: true,
      additionalInfo: true,
      createdAt: true,
      status: true,
      user: { select: { telegramId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const invoice: TxRow[] = [];
  const balance: TxRow[] = [];

  for (const row of rows) {
    const mapped: TxRow = {
      id: row.id,
      userId: row.userId,
      value: row.value,
      telegramPaymentId: row.telegramPaymentId,
      additionalInfo: row.additionalInfo,
      createdAt: row.createdAt,
      telegramId: row.user.telegramId,
    };

    if (isAlreadyRefunded(row.additionalInfo)) continue;
    if (row.status !== TransactionStatus.Completed) continue;

    if (
      isInvoiceLotteryTx(row.additionalInfo) &&
      row.telegramPaymentId
    ) {
      invoice.push(mapped);
    } else if (!row.telegramPaymentId && !isInvoiceLotteryTx(row.additionalInfo)) {
      balance.push(mapped);
    }
  }

  return { invoice, balance };
}

async function buildReport(
  fromDate: Date,
  excludeIds: string[],
): Promise<{
  from: string;
  exclude: string[];
  giveaways: GiveawayReport[];
  totals: {
    giveaways: number;
    refundableTx: number;
    refundableStars: number;
    balancePathTx: number;
    balancePathStars: number;
  };
}> {
  const giveaways = await loadGiveaways(fromDate, excludeIds);
  const reports: GiveawayReport[] = [];

  let refundableTx = 0;
  let refundableStars = 0;
  let balancePathTx = 0;
  let balancePathStars = 0;

  for (const g of giveaways) {
    const { invoice, balance } = await loadTransactionsForGiveaway(g.id);
    const invStars = invoice.reduce((s, t) => s + t.value, 0);
    const balStars = balance.reduce((s, t) => s + t.value, 0);

    refundableTx += invoice.length;
    refundableStars += invStars;
    balancePathTx += balance.length;
    balancePathStars += balStars;

    reports.push({
      id: g.id,
      description: shortDesc(g.description),
      finishedAt: (g.finishedAt ?? g.endingAt)?.toISOString() ?? null,
      refundableTxCount: invoice.length,
      refundableStars: invStars,
      balancePathTxCount: balance.length,
      balancePathStars: balStars,
      refundable: invoice.map((t) => ({
        txId: t.id,
        userId: t.userId,
        telegramId: t.telegramId,
        stars: t.value,
        chargeId: t.telegramPaymentId!,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  }

  return {
    from: fromDate.toISOString().slice(0, 10),
    exclude: excludeIds,
    giveaways: reports,
    totals: {
      giveaways: reports.length,
      refundableTx,
      refundableStars,
      balancePathTx,
      balancePathStars,
    },
  };
}

function printDryRun(report: Awaited<ReturnType<typeof buildReport>>) {
  console.log('=== Lottery bug Stars refund — DRY RUN ===');
  console.log(`From: ${report.from}  Exclude: ${report.exclude.join(', ')}`);
  console.log('');

  for (const g of report.giveaways) {
    if (g.refundableTxCount === 0 && g.balancePathTxCount === 0) continue;
    console.log(
      `${g.id}  |  finished=${g.finishedAt ?? 'n/a'}  |  invoiceTx=${g.refundableTxCount} (${g.refundableStars}⭐)  |  balanceTx(out-of-scope)=${g.balancePathTxCount} (${g.balancePathStars}⭐)`,
    );
    console.log(`  ${g.description}`);
  }

  console.log('');
  console.log('--- Totals ---');
  console.log(`Giveaways (matched):     ${report.totals.giveaways}`);
  console.log(
    `Refundable invoice txs:  ${report.totals.refundableTx}  (${report.totals.refundableStars}⭐)`,
  );
  console.log(
    `Balance-path (skip):     ${report.totals.balancePathTx}  (${report.totals.balancePathStars}⭐)`,
  );
  console.log('');
  console.log(
    'No Telegram calls made. Re-run with --execute to refund invoice payments.',
  );
}

async function executeRefunds(
  report: Awaited<ReturnType<typeof buildReport>>,
): Promise<void> {
  const results: Array<{
    giveawayId: string;
    txId: string;
    chargeId: string;
    telegramId: string;
    stars: number;
    status: 'success' | 'failed' | 'skipped';
    reason?: string;
  }> = [];

  let success = 0;
  let failed = 0;
  let skipped = 0;

  console.log('=== Lottery bug Stars refund — EXECUTE ===');
  console.log(
    `Refunding ${report.totals.refundableTx} invoice txs (${report.totals.refundableStars}⭐)...`,
  );

  for (const g of report.giveaways) {
    for (const item of g.refundable) {
      const telegramUserId = Number(item.telegramId);
      if (!item.telegramId || !Number.isFinite(telegramUserId)) {
        skipped++;
        results.push({
          giveawayId: g.id,
          txId: item.txId,
          chargeId: item.chargeId,
          telegramId: item.telegramId,
          stars: item.stars,
          status: 'skipped',
          reason: 'missing/invalid telegramId',
        });
        continue;
      }

      const ok = await refundTelegramStarPayment(
        telegramUserId,
        item.chargeId,
        item.userId,
        { adjustWallet: false },
      );

      if (ok) {
        success++;
        results.push({
          giveawayId: g.id,
          txId: item.txId,
          chargeId: item.chargeId,
          telegramId: item.telegramId,
          stars: item.stars,
          status: 'success',
        });
        console.log(
          `OK  ${item.chargeId}  user=${item.telegramId}  ${item.stars}⭐  giveaway=${g.id}`,
        );
      } else {
        failed++;
        results.push({
          giveawayId: g.id,
          txId: item.txId,
          chargeId: item.chargeId,
          telegramId: item.telegramId,
          stars: item.stars,
          status: 'failed',
          reason: 'refundStarPayment returned false (see logs)',
        });
        console.log(
          `FAIL ${item.chargeId}  user=${item.telegramId}  ${item.stars}⭐  giveaway=${g.id}`,
        );
      }

      await sleep(RATE_LIMIT_MS);
    }
  }

  const outPath = path.join(
    process.cwd(),
    `lottery-bug-refund-report-${Date.now()}.json`,
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ...report,
        executedAt: new Date().toISOString(),
        summary: { success, failed, skipped },
        results,
      },
      null,
      2,
    ),
  );

  console.log('');
  console.log(`Done: success=${success} failed=${failed} skipped=${skipped}`);
  console.log(`Report: ${outPath}`);
}

async function main() {
  const { execute, fromDate, exclude } = parseArgs(process.argv.slice(2));

  for (const id of exclude) {
    console.log(`Excluded giveaway: ${id}`);
  }

  const report = await buildReport(fromDate, exclude);

  const excludedInList = report.giveaways.some((g) => exclude.includes(g.id));
  if (excludedInList) {
    throw new Error('Excluded giveaway appeared in report — aborting');
  }

  if (!execute) {
    printDryRun(report);
    const dryPath = path.join(
      process.cwd(),
      `lottery-bug-refund-dry-run-${Date.now()}.json`,
    );
    fs.writeFileSync(dryPath, JSON.stringify(report, null, 2));
    console.log(`Dry-run JSON: ${dryPath}`);
    return;
  }

  printDryRun(report);
  if (report.totals.refundableTx === 0) {
    console.log('Nothing to refund.');
    return;
  }
  await executeRefunds(report);
}

main()
  .catch((error) => {
    console.error('[refund-lottery-bug-stars] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

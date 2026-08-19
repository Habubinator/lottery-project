/**
 * Inspect co-owner channel ownership, reconcile scope, and notification banner paths (issue 7).
 *
 * Usage:
 *   npx tsx src/scripts/inspect-giveaway-coowner-and-channels.ts
 *   npx tsx src/scripts/inspect-giveaway-coowner-and-channels.ts --id=c108faf4-2b95-4e0a-9a51-ed0e337ecc1b
 *   npx tsx src/scripts/inspect-giveaway-coowner-and-channels.ts --telegram-id=6490619172
 *
 * Requires DATABASE_URL and BOT_TOKEN (optional — without BOT_TOKEN, Telegram admin list is skipped).
 */

import { prisma } from '@database';
import axios from 'axios';

const DEFAULT_ID = 'c108faf4-2b95-4e0a-9a51-ed0e337ecc1b';
const idArg = process.argv.find((a) => a.startsWith('--id='));
const tgArg = process.argv.find((a) => a.startsWith('--telegram-id='));
const giveawayId = idArg?.slice('--id='.length) ?? DEFAULT_ID;
const filterTelegramId = tgArg?.slice('--telegram-id='.length);

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const POSTING_ROLES = new Set(['All', 'Posting']);

function fmtChannel(ch: { id: bigint; title: string | null; username: string | null }) {
  const name = ch.title || ch.username || `id:${ch.id}`;
  const handle = ch.username ? ` (@${ch.username})` : '';
  return `${name}${handle} [${ch.id}]`;
}

async function fetchTelegramAdmins(channelId: bigint): Promise<
  Array<{ telegramId: string; status: string; username?: string; firstName?: string }>
> {
  if (!process.env.BOT_TOKEN) {
    return [];
  }
  try {
    const response = await axios.get<{
      ok: boolean;
      result?: Array<{ status: string; user: { id: number; username?: string; first_name?: string; is_bot?: boolean } }>;
      description?: string;
    }>(`${TELEGRAM_API_BASE}/getChatAdministrators`, {
      params: { chat_id: channelId.toString() },
      timeout: 10000,
    });
    if (!response.data.ok || !response.data.result) {
      console.warn(`    getChatAdministrators failed: ${response.data.description ?? 'unknown'}`);
      return [];
    }
    return response.data.result
      .filter((m) => !m.user.is_bot && (m.status === 'creator' || m.status === 'administrator'))
      .map((m) => ({
        telegramId: m.user.id.toString(),
        status: m.status,
        username: m.user.username,
        firstName: m.user.first_name,
      }));
  } catch (err: any) {
    console.warn(`    getChatAdministrators error: ${err?.message ?? err}`);
    return [];
  }
}

function inDailyReconcileScope(g: {
  isCancelled: boolean;
  isActive: boolean;
  isPlanned: boolean;
}): boolean {
  return !g.isCancelled && (g.isActive || g.isPlanned);
}

async function main() {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      id: true,
      description: true,
      banner: true,
      isActive: true,
      isPlanned: true,
      isCancelled: true,
      finishedAt: true,
      createdById: true,
      linkedChannels: {
        include: {
          channel: {
            select: {
              id: true,
              title: true,
              username: true,
              isActive: true,
              botCanPostMessages: true,
              addedBy: {
                select: {
                  userId: true,
                  updatedAt: true,
                  user: {
                    select: {
                      id: true,
                      telegramId: true,
                      username: true,
                      first_name: true,
                      last_name: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { role: 'asc' },
      },
      sponsorApprovals: {
        select: {
          id: true,
          status: true,
          channelId: true,
          ownerUserId: true,
          owner: {
            select: { id: true, telegramId: true, username: true, first_name: true },
          },
        },
      },
    },
  });

  if (!giveaway) {
    console.error(`Giveaway not found: ${giveawayId}`);
    process.exit(1);
  }

  const validBanners = (giveaway.banner || []).filter((b) => b && b.trim() !== '');

  console.log('═'.repeat(72));
  console.log('CO-OWNER CHANNELS + BANNER / OWNERSHIP (issue 7)');
  console.log('═'.repeat(72));
  console.log(`Giveaway: ${giveaway.id}`);
  console.log(`State: active=${giveaway.isActive} planned=${giveaway.isPlanned} cancelled=${giveaway.isCancelled} finishedAt=${giveaway.finishedAt?.toISOString() ?? 'null'}`);
  console.log(`Daily cron reconcile scope for linked channels: ${inDailyReconcileScope(giveaway) ? 'YES (active or planned)' : 'NO — only on-demand / postlot / getMyChannels'}`);
  console.log('');
  console.log(' Banner (DM notifications) ');
  console.log(`  Raw banner array length: ${giveaway.banner?.length ?? 0}`);
  console.log(`  Valid banners: ${validBanners.length}`);
  if (validBanners.length === 0) {
    console.log('  → sendCoOwnerResultsNotification / sendSponsorApprovalRequest use /static/giveaways/standart.mp4');
  } else {
    validBanners.forEach((url, i) => console.log(`  [${i + 1}] ${url.slice(0, 100)}${url.length > 100 ? '…' : ''}`));
    console.log('  → DMs use sendPhoto/sendAnimation with giveaway banner');
  }
  console.log('');

  const postingChannels = giveaway.linkedChannels.filter((lc) =>
    POSTING_ROLES.has(lc.role),
  );

  for (const lc of postingChannels) {
    const isCreatorChannel = lc.channel.addedBy.some(
      (ab) => ab.userId === giveaway.createdById,
    );
    console.log('='.repeat(72));
    console.log(fmtChannel(lc.channel));
    console.log(`  role: ${lc.role} | channel.isActive: ${lc.channel.isActive} | botCanPost: ${lc.channel.botCanPostMessages}`);
    console.log(`  creator-owned channel: ${isCreatorChannel}`);
    console.log(`  isPostingResults: ${lc.isPostingResults}`);
    console.log('');
    console.log('  addedBy (app ownership — controls /postlot, my channels list, sponsor DMs):');
    if (lc.channel.addedBy.length === 0) {
      console.log('    (empty — no app user can manage this channel)');
    }
    for (const ab of lc.channel.addedBy) {
      const u = ab.user;
      const marker =
        filterTelegramId && u?.telegramId === filterTelegramId ? ' ← filter match' : '';
      console.log(
        `    user ${ab.userId} | tg:${u?.telegramId ?? '—'} @${u?.username ?? '—'} ${u?.first_name ?? ''} | addedBy.updatedAt: ${ab.updatedAt.toISOString()}${marker}`,
      );
    }

    const tgAdmins = await fetchTelegramAdmins(lc.channel.id);
    if (process.env.BOT_TOKEN) {
      console.log('');
      console.log('  Telegram admins (live):');
      for (const admin of tgAdmins) {
        const appUser = await prisma.user.findFirst({
          where: { telegramId: admin.telegramId },
          select: { id: true, username: true },
        });
        const inAddedBy = lc.channel.addedBy.some(
          (ab) => ab.user?.telegramId === admin.telegramId,
        );
        const marker =
          filterTelegramId && admin.telegramId === filterTelegramId ? ' ← filter match' : '';
        console.log(
          `    ${admin.status} tg:${admin.telegramId} @${admin.username ?? '—'} ${admin.firstName ?? ''} | app user: ${appUser ? `id ${appUser.id}` : 'NOT REGISTERED'} | in addedBy: ${inAddedBy}${marker}`,
        );
        if (!appUser) {
          console.log('      → will NOT appear in my channels until /start in bot');
        } else if (!inAddedBy) {
          console.log('      → missing from addedBy — needs reconcile (postlot / getMyChannels / daily cron)');
        }
      }
    } else {
      console.log('');
      console.log('  (Set BOT_TOKEN to compare live Telegram admins vs addedBy)');
    }

    if (!isCreatorChannel) {
      console.log('');
      console.log('  Co-owner notification recipients at finish (isPostingResults=false):');
      for (const ab of lc.channel.addedBy) {
        if (ab.userId === giveaway.createdById) continue;
        if (!ab.user?.telegramId) {
          console.log(`    user ${ab.userId}: no telegramId — DM skipped`);
          continue;
        }
        console.log(
          `    user ${ab.userId} tg:${ab.user.telegramId} — would get co-owner results DM`,
        );
      }
    }

    const approvals = giveaway.sponsorApprovals.filter(
      (a) => a.channelId.toString() === lc.channelId.toString(),
    );
    if (approvals.length > 0) {
      console.log('');
      console.log('  Sponsor approvals:');
      for (const a of approvals) {
        console.log(
          `    id ${a.id} status=${a.status} owner user ${a.ownerUserId} tg:${a.owner?.telegramId ?? '—'}`,
        );
      }
    }
    console.log('');
  }

  if (filterTelegramId) {
    const appUser = await prisma.user.findFirst({
      where: { telegramId: filterTelegramId },
      select: { id: true, username: true, first_name: true },
    });
    console.log('═'.repeat(72));
    console.log(`Filter telegram-id ${filterTelegramId}`);
    console.log(
      appUser
        ? `  App account: user ${appUser.id} @${appUser.username ?? '—'} ${appUser.first_name ?? ''}`
        : '  App account: NOT FOUND — user must /start the bot first',
    );
    const ownedCount = await prisma.addedBy.count({
      where: { userId: appUser?.id ?? -1 },
    });
    console.log(`  Channels in addedBy for this user (all): ${appUser ? ownedCount : 'n/a'}`);
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

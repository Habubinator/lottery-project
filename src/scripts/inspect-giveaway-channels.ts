/**
 * Inspect linked vs published vs subscription channels for a giveaway.
 *
 * Usage:
 *   npx tsx src/scripts/inspect-giveaway-channels.ts --id=1885b81b-ed18-4fb5-a64a-3dfc813ba150
 *
 * Requires DATABASE_URL (same as the API).
 */

import { prisma } from '@database';

const idArg = process.argv.find((a) => a.startsWith('--id='));
const giveawayId = idArg?.slice('--id='.length);

if (!giveawayId) {
  console.error('Usage: npx tsx src/scripts/inspect-giveaway-channels.ts --id=<giveaway-uuid>');
  process.exit(1);
}

const POSTING_ROLES = new Set(['All', 'Posting']);
const SUBSCRIPTION_ROLES = new Set(['All', 'Subscription']);

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
      isActive: true,
      isPlanned: true,
      isCancelled: true,
      createdAt: true,
      createdById: true,
      linkedChannels: {
        include: {
          channel: {
            select: { id: true, title: true, username: true },
          },
        },
        orderBy: { role: 'asc' },
      },
      messages: {
        include: {
          channel: { select: { id: true, title: true, username: true } },
        },
      },
      postlotPublications: {
        include: {
          channel: { select: { id: true, title: true, username: true } },
        },
      },
    },
  });

  if (!giveaway) {
    console.error(`Giveaway not found: ${giveawayId}`);
    process.exit(1);
  }

  const publishedChannelIds = new Set<string>();
  for (const m of giveaway.messages) {
    publishedChannelIds.add(m.channelId.toString());
  }
  for (const p of giveaway.postlotPublications) {
    publishedChannelIds.add(p.channelId.toString());
  }

  const linkedPosting = giveaway.linkedChannels.filter((lc) =>
    POSTING_ROLES.has(lc.role),
  );
  const linkedSubscriptionOnly = giveaway.linkedChannels.filter(
    (lc) => lc.role === 'Subscription',
  );
  const linkedSubscriptionCheck = giveaway.linkedChannels.filter((lc) =>
    SUBSCRIPTION_ROLES.has(lc.role),
  );

  console.log('═'.repeat(72));
  console.log(`Giveaway: ${giveaway.id}`);
  console.log(`Created:  ${giveaway.createdAt.toISOString()}`);
  console.log(
    `Status:   active=${giveaway.isActive} planned=${giveaway.isPlanned} cancelled=${giveaway.isCancelled}`,
  );
  console.log('═'.repeat(72));
  console.log();

  console.log(`LINKED CHANNELS (${giveaway.linkedChannels.length} total)`);
  console.log('='.repeat(72));
  if (giveaway.linkedChannels.length === 0) {
    console.log('  (none)');
  } else {
    for (const lc of giveaway.linkedChannels) {
      const published = publishedChannelIds.has(lc.channelId.toString());
      const flags = [
        POSTING_ROLES.has(lc.role) ? 'posting' : null,
        SUBSCRIPTION_ROLES.has(lc.role) ? 'subscription-check' : null,
        published ? 'HAS_TELEGRAM_POST' : 'no_telegram_post',
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`  [${lc.role.padEnd(12)}] ${fmtChannel(lc.channel)} — ${flags}`);
    }
  }
  console.log();

  console.log(`POSTING ROLES ONLY (All | Posting) — ${linkedPosting.length}`);
  console.log('='.repeat(72));
  for (const lc of linkedPosting) {
    const published = publishedChannelIds.has(lc.channelId.toString());
    console.log(
      `  ${fmtChannel(lc.channel)} — ${published ? 'published' : 'NOT published yet'}`,
    );
  }
  console.log();

  console.log(
    `SUBSCRIPTION-ONLY LINKED (role=Subscription) — ${linkedSubscriptionOnly.length}`,
  );
  console.log('='.repeat(72));
  if (linkedSubscriptionOnly.length === 0) {
    console.log('  (none)');
  } else {
    for (const lc of linkedSubscriptionOnly) {
      const published = publishedChannelIds.has(lc.channelId.toString());
      console.log(
        `  ${fmtChannel(lc.channel)} — ${published ? 'unexpected: has telegram post' : 'subscription only (no post expected)'}`,
      );
    }
  }
  console.log();

  console.log(`TELEGRAM POSTS (giveaway_messages) — ${giveaway.messages.length}`);
  console.log('='.repeat(72));
  for (const m of giveaway.messages) {
    const linked = giveaway.linkedChannels.find(
      (lc) => lc.channelId === m.channelId,
    );
    const role = linked?.role ?? 'NOT_IN_LINKED_CHANNELS';
    console.log(
      `  ${fmtChannel(m.channel)} — role=${role}, msgId=${m.messageId}`,
    );
  }
  if (giveaway.messages.length === 0) console.log('  (none)');
  console.log();

  console.log(
    `POSTLOT PUBLICATIONS — ${giveaway.postlotPublications.length}`,
  );
  console.log('='.repeat(72));
  for (const p of giveaway.postlotPublications) {
    const linked = giveaway.linkedChannels.find(
      (lc) => lc.channelId === p.channelId,
    );
    const role = linked?.role ?? 'NOT_IN_LINKED_CHANNELS';
    console.log(`  ${fmtChannel(p.channel)} — linked role=${role}`);
  }
  if (giveaway.postlotPublications.length === 0) console.log('  (none)');
  console.log();

  console.log('DIAGNOSIS');
  console.log('='.repeat(72));
  console.log(
    `  API GET /giveaways/:id returns ALL ${giveaway.linkedChannels.length} linkedChannels (incl. Subscription).`,
  );
  console.log(
    `  Bot notifications use only All|Posting (${linkedPosting.length} channels).`,
  );
  console.log(
    `  Join subscription check uses All|Subscription (${linkedSubscriptionCheck.length} channels).`,
  );

  const subOnlyInApi = linkedSubscriptionOnly.filter(
    (lc) => !POSTING_ROLES.has(lc.role),
  );
  if (subOnlyInApi.length > 0) {
    console.log();
    console.log(
      `  ⚠ ${subOnlyInApi.length} channel(s) are Subscription-only — if UI shows`,
    );
    console.log(
      '    "published channels" from linkedChannels without filtering by role,',
    );
    console.log('    subscription channels will appear incorrectly.');
    for (const lc of subOnlyInApi) {
      console.log(`      → ${fmtChannel(lc.channel)}`);
    }
  }

  const postedButNotPosting = giveaway.messages.filter((m) => {
    const lc = giveaway.linkedChannels.find((x) => x.channelId === m.channelId);
    return lc && !POSTING_ROLES.has(lc.role);
  });
  if (postedButNotPosting.length > 0) {
    console.log();
    console.log('  ⚠ Telegram post exists but linked role is not All|Posting:');
    for (const m of postedButNotPosting) {
      const lc = giveaway.linkedChannels.find((x) => x.channelId === m.channelId)!;
      console.log(`      → ${fmtChannel(m.channel)} role=${lc.role}`);
    }
  }

  console.log();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

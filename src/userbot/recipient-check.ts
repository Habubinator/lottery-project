import { giftQueue, giftQueueEvents } from './queue';
import type { AccountType } from './clients';
import { GIFT_QUEUE_FAST_JOB_PRIORITY } from './gift-worker-config';

/** Includes dialog scan + GetPaymentForm — allow more than entity-only checks. */
const USERBOT_QUEUE_TIMEOUT_MS = 60_000;

export type RecipientPrerequisiteResult = {
  needsChat: boolean;
  contactUsername: string | null;
  /** Queue timeout/worker error — block claim without implying user must message bot */
  recipientCheckUnavailable?: boolean;
};

/** Strip leading @ for API consumers and t.me links. */
export function normalizeTelegramUsername(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^@/, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Ready-to-open link for Telegram Mini App / WebApp buttons. */
export function buildTelegramContactUrl(
  username: string | null | undefined,
): string | null {
  const u = normalizeTelegramUsername(username);
  return u ? `https://t.me/${u}` : null;
}

async function getUserbotUsernameViaQueue(
  accountType: AccountType,
): Promise<string | null> {
  const job = await giftQueue.add(
    'get-username',
    { jobType: 'get-username', accountType },
    { delay: 0, priority: GIFT_QUEUE_FAST_JOB_PRIORITY },
  );

  try {
    const result = await job.waitUntilFinished(
      giftQueueEvents,
      USERBOT_QUEUE_TIMEOUT_MS,
    );
    return normalizeTelegramUsername(result.businessUsername);
  } catch {
    return null;
  }
}

/** Userbot @username from worker (API process has no gramjs clients). */
export async function resolveUserbotContactUsername(
  accountType: AccountType,
): Promise<string | null> {
  if (process.env.USERBOT_WORKER === 'true') {
    const { getUserbotUsername, isClientReady } = await import('./clients.js');
    if (isClientReady(accountType)) {
      return normalizeTelegramUsername(await getUserbotUsername(accountType));
    }
  }
  return getUserbotUsernameViaQueue(accountType);
}

export async function checkRecipientPrerequisitesViaQueue(
  accountType: AccountType,
  recipientTelegramId: string,
  options?: {
    telegramGiftId?: string | null;
    recipientUsername?: string | null;
  },
): Promise<RecipientPrerequisiteResult> {
  const job = await giftQueue.add(
    'check-recipient',
    {
      jobType: 'check-recipient',
      accountType,
      recipientTelegramId,
      recipientUsername: options?.recipientUsername ?? undefined,
      telegramGiftId: options?.telegramGiftId ?? undefined,
    },
    { delay: 0, priority: GIFT_QUEUE_FAST_JOB_PRIORITY },
  );

  try {
    const result = await job.waitUntilFinished(
      giftQueueEvents,
      USERBOT_QUEUE_TIMEOUT_MS,
    );
    return {
      needsChat: !!result.needsChat,
      contactUsername: normalizeTelegramUsername(result.businessUsername),
    };
  } catch (err) {
    console.error(
      `[Userbot] check-recipient queue failed account=${accountType} recipient=${recipientTelegramId}:`,
      err instanceof Error ? err.message : err,
    );
    const username = await getUserbotUsernameViaQueue(accountType);
    return {
      needsChat: false,
      contactUsername: username,
      recipientCheckUnavailable: true,
    };
  }
}

/** @deprecated Use checkRecipientPrerequisitesViaQueue */
export async function checkRecipientViaQueue(
  accountType: AccountType,
  recipientTelegramId: string,
): Promise<{ needsChat: boolean }> {
  const r = await checkRecipientPrerequisitesViaQueue(
    accountType,
    recipientTelegramId,
  );
  return { needsChat: r.needsChat };
}

import type { Currencies } from '@database';
import { giftQueue } from './queue';
import type { GiftJobData } from './queue';
import { computeGiftSendDelayMs, giftJobId } from './gift-send-delay';

export type EnqueueGiftDeliveryParams = {
  prizeId: number;
  jobType: 'send' | 'transfer';
  accountType: 'Standard' | 'Unique';
  recipientTelegramId: string;
  recipientUsername?: string | null;
  telegramGiftId?: string;
  ownedGiftId?: string;
  starCount?: number | null;
  staggerIndex?: number;
  claimerUserId?: number;
  commissionRefundAmount?: number;
  commissionCurrency?: Currencies;
};

async function countPendingGiftQueueJobs(): Promise<number> {
  const counts = await giftQueue.getJobCounts('wait', 'delayed', 'active');
  return (counts.wait ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
}

/** Drop a finished/queued job so the same prizeId can be enqueued again. */
export async function removeExistingGiftDeliveryJob(prizeId: number): Promise<void> {
  const id = giftJobId(prizeId);
  const existing = await giftQueue.getJob(id);
  if (!existing) return;

  const state = await existing.getState();
  if (state === 'active') {
    console.warn(
      `[Gifts] removeExistingGiftDeliveryJob skipped prizeId=${prizeId} jobId=${id} state=active`,
    );
    return;
  }

  await existing.remove();
  console.log(
    `[Gifts] removed previous queue job jobId=${id} prizeId=${prizeId} state=${state}`,
  );
}

export async function enqueueGiftDelivery(params: EnqueueGiftDeliveryParams): Promise<void> {
  const {
    prizeId,
    jobType,
    accountType,
    recipientTelegramId,
    recipientUsername,
    telegramGiftId,
    ownedGiftId,
    starCount,
    staggerIndex = 0,
    claimerUserId,
    commissionRefundAmount = 0,
    commissionCurrency,
  } = params;

  const id = giftJobId(prizeId);
  await removeExistingGiftDeliveryJob(prizeId);

  const pendingBefore = await countPendingGiftQueueJobs();
  const delay = computeGiftSendDelayMs(staggerIndex, pendingBefore > 0);

  const data: GiftJobData = {
    jobType,
    accountType,
    recipientTelegramId,
    recipientUsername: recipientUsername ?? undefined,
    telegramGiftId,
    ownedGiftId,
    starCount,
    prizeId,
    claimerUserId,
    commissionRefundAmount,
    commissionCurrency,
  };

  await giftQueue.add(jobType, data, {
    jobId: id,
    delay,
  });

  console.log(
    `[Gifts] enqueued jobId=${id} prizeId=${prizeId} jobType=${jobType} account=${accountType} delayMs=${delay} queuePendingBefore=${pendingBefore} recipient=${recipientTelegramId}`,
  );
}

/** True when a gift job is running — prize must not be rolled back (send may complete). */
export async function isGiftDeliveryJobActive(prizeId: number): Promise<boolean> {
  const job = await giftQueue.getJob(giftJobId(prizeId));
  if (!job) return false;
  const state = await job.getState();
  return state === 'active';
}

/** Remove a queued/delayed job so a rolled-back claim does not still send. */
export async function cancelGiftDeliveryJob(prizeId: number): Promise<void> {
  const job = await giftQueue.getJob(giftJobId(prizeId));
  if (!job) return;
  const state = await job.getState();
  if (state === 'active') {
    return;
  }
  await job.remove();
  console.log(
    `[Gifts] cancelGiftDeliveryJob removed jobId=${giftJobId(prizeId)} prizeId=${prizeId} state=${state}`,
  );
}

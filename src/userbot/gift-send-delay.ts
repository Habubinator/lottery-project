const MIN_MS = parseInt(process.env.GIFT_SEND_DELAY_MIN_MS ?? '20000', 10);
const MAX_MS = parseInt(process.env.GIFT_SEND_DELAY_MAX_MS ?? '60000', 10);
const STAGGER_MS = parseInt(process.env.GIFT_SEND_BATCH_STAGGER_MS ?? '45000', 10);

function randomBaseDelayMs(): number {
  const min = Math.min(MIN_MS, MAX_MS);
  const max = Math.max(MIN_MS, MAX_MS);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * BullMQ job delay: throttle sends without blocking the HTTP request.
 * No wait when this is the first gift (staggerIndex 0) and the queue is idle.
 */
export function computeGiftSendDelayMs(
  staggerIndex = 0,
  queueHasPendingWork = false,
): number {
  const stagger = staggerIndex * STAGGER_MS;
  if (staggerIndex === 0 && !queueHasPendingWork) {
    return 0;
  }
  if (staggerIndex === 0) {
    return randomBaseDelayMs();
  }
  return randomBaseDelayMs() + stagger;
}

export function giftJobId(prizeId: number): string {
  return `gift-prize-${prizeId}`;
}

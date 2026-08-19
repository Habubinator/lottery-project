/** BullMQ gift worker parallelism (shared gramjs clients — keep modest). */
export function getGiftWorkerConcurrency(): number {
  const raw = parseInt(process.env.GIFT_WORKER_CONCURRENCY ?? '2', 10);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(raw, 5);
}

/** check-recipient / get-username run before delayed send jobs (BullMQ: lower = higher). */
export const GIFT_QUEUE_FAST_JOB_PRIORITY = 1;

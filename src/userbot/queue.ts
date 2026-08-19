import { Queue, QueueEvents } from 'bullmq';
import type { OwnedGift } from '../bot/service/bot.service';

export interface GiftJobData {
  jobType:
    | 'send'
    | 'transfer'
    | 'list-gifts'
    | 'check-recipient'
    | 'get-username'
    | 'download-unique-sticker';
  accountType: 'Standard' | 'Unique';
  recipientTelegramId?: string;
  /** Claimer's @username from DB — used to resolve peer when id is not cached */
  recipientUsername?: string;
  telegramGiftId?: string;
  ownedGiftId?: string;
  stickerDocumentId?: string;
  stickerOutputFormat?: 'source' | 'webp';
  /** When true (default for source downloads), worker runs TGS→GIF after save. */
  buildStickerGif?: boolean;
  prizeId?: number;
  starCount?: number | null;
  claimerUserId?: number;
  commissionRefundAmount?: number;
  commissionCurrency?: import('@database').Currencies;
}

export interface GiftJobResult {
  success: boolean;
  nextTransferDate?: string;
  needsChat?: boolean;
  giftUnavailable?: boolean;
  balanceTooLow?: boolean;
  /** Unique userbot must pay Telegram Stars transfer fee (PAYMENT_REQUIRED) */
  transferPaymentRequired?: boolean;
  errorCode?: string;
  substituteTelegramGiftId?: string;
  businessUsername?: string;
  downloadedStickerPath?: string;
  downloadedStickerGifPath?: string;
  downloadedStickerGifPosterPath?: string;
  gifts?: OwnedGift[];
}

export const GIFT_QUEUE_NAME = 'gift-send';

const redisConnection = { url: process.env.REDIS_URL };

export const giftQueue = new Queue<GiftJobData, GiftJobResult>(GIFT_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const giftQueueEvents = new QueueEvents(GIFT_QUEUE_NAME, {
  connection: redisConnection,
});

import type { GiftJobData } from './queue';
import type { GiftJobResult } from './queue';
import {
  applyGiftDeliveryResult,
  applyGiftDeliveryJobFailed,
} from '@giveaways/services/prize.service';

export async function handleGiftJobCompleted(
  data: GiftJobData,
  result: GiftJobResult,
): Promise<void> {
  if (!data.prizeId) return;

  await applyGiftDeliveryResult(
    data.prizeId,
    {
      claimerUserId: data.claimerUserId,
      commissionRefundAmount: data.commissionRefundAmount,
      commissionCurrency: data.commissionCurrency,
      recipientTelegramId: data.recipientTelegramId,
    },
    {
      success: result.success,
      needsChat: result.needsChat,
      giftUnavailable: result.giftUnavailable,
      balanceTooLow: result.balanceTooLow,
      substituteTelegramGiftId: result.substituteTelegramGiftId,
      businessUsername: result.businessUsername,
      nextTransferDate: result.nextTransferDate
        ? new Date(result.nextTransferDate)
        : undefined,
      transferPaymentRequired: result.transferPaymentRequired,
      errorCode: result.errorCode,
    },
  );
}

export async function handleGiftJobFailed(data: GiftJobData): Promise<void> {
  if (!data.prizeId) return;
  await applyGiftDeliveryJobFailed(data.prizeId, {
    claimerUserId: data.claimerUserId,
    commissionRefundAmount: data.commissionRefundAmount,
    commissionCurrency: data.commissionCurrency,
    recipientTelegramId: data.recipientTelegramId,
  });
}

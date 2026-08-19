import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';

type UpdatePaymentCommissionSettingsInput = {
  nftWithdrawalBaseStars?: number;
  standardGiftTonMarkupPercent?: number;
  standardGiftStarsMarkupPercent?: number;
};

class PaymentCommissionSettingsService {
  async initialize() {
    const existing = await prisma.paymentCommissionSettings.findFirst();
    if (existing) return;

    await prisma.paymentCommissionSettings.create({
      data: {
        nftWithdrawalBaseStars: 35,
        standardGiftTonMarkupPercent: 5,
        standardGiftStarsMarkupPercent: 20,
      },
    });
  }

  async getSettings() {
    const record = await prisma.paymentCommissionSettings.findFirst();
    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'PaymentCommissionSettings not found',
      );
    }
    return record;
  }

  async updateSettings(data: UpdatePaymentCommissionSettingsInput) {
    if (
      data.nftWithdrawalBaseStars !== undefined &&
      (!Number.isFinite(data.nftWithdrawalBaseStars) ||
        data.nftWithdrawalBaseStars < 0)
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'NFT withdrawal base stars must be >= 0',
      );
    }

    if (
      data.standardGiftTonMarkupPercent !== undefined &&
      (!Number.isFinite(data.standardGiftTonMarkupPercent) ||
        data.standardGiftTonMarkupPercent < 0)
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Standard gift TON markup percent must be >= 0',
      );
    }

    if (
      data.standardGiftStarsMarkupPercent !== undefined &&
      (!Number.isFinite(data.standardGiftStarsMarkupPercent) ||
        data.standardGiftStarsMarkupPercent < 0)
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Standard gift Stars markup percent must be >= 0',
      );
    }

    const record = await prisma.paymentCommissionSettings.findFirst();
    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'PaymentCommissionSettings not found',
      );
    }

    return prisma.paymentCommissionSettings.update({
      where: { id: record.id },
      data: {
        ...(data.nftWithdrawalBaseStars !== undefined && {
          nftWithdrawalBaseStars: Math.floor(data.nftWithdrawalBaseStars),
        }),
        ...(data.standardGiftTonMarkupPercent !== undefined && {
          standardGiftTonMarkupPercent: data.standardGiftTonMarkupPercent,
        }),
        ...(data.standardGiftStarsMarkupPercent !== undefined && {
          standardGiftStarsMarkupPercent: data.standardGiftStarsMarkupPercent,
        }),
      },
    });
  }
}

export const paymentCommissionSettingsService =
  new PaymentCommissionSettingsService();


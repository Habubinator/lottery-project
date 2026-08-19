import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';

class GiftClaimCommissionService {
  async initialize() {
    try {
      const existing = await prisma.giftClaimCommission.findFirst();

      if (!existing) {
        await prisma.giftClaimCommission.create({
          data: { starsAmount: 25, tonAmount: 0.2 },
        });
        console.log('GiftClaimCommission record created with default values');
      } else {
        console.log('GiftClaimCommission record already exists');
      }
    } catch (error) {
      console.error('Error initializing GiftClaimCommission:', error);
      throw error;
    }
  }

  async getGiftClaimCommission() {
    const record = await prisma.giftClaimCommission.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'GiftClaimCommission not found',
      );
    }

    return record;
  }

  async updateGiftClaimCommission(data: {
    starsAmount?: number;
    tonAmount?: number;
  }) {
    if (data.starsAmount !== undefined && data.starsAmount < 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Stars amount must be >= 0',
      );
    }

    if (data.tonAmount !== undefined && data.tonAmount < 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'TON amount must be >= 0',
      );
    }

    const record = await prisma.giftClaimCommission.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'GiftClaimCommission not found',
      );
    }

    return prisma.giftClaimCommission.update({
      where: { id: record.id },
      data: {
        ...(data.starsAmount !== undefined && { starsAmount: data.starsAmount }),
        ...(data.tonAmount !== undefined && { tonAmount: data.tonAmount }),
      },
    });
  }
}

export const giftClaimCommissionService = new GiftClaimCommissionService();

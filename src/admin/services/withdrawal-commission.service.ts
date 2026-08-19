import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';

class WithdrawalCommissionService {
  /**
   * Initialize default WithdrawalCommission record if it doesn't exist
   * This method is called on application startup
   */
  async initialize() {
    try {
      const existing = await prisma.withdrawalCommission.findFirst();

      if (!existing) {
        await prisma.withdrawalCommission.create({
          data: {
            starsPercent: 0,
            tonPercent: 0,
          },
        });
        console.log(
          'WithdrawalCommission record created with default values (0% for both)',
        );
      } else {
        console.log('WithdrawalCommission record already exists');
      }
    } catch (error) {
      console.error('Error initializing WithdrawalCommission:', error);
      throw error;
    }
  }

  /**
   * Get the first WithdrawalCommission record
   */
  async getWithdrawalCommission() {
    const record = await prisma.withdrawalCommission.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'WithdrawalCommission not found',
      );
    }

    return record;
  }

  /**
   * Update WithdrawalCommission (admin only)
   */
  async updateWithdrawalCommission(data: {
    starsPercent?: number;
    tonPercent?: number;
  }) {
    // Validate input
    if (data.starsPercent !== undefined) {
      if (data.starsPercent < 0 || data.starsPercent > 100) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Stars commission must be between 0 and 100',
        );
      }
    }

    if (data.tonPercent !== undefined) {
      if (data.tonPercent < 0 || data.tonPercent > 100) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'TON commission must be between 0 and 100',
        );
      }
    }

    // Get first record
    const record = await prisma.withdrawalCommission.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'WithdrawalCommission not found',
      );
    }

    // Update record
    const updated = await prisma.withdrawalCommission.update({
      where: { id: record.id },
      data: {
        ...(data.starsPercent !== undefined && {
          starsPercent: data.starsPercent,
        }),
        ...(data.tonPercent !== undefined && { tonPercent: data.tonPercent }),
      },
    });

    return updated;
  }
}

export const withdrawalCommissionService = new WithdrawalCommissionService();

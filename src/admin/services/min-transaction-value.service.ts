import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';

class MinTransactionValueService {
  /**
   * Initialize default MinTransactionValue record if it doesn't exist
   * This method is called on application startup
   */
  async initialize() {
    try {
      const existing = await prisma.minTransactionValue.findFirst();

      if (!existing) {
        await prisma.minTransactionValue.create({
          data: {
            stars: 0,
            ton: 0,
          },
        });
        console.log('MinTransactionValue record created with default values');
      } else {
        console.log('MinTransactionValue record already exists');
      }
    } catch (error) {
      console.error('Error initializing MinTransactionValue:', error);
      throw error;
    }
  }

  /**
   * Get the first MinTransactionValue record
   */
  async getMinTransactionValue() {
    const record = await prisma.minTransactionValue.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'MinTransactionValue not found',
      );
    }

    return record;
  }

  /**
   * Update MinTransactionValue (admin only)
   */
  async updateMinTransactionValue(data: { stars?: number; ton?: number }) {
    // Validate input
    if (data.stars !== undefined && data.stars < 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Stars value cannot be negative',
      );
    }

    if (data.ton !== undefined && data.ton < 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'TON value cannot be negative',
      );
    }

    // Get first record
    const record = await prisma.minTransactionValue.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'MinTransactionValue not found',
      );
    }

    // Update record
    const updated = await prisma.minTransactionValue.update({
      where: { id: record.id },
      data: {
        ...(data.stars !== undefined && { stars: data.stars }),
        ...(data.ton !== undefined && { ton: data.ton }),
      },
    });

    return updated;
  }
}

export const minTransactionValueService = new MinTransactionValueService();

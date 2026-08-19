import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import { Decimal } from '@prisma/client/runtime/library';

class ExchangeRateService {
  /**
   * Initialize default ExchangeRate record if it doesn't exist
   * This method is called on application startup
   */
  async initialize() {
    try {
      const existing = await prisma.exchangeRate.findFirst();

      if (!existing) {
        await prisma.exchangeRate.create({
          data: {
            starsInput: new Decimal(100),
            tonOutput: new Decimal(0.6),
          },
        });
        console.log(
          'ExchangeRate record created with default values (1 Stars = 0 TON)',
        );
      } else {
        console.log('ExchangeRate record already exists');
      }
    } catch (error) {
      console.error('Error initializing ExchangeRate:', error);
      throw error;
    }
  }

  /**
   * Get the first ExchangeRate record
   */
  async getExchangeRate() {
    const record = await prisma.exchangeRate.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'ExchangeRate not found',
      );
    }

    return record;
  }

  /**
   * Update ExchangeRate (admin only)
   * @param starsInput - Amount of Stars (e.g., 100)
   * @param tonOutput - Amount of TON you get for starsInput (e.g., 1)
   */
  async updateExchangeRate(data: { starsInput?: number; tonOutput?: number }) {
    // Validate input
    if (data.starsInput !== undefined && data.starsInput <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Stars input must be greater than 0',
      );
    }

    if (data.tonOutput !== undefined && data.tonOutput < 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'TON output cannot be negative',
      );
    }

    // Get first record
    const record = await prisma.exchangeRate.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'ExchangeRate not found',
      );
    }

    // Update record
    const updated = await prisma.exchangeRate.update({
      where: { id: record.id },
      data: {
        ...(data.starsInput !== undefined && {
          starsInput: new Decimal(data.starsInput),
        }),
        ...(data.tonOutput !== undefined && {
          tonOutput: new Decimal(data.tonOutput),
        }),
      },
    });

    return updated;
  }

  /**
   * Convert Stars to TON based on current exchange rate
   * @param stars - Amount of Stars to convert
   * @returns Amount of TON
   */
  async convertStarsToTon(stars: number): Promise<number> {
    const rate = await this.getExchangeRate();

    // Prevent division by zero
    if (rate.starsInput.equals(0)) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Exchange rate is not configured properly (Stars input is 0)',
      );
    }

    // Formula: (stars / starsInput) * tonOutput
    const tonAmount = new Decimal(stars)
      .div(rate.starsInput)
      .mul(rate.tonOutput);

    return tonAmount.toNumber();
  }

  /**
   * Convert TON to Stars based on current exchange rate
   * @param ton - Amount of TON to convert
   * @returns Amount of Stars
   */
  async convertTonToStars(ton: number): Promise<number> {
    const rate = await this.getExchangeRate();

    // Prevent division by zero
    if (rate.tonOutput.equals(0)) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Exchange rate is not configured properly (TON output is 0)',
      );
    }

    // Formula: (ton / tonOutput) * starsInput
    const starsAmount = new Decimal(ton)
      .div(rate.tonOutput)
      .mul(rate.starsInput);

    return starsAmount.toNumber();
  }
}

export const exchangeRateService = new ExchangeRateService();

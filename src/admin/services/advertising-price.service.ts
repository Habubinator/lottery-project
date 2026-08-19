import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';

const DEFAULT_POSTING_STARS = 50;
const DEFAULT_NOTIFICATION_STARS = 25;

class AdvertisingPriceService {
  /**
   * Initialize default AdvertisingPrice record if it doesn't exist.
   * Called on application startup.
   */
  async initialize() {
    try {
      const existing = await prisma.advertisingPrice.findFirst();

      if (!existing) {
        await prisma.advertisingPrice.create({
          data: {
            postingStars: DEFAULT_POSTING_STARS,
            notificationStars: DEFAULT_NOTIFICATION_STARS,
          },
        });
        console.log(
          `AdvertisingPrice record created with default values (posting=${DEFAULT_POSTING_STARS}, notification=${DEFAULT_NOTIFICATION_STARS})`,
        );
      } else {
        console.log('AdvertisingPrice record already exists');
      }
    } catch (error) {
      console.error('Error initializing AdvertisingPrice:', error);
      throw error;
    }
  }

  /**
   * Get the advertising price record.
   */
  async getAdvertisingPrice() {
    const record = await prisma.advertisingPrice.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'AdvertisingPrice not found',
      );
    }

    return record;
  }

  /**
   * Returns { postingStars, notificationStars } with fallback to hardcoded defaults
   * if the DB record is missing (backward compatibility).
   */
  async getPrices(): Promise<{
    postingStars: number;
    notificationStars: number;
  }> {
    const record = await prisma.advertisingPrice.findFirst();
    return {
      postingStars: record?.postingStars ?? DEFAULT_POSTING_STARS,
      notificationStars: record?.notificationStars ?? DEFAULT_NOTIFICATION_STARS,
    };
  }

  /**
   * Update advertising price (admin only).
   */
  async updateAdvertisingPrice(data: {
    postingStars?: number;
    notificationStars?: number;
  }) {
    if (data.postingStars !== undefined && data.postingStars < 1) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Posting Stars price must be at least 1',
      );
    }

    if (data.notificationStars !== undefined && data.notificationStars < 1) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Notification Stars price must be at least 1',
      );
    }

    const record = await prisma.advertisingPrice.findFirst();

    if (!record) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'AdvertisingPrice not found',
      );
    }

    const updated = await prisma.advertisingPrice.update({
      where: { id: record.id },
      data: {
        ...(data.postingStars !== undefined && {
          postingStars: data.postingStars,
        }),
        ...(data.notificationStars !== undefined && {
          notificationStars: data.notificationStars,
        }),
      },
    });

    return updated;
  }
}

export const advertisingPriceService = new AdvertisingPriceService();

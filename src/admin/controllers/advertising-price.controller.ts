import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { advertisingPriceService } from '../services/advertising-price.service';
import { AuthorizedRequest } from '@auth/types';

class AdvertisingPriceController {
  async getAdvertisingPrice(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const config = await advertisingPriceService.getAdvertisingPrice();

      res.status(HttpCodes.Ok).json({ success: true, data: config });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async updateAdvertisingPrice(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { postingStars, notificationStars } = req.body as {
        postingStars?: number;
        notificationStars?: number;
      };

      const updated = await advertisingPriceService.updateAdvertisingPrice({
        postingStars,
        notificationStars,
      });

      res.status(HttpCodes.Ok).json({ success: true, data: updated });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const advertisingPriceController = new AdvertisingPriceController();

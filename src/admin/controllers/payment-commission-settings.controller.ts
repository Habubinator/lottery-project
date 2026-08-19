import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { AuthorizedRequest } from '@auth/types';
import { paymentCommissionSettingsService } from '../services/payment-commission-settings.service';

class PaymentCommissionSettingsController {
  async getSettings(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);
      const data = await paymentCommissionSettingsService.getSettings();
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async updateSettings(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);
      const {
        nftWithdrawalBaseStars,
        standardGiftTonMarkupPercent,
        standardGiftStarsMarkupPercent,
      } = req.body as {
        nftWithdrawalBaseStars?: number;
        standardGiftTonMarkupPercent?: number;
        standardGiftStarsMarkupPercent?: number;
      };

      const data = await paymentCommissionSettingsService.updateSettings({
        nftWithdrawalBaseStars,
        standardGiftTonMarkupPercent,
        standardGiftStarsMarkupPercent,
      });
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const paymentCommissionSettingsController =
  new PaymentCommissionSettingsController();


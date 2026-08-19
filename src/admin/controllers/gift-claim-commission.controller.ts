import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { giftClaimCommissionService } from '../services/gift-claim-commission.service';
import { AuthorizedRequest } from '@auth/types';

class GiftClaimCommissionController {
  async getGiftClaimCommission(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);
      const config = await giftClaimCommissionService.getGiftClaimCommission();
      res.status(HttpCodes.Ok).json({ success: true, data: config });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async updateGiftClaimCommission(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { starsAmount, tonAmount } = req.body as {
        starsAmount?: number;
        tonAmount?: number;
      };

      const updated =
        await giftClaimCommissionService.updateGiftClaimCommission({
          starsAmount,
          tonAmount,
        });

      res.status(HttpCodes.Ok).json({ success: true, data: updated });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const giftClaimCommissionController =
  new GiftClaimCommissionController();

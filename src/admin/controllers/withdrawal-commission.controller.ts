import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { withdrawalCommissionService } from '../services/withdrawal-commission.service';
import { AuthorizedRequest } from '@auth/types';

class WithdrawalCommissionController {
  /**
   * Get WithdrawalCommission configuration
   */
  async getWithdrawalCommission(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const config =
        await withdrawalCommissionService.getWithdrawalCommission();

      res.status(HttpCodes.Ok).json({ success: true, data: config });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Update WithdrawalCommission configuration (admin only)
   */
  async updateWithdrawalCommission(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { starsPercent, tonPercent } = req.body as {
        starsPercent?: number;
        tonPercent?: number;
      };

      const updated =
        await withdrawalCommissionService.updateWithdrawalCommission({
          starsPercent,
          tonPercent,
        });

      res.status(HttpCodes.Ok).json({ success: true, data: updated });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const withdrawalCommissionController =
  new WithdrawalCommissionController();

import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { AuthorizedRequest } from '@auth/types';
import { starsWithdrawalService } from '../services/stars-withdrawal.service';

class StarsWithdrawalController {
  async preview(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const starsAmount = parseFloat(String(req.query.starsAmount ?? ''));
      const data = await starsWithdrawalService.preview(
        req.user!.id,
        starsAmount,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async submit(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const { starsAmount, notes } = req.body as {
        starsAmount: number;
        notes?: string;
      };

      const data = await starsWithdrawalService.submit(
        req.user!.id,
        starsAmount,
        notes,
      );

      res.status(HttpCodes.Created).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const starsWithdrawalController = new StarsWithdrawalController();

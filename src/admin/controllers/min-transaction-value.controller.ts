import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { minTransactionValueService } from '../services/min-transaction-value.service';
import { AuthorizedRequest } from '@auth/types';

class MinTransactionValueController {
  /**
   * Get MinTransactionValue configuration
   */
  async getMinTransactionValue(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const config = await minTransactionValueService.getMinTransactionValue();

      res.status(HttpCodes.Ok).json({ success: true, data: config });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Update MinTransactionValue configuration (admin only)
   */
  async updateMinTransactionValue(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { stars, ton } = req.body as {
        stars?: number;
        ton?: number;
      };

      const updated = await minTransactionValueService.updateMinTransactionValue(
        { stars, ton },
      );

      res.status(HttpCodes.Ok).json({ success: true, data: updated });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const minTransactionValueController =
  new MinTransactionValueController();

import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { exchangeRateService } from '../services/exchange-rate.service';
import { AuthorizedRequest } from '@auth/types';

class ExchangeRateController {
  /**
   * Get ExchangeRate configuration
   */
  async getExchangeRate(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const config = await exchangeRateService.getExchangeRate();

      res.status(HttpCodes.Ok).json({ success: true, data: config });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Update ExchangeRate configuration (admin only)
   */
  async updateExchangeRate(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { starsInput, tonOutput } = req.body as {
        starsInput?: number;
        tonOutput?: number;
      };

      const updated = await exchangeRateService.updateExchangeRate({
        starsInput,
        tonOutput,
      });

      res.status(HttpCodes.Ok).json({ success: true, data: updated });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const exchangeRateController = new ExchangeRateController();

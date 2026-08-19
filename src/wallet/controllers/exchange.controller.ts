import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { exchangeService } from '../services/exchange.service';
import { AuthorizedRequest } from '@auth/types';
import { Currencies } from '@database';

class ExchangeController {
  /**
   * Exchange currency (Stars ↔ TON)
   */
  async exchangeCurrency(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { fromCurrency, toCurrency, amount } = req.body as {
        fromCurrency: Currencies;
        toCurrency: Currencies;
        amount: number;
      };

      const result = await exchangeService.exchangeCurrency(req.user.id, {
        fromCurrency,
        toCurrency,
        amount,
      });

      res.status(HttpCodes.Ok).json({ success: true, data: result });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Preview exchange rate without executing
   */
  async previewExchange(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { fromCurrency, toCurrency, amount } = req.query as {
        fromCurrency: Currencies;
        toCurrency: Currencies;
        amount: string;
      };

      const result = await exchangeService.previewExchange({
        fromCurrency,
        toCurrency,
        amount: parseFloat(amount),
      });

      res.status(HttpCodes.Ok).json({ success: true, data: result });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const exchangeController = new ExchangeController();

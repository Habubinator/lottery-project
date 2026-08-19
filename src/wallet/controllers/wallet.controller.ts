import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { walletService } from '../services';
import { PaymentLinkParams } from '../types';
import { AuthorizedRequest } from '@auth/types';
import { Currencies } from '@database';

class WalletController {
  /**
   * Get user's wallet information
   */
  async getWallet(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const wallet = await walletService.getUserWallet(req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data: wallet });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Get wallet statistics
   */
  async getWalletStats(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const stats = await walletService.getWalletStats(req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data: stats });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { page = '1', pageSize = '20' } = req.query as {
        page?: string;
        pageSize?: string;
      };

      const history = await walletService.getTransactionHistory(
        req.user.id,
        parseInt(page),
        parseInt(pageSize),
      );

      res.status(HttpCodes.Ok).json({ success: true, data: history });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Get all transaction history (admin)
   */
  async getAllTransactionHistory(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const {
        page = '1',
        pageSize = '20',
        currency,
        isExchange,
        transactionId,
      } = req.query as {
        page?: string;
        pageSize?: string;
        currency?: Currencies;
        isExchange?: string;
        transactionId?: string;
      };

      const history = await walletService.getAllTransactionHistory(
        parseInt(page),
        parseInt(pageSize),
        currency,
        isExchange === 'true' ? true : isExchange === 'false' ? false : undefined,
        transactionId,
      );

      res.status(HttpCodes.Ok).json({ success: true, data: history });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Create deposit payment link
   */
  async createDepositLink(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { amount, currency, description } = req.body as {
        amount: number;
        currency: Currencies;
        description?: string;
      };

      const params: PaymentLinkParams = {
        userId: req.user.id,
        amount,
        currency,
        description,
      };

      const paymentLink = await walletService.createDepositPaymentLink(params);

      if (!paymentLink) {
        res.status(HttpCodes.BadRequest).json({
          success: false,
          message: 'Failed to create payment link',
        });
        return;
      }

      res.status(HttpCodes.Ok).json({
        success: true,
        data: { paymentLink },
      });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Get user's current holding status
   */
  async getHoldingStatus(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const holdingStatus = await walletService.getUserHoldingStatus(
        req.user.id,
      );

      res.status(HttpCodes.Ok).json({
        success: true,
        data: holdingStatus,
      });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const walletController = new WalletController();

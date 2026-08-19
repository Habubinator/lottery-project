import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { withdrawalService } from '../services';
import { AuthorizedRequest } from '@auth/types';
import { Currencies, WithdrawalStatus } from '@database';

interface CreateWithdrawalRequestDto {
  currency: Currencies;
  amount: number;
  notes?: string;
}

interface AdminWithdrawalActionDto {
  photos?: string[];
  notes?: string;
}

class WithdrawalController {
  /**
   * Create withdrawal request
   */
  async createWithdrawal(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { currency, amount, notes } =
        req.body as CreateWithdrawalRequestDto;

      const withdrawal = await withdrawalService.createWithdrawal(req.user.id, {
        currency,
        amount,
        notes,
      });

      res.status(HttpCodes.Created).json({ success: true, data: withdrawal });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Get user's withdrawal requests
   */
  async getUserWithdrawals(
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

      const withdrawals = await withdrawalService.getUserWithdrawals(
        req.user.id,
        { page: parseInt(page), pageSize: parseInt(pageSize) },
      );

      res.status(HttpCodes.Ok).json({ success: true, data: withdrawals });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Get all withdrawal requests (Admin only)
   */
  async getAllWithdrawals(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const {
        page = '1',
        pageSize = '20',
        status,
      } = req.query as {
        page?: string;
        pageSize?: string;
        status?: WithdrawalStatus;
      };

      const withdrawals = await withdrawalService.getAllWithdrawals(status, {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      });

      res.status(HttpCodes.Ok).json({ success: true, data: withdrawals });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Get specific withdrawal request
   */
  async getWithdrawal(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { withdrawalId } = req.params as { withdrawalId: string };

      const withdrawal = await withdrawalService.getWithdrawal(
        parseInt(withdrawalId),
      );

      res.status(HttpCodes.Ok).json({ success: true, data: withdrawal });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Approve withdrawal request (Admin only)
   */
  async approveWithdrawal(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { withdrawalId } = req.params as { withdrawalId: string };
      const { notes } = req.body;
      const files = req.files as Express.Multer.File[];

      const photos: string[] = [];
      if (files && files.length > 0) {
        files.forEach((file) => {
          const photoUrl = `${process.env.CLIENT_URL}/static/withdrawal/${encodeURIComponent(file.filename)}`;
          photos.push(photoUrl);
        });
      }

      const adminData: AdminWithdrawalActionDto = {
        photos,
        notes,
      };

      const withdrawal = await withdrawalService.approveWithdrawal(
        parseInt(withdrawalId),
        adminData,
      );

      res.status(HttpCodes.Ok).json({ success: true, data: withdrawal });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  /**
   * Reject withdrawal request (Admin only)
   */
  async rejectWithdrawal(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { withdrawalId } = req.params as { withdrawalId: string };
      const { notes } = req.body;
      const files = req.files as Express.Multer.File[];

      // Process uploaded photos
      const photos: string[] = [];
      if (files && files.length > 0) {
        files.forEach((file) => {
          const photoUrl = `${process.env.CLIENT_URL}/static/withdrawal/${encodeURIComponent(file.filename)}`;
          photos.push(photoUrl);
        });
      }

      const adminData: AdminWithdrawalActionDto = {
        photos,
        notes,
      };

      const withdrawal = await withdrawalService.rejectWithdrawal(
        parseInt(withdrawalId),
        adminData,
      );

      res.status(HttpCodes.Ok).json({ success: true, data: withdrawal });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const withdrawalController = new WithdrawalController();

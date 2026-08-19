import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import type { AuthorizedRequest } from '@auth/types';
import { userbotAdminService } from '../services/userbot-admin.service';

class UserbotAdminController {
  async updatePhone(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const { accountType, phoneNumber } = req.body as { accountType: 'Standard' | 'Unique'; phoneNumber: string };
      const data = await userbotAdminService.updatePhone(accountType, phoneNumber);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      console.error(e);
      next(e);
    }
  }

  async getStatus(_req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const data = await userbotAdminService.getStatus();
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      console.error(e);
      next(e);
    }
  }

  async startAuth(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const { accountType } = req.body as { accountType: 'Standard' | 'Unique' };
      await userbotAdminService.startAuth(accountType);
      res.status(HttpCodes.Ok).json({ success: true, message: 'OTP sent to account phone' });
    } catch (e) {
      console.error(e);
      next(e);
    }
  }

  async confirmCode(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const { accountType, code } = req.body as { accountType: 'Standard' | 'Unique'; code: string };
      const result = await userbotAdminService.confirmCode(accountType, code);
      res.status(HttpCodes.Ok).json({ success: !result.requires2FA, ...result });
    } catch (e) {
      console.error(e);
      next(e);
    }
  }

  async submit2FA(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const { accountType, password } = req.body as { accountType: 'Standard' | 'Unique'; password: string };
      await userbotAdminService.submit2FA(accountType, password);
      res.status(HttpCodes.Ok).json({ success: true });
    } catch (e) {
      console.error(e);
      next(e);
    }
  }
}

export const userbotAdminController = new UserbotAdminController();

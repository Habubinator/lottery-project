import {
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_OPTIONS,
} from '@common/constants';
import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Request, Response } from 'express';
import { authService } from '../services';
import { AuthorizedRequest } from '@auth/types';

class AuthController {
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, refreshToken } = await authService.refresh(req);
      validateRequest(req);

      res.cookie(
        REFRESH_TOKEN_COOKIE,
        refreshToken,
        REFRESH_TOKEN_COOKIE_OPTIONS,
      );

      res.status(HttpCodes.Ok).json({ success: true, data: { accessToken } });
    } catch (e: unknown) {
      next(e);
    }
  }

  async validateTelegramSession(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const data = authService.validateTelegramHash(req.body.initData);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }

  async validateAndProceed(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const { data } = await authService.validateAndProceed(req);

      res.cookie(
        REFRESH_TOKEN_COOKIE,
        data.refreshToken,
        REFRESH_TOKEN_COOKIE_OPTIONS,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }

  async me(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const data = await authService.me(req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }
}

export const authController = new AuthController();

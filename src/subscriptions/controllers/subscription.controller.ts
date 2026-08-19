import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { subscriptionService } from '../services';
import { AuthorizedRequest } from '@auth/types';

class SubscriptionController {
  async getAllTariffs(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const data = await subscriptionService.getAllTariffs();

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }

  async getUserSubscription(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const data = await subscriptionService.getUserSubscription(req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }
}

export const subscriptionController = new SubscriptionController();

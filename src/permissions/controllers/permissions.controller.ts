import { HttpCodes } from '@common/enums';
import { permissionsService } from '../services';
import type { NextFunction, Request, Response } from 'express';
import { validateRequest } from '@common/utils';

class PermissionsController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const data = await permissionsService.getAll(req);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }
}

export const permissionsController = new PermissionsController();

import type { Request, Response } from 'express';
import { generateToken } from '../middlewares';
import { HttpCodes } from '@common/enums';

class CsrfController {
  createToken(req: Request, res: Response) {
    const csrfToken = generateToken(req, res);
    res.status(HttpCodes.Ok).json({ success: true, data: { csrfToken } });
  }
}

export const csrfController = new CsrfController();

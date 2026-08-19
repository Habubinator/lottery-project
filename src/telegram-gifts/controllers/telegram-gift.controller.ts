import { Response, NextFunction } from 'express';
import { telegramGiftService } from '../services/telegram-gift.service';
import { HttpCodes } from '../../common/enums/http-codes.enum';
import { AuthorizedRequest } from '../../auth/types/auth.type';

class TelegramGiftController {
  async getAll(_req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const gifts = await telegramGiftService.getAll();

      res.status(HttpCodes.Ok).json({
        success: true,
        data: gifts,
      });
    } catch (e: unknown) {
      next(e);
    }
  }
}

export const telegramGiftController = new TelegramGiftController();

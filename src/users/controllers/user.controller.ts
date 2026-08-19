import { HttpCodes, ErrorCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import { HttpException } from '@common/exceptions';
import type { NextFunction, Request, Response } from 'express';
import { userService } from '../services';
import { AuthorizedRequest } from '@auth/types';
import { PaginateArgs, PaginateDto } from '@common/dto';
import { GetUserGiveawaysArgs } from '../types';
import type { NotificationSetting, Currencies } from '@database';
import { sendMessage } from '@bot/service';

class UserController {
  async search(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const q = (req.query.q as string) || '';
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const data = await userService.searchUsers(q, page, pageSize);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const dto = new PaginateDto({
        ...req.query,
        ...req.params,
      } as unknown as PaginateArgs);

      const data = await userService.getAll(dto);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const data = await userService.getOne(+req.params.userId);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async setLang(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const { lang } = req.body as { lang: 'en' | 'uk' | 'ru' };

      const data = await userService.setLang(req.user.id, lang);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getUserGiveaways(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const paginationDto = new PaginateDto({
        ...req.query,
        ...req.params,
      } as unknown as GetUserGiveawaysArgs);

      const userId = +req.params.userId;
      const isActive = req.query.isActive === 'true';
      const isPlanned =
        req.query.isPlanned === 'true'
          ? true
          : req.query.isPlanned === 'false'
            ? false
            : undefined;

      const data = await userService.getUserGiveaways(
        userId,
        isActive,
        paginationDto,
        isPlanned,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getUserCreatedGiveaways(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const paginationDto = new PaginateDto({
        ...req.query,
        ...req.params,
      } as unknown as GetUserGiveawaysArgs);

      const userId = +req.params.userId;
      const isActive = req.query.isActive === 'true';
      const isPlanned =
        req.query.isPlanned === 'true'
          ? true
          : req.query.isPlanned === 'false'
            ? false
            : undefined;

      const data = await userService.getUserCreatedGiveaways(
        userId,
        isActive,
        paginationDto,
        isPlanned,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getUserPlannedGiveaways(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const paginationDto = new PaginateDto({
        ...req.query,
        ...req.params,
      } as unknown as GetUserGiveawaysArgs);

      const userId = +req.params.userId;

      const data = await userService.getUserPlannedGiveaways(
        userId,
        paginationDto,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async paySubscription(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { tariffId, paymentCurrency } = req.body as {
        tariffId: number;
        paymentCurrency?: Currencies;
      };

      const data = await userService.paySubscription(
        tariffId,
        req.user.id,
        paymentCurrency,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });

      // Send bot confirmation message to user (fire-and-forget)
      if (data.userTelegramId) {
        const expiresDate = data.subscriptionExpiresAt
          ? new Date(data.subscriptionExpiresAt).toLocaleDateString('en-GB')
          : '—';
        const currencySymbol = data.paidCurrency === 'Stars' ? '⭐' : 'TON';
        const newStars = data.newBalance.starsBalance;
        const newTon = data.newBalance.tonBalance;
        const msg =
          `✅ Subscription activated!\n` +
          `📦 Plan: ${data.tariffLabel}\n` +
          `💸 Paid: ${data.paidAmount} ${currencySymbol}\n` +
          `📅 Active until: ${expiresDate}\n` +
          `💳 Balance: ${newStars} ⭐ | ${newTon} TON`;
        sendMessage(data.userTelegramId, msg).catch(() => {});
      }
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async updateTonWallet(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { tonAddress } = req.body as { tonAddress: string };

      const data = await userService.updateTonWallet(req.user.id, tonAddress);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getMyChannels(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const paginationDto = new PaginateDto({
        ...req.query,
        ...req.params,
      } as unknown as GetUserGiveawaysArgs);

      const userId = +req.params.userId;

      const data = await userService.getMyChannels(userId, paginationDto);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async syncChannel(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const channelId = BigInt(req.params.channelId);
      const data = await userService.syncChannel(channelId, req.user.id);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async searchChannels(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const { q, page = 1, pageSize = 20 } = req.query as {
        q?: string;
        page?: number;
        pageSize?: number;
      };

      if (!q) {
        const data = await userService.getRecentlyAddedChannels(req.user.id, 10);
        res.status(HttpCodes.Ok).json({ success: true, data });
        return;
      }

      const data = await userService.searchChannels(
        q as string,
        Number(page),
        Number(pageSize),
        req.user.id,  // Pass current user ID to exclude their channels
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getChannelSearchHistory(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const data = await userService.getChannelSearchHistory(req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }


  async getLastAddedChannel(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const userId = +req.params.userId;

      const data = await userService.getLastAddedChannel(userId);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async setNotificationSetting(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { setting } = req.body as { setting: NotificationSetting };

      const data = await userService.setNotificationSetting(
        req.user.id,
        setting,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getNotificationChannels(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const data = await userService.getNotificationChannels(req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async addNotificationChannel(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { channelUsername } = req.body as { channelUsername: string };

      const data = await userService.addNotificationChannel(
        req.user.id,
        channelUsername,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async addMultipleNotificationChannels(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { channelIds } = req.body as { channelIds: number[] };

      if (!Array.isArray(channelIds) || channelIds.length === 0) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'channelIds must be a non-empty array',
        );
      }

      const data = await userService.addMultipleNotificationChannels(
        req.user.id,
        channelIds.map((id) => BigInt(id)),
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async deleteNotificationChannel(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { channelId } = req.params as { channelId: string };

      const data = await userService.deleteNotificationChannel(
        req.user.id,
        +channelId,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getOutcomingTransactions(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const data = await userService.getOutcomingTransactions();

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async requestDescription(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const body = (req.body ?? {}) as {
        participationButtonText?: string;
        participationButtonStyle?: string;
        showParticipationCount?: boolean;
        showParticipationMaxCount?: boolean;
        participiationType?: string;
        language?: string;
        completionType?: string;
        maxParticipants?: number;
      };
      await userService.requestDescription(req.user.id, body);
      res.status(HttpCodes.Ok).json({ success: true });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async pollDescription(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const data = await userService.pollDescriptionRequest(req.user.id);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async cancelDescription(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      await userService.cancelDescriptionRequest(req.user.id);
      res.status(HttpCodes.Ok).json({ success: true });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async uploadTempBanners(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const files = req.files as Express.Multer.File[];
      const urls = await userService.saveTempBanners(req.user.id, files);
      res.status(HttpCodes.Ok).json({ success: true, data: { urls } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async deleteTempBanners(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      await userService.deleteTempBanners(req.user.id);
      res.status(HttpCodes.Ok).json({ success: true });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async removeTempBanner(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const { url } = req.body;
      await userService.removeTempBanner(req.user.id, url);
      res.status(HttpCodes.Ok).json({ success: true });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async abortCreation(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      await userService.abortCreation(req.user.id);
      res.status(HttpCodes.Ok).json({ success: true });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const userController = new UserController();

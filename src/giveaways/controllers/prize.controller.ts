import { HttpCodes, ErrorCodes } from '@common/enums';
import { HttpException } from '@common/exceptions';
import { getUserLanguage } from '@bot/service/localization';
import type { NextFunction, Response } from 'express';
import { AuthorizedRequest } from '@auth/types';
import { prizeService } from '../services';
import { Currencies, prisma } from '@database';

class PrizeController {
  // GET /prizes/available — Available gifts deposited by this user
  async getAvailable(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const data = await prizeService.getAvailablePrizes(userId);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // GET /prizes/my — All user prizes (Available + Linked)
  async getMy(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const rows = await prizeService.getUserPrizes(userId);
      const data = rows.map((p) => prizeService.mapPrizeForUserApi(p));
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // GET /prizes/claim-prerequisites?prizeIds=1&prizeIds=2
  async getClaimPrerequisites(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const raw = req.query.prizeIds;
      const prizeIds = (Array.isArray(raw) ? raw : raw != null ? [raw] : [])
        .map(Number)
        .filter((n) => !isNaN(n));

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true, username: true },
      });
      if (!user) throw HttpException.Unauthorized(ErrorCodes.Auth);

      const data = await prizeService.getClaimPrerequisites(
        prizeIds,
        userId,
        user.telegramId,
        user.username,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // GET /prizes/pay-commission — fee quote before POST /prizes/pay
  async getPayCommission(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const rawNft = req.query.nftPrizeIds;
      const nftPrizeIds = (Array.isArray(rawNft) ? rawNft : rawNft != null ? [rawNft] : [])
        .map(Number)
        .filter((n) => !isNaN(n));

      let standardGifts: { telegramGiftId: string; count: number }[] = [];
      if (req.query.standardGifts) {
        try {
          const parsed = JSON.parse(String(req.query.standardGifts));
          if (Array.isArray(parsed)) {
            standardGifts = parsed;
          }
        } catch {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            'standardGifts must be a JSON array',
          );
        }
      }

      const data = await prizeService.getPayCommission(
        userId,
        nftPrizeIds,
        standardGifts,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // GET /prizes/claim-commission?prizeIds[]=1&prizeIds[]=2
  async getClaimCommission(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const raw = req.query.prizeIds;
      const prizeIds = (Array.isArray(raw) ? raw : [raw])
        .map(Number)
        .filter((n) => !isNaN(n));

      const data = await prizeService.getClaimCommission(prizeIds);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // POST /prizes/claim — bulk claim with commission
  async claim(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { prizeIds, currency } = req.body as {
        prizeIds: number[];
        currency: Currencies;
      };

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true, username: true, picked_language: true, language_code: true },
      });
      if (!user) throw HttpException.Unauthorized(ErrorCodes.Auth);

      const data = await prizeService.claimPrizes(
        prizeIds,
        userId,
        user.telegramId,
        currency,
        user.username,
        getUserLanguage(user),
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // POST /prizes/accept — Stage 1: secure a won prize into caller's account
  async accept(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { prizeId } = req.body as { prizeId: number };
      const data = await prizeService.acceptWonPrize(prizeId, userId);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // POST /prizes/transfer — reassign owned prizes to another app user
  async transfer(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { prizeIds, recipientUserId } = req.body as {
        prizeIds: number[];
        recipientUserId: number;
      };

      const data = await prizeService.transferPrizesToUser(prizeIds, userId, recipientUserId);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // GET /giveaways/:giveawayId/prizes — public list of prizes for a giveaway
  async getGiveawayPrizes(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const { giveawayId } = req.params;
      const data = await prizeService.getGiveawayPrizes(giveawayId);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // POST /giveaways/:giveawayId/prizes — link prize to giveaway (NFT or StandardGift)
  async linkPrize(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { giveawayId } = req.params;
      const { prizeId, ownedGiftId, winPlace, telegramGiftId, count, winPlaceStart } = req.body as {
        prizeId?: number;
        ownedGiftId?: string;
        winPlace?: number | null;
        telegramGiftId?: string;
        count?: number;
        winPlaceStart?: number | null;
      };

      if (telegramGiftId) {
        const data = await prizeService.addStandardGifts(
          giveawayId,
          userId,
          telegramGiftId,
          count ?? 1,
          winPlaceStart ?? null,
        );
        return res.status(HttpCodes.Created).json({ success: true, data });
      }

      const idToUse = prizeId ?? undefined;
      if (!idToUse && !ownedGiftId) {
        return res.status(400).json({ success: false, message: 'prizeId or ownedGiftId required' });
      }

      let resolvedPrizeId = idToUse;
      if (!resolvedPrizeId && ownedGiftId) {
        const prize = await prizeService.getPrizeByOwnedGiftId(ownedGiftId, userId);
        resolvedPrizeId = prize?.id;
      }

      if (!resolvedPrizeId) {
        return res.status(404).json({ success: false, message: 'Prize not found' });
      }

      const data = await prizeService.assignPrizeToGiveaway(
        resolvedPrizeId,
        giveawayId,
        userId,
        winPlace,
      );
      res.status(HttpCodes.Created).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // POST /giveaways/:giveawayId/prizes/:prizeId/refund — owner refund after 24h deadline
  async refundPrize(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { prizeId } = req.params;
      const data = await prizeService.refundPrize(Number(prizeId), userId);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // PATCH /giveaways/:giveawayId/prizes/:prizeId — update winPlace
  async updateWinPlace(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { giveawayId, prizeId } = req.params;
      const { winPlace } = req.body as { winPlace: number | null };

      const data = await prizeService.updatePrizeWinPlace(
        Number(prizeId),
        giveawayId,
        userId,
        winPlace,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // DELETE /giveaways/:giveawayId/prizes/:prizeId — unlink prize
  async unlinkPrize(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { giveawayId, prizeId } = req.params;

      const data = await prizeService.unassignPrize(
        Number(prizeId),
        giveawayId,
        userId,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // POST /prizes/pay — pre-pay for gifts before linking to any giveaway
  async payForPrizes(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const {
        nftPrizeIds = [],
        standardGifts = [],
        currency,
        paymentSource = 'wallet',
      } = req.body as {
        nftPrizeIds?: number[];
        standardGifts?: { telegramGiftId: string; count: number }[];
        currency: Currencies;
        paymentSource?: 'wallet' | 'telegram';
      };
      const data = await prizeService.payForPrizes(
        userId,
        nftPrizeIds,
        standardGifts,
        currency,
        paymentSource,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  // POST /giveaways/:giveawayId/pay-transfer-fees — pay gift transfer fees from balance
  async payTransferFees(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { giveawayId } = req.params;
      const { currency } = req.body as { currency: Currencies };

      const data = await prizeService.payGiftTransferFees(
        giveawayId,
        userId,
        currency,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }
}

export const prizeController = new PrizeController();

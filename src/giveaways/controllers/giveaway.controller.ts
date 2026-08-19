import { HttpCodes, ErrorCodes } from '@common/enums';
import { HttpException } from '@common/exceptions';
import { validateRequest, getClientIP } from '@common/utils';
import type { NextFunction, Request, Response } from 'express';
import { giveawayService } from '../services';
import { AuthorizedRequest } from '@auth/types';
import {
  GiveawaySearchDto,
  CreateGiveawayDto,
  UpdateGiveawayDto,
  GiveawaySearchArgs,
  CreateGiveawayArgs,
  UpdateGiveawayArgs,
} from '../dto';
import { lookup } from 'geoip-lite';
import { PaginateDto } from '@common/dto/paginate.dto';
import { sponsorLinkService } from '@sponsors';
import { getBusinessUsername } from '@bot/service/bot.service';

class GiveawayController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const userIp = getClientIP(req);

      const dto = new GiveawaySearchDto({
        ...req.query,
        ...req.params,
        userCountry: lookup(userIp)?.country || '',
      } as unknown as GiveawaySearchArgs);

      const userId = (req as any).user?.id;

      const data = await giveawayService.getAll(dto, userId);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;

      const userId = (req as any).user?.id;

      const data = await giveawayService.getOne(giveawayId, userId);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async createNew(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      // Process uploaded files array
      const banner: string[] = [];
      if (req.files && Array.isArray(req.files)) {
        banner.push(...req.files.map(file => `/static/giveaways/${file.filename}`));
      }

      console.log('[createNew] raw linkedChannelIds:', JSON.stringify(req.body.linkedChannelIds));
      const dto = new CreateGiveawayDto({
        ...(req.body as CreateGiveawayArgs),
        banner,
      });
      console.log('[createNew] resolved linkedChannels:', JSON.stringify(dto.linkedChannels));

      const data = await giveawayService.createNew(dto, req.user.id);

      res.status(HttpCodes.Created).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async update(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;

      const updateArgs: UpdateGiveawayArgs = {
        ...(req.body as UpdateGiveawayArgs),
      };

      // Process uploaded files array
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        updateArgs.banner = req.files.map(file => `/static/giveaways/${file.filename}`);
      }

      console.log('[update] raw linkedChannelIds:', JSON.stringify(req.body.linkedChannelIds));
      const dto = new UpdateGiveawayDto(updateArgs);
      console.log('[update] resolved linkedChannels:', JSON.stringify(dto.linkedChannels));
      const data = await giveawayService.update(giveawayId, dto, req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async joinGiveaway(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { tickets = 1 } = req.body as { tickets?: number };
      const userIp = getClientIP(req);
      const userCountry = lookup(userIp)?.country || '';

      const data = await giveawayService.joinGiveaway(
        req.user.id,
        giveawayId,
        userCountry,
        tickets,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async buyAdditionalTickets(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { tickets = 1 } = req.body as { tickets?: number };

      const data = await giveawayService.buyAdditionalTickets(
        req.user.id,
        giveawayId,
        tickets,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkUserParticipation(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const isParticipating = await giveawayService.findParticipiation(
        +req.user.id,
        giveawayId,
      );

      res
        .status(HttpCodes.Ok)
        .json({ success: true, data: { isParticipating } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkGiveawayCapacity(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const giveaway = await giveawayService.getOne(giveawayId);

      const isAtCapacity = await giveawayService.hasReachedMaxCapacity(
        giveawayId,
        giveaway.maxParticipants,
        undefined,
        0,
        giveaway.participiationType,
      );

      res.status(HttpCodes.Ok).json({ success: true, data: { isAtCapacity } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkSponsorSubscriptions(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;

      const giveaway = await giveawayService.getOne(giveawayId);
      const sponsorChannelIds = giveaway.sponsoredBy
        .map((sponsor) => sponsor.sponsorChannelId)
        .filter(Boolean);

      const subscriptionStatus =
        await giveawayService.getSponsorChannelsSubscriptionStatus(
          req.user.id,
          sponsorChannelIds,
        );

      res
        .status(HttpCodes.Ok)
        .json({ success: true, data: { channels: subscriptionStatus } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkLinkedChannelSubscriptions(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;

      const giveaway = await giveawayService.getOne(giveawayId);
      // Only check subscription for channels that actually require it (All or Subscription)
      const linkedChannelIds = giveaway.linkedChannels
        .filter((lc) => lc.role === 'All' || lc.role === 'Subscription')
        .map((channel) => channel.channelId);

      const subscriptionStatus =
        await giveawayService.getLinkedChannelsSubscriptionStatus(
          req.user.id,
          linkedChannelIds,
        );

      res
        .status(HttpCodes.Ok)
        .json({ success: true, data: { channels: subscriptionStatus } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkReferrals(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;

      const giveaway = await giveawayService.getOne(giveawayId);
      const referralData = await giveawayService.hasEnoughReferrals(
        req.user.id,
        giveawayId,
        giveaway.neededReferals,
      );

      res.status(HttpCodes.Ok).json({ success: true, data: referralData });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkPremiumStatus(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const hasPremium = await giveawayService.userHasPremium(req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data: { hasPremium } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkChannelBoosts(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const giveaway = await giveawayService.getOne(giveawayId);

      const boostStatus = await giveawayService.getChannelsBoostStatus(
        req.user.id,
        [giveaway.boostedId],
      );

      res
        .status(HttpCodes.Ok)
        .json({ success: true, data: { channels: boostStatus } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkCountryRestriction(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const giveaway = await giveawayService.getOne(giveawayId);
      const userIp = getClientIP(req);
      const userCountry = lookup(userIp)?.country || '';

      const isAllowed = await giveawayService.isUserCountryAllowed(
        userCountry,
        giveaway.allowedGeoCountries,
      );

      res
        .status(HttpCodes.Ok)
        .json({ success: true, data: { isAllowed, userCountry } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkActiveSession(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const hasActiveSession = await giveawayService.userHasActiveSession(
        req.user.id,
      );

      res
        .status(HttpCodes.Ok)
        .json({ success: true, data: { hasActiveSession } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkBalance(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { tickets = 1 } = req.body as { tickets?: number };

      const giveaway = await giveawayService.getOne(giveawayId);
      const hasSufficientBalance = await giveawayService.hasSufficientBalance(
        req.user.id,
        giveaway.participiationType,
        Number(giveaway.participiationPrice),
        giveaway.participiationCurr,
        tickets,
      );

      res
        .status(HttpCodes.Ok)
        .json({ success: true, data: { hasSufficientBalance } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async validateParticipation(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { tickets = 1 } = req.body as { tickets?: number };
      const userIp = getClientIP(req);
      const userCountry = lookup(userIp)?.country || '';

      // Call core validation function
      const confirmation = await giveawayService.validateGiveawayParticipation(
        req.user.id,
        giveawayId,
        userCountry,
        tickets,
      );

      res.status(HttpCodes.Ok).json({
        success: true,
        data: {
          canParticipate: true,
          confirmationId: confirmation.id,
          tickets: confirmation.tickets,
          expiresAt: confirmation.expiresAt,
        },
      });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async validateSponsorLinks(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { giveawayId } = req.params;
      const userId = req.user.id;

      const hasVisited = await sponsorLinkService.hasVisitedAllSponsorLinks(
        userId,
        giveawayId,
      );

      const unvisited = hasVisited
        ? []
        : await sponsorLinkService.getUnvisitedSponsorLinks(userId, giveawayId);

      res.status(HttpCodes.Ok).json({
        success: true,
        data: {
          hasVisitedAll: hasVisited,
          unvisitedLinks: unvisited,
        },
      });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async activateGiveaway(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;

      const data = await giveawayService.activateGiveaway(
        req.user.id,
        giveawayId,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async postAnnouncement(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const channelIds: string[] = req.body.channelIds;

      const data = await giveawayService.postAnnouncement(
        req.user.id,
        giveawayId,
        channelIds,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async updateChannelSettings(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { isPostingResults, isResultsInMainPost, isCommentsOn } = req.body;

      const toBool = (v: unknown): boolean | undefined => {
        if (v === undefined) return undefined;
        return v === true || v === 'true';
      };

      const data = await giveawayService.updateChannelSettings(
        req.user.id,
        giveawayId,
        {
          isPostingResults: toBool(isPostingResults),
          isResultsInMainPost: toBool(isResultsInMainPost),
          isCommentsOn: toBool(isCommentsOn),
        },
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async cancelGiveaway(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { cancelDescription } = req.body as { cancelDescription?: string };

      const data = await giveawayService.cancelGiveaway(
        req.user.id,
        giveawayId,
        cancelDescription,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async finishGiveaway(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;

      const data = await giveawayService.finishGiveaway(
        req.user.id,
        giveawayId,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getGiveawayWebappUrl(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;

      const url = giveawayService.getGiveawayWebappUrl(giveawayId);

      res.status(HttpCodes.Ok).json({ success: true, data: { url } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async createReferral(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      // Accept referredId for frontend compatibility, but it represents the referrer
      const { referredId } = req.body as { referredId: number };

      const data = await giveawayService.createReferral(
        giveawayId,
        referredId,       // Person who shared link (becomes referrerId in DB)
        req.user.id,      // Authenticated user (becomes referredId in DB)
      );

      res.status(HttpCodes.Created).json({ success: true, data });
    } catch (e: unknown) {
      if ((e as any)?.code === ErrorCodes.Conflict) {
        // Referral already registered — treat as success
        res.status(HttpCodes.Ok).json({ success: true, data: null });
        return;
      }
      console.error(e);
      next(e);
    }
  }

  async getAdditionalTicketsStatus(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);
      const data = await giveawayService.getAdditionalTicketsStatus(
        req.user.id,
        req.params.giveawayId,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async claimBoostTickets(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);
      const data = await giveawayService.claimBoostTickets(
        req.user.id,
        req.params.giveawayId,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getReferralLink(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);
      const url = await giveawayService.getGiveawayReferralUrl(
        req.user.id,
        req.params.giveawayId,
      );
      res.status(HttpCodes.Ok).json({ success: true, data: { url } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getAllParticipants(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const paginateDto = new PaginateDto(req.query as any);

      const data = await giveawayService.getAllParticipants(
        giveawayId,
        paginateDto,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getWinners(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const paginateDto = new PaginateDto(req.query as any);

      const data = await giveawayService.getWinners(giveawayId, paginateDto);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getAdditionalWinners(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const paginateDto = new PaginateDto(req.query as any);

      const data = await giveawayService.getAdditionalWinners(
        giveawayId,
        paginateDto,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getNonWinnerParticipants(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const paginateDto = new PaginateDto(req.query as any);

      const data = await giveawayService.getNonWinnerParticipants(
        giveawayId,
        paginateDto,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getAvailableRange(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const giveawayId = req.params.giveawayId;
      const data = await giveawayService.getAvailableRange(giveawayId);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async selectAdditionalWinners(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { rangeStart, rangeEnd, count } = req.body as {
        rangeStart: number;
        rangeEnd: number;
        count: number;
      };

      const data = await giveawayService.selectAdditionalWinners(
        req.user.id,
        giveawayId,
        rangeStart,
        rangeEnd,
        count,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async rechooseAdditionalWinner(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { participantUuid } = req.body as { participantUuid: string };

      const data = await giveawayService.rechooseAdditionalWinner(
        req.user.id,
        giveawayId,
        participantUuid,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async deleteAdditionalWinner(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { participantUuid } = req.body as { participantUuid: string };

      const data = await giveawayService.deleteAdditionalWinner(
        req.user.id,
        giveawayId,
        participantUuid,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async selectMainWinners(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const {
        rangeStart,
        rangeEnd,
        count = 1,
      } = req.body as {
        rangeStart?: number;
        rangeEnd?: number;
        count?: number;
      };

      const data = await giveawayService.selectMainWinners(
        req.user.id,
        giveawayId,
        rangeStart,
        rangeEnd,
        count,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async replaceWinner(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { participantUuid } = req.body as { participantUuid: string };

      const data = await giveawayService.replaceWinner(
        req.user.id,
        giveawayId,
        participantUuid,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async removeWinner(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { participantUuid } = req.body as { participantUuid: string };

      const data = await giveawayService.removeWinner(
        req.user.id,
        giveawayId,
        participantUuid,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async createTicketInvoice(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { tickets = 1 } = req.body as { tickets?: number };
      const userCountry = (req.headers['cf-ipcountry'] as string) || '';

      const invoiceLink = await giveawayService.createTicketInvoice(
        req.user.id,
        giveawayId,
        userCountry,
        tickets,
      );

      res.status(HttpCodes.Ok).json({ success: true, data: { invoiceLink } });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async createAdvertisingInvoice(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const { isPostingOn = false, isNotificationOn = false } = req.body as {
        isPostingOn?: boolean;
        isNotificationOn?: boolean;
      };

      const result = await giveawayService.getAdvertisingInvoiceLink(
        giveawayId,
        req.user.id,
        isPostingOn,
        isNotificationOn,
      );

      res.status(HttpCodes.Ok).json({ success: true, data: result });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getAdvertisingStatus(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);
      const data = await giveawayService.getAdvertisingStatus(
        req.params.giveawayId,
        req.user.id,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }

  async getJoints(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const page = parseInt(String(req.query.page ?? '1'), 10);
      const limit = parseInt(String(req.query.limit ?? '20'), 10);
      const data = await giveawayService.getJoints(page, limit);
      res.status(HttpCodes.Ok).json({ success: true, ...data });
    } catch (e: unknown) {
      next(e);
    }
  }

  async getJointPaymentQuote(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);
      const { giveawayId } = req.params;
      const channelId = req.query.channelId as string;
      if (!channelId) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'channelId query parameter is required',
        );
      }
      const data = await giveawayService.getJointPaymentQuote(
        giveawayId,
        BigInt(channelId),
        req.user.id,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }

  async createJoint(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const { giveawayId } = req.params;
      const { channelId } = req.body as { channelId: string };
      const data = await giveawayService.createJoint(
        giveawayId,
        BigInt(channelId),
        req.user.id,
      );
      res.status(HttpCodes.Created).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }

  async withdrawJoint(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const { giveawayId, channelId } = req.params;
      const data = await giveawayService.withdrawJoint(
        giveawayId,
        BigInt(channelId),
        req.user.id,
      );
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      next(e);
    }
  }

  async createJointInvoice(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const { giveawayId } = req.params;
      const { channelId } = req.body as { channelId: string };
      const invoiceLink = await giveawayService.createJointInvoice(
        giveawayId,
        BigInt(channelId),
        req.user.id,
      );
      res.status(HttpCodes.Ok).json({ success: true, data: { invoiceLink } });
    } catch (e: unknown) {
      next(e);
    }
  }

  async getPostlotChannels(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);
      const giveawayId = req.params.giveawayId;
      const data = await giveawayService.getPostlotChannels(giveawayId, req.user.id);
      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  async getBusinessAccount(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      const raw = req.query.accountType;
      const accountType =
        raw === 'Unique' || raw === 'unique' ? ('Unique' as const) : ('Standard' as const);

      if (process.env.GIFT_PROVIDER !== 'business') {
        const {
          resolveUserbotContactUsername,
          buildTelegramContactUrl,
        } = await import('../../userbot/recipient-check.js');
        const username = await resolveUserbotContactUsername(accountType);
        res.status(HttpCodes.Ok).json({
          success: true,
          data: {
            username,
            accountType,
            contactUrl: buildTelegramContactUrl(username),
          },
        });
        return;
      }

      const {
        normalizeTelegramUsername,
        buildTelegramContactUrl,
      } = await import('../../userbot/recipient-check.js');
      const username = normalizeTelegramUsername(
        await getBusinessUsername(accountType),
      );
      res.status(HttpCodes.Ok).json({
        success: true,
        data: {
          username,
          accountType,
          contactUrl: buildTelegramContactUrl(username),
        },
      });
    } catch (e) {
      next(e);
    }
  }
}

export const giveawayController = new GiveawayController();

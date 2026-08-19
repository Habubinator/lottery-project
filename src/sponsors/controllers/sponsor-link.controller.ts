import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Request, Response } from 'express';
import { sponsorLinkService } from '../services';
import { AuthorizedRequest } from '@auth/types';

class SponsorLinkController {
  /**
   * Redirect endpoint - tracks visit and redirects to actual sponsor link
   * GET /api/sponsors/redirect?userId={userId}&giveawayId={giveawayId}&linkId={linkId}
   */
  async redirect(req: Request, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const { userId, giveawayId, linkId } = req.query;

      if (!userId || !giveawayId || !linkId) {
        return res.status(HttpCodes.BadRequest).json({
          success: false,
          error: 'Missing required parameters: userId, giveawayId, linkId',
        });
      }

      // Track visit and get redirect URL
      const redirectUrl = await sponsorLinkService.trackVisitAndRedirect(
        parseInt(userId as string, 10),
        giveawayId as string,
        parseInt(linkId as string, 10),
      );

      // Redirect to the actual sponsor link
      res.redirect(302, redirectUrl);
    } catch (e: unknown) {
      console.error('Error in sponsor link redirect:', e);
      next(e);
    }
  }

  /**
   * Get unvisited sponsor links for a giveaway
   * GET /api/giveaways/{giveawayId}/sponsor-links/unvisited
   */
  async getUnvisited(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const { giveawayId } = req.params;
      const userId = req.user!.id;

      const unvisitedLinks = await sponsorLinkService.getUnvisitedSponsorLinks(
        userId,
        giveawayId,
      );

      res.status(HttpCodes.Ok).json({
        success: true,
        data: unvisitedLinks,
      });
    } catch (e: unknown) {
      console.error('Error getting unvisited sponsor links:', e);
      next(e);
    }
  }
}

export const sponsorLinkController = new SponsorLinkController();

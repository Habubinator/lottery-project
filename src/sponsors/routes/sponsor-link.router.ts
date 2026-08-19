import { Router } from 'express';
import { sponsorLinkController } from '../controllers';

export const sponsorLinkRouter = Router();

/**
 * @swagger
 * /api/sponsors/redirect:
 *   get:
 *     summary: Redirect to sponsor link and track visit
 *     tags:
 *       - Sponsors
 *     parameters:
 *       - in: query
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *       - in: query
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *         description: Giveaway ID
 *       - in: query
 *         name: linkId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Sponsor Link ID
 *     responses:
 *       302:
 *         description: Redirects to the actual sponsor link
 *       400:
 *         description: Missing required parameters
 *       404:
 *         description: Sponsor link not found
 */
sponsorLinkRouter.get(
  '/redirect',
  sponsorLinkController.redirect.bind(sponsorLinkController),
);

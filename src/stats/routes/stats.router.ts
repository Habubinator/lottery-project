import { Router } from 'express';
import { statsController } from '../controllers/stats.controller';

export const statsRouter = Router();

/**
 * @swagger
 * /api/stats/main:
 *   get:
 *     summary: Get platform-wide timeline stats (all users)
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: timeline
 *         required: true
 *         schema:
 *           type: string
 *           enum: [1d, 1w, 1m, 3m, 6m, 1y]
 *         description: |
 *           Time window for stats:
 *           - 1d = last 24 hours (hourly records)
 *           - 1w = last 7 days (daily records)
 *           - 1m = last 30 days (daily records)
 *           - 3m = last 90 days (weekly records)
 *           - 6m = last 180 days (weekly records)
 *           - 1y = last 365 days (monthly records)
 *       - in: query
 *         name: mode
 *         required: true
 *         schema:
 *           type: string
 *           enum: [owner, user]
 *         description: |
 *           owner = platform giveaways created, boosts, referrals;
 *           user = platform participations (by join date) and occupied prize places (by giveaway finish date)
 *     responses:
 *       200:
 *         description: Stats with summary and time-series records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   oneOf:
 *                     - $ref: '#/components/schemas/StatsOwnerSummaryDto'
 *                     - $ref: '#/components/schemas/StatsUserSummaryDto'
 *                 records:
 *                   type: array
 *                   description: Zero-filled time-series data points covering the selected period
 *                   items:
 *                     oneOf:
 *                       - $ref: '#/components/schemas/StatsOwnerRecordDto'
 *                       - $ref: '#/components/schemas/StatsUserRecordDto'
 *       400:
 *         description: Invalid or missing parameters
 */
statsRouter.get('/main', statsController.getMainStats.bind(statsController));

/**
 * @swagger
 * /api/stats/top:
 *   get:
 *     summary: Get top 100 owners or top 100 participants (all-time)
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: mode
 *         required: true
 *         schema:
 *           type: string
 *           enum: [owner, user]
 *         description: |
 *           owner = top 100 sorted by giveaways created;
 *           user = top 100 sorted by total participations
 *       - in: query
 *         name: timeline
 *         required: false
 *         schema:
 *           type: string
 *           enum: [1d, 1w, 1m, 3m, 6m, 1y]
 *         description: |
 *           Optional time window to filter stats. When omitted, returns all-time rankings.
 *     responses:
 *       200:
 *         description: Ranked list of top 100 users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mode:
 *                   type: string
 *                   enum: [owner, user]
 *                   example: owner
 *                 data:
 *                   type: array
 *                   items:
 *                     oneOf:
 *                       - $ref: '#/components/schemas/TopOwnerEntryDto'
 *                       - $ref: '#/components/schemas/TopUserEntryDto'
 *       400:
 *         description: Invalid mode parameter
 */
statsRouter.get('/top', statsController.getTop.bind(statsController));

import { Router } from 'express';
import { telegramGiftController } from '../controllers/telegram-gift.controller';
import { auth } from '../../auth/middlewares/auth.middleware';

export const telegramGiftRouter = Router();

/**
 * @swagger
 * /api/telegram-gifts:
 *   get:
 *     summary: Get all available Telegram gifts
 *     description: Returns a list of all default Telegram gifts that can be sent by the bot
 *     tags:
 *       - Telegram Gifts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved gifts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Unique gift identifier
 *                       sticker:
 *                         type: object
 *                         description: Sticker object representing the gift
 *                       star_count:
 *                         type: integer
 *                         description: Cost in Telegram Stars
 *                       upgrade_star_count:
 *                         type: integer
 *                         description: Cost to upgrade to unique gift
 *                       total_count:
 *                         type: integer
 *                         description: Total available (limited gifts only)
 *                       remaining_count:
 *                         type: integer
 *                         description: Remaining available (limited gifts only)
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 */
telegramGiftRouter.get('/', auth, telegramGiftController.getAll);

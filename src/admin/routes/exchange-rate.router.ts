import { Router } from 'express';
import { exchangeRateController } from '../controllers/exchange-rate.controller';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';

export const exchangeRateRouter = Router();

/**
 * @swagger
 * /api/admin/exchange-rate:
 *   get:
 *     summary: Get exchange rate configuration
 *     description: Returns the exchange rate between Stars and TON (e.g., 100 Stars = 1 TON)
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved exchange rate configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     starsInput:
 *                       type: number
 *                       format: decimal
 *                       example: 100
 *                       description: Amount of Stars (⭐)
 *                     tonOutput:
 *                       type: number
 *                       format: decimal
 *                       example: 1
 *                       description: Amount of TON (💎) you get for starsInput
 *       "404":
 *         description: ExchangeRate configuration not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "ExchangeRate not found"
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
exchangeRateRouter.get('/', auth, exchangeRateController.getExchangeRate);

/**
 * @swagger
 * /api/admin/exchange-rate:
 *   patch:
 *     summary: Update exchange rate configuration (Admin only)
 *     description: |
 *       Updates the exchange rate between Stars and TON. Only accessible by admin users.
 *
 *       Example: If you set starsInput=100 and tonOutput=1, it means:
 *       - 100 ⭐ Stars = 1 💎 TON
 *       - 200 ⭐ Stars = 2 💎 TON
 *       - 50 ⭐ Stars = 0.5 💎 TON
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               starsInput:
 *                 type: number
 *                 format: decimal
 *                 minimum: 0.01
 *                 example: 100
 *                 description: Amount of Stars (⭐) - must be greater than 0
 *               tonOutput:
 *                 type: number
 *                 format: decimal
 *                 minimum: 0
 *                 example: 1
 *                 description: Amount of TON (💎) you get for starsInput
 *             minProperties: 1
 *           examples:
 *             updateBoth:
 *               summary: Update complete exchange rate
 *               value:
 *                 starsInput: 100
 *                 tonOutput: 1
 *               description: "100 ⭐ Stars = 1 💎 TON"
 *             updateStarsOnly:
 *               summary: Update only Stars input
 *               value:
 *                 starsInput: 150
 *               description: "Change to 150 ⭐ Stars (keep existing TON output)"
 *             updateTonOnly:
 *               summary: Update only TON output
 *               value:
 *                 tonOutput: 0.5
 *               description: "Change TON output to 0.5 💎 (keep existing Stars input)"
 *     responses:
 *       "200":
 *         description: Successfully updated exchange rate configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     starsInput:
 *                       type: number
 *                       format: decimal
 *                       example: 100
 *                     tonOutput:
 *                       type: number
 *                       format: decimal
 *                       example: 1
 *       "400":
 *         description: Bad request - invalid values
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Stars input must be greater than 0"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - user is not an admin
 *       "404":
 *         description: ExchangeRate configuration not found
 *       "500":
 *         description: Internal server error
 */
exchangeRateRouter.patch(
  '/',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  exchangeRateController.updateExchangeRate,
);

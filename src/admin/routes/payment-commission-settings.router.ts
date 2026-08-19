import { Router } from 'express';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';
import { paymentCommissionSettingsController } from '../controllers/payment-commission-settings.controller';

export const paymentCommissionSettingsRouter = Router();

/**
 * @swagger
 * /api/admin/payment-commission-settings:
 *   get:
 *     summary: Get payment commission settings
 *     description: |
 *       Returns admin-managed payment commission settings used in prize payment workflows:
 *       - `nftWithdrawalBaseStars` - base NFT withdrawal fee in Stars (TON equivalent is computed live from exchange rate)
 *       - `standardGiftTonMarkupPercent` - markup percent for standard gifts when paying in TON
 *       - `standardGiftStarsMarkupPercent` - markup percent for standard gifts when paying in Stars
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Settings fetched successfully
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
 *                     nftWithdrawalBaseStars:
 *                       type: integer
 *                       example: 35
 *                     standardGiftTonMarkupPercent:
 *                       type: number
 *                       example: 5
 *                     standardGiftStarsMarkupPercent:
 *                       type: number
 *                       example: 20
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: PaymentCommissionSettings not found
 *       "500":
 *         description: Internal server error
 */
paymentCommissionSettingsRouter.get(
  '/',
  auth,
  paymentCommissionSettingsController.getSettings,
);

/**
 * @swagger
 * /api/admin/payment-commission-settings:
 *   patch:
 *     summary: Update payment commission settings (Admin only)
 *     description: |
 *       Updates fee settings used by prize payment workflows.
 *
 *       Notes:
 *       - NFT TON fee is always computed live as `convertStarsToTon(nftWithdrawalBaseStars)` using current exchange rate.
 *       - Standard gift formulas use markup percentages from these settings:
 *         - Stars payment: `baseStars * (1 + standardGiftStarsMarkupPercent/100)`, rounded up to integer.
 *         - TON payment: `convertStarsToTon(baseStars) * (1 + standardGiftTonMarkupPercent/100)`, rounded to 2 decimals.
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
 *               nftWithdrawalBaseStars:
 *                 type: integer
 *                 minimum: 0
 *                 example: 35
 *               standardGiftTonMarkupPercent:
 *                 type: number
 *                 minimum: 0
 *                 example: 5
 *               standardGiftStarsMarkupPercent:
 *                 type: number
 *                 minimum: 0
 *                 example: 20
 *             minProperties: 1
 *     responses:
 *       "200":
 *         description: Settings updated successfully
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
 *       "400":
 *         description: Validation failed
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - admin role required
 *       "404":
 *         description: PaymentCommissionSettings not found
 *       "500":
 *         description: Internal server error
 */
paymentCommissionSettingsRouter.patch(
  '/',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  paymentCommissionSettingsController.updateSettings,
);


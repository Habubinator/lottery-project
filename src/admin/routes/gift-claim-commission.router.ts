import { Router } from 'express';
import { giftClaimCommissionController } from '../controllers/gift-claim-commission.controller';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';

export const giftClaimCommissionRouter = Router();

/**
 * @swagger
 * /api/admin/gift-claim-commission:
 *   get:
 *     summary: Get gift claim commission configuration
 *     description: Returns the flat fee per gift prize transfer for Stars and TON currencies.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved gift claim commission configuration
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
 *                     starsAmount:
 *                       type: number
 *                       format: float
 *                       example: 25
 *                       description: Flat fee per gift transfer paid in Stars
 *                     tonAmount:
 *                       type: number
 *                       format: float
 *                       example: 0.2
 *                       description: Flat fee per gift transfer paid in TON
 *       "404":
 *         description: GiftClaimCommission configuration not found
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
 *                   example: "GiftClaimCommission not found"
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
giftClaimCommissionRouter.get(
  '/',
  auth,
  giftClaimCommissionController.getGiftClaimCommission,
);

/**
 * @swagger
 * /api/admin/gift-claim-commission:
 *   patch:
 *     summary: Update gift claim commission configuration (Admin only)
 *     description: Updates the flat fee per gift transfer for Stars and/or TON. Only accessible by admin users.
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
 *               starsAmount:
 *                 type: number
 *                 format: float
 *                 minimum: 0
 *                 example: 25
 *                 description: Flat fee per gift transfer in Stars
 *               tonAmount:
 *                 type: number
 *                 format: float
 *                 minimum: 0
 *                 example: 0.2
 *                 description: Flat fee per gift transfer in TON
 *             minProperties: 1
 *           examples:
 *             updateBoth:
 *               summary: Update both fees
 *               value:
 *                 starsAmount: 25
 *                 tonAmount: 0.2
 *             updateStarsOnly:
 *               summary: Update only Stars fee
 *               value:
 *                 starsAmount: 30
 *             updateTonOnly:
 *               summary: Update only TON fee
 *               value:
 *                 tonAmount: 0.15
 *     responses:
 *       "200":
 *         description: Successfully updated gift claim commission configuration
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
 *                     starsAmount:
 *                       type: number
 *                       format: float
 *                       example: 25
 *                     tonAmount:
 *                       type: number
 *                       format: float
 *                       example: 0.2
 *       "400":
 *         description: Bad request - invalid values (must be >= 0)
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
 *                   example: "Stars amount must be a non-negative number"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - user is not an admin
 *       "404":
 *         description: GiftClaimCommission configuration not found
 *       "500":
 *         description: Internal server error
 */
giftClaimCommissionRouter.patch(
  '/',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  giftClaimCommissionController.updateGiftClaimCommission,
);

import { Router } from 'express';
import { withdrawalCommissionController } from '../controllers/withdrawal-commission.controller';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';

export const withdrawalCommissionRouter = Router();

/**
 * @swagger
 * /api/admin/withdrawal-commission:
 *   get:
 *     summary: Get withdrawal commission configuration
 *     description: Returns the withdrawal commission percentages for Stars and TON
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved withdrawal commission configuration
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
 *                     starsPercent:
 *                       type: number
 *                       format: float
 *                       example: 5.5
 *                       description: Commission percentage for Stars withdrawals (0-100)
 *                     tonPercent:
 *                       type: number
 *                       format: float
 *                       example: 3.0
 *                       description: Commission percentage for TON withdrawals (0-100)
 *       "404":
 *         description: WithdrawalCommission configuration not found
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
 *                   example: "WithdrawalCommission not found"
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
withdrawalCommissionRouter.get(
  '/',
  auth,
  withdrawalCommissionController.getWithdrawalCommission,
);

/**
 * @swagger
 * /api/admin/withdrawal-commission:
 *   patch:
 *     summary: Update withdrawal commission configuration (Admin only)
 *     description: Updates the withdrawal commission percentages for Stars and/or TON. Only accessible by admin users.
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
 *               starsPercent:
 *                 type: number
 *                 format: float
 *                 minimum: 0
 *                 maximum: 100
 *                 example: 5.5
 *                 description: Commission percentage for Stars withdrawals (0-100)
 *               tonPercent:
 *                 type: number
 *                 format: float
 *                 minimum: 0
 *                 maximum: 100
 *                 example: 3.0
 *                 description: Commission percentage for TON withdrawals (0-100)
 *             minProperties: 1
 *           examples:
 *             updateBoth:
 *               summary: Update both commissions
 *               value:
 *                 starsPercent: 5.5
 *                 tonPercent: 3.0
 *             updateStarsOnly:
 *               summary: Update only Stars commission
 *               value:
 *                 starsPercent: 7.5
 *             updateTonOnly:
 *               summary: Update only TON commission
 *               value:
 *                 tonPercent: 2.5
 *     responses:
 *       "200":
 *         description: Successfully updated withdrawal commission configuration
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
 *                     starsPercent:
 *                       type: number
 *                       format: float
 *                       example: 5.5
 *                     tonPercent:
 *                       type: number
 *                       format: float
 *                       example: 3.0
 *       "400":
 *         description: Bad request - invalid values (must be between 0 and 100)
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
 *                   example: "Stars commission must be between 0 and 100"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - user is not an admin
 *       "404":
 *         description: WithdrawalCommission configuration not found
 *       "500":
 *         description: Internal server error
 */
withdrawalCommissionRouter.patch(
  '/',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  withdrawalCommissionController.updateWithdrawalCommission,
);

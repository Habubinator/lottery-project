import { Router } from 'express';
import { minTransactionValueController } from '../controllers/min-transaction-value.controller';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';

export const minTransactionValueRouter = Router();

/**
 * @swagger
 * /api/admin/min-transaction-value:
 *   get:
 *     summary: Get minimum transaction values configuration
 *     description: Returns the minimum transaction values for Stars and TON
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved minimum transaction values
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
 *                     stars:
 *                       type: integer
 *                       example: 100
 *                       description: Minimum transaction value in Stars
 *                     ton:
 *                       type: integer
 *                       example: 50
 *                       description: Minimum transaction value in TON
 *       "404":
 *         description: MinTransactionValue configuration not found
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
 *                   example: "MinTransactionValue not found"
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
minTransactionValueRouter.get(
  '/',
  auth,
  minTransactionValueController.getMinTransactionValue,
);

/**
 * @swagger
 * /api/admin/min-transaction-value:
 *   patch:
 *     summary: Update minimum transaction values configuration (Admin only)
 *     description: Updates the minimum transaction values for Stars and/or TON. Only accessible by admin users.
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
 *               stars:
 *                 type: integer
 *                 minimum: 0
 *                 example: 100
 *                 description: Minimum transaction value in Stars
 *               ton:
 *                 type: integer
 *                 minimum: 0
 *                 example: 50
 *                 description: Minimum transaction value in TON
 *             minProperties: 1
 *           examples:
 *             updateBoth:
 *               summary: Update both values
 *               value:
 *                 stars: 100
 *                 ton: 50
 *             updateStarsOnly:
 *               summary: Update only Stars
 *               value:
 *                 stars: 150
 *             updateTonOnly:
 *               summary: Update only TON
 *               value:
 *                 ton: 75
 *     responses:
 *       "200":
 *         description: Successfully updated minimum transaction values
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
 *                     stars:
 *                       type: integer
 *                       example: 100
 *                     ton:
 *                       type: integer
 *                       example: 50
 *       "400":
 *         description: Bad request - invalid values (negative numbers)
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
 *                   example: "Stars value cannot be negative"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - user is not an admin
 *       "404":
 *         description: MinTransactionValue configuration not found
 *       "500":
 *         description: Internal server error
 */
minTransactionValueRouter.patch(
  '/',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  minTransactionValueController.updateMinTransactionValue,
);

import { Router } from 'express';
import { advertisingPriceController } from '../controllers/advertising-price.controller';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';

export const advertisingPriceRouter = Router();

/**
 * @swagger
 * /api/admin/advertising-price:
 *   get:
 *     summary: Get advertising price configuration
 *     description: Returns the Stars prices for posting and notification advertising
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved advertising price configuration
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
 *                     postingStars:
 *                       type: integer
 *                       example: 50
 *                       description: Stars price for channel posting advertising
 *                     notificationStars:
 *                       type: integer
 *                       example: 25
 *                       description: Stars price for notification advertising
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
advertisingPriceRouter.get(
  '/',
  auth,
  advertisingPriceController.getAdvertisingPrice,
);

/**
 * @swagger
 * /api/admin/advertising-price:
 *   patch:
 *     summary: Update advertising price configuration (Admin only)
 *     description: Updates the Stars prices for posting and/or notification advertising. Only accessible by admin users.
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
 *               postingStars:
 *                 type: integer
 *                 minimum: 1
 *                 example: 50
 *                 description: Stars price for channel posting advertising
 *               notificationStars:
 *                 type: integer
 *                 minimum: 1
 *                 example: 25
 *                 description: Stars price for notification advertising
 *             minProperties: 1
 *     responses:
 *       "200":
 *         description: Successfully updated advertising price configuration
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
 *                     postingStars:
 *                       type: integer
 *                       example: 50
 *                     notificationStars:
 *                       type: integer
 *                       example: 25
 *       "400":
 *         description: Bad request - invalid values
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - user is not an admin
 *       "500":
 *         description: Internal server error
 */
advertisingPriceRouter.patch(
  '/',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  advertisingPriceController.updateAdvertisingPrice,
);

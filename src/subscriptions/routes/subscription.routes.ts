import { Router } from 'express';
import { subscriptionController } from '../controllers';
import { auth } from '@auth/middlewares';

export const subscriptionRouter = Router();

/**
 * @swagger
 * /api/subscriptions/tariffs:
 *   get:
 *     summary: Get all available tariffs
 *     tags:
 *       - Subscriptions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Success
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
 *                         type: integer
 *                       label:
 *                         type: string
 *                       currency:
 *                         type: string
 *                         enum: [Stars, TON]
 *                       price:
 *                         type: integer
 *                       lengthDays:
 *                         type: integer
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "500":
 *         description: Internal server error
 */
subscriptionRouter.get('/tariffs', auth, subscriptionController.getAllTariffs);

/**
 * @swagger
 * /api/subscriptions/my:
 *   get:
 *     summary: Get current user subscription
 *     tags:
 *       - Subscriptions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Success
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
 *                   nullable: true
 *                   properties:
 *                     userId:
 *                       type: integer
 *                     tariffId:
 *                       type: integer
 *                     subscriptionExpiringAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     tariff:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         label:
 *                           type: string
 *                         currency:
 *                           type: string
 *                           enum: [Stars, TON]
 *                         price:
 *                           type: integer
 *                         lengthDays:
 *                           type: integer
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "500":
 *         description: Internal server error
 */
subscriptionRouter.get('/my', auth, subscriptionController.getUserSubscription);

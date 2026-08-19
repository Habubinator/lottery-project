import { Router } from 'express';
import { telegramSessionValidator } from '../validators';
import { authController } from '../controllers';
import { auth } from '../middlewares';

export const authRouter = Router();

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags:
 *       - Auth
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
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       description: New access token
 *       "401":
 *         description: Unauthorized - Invalid or missing refresh token
 *       "500":
 *         description: Internal server error
 */
authRouter.post('/refresh', authController.refresh);

/**
 * @swagger
 * /api/auth/validate:
 *   post:
 *     summary: Validate Telegram session and then login/register if user is valid
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               initData:
 *                 type: string
 *                 description: Initialization data from Telegram
 *             required:
 *               - initData
 *     responses:
 *       "200":
 *         description: Session validated successfully
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
 *                     isValid:
 *                       type: boolean
 *                       description: Whether the Telegram session is valid
 *                     user:
 *                       type: object
 *                       description: User object (existing or newly created) with associated wallet
 *                       properties:
 *                         id:
 *                           type: integer
 *                         telegramId:
 *                           type: string
 *                         username:
 *                           type: string
 *                           nullable: true
 *                         first_name:
 *                           type: string
 *                         last_name:
 *                           type: string
 *                           nullable: true
 *                         language_code:
 *                           type: string
 *                           description: Telegram client language (not app UI choice)
 *                         picked_language:
 *                           type: string
 *                           nullable: true
 *                           description: App UI language from DB; null until user picks via set-language
 *                         isLanguagePicked:
 *                           type: boolean
 *                           description: Whether the user explicitly chose app language
 *                         photo_url:
 *                           type: string
 *                         isBanned:
 *                           type: boolean
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *                         updatedAt:
 *                           type: string
 *                           format: date-time
 *                         role:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: integer
 *                             name:
 *                               type: string
 *                         wallet:
 *                           type: object
 *                           nullable: true
 *                           description: User's wallet information (as defined in Prisma schema)
 *                           properties:
 *                             id:
 *                               type: integer
 *                             userId:
 *                               type: integer
 *                               nullable: true
 *                             starsBalance:
 *                               type: number
 *                               description: Current stars balance
 *                             holdedStarsBalance:
 *                               type: number
 *                               description: Stars balance on hold
 *                             tonBalance:
 *                               type: number
 *                               description: TON cryptocurrency balance
 *                         subscription:
 *                           type: array
 *                           description: User's subscription information with tariff details
 *                           items:
 *                             type: object
 *                             properties:
 *                               userId:
 *                                 type: integer
 *                               tariffId:
 *                                 type: integer
 *                               subscriptionExpiringAt:
 *                                 type: string
 *                                 format: date-time
 *                                 nullable: true
 *                               tariff:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: integer
 *                                   label:
 *                                     type: string
 *                                   currency:
 *                                     type: string
 *                                     enum: [Stars, TON]
 *                                   price:
 *                                     type: integer
 *                                   lengthDays:
 *                                     type: integer
 *                         statistics:
 *                           $ref: '#/components/schemas/AuthLoginStatisticsDto'
 *                         creatorStatistics:
 *                           $ref: '#/components/schemas/CreatorStatisticsDto'
 *                     accessToken:
 *                       type: string
 *                       description: JWT access token
 *                     refreshToken:
 *                       type: string
 *                       description: JWT refresh token (also set as HTTP-only cookie)
 *       "400":
 *         description: Bad request - Invalid initData or validation failed
 *       "422":
 *         description: Validation error - Request body validation failed
 *       "500":
 *         description: Internal server error
 */
authRouter.post(
  '/validate',
  telegramSessionValidator,
  authController.validateAndProceed,
);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authorized user info
 *     tags:
 *       - Auth
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
 *                   description: User information with role and wallet
 *                   properties:
 *                     id:
 *                       type: integer
 *                     telegramId:
 *                       type: string
 *                     username:
 *                       type: string
 *                       nullable: true
 *                     first_name:
 *                       type: string
 *                     last_name:
 *                       type: string
 *                       nullable: true
 *                     language_code:
 *                       type: string
 *                     picked_language:
 *                       type: string
 *                       nullable: true
 *                     isLanguagePicked:
 *                       type: boolean
 *                     photo_url:
 *                       type: string
 *                     isBanned:
 *                       type: boolean
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                     role:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         name:
 *                           type: string
 *                     wallet:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           userId:
 *                             type: integer
 *                           starsBalance:
 *                             type: number
 *                           tonBalance:
 *                             type: number
 *                     subscription:
 *                       type: array
 *                       description: User's subscription information with tariff details
 *                       items:
 *                         type: object
 *                         properties:
 *                           userId:
 *                             type: integer
 *                           tariffId:
 *                             type: integer
 *                           subscriptionExpiringAt:
 *                             type: string
 *                             format: date-time
 *                             nullable: true
 *                           tariff:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: integer
 *                               label:
 *                                 type: string
 *                               currency:
 *                                 type: string
 *                                 enum: [Stars, TON]
 *                               price:
 *                                 type: integer
 *                               lengthDays:
 *                                 type: integer
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "403":
 *         description: Forbidden - User is banned
 *       "500":
 *         description: Internal server error
 */
authRouter.get('/me', auth, authController.me);

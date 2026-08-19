import { Router } from 'express';
import { giveawayController } from '../controllers';
import { paginateValidator } from '@common/validators';
import { auth } from '@auth/middlewares';
import { uploadMultipleFiles } from '@common/middlewares';
import { sponsorLinkController } from '@sponsors';
import { prizeRouter } from './prize.router';

export const giveawaysRouter = Router();

/**
 * @swagger
 * /api/giveaways/business-account:
 *   get:
 *     summary: Get the platform gift account username
 *     description: |
 *       Returns the Telegram username users should open before sending or claiming gifts.
 *       When `GIFT_PROVIDER=userbot`, resolves the **userbot** account (`getUserbotUsername`), not the legacy business DB user.
 *       Use `accountType=Unique` for NFT / UniqueGift flows and `Standard` (default) for catalog Star gifts.
 *       Prefer `GET /api/prizes/claim-prerequisites` per prize for withdraw (`contactUsername`).
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: accountType
 *         schema:
 *           type: string
 *           enum: [Standard, Unique]
 *           default: Standard
 *         description: Which userbot/business account handles this gift type
 *     responses:
 *       "200":
 *         description: Business account username
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
 *                     username:
 *                       type: string
 *                       nullable: true
 *                       example: "mybusinessaccount"
 *                       description: Telegram username without @ (null if account not connected)
 *                     accountType:
 *                       type: string
 *                       enum: [Standard, Unique]
 *                     contactUrl:
 *                       type: string
 *                       nullable: true
 *                       example: "https://t.me/example_bot"
 *                       description: Same as t.me link built from username (for open-chat button)
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
giveawaysRouter.get('/business-account', auth, giveawayController.getBusinessAccount.bind(giveawayController));

/**
 * @swagger
 * /api/giveaways/all:
 *   get:
 *     summary: Get a paginated list of all giveaways with optional filters
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of giveaways per page
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active/inactive giveaways
 *         example: true
 *       - in: query
 *         name: isPlanned
 *         schema:
 *           type: boolean
 *         description: Filter by planned/non-planned giveaways
 *         example: false
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *         description: Filter by giveaway language
 *         example: "en"
 *       - in: query
 *         name: participationType
 *         schema:
 *           type: string
 *           enum: [Lottery, Random]
 *         description: Filter by participation type
 *         example: "Lottery"
 *       - in: query
 *         name: completionType
 *         schema:
 *           type: string
 *           enum: [ByTime, ByCapacity]
 *         description: Filter by completion type
 *         example: "ByTime"
 *       - in: query
 *         name: isOnlyPremium
 *         schema:
 *           type: boolean
 *         description: Filter premium-only giveaways
 *         example: false
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           enum: [Stars, TON]
 *         description: Filter by participation currency
 *         example: "Stars"
 *     responses:
 *       "200":
 *         description: Successfully retrieved giveaways
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedGiveawaysResponse'
 *       "400":
 *         description: Bad request, invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get('/all', auth, paginateValidator, giveawayController.getAll);

/**
 * @swagger
 * /api/giveaways/one/{giveawayId}:
 *   get:
 *     summary: Get a single giveaway by ID with detailed information
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Successfully retrieved giveaway
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GiveawayDto'
 *       "400":
 *         description: Bad request, invalid giveaway ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get('/one/:giveawayId', auth, giveawayController.getOne);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/webapp-url:
 *   get:
 *     summary: Get webapp URL for a giveaway
 *     tags:
 *       - Giveaways
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Successfully retrieved giveaway webapp URL
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
 *                     url:
 *                       type: string
 *                       example: "https://your-bot-url.com?startapp=giveawayId_550e8400-e29b-41d4-a716-446655440000"
 *       "400":
 *         description: Bad request, invalid giveaway ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get(
  '/:giveawayId/webapp-url',
  giveawayController.getGiveawayWebappUrl,
);

/**
 * @swagger
 * /api/giveaways/create:
 *   post:
 *     summary: Create a new giveaway
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/CreateGiveawayRequestDto'
 *     responses:
 *       "201":
 *         description: Successfully created giveaway
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GiveawayDto'
 *       "400":
 *         description: Bad request, invalid giveaway data or missing subscription for premium features
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden, active subscription required for premium features
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: User, referenced channels, or boosted channel not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/create',
  auth,
  uploadMultipleFiles('giveaways', 'banner', 10, {
    fileFormats: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'],
    sizeLimit: 50 * 1024 * 1024, // 50MB in bytes
  }),
  giveawayController.createNew,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}:
 *   patch:
 *     summary: Update an existing giveaway
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway to update
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/UpdateGiveawayDto'
 *     responses:
 *       "200":
 *         description: Successfully updated giveaway
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GiveawayDto'
 *       "400":
 *         description: Invalid input or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - not authorized to update or subscription required for premium features
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.patch(
  '/:giveawayId',
  auth,
  uploadMultipleFiles('giveaways', 'banner', 10, {
    fileFormats: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'],
    sizeLimit: 50 * 1024 * 1024, // 50MB in bytes
  }),
  // TODO -
  // add to uploadMultipleFiles
  // {
  //   fileFormats: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'],
  //   sizeLimit: 5 * 1024 * 1024, // 5MB in bytes
  // }
  giveawayController.update,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/join:
 *   post:
 *     summary: Join a giveaway as a participant
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway to join
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tickets:
 *                 type: integer
 *                 minimum: 1
 *                 example: 5
 *                 description: how many tickets will be bought
 *     responses:
 *       "200":
 *         description: Successfully joined giveaway
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
 *                     $ref: '#/components/schemas/ParticipantDto'
 *       "400":
 *         description: Bad request - various reasons like giveaway inactive, already participating, capacity reached, requirements not met, insufficient funds, etc.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "409":
 *         description: Conflict - user already participating
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/join',
  auth,
  giveawayController.joinGiveaway,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/buy-tickets:
 *   post:
 *     summary: Buy additional tickets for a lottery the user is already participating in
 *     description: Allows users to purchase additional tickets for lottery-type giveaways they have already joined. This endpoint only validates essential criteria (giveaway active, capacity, balance) without re-checking subscriptions, referrals, premium status, etc.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the lottery giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tickets:
 *                 type: integer
 *                 minimum: 1
 *                 example: 3
 *                 description: Number of additional tickets to purchase
 *     responses:
 *       "200":
 *         description: Successfully purchased additional tickets
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
 *                     $ref: '#/components/schemas/ParticipantDto'
 *       "400":
 *         description: Bad request - user not participating yet, giveaway not lottery type, inactive, cancelled, capacity reached, or insufficient funds
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/buy-tickets',
  auth,
  giveawayController.buyAdditionalTickets,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/ticket-invoice:
 *   post:
 *     summary: Get Telegram Stars invoice link for lottery ticket purchase
 *     description: Validates participation eligibility, creates a GiveawayParticipationConfirmation, and returns a Telegram Stars invoice link. User pays Stars directly from their Telegram account — in-app wallet is not involved.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tickets:
 *                 type: integer
 *                 default: 1
 *     responses:
 *       "200":
 *         description: Invoice link created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     invoiceLink:
 *                       type: string
 *       "400":
 *         description: Validation failed or giveaway not eligible
 *       "401":
 *         description: Unauthorized
 */
giveawaysRouter.post(
  '/:giveawayId/ticket-invoice',
  auth,
  giveawayController.createTicketInvoice as any,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/advertising:
 *   get:
 *     summary: Get advertising payment status for a giveaway
 *     description: |
 *       Returns current ad flags, purchase timestamps, and free-posting eligibility.
 *       Main-page posting (`isPostingOn`) is free for all lotteries and for Random giveaways
 *       that have Linked gifts. Bot newsletter (`isNotificationOn`) is always paid on first enable.
 *       Use advertisedAt != null to detect if posting was ever purchased (paid path).
 *       Use notificationPaidAt != null for notification purchase.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Advertising status retrieved successfully
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
 *                     isPostingOn:
 *                       type: boolean
 *                       description: Whether front-page posting is currently active
 *                     isNotificationOn:
 *                       type: boolean
 *                       description: Whether subscriber notification is currently active
 *                     advertisedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       description: Timestamp of first paid posting purchase, null if never paid (free lottery/gifts does not set this)
 *                     notificationPaidAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       description: Timestamp of first notification purchase, null if never purchased
 *                     postingFreeEligible:
 *                       type: boolean
 *                       description: True when main-page posting can be enabled without Stars (lottery, Linked gifts, or already paid)
 *                     postingPriceStars:
 *                       type: integer
 *                       description: Stars to charge for main-page posting (0 when postingFreeEligible)
 *                       example: 0
 *                     notificationPriceStars:
 *                       type: integer
 *                       description: Stars to charge for bot newsletter on first enable
 *                       example: 25
 *                     linkedGiftCount:
 *                       type: integer
 *                       description: Number of Linked GiveawayPrize rows on this giveaway
 *                       example: 2
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - not the giveaway creator
 *       "404":
 *         description: Giveaway not found
 */
giveawaysRouter.get(
  '/:giveawayId/advertising',
  auth,
  giveawayController.getAdvertisingStatus as any,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/advertising/invoice:
 *   post:
 *     summary: Create a Telegram Stars invoice link to enable advertising on a giveaway
 *     description: |
 *       Validates the caller is the giveaway creator.
 *       Main-page posting is free for lotteries and Random giveaways with Linked gifts —
 *       in that case invoiceLink may be null and freePostingApplied=true (no Stars charge).
 *       Bot newsletter remains paid (default 25⭐). Already-active / already-paid flags are ignored.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the giveaway to advertise
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isPostingOn:
 *                 type: boolean
 *                 default: false
 *                 description: Enable front-page posting (free for lottery / gifts; else posting price). Ignored if already active.
 *               isNotificationOn:
 *                 type: boolean
 *                 default: false
 *                 description: Enable subscriber notification (paid). Ignored if already active.
 *     responses:
 *       "200":
 *         description: Invoice link created or free posting applied
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
 *                     invoiceLink:
 *                       type: string
 *                       nullable: true
 *                       description: Telegram Stars deep-link; null when free posting was applied without payment
 *                       example: "https://t.me/$abc123"
 *                     totalStars:
 *                       type: integer
 *                       description: Total Stars charged (0 when free only)
 *                       example: 25
 *                     freePostingApplied:
 *                       type: boolean
 *                       description: True when isPostingOn was enabled for free without an invoice
 *       "400":
 *         description: No new ad features selected, already active, or not the giveaway owner
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "401":
 *         description: Unauthorized
 */
giveawaysRouter.post(
  '/:giveawayId/advertising/invoice',
  auth,
  giveawayController.createAdvertisingInvoice as any,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/participation:
 *   get:
 *     summary: Check if user is already participating in giveaway
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully checked participation status
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
 *                     isParticipating:
 *                       type: boolean
 *                       example: false
 */
giveawaysRouter.get(
  '/:giveawayId/validate/participation',
  auth,
  giveawayController.checkUserParticipation,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/capacity:
 *   get:
 *     summary: Check if giveaway has reached maximum capacity
 *     tags:
 *       - Giveaway Validation
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully checked capacity status
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
 *                     isAtCapacity:
 *                       type: boolean
 *                       example: false
 */
giveawaysRouter.get(
  '/:giveawayId/validate/capacity',
  giveawayController.checkGiveawayCapacity,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/sponsors:
 *   get:
 *     summary: Check user subscription status for each giveaway sponsor channel
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully retrieved sponsor subscription status for each channel
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
 *                     channels:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           channelId:
 *                             type: integer
 *                             example: 123456789
 *                           isSubscribed:
 *                             type: boolean
 *                             example: true
 */
giveawaysRouter.get(
  '/:giveawayId/validate/sponsors',
  auth,
  giveawayController.checkSponsorSubscriptions,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/linked-channels:
 *   get:
 *     summary: Check user subscription status for each giveaway linked channel
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully retrieved linked channel subscription status for each channel
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
 *                     channels:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           channelId:
 *                             type: integer
 *                             example: 987654321
 *                           isSubscribed:
 *                             type: boolean
 *                             example: false
 */
giveawaysRouter.get(
  '/:giveawayId/validate/linked-channels',
  auth,
  giveawayController.checkLinkedChannelSubscriptions,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/referrals:
 *   get:
 *     summary: Check if user has enough referrals for giveaway
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully checked referral status
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
 *                     hasEnoughReferrals:
 *                       type: boolean
 *                       example: true
 *                     referrals:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             example: 123
 *                           username:
 *                             type: string
 *                             nullable: true
 *                             example: "john_doe"
 *                           first_name:
 *                             type: string
 *                             example: "John"
 *                           last_name:
 *                             type: string
 *                             nullable: true
 *                             example: "Doe"
 *                           photo_url:
 *                             type: string
 *                             example: "https://censored-link.com/photo.jpg"
 */
giveawaysRouter.get(
  '/:giveawayId/validate/referrals',
  auth,
  giveawayController.checkReferrals,
);

/**
 * @swagger
 * /api/giveaways/validate/premium:
 *   get:
 *     summary: Check if user has premium status
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully checked premium status
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
 *                     hasPremium:
 *                       type: boolean
 *                       example: true
 */
giveawaysRouter.get(
  '/validate/premium',
  auth,
  giveawayController.checkPremiumStatus,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/boosts:
 *   get:
 *     summary: Check boost status for each required channel in giveaway
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully retrieved boost status for each channel
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
 *                     channels:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           channelId:
 *                             type: integer
 *                             example: 123456789
 *                           isBoosting:
 *                             type: boolean
 *                             example: true
 */
giveawaysRouter.get(
  '/:giveawayId/validate/boosts',
  auth,
  giveawayController.checkChannelBoosts,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/country:
 *   get:
 *     summary: Check if user's country is allowed for giveaway
 *     tags:
 *       - Giveaway Validation
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully checked country restriction
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
 *                     isAllowed:
 *                       type: boolean
 *                       example: true
 *                     userCountry:
 *                       type: string
 *                       example: "US"
 */
giveawaysRouter.get(
  '/:giveawayId/validate/country',
  giveawayController.checkCountryRestriction,
);

/**
 * @swagger
 * /api/giveaways/validate/session:
 *   get:
 *     summary: Check if user has active session
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully checked session status
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
 *                     hasActiveSession:
 *                       type: boolean
 *                       example: true
 */
giveawaysRouter.get(
  '/validate/session',
  auth,
  giveawayController.checkActiveSession,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/balance:
 *   post:
 *     summary: Check if user has sufficient balance for giveaway participation
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tickets:
 *                 type: integer
 *                 minimum: 1
 *                 example: 3
 *                 description: Number of tickets (optional, defaults to 1)
 *     responses:
 *       "200":
 *         description: Successfully checked balance
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
 *                     hasSufficientBalance:
 *                       type: boolean
 *                       example: true
 */
giveawaysRouter.post(
  '/:giveawayId/validate/balance',
  auth,
  giveawayController.checkBalance,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate-participation:
 *   post:
 *     summary: Validate if user can participate in giveaway (checks ALL conditions except balance)
 *     tags:
 *       - Giveaway Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tickets:
 *                 type: integer
 *                 minimum: 1
 *                 example: 3
 *                 description: Number of tickets (optional, defaults to 1)
 *     responses:
 *       "200":
 *         description: User can participate (all conditions met, confirmation created)
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
 *                     canParticipate:
 *                       type: boolean
 *                       example: true
 *                     confirmationId:
 *                       type: string
 *                       format: uuid
 *                       description: Unique confirmation ID for this participation
 *                     tickets:
 *                       type: integer
 *                       example: 3
 *                       description: Number of tickets confirmed
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                       description: Confirmation expiration date (giveaway end time)
 *       "400":
 *         description: Bad request - one or more conditions not met
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/validate-participation',
  auth,
  giveawayController.validateParticipation,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/activate:
 *   post:
 *     summary: Manually activate a planned giveaway (creator or admin only)
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway to activate
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Successfully activated giveaway
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GiveawayDto'
 *       "400":
 *         description: Bad request - giveaway is not in planned state or already active
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized to activate this giveaway
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway or user not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/activate',
  auth,
  giveawayController.activateGiveaway,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/post-announcement:
 *   post:
 *     summary: Post giveaway announcement to linked channels (creator, admin, or channel owner)
 *     description: |
 *       Posts the giveaway announcement to the specified linked channels.
 *
 *       **Who can call this endpoint:**
 *       - **Giveaway creator or admin**: can post to any of the selected linked channels.
 *         Channels not owned by the creator trigger a sponsor approval request to the channel owner.
 *       - **Channel owner** (user listed in `addedBy` for a channel): can post only to the linked
 *         channels they own. Any `channelIds` in the request that the caller does not own are
 *         silently ignored. Returns 403 if none of the provided channels are owned by the caller.
 *
 *       **Which channels will actually receive the post:**
 *       - Creator/admin: the non-sponsor channels among `channelIds` are posted immediately;
 *         sponsor channels among `channelIds` receive an approval request instead.
 *       - Channel owner: only the subset of `channelIds` that belong to the caller.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway to post announcements for
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - channelIds
 *             properties:
 *               channelIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: |
 *                   IDs of the linked channels to post the announcement to.
 *                   Channel owners will only see their own channels posted; unowned IDs are ignored.
 *                 example: ["123456789", "987654321"]
 *     responses:
 *       "200":
 *         description: Successfully posted announcements
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
 *                     success:
 *                       type: integer
 *                       example: 3
 *                       description: Number of channels the announcement was directly posted to
 *                     failed:
 *                       type: integer
 *                       example: 0
 *                       description: Number of channels that failed to receive the post
 *                     sponsorApprovalsSent:
 *                       type: integer
 *                       example: 2
 *                       description: Number of sponsor approval requests sent (creator/admin path only)
 *       "400":
 *         description: Bad request - giveaway not active, cancelled, no linked channels, or no matching channelIds
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - caller is not the giveaway creator, an admin, or an owner of any selected channel
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway or user not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/post-announcement',
  auth,
  giveawayController.postAnnouncement,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/cancel:
 *   put:
 *     summary: Cancel a giveaway (creator or admin only)
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway to cancel
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CancelGiveawayRequestDto'
 *     responses:
 *       "200":
 *         description: Successfully cancelled giveaway
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/GiveawayDto'
 *       "400":
 *         description: Bad request - giveaway already cancelled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized to cancel this giveaway
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway or user not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.put(
  '/:giveawayId/cancel',
  auth,
  giveawayController.cancelGiveaway,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/channel-settings:
 *   patch:
 *     summary: Update result posting settings for caller's owned channels in a giveaway
 *     description: |
 *       Bulk-updates the per-channel result settings for all linked channels the caller owns
 *       (via `addedBy`) within the specified giveaway. Only the fields provided in the request
 *       body are changed; omitted fields are left unchanged.
 *
 *       **Per-channel settings** apply only to sponsor (non-creator) channels:
 *       - `isPostingResults` — whether the winner/cancel announcement is sent to this channel at all.
 *         Defaults to `false`; must be explicitly enabled by the channel owner.
 *       - `isResultsInMainPost` — append results to the original post instead of sending a new message.
 *       - `isCommentsOn` — use a comments hyperlink instead of an inline button in result posts.
 *
 *       Returns 403 if the caller does not own any channels linked to this giveaway.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isPostingResults:
 *                 type: boolean
 *                 description: Whether to send result announcements to the caller's channels
 *                 example: true
 *               isResultsInMainPost:
 *                 type: boolean
 *                 description: Append results to the original giveaway post instead of sending a separate message
 *                 example: false
 *               isCommentsOn:
 *                 type: boolean
 *                 description: Use a comments hyperlink instead of an inline button in result posts
 *                 example: false
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
 *                   properties:
 *                     updatedChannels:
 *                       type: integer
 *                       example: 2
 *                       description: Number of the caller's linked channels that were updated
 *       "403":
 *         description: Caller does not own any channels linked to this giveaway
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.patch(
  '/:giveawayId/channel-settings',
  auth,
  giveawayController.updateChannelSettings,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/finish:
 *   put:
 *     summary: Finish a giveaway and select winners (creator or admin only)
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway to finish
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Successfully finished giveaway with winners selected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/GiveawayDto'
 *                     - type: object
 *                       properties:
 *                         participants:
 *                           type: array
 *                           items:
 *                             allOf:
 *                               - $ref: '#/components/schemas/ParticipantDto'
 *                               - type: object
 *                                 properties:
 *                                   isWinner:
 *                                     type: boolean
 *                                     example: true
 *                                   winPlace:
 *                                     type: integer
 *                                     example: 1
 *       "400":
 *         description: Bad request - giveaway not active, already cancelled, or no participants
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized to finish this giveaway
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway or user not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.put(
  '/:giveawayId/finish',
  auth,
  giveawayController.finishGiveaway,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/referral:
 *   post:
 *     summary: Create a referral for a giveaway
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               referredId:
 *                 type: integer
 *                 description: ID of the user who referred you (whose referral link you clicked)
 *                 example: 456
 *             required:
 *               - referredId
 *     responses:
 *       "201":
 *         description: Successfully created referral
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
 *                     giveawayId:
 *                       type: string
 *                       format: uuid
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *                     referrerId:
 *                       type: integer
 *                       example: 456
 *                     referredId:
 *                       type: integer
 *                       example: 123
 *                     hasParticipated:
 *                       type: boolean
 *                       example: false
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-01-15T10:30:00Z"
 *                     giveaway:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         description:
 *                           type: string
 *                         banner:
 *                           type: string
 *                     referrer:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         username:
 *                           type: string
 *                         first_name:
 *                           type: string
 *                         last_name:
 *                           type: string
 *                     referred:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         username:
 *                           type: string
 *                         first_name:
 *                           type: string
 *                         last_name:
 *                           type: string
 *       "400":
 *         description: Bad request - giveaway not found, user not found, or invalid data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "409":
 *         description: Conflict - referral already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/referral',
  auth,
  giveawayController.createReferral,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/additional-tickets/status:
 *   get:
 *     summary: Get additional tickets status for authenticated user on a giveaway
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully retrieved ticket status
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
 *                     earnedFromRefs:
 *                       type: integer
 *                       example: 2
 *                     earnedFromBoosts:
 *                       type: integer
 *                       example: 1
 *                     maxAdditionalTickets:
 *                       type: integer
 *                       example: 10
 *                     remaining:
 *                       type: integer
 *                       nullable: true
 *                       example: 7
 *                     countRefsOnParticipation:
 *                       type: boolean
 *                       example: false
 *                       description: When true, only referrals who joined count toward extra tickets
 *                     qualifyingReferralsCount:
 *                       type: integer
 *                       example: 2
 *                       description: Referrals that count toward the next ticket (all refs or participated only)
 *                     refsPerTicket:
 *                       type: integer
 *                       example: 3
 *                     boostsPerTicket:
 *                       type: integer
 *                       example: 2
 *                     canEarnAdditionalTickets:
 *                       type: boolean
 *                       example: true
 *                     referralsTowardNextTicket:
 *                       type: integer
 *                       nullable: true
 *                       example: 2
 *                       description: Referrals counted toward the current extra-ticket cycle
 *                     referralsNeededForNextTicket:
 *                       type: integer
 *                       nullable: true
 *                       example: 1
 *                       description: Referrals still needed for the next extra ticket
 *                     ticketsFromQualifyingReferrals:
 *                       type: integer
 *                       nullable: true
 *                       example: 0
 *                       description: Full tickets from qualifying referrals (uncapped)
 *                     referrals:
 *                       type: array
 *                       description: Users this user has referred to the giveaway
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           username:
 *                             type: string
 *                             nullable: true
 *                           first_name:
 *                             type: string
 *                           last_name:
 *                             type: string
 *                             nullable: true
 *                           photo_url:
 *                             type: string
 *                           hasParticipated:
 *                             type: boolean
 *                             description: Whether the referred user has joined the giveaway
 *                     boostStatuses:
 *                       type: array
 *                       description: Linked channels and whether the user is currently boosting each
 *                       items:
 *                         type: object
 *                         properties:
 *                           channelId:
 *                             type: string
 *                           title:
 *                             type: string
 *                             nullable: true
 *                           username:
 *                             type: string
 *                             nullable: true
 *                           photo:
 *                             type: string
 *                             nullable: true
 *                           isBoosting:
 *                             type: boolean
 *                             example: true
 *       "400":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get(
  '/:giveawayId/additional-tickets/status',
  auth,
  giveawayController.getAdditionalTicketsStatus,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/additional-tickets/claim-boosts:
 *   post:
 *     summary: Claim additional tickets earned by boosting linked channels
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Boost tickets claimed successfully
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
 *                     awarded:
 *                       type: integer
 *                       example: 1
 *                     totalEarned:
 *                       type: integer
 *                       example: 3
 *                     remaining:
 *                       type: integer
 *                       nullable: true
 *                       example: 7
 *       "400":
 *         description: Giveaway not found or boost tickets not enabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/additional-tickets/claim-boosts',
  auth,
  giveawayController.claimBoostTickets,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/referral-link:
 *   get:
 *     summary: Get the authenticated user's persistent referral link for a giveaway
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *     responses:
 *       "200":
 *         description: Successfully retrieved referral link
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
 *                     url:
 *                       type: string
 *                       example: "https://t.me/bot?startapp=giveawayId_550e8400_ref_123456789"
 *       "400":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get(
  '/:giveawayId/referral-link',
  auth,
  giveawayController.getReferralLink,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants:
 *   get:
 *     summary: Get all participants of a giveaway with pagination
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of participants per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved participants
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedParticipantsResponse'
 *       "400":
 *         description: Bad request, invalid giveaway ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get(
  '/:giveawayId/participants',
  auth,
  paginateValidator,
  giveawayController.getAllParticipants,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/winners:
 *   get:
 *     summary: Get all main winners of a giveaway with pagination
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of participants per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved main winners
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedParticipantsResponse'
 *       "400":
 *         description: Bad request, invalid giveaway ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get(
  '/:giveawayId/participants/winners',
  auth,
  paginateValidator,
  giveawayController.getWinners,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/additional-winners:
 *   get:
 *     summary: Get all additional winners of a giveaway with pagination
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of participants per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved additional winners
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedParticipantsResponse'
 *       "400":
 *         description: Bad request, invalid giveaway ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get(
  '/:giveawayId/participants/additional-winners',
  auth,
  paginateValidator,
  giveawayController.getAdditionalWinners,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/non-winners:
 *   get:
 *     summary: Get all non-winner participants of a giveaway with pagination
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of participants per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved non-winner participants
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedParticipantsResponse'
 *       "400":
 *         description: Bad request, invalid giveaway ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get(
  '/:giveawayId/participants/non-winners',
  auth,
  paginateValidator,
  giveawayController.getNonWinnerParticipants,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/available-range:
 *   get:
 *     summary: Get available unique participant range for selecting additional winners
 *     description: Returns the total number of eligible unique participants and their position range for additional-winner selection
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Successfully retrieved available range
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
 *                     totalParticipants:
 *                       type: integer
 *                       example: 100
 *                       description: Total number of eligible unique participants
 *                     availableRange:
 *                       type: object
 *                       properties:
 *                         min:
 *                           type: integer
 *                           example: 1
 *                           description: Minimum position (always 1)
 *                         max:
 *                           type: integer
 *                           example: 100
 *                           description: Maximum position available
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get(
  '/:giveawayId/participants/available-range',
  auth,
  giveawayController.getAvailableRange,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/select-main-winners:
 *   post:
 *     summary: Select main winners from participants
 *     description: Select main winners from all participants or a specific range. If no parameters provided, selects 1 winner from all participants.
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rangeStart:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *                 description: Starting position in the participant list (1-based). Defaults to 1 (first participant)
 *                 example: 1
 *               rangeEnd:
 *                 type: integer
 *                 minimum: 1
 *                 description: Ending position in the participant list (1-based). Defaults to total number of participants
 *                 example: 100
 *               count:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *                 description: Number of main winners to select. Defaults to 1
 *                 example: 1
 *     responses:
 *       "200":
 *         description: Successfully selected main winners
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
 *                     $ref: '#/components/schemas/ParticipantDto'
 *       "400":
 *         description: Bad request - invalid range, insufficient participants, count exceeds winner slots, or giveaway not finished
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/participants/select-main-winners',
  auth,
  giveawayController.selectMainWinners,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/select-additional-winners:
 *   post:
 *     summary: Select additional winners from a range of unique participants
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rangeStart:
 *                 type: integer
 *                 minimum: 1
 *                 description: Starting position in the unique participant list (1-based)
 *                 example: 1
 *               rangeEnd:
 *                 type: integer
 *                 minimum: 1
 *                 description: Ending position in the unique participant list (1-based)
 *                 example: 100
 *               count:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of additional winners to select
 *                 example: 3
 *             required:
 *               - rangeStart
 *               - rangeEnd
 *               - count
 *     responses:
 *       "200":
 *         description: Successfully selected additional winners
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
 *                     $ref: '#/components/schemas/ParticipantDto'
 *       "400":
 *         description: Bad request - invalid range, insufficient participants, or giveaway not finished
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/participants/select-additional-winners',
  auth,
  giveawayController.selectAdditionalWinners,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/rechoose-additional-winner:
 *   post:
 *     summary: Rechoose an additional winner with a random eligible participant
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantUuid:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the additional winner participant to replace
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *             required:
 *               - participantUuid
 *     responses:
 *       "200":
 *         description: Successfully reselected an additional winner
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
 *                     oldWinner:
 *                       $ref: '#/components/schemas/ParticipantDto'
 *                     newWinner:
 *                       $ref: '#/components/schemas/ParticipantDto'
 *       "400":
 *         description: Bad request - participant not an additional winner, no available replacements, or giveaway not finished
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway or participant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/participants/rechoose-additional-winner',
  auth,
  giveawayController.rechooseAdditionalWinner,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/delete-additional-winner:
 *   post:
 *     summary: Delete an additional winner from the winners list
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantUuid:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the additional winner participant to remove
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *             required:
 *               - participantUuid
 *     responses:
 *       "200":
 *         description: Successfully removed an additional winner
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
 *                     removedWinner:
 *                       $ref: '#/components/schemas/ParticipantDto'
 *       "400":
 *         description: Bad request - participant not an additional winner or giveaway not finished
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway or participant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/participants/delete-additional-winner',
  auth,
  giveawayController.deleteAdditionalWinner,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/replace-winner:
 *   post:
 *     summary: Replace a winner with a random non-winner participant
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantUuid:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the winner participant to replace
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *             required:
 *               - participantUuid
 *     responses:
 *       "200":
 *         description: Successfully replaced winner
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
 *                     oldWinner:
 *                       $ref: '#/components/schemas/ParticipantDto'
 *                     newWinner:
 *                       $ref: '#/components/schemas/ParticipantDto'
 *       "400":
 *         description: Bad request - participant not a winner, no available replacements, or giveaway not finished
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway or participant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/participants/replace-winner',
  auth,
  giveawayController.replaceWinner,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/participants/remove-winner:
 *   post:
 *     summary: Remove a winner from the winners list
 *     tags:
 *       - Giveaway Participants
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The UUID of the giveaway
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantUuid:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the winner participant to remove
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *             required:
 *               - participantUuid
 *     responses:
 *       "200":
 *         description: Successfully removed winner
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
 *                     removedWinner:
 *                       $ref: '#/components/schemas/ParticipantDto'
 *       "400":
 *         description: Bad request - participant not a winner or giveaway not finished
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Forbidden - user not authorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Giveaway or participant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/participants/remove-winner',
  auth,
  giveawayController.removeWinner,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/sponsor-links/unvisited:
 *   get:
 *     summary: Get unvisited sponsor links for a giveaway
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *         description: Giveaway ID
 *     responses:
 *       200:
 *         description: List of unvisited sponsor links
 *       401:
 *         description: Unauthorized
 */
giveawaysRouter.get(
  '/:giveawayId/sponsor-links/unvisited',
  auth,
  sponsorLinkController.getUnvisited,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/validate/sponsor-links:
 *   get:
 *     summary: Validate if user has visited all required sponsor links
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *         description: Giveaway ID
 *     responses:
 *       200:
 *         description: Sponsor link validation result
 *       401:
 *         description: Unauthorized
 */
giveawaysRouter.get(
  '/:giveawayId/validate/sponsor-links',
  auth,
  giveawayController.validateSponsorLinks,
);

/**
 * @swagger
 * /api/giveaways/joints:
 *   get:
 *     summary: List giveaways with open sponsor slots
 *     description: Returns planned (not yet started) giveaways that have at least one unfilled sponsor slot. Used by the co-sponsor browse page.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *     responses:
 *       "200":
 *         description: Paginated list of giveaways with open co-sponsor slots
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
 *                     allOf:
 *                       - $ref: '#/components/schemas/GiveawayDto'
 *                       - type: object
 *                         properties:
 *                           filledSlots:
 *                             type: integer
 *                             example: 1
 *                             description: Number of accepted co-sponsor joints
 *                           freeSlots:
 *                             type: integer
 *                             example: 2
 *                             description: Remaining open co-sponsor slots
 *                 total:
 *                   type: integer
 *                   example: 42
 *                   description: Total giveaways with at least one open slot
 *                 page:
 *                   type: integer
 *                   example: 1
 *                 limit:
 *                   type: integer
 *                   example: 20
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.get('/joints', auth, giveawayController.getJoints);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/joints/payment-quote:
 *   get:
 *     summary: Get joint slot payment options and localized button labels
 *     description: |
 *       Returns Stars amount, wallet balance, eligibility flags, localized payment button labels,
 *       and API endpoints for wallet vs Telegram invoice payment flows.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *         description: Telegram channel ID owned by the caller
 *     responses:
 *       "200":
 *         description: Payment quote retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/JointPaymentQuoteDto'
 *       "400":
 *         description: Missing channelId or invalid giveaway
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Caller does not own the channel
 */
giveawaysRouter.get(
  '/:giveawayId/joints/payment-quote',
  auth,
  giveawayController.getJointPaymentQuote,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/joints:
 *   post:
 *     summary: Submit a join request for a sponsor slot
 *     description: |
 *       Channel owner requests to join a giveaway as a co-sponsor.
 *       Stars are deducted from the caller's balance. The giveaway creator receives a bot DM with Accept/Decline buttons.
 *       The requester receives a bot DM with a Withdraw button.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the target giveaway
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - channelId
 *             properties:
 *               channelId:
 *                 type: string
 *                 description: Telegram channel ID (BigInt as string) owned by the caller
 *                 example: "-1001234567890"
 *     responses:
 *       "201":
 *         description: Request submitted successfully
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
 *                     requestId:
 *                       type: integer
 *                       example: 42
 *       "400":
 *         description: No open slots, duplicate request, insufficient Stars balance, or giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Caller does not own the specified channel
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/joints',
  auth,
  giveawayController.createJoint,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/joints/{channelId}:
 *   delete:
 *     summary: Withdraw a pending join request
 *     description: |
 *       Cancels a Pending sponsor slot request. Stars are refunded to the caller's balance.
 *       Both the creator's and requester's bot messages are updated to show the withdrawal.
 *       The same action is also available via the bot's inline ❌ button (lw: callback).
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the giveaway
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *         description: Telegram channel ID (BigInt as string) used in the original request
 *         example: "-1001234567890"
 *     responses:
 *       "200":
 *         description: Request withdrawn successfully
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
 *                     success:
 *                       type: boolean
 *                       example: true
 *       "400":
 *         description: Request is not in Pending state
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Caller is not the original requester
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: Link request not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.delete(
  '/:giveawayId/joints/:channelId',
  auth,
  giveawayController.withdrawJoint,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/joints/invoice:
 *   post:
 *     summary: Create a Telegram Stars invoice for a co-sponsor slot
 *     description: |
 *       Generates a Telegram Stars invoice link so the channel owner can pay for a co-sponsor slot directly from their Telegram account (not the in-app wallet).
 *       After successful payment the bot's successful_payment handler calls processJointPayment to create the LinkRequest and send bot DMs.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the target giveaway
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - channelId
 *             properties:
 *               channelId:
 *                 type: string
 *                 description: Telegram channel ID (BigInt as string) owned by the caller
 *                 example: "-1001234567890"
 *     responses:
 *       "200":
 *         description: Invoice link created
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
 *                     invoiceLink:
 *                       type: string
 *                       description: Telegram Stars invoice URL
 *                       example: "https://t.me/$invoice_abc123"
 *       "400":
 *         description: No open slots, duplicate request, no price set, or giveaway not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "403":
 *         description: Caller does not own the specified channel
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
giveawaysRouter.post(
  '/:giveawayId/joints/invoice',
  auth,
  giveawayController.createJointInvoice,
);

/**
 * @swagger
 * /api/giveaways/{giveawayId}/postlot-channels:
 *   get:
 *     summary: Get channels available for republishing this giveaway
 *     description: Returns the authenticated user's channels that have not yet had this giveaway posted to them. Used by the frontend to enable/populate the Republish channel picker.
 *     tags:
 *       - Giveaways
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *         description: Giveaway UUID
 *     responses:
 *       "200":
 *         description: List of available channels
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     available:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           title:
 *                             type: string
 *                             nullable: true
 *                           username:
 *                             type: string
 *                             nullable: true
 *                           botCanPostMessages:
 *                             type: boolean
 *                     total:
 *                       type: integer
 *                       description: Number of available channels (0 means button should be disabled)
 */
giveawaysRouter.get(
  '/:giveawayId/postlot-channels',
  auth,
  giveawayController.getPostlotChannels.bind(giveawayController),
);

//  Gift prize routes (scoped under /:giveawayId) 
giveawaysRouter.use('/:giveawayId', prizeRouter);

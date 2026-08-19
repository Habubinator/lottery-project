import { Router } from 'express';
import { userController } from '../controllers';
import { paginateValidator } from '@common/validators';
import { auth } from '@auth/middlewares';
import { uploadMultipleFiles } from '@common/middlewares';

export const usersRouter = Router();

/**
 * @swagger
 * /api/users/all:
 *   get:
 *     summary: Get a paginated list of all users
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *         description: Number of users per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved users
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
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/UserDto'
 *                     meta:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         pageSize:
 *                           type: integer
 *                         pageCount:
 *                           type: integer
 *                         total:
 *                           type: integer
 *       "400":
 *         description: Bad request, invalid query parameters
 *       "500":
 *         description: Internal server error
 */
/**
 * @swagger
 * /api/users/search:
 *   get:
 *     summary: Search users by username, name, or Telegram ID
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query (username, first/last name, or Telegram ID)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       "200":
 *         description: Paginated list of matching users
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
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/UserDto'
 *                     meta:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         pageSize:
 *                           type: integer
 *                         pageCount:
 *                           type: integer
 *                         total:
 *                           type: integer
 *       "400":
 *         description: Bad request, missing or invalid query parameter
 *       "500":
 *         description: Internal server error
 */
usersRouter.get('/search', auth, userController.search);

usersRouter.get('/all', auth, paginateValidator, userController.getAll);

/**
 * @swagger
 * /api/users/one/{userId}:
 *   get:
 *     summary: Get a single user by ID with detailed statistics
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of user
 *     responses:
 *       "200":
 *         description: Successful user object with statistics
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
 *                     - $ref: '#/components/schemas/UserDto'
 *                     - type: object
 *                       properties:
 *                         statistics:
 *                           $ref: '#/components/schemas/UserStatisticsDto'
 *                         creatorStatistics:
 *                           $ref: '#/components/schemas/CreatorStatisticsDto'
 *       "400":
 *         description: Bad request (invalid ID)
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.get('/one/:userId', auth, userController.getOne);

/**
 * @swagger
 * /api/users/set-language:
 *   put:
 *     summary: Update current user's language preference
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lang
 *             properties:
 *               lang:
 *                 type: string
 *                 enum: [en, uk, ru]
 *                 description: Language code
 *                 example: en
 *     responses:
 *       "200":
 *         description: Successfully updated user language
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/UserDto'
 *       "400":
 *         description: Bad request, invalid language code
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.put('/set-language', auth, userController.setLang);

/**
 * @swagger
 * /api/users/{userId}/giveaways:
 *   get:
 *     summary: Get user's giveaway participations
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of user
 *       - in: query
 *         name: isActive
 *         required: true
 *         schema:
 *           type: boolean
 *         description: Filter by active/ended giveaways
 *       - in: query
 *         name: isPlanned
 *         schema:
 *           type: boolean
 *         description: Filter by planned/non-planned giveaways
 *         example: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *         description: Number of participations per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved user giveaways
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
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           userId:
 *                             type: integer
 *                           giveawayId:
 *                             type: string
 *                           isWinner:
 *                             type: boolean
 *                           winPlace:
 *                             type: integer
 *                           participatedAt:
 *                             type: string
 *                             format: date-time
 *                           giveaway:
 *                             $ref: '#/components/schemas/GiveawayDto'
 *                     meta:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         pageSize:
 *                           type: integer
 *                         pageCount:
 *                           type: integer
 *                         total:
 *                           type: integer
 *       "400":
 *         description: Bad request, invalid parameters
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.get(
  '/:userId/giveaways',
  auth,
  paginateValidator,
  userController.getUserGiveaways,
);

/**
 * @swagger
 * /api/users/{userId}/created-giveaways:
 *   get:
 *     summary: Get giveaways created by user
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of user
 *       - in: query
 *         name: isActive
 *         required: true
 *         schema:
 *           type: boolean
 *         description: Filter by active/ended giveaways
 *       - in: query
 *         name: isPlanned
 *         schema:
 *           type: boolean
 *         description: Filter by planned/non-planned giveaways
 *         example: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *         description: Number of giveaways per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved user created giveaways
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
 *                     items:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/GiveawayDto'
 *                           - type: object
 *                             properties:
 *                               createdBy:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: integer
 *                                   username:
 *                                     type: string
 *                                     nullable: true
 *                                   first_name:
 *                                     type: string
 *                                     nullable: true
 *                                   last_name:
 *                                     type: string
 *                                     nullable: true
 *                                   photo_url:
 *                                     type: boolean
 *                                     example: true
 *                               sponsoredBy:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *                                   properties:
 *                                     sponsorChannel:
 *                                       type: object
 *                                       nullable: true
 *                                       properties:
 *                                         id:
 *                                           type: string
 *                                         title:
 *                                           type: string
 *                                         username:
 *                                           type: string
 *                                           nullable: true
 *                                         photo:
 *                                           type: string
 *                                           nullable: true
 *                                     sponsorLink:
 *                                       type: object
 *                                       nullable: true
 *                                       properties:
 *                                         id:
 *                                           type: integer
 *                                         title:
 *                                           type: string
 *                                         link:
 *                                           type: string
 *                               _count:
 *                                 type: object
 *                                 properties:
 *                                   participants:
 *                                     type: integer
 *                     meta:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         pageSize:
 *                           type: integer
 *                         pageCount:
 *                           type: integer
 *                         total:
 *                           type: integer
 *       "400":
 *         description: Bad request, invalid parameters
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.get(
  '/:userId/created-giveaways',
  auth,
  paginateValidator,
  userController.getUserCreatedGiveaways,
);

/**
 * @swagger
 * /api/users/{userId}/planned-giveaways:
 *   get:
 *     summary: Get planned giveaways created by user
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of user
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *         description: Number of giveaways per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved user planned giveaways
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
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/GiveawayDto'
 *                     meta:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         pageSize:
 *                           type: integer
 *                         pageCount:
 *                           type: integer
 *                         total:
 *                           type: integer
 *       "400":
 *         description: Bad request, invalid parameters
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.get(
  '/:userId/planned-giveaways',
  auth,
  paginateValidator,
  userController.getUserPlannedGiveaways,
);

/**
 * @swagger
 * /api/users/pay-subscription:
 *   post:
 *     summary: Pay for a subscription tariff
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tariffId
 *             properties:
 *               tariffId:
 *                 type: integer
 *                 description: ID of the tariff to purchase
 *                 example: 1
 *               paymentCurrency:
 *                 type: string
 *                 enum: [Stars, TON]
 *                 description: Currency to use for payment (optional, defaults to tariff's default currency)
 *                 example: "TON"
 *     responses:
 *       "200":
 *         description: Successfully processed subscription payment
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
 *                     subscription:
 *                       type: object
 *                       properties:
 *                         userId:
 *                           type: integer
 *                         tariffId:
 *                           type: integer
 *                         subscriptionExpiringAt:
 *                           type: string
 *                           format: date-time
 *                         tariff:
 *                           $ref: '#/components/schemas/TariffDto'
 *                     newBalance:
 *                       type: object
 *                       properties:
 *                         starsBalance:
 *                           type: number
 *                           format: float
 *                         tonBalance:
 *                           type: number
 *                           format: float
 *       "400":
 *         description: Bad request, insufficient balance or invalid tariff
 *       "404":
 *         description: User, tariff, or wallet not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.post('/pay-subscription', auth, userController.paySubscription);

/**
 * @swagger
 * /api/users/update-ton-wallet:
 *   put:
 *     summary: Update current user's TON wallet address
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tonAddress:
 *                 type: string
 *                 description: TON wallet address (optional)
 *                 example: "EQDk2VTvn04SUKJrW7rXahzdF8_Qi6utb0wj43InCu9vdjrR"
 *             required: []
 *     responses:
 *       "200":
 *         description: Successfully updated TON wallet address
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/UserDto'
 *       "400":
 *         description: Bad request, invalid TON address
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.put('/update-ton-wallet', auth, userController.updateTonWallet);

/**
 * @swagger
 * /api/users/{userId}/channels:
 *   get:
 *     summary: Get user's channels with pagination
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of user
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *         description: Number of channels per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved user channels
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
 *                     items:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/ChannelDto'
 *                           - type: object
 *                             properties:
 *                               refferencedIn:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *                                   properties:
 *                                     giveaway:
 *                                       type: object
 *                                       properties:
 *                                         id:
 *                                           type: string
 *                                         description:
 *                                           type: string
 *                                           nullable: true
 *                                         isActive:
 *                                           type: boolean
 *                                         createdAt:
 *                                           type: string
 *                                           format: date-time
 *                               sponsoring:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *                                   properties:
 *                                     giveaway:
 *                                       type: object
 *                                       properties:
 *                                         id:
 *                                           type: string
 *                                         description:
 *                                           type: string
 *                                           nullable: true
 *                                         isActive:
 *                                           type: boolean
 *                                         createdAt:
 *                                           type: string
 *                                           format: date-time
 *                     meta:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         pageSize:
 *                           type: integer
 *                         pageCount:
 *                           type: integer
 *                         total:
 *                           type: integer
 *       "400":
 *         description: Bad request, invalid parameters
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.get(
  '/:userId/channels',
  auth,
  paginateValidator,
  userController.getMyChannels,
);

/**
 * @swagger
 * /api/users/{userId}/channels/last:
 *   get:
 *     summary: Get user's most recently updated channel
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of user
 *     responses:
 *       "200":
 *         description: Successfully retrieved last added channel
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   nullable: true
 *                   allOf:
 *                     - $ref: '#/components/schemas/ChannelDto'
 *                     - type: object
 *                       properties:
 *                         refferencedIn:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               giveaway:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: string
 *                                   description:
 *                                     type: string
 *                                     nullable: true
 *                                   isActive:
 *                                     type: boolean
 *                                   createdAt:
 *                                     type: string
 *                                     format: date-time
 *                         sponsoring:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               giveaway:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: string
 *                                   description:
 *                                     type: string
 *                                     nullable: true
 *                                   isActive:
 *                                     type: boolean
 *                                   createdAt:
 *                                     type: string
 *                                     format: date-time
 *       "400":
 *         description: Bad request, invalid user ID
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.get(
  '/:userId/channels/last',
  auth,
  userController.getLastAddedChannel,
);

/**
 * @swagger
 * /api/users/channels/search-history:
 *   get:
 *     summary: Get current user's channel search history
 *     description: Returns the last 10 channels the user previously added as sponsors via search. Populated automatically when sponsor channels are added to a giveaway.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved channel search history
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
 *                     $ref: '#/components/schemas/ChannelDto'
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
usersRouter.get(
  '/channels/search-history',
  auth,
  userController.getChannelSearchHistory,
);

/**
 * @swagger
 * /api/users/channels/{channelId}/sync:
 *   post:
 *     summary: Refresh channel metadata from Telegram
 *     description: |
 *       Updates title, username, and bot permission flags from Telegram.
 *       Also reconciles channel ownership (creator + administrators with app accounts).
 *       Caller must appear in addedBy for the channel.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *         description: Telegram channel ID
 *     responses:
 *       "200":
 *         description: Channel synced successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SyncedChannelDto'
 *       "403":
 *         description: Caller does not have access to the channel
 *       "400":
 *         description: Telegram sync failed
 */
usersRouter.post(
  '/channels/:channelId/sync',
  auth,
  userController.syncChannel,
);

/**
 * @swagger
 * /api/users/channels/search:
 *   get:
 *     summary: Search sponsor channels by username
 *     description: Search for active channels that can be added as sponsors. Excludes channels already added by the current user. All returned channels have isSponsor=true.
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query for channel username (case-insensitive)
 *         example: "tech"
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
 *         description: Number of channels per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved matching channels
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedSponsorChannelsResponse'
 *       "400":
 *         description: Bad request, missing or invalid query parameter
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
 *                   example: "Search query parameter \"q\" is required"
 *       "500":
 *         description: Internal server error
 */
usersRouter.get('/channels/search', auth, userController.searchChannels);

/**
 * @swagger
 * /api/users/notification-list:
 *   put:
 *     summary: Update current user's notification list setting
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - setting
 *             properties:
 *               setting:
 *                 type: string
 *                 enum: [FromAll, MyList, NoOne]
 *                 description: Notification list setting
 *                 example: FromAll
 *     responses:
 *       "200":
 *         description: Successfully updated notification list setting
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/UserDto'
 *       "400":
 *         description: Bad request, invalid setting
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.put(
  '/notification-list',
  auth,
  userController.setNotificationSetting,
);

/**
 * @swagger
 * /api/users/notification-channels:
 *   get:
 *     summary: Get all channels in user's notification list
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved notification channels
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/NotificationListDto'
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.get(
  '/notification-channels',
  auth,
  userController.getNotificationChannels,
);

/**
 * @swagger
 * /api/users/notification-channels:
 *   post:
 *     summary: Add channel to user's notification list by username
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - channelUsername
 *             properties:
 *               channelUsername:
 *                 type: string
 *                 description: Channel username to add
 *                 example: "my_channel"
 *     responses:
 *       "200":
 *         description: Successfully added channel to notification list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/NotificationListDto'
 *       "400":
 *         description: Bad request, invalid channel username
 *       "404":
 *         description: User or channel not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.post(
  '/notification-channels',
  auth,
  userController.addNotificationChannel,
);

/**
 * @swagger
 * /api/users/notification-channels/bulk:
 *   post:
 *     summary: Add multiple channels to user's notification list by their IDs
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
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
 *                   type: integer
 *                 description: Array of channel IDs to add
 *                 example: [1, 2, 3]
 *                 minItems: 1
 *     responses:
 *       "200":
 *         description: Successfully added channels to notification list
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
 *                     created:
 *                       type: integer
 *                       description: Number of new channels added
 *                       example: 2
 *                     skipped:
 *                       type: integer
 *                       description: Number of channels that were already in the list
 *                       example: 1
 *                     total:
 *                       type: integer
 *                       description: Total number of channel IDs provided
 *                       example: 3
 *                     items:
 *                       type: array
 *                       description: Array of created notification list entries
 *                       items:
 *                         $ref: '#/components/schemas/NotificationListDto'
 *       "400":
 *         description: Bad request, invalid channel IDs or empty array
 *       "404":
 *         description: User or one or more channels not found
 *       "500":
 *         description: Internal server error
 */
usersRouter.post(
  '/notification-channels/bulk',
  auth,
  userController.addMultipleNotificationChannels,
);

/**
 * @swagger
 * /api/users/notification-channels/{channelId}:
 *   delete:
 *     summary: Delete channel from user's notification list
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Channel ID to delete
 *     responses:
 *       "200":
 *         description: Successfully deleted channel from notification list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/NotificationListDto'
 *       "400":
 *         description: Bad request, invalid channel ID
 *       "404":
 *         description: User or channel not found in notification list
 *       "500":
 *         description: Internal server error
 */
usersRouter.delete(
  '/notification-channels/:channelId',
  auth,
  userController.deleteNotificationChannel,
);

/**
 * @swagger
 * /api/users/transactions/outcoming:
 *   get:
 *     summary: Get last 20 outcoming transactions from all users
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved outcoming transactions
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
 *                         example: "9223372036854775807"
 *                       userId:
 *                         type: integer
 *                         example: 1
 *                       walletId:
 *                         type: integer
 *                         example: 1
 *                       amount:
 *                         type: number
 *                         example: 100
 *                       currency:
 *                         type: string
 *                         enum: [Stars, TON]
 *                         example: "Stars"
 *                       type:
 *                         type: string
 *                         enum: [Incoming, Outcoming]
 *                         example: "Outcoming"
 *                       status:
 *                         type: string
 *                         enum: [Pending, Completed, Failed]
 *                         example: "Completed"
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-15T10:30:00Z"
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-15T10:30:00Z"
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             example: 1
 *                           telegramId:
 *                             type: string
 *                             example: "123456789"
 *                           username:
 *                             type: string
 *                             nullable: true
 *                             example: "john_doe"
 *                           firstName:
 *                             type: string
 *                             nullable: true
 *                             example: "John"
 *                           lastName:
 *                             type: string
 *                             nullable: true
 *                             example: "Doe"
 *                           languageCode:
 *                             type: string
 *                             nullable: true
 *                             example: "en"
 *                           isPremium:
 *                             type: boolean
 *                             example: false
 *                           roleId:
 *                             type: integer
 *                             example: 1
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           updatedAt:
 *                             type: string
 *                             format: date-time
 *                           role:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: integer
 *                                 example: 1
 *                               name:
 *                                 type: string
 *                                 example: "user"
 *                           wallet:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               id:
 *                                 type: integer
 *                                 example: 1
 *                               userId:
 *                                 type: integer
 *                                 example: 1
 *                               balance:
 *                                 type: number
 *                                 example: 500
 *                               currency:
 *                                 type: string
 *                                 enum: [Stars, TON]
 *                                 example: "Stars"
 *                               createdAt:
 *                                 type: string
 *                                 format: date-time
 *                               updatedAt:
 *                                 type: string
 *                                 format: date-time
 *                           subscription:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               id:
 *                                 type: integer
 *                                 example: 1
 *                               userId:
 *                                 type: integer
 *                                 example: 1
 *                               tariffId:
 *                                 type: integer
 *                                 example: 1
 *                               startDate:
 *                                 type: string
 *                                 format: date-time
 *                               endDate:
 *                                 type: string
 *                                 format: date-time
 *                               isActive:
 *                                 type: boolean
 *                                 example: true
 *                               createdAt:
 *                                 type: string
 *                                 format: date-time
 *                               updatedAt:
 *                                 type: string
 *                                 format: date-time
 *                               tariff:
 *                                 type: object
 *                                 properties:
 *                                   id:
 *                                     type: integer
 *                                     example: 1
 *                                   name:
 *                                     type: string
 *                                     example: "Premium"
 *                                   price:
 *                                     type: number
 *                                     example: 100
 *                                   durationDays:
 *                                     type: integer
 *                                     example: 30
 *                                   features:
 *                                     type: string
 *                                     example: "All features included"
 *                                   createdAt:
 *                                     type: string
 *                                     format: date-time
 *                                   updatedAt:
 *                                     type: string
 *                                     format: date-time
 *                       wallet:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             example: 1
 *                           userId:
 *                             type: integer
 *                             example: 1
 *                           balance:
 *                             type: number
 *                             example: 500
 *                           currency:
 *                             type: string
 *                             enum: [Stars, TON]
 *                             example: "Stars"
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           updatedAt:
 *                             type: string
 *                             format: date-time
 *       "500":
 *         description: Internal server error
 */
usersRouter.get(
  '/transactions/outcoming',
  auth,
  userController.getOutcomingTransactions,
);

/**
 * @swagger
 * /api/users/banners/temp:
 *   post:
 *     summary: Pre-upload banners temporarily
 *     description: Uploads banners to the server for 24 hours. Returned URLs can be used in giveaway creation. Prevents loss of banner selection when the WebApp is minimized.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               banner:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       "200":
 *         description: Upload successful
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
 *                     urls:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["/static/giveaways/uuid.jpg"]
 *       "401":
 *         description: Unauthorized
 */
usersRouter.post(
  '/banners/temp',
  auth,
  uploadMultipleFiles('giveaways', 'banner', 10, {
    fileFormats: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    sizeLimit: 50 * 1024 * 1024,
  }),
  userController.uploadTempBanners as any,
);

/**
 * @swagger
 * /api/users/banners/temp/one:
 *   delete:
 *     summary: Remove a single pre-uploaded banner
 *     description: Removes one banner from the user's temporary upload by URL. Deletes the file from disk and updates the DB record.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 example: "/static/giveaways/uuid.jpg"
 *     responses:
 *       "200":
 *         description: Removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       "401":
 *         description: Unauthorized
 */
usersRouter.delete('/banners/temp/one', auth, userController.removeTempBanner as any);

/**
 * @swagger
 * /api/users/banners/temp:
 *   delete:
 *     summary: Delete user's temporary banner uploads
 *     description: Deletes all pre-uploaded banners for the current user and their files from disk.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       "401":
 *         description: Unauthorized
 */
usersRouter.delete('/banners/temp', auth, userController.deleteTempBanners as any);

/**
 * @swagger
 * /api/users/description/request:
 *   post:
 *     summary: Request description input via bot
 *     description: Triggers the bot to DM the user asking them to send their giveaway description. Creates a 10-minute pending request. Re-calling resets the timer.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participationButtonText:
 *                 type: string
 *                 maxLength: 40
 *                 description: Draft custom participation button label for bot description preview
 *               participationButtonStyle:
 *                 type: string
 *                 enum: [primary, success, danger]
 *                 description: Draft Telegram button color for preview
 *               showParticipationCount:
 *                 type: boolean
 *                 default: true
 *                 description: Draft toggle for participant/ticket count suffix on preview button
 *               showParticipationMaxCount:
 *                 type: boolean
 *                 default: true
 *                 description: When true with ByCapacity, button shows •0/N; when false, only •0 (current count). Ignored when showParticipationCount is false.
 *               participiationType:
 *                 type: string
 *                 enum: [Random, Lottery]
 *                 description: Draft giveaway type for preview button icon
 *               language:
 *                 type: string
 *                 example: en
 *                 description: Draft language for preview button label
 *               completionType:
 *                 type: string
 *                 enum: [ByTime, ByCapacity]
 *                 description: Draft completion type for preview participant count (0/N for ByCapacity)
 *               maxParticipants:
 *                 type: integer
 *                 description: Draft max participants for ByCapacity preview button (shows 0/N)
 *     responses:
 *       "200":
 *         description: Bot DM sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       "400":
 *         description: No Telegram account linked
 *       "401":
 *         description: Unauthorized
 */
usersRouter.post('/description/request', auth, userController.requestDescription as any);

/**
 * @swagger
 * /api/users/description/poll:
 *   get:
 *     summary: Poll for submitted description
 *     description: Returns null if no active request, {isPending:true} while waiting, or {isPending:false, description, participationButtonText, participationButtonStyle, showParticipationCount, showParticipationMaxCount, participiationType, language} when the user pressed Save in the bot. Description is HTML-formatted. Frontend must pass the button fields into create/update giveaway.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Current poll state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   nullable: true
 *                   type: object
 *                   properties:
 *                     isPending:
 *                       type: boolean
 *                     description:
 *                       type: string
 *                     participationButtonText:
 *                       type: string
 *                       nullable: true
 *                     participationButtonStyle:
 *                       type: string
 *                       nullable: true
 *                       enum: [primary, success, danger]
 *                     showParticipationCount:
 *                       type: boolean
 *                       nullable: true
 *                       description: false = label only (no • count). From bot counter step "off".
 *                     showParticipationMaxCount:
 *                       type: boolean
 *                       nullable: true
 *                       description: true = •0/N for ByCapacity; false = •0 only. From bot counter step.
 *                     participiationType:
 *                       type: string
 *                       nullable: true
 *                     language:
 *                       type: string
 *                       nullable: true
 *       "401":
 *         description: Unauthorized
 */
usersRouter.get('/description/poll', auth, userController.pollDescription as any);

/**
 * @swagger
 * /api/users/description/request:
 *   delete:
 *     summary: Cancel pending description request
 *     description: Cleans up the pending request after the description has been consumed or the user cancels.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Request cancelled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       "401":
 *         description: Unauthorized
 */
usersRouter.delete('/description/request', auth, userController.cancelDescription as any);

/**
 * @swagger
 * /api/users/creation/abort:
 *   delete:
 *     summary: Abort giveaway creation
 *     description: Clears temp banners and description request for the user. Sends a bot notification if description input was started via bot. Called by frontend when the WebApp is closed mid-creation. No-op while an active (unexpired, unconfirmed) description-flow request exists — closing the Mini App to type the bot description must not wipe banners used in preview.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Creation aborted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       "401":
 *         description: Unauthorized
 */
usersRouter.delete('/creation/abort', auth, userController.abortCreation as any);

import { Router } from 'express';
import { walletController } from '../controllers';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';
import { exchangeRouter } from './exchange.router';
import { starsWithdrawalRouter } from './stars-withdrawal.router';

export const walletRouter = Router();

walletRouter.use('/exchange', exchangeRouter);
walletRouter.use('/stars-withdrawal', starsWithdrawalRouter);

/**
 * @swagger
 * /api/wallet:
 *   get:
 *     summary: Get user's wallet information
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved wallet information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/WalletDto'
 *       "404":
 *         description: Wallet not found (will be created automatically)
 *       "500":
 *         description: Internal server error
 */
walletRouter.get('/', auth, walletController.getWallet);

/**
 * @swagger
 * /api/wallet/stats:
 *   get:
 *     summary: Get wallet statistics and summary
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved wallet statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/WalletStatsDto'
 *       "500":
 *         description: Internal server error
 */
walletRouter.get('/stats', auth, walletController.getWalletStats);

/**
 * @swagger
 * /api/wallet/holding-status:
 *   get:
 *     summary: Get current Stars holding status
 *     description: Returns information about Stars currently on hold pending verification
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Successfully retrieved holding status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   oneOf:
 *                     - $ref: '#/components/schemas/HoldingStarsDto'
 *                     - type: null
 *                       description: No Stars currently on hold
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
walletRouter.get('/holding-status', auth, walletController.getHoldingStatus);

/**
 * @swagger
 * /api/wallet/transactions/all:
 *   get:
 *     summary: Get all transaction history (admin)
 *     description: Get transaction history for all users with optional filters (admin endpoint)
 *     tags:
 *       - Wallet
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
 *         description: Number of transactions per page
 *       - in: query
 *         name: transactionId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by specific transaction ID (UUID)
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           enum: [Stars, TON]
 *         description: Filter by currency type (Stars or TON)
 *         example: Stars
 *       - in: query
 *         name: isExchange
 *         schema:
 *           type: boolean
 *         description: Filter by exchange transactions (true = only exchange transactions, false = exclude exchange transactions)
 *         example: false
 *     responses:
 *       "200":
 *         description: Successfully retrieved all transaction history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedTransactionsResponse'
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "500":
 *         description: Internal server error
 */
walletRouter.get(
  '/transactions/all',
  auth,
  roles(Roles.SuperAdmin, Roles.Admin),
  walletController.getAllTransactionHistory,
);

/**
 * @swagger
 * /api/wallet/transactions:
 *   get:
 *     summary: Get user's transaction history
 *     tags:
 *       - Wallet
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
 *         description: Number of transactions per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved transaction history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedTransactionsResponse'
 *       "500":
 *         description: Internal server error
 */
walletRouter.get('/transactions', auth, walletController.getTransactionHistory);

/**
 * @swagger
 * /api/wallet/deposit:
 *   post:
 *     summary: Create a payment link for wallet deposit
 *     description: Creates payment link for wallet deposit. Stars deposits will be placed on hold for 21 s before being credited to the main balance.
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateDepositLinkRequestDto'
 *     responses:
 *       "200":
 *         description: Successfully created payment link
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
 *                     paymentLink:
 *                       type: string
 *                       example: "https://t.me/invoice/ABC123"
 *       "400":
 *         description: Bad request - invalid parameters or payment configuration
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       "404":
 *         description: User not found
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
walletRouter.post('/deposit', auth, walletController.createDepositLink);

// /**
//  * @swagger
//  * /api/wallet/giveaway/{giveawayId}/payment:
//  *   post:
//  *     summary: Create a payment link for giveaway entry
//  *     tags:
//  *       - Wallet
//  *     security:
//  *       - bearerAuth: []
//  *     parameters:
//  *       - in: path
//  *         name: giveawayId
//  *         required: true
//  *         schema:
//  *           type: string
//  *           format: uuid
//  *         description: The UUID of the giveaway
//  *         example: "550e8400-e29b-41d4-a716-446655440000"
//  *     requestBody:
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             properties:
//  *               tickets:
//  *                 type: integer
//  *                 minimum: 1
//  *                 example: 3
//  *                 description: Number of tickets to purchase (defaults to 1)
//  *     responses:
//  *       "200":
//  *         description: Successfully created giveaway payment link
//  *         content:
//  *           application/json:
//  *             schema:
//  *               type: object
//  *               properties:
//  *                 success:
//  *                   type: boolean
//  *                   example: true
//  *                 data:
//  *                   type: object
//  *                   properties:
//  *                     paymentLink:
//  *                       type: string
//  *                       example: "https://t.me/invoice/DEF456"
//  *       "400":
//  *         description: Bad request - giveaway not active, free entry, or payment configuration issues
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/ErrorResponse'
//  *       "404":
//  *         description: Giveaway not found
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/ErrorResponse'
//  *       "500":
//  *         description: Internal server error
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/ErrorResponse'
//  */
// walletRouter.post(
//   '/giveaway/:giveawayId/payment',
//   auth,
//   walletController.createGiveawayPaymentLink,
// );

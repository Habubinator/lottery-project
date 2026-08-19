import { Router } from 'express';
import { exchangeController } from '../controllers/exchange.controller';
import { auth } from '@auth/middlewares';

export const exchangeRouter = Router();

/**
 * @swagger
 * /api/wallet/exchange/preview:
 *   get:
 *     summary: Preview currency exchange rate
 *     description: Calculate how much you will receive without executing the exchange. Shows current exchange rate.
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: fromCurrency
 *         required: true
 *         schema:
 *           type: string
 *           enum: [Stars, TON]
 *         description: Currency to exchange from (currently only Stars allowed)
 *         example: Stars
 *       - in: query
 *         name: toCurrency
 *         required: true
 *         schema:
 *           type: string
 *           enum: [Stars, TON]
 *         description: Currency to exchange to (currently only TON allowed)
 *         example: TON
 *       - in: query
 *         name: amount
 *         required: true
 *         schema:
 *           type: number
 *           minimum: 0.01
 *         description: Amount to exchange
 *         example: 100
 *     responses:
 *       "200":
 *         description: Successfully calculated exchange preview
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
 *                     from:
 *                       type: object
 *                       properties:
 *                         currency:
 *                           type: string
 *                           example: "Stars"
 *                         amount:
 *                           type: number
 *                           example: 100
 *                     to:
 *                       type: object
 *                       properties:
 *                         currency:
 *                           type: string
 *                           example: "TON"
 *                         amount:
 *                           type: number
 *                           example: 1
 *                     rate:
 *                       type: object
 *                       properties:
 *                         starsInput:
 *                           type: number
 *                           example: 100
 *                           description: Amount of Stars in exchange rate
 *                         tonOutput:
 *                           type: number
 *                           example: 1
 *                           description: Amount of TON for starsInput
 *       "400":
 *         description: Bad request - invalid parameters
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
 *                   example: "Amount must be greater than 0"
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
exchangeRouter.get('/preview', auth, exchangeController.previewExchange);

/**
 * @swagger
 * /api/wallet/exchange:
 *   post:
 *     summary: Exchange currency (Stars ↔ TON)
 *     description: |
 *       Exchange Stars to TON or TON to Stars based on the current exchange rate.
 *       The exchange is executed immediately and balance is updated.
 *
 *       **Note:** Currently restricted to Stars → TON only. TON → Stars is temporarily disabled.
 *
 *       **Examples:**
 *       - If rate is 100 Stars = 1 TON:
 *         - Exchange 100 Stars → Get 1 TON (allowed)
 *         - Exchange 50 Stars → Get 0.5 TON (allowed)
 *         - Exchange 1 TON → Get 100 Stars (temporarily disabled)
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromCurrency
 *               - toCurrency
 *               - amount
 *             properties:
 *               fromCurrency:
 *                 type: string
 *                 enum: [Stars, TON]
 *                 description: Currency to exchange from (currently only Stars allowed)
 *                 example: Stars
 *               toCurrency:
 *                 type: string
 *                 enum: [Stars, TON]
 *                 description: Currency to exchange to (currently only TON allowed)
 *                 example: TON
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 description: Amount to exchange
 *                 example: 100
 *           examples:
 *             starsToTon:
 *               summary: Exchange Stars to TON (currently allowed)
 *               value:
 *                 fromCurrency: "Stars"
 *                 toCurrency: "TON"
 *                 amount: 100
 *             tonToStars:
 *               summary: Exchange TON to Stars (temporarily disabled)
 *               value:
 *                 fromCurrency: "TON"
 *                 toCurrency: "Stars"
 *                 amount: 1
 *     responses:
 *       "200":
 *         description: Successfully exchanged currency
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
 *                     wallet:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 1
 *                         userId:
 *                           type: integer
 *                           example: 123
 *                         starsBalance:
 *                           type: number
 *                           example: 50
 *                         holdedStarsBalance:
 *                           type: number
 *                           example: 0
 *                         tonBalance:
 *                           type: number
 *                           example: 1.5
 *                     exchanged:
 *                       type: object
 *                       properties:
 *                         from:
 *                           type: object
 *                           properties:
 *                             currency:
 *                               type: string
 *                               example: "Stars"
 *                             amount:
 *                               type: number
 *                               example: 100
 *                         to:
 *                           type: object
 *                           properties:
 *                             currency:
 *                               type: string
 *                               example: "TON"
 *                             amount:
 *                               type: number
 *                               example: 1
 *       "400":
 *         description: Bad request - invalid parameters or insufficient balance
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
 *                   example: "Insufficient Stars balance"
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: Wallet not found
 *       "500":
 *         description: Internal server error
 */
exchangeRouter.post('/', auth, exchangeController.exchangeCurrency);

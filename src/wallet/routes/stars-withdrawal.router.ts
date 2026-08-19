import { Router } from 'express';
import { auth } from '@auth/middlewares';
import { starsWithdrawalController } from '../controllers/stars-withdrawal.controller';

export const starsWithdrawalRouter = Router();

/**
 * @swagger
 * /api/wallet/stars-withdrawal/preview:
 *   get:
 *     summary: Preview Stars withdrawal (exchange to TON + withdrawal commission)
 *     description: |
 *       Calculates how much TON the user will receive when withdrawing Stars.
 *       Flow: convert Stars to TON at the admin exchange rate, then apply TON
 *       withdrawal commission (`tonPercent`, typically 5%) — same as direct TON withdrawal.
 *
 *       Use for the "Withdraw Stars" screen: Stars amount on top, net TON at the bottom.
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: starsAmount
 *         required: true
 *         schema:
 *           type: number
 *           minimum: 1
 *         description: Stars amount to withdraw (integer)
 *         example: 1000
 *     responses:
 *       "200":
 *         description: Quote with balances, limits, and TON wallet address
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/StarsWithdrawalPreviewDto'
 *       "400":
 *         description: Invalid starsAmount
 *       "401":
 *         description: Unauthorized
 */
starsWithdrawalRouter.get(
  '/preview',
  auth,
  starsWithdrawalController.preview.bind(starsWithdrawalController),
);

/**
 * @swagger
 * /api/wallet/stars-withdrawal:
 *   post:
 *     summary: Withdraw Stars (atomic exchange + TON withdrawal request)
 *     description: |
 *       Atomically exchanges Stars to TON and creates a TON withdrawal request
 *       for the converted amount. Commission is applied on the TON side (same as
 *       `POST /api/withdrawal` with `currency: TON`).
 *
 *       Requires `user.tonAddress` to be set. User must not have another pending withdrawal.
 *     tags:
 *       - Wallet
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StarsWithdrawalRequestDto'
 *     responses:
 *       "201":
 *         description: Exchange completed and TON withdrawal request created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/StarsWithdrawalResultDto'
 *       "400":
 *         description: Insufficient balance, missing TON address, pending withdrawal, or below minimums
 *       "401":
 *         description: Unauthorized
 */
starsWithdrawalRouter.post(
  '/',
  auth,
  starsWithdrawalController.submit.bind(starsWithdrawalController),
);

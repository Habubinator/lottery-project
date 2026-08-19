import { Router } from 'express';
import { TonController } from '../controllers/ton.controller';
import { auth } from '@auth/middlewares';
import { Roles } from '@auth/enums';
import { roles } from '@auth/middlewares';

const router = Router();
const tonController = new TonController();

/**
 * Public routes
 */

/**
 * @swagger
 * /api/ton/wallet:
 *   get:
 *     summary: Get TON wallet information
 *     description: Returns the configured TON wallet address and network (mainnet/testnet) for receiving payments
 *     tags:
 *       - TON Payments
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
 *                   type: object
 *                   properties:
 *                     walletAddress:
 *                       type: string
 *                       example: "EQDx1234567890abcdefghijklmnopqrstuvwxyz"
 *                       description: TON wallet address for receiving payments
 *                     network:
 *                       type: string
 *                       enum: [mainnet, testnet]
 *                       example: "testnet"
 *                       description: Current network configuration
 *       "500":
 *         description: Internal server error
 */
router.get('/wallet', tonController.getWalletInfo);

/**
 * Authenticated user routes
 */

/**
 * @swagger
 * /api/ton/invoice:
 *   post:
 *     summary: Create a TON payment invoice
 *     description: |
 *       Creates a new payment invoice for TON cryptocurrency payment.
 *       The invoice includes a unique ID that must be sent as a comment/memo with the payment.
 *
 *       **Payment Flow:**
 *       1. Create invoice via this endpoint
 *       2. User sends TON to the wallet address
 *       3. User includes the invoice ID as a comment in the transaction
 *       4. System automatically detects and processes the payment (cron runs every 2 minutes)
 *       5. User's wallet balance is updated
 *     tags:
 *       - TON Payments
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *             properties:
 *               userId:
 *                 type: integer
 *                 minimum: 1
 *                 example: 123
 *                 description: User ID for the payment
 *               amount:
 *                 type: number
 *                 format: decimal
 *                 minimum: 0.01
 *                 example: 0.5
 *                 description: Amount in TON cryptocurrency
 *               expirationMinutes:
 *                 type: integer
 *                 minimum: 1
 *                 default: 30
 *                 example: 30
 *                 description: Invoice expiration time in minutes (default 30)
 *           examples:
 *             basicInvoice:
 *               summary: Basic invoice
 *               value:
 *                 userId: 123
 *                 amount: 0.5
 *             customExpiration:
 *               summary: Invoice with custom expiration
 *               value:
 *                 userId: 123
 *                 amount: 1.5
 *                 expirationMinutes: 60
 *     responses:
 *       "201":
 *         description: Invoice created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Invoice created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     invoiceId:
 *                       type: string
 *                       format: uuid
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *                       description: Unique invoice ID - MUST be included as comment in TON payment
 *                     walletAddress:
 *                       type: string
 *                       example: "EQDx1234567890abcdefghijklmnopqrstuvwxyz"
 *                       description: TON wallet address to send payment to
 *                     amount:
 *                       type: number
 *                       format: decimal
 *                       example: 0.5
 *                       description: Amount to send in TON
 *                     comment:
 *                       type: string
 *                       format: uuid
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *                       description: Comment/memo to include with payment (same as invoiceId)
 *                     tonscanLink:
 *                       type: string
 *                       format: uri
 *                       example: "https://testnet.tonscan.org/address/EQDx1234..."
 *                       description: Link to view wallet on Tonscan blockchain explorer
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
 *                 error:
 *                   type: string
 *                   example: "userId and amount are required"
 *       "401":
 *         description: Unauthorized - invalid or missing token
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
router.post('/invoice', auth, tonController.createInvoice);

/**
 * @swagger
 * /api/ton/invoice/{invoiceId}:
 *   get:
 *     summary: Get invoice status
 *     description: Check the current status of a payment invoice (pending, completed, or expired)
 *     tags:
 *       - TON Payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID to check
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Invoice status retrieved successfully
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
 *                       type: string
 *                       format: uuid
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *                     userId:
 *                       type: integer
 *                       example: 123
 *                     amount:
 *                       type: number
 *                       format: decimal
 *                       example: 0.5
 *                     currency:
 *                       type: string
 *                       example: "TON"
 *                     status:
 *                       type: string
 *                       enum: [Pending, Completed, Expired, Cancelled]
 *                       example: "Pending"
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-01-25T12:30:00.000Z"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-01-25T12:00:00.000Z"
 *       "400":
 *         description: Bad request - invalid invoice ID
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: Invoice not found
 *       "500":
 *         description: Internal server error
 */
router.get('/invoice/:invoiceId', auth, tonController.getInvoiceStatus);

/**
 * @swagger
 * /api/ton/invoices/user/{userId}:
 *   get:
 *     summary: Get all pending invoices for a user
 *     description: Returns all pending (not completed or expired) invoices for a specific user
 *     tags:
 *       - TON Payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *         example: 123
 *     responses:
 *       "200":
 *         description: Invoices retrieved successfully
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
 *                         format: uuid
 *                       userId:
 *                         type: integer
 *                       amount:
 *                         type: number
 *                         format: decimal
 *                       currency:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [Pending, Completed, Expired, Cancelled]
 *                       expiresAt:
 *                         type: string
 *                         format: date-time
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       "400":
 *         description: Bad request - invalid user ID
 *       "401":
 *         description: Unauthorized
 *       "500":
 *         description: Internal server error
 */
router.get('/invoices/user/:userId', auth, tonController.getUserInvoices);

/**
 * @swagger
 * /api/ton/invoice/{invoiceId}:
 *   delete:
 *     summary: Cancel an invoice
 *     description: Cancel a pending invoice. Only pending invoices can be cancelled.
 *     tags:
 *       - TON Payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID to cancel
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Invoice cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Invoice cancelled successfully"
 *       "400":
 *         description: Bad request - invalid invoice ID
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: Invoice not found or cannot be cancelled
 *       "500":
 *         description: Internal server error
 */
router.delete('/invoice/:invoiceId', auth, tonController.cancelInvoice);

/**
 * Admin routes
 */

/**
 * @swagger
 * /api/ton/process-transactions:
 *   post:
 *     summary: Manually trigger transaction processing (Admin only)
 *     description: |
 *       Manually trigger the processing of incoming TON transactions.
 *       Normally this runs automatically via cron job every 2 minutes.
 *
 *       This endpoint:
 *       - Fetches recent transactions from TON blockchain
 *       - Matches them with pending invoices
 *       - Updates wallet balances
 *       - Creates transaction history records
 *
 *       Only accessible by admin and superadmin users.
 *     tags:
 *       - TON Payments
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Transactions processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Processed 3 payments"
 *                 data:
 *                   type: object
 *                   properties:
 *                     processedCount:
 *                       type: integer
 *                       example: 3
 *                       description: Number of payments processed
 *                     payments:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           invoiceId:
 *                             type: string
 *                             format: uuid
 *                             example: "550e8400-e29b-41d4-a716-446655440000"
 *                           userId:
 *                             type: integer
 *                             example: 123
 *                           amount:
 *                             type: number
 *                             format: decimal
 *                             example: 0.5
 *                           transactionHash:
 *                             type: string
 *                             example: "abc123def456..."
 *                           tonscanLink:
 *                             type: string
 *                             format: uri
 *                             example: "https://tonscan.org/tx/abc123def456..."
 *                           walletBalanceBefore:
 *                             type: number
 *                             format: decimal
 *                             example: 1.5
 *                           walletBalanceAfter:
 *                             type: number
 *                             format: decimal
 *                             example: 2.0
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - user is not an admin
 *       "500":
 *         description: Internal server error
 */
router.post(
  '/process-transactions',
  auth,
  roles(Roles.SuperAdmin, Roles.Admin),
  tonController.processTransactions,
);

/**
 * @swagger
 * /api/ton/verify-transaction:
 *   post:
 *     summary: Manually verify and process a specific transaction (Admin only)
 *     description: |
 *       Verify that a specific transaction exists on the blockchain and process it manually.
 *       Useful for debugging or resolving payment issues.
 *
 *       This endpoint:
 *       - Fetches the transaction from blockchain by hash
 *       - Verifies it matches the invoice (amount, comment)
 *       - Processes the payment if valid
 *
 *       Only accessible by admin and superadmin users.
 *     tags:
 *       - TON Payments
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionHash
 *               - invoiceId
 *             properties:
 *               transactionHash:
 *                 type: string
 *                 example: "abc123def456789..."
 *                 description: TON transaction hash to verify
 *               invoiceId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *                 description: Invoice ID to match with transaction
 *           examples:
 *             verifyTransaction:
 *               summary: Verify transaction
 *               value:
 *                 transactionHash: "abc123def456789..."
 *                 invoiceId: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Transaction verified and processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Transaction verified and processed"
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: true
 *                     payment:
 *                       type: object
 *                       properties:
 *                         invoiceId:
 *                           type: string
 *                           format: uuid
 *                         userId:
 *                           type: integer
 *                         amount:
 *                           type: number
 *                           format: decimal
 *                         transactionHash:
 *                           type: string
 *                         tonscanLink:
 *                           type: string
 *                           format: uri
 *                         walletBalanceBefore:
 *                           type: number
 *                           format: decimal
 *                         walletBalanceAfter:
 *                           type: number
 *                           format: decimal
 *       "400":
 *         description: Bad request or transaction verification failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Transaction not found on blockchain"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - user is not an admin
 *       "404":
 *         description: Invoice not found
 *       "500":
 *         description: Internal server error
 */
router.post(
  '/verify-transaction',
  auth,
  roles(Roles.SuperAdmin, Roles.Admin),
  tonController.verifyTransaction,
);

/**
 * @swagger
 * /api/ton/encode-payload:
 *   post:
 *     summary: Encode text as a TON cell payload
 *     description: Encodes a text string into a TON comment cell (uint32 opcode 0 + string tail) and returns it as a base64 BOC string. Use as the payload field when sending TON transactions with a comment.
 *     tags:
 *       - TON Payments
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 example: "invoice_123"
 *     responses:
 *       "200":
 *         description: Encoded payload
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
 *                     payload:
 *                       type: string
 *                       description: Base64-encoded BOC of the TON cell
 *       "400":
 *         description: text field missing or not a string
 */
router.post('/encode-payload', tonController.encodePayload);

export default router;

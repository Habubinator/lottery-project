import { Router } from 'express';
import { withdrawalController } from '../controllers';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';
import { uploadMultipleFiles } from '@common/middlewares';
export const withdrawalRouter = Router();

/**
 * @swagger
 * /api/withdrawal:
 *   post:
 *     summary: Create a withdrawal request
 *     description: Creates a new withdrawal request for the authenticated user
 *     tags:
 *       - Withdrawal
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currency
 *               - amount
 *             properties:
 *               currency:
 *                 type: string
 *                 enum: [Stars, TON]
 *                 example: Stars
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 100
 *               notes:
 *                 type: string
 *                 example: "Please send to my TON wallet"
 *     responses:
 *       "201":
 *         description: Successfully created withdrawal request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/WithdrawalDto'
 *       "400":
 *         description: Bad request - insufficient balance or pending withdrawals
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: User or wallet not found
 *       "500":
 *         description: Internal server error
 */
withdrawalRouter.post('/', auth, withdrawalController.createWithdrawal);

/**
 * @swagger
 * /api/withdrawal/my:
 *   get:
 *     summary: Get user's withdrawal requests
 *     description: Retrieves all withdrawal requests for the authenticated user
 *     tags:
 *       - Withdrawal
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
 *         description: Number of withdrawals per page
 *     responses:
 *       "200":
 *         description: Successfully retrieved user withdrawals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedWithdrawalsResponse'
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: User not found
 *       "500":
 *         description: Internal server error
 */
withdrawalRouter.get('/my', auth, withdrawalController.getUserWithdrawals);

/**
 * @swagger
 * /api/withdrawal/{withdrawalId}:
 *   get:
 *     summary: Get specific withdrawal request
 *     description: Retrieves details of a specific withdrawal request
 *     tags:
 *       - Withdrawal
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: withdrawalId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the withdrawal request
 *         example: 123
 *     responses:
 *       "200":
 *         description: Successfully retrieved withdrawal request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/WithdrawalDto'
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: Withdrawal request not found
 *       "500":
 *         description: Internal server error
 */
withdrawalRouter.get(
  '/:withdrawalId',
  auth,
  withdrawalController.getWithdrawal,
);

// Admin routes
/**
 * @swagger
 * /api/withdrawal/admin/all:
 *   get:
 *     summary: Get all withdrawal requests (Admin only)
 *     description: Retrieves all withdrawal requests with optional status filtering
 *     tags:
 *       - Withdrawal
 *       - Admin
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
 *         description: Number of withdrawals per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Reviewed, Accepted, Denied]
 *         description: Filter by withdrawal status
 *     responses:
 *       "200":
 *         description: Successfully retrieved all withdrawals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaginatedWithdrawalsResponse'
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - Admin access required
 *       "500":
 *         description: Internal server error
 */
withdrawalRouter.get(
  '/admin/all',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  withdrawalController.getAllWithdrawals,
);

/**
 * @swagger
 * /api/withdrawal/{withdrawalId}/approve:
 *   post:
 *     summary: Approve withdrawal request (Admin only)
 *     description: Approves a withdrawal request and processes the payment
 *     tags:
 *       - Withdrawal
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: withdrawalId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the withdrawal request
 *         example: 123
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["https://censored-link.com/photo1.jpg", "https://censored-link.com/photo2.jpg"]
 *                 description: Optional array of photo URLs as proof of payment
 *               notes:
 *                 type: string
 *                 example: "Payment processed via bank transfer"
 *                 description: Optional admin notes
 *     responses:
 *       "200":
 *         description: Successfully approved withdrawal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/WithdrawalDto'
 *       "400":
 *         description: Bad request - already processed or insufficient balance
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - Admin access required
 *       "404":
 *         description: Withdrawal request not found
 *       "500":
 *         description: Internal server error
 */
withdrawalRouter.post(
  '/:withdrawalId/approve',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  uploadMultipleFiles('withdrawal', 'photos', 5, {
    fileFormats: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'],
    sizeLimit: 50 * 1024 * 1024, // 50MB in bytes
  }),
  withdrawalController.approveWithdrawal,
);

/**
 * @swagger
 * /api/withdrawal/{withdrawalId}/reject:
 *   post:
 *     summary: Reject withdrawal request (Admin only)
 *     description: Rejects a withdrawal request with optional reason and photos
 *     tags:
 *       - Withdrawal
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: withdrawalId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the withdrawal request
 *         example: 123
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["https://censored-link.com/screenshot.jpg"]
 *                 description: Optional array of photo URLs as proof of rejection reason
 *               notes:
 *                 type: string
 *                 example: "Invalid TON address provided"
 *                 description: Reason for rejection
 *     responses:
 *       "200":
 *         description: Successfully rejected withdrawal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/WithdrawalDto'
 *       "400":
 *         description: Bad request - already processed
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden - Admin access required
 *       "404":
 *         description: Withdrawal request not found
 *       "500":
 *         description: Internal server error
 */
withdrawalRouter.post(
  '/:withdrawalId/reject',
  auth,
  roles(Roles.Admin, Roles.SuperAdmin),
  uploadMultipleFiles('withdrawal', 'photos', 5, {
    fileFormats: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'],
    sizeLimit: 50 * 1024 * 1024, // 50MB in bytes
  }),
  withdrawalController.rejectWithdrawal,
);

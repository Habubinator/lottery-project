import { Router } from 'express';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';
import { userbotAdminController } from '../controllers/userbot-admin.controller';

export const userbotAdminRouter = Router();
const adminOnly = [auth, roles(Roles.SuperAdmin, Roles.Admin)];

/**
 * @swagger
 * tags:
 *   name: UserbotAdmin
 *   description: Userbot session management and re-authentication
 */

/**
 * @swagger
 * /api/admin/userbot/status:
 *   get:
 *     summary: Get userbot session status for both accounts
 *     tags: [UserbotAdmin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Session status for Standard and Unique accounts
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
 *                     standard:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [active, revoked, needs_reauth, not_configured]
 *                         authState:
 *                           type: string
 *                           enum: [idle, waiting_code, waiting_password]
 *                         updatedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                     unique:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [active, revoked, needs_reauth, not_configured]
 *                         authState:
 *                           type: string
 *                           enum: [idle, waiting_code, waiting_password]
 *                         updatedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 */
userbotAdminRouter.get('/status', ...adminOnly, userbotAdminController.getStatus);

/**
 * @swagger
 * /api/admin/userbot/phone:
 *   patch:
 *     summary: Set or update the phone number for a userbot account
 *     tags: [UserbotAdmin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountType, phoneNumber]
 *             properties:
 *               accountType:
 *                 type: string
 *                 enum: [Standard, Unique]
 *               phoneNumber:
 *                 type: string
 *                 example: "+380991234567"
 *     responses:
 *       200:
 *         description: Phone number updated
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
 *                     accountType:
 *                       type: string
 *                       enum: [Standard, Unique]
 *                     phoneNumber:
 *                       type: string
 *                       example: "+380991234567"
 *                     status:
 *                       type: string
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 */
userbotAdminRouter.patch('/phone', ...adminOnly, userbotAdminController.updatePhone);

/**
 * @swagger
 * /api/admin/userbot/auth/start:
 *   post:
 *     summary: Step 1 — send OTP to account phone
 *     tags: [UserbotAdmin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountType]
 *             properties:
 *               accountType:
 *                 type: string
 *                 enum: [Standard, Unique]
 *     responses:
 *       200:
 *         description: OTP sent to account phone
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
 *                   example: "OTP sent to account phone"
 */
userbotAdminRouter.post('/auth/start', ...adminOnly, userbotAdminController.startAuth);

/**
 * @swagger
 * /api/admin/userbot/auth/confirm:
 *   post:
 *     summary: Step 2 — confirm OTP code
 *     tags: [UserbotAdmin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountType, code]
 *             properties:
 *               accountType:
 *                 type: string
 *                 enum: [Standard, Unique]
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Authenticated successfully, or requires2FA=true if 2FA password is needed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 requires2FA:
 *                   type: boolean
 *                   example: false
 */
userbotAdminRouter.post('/auth/confirm', ...adminOnly, userbotAdminController.confirmCode);

/**
 * @swagger
 * /api/admin/userbot/auth/2fa:
 *   post:
 *     summary: Step 3 — submit 2FA password (only if confirm returned requires2FA)
 *     tags: [UserbotAdmin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountType, password]
 *             properties:
 *               accountType:
 *                 type: string
 *                 enum: [Standard, Unique]
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 2FA confirmed and session saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 */
userbotAdminRouter.post('/auth/2fa', ...adminOnly, userbotAdminController.submit2FA);

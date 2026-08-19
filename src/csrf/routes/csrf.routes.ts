import { Router } from 'express';
import { csrfController } from '../controllers';

export const csrfRouter = Router();

/**
 * @swagger
 * /api/csrf:
 *   get:
 *     summary: Get CSRF token
 *     tags:
 *       - CSRF
 *     responses:
 *       "200":
 *         description: Success
 *       "500":
 *         description: Internal server error
 */
csrfRouter.get('/', csrfController.createToken);

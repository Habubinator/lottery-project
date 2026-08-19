import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';
import { permissionsController } from '../controllers';
import { Router } from 'express';
import { getAllPermissionsValidator } from '@permissions/validators';

export const permissionsRouter = Router();

/**
 * @swagger
 * /api/permissions:
 *   get:
 *     summary: Get all permissions
 *     description: Get all permissions with translations
 *     tags:
 *       - Permissions
 *     parameters:
 *       - in: query
 *         name: roleId
 *         schema:
 *           type: number
 *           enum: [2,3,4]
 *         description: Role
 *     responses:
 *       "200":
 *         description: Success
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden resource
 *       "500":
 *         description: Internal server error
 * */
permissionsRouter.get(
  '/',
  auth,
  roles(Roles.SuperAdmin, Roles.Admin),
  getAllPermissionsValidator,
  permissionsController.getAll,
);

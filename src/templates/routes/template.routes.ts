import { Router } from 'express';
import { templateController } from '../controllers';
import { auth } from '@auth/middlewares';

export const templateRouter = Router();

/**
 * @swagger
 * /api/templates:
 *   post:
 *     summary: Create a new template from a giveaway
 *     tags:
 *       - Templates
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - giveawayId
 *             properties:
 *               giveawayId:
 *                 type: string
 *                 format: uuid
 *                 description: The ID of the giveaway to create a template from
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               name:
 *                 type: string
 *                 nullable: true
 *                 description: Optional template name (max 100 characters)
 *                 example: "My Giveaway Template"
 *     responses:
 *       "201":
 *         description: Template created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TemplateDto'
 *       "400":
 *         description: Bad request - Giveaway not found or template already exists
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "422":
 *         description: Validation error - Invalid giveawayId format
 *       "500":
 *         description: Internal server error
 */
templateRouter.post('/', auth, templateController.create);

/**
 * @swagger
 * /api/templates/{templateId}:
 *   delete:
 *     summary: Delete a template by its owner
 *     tags:
 *       - Templates
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Template ID to delete
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Template deleted successfully
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
 *         description: Bad request - Template not found
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "403":
 *         description: Forbidden - User is not the template owner
 *       "500":
 *         description: Internal server error
 */
templateRouter.delete('/:templateId', auth, templateController.delete);

/**
 * @swagger
 * /api/templates:
 *   get:
 *     summary: Get all templates of the request user
 *     tags:
 *       - Templates
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       "200":
 *         description: Templates retrieved successfully
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
 *                     $ref: '#/components/schemas/TemplateDto'
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "500":
 *         description: Internal server error
 */
templateRouter.get('/', auth, templateController.getAllUserTemplates);

/**
 * @swagger
 * /api/templates/search:
 *   get:
 *     summary: Search user's templates by name
 *     tags:
 *       - Templates
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: name
 *         required: false
 *         schema:
 *           type: string
 *         description: Search query for template name (case-insensitive)
 *         example: "My Template"
 *     responses:
 *       "200":
 *         description: Templates retrieved successfully
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
 *                     $ref: '#/components/schemas/TemplateDto'
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "500":
 *         description: Internal server error
 */
templateRouter.get('/search', auth, templateController.searchByName);

/**
 * @swagger
 * /api/templates/check/{giveawayId}:
 *   get:
 *     summary: Check if template exists for a giveaway
 *     tags:
 *       - Templates
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: giveawayId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Giveaway ID to check
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Check completed successfully
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
 *                     exists:
 *                       type: boolean
 *                       description: Whether template exists for this giveaway
 *                       example: true
 *                     templateId:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *                       description: Template ID if exists, null otherwise
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "500":
 *         description: Internal server error
 */
templateRouter.get('/check/:giveawayId', auth, templateController.checkTemplateExists);

/**
 * @swagger
 * /api/templates/{templateId}/name:
 *   patch:
 *     summary: Update template name by its owner
 *     tags:
 *       - Templates
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Template ID to update
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 nullable: true
 *                 description: New template name (max 100 characters, empty string or null clears the name)
 *                 example: "My Giveaway Template"
 *     responses:
 *       "200":
 *         description: Template name updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TemplateDto'
 *       "400":
 *         description: Bad request - Template not found or invalid name
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "403":
 *         description: Forbidden - User is not the template owner
 *       "422":
 *         description: Validation error - Name exceeds 100 characters
 *       "500":
 *         description: Internal server error
 */
templateRouter.patch('/:templateId/name', auth, templateController.updateName);

/**
 * @swagger
 * /api/templates/{templateId}:
 *   get:
 *     summary: Get one user's template of the request user
 *     tags:
 *       - Templates
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Template ID to retrieve
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       "200":
 *         description: Template retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TemplateDto'
 *       "400":
 *         description: Bad request - Template not found
 *       "401":
 *         description: Unauthorized - Invalid or missing access token
 *       "403":
 *         description: Forbidden - User is not the template owner
 *       "500":
 *         description: Internal server error
 */
templateRouter.get('/:templateId', auth, templateController.getOneUserTemplate);

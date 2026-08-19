import { HttpCodes } from '@common/enums';
import { validateRequest } from '@common/utils';
import type { NextFunction, Response } from 'express';
import { templateService } from '../services';
import { AuthorizedRequest } from '@auth/types';
import { CreateTemplateDto, UpdateTemplateNameDto } from '../dto';

class TemplateController {
  async create(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const dto = new CreateTemplateDto(req.body);
      const data = await templateService.create(req.user.id, dto);

      res.status(HttpCodes.Created).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async delete(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const templateId = req.params.templateId;
      const data = await templateService.delete(templateId, req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getAllUserTemplates(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const data = await templateService.getAllUserTemplates(req.user.id);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async getOneUserTemplate(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const templateId = req.params.templateId;
      const data = await templateService.getOneUserTemplate(
        templateId,
        req.user.id,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async checkTemplateExists(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      validateRequest(req);

      const giveawayId = req.params.giveawayId;
      const data = await templateService.checkTemplateExists(
        giveawayId,
        req.user.id,
      );

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async updateName(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const templateId = req.params.templateId;
      const dto = new UpdateTemplateNameDto(req.body);
      const data = await templateService.updateName(templateId, req.user.id, dto);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }

  async searchByName(req: AuthorizedRequest, res: Response, next: NextFunction) {
    try {
      validateRequest(req);

      const searchQuery = (req.query.name as string) || '';
      const data = await templateService.searchByName(req.user.id, searchQuery);

      res.status(HttpCodes.Ok).json({ success: true, data });
    } catch (e: unknown) {
      console.error(e);
      next(e);
    }
  }
}

export const templateController = new TemplateController();

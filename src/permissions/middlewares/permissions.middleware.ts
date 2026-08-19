import type { AuthorizedRequest } from '@auth/types';
import { ErrorCodes } from '@common/enums';
import { HttpException } from '@common/exceptions';
import type { NextFunction, Response } from 'express';
import { permissionsService } from '../services';
import { Roles } from '@auth/enums';

export const permissions =
  (resource: string, action: string, selfRequestKey?: string) =>
  async (req: AuthorizedRequest, _: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        next(HttpException.Forbidden(ErrorCodes.Forbidden));
        return;
      }

      if (
        req.user.role.id === Roles.SuperAdmin ||
        (selfRequestKey && req.user.id === +req.params?.[selfRequestKey])
      ) {
        next();
        return;
      }

      const canAccess = await permissionsService.canAccess(
        req.user,
        resource,
        action,
      );

      if (!canAccess) {
        next(
          HttpException.Forbidden(
            ErrorCodes.Permissions,
            req.__('permissions.notEnough'),
          ),
        );
        return;
      }

      next();
    } catch {
      next(HttpException.Forbidden(ErrorCodes.Forbidden));
    }
  };

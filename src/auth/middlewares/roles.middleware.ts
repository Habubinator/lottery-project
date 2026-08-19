import { Roles } from '../enums';
import type { AuthorizedRequest } from '../types';
import { ErrorCodes } from '@common/enums';
import { HttpException } from '@common/exceptions';
import type { NextFunction, Response } from 'express';

export const roles =
  (...roles: Roles[]) =>
  (req: AuthorizedRequest, _: Response, next: NextFunction) => {
    if (roles.includes(req?.user?.role?.id)) {
      next();
      return;
    }

    next(
      HttpException.Forbidden(
        ErrorCodes.Roles,
        req.__('permissions.notEnough'),
      ),
    );
  };

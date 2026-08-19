import type { Request } from 'express';
import { validationResult, Meta } from 'express-validator';
import { HttpException } from '../exceptions';
import { ErrorCodes } from '../enums';
import { User } from '@prisma/client';
import { AuthorizedRequest } from '@auth/types';
import { Roles } from '@auth/enums';

export const validateRequest = (req: Request) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw HttpException.BadRequest(
      ErrorCodes.Validation,
      req.__('errors.validationError'),
      errors.array(),
    );
  }
};

export const validatorMessage =
  (key: string, ...replace: any[]) =>
  (_: unknown, meta: Meta) =>
    meta.req.__(`validation.${key}`, ...replace);

export const validateUserAccess = (
  req: AuthorizedRequest,
  key: string = 'userId',
) => {
  const userId: number =
    +req.params?.[key] || +req.query?.[key] || +req.body?.[key];
  const user: User = req.user as undefined as User;
  if (
    userId != user.id &&
    user.roleId != Roles.Admin &&
    user.roleId != Roles.SuperAdmin
  ) {
    throw HttpException.Unauthorized(ErrorCodes.Auth);
  }
};

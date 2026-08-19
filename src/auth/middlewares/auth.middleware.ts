import { ErrorCodes } from '@common/enums';
import { HttpException } from '@common/exceptions';
import { prisma } from '@database';
import type { NextFunction, Response } from 'express';
import moment from 'moment';
import { activityService, tokenService } from '../services';
import { AuthorizedRequest } from '../types';

export const auth = async (
  req: AuthorizedRequest,
  _: Response,
  next: NextFunction,
) => {
  try {
    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader) {
      next(HttpException.Unauthorized(ErrorCodes.AuthHeaderEmpty));
      return;
    }

    const [type, token] = authorizationHeader.split(' ', 2);
    if (type !== 'Bearer' || !token) {
      next(HttpException.Unauthorized(ErrorCodes.AuthHeaderInvalid));
      return;
    }

    const claims = tokenService.validateAccessToken(token);
    if (!claims) {
      next(HttpException.Unauthorized(ErrorCodes.Auth));
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: claims.userId },
      select: {
        id: true,
        isBanned: true,
        role: true,
      },
    });

    if (user.isBanned) {
      const ban = await prisma.userBan.findUnique({
        where: { userId: user.id },
        omit: { userId: true },
      });

      next(
        HttpException.Forbidden(
          ErrorCodes.Banned,
          req.__(
            'errors.auth.userBanned',
            ban.reason,
            moment.utc(ban.expiredAt).diff(moment.utc(), 'minutes').toString(),
          ),
        ),
      );
      return;
    }

    activityService
      .log(user.id, req.clientIp || 'hidden')
      .catch((e: unknown) => console.error(e));

    req.user = user;

    next();
  } catch {
    next(HttpException.Unauthorized(ErrorCodes.Auth));
  }
};

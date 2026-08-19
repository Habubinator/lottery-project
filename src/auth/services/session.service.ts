import { ErrorCodes } from '@common/enums';
import { HttpException } from '@common/exceptions';
import { prisma } from '@database';
import { activityService } from './activity.service';
import type { Request } from 'express';
import { JwtRefreshTokenPayload } from '@auth/types';

class SessionService {
  async create(userId: number, userAgent: string, ip: string) {
    const session = await prisma.userSession.upsert({
      where: { userAgent_userId: { userAgent, userId } },
      create: {
        ip,
        userAgent,
        userId,
        refreshToken: '',
      },
      update: { ip },
      select: { id: true },
    });

    await activityService.log(userId, ip);

    return session.id;
  }

  async setRefreshToken(sessionId: string, refreshToken: string) {
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { refreshToken },
    });
  }

  async validate(claims: JwtRefreshTokenPayload, req: Request) {
    const session = await prisma.userSession.findUnique({
      where: { id: claims.sessionId },
      select: { userId: true },
    });

    if (!session?.userId || !claims?.userId) {
      throw HttpException.Unauthorized(
        ErrorCodes.Auth,
        req.__('errors.auth.sessionNotFound'),
      );
    }

    if (session.userId !== claims.userId) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        req.__('errors.auth.stolenSession'),
      );
    }
  }

  async destroy(claims: JwtRefreshTokenPayload, req: Request) {
    await this.validate(claims, req);
    await prisma.userSession.delete({ where: { id: claims.sessionId } });
  }
}

export const sessionService = new SessionService();

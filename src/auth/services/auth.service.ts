import { REFRESH_TOKEN_COOKIE } from '@common/constants';
import { ErrorCodes } from '@common/enums';
import { HttpException } from '@common/exceptions';
import { prisma } from '@database';
import { Request } from 'express';
import { Roles } from '../enums';
import { sessionService } from './session.service';
import { tokenService } from './token.service';
import { ParsedInitData, User } from '@auth/types';
import { GiveawayStartType } from '@prisma/client';
import crypto from 'crypto';
import { countOccupiedPrizePlaces } from '../../giveaways/utils/prize-place-stats';

/** Expose DB picked_language only after explicit user choice (set-language / bot picker). */
function mapUserForAuthResponse<T extends { picked_language: string; isLanguagePicked: boolean }>(
  user: T,
): Omit<T, 'picked_language'> & { picked_language: string | null } {
  return {
    ...user,
    picked_language: user.isLanguagePicked ? user.picked_language : null,
  };
}

class AuthService {
  async refresh(req: Request) {
    const refreshToken =
      req.cookies[REFRESH_TOKEN_COOKIE] ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!refreshToken) {
      throw HttpException.Unauthorized(ErrorCodes.Auth);
    }

    const claims = tokenService.validateRefreshToken(refreshToken);
    await sessionService.validate(claims, req);

    const tokens = tokenService.generateTokens(claims.userId, claims.sessionId);
    await sessionService.setRefreshToken(claims.sessionId, tokens.refreshToken);

    return tokens;
  }

  async createUser(
    initUser: User,
    roleId: Roles,
    permissions: { rolePermissionId: number }[] = [],
  ) {
    const user = await prisma.user.create({
      data: {
        telegramId: `${initUser.id}`,
        username: initUser.username,
        first_name: initUser.first_name,
        last_name: initUser.last_name,
        language_code: initUser.language_code,
        photo_url: initUser.photo_url,
        is_premium: initUser.is_premium,
        roleId,
        wallet: { create: {} },
        permissions:
          permissions.length > 0
            ? {
                createMany: {
                  data: permissions,
                },
              }
            : undefined,
      },
      include: {
        role: true,
        wallet: true,
        subscription: { include: { tariff: true } },
        giveaways: {
          include: {
            giveaway: {
              select: {
                id: true,
                participiationType: true,
                isActive: true,
                endingAt: true,
              },
            },
          },
        },
      },
    });

    return user;
  }

  async updateUser(userId: number, initUser: User) {
    const user = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        telegramId: `${initUser.id}`,
        username: initUser.username,
        first_name: initUser.first_name,
        last_name: initUser.last_name,
        language_code: initUser.language_code,
        photo_url: initUser.photo_url,
        is_premium: initUser.is_premium,
      },
      include: {
        role: true,
        wallet: true,
        subscription: { include: { tariff: true } },
        giveaways: {
          include: {
            giveaway: {
              select: {
                id: true,
                participiationType: true,
                isActive: true,
                endingAt: true,
              },
            },
          },
        },
      },
    });

    return user;
  }

  async validateAndProceed(req: Request) {
    try {
      const { isValid, parsedData } = this.validateTelegramHash(
        req.body.initData,
      );

      if (isValid) {
        const existingUser = await prisma.user.findFirst({
          where: { telegramId: `${parsedData.user.id}` },
          omit: { roleId: true },
          include: {
            role: true,
            wallet: true,
            subscription: { include: { tariff: true } },
            giveaways: {
              include: {
                giveaway: {
                  select: {
                    id: true,
                    participiationType: true,
                    isActive: true,
                    endingAt: true,
                  },
                },
              },
            },
          },
        });
        let user = null;

        if (!existingUser) {
          if (process.env.REGISTRATION_CLOSED === 'true') {
            throw HttpException.Forbidden(
              ErrorCodes.Forbidden,
              'Registration is currently closed',
            );
          }
          user = await this.createUser(parsedData.user, Roles.User);
        } else {
          user = await this.updateUser(existingUser.id, parsedData.user);
        }
        const sessionId = await sessionService.create(
          user.id,
          req.headers['user-agent'] || '',
          req.clientIp || '',
        );

        const tokens = tokenService.generateTokens(user.id, sessionId);

        await sessionService.setRefreshToken(sessionId, tokens.refreshToken);

        // Calculate giveaway statistics (distinct giveaway IDs only)
        const lotteryParticipations = new Set(
          user.giveaways
            .filter(
              (p) =>
                p.giveaway.participiationType === GiveawayStartType.Lottery,
            )
            .map((p) => p.giveawayId),
        ).size;

        const randomParticipations = new Set(
          user.giveaways
            .filter(
              (p) => p.giveaway.participiationType === GiveawayStartType.Random,
            )
            .map((p) => p.giveawayId),
        ).size;

        const totalWins = countOccupiedPrizePlaces(user.giveaways);

        // Calculate creator statistics (created giveaways)
        const createdGiveaways = await prisma.giveaway.findMany({
          where: { createdById: user.id },
          select: {
            id: true,
            participiationType: true,
            isActive: true,
          },
        });

        const lotteryCreated = createdGiveaways.filter(
          (g) => g.participiationType === GiveawayStartType.Lottery,
        ).length;

        const randomCreated = createdGiveaways.filter(
          (g) => g.participiationType === GiveawayStartType.Random,
        ).length;

        const activeCreated = createdGiveaways.filter((g) => g.isActive).length;

        const finishedCreated = createdGiveaways.filter(
          (g) => !g.isActive,
        ).length;

        // Calculate earnings from lottery giveaways
        const earningsTransactions = await prisma.transactionHistory.groupBy({
          by: ['currency'],
          where: {
            userId: user.id,
            type: 'Incoming',
            additionalInfo: {
              startsWith: 'Lottery earnings',
            },
          },
          _sum: {
            value: true,
          },
        });

        const earnings = {
          stars:
            earningsTransactions.find((t) => t.currency === 'Stars')?._sum
              .value || 0,
          ton:
            earningsTransactions.find((t) => t.currency === 'TON')?._sum
              .value || 0,
        };

        const userWithStats = mapUserForAuthResponse({
          ...user,
          statistics: {
            totalParticipations: new Set(
              user.giveaways.map((p) => p.giveawayId),
            ).size,
            lotteryParticipations,
            randomParticipations,
            totalWins,
            earnings,
          },
          creatorStatistics: {
            totalCreated: createdGiveaways.length,
            lotteryCreated,
            randomCreated,
            activeCreated,
            finishedCreated,
          },
        });

        return {
          data: {
            isValid,
            user: userWithStats,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          },
        };
      } else {
        console.log(
          `Data could not be validated: isValid:${isValid}, ParsedData:${parsedData}`,
        );
        throw HttpException.BadRequest(ErrorCodes.Forbidden);
      }
    } catch (error) {
      console.error('Error login/reg user with init data', error);
      throw HttpException.BadRequest(ErrorCodes.BadRequest);
    }
  }

  validateTelegramHash(initData: string): {
    isValid: boolean;
    parsedData: ParsedInitData | null;
  } {
    try {
      const [checksum, sortedInitData, parsedData] =
        this.convertInitData(initData);
      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(process.env.BOT_TOKEN)
        .digest();

      const hash = crypto
        .createHmac('sha256', secretKey)
        .update(sortedInitData)
        .digest('hex');

      return { isValid: hash === checksum, parsedData };
    } catch (error) {
      console.error('Error validating user init data', error);
      throw HttpException.BadRequest(ErrorCodes.BadRequest);
    }
  }

  convertInitData(initData: string): [string, string, ParsedInitData | null] {
    const params = decodeURIComponent(initData).split('&');
    let checksum = '';
    const dataWithoutHash: string[] = [];
    const parsedObject: Record<string, any> = {};

    params.forEach((param) => {
      const [key, value] = param.split('=');
      if (key === 'hash') {
        checksum = value;
      } else {
        dataWithoutHash.push(param);
        if (value) {
          if (value.startsWith('{')) {
            try {
              parsedObject[key] = JSON.parse(value);
            } catch {
              parsedObject[key] = value;
            }
          } else {
            parsedObject[key] = value;
          }
        }
      }
    });

    dataWithoutHash.sort();
    const sortedInitData = dataWithoutHash.join('\n');

    try {
      const parsedData: ParsedInitData = {
        query_id: parsedObject.query_id,
        user: parsedObject.user,
        auth_date: parsedObject.auth_date,
        signature: parsedObject.signature,
        hash: checksum,
      };
      return [checksum, sortedInitData, parsedData];
    } catch {
      return [checksum, sortedInitData, null];
    }
  }

  async me(id: number) {
    const user = await prisma.user.findUnique({
      where: { id },
      omit: { roleId: true },
      include: {
        role: true,
        wallet: true,
        subscription: { include: { tariff: true } },
      },
    });
    return user ? mapUserForAuthResponse(user) : user;
  }
}

export const authService = new AuthService();

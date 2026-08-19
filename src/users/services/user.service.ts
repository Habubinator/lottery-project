import fs from 'fs/promises';
import {
  prisma,
  Currencies,
  TransactionStatus,
  TransactionType,
  GiveawayStartType,
  NotificationSetting,
  Prisma,
  SponsorApprovalStatus,
} from '@database';
import { paginate } from '@common/pagination';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import { PaginateDto } from '@common/dto';
import {
  sendMessage,
  reconcileChannelsForUser,
} from '@bot/service/bot.service';
import {
  syncChannelFromTelegram,
  cleanupDescriptionPreviewMessages,
} from '@bot/service';
import {
  getUserLanguage,
  DESCRIPTION_REQUEST_MESSAGES,
} from '@bot/service/localization';
import { GIVEAWAY_ANNOUNCEMENT_PRIZES_INCLUDE } from '../../giveaways/services/prize-include';
import { countOccupiedPrizePlaces } from '../../giveaways/utils/prize-place-stats';
import { parseParticipationButtonStyle } from '../../giveaways/utils/participation-button.util';

class UserService {
  async searchUsers(query: string, page: number, pageSize: number) {
    return await paginate({
      page,
      pageSize,
      modelName: 'User',
      where: {
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { first_name: { contains: query, mode: 'insensitive' } },
          { last_name: { contains: query, mode: 'insensitive' } },
          { telegramId: { contains: query } },
        ],
      },
      include: {
        role: true,
        wallet: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAll(paginationArgs?: PaginateDto) {
    const pagination = new PaginateDto(
      paginationArgs || { page: 1, pageSize: 20 },
    );

    return await paginate({
      page: pagination.page,
      pageSize: pagination.pageSize,
      modelName: 'User',
      include: {
        role: true,
        wallet: true,
        subscription: {
          include: {
            tariff: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getOne(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        wallet: true,
        subscription: {
          include: {
            tariff: true,
          },
        },
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

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    // Calculate giveaway statistics (distinct giveaway IDs only)
    const lotteryParticipations = new Set(
      user.giveaways
        .filter(
          (p) => p.giveaway.participiationType === GiveawayStartType.Lottery,
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
    const lotteryWins = countOccupiedPrizePlaces(
      user.giveaways,
      GiveawayStartType.Lottery,
    );
    const randomWins = countOccupiedPrizePlaces(
      user.giveaways,
      GiveawayStartType.Random,
    );

    // Calculate earnings from lottery giveaways
    const earningsTransactions = await prisma.transactionHistory.groupBy({
      by: ['currency'],
      where: {
        userId: userId,
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
        earningsTransactions.find((t) => t.currency === 'Stars')?._sum.value ||
        0,
      ton:
        earningsTransactions.find((t) => t.currency === 'TON')?._sum.value || 0,
    };

    // Referrals and boosts across all giveaways
    const [referralsGiven, referralsReceived, boostsAgg] = await Promise.all([
      prisma.giveawayReferral.count({ where: { referrerId: userId } }),
      prisma.giveawayReferral.count({ where: { referredId: userId } }),
      prisma.giveawayEarnedTickets.aggregate({
        where: { userId },
        _sum: { earnedFromBoosts: true },
      }),
    ]);

    // Calculate creator statistics (created giveaways)
    const createdGiveaways = await prisma.giveaway.findMany({
      where: { createdById: userId },
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

    const finishedCreated = createdGiveaways.filter((g) => !g.isActive).length;

    const userWithStats = {
      ...user,
      statistics: {
        totalParticipations: new Set(user.giveaways.map((p) => p.giveawayId))
          .size,
        lotteryParticipations,
        randomParticipations,
        totalWins,
        lotteryWins,
        randomWins,
        earnings,
        referrals: {
          given: referralsGiven,
          received: referralsReceived,
        },
        boosts: boostsAgg._sum.earnedFromBoosts ?? 0,
      },
      creatorStatistics: {
        totalCreated: createdGiveaways.length,
        lotteryCreated,
        randomCreated,
        activeCreated,
        finishedCreated,
      },
    };

    return userWithStats;
  }

  async setLang(userId: number, lang: 'en' | 'uk' | 'ru') {
    const validLanguages = ['en', 'uk', 'ru'];

    if (!validLanguages.includes(lang)) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Invalid language code',
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        picked_language: lang,
        isLanguagePicked: true,
      },
      include: {
        role: true,
      },
    });

    return updatedUser;
  }

  async getUserGiveaways(
    userId: number,
    isActive: boolean,
    paginationArgs?: PaginateDto,
    isPlanned?: boolean,
  ) {
    const pagination = new PaginateDto(
      paginationArgs || { page: 1, pageSize: 20 },
    );

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    // Build giveaway where condition based on filters
    const giveawayWhereCondition: any = {};

    // Handle active/planned logic with OR condition to match expected UI behavior
    if (isActive === true && isPlanned === undefined) {
      // "Active" view: Show BOTH active and planned giveaways
      giveawayWhereCondition.OR = [
        { isActive: true, isPlanned: false }, // Actually running
        { isActive: false, isPlanned: true }, // Scheduled/planned
      ];
    } else if (isActive === false && isPlanned === undefined) {
      // "Completed" view: Show finished OR cancelled giveaways (including cancelled planned)
      giveawayWhereCondition.OR = [
        { isActive: false, isPlanned: false }, // Finished
        { isCancelled: true }, // Cancelled (including planned)
      ];
    } else {
      // Explicit filter values provided, use them as-is
      if (isActive !== undefined) {
        giveawayWhereCondition.isActive = isActive;
      }
      if (isPlanned !== undefined) {
        giveawayWhereCondition.isPlanned = isPlanned;
      }
    }
    if (isPlanned === true) {
      giveawayWhereCondition.isCancelled = false; // Exclude cancelled
    }

    const participants = await paginate({
      page: pagination.page,
      pageSize: pagination.pageSize,
      modelName: 'Participant',
      where: {
        userId,
        giveaway: giveawayWhereCondition,
      },
      include: {
        giveaway: {
          include: {
            createdBy: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
            linkedChannels: {
              include: {
                channel: true,
              },
            },
            sponsoredBy: {
              include: {
                sponsorChannel: true,
                sponsorLink: true,
              },
            },
            prizes: GIVEAWAY_ANNOUNCEMENT_PRIZES_INCLUDE,
            _count: {
              select: {
                participants: true,
              },
            },
          },
        },
      },
      orderBy: {
        participatedAt: 'desc',
      },
      distinct: ['giveawayId'], // DEDUPLICATION: Only unique giveaways
    });

    // Add unique participants count
    if (participants.items && participants.items.length > 0) {
      const giveawayIds = participants.items.map((p: any) => p.giveaway.id);

      const allParticipants = await prisma.participant.findMany({
        where: { giveawayId: { in: giveawayIds } },
        select: { userId: true, giveawayId: true },
        distinct: ['userId', 'giveawayId'],
      });

      const countMap = new Map<string, number>();
      for (const participant of allParticipants) {
        countMap.set(
          participant.giveawayId,
          (countMap.get(participant.giveawayId) || 0) + 1,
        );
      }

      participants.items = participants.items.map((item: any) => ({
        ...item,
        giveaway: {
          ...item.giveaway,
          uniqueParticipantsCount: countMap.get(item.giveaway.id) || 0,
        },
      }));
    }

    return participants;
  }

  async getUserCreatedGiveaways(
    userId: number,
    isActive: boolean,
    paginationArgs?: PaginateDto,
    isPlanned?: boolean,
  ) {
    const pagination = new PaginateDto(
      paginationArgs || { page: 1, pageSize: 20 },
    );

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    // Build base filter conditions (without createdById for shared query)
    const baseFilterConditions: Prisma.GiveawayWhereInput = {};

    // Handle active/planned logic with OR condition to match expected UI behavior
    if (isActive === true && isPlanned === undefined) {
      // "Active" view: Show BOTH active and planned giveaways
      baseFilterConditions.OR = [
        { isActive: true, isPlanned: false }, // Actually running
        { isActive: false, isPlanned: true }, // Scheduled/planned
      ];
      baseFilterConditions.isCancelled = false; // Exclude cancelled
    } else if (isActive === false && isPlanned === undefined) {
      // "Completed" view: Show finished OR cancelled giveaways (including cancelled planned)
      baseFilterConditions.OR = [
        { isActive: false, isPlanned: false }, // Finished
        { isCancelled: true }, // Cancelled (including planned)
      ];
    } else {
      // Explicit filter values provided, use them as-is
      if (isActive !== undefined) {
        baseFilterConditions.isActive = isActive;
      }
      if (isPlanned !== undefined) {
        baseFilterConditions.isPlanned = isPlanned;
      }
    }

    // Include configuration (shared between queries)
    const includeConfig = {
      createdBy: {
        select: {
          id: true,
          username: true,
          first_name: true,
          last_name: true,
          photo_url: true,
        },
      },
      linkedChannels: {
        include: {
          channel: true,
        },
      },
      sponsoredBy: {
        include: {
          sponsorChannel: true,
          sponsorLink: true,
        },
      },
      prizes: GIVEAWAY_ANNOUNCEMENT_PRIZES_INCLUDE,
      _count: {
        select: {
          participants: true,
        },
      },
    };

    // Order by configuration
    const orderByConfig =
      isActive === true
        ? [{ isPlanned: 'asc' as const }, { startingAt: 'desc' as const }]
        : { finishedAt: 'desc' as const };

    // Creator-owned giveaways
    const ownGiveaways = await prisma.giveaway.findMany({
      where: {
        createdById: userId,
        ...baseFilterConditions,
      },
      include: includeConfig,
      orderBy: orderByConfig,
    });

    // Shared giveaways — claim-only (Oleksandr 29.07.2026):
    // - Own giveaway → creator only (never "shared" for other channel admins).
    // - Someone else's giveaway using my channel → Shared badge only for the
    //   admin who claimed management (publish approve or /postlot). Notifications
    //   still go to all admins; profile stays uncluttered for the rest.
    // Do NOT restore addedBy-wide channel merge — that reopens the Jul regression.
    const [sharedFromLinkedChannels, sharedFromPostlot, sharedFromApprovals] =
      await Promise.all([
        prisma.giveaway.findMany({
          where: {
            createdById: { not: userId },
            ...baseFilterConditions,
            linkedChannels: {
              some: { managedByUserId: userId },
            },
          },
          include: includeConfig,
          orderBy: orderByConfig,
        }),
        prisma.giveaway.findMany({
          where: {
            createdById: { not: userId },
            ...baseFilterConditions,
            postlotPublications: {
              some: { publishedById: userId },
            },
          },
          include: includeConfig,
          orderBy: orderByConfig,
        }),
        // Safety net: Approved sponsor publish without linked managedByUserId
        // (legacy / edge paths). Still one claimant — not all channel admins.
        prisma.giveaway.findMany({
          where: {
            createdById: { not: userId },
            ...baseFilterConditions,
            sponsorApprovals: {
              some: {
                ownerUserId: userId,
                status: SponsorApprovalStatus.Approved,
              },
            },
          },
          include: includeConfig,
          orderBy: orderByConfig,
        }),
      ]);

    const sharedById = new Map<
      string,
      (typeof sharedFromLinkedChannels)[number]
    >();
    for (const g of [
      ...sharedFromLinkedChannels,
      ...sharedFromPostlot,
      ...sharedFromApprovals,
    ]) {
      sharedById.set(g.id, g);
    }

    const allGiveaways = [
      ...ownGiveaways.map((g) => ({ ...g, isShared: false as const })),
      ...Array.from(sharedById.values()).map((g) => ({
        ...g,
        isShared: true as const,
      })),
    ];

    // Merge by the same chrono order as the queries. Do NOT push all shared
    // after all own — with FE pageSize that buried claimed Shared behind a full
    // page of creator items (Jul 29 restore regression).
    allGiveaways.sort((a, b) => {
      if (isActive === true) {
        if (a.isPlanned !== b.isPlanned) return a.isPlanned ? -1 : 1;
        return (
          new Date(b.startingAt).getTime() - new Date(a.startingAt).getTime()
        );
      }
      const aFinished = a.finishedAt?.getTime() || 0;
      const bFinished = b.finishedAt?.getTime() || 0;
      return bFinished - aFinished;
    });

    // Apply manual pagination
    const start = (pagination.page - 1) * pagination.pageSize;
    const end = start + pagination.pageSize;
    const paginatedItems = allGiveaways.slice(start, end);

    // Build pagination response
    const giveaways = {
      items: paginatedItems,
      meta: {
        currentPage: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: allGiveaways.length,
        totalPages: Math.ceil(allGiveaways.length / pagination.pageSize),
      },
    };

    // Add unique participants count
    if (giveaways.items && giveaways.items.length > 0) {
      const giveawayIds = giveaways.items.map((g: any) => g.id);

      const allParticipants = await prisma.participant.findMany({
        where: { giveawayId: { in: giveawayIds } },
        select: { userId: true, giveawayId: true },
        distinct: ['userId', 'giveawayId'],
      });

      const countMap = new Map<string, number>();
      for (const participant of allParticipants) {
        countMap.set(
          participant.giveawayId,
          (countMap.get(participant.giveawayId) || 0) + 1,
        );
      }

      giveaways.items = giveaways.items.map((giveaway: any) => ({
        ...giveaway,
        uniqueParticipantsCount: countMap.get(giveaway.id) || 0,
      }));
    }

    return giveaways;
  }

  async getUserPlannedGiveaways(userId: number, paginationArgs?: PaginateDto) {
    const pagination = new PaginateDto(
      paginationArgs || { page: 1, pageSize: 20 },
    );

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    return await paginate({
      page: pagination.page,
      pageSize: pagination.pageSize,
      modelName: 'Giveaway',
      where: {
        createdById: userId,
        isPlanned: true,
        isActive: false,
        isCancelled: false, // Exclude cancelled giveaways
      },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
        linkedChannels: {
          include: {
            channel: true,
          },
        },
        sponsoredBy: {
          include: {
            sponsorChannel: {
              select: {
                id: true,
                title: true,
                username: true,
                photo: true,
                inviteLink: true,
              },
            },
            sponsorLink: {
              select: {
                id: true,
                title: true,
                link: true,
              },
            },
          },
        },
        prizes: GIVEAWAY_ANNOUNCEMENT_PRIZES_INCLUDE,
        _count: {
          select: {
            participants: true,
          },
        },
      },
      orderBy: {
        startingAt: 'asc',
      },
    });
  }

  async paySubscription(
    tariffId: number,
    userId: number,
    paymentCurrency?: Currencies,
  ) {
    // Start transaction to ensure data consistency
    return await prisma.$transaction(async (tx) => {
      // Check if user exists
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          wallet: true,
        },
      });

      if (!user) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Could not find user',
        );
      }

      // Check if tariff exists
      const tariff = await tx.tariff.findUnique({
        where: { id: tariffId },
      });

      if (!tariff) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Could not find Tariff',
        );
      }

      // Get user's wallet
      const wallet = user.wallet;
      if (!wallet) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Could not find wallet',
        );
      }

      // Determine payment currency (use provided or default to tariff currency)
      const currency = paymentCurrency || tariff.currency;

      // Determine price based on payment currency
      const price =
        currency === Currencies.Stars ? tariff.price : Number(tariff.tonPrice);

      // Validate that price is available
      if (currency === Currencies.TON && Number(tariff.tonPrice) <= 0) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'TON payment is not available for this tariff',
        );
      }

      // Check if user has sufficient balance
      const currentBalance =
        currency === Currencies.Stars ? wallet.starsBalance : wallet.tonBalance;

      if (currentBalance < price) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Insufficient balance',
        );
      }

      // Calculate new subscription expiry date
      const currentDate = new Date();
      const expiryDate = new Date(
        currentDate.getTime() + tariff.lengthDays * 24 * 60 * 60 * 1000,
      );

      const balanceBefore =
        currency === Currencies.Stars ? wallet.starsBalance : wallet.tonBalance;

      // Update wallet balance
      const newBalance =
        currency === Currencies.Stars
          ? { starsBalance: wallet.starsBalance - price }
          : { tonBalance: wallet.tonBalance - price };

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: newBalance,
      });

      const balanceAfter =
        currency === Currencies.Stars
          ? updatedWallet.starsBalance
          : updatedWallet.tonBalance;

      // Create or update subscription
      const existingSubscription = await tx.subscribers.findUnique({
        where: {
          userId_tariffId: {
            userId,
            tariffId,
          },
        },
      });

      let subscription;
      if (existingSubscription) {
        // Extend existing subscription
        const currentExpiry =
          existingSubscription.subscriptionExpiringAt || currentDate;
        const extendedExpiry = new Date(
          Math.max(currentExpiry.getTime(), currentDate.getTime()) +
            tariff.lengthDays * 24 * 60 * 60 * 1000,
        );

        subscription = await tx.subscribers.update({
          where: {
            userId_tariffId: {
              userId,
              tariffId,
            },
          },
          data: {
            subscriptionExpiringAt: extendedExpiry,
          },
          include: {
            tariff: true,
          },
        });
      } else {
        // Create new subscription
        subscription = await tx.subscribers.create({
          data: {
            userId,
            tariffId,
            subscriptionExpiringAt: expiryDate,
          },
          include: {
            tariff: true,
          },
        });
      }

      // Create transaction history record
      await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency,
          value: price,
          balanceBefore,
          balanceAfter,
          isSubscriptionPayment: true,
          additionalInfo: `Subscription payment for tariff: ${tariff.label} (${currency})`,
        },
      });

      return {
        subscription,
        newBalance: {
          starsBalance: newBalance.starsBalance ?? wallet.starsBalance,
          tonBalance: newBalance.tonBalance ?? wallet.tonBalance,
        },
        userTelegramId: user.telegramId,
        tariffLabel: tariff.label,
        subscriptionExpiresAt: subscription.subscriptionExpiringAt,
        paidCurrency: currency,
        paidAmount: price,
      };
    });
  }

  async updateTonWallet(userId: number, tonAddress: string | null) {
    if (tonAddress !== null) {
      if (typeof tonAddress !== 'string') {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'TON address must be a string or null',
        );
      }

      const tonAddressRegex = /^[A-Za-z0-9_-]{48}$/;
      if (!tonAddressRegex.test(tonAddress)) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Invalid TON address format',
        );
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        tonAddress,
      },
      include: {
        role: true,
        wallet: true,
      },
    });

    return updatedUser;
  }

  async getMyChannels(userId: number, dto: PaginateDto) {
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    try {
      await reconcileChannelsForUser(userId);
    } catch (err) {
      console.warn(
        `reconcileChannelsForUser failed for user ${userId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Get all giveaway IDs for filtering nested relations
    const userGiveaways = await prisma.giveaway.findMany({
      where: { createdById: userId },
      select: { id: true },
    });

    const giveawayIds = userGiveaways.map((g) => g.id);

    return await paginate({
      page: dto.page,
      pageSize: dto.pageSize,
      modelName: 'Channel',
      where: {
        isActive: true,
        addedBy: {
          some: {
            userId: userId,
          },
        },
      },
      include: {
        refferencedIn: {
          where:
            giveawayIds.length > 0
              ? { giveawayId: { in: giveawayIds } }
              : undefined,
          include: {
            giveaway: {
              select: {
                id: true,
                description: true,
                isActive: true,
                createdAt: true,
              },
            },
          },
        },
        sponsoring: {
          where:
            giveawayIds.length > 0
              ? { giveawayId: { in: giveawayIds } }
              : undefined,
          include: {
            giveaway: {
              select: {
                id: true,
                description: true,
                isActive: true,
                createdAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async syncChannel(channelId: bigint, userId: number) {
    const owned = await prisma.addedBy.findFirst({
      where: { channelId, userId },
    });

    if (!owned) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You do not have access to this channel',
      );
    }

    const updated = await syncChannelFromTelegram(channelId, {
      reconcileOwnership: true,
    });

    if (!updated) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Could not sync channel from Telegram',
      );
    }

    return {
      id: updated.id.toString(),
      title: updated.title,
      username: updated.username,
      photo: updated.photo,
      type: updated.type,
      isActive: updated.isActive,
      botCanPostMessages: updated.botCanPostMessages,
      botCanInviteUsers: updated.botCanInviteUsers,
    };
  }

  async searchChannels(
    query: string,
    page: number,
    pageSize: number,
    currentUserId: number,
  ) {
    const result = await paginate({
      page,
      pageSize,
      modelName: 'Channel',
      where: {
        isActive: true,
        botCanPostMessages: true,
        botCanInviteUsers: true,
        OR: [
          {
            username: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            title: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
        // Exclude channels added by current user
        addedBy: {
          none: { userId: currentUserId },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Add isSponsor: true to all returned channels
    if (result.items && result.items.length > 0) {
      result.items = result.items.map((channel: any) => ({
        ...channel,
        isSponsor: true,
      }));
    }

    return result;
  }

  async getRecentlyAddedChannels(userId: number, limit = 10) {
    try {
      await reconcileChannelsForUser(userId);
    } catch (err) {
      console.warn(
        `reconcileChannelsForUser failed for user ${userId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    const records = await prisma.addedBy.findMany({
      where: {
        userId,
        channel: { botCanPostMessages: true, botCanInviteUsers: true },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      distinct: ['channelId'],
      select: {
        channel: {
          select: {
            id: true,
            username: true,
            title: true,
            isActive: true,
            photo: true,
            inviteLink: true,
          },
        },
      },
    });
    return records.map((r) => r.channel).filter(Boolean);
  }

  async getLastAddedChannel(userId: number) {
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    // Get all giveaway IDs for filtering nested relations
    const userGiveaways = await prisma.giveaway.findMany({
      where: { createdById: userId },
      select: { id: true },
    });

    const giveawayIds = userGiveaways.map((g) => g.id);

    // Find the most recently added/updated channel by this user
    const lastAdded = await prisma.addedBy.findFirst({
      where: {
        userId: userId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        channel: {
          include: {
            refferencedIn: {
              where:
                giveawayIds.length > 0
                  ? { giveawayId: { in: giveawayIds } }
                  : undefined,
              include: {
                giveaway: {
                  select: {
                    id: true,
                    description: true,
                    isActive: true,
                    createdAt: true,
                  },
                },
              },
            },
            sponsoring: {
              where:
                giveawayIds.length > 0
                  ? { giveawayId: { in: giveawayIds } }
                  : undefined,
              include: {
                giveaway: {
                  select: {
                    id: true,
                    description: true,
                    isActive: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return lastAdded?.channel || null;
  }

  async setNotificationSetting(userId: number, setting: NotificationSetting) {
    const validSettings = ['FromAll', 'MyList', 'NoOne'];

    if (!validSettings.includes(setting)) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Invalid notification setting',
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        notificationList: setting as NotificationSetting,
      },
      include: {
        role: true,
      },
    });

    return updatedUser;
  }

  async getNotificationChannels(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    const notificationChannels = await prisma.notificationList.findMany({
      where: {
        userId,
      },
      include: {
        channel: true,
      },
    });

    return notificationChannels;
  }

  async addNotificationChannel(userId: number, channelUsername: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    // Find channel by username
    const channel = await prisma.channel.findFirst({
      where: { username: channelUsername },
    });

    if (!channel) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find channel',
      );
    }

    // Check if already exists
    const existing = await prisma.notificationList.findUnique({
      where: {
        userId_channelId: {
          userId,
          channelId: channel.id,
        },
      },
    });

    if (existing) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Channel already in notification list',
      );
    }

    const notificationChannel = await prisma.notificationList.create({
      data: {
        userId,
        channelId: channel.id,
      },
    });

    return notificationChannel;
  }

  async addMultipleNotificationChannels(userId: number, channelIds: bigint[]) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    // Validate all channels exist
    const channels = await prisma.channel.findMany({
      where: {
        id: { in: channelIds },
      },
    });

    if (channels.length !== channelIds.length) {
      const foundIds = channels.map((c) => c.id);
      const notFoundIds = channelIds.filter(
        (id) => !foundIds.some((fId) => fId === id),
      );
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        `Channels not found: ${notFoundIds.join(', ')}`,
      );
    }

    // Get existing entries
    const existingEntries = await prisma.notificationList.findMany({
      where: {
        userId,
        channelId: { in: channelIds },
      },
    });

    const existingChannelIds = existingEntries.map((e) => e.channelId);
    const newChannelIds = channelIds.filter(
      (id) => !existingChannelIds.some((eId) => eId === id),
    );

    // Create new entries in a transaction
    const created = await prisma.$transaction(
      newChannelIds.map((channelId) =>
        prisma.notificationList.create({
          data: {
            userId,
            channelId,
          },
        }),
      ),
    );

    return {
      created: created.length,
      skipped: existingChannelIds.length,
      total: channelIds.length,
      items: created,
    };
  }

  async deleteNotificationChannel(userId: number, channelId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    const notificationChannel = await prisma.notificationList.findUnique({
      where: {
        userId_channelId: {
          userId,
          channelId,
        },
      },
    });

    if (!notificationChannel) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Channel not found in notification list',
      );
    }

    const deleted = await prisma.notificationList.delete({
      where: {
        userId_channelId: {
          userId,
          channelId,
        },
      },
    });

    return deleted;
  }

  async getOutcomingTransactions() {
    const transactions = await prisma.transactionHistory.findMany({
      where: {
        type: TransactionType.Outcoming,
        status: TransactionStatus.Completed,
        additionalInfo: {
          startsWith: 'Withdrawal approved:',
        },
      },
      include: {
        user: {
          include: {
            role: true,
            wallet: true,
            subscription: {
              include: {
                tariff: true,
              },
            },
          },
        },
        wallet: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    });

    return transactions;
  }

  async getChannelSearchHistory(userId: number) {
    const history = await prisma.channelSearchHistory.findMany({
      where: {
        userId,
        channel: { botCanPostMessages: true, botCanInviteUsers: true },
      },
      include: {
        channel: {
          select: {
            id: true,
            username: true,
            title: true,
            photo: true,
            type: true,
          },
        },
      },
      orderBy: { searchedAt: 'desc' },
      take: 10,
    });

    return history.map((h) => ({ ...h.channel, isSponsor: true }));
  }

  async saveChannelToSearchHistory(userId: number, channelId: bigint) {
    await prisma.channelSearchHistory.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: { searchedAt: new Date() },
      create: { userId, channelId },
    });

    // Keep only last 10 entries per user
    const all = await prisma.channelSearchHistory.findMany({
      where: { userId },
      orderBy: { searchedAt: 'desc' },
      select: { id: true },
    });

    if (all.length > 10) {
      const toDelete = all.slice(10).map((h) => h.id);
      await prisma.channelSearchHistory.deleteMany({
        where: { id: { in: toDelete } },
      });
    }
  }

  async requestDescription(
    userId: number,
    draft?: {
      participationButtonText?: string;
      participationButtonStyle?: string;
      showParticipationCount?: boolean;
      showParticipationMaxCount?: boolean;
      participiationType?: string;
      language?: string;
      completionType?: string;
      maxParticipants?: number;
    },
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        telegramId: true,
        picked_language: true,
        language_code: true,
        defaultParticipationButtonText: true,
        defaultParticipationButtonStyle: true,
        defaultShowParticipationCount: true,
        defaultShowParticipationMaxCount: true,
      },
    });
    if (!user?.telegramId)
      throw HttpException.BadRequest(ErrorCodes.BadRequest);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const resolveButtonText = () => {
      if (draft?.participationButtonText !== undefined) {
        const trimmed = draft.participationButtonText.trim().slice(0, 40);
        return trimmed || null;
      }
      return user.defaultParticipationButtonText ?? null;
    };

    const resolveButtonStyle = () => {
      if (draft?.participationButtonStyle !== undefined) {
        return (
          parseParticipationButtonStyle(draft.participationButtonStyle) ?? null
        );
      }
      return user.defaultParticipationButtonStyle ?? null;
    };

    const resolveShowCount = () => {
      if (draft?.showParticipationCount !== undefined) {
        return draft.showParticipationCount;
      }
      return user.defaultShowParticipationCount ?? true;
    };

    const resolveShowMax = () => {
      if (draft?.showParticipationMaxCount !== undefined) {
        return draft.showParticipationMaxCount;
      }
      return user.defaultShowParticipationMaxCount ?? true;
    };

    const buttonFields = {
      participationButtonText: resolveButtonText(),
      participationButtonStyle: resolveButtonStyle(),
      showParticipationCount: resolveShowCount(),
      showParticipationMaxCount: resolveShowMax(),
    };

    const draftFields = {
      ...buttonFields,
      ...(draft?.participiationType !== undefined && {
        participiationType: draft.participiationType || null,
      }),
      ...(draft?.language !== undefined && {
        language: draft.language || null,
      }),
      ...(draft?.completionType !== undefined && {
        completionType: draft.completionType || null,
      }),
      ...(draft?.maxParticipants !== undefined && {
        maxParticipants: draft.maxParticipants ?? null,
      }),
    };

    // Remove leftover settings/preview DMs before wiping tracked IDs
    await cleanupDescriptionPreviewMessages(userId, user.telegramId);

    await prisma.descriptionRequest.upsert({
      where: { userId },
      create: {
        userId,
        expiresAt,
        flowState: 'awaiting_text',
        confirmedAt: null,
        previewMessageIds: [],
        participiationType: draft?.participiationType ?? null,
        language: draft?.language ?? null,
        completionType: draft?.completionType ?? null,
        maxParticipants: draft?.maxParticipants ?? null,
        ...buttonFields,
      },
      update: {
        description: null,
        expiresAt,
        flowState: 'awaiting_text',
        confirmedAt: null,
        previewMessageIds: [],
        ...draftFields,
      },
    });

    const lang = getUserLanguage(user);
    const prompt = await sendMessage(
      user.telegramId,
      DESCRIPTION_REQUEST_MESSAGES.prompt[lang],
    );
    if (prompt.messageId) {
      await prisma.descriptionRequest.update({
        where: { userId },
        data: { previewMessageIds: [prompt.messageId] },
      });
    }
  }

  async pollDescriptionRequest(userId: number) {
    const request = await prisma.descriptionRequest.findUnique({
      where: { userId },
    });
    if (!request) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });

    if (new Date() > request.expiresAt) {
      if (user?.telegramId) {
        await cleanupDescriptionPreviewMessages(userId, user.telegramId);
      }
      await prisma.descriptionRequest.delete({ where: { userId } });
      return null;
    }
    if (request.confirmedAt && request.description !== null) {
      const result = {
        isPending: false as const,
        description: request.description,
        participationButtonText: request.participationButtonText,
        participationButtonStyle: request.participationButtonStyle,
        showParticipationCount: request.showParticipationCount,
        showParticipationMaxCount: request.showParticipationMaxCount,
        participiationType: request.participiationType,
        language: request.language,
      };
      // After Save, preview + "settings saved" stay in the bot chat (Oleksandr)
      await prisma.descriptionRequest.delete({ where: { userId } });
      return result;
    }
    return { isPending: true };
  }

  async cancelDescriptionRequest(userId: number): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });
    if (user?.telegramId) {
      await cleanupDescriptionPreviewMessages(userId, user.telegramId);
    }
    await prisma.descriptionRequest.deleteMany({ where: { userId } });
  }

  async saveTempBanners(
    userId: number,
    files: Express.Multer.File[],
  ): Promise<string[]> {
    // Replace any existing temp uploads — prevents stale banners from prior abandoned sessions
    const existing = await prisma.tempBannerUpload.findMany({
      where: { userId },
    });
    for (const record of existing) {
      for (const filePath of record.filePaths) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
    if (existing.length > 0) {
      await prisma.tempBannerUpload.deleteMany({ where: { userId } });
    }
    const urls = files.map((f) => `/static/giveaways/${f.filename}`);
    const filePaths = files.map((f) => f.path);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.tempBannerUpload.create({
      data: { userId, filePaths, urls, expiresAt },
    });
    return urls;
  }

  async confirmTempBanners(
    userId: number,
    bannerUrls: string[],
  ): Promise<void> {
    await prisma.tempBannerUpload.deleteMany({
      where: { userId, urls: { hasSome: bannerUrls } },
    });
  }

  async deleteTempBanners(userId: number): Promise<void> {
    const records = await prisma.tempBannerUpload.findMany({
      where: { userId },
    });
    for (const record of records) {
      for (const filePath of record.filePaths) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
    await prisma.tempBannerUpload.deleteMany({ where: { userId } });
  }

  async removeTempBanner(userId: number, url: string): Promise<void> {
    const record = await prisma.tempBannerUpload.findFirst({
      where: { userId },
    });
    if (!record) return;
    const idx = record.urls.indexOf(url);
    if (idx === -1) return;
    await fs.unlink(record.filePaths[idx]).catch(() => {});
    const newUrls = record.urls.filter((_, i) => i !== idx);
    const newFilePaths = record.filePaths.filter((_, i) => i !== idx);
    if (newUrls.length === 0) {
      await prisma.tempBannerUpload.delete({ where: { id: record.id } });
    } else {
      await prisma.tempBannerUpload.update({
        where: { id: record.id },
        data: { urls: newUrls, filePaths: newFilePaths },
      });
    }
  }

  async abortCreation(userId: number): Promise<void> {
    // Check if bot interaction occurred (bot DM was sent asking for description)
    const descRequest = await prisma.descriptionRequest.findUnique({
      where: { userId },
    });

    // Switching Mini App → bot to type the description often fires WebApp
    // close/abort. Wiping banners/request then makes preview fall back to
    // standart.mp4. Keep both alive until poll/confirm/cancel or expiry.
    const descriptionFlowActive =
      !!descRequest &&
      !descRequest.confirmedAt &&
      descRequest.expiresAt > new Date();
    if (descriptionFlowActive) {
      return;
    }

    // Clear temp banners from disk + DB
    const bannerRecords = await prisma.tempBannerUpload.findMany({
      where: { userId },
    });
    for (const record of bannerRecords) {
      for (const filePath of record.filePaths) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
    await prisma.tempBannerUpload.deleteMany({ where: { userId } });

    // Clear description request and send bot notification if bot interaction occurred
    if (descRequest) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          telegramId: true,
          picked_language: true,
          language_code: true,
        },
      });
      if (user?.telegramId) {
        // Delete settings/preview DMs before dropping the request row
        await cleanupDescriptionPreviewMessages(userId, user.telegramId);
      }
      await prisma.descriptionRequest.deleteMany({ where: { userId } });
      if (user?.telegramId) {
        const lang = getUserLanguage(user);
        const isLottery = descRequest.participiationType === 'Lottery';
        const text = isLottery
          ? DESCRIPTION_REQUEST_MESSAGES.interruptedLottery[lang]
          : DESCRIPTION_REQUEST_MESSAGES.interrupted[lang];
        await sendMessage(user.telegramId, text).catch(() => {});
      }
    }
  }
}

export const userService = new UserService();

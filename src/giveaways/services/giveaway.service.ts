import {
  PrismaClient,
  prisma,
  Currencies,
  TransactionStatus,
  TransactionType,
  GiveawayStartType,
  GiveawayEndType,
  SponsorType,
  GiveawayPrizeStatus,
} from '@database';
import { Prisma } from '@prisma/client';
import { telegramGiftService } from '@telegram-gifts';
import { paginate } from '@common/pagination';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import { Roles } from '@auth/enums';
import {
  GiveawaySearchDto,
  CreateGiveawayDto,
  UpdateGiveawayDto,
} from '../dto';
import {
  AdditionalTicketsStatus,
  ClaimBoostResult,
  AdvertisingInvoiceResult,
  AdvertisingStatusResult,
} from '../types';
import {
  sendGiveawayAnnouncement,
  updateGiveawayMessages,
  NotificationService,
  finishGiveAwayTasks,
  updateWinnersAnnouncement,
  updateCancelledGiveawayMessages,
  GIVEAWAY_CANCEL_MESSAGES,
  GIVEAWAY_ERROR_MESSAGES,
  formatGiveawayGuardMessage,
  formatWinnerReplaceWaitMessage,
  normalizeGiveawayLanguage,
  getUserLanguage,
  identifySponsorChannels,
  sendCreatorActivationNotification,
  generateTrackingCode,
  sendSponsorApprovalRequest,
  GIVEAWAY_POST_INTRO,
  GIVEAWAY_PLANNED_MESSAGES,
  sendMessage,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  repostGiveawayToChannel,
  sendWinnersAnnouncement,
  createStarsPaymentLink,
  sendLinkRequestCreatorNotification,
  sendLinkRequestSenderNotification,
  editLinkRequestMessage,
  LINK_REQUEST_MESSAGES,
  PAYMENT_LABELS,
  normalizeGiveawayLanguage as normalizeLang,
  syncChannelFromTelegram,
  reserveSharedChannelPublication,
  releaseSharedChannelPublication,
} from '@bot/service';
import { PaymentBody } from '@wallet/types';
import { batchCheckUserBoosts, batchCheckUserMembership } from '@bot/service';
import { userService } from '@users/services';
import { sponsorLinkService } from '@sponsors';
import { advertisingPriceService } from '@admin';
import {
  distributePrizeGifts,
  validateGiftFeesBeforeActivation,
  syncWinnerCountToPrizes,
  LINKABLE_PRIZE_STATUSES,
  resolvePrizeStatusFromTransferDate,
  assertCanFinishGiveawayWithLinkedPrizes,
  releaseUnassignedLinkedPrizesAfterFinish,
  getWinnerReplaceEligibility,
  WinnerReplaceBlockReason,
} from './prize.service';
import {
  GIVEAWAY_LINKED_PRIZES_INCLUDE,
  GIVEAWAY_OWNER_RELATIONS_INCLUDE,
} from './prize-include';
import {
  finalizeJointsOnGiveawayStart,
  refundJointsOnCancelInTx,
  refundAcceptedJointForChannelInTx,
  applyTelegramJointRefunds,
  refundLinkRequestWalletInTx,
  refundLinkRequestViaTelegram,
  type LinkRequestRefundContext,
} from './joint-payout.service';
import moment from 'moment';
import { updateSponsorLinkImage } from '@common/utils';

export {
  refundLinkRequestWalletInTx,
  refundLinkRequestViaTelegram,
  finalizeJointsOnGiveawayStart,
  distributeJointFunds,
} from './joint-payout.service';
export type { LinkRequestRefundContext } from './joint-payout.service';
// PrismaTransaction stays local; joint-payout has its own copy

export type PrismaTransaction = Parameters<
  Parameters<PrismaClient['$transaction']>[0]
>[0];

/** Large giveaways (1000+ participants) need more time for winner selection + prize linking. */
const GIVEAWAY_FINISH_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 120_000,
} as const;

/** Lottery maxParticipants = ticket rows; Random = distinct users (matches Telegram button). */
function capacityUsesTicketRows(participiationType: string): boolean {
  return participiationType === GiveawayStartType.Lottery;
}

async function getCapacityFillCount(
  prismaClient: PrismaTransaction | typeof prisma,
  giveawayId: string,
  participiationType: string,
): Promise<number> {
  if (capacityUsesTicketRows(participiationType)) {
    return prismaClient.participant.count({ where: { giveawayId } });
  }
  const distinctGroups = await prismaClient.participant.groupBy({
    by: ['userId'],
    where: { giveawayId },
  });
  return distinctGroups.length;
}

function scheduleCapacityAutoComplete(
  service: { autoCompleteGiveaway(giveawayId: string): Promise<unknown> },
  giveaway: {
    id: string;
    participiationType: string;
    maxParticipants: number | null;
  },
  fillCount: number,
): void {
  if (!giveaway.maxParticipants || fillCount < giveaway.maxParticipants) {
    return;
  }
  const unit = capacityUsesTicketRows(giveaway.participiationType)
    ? 'tickets'
    : 'participants';
  setTimeout(async () => {
    try {
      console.log(
        `Giveaway ${giveaway.id} reached capacity (${fillCount}/${giveaway.maxParticipants} ${unit}), triggering auto-completion`,
      );
      await service.autoCompleteGiveaway(giveaway.id);
    } catch (error) {
      console.error(
        `Error auto-completing giveaway ${giveaway.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }, 100);
}

function schedulePostFinishSideEffects(giveawayId: string): void {
  setTimeout(async () => {
    try {
      await finishGiveAwayTasks(giveawayId);
    } catch (error) {
      console.error(
        `Error running finish tasks for giveaway ${giveawayId}:`,
        error,
      );
    }

    try {
      await NotificationService.notifyAllWinners(giveawayId);
    } catch (error) {
      console.error(
        `Error sending winner notifications for ${giveawayId}:`,
        error,
      );
    }
  }, 100);
}

const WINNER_REPLACE_GUARD_KEYS = {
  wait_claim_deadline: 'winnerReplaceWaitClaimDeadline',
  gift_claimed: 'winnerReplaceGiftClaimed',
  gift_delivered: 'winnerReplaceGiftDelivered',
  gift_linked_to_place: 'winnerReplaceGiftLinkedToPlace',
} as const;

function withWinnerReplaceEligibility<
  T extends {
    wonPrize?: {
      status: GiveawayPrizeStatus;
      claimDeadline: Date | null;
      winPlace?: number | null;
    } | null;
  },
>(participant: T) {
  const { canReplace, reason, replaceAvailableAt } =
    getWinnerReplaceEligibility(participant.wonPrize);
  return {
    ...participant,
    canReplaceWinner: canReplace,
    replaceBlockedReason: reason,
    replaceAvailableAt: replaceAvailableAt?.toISOString() ?? null,
  };
}

function assertWinnerReplaceAllowed(
  wonPrize:
    | {
        status: GiveawayPrizeStatus;
        claimDeadline: Date | null;
        winPlace?: number | null;
      }
    | null
    | undefined,
  giveawayLanguage: string | null | undefined,
) {
  const { canReplace, reason, replaceAvailableAt } =
    getWinnerReplaceEligibility(wonPrize);
  if (canReplace || !reason) return;

  const message =
    reason === 'wait_claim_deadline' && replaceAvailableAt
      ? formatWinnerReplaceWaitMessage(giveawayLanguage, replaceAvailableAt)
      : formatGiveawayGuardMessage(
          giveawayLanguage,
          WINNER_REPLACE_GUARD_KEYS[reason],
        );

  throw HttpException.BadRequest(ErrorCodes.BadRequest, message);
}

const ADDITIONAL_WINNER_USER_SELECT = {
  id: true,
  username: true,
  first_name: true,
  last_name: true,
  photo_url: true,
  telegramId: true,
} satisfies Prisma.UserSelect;

type AdditionalWinnerCandidate = Prisma.ParticipantGetPayload<{
  include: { user: { select: typeof ADDITIONAL_WINNER_USER_SELECT } };
}>;

type WinnerKindFilter = 'main' | 'additional';

function dedupeParticipantsByUserId<
  T extends { userId: number; participatedAt?: Date },
>(participants: T[]): T[] {
  const seenUserIds = new Set<number>();
  const unique: T[] = [];
  const sorted = [...participants].sort(
    (a, b) =>
      (a.participatedAt?.getTime() ?? 0) - (b.participatedAt?.getTime() ?? 0),
  );
  for (const p of sorted) {
    if (seenUserIds.has(p.userId)) continue;
    seenUserIds.add(p.userId);
    unique.push(p);
  }
  return unique;
}

function effectiveAllowMultipleWinPlaces(
  participationType: GiveawayStartType,
  configuredValue: boolean,
): boolean {
  // A lottery draws ticket rows. The Random-only toggle must not disable a
  // lottery ticket holder from winning more than one place.
  return participationType === GiveawayStartType.Lottery || configuredValue;
}

function buildMainWinnerCandidatePool<
  T extends { userId: number; participatedAt?: Date },
>(
  participants: T[],
  allowMultipleWinPlaces: boolean,
  excludeUserIds: number[] = [],
): T[] {
  const excluded = new Set(excludeUserIds);
  const filtered =
    excluded.size > 0
      ? participants.filter((p) => !excluded.has(p.userId))
      : participants;
  if (allowMultipleWinPlaces) {
    return [...filtered].sort(
      (a, b) =>
        (a.participatedAt?.getTime() ?? 0) - (b.participatedAt?.getTime() ?? 0),
    );
  }
  return dedupeParticipantsByUserId(filtered);
}

function takeMainWinnerRows<T extends { userId: number }>(
  shuffledTicketRows: T[],
  count: number,
  allowMultipleWinPlaces: boolean,
): T[] {
  if (allowMultipleWinPlaces) {
    return shuffledTicketRows.slice(0, count);
  }

  const selected: T[] = [];
  const selectedUserIds = new Set<number>();
  for (const row of shuffledTicketRows) {
    if (selectedUserIds.has(row.userId)) continue;
    selectedUserIds.add(row.userId);
    selected.push(row);
    if (selected.length === count) break;
  }
  return selected;
}

function prizeAssignmentsMatch(
  requested: Array<{ prizeId: number; winPlace?: number | null }>,
  existing: Array<{ id: number; winPlace: number | null }>,
): boolean {
  const normalize = (
    values: Array<{ prizeId?: number; id?: number; winPlace?: number | null }>,
  ) =>
    values
      .map((value) => ({
        prizeId: value.prizeId ?? value.id,
        winPlace: value.winPlace ?? null,
      }))
      .sort(
        (a, b) =>
          Number(a.prizeId) - Number(b.prizeId) ||
          Number(a.winPlace ?? 0) - Number(b.winPlace ?? 0),
      );

  return (
    JSON.stringify(normalize(requested)) === JSON.stringify(normalize(existing))
  );
}

async function getMainWinnerUserIds(
  tx: PrismaTransaction,
  giveawayId: string,
): Promise<number[]> {
  const winners = await tx.participant.findMany({
    where: { giveawayId, isWinner: true },
    select: { userId: true },
  });
  return [...new Set(winners.map((w) => w.userId))];
}

type ReferralTicketGiveaway = {
  id: string;
  canEarnAdditionalTickets: boolean;
  refsPerTicket: number;
  maxAdditionalTickets: number;
  countRefsOnParticipation: boolean;
};

async function countQualifyingReferrals(
  tx: PrismaTransaction,
  giveawayId: string,
  referrerId: number,
  countRefsOnParticipation: boolean,
): Promise<number> {
  return tx.giveawayReferral.count({
    where: {
      giveawayId,
      referrerId,
      ...(countRefsOnParticipation ? { hasParticipated: true } : {}),
    },
  });
}

async function syncReferralEarnedTickets(
  tx: PrismaTransaction,
  giveaway: ReferralTicketGiveaway,
  referrerId: number,
): Promise<void> {
  if (!giveaway.canEarnAdditionalTickets || giveaway.refsPerTicket <= 0) {
    return;
  }

  const qualifyingCount = await countQualifyingReferrals(
    tx,
    giveaway.id,
    referrerId,
    giveaway.countRefsOnParticipation,
  );
  const newlyEarned = Math.floor(qualifyingCount / giveaway.refsPerTicket);

  const earnedRecord = await tx.giveawayEarnedTickets.upsert({
    where: {
      giveawayId_userId: { giveawayId: giveaway.id, userId: referrerId },
    },
    create: {
      giveawayId: giveaway.id,
      userId: referrerId,
      earnedFromRefs: 0,
      earnedFromBoosts: 0,
    },
    update: {},
  });

  let delta = newlyEarned - earnedRecord.earnedFromRefs;

  if (delta > 0 && giveaway.maxAdditionalTickets > 0) {
    const remaining =
      giveaway.maxAdditionalTickets -
      earnedRecord.earnedFromRefs -
      earnedRecord.earnedFromBoosts;
    delta = Math.min(delta, remaining);
  }

  if (delta > 0) {
    for (let i = 0; i < delta; i++) {
      await tx.participant.create({
        data: { userId: referrerId, giveawayId: giveaway.id },
      });
    }
    await tx.giveawayEarnedTickets.update({
      where: {
        giveawayId_userId: { giveawayId: giveaway.id, userId: referrerId },
      },
      data: { earnedFromRefs: { increment: delta } },
    });
  }
}

async function markReferralParticipatedAndAward(
  tx: PrismaTransaction,
  referredUserId: number,
  giveawayId: string,
): Promise<void> {
  const referral = await tx.giveawayReferral.findFirst({
    where: { giveawayId, referredId: referredUserId },
  });
  if (!referral || referral.hasParticipated) {
    return;
  }

  const giveaway = await tx.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      id: true,
      canEarnAdditionalTickets: true,
      refsPerTicket: true,
      maxAdditionalTickets: true,
      countRefsOnParticipation: true,
    },
  });
  if (!giveaway?.countRefsOnParticipation) {
    return;
  }

  await tx.giveawayReferral.update({
    where: { id: referral.id },
    data: { hasParticipated: true },
  });

  await syncReferralEarnedTickets(tx, giveaway, referral.referrerId);
}

type GiveawayTicketsAndBoostGuards = {
  canEarnAdditionalTickets: boolean;
  refsPerTicket: number;
  boostsPerTicket: number;
  maxAdditionalTickets: number;
  isBoostNeeded: boolean;
  boostedId: bigint | null;
  neededReferals: number;
};

function countPostingLinkedChannels(channels: Array<{ role: string }>): number {
  return channels.filter((lc) => lc.role === 'All' || lc.role === 'Posting')
    .length;
}

function assertAdditionalTicketsPremiumConflict(
  config: GiveawayTicketsAndBoostGuards,
  language: string | null | undefined,
) {
  if (!config.canEarnAdditionalTickets) {
    return;
  }
  if (config.refsPerTicket > 0 && config.neededReferals > 0) {
    throw HttpException.BadRequest(
      ErrorCodes.Conflict,
      formatGiveawayGuardMessage(
        language,
        'additionalTicketsRefsConflictNeededReferals',
      ),
    );
  }
  if (config.boostsPerTicket > 0 && config.isBoostNeeded) {
    throw HttpException.BadRequest(
      ErrorCodes.Conflict,
      formatGiveawayGuardMessage(
        language,
        'additionalTicketsBoostConflictRequired',
      ),
    );
  }
}

function resolveEffectiveTicketsBoostConfig(
  existing: {
    canEarnAdditionalTickets: boolean;
    refsPerTicket: number;
    boostsPerTicket: number;
    maxAdditionalTickets: number;
    isBoostNeeded: boolean;
    boostedId: bigint | null;
    neededReferals: number;
  },
  dto: UpdateGiveawayDto,
  canUsePremiumFeatures: boolean,
): GiveawayTicketsAndBoostGuards {
  return {
    canEarnAdditionalTickets:
      dto.canEarnAdditionalTickets ?? existing.canEarnAdditionalTickets,
    refsPerTicket: dto.refsPerTicket ?? existing.refsPerTicket,
    boostsPerTicket: dto.boostsPerTicket ?? existing.boostsPerTicket,
    maxAdditionalTickets:
      dto.maxAdditionalTickets ?? existing.maxAdditionalTickets,
    isBoostNeeded: canUsePremiumFeatures
      ? (dto.isBoostNeeded ?? existing.isBoostNeeded)
      : false,
    boostedId: canUsePremiumFeatures
      ? dto.boostedId !== undefined
        ? dto.boostedId
        : existing.boostedId
      : null,
    neededReferals: canUsePremiumFeatures
      ? (dto.neededReferals ?? existing.neededReferals)
      : 0,
  };
}

function computeReferralTicketProgress(
  qualifyingReferralsCount: number,
  refsPerTicket: number,
): {
  referralsTowardNextTicket: number;
  referralsNeededForNextTicket: number;
  ticketsFromQualifyingReferrals: number;
} | null {
  if (refsPerTicket <= 0) {
    return null;
  }
  const referralsTowardNextTicket = qualifyingReferralsCount % refsPerTicket;
  const referralsNeededForNextTicket =
    referralsTowardNextTicket === 0
      ? refsPerTicket
      : refsPerTicket - referralsTowardNextTicket;
  return {
    referralsTowardNextTicket,
    referralsNeededForNextTicket,
    ticketsFromQualifyingReferrals: Math.floor(
      qualifyingReferralsCount / refsPerTicket,
    ),
  };
}

function assertGiveawayTicketsAndBoostGuards(
  config: GiveawayTicketsAndBoostGuards,
  postingLinkedChannelCount: number,
  language: string | null | undefined,
) {
  if (config.canEarnAdditionalTickets) {
    const hasRefs = config.refsPerTicket > 0;
    const hasBoosts = config.boostsPerTicket > 0;
    if (!hasRefs && !hasBoosts) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(language, 'additionalTicketsSourceRequired'),
      );
    }
    if (config.maxAdditionalTickets <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(language, 'additionalTicketsMaxRequired'),
      );
    }
    if (hasBoosts && postingLinkedChannelCount === 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(language, 'boostChannelsRequired'),
      );
    }
  }

  if (config.isBoostNeeded && config.boostedId == null) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(language, 'boostedChannelRequired'),
    );
  }

  assertAdditionalTicketsPremiumConflict(config, language);
}

async function countLinkedGifts(giveawayId: string): Promise<number> {
  return prisma.giveawayPrize.count({
    where: { giveawayId, status: GiveawayPrizeStatus.Linked },
  });
}

/**
 * Main-page posting is free for all lotteries and for Random giveaways with Linked gifts.
 * Already-paid posting (advertisedAt) is also free to re-enable.
 */
async function isMainPagePostingFreeEligible(giveaway: {
  id: string;
  participiationType: GiveawayStartType | string;
  advertisedAt?: Date | null;
}): Promise<{ free: boolean; linkedGiftCount: number }> {
  if (giveaway.advertisedAt) {
    const linkedGiftCount = await countLinkedGifts(giveaway.id);
    return { free: true, linkedGiftCount };
  }
  if (giveaway.participiationType === GiveawayStartType.Lottery) {
    const linkedGiftCount = await countLinkedGifts(giveaway.id);
    return { free: true, linkedGiftCount };
  }
  const linkedGiftCount = await countLinkedGifts(giveaway.id);
  return { free: linkedGiftCount > 0, linkedGiftCount };
}

/**
 * After gifts are removed: if Random still has free (unpaid) main-page posting on, turn it off.
 */
export async function disableFreeMainPagePostingIfNoGifts(
  giveawayId: string,
): Promise<void> {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      id: true,
      participiationType: true,
      isPostingOn: true,
      advertisedAt: true,
    },
  });
  if (!giveaway) return;
  if (!giveaway.isPostingOn) return;
  if (giveaway.advertisedAt) return; // paid — keep
  if (giveaway.participiationType === GiveawayStartType.Lottery) return;

  const linked = await countLinkedGifts(giveawayId);
  if (linked > 0) return;

  await prisma.giveaway.update({
    where: { id: giveawayId },
    data: { isPostingOn: false },
  });
  console.log(
    `[Ads] Disabled free isPostingOn for giveaway ${giveawayId} — no linked gifts left`,
  );
}

class GiveawayService {
  async getAll(searchDto: GiveawaySearchDto, userId?: number) {
    // Build where condition by flattening simple conditions
    const whereCondition: Prisma.GiveawayWhereInput = {};

    // Handle isActive filter
    if (searchDto.isActive !== undefined) {
      whereCondition.isActive = searchDto.isActive;
    }

    // Handle isPlanned filter
    if (searchDto.isPlanned !== undefined) {
      whereCondition.isPlanned = searchDto.isPlanned;
    }

    // Handle geo-restriction filter
    if (searchDto.userCountry) {
      whereCondition.OR = [
        { allowedGeoCountries: '' },
        {
          allowedGeoCountries: {
            contains: searchDto.userCountry.toUpperCase(),
          },
        },
      ];
    }

    // Handle language filter
    if (searchDto.language) {
      whereCondition.language = searchDto.language;
    }

    // Handle participationType filter
    if (searchDto.participationType) {
      whereCondition.participiationType = searchDto.participationType;
    }

    // Handle completionType filter
    if (searchDto.completionType) {
      whereCondition.completionType = searchDto.completionType;
    }

    // Handle isOnlyPremium filter
    if (searchDto.isOnlyPremium !== undefined) {
      whereCondition.isOnlyPremium = searchDto.isOnlyPremium;
    }

    // Handle currency filter
    if (searchDto.currency) {
      whereCondition.participiationCurr = searchDto.currency;
    }

    // Ads: only show giveaways with posting enabled
    whereCondition.isPostingOn = true;

    const giveaways = await paginate({
      page: searchDto.page,
      pageSize: searchDto.pageSize,
      modelName: 'Giveaway',
      where: whereCondition,
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
        prizes: GIVEAWAY_LINKED_PRIZES_INCLUDE,
        _count: {
          select: {
            participants: true,
          },
        },
      },
      orderBy:
        searchDto.isMainPage === true
          ? { advertisedAt: 'desc' }
          : searchDto.isActive === true
            ? { startingAt: 'desc' }
            : searchDto.isActive === false
              ? { finishedAt: 'desc' }
              : { createdAt: 'desc' },
    });

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

    if (userId && giveaways.items) {
      const giveawayIds = giveaways.items.map((g: any) => g.id);
      const userParticipations = await prisma.participant.findMany({
        where: {
          userId,
          giveawayId: { in: giveawayIds },
        },
        select: {
          giveawayId: true,
        },
      });

      const participationMap = new Set(
        userParticipations.map((p) => p.giveawayId),
      );

      giveaways.items = giveaways.items.map((giveaway: any) => ({
        ...giveaway,
        isParticipiating: participationMap.has(giveaway.id),
      }));
    }

    return giveaways;
  }

  async getOne(giveawayId: string, userId?: number) {
    if (giveawayId == undefined || giveawayId == 'undefined') {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        createdBy: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            username: true,
            photo_url: true,
          },
        },
        linkedChannels: {
          include: {
            channel: {
              include: {
                addedBy: {
                  select: {
                    userId: true,
                  },
                },
              },
            },
          },
        },
        sponsoredBy: {
          include: {
            sponsorChannel: true,
            sponsorLink: true,
          },
        },
        prizes: GIVEAWAY_LINKED_PRIZES_INCLUDE,
        boostedChannel: true,
        referrals: userId
          ? {
              where: {
                referrer: {
                  id: userId,
                },
              },
              include: {
                referred: {
                  select: {
                    id: true,
                    username: true,
                    first_name: true,
                    last_name: true,
                    photo_url: true,
                  },
                },
                referrer: {
                  select: {
                    id: true,
                    username: true,
                    first_name: true,
                    last_name: true,
                    photo_url: true,
                  },
                },
              },
            }
          : false,
        postlotPublications: { include: { channel: true } },
        _count: {
          select: {
            participants: true,
            referrals: true,
          },
        },
      },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Mark linked channels with isSponsor/isCreator based on whether current user added them
    const enrichedLinkedChannels = giveaway.linkedChannels.map(
      (linkedChannel) => {
        // isCreator: user is in addedBy for this channel (they own it)
        const isCreator =
          !!userId &&
          linkedChannel.channel.addedBy.some(
            (addedByEntry) => addedByEntry.userId === userId,
          );
        // isSponsor: user did NOT add this channel (or unauthenticated)
        const isSponsor = !isCreator;

        return {
          ...linkedChannel,
          channel: {
            ...linkedChannel.channel,
            isSponsor,
            isCreator,
          },
        };
      },
    );

    let isParticipiating = false;
    let userTicketsCount = 0;
    if (userId) {
      const participationCount = await prisma.participant.count({
        where: {
          userId,
          giveawayId,
        },
      });
      isParticipiating = participationCount > 0;
      userTicketsCount = participationCount;
    }

    // Count unique participants (unique userId's)
    const uniqueParticipants = await prisma.participant.findMany({
      where: { giveawayId },
      select: { userId: true },
      distinct: ['userId'],
    });
    const uniqueParticipantsCount = uniqueParticipants.length;

    return {
      ...giveaway,
      linkedChannels: enrichedLinkedChannels,
      isParticipiating,
      userTicketsCount,
      uniqueParticipantsCount,
    };
  }

  async getAvailableRange(giveawayId: string) {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: { id: true, isActive: true },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Additional-winner selection works on unique participants, not ticket rows.
    const availableParticipants =
      await this.getEligibleAdditionalWinnerParticipants(prisma, giveawayId);

    const totalAvailable = availableParticipants.length;

    return {
      totalParticipants: totalAvailable,
      availableRange: {
        min: totalAvailable > 0 ? 1 : 0,
        max: totalAvailable,
      },
    };
  }

  async getFullGiveaways() {
    const giveaways = await prisma.giveaway.findMany({
      where: {
        maxParticipants: {
          gt: 0,
        },
        completionType: GiveawayEndType.ByCapacity,
      },
      include: {
        _count: {
          select: {
            participants: true,
          },
        },
      },
    });

    return giveaways.filter(
      (giveaway) => giveaway._count.participants >= giveaway.maxParticipants,
    );
  }

  async getExpiredGiveaways() {
    return await prisma.giveaway.findMany({
      where: {
        completionType: GiveawayEndType.ByTime,
        endingAt: {
          not: null,
          lt: new Date(),
        },
      },
      include: {
        _count: {
          select: {
            participants: true,
          },
        },
      },
    });
  }

  async createNew(dto: CreateGiveawayDto, userId: number) {
    // Track created sponsor links for background image fetching
    const createdSponsorLinks: Array<{ id: number; url: string }> = [];

    const createdGiveaway = await prisma.$transaction(async (tx) => {
      // Get user with subscription info
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          subscription: {
            include: {
              tariff: true,
            },
          },
        },
      });

      if (!user) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
      }

      // Button settings: prefer create payload; else last bot-customized defaults on User
      const participationButtonText =
        dto.participationButtonText !== undefined
          ? dto.participationButtonText
          : (user.defaultParticipationButtonText ?? null);
      const participationButtonStyle =
        dto.participationButtonStyle !== undefined
          ? dto.participationButtonStyle
          : (user.defaultParticipationButtonStyle ?? null);
      const showParticipationCount =
        dto.showParticipationCount ??
        user.defaultShowParticipationCount ??
        true;
      const showParticipationMaxCount =
        dto.showParticipationMaxCount ??
        user.defaultShowParticipationMaxCount ??
        true;

      console.log(
        `[GiveawayCreate] userId=${userId} button text=${participationButtonText ?? 'null'} style=${participationButtonStyle ?? 'null'} showCount=${showParticipationCount} showMax=${showParticipationMaxCount} (dto text=${dto.participationButtonText !== undefined ? 'set' : 'unset'})`,
      );

      // Check if user has active subscription for premium features
      const hasActiveSubscription = user.subscription.some(
        (sub) =>
          sub.subscriptionExpiringAt && sub.subscriptionExpiringAt > new Date(),
      );

      // Check if user can use premium features (subscription OR free uses)
      let canUsePremiumFeatures = hasActiveSubscription;
      let usedFreePremiumUse = false;

      if (dto.hasPremiumFeatures() && !hasActiveSubscription) {
        // User wants premium features but has no subscription
        // Check if they have free premium uses available
        if (user.freePremiumUses > 0) {
          canUsePremiumFeatures = true;
          usedFreePremiumUse = true;
        } else {
          throw HttpException.BadRequest(
            ErrorCodes.Forbidden,
            'Active subscription or free premium uses required for premium features',
          );
        }
      }

      // Additional tickets / premium participation conflict (merged effective state)
      assertGiveawayTicketsAndBoostGuards(
        {
          canEarnAdditionalTickets: dto.canEarnAdditionalTickets,
          refsPerTicket: dto.refsPerTicket,
          boostsPerTicket: dto.boostsPerTicket,
          maxAdditionalTickets: dto.maxAdditionalTickets,
          isBoostNeeded: canUsePremiumFeatures ? dto.isBoostNeeded : false,
          boostedId: canUsePremiumFeatures ? (dto.boostedId ?? null) : null,
          neededReferals: canUsePremiumFeatures ? dto.neededReferals : 0,
        },
        countPostingLinkedChannels(dto.linkedChannels ?? []),
        dto.language,
      );

      // Validate boostedId if provided
      if (canUsePremiumFeatures && dto.boostedId) {
        const boostedChannel = await tx.channel.findUnique({
          where: { id: dto.boostedId },
        });

        if (!boostedChannel) {
          throw HttpException.BadRequest(
            ErrorCodes.NotFound,
            'Boosted channel not found',
          );
        }
      }

      const now = moment();
      const startingAtMoment = moment(dto.startingAt);
      const isActive = startingAtMoment.diff(now, 'minutes') <= 1;
      const isPlanned = !isActive;

      // Create the giveaway
      const giveaway = await tx.giveaway.create({
        data: {
          description:
            dto.description ||
            this.getDefaultDescription(dto.participiationType, dto.language),
          banner: dto.banner,
          participiationType: dto.participiationType,
          completionType: dto.completionType,
          language: dto.language,
          maxParticipants: dto.maxParticipants,
          winnerSlots: dto.winnerSlots,
          participiationPrice: dto.participiationPrice,
          participiationCurr: dto.participiationCurr,
          startingAt: dto.startingAt,
          endingAt: dto.endingAt,
          neededReferals: canUsePremiumFeatures ? dto.neededReferals : 0,
          isOnlyPremium: canUsePremiumFeatures ? dto.isOnlyPremium : false,
          isBoostNeeded: canUsePremiumFeatures ? dto.isBoostNeeded : false,
          boostedId: canUsePremiumFeatures ? dto.boostedId : null,
          allowedGeoCountries: canUsePremiumFeatures
            ? dto.allowedGeoCountries
            : '',
          isCaptchaNeeded: dto.isCaptchaNeeded,
          doApiSessionCheck: canUsePremiumFeatures
            ? dto.doApiSessionCheck
            : false,
          isStaySubscribed: canUsePremiumFeatures
            ? dto.isStaySubscribed
            : false,
          participationButtonText,
          participationButtonStyle,
          showParticipationCount,
          showParticipationMaxCount,
          numerifyWinners: dto.numerifyWinners,
          allowMultipleWinPlaces:
            dto.participiationType === GiveawayStartType.Lottery
              ? true
              : dto.allowMultipleWinPlaces,
          isResultsInMainPost: dto.isResultsInMainPost,
          isCommentsOn: dto.isCommentsOn,
          variant: dto.variant,
          isPostingOn: false, // force off — ads can only be enabled via update after creation
          isNotificationOn: false, // force off — same reason
          advertisedAt: null, // force null — no free advertising at creation
          twinkBlock: canUsePremiumFeatures ? dto.twinkBlock : false,
          canEarnAdditionalTickets: dto.canEarnAdditionalTickets,
          countRefsOnParticipation: dto.canEarnAdditionalTickets
            ? dto.countRefsOnParticipation
            : false,
          refsPerTicket: dto.refsPerTicket,
          boostsPerTicket: dto.boostsPerTicket,
          maxAdditionalTickets: dto.maxAdditionalTickets,
          sponsorSlots: dto.sponsorSlots,
          starsPerSlot: dto.starsPerSlot,
          isActive,
          isPlanned,
          createdById: userId,
        },
      });

      // Decrement free premium uses if used
      if (usedFreePremiumUse) {
        await tx.user.update({
          where: { id: userId },
          data: { freePremiumUses: { decrement: 1 } },
        });
        console.log(
          `[AUDIT] freePremiumUses decremented — userId=${userId}, giveawayId=${giveaway.id}, trigger=createGiveaway, premiumFlags=${dto.listPremiumFeatureFlags().join(',')}`,
        );
      }

      // Create sponsor links if provided
      if (dto.sponsorLinks && dto.sponsorLinks.length > 0) {
        for (const linkData of dto.sponsorLinks) {
          // Validate linkData is an object with required properties
          if (!linkData || typeof linkData !== 'object') {
            console.warn('Invalid sponsor link data:', linkData);
            continue;
          }

          const title =
            typeof linkData.title === 'string' ? linkData.title : '';
          const link = typeof linkData.link === 'string' ? linkData.link : '';

          if (!link) {
            console.warn('Sponsor link missing URL:', linkData);
            continue;
          }

          const sponsorLink = await tx.sponsorLink.create({
            data: {
              title,
              link,
              imageUrl: null, // Will be populated in background
            },
          });

          await tx.sponsors.create({
            data: {
              giveawayId: giveaway.id,
              sponsorType: SponsorType.Link,
              sponsorLinkId: sponsorLink.id,
            },
          });

          // Track for background processing
          createdSponsorLinks.push({ id: sponsorLink.id, url: link });
        }
      }

      // Create linked channels if provided (each item carries a role: All | Posting | Subscription)
      if (dto.linkedChannels && dto.linkedChannels.length > 0) {
        for (const { id: channelId, role } of dto.linkedChannels) {
          // Skip invalid channel IDs
          if (!channelId || isNaN(+channelId)) continue;

          const channelBigIntId = BigInt(channelId);

          // Verify channel exists; include addedBy to detect sponsor channels
          const channel = await tx.channel.findUnique({
            where: { id: channelBigIntId },
            include: { addedBy: { where: { userId } } },
          });

          if (channel) {
            await tx.linkedChannels.create({
              data: {
                channelId: channelBigIntId,
                giveawayId: giveaway.id,
                role,
                isCommentsOn: giveaway.isCommentsOn,
                isResultsInMainPost: giveaway.isResultsInMainPost,
              },
            });
            // Save to search history only for non-owned channels
            if (channel.addedBy.length === 0) {
              userService
                .saveChannelToSearchHistory(userId, channelBigIntId)
                .catch(console.error);
            }
          }
        }
      }

      // Link pre-paid prizes if provided (prizes must be Available/Cooldown + commissionPaid=true)
      if (dto.prizes && dto.prizes.length > 0) {
        const prizeIds = dto.prizes.map((p) => p.prizeId);
        const validPrizes = await tx.giveawayPrize.findMany({
          where: {
            id: { in: prizeIds },
            depositedByUserId: userId,
            status: { in: [...LINKABLE_PRIZE_STATUSES] },
            commissionPaid: true,
          },
          select: { id: true },
        });

        if (validPrizes.length !== prizeIds.length) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            'One or more prizes are not available or not paid. Purchase them first via POST /api/prizes/pay.',
          );
        }

        for (const entry of dto.prizes) {
          await tx.giveawayPrize.update({
            where: { id: entry.prizeId },
            data: {
              giveawayId: giveaway.id,
              status: GiveawayPrizeStatus.Linked,
              winPlace: entry.winPlace ?? null,
            },
          });
        }

        const linkedCount = await tx.giveawayPrize.count({
          where: {
            giveawayId: giveaway.id,
            status: GiveawayPrizeStatus.Linked,
          },
        });
        if (linkedCount > 0) {
          await tx.giveaway.update({
            where: { id: giveaway.id },
            data: { winnerSlots: linkedCount },
          });
        }
      }

      const linkedForGuards = await tx.linkedChannels.findMany({
        where: { giveawayId: giveaway.id },
        select: { role: true },
      });
      const createdRow = await tx.giveaway.findUnique({
        where: { id: giveaway.id },
        select: {
          canEarnAdditionalTickets: true,
          refsPerTicket: true,
          boostsPerTicket: true,
          maxAdditionalTickets: true,
          isBoostNeeded: true,
          boostedId: true,
          neededReferals: true,
          language: true,
        },
      });
      if (createdRow) {
        assertGiveawayTicketsAndBoostGuards(
          createdRow,
          countPostingLinkedChannels(linkedForGuards),
          createdRow.language,
        );
      }

      const createdGiveaway = await tx.giveaway.findUnique({
        where: { id: giveaway.id },
        include: GIVEAWAY_OWNER_RELATIONS_INCLUDE,
      });
      return createdGiveaway;
    });

    // Fetch preview images in background (fire-and-forget)
    if (createdSponsorLinks.length > 0) {
      setTimeout(() => {
        for (const { id, url } of createdSponsorLinks) {
          updateSponsorLinkImage(id, url, prisma).catch((error) => {
            console.error(
              `Background image fetch failed for link ${id}:`,
              error,
            );
          });
        }
      }, 100);
    }

    console.log(dto);
    console.log(createdGiveaway);

    if (createdGiveaway && createdGiveaway.isActive) {
      setImmediate(() => {
        finalizeJointsOnGiveawayStart(createdGiveaway.id).catch((err) =>
          console.error(
            `finalizeJointsOnGiveawayStart on create ${createdGiveaway.id}:`,
            err,
          ),
        );
      });
    }

    // Only send notifications and announcements if giveaway is active (not planned)
    // Fire-and-forget to avoid blocking the response
    if (
      createdGiveaway &&
      !createdGiveaway.isPlanned &&
      createdGiveaway.linkedChannels.length > 0
    ) {
      const giveawayId = createdGiveaway.id;
      // Only post to channels with a posting role (All or Posting); Subscription-only channels are skipped
      const linkedChannelIds = createdGiveaway.linkedChannels
        .filter((lc) => lc.role === 'All' || lc.role === 'Posting')
        .map((lc) => lc.channelId.toString());

      // Execute announcement and notification tasks asynchronously
      setTimeout(async () => {
        try {
          const webappUrl = process.env.BOT_URL;

          // Identify sponsor channels (channels NOT added by giveaway creator)
          const sponsorChannels = await identifySponsorChannels(
            giveawayId,
            userId,
          );

          const sponsorChannelIds = new Set(
            sponsorChannels.map((sc) => sc.channelId.toString()),
          );

          // Check if there are any creator's own channels (not sponsor channels)
          const hasCreatorChannels = linkedChannelIds.some(
            (channelId) => !sponsorChannelIds.has(channelId),
          );

          // Post immediately to creator's own channels only
          if (hasCreatorChannels) {
            const announcementResult = await sendGiveawayAnnouncement(
              giveawayId,
              webappUrl,
              // Pass sponsor channel IDs to exclude them from immediate posting
              Array.from(sponsorChannelIds).map((id) => BigInt(id)),
            );
            console.log(
              `Giveaway ${giveawayId} announcements sent to creator channels: ${announcementResult.success} successful, ${announcementResult.failed} failed`,
            );

            // Log any failed channel posts for monitoring
            if (announcementResult.failed > 0) {
              const failedChannels = announcementResult.results
                .filter((r) => !r.success)
                .map((r) => `Channel ${r.channelId}: ${r.error}`)
                .join(', ');
              console.warn(
                `Failed to send announcements to some channels: ${failedChannels}`,
              );
            }
          }

          // Send approval requests to sponsor channel owners
          if (sponsorChannels.length > 0) {
            // Fetch giveaway with creator info and banners for approval message
            const giveawayForApproval = await prisma.giveaway.findUnique({
              where: { id: giveawayId },
              select: {
                id: true,
                createdById: true,
                participiationType: true,
                language: true,
                banner: true,
                createdBy: {
                  select: {
                    first_name: true,
                    last_name: true,
                    username: true,
                  },
                },
              },
            });

            if (giveawayForApproval) {
              for (const sponsorChannel of sponsorChannels) {
                // Send approval request to each owner
                for (const owner of sponsorChannel.owners) {
                  const trackingCode = generateTrackingCode(
                    giveawayId,
                    sponsorChannel.channelId,
                  );

                  // Create approval record first to get ID
                  const createdApproval = await prisma.sponsorApproval.create({
                    data: {
                      giveawayId: giveawayId,
                      channelId: sponsorChannel.channelId,
                      ownerUserId: owner.userId,
                      trackingCode,
                      status: 'Pending',
                    },
                  });

                  // Fetch target user for first_name, last_name and language
                  const targetUser = await prisma.user.findFirst({
                    where: {
                      telegramId: owner.telegramId,
                    },
                    select: {
                      first_name: true,
                      last_name: true,
                      picked_language: true,
                      language_code: true,
                    },
                  });

                  // Send approval request message with approval ID
                  const result = await sendSponsorApprovalRequest(
                    owner.telegramId,
                    targetUser?.first_name || '',
                    targetUser?.last_name || null,
                    {
                      id: giveawayId,
                      type: giveawayForApproval.participiationType,
                      createdById: giveawayForApproval.createdById,
                      banner: giveawayForApproval.banner,
                    },
                    sponsorChannel.channelId,
                    sponsorChannel.channelTitle,
                    createdApproval.id,
                    getUserLanguage(targetUser ?? {}),
                    owner.userId,
                  );

                  if (result.success && result.messageId) {
                    // Update with message ID
                    await prisma.sponsorApproval.update({
                      where: { id: createdApproval.id },
                      data: {
                        messageId: BigInt(result.messageId),
                      },
                    });
                  }

                  console.log(
                    `Sent sponsor approval request to owner ${owner.userId} for channel ${sponsorChannel.channelId}`,
                  );
                }
              }
            }
          }

          // Channel subscribers: always notify on activation (free, regardless of isNotificationOn)
          await NotificationService.notifyChannelSubscribers(giveawayId);
          await prisma.giveaway.update({
            where: { id: giveawayId },
            data: { lastChannelNotifiedAt: new Date() },
          });

          // Paid broadcast: notify FromAll users not in channel list
          if (dto.isNotificationOn) {
            await NotificationService.notifyGiveawayCreated(giveawayId);
            await prisma.giveaway.update({
              where: { id: giveawayId },
              data: { lastNotifiedAt: new Date() },
            });
          }

          // Notify creator that giveaway has started
          try {
            const creatorUser = await prisma.user.findUnique({
              where: { id: userId },
              select: { telegramId: true },
            });
            if (creatorUser?.telegramId) {
              await sendCreatorActivationNotification(
                creatorUser.telegramId,
                giveawayId,
                dto.participiationType === 'Lottery' ? 'lottery' : 'random',
                (dto.language as string) ?? 'en',
                sponsorChannels.length > 0,
                (dto.banner as string[] | undefined) ?? [],
              );
            }
          } catch (err) {
            console.error(
              `Error sending creator activation notification for ${giveawayId}:`,
              err,
            );
          }
        } catch (error) {
          console.error(
            `Error sending giveaway announcements for ${giveawayId}:`,
            error,
          );
        }
      }, 0);
    }

    // Confirm temp banner uploads used in this giveaway (fire-and-forget)
    if (dto.banner?.length) {
      userService.confirmTempBanners(userId, dto.banner).catch(() => {});
    }

    // Planned create: notify creator in bot DM
    if (createdGiveaway?.isPlanned) {
      const giveawayId = createdGiveaway.id;
      setTimeout(async () => {
        try {
          const creatorUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              telegramId: true,
              picked_language: true,
              language_code: true,
            },
          });
          if (!creatorUser?.telegramId) return;
          const lang = getUserLanguage(creatorUser);
          const isLottery =
            createdGiveaway.participiationType === GiveawayStartType.Lottery;
          const text = isLottery
            ? GIVEAWAY_PLANNED_MESSAGES[lang].lottery
            : GIVEAWAY_PLANNED_MESSAGES[lang].giveaway;
          await sendMessage(creatorUser.telegramId, text);
        } catch (err) {
          console.error(
            `Error sending planned-create notification for ${giveawayId}:`,
            err,
          );
        }
      }, 0);
    }

    return createdGiveaway;
  }

  async update(giveawayId: string, dto: UpdateGiveawayDto, userId: number) {
    // Track updated sponsor links for background image fetching
    const updatedSponsorLinks: Array<{ id: number; url: string }> = [];

    // Capture original description before transaction to decide if Telegram message needs updating
    let originalDescription: string | null = null;
    let originalBanner: string[] = [];
    let shouldNotify = false;
    let shouldSendAdMessage = false;
    let shouldSyncPrizes = dto.prizes !== undefined;
    let jointTelegramRefunds: LinkRequestRefundContext[] = [];
    let activatedOnUpdate = false;
    const { postingStars: postingFee, notificationStars: notificationFee } =
      await advertisingPriceService.getPrices();

    const updateTxResult = await prisma.$transaction(async (tx) => {
      // Verify giveaway exists
      const existingGiveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: {
          createdBy: true,
        },
      });

      if (!existingGiveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      originalDescription = existingGiveaway.description;
      originalBanner = [...existingGiveaway.banner];
      const updateJointTelegramRefunds: LinkRequestRefundContext[] = [];
      let becameActive = false;

      // Check if existing giveaway has any premium features
      const existingHasPremiumFeatures =
        existingGiveaway.neededReferals > 0 ||
        existingGiveaway.isOnlyPremium ||
        existingGiveaway.isBoostNeeded ||
        existingGiveaway.boostedId !== null ||
        (existingGiveaway.allowedGeoCountries &&
          existingGiveaway.allowedGeoCountries !== '') ||
        existingGiveaway.doApiSessionCheck ||
        existingGiveaway.isStaySubscribed ||
        existingGiveaway.twinkBlock;

      // Get user with role info for authorization check
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
          subscription: {
            include: {
              tariff: true,
            },
          },
        },
      });

      if (!user) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
      }

      if (dto.prizes !== undefined) {
        const existingPrizeAssignments = await tx.giveawayPrize.findMany({
          where: { giveawayId },
          select: { id: true, winPlace: true },
        });
        if (prizeAssignmentsMatch(dto.prizes, existingPrizeAssignments)) {
          shouldSyncPrizes = false;
        }
      }

      // Check authorization - only creator or admin can update
      const isCreator = existingGiveaway.createdById === userId;
      const isAdmin =
        user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

      if (!isCreator && !isAdmin) {
        throw HttpException.Forbidden(
          ErrorCodes.Forbidden,
          'You are not authorized to update this giveaway',
        );
      }

      // Check if user has active subscription for premium features
      const hasActiveSubscription = user.subscription.some(
        (sub) =>
          sub.subscriptionExpiringAt && sub.subscriptionExpiringAt > new Date(),
      );

      // Determine if this update changes giveaway from non-premium to premium
      const isChangingToPremium =
        !existingHasPremiumFeatures && dto.hasPremiumFeatures();

      // Check if user can use premium features (subscription OR free uses)
      let canUsePremiumFeatures = hasActiveSubscription;
      let usedFreePremiumUse = false;

      if (dto.hasPremiumFeatures() && !hasActiveSubscription) {
        if (existingHasPremiumFeatures) {
          // Giveaway already created with premium (trial / free use / past subscription) — allow edits
          canUsePremiumFeatures = true;
        } else if (isChangingToPremium && user.freePremiumUses > 0) {
          canUsePremiumFeatures = true;
          usedFreePremiumUse = true;
        } else {
          throw HttpException.BadRequest(
            ErrorCodes.Forbidden,
            'Active subscription or free premium uses required for premium features',
          );
        }
      }

      // Additional tickets / premium participation conflict (merged with existing row)
      const effectiveTicketsBoostConfig = resolveEffectiveTicketsBoostConfig(
        existingGiveaway,
        dto,
        canUsePremiumFeatures,
      );
      const linkedForPreGuard = await tx.linkedChannels.findMany({
        where: { giveawayId },
        select: { role: true },
      });
      const postingChannelCountForPreGuard =
        dto.linkedChannels !== undefined
          ? countPostingLinkedChannels(
              dto.linkedChannels.map((lc) => ({ role: lc.role })),
            )
          : countPostingLinkedChannels(linkedForPreGuard);
      assertGiveawayTicketsAndBoostGuards(
        effectiveTicketsBoostConfig,
        postingChannelCountForPreGuard,
        existingGiveaway.language,
      );

      // Validate boostedId if provided
      if (canUsePremiumFeatures && dto.boostedId) {
        const boostedChannel = await tx.channel.findUnique({
          where: { id: dto.boostedId },
        });

        if (!boostedChannel) {
          throw HttpException.BadRequest(
            ErrorCodes.NotFound,
            'Boosted channel not found',
          );
        }
      }

      // Validate participationType - cannot be changed
      if (dto.participiationType !== undefined) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Cannot change participation type after giveaway creation',
        );
      }

      // Validate startingAt - cannot be changed if giveaway has already started
      if (dto.startingAt !== undefined) {
        const now = moment();
        const existingStartTime = moment(existingGiveaway.startingAt);
        const newStartTime = moment(dto.startingAt);
        const isChanging = !newStartTime.isSame(existingStartTime);

        // Only block if the start time is actually being changed AND giveaway already started
        if (
          isChanging &&
          (existingGiveaway.isActive || existingStartTime.isSameOrBefore(now))
        ) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            'Cannot change start time after giveaway has started',
          );
        }
      }

      // Giveaway edit matrix (Oleksandr spec) — PATCH /giveaways/:id only
      if (existingGiveaway.participiationType === GiveawayStartType.Lottery) {
        await assertLotteryGiveawayUpdateAllowed(
          existingGiveaway,
          dto,
          giveawayId,
          tx,
          shouldSyncPrizes,
          getUserLanguage(user),
        );
      } else {
        await assertRandomGiveawayUpdateAllowed(
          existingGiveaway,
          dto,
          giveawayId,
          tx,
          shouldSyncPrizes,
          getUserLanguage(user),
        );
      }

      // Validate banner count changes to prevent message type transitions
      if (dto.banner !== undefined) {
        const existingBannerCount = existingGiveaway.banner.length;
        const newBannerCount = dto.banner.length;
        const giveawayLang = normalizeGiveawayLanguage(
          existingGiveaway.language,
        );
        const errorMessages = GIVEAWAY_ERROR_MESSAGES[giveawayLang];

        // Prevent 0 → N (cannot add multiple photos at once)
        if (existingBannerCount === 0 && newBannerCount > 1) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            errorMessages.cannotAddMultiplePhotos,
          );
        }

        // Prevent 1 → N (cannot change from single photo to media group)
        if (existingBannerCount === 1 && newBannerCount > 1) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            errorMessages.cannotChangeSingleToMultiple,
          );
        }

        // Prevent N → 1 (cannot change from media group to single photo)
        if (existingBannerCount > 1 && newBannerCount === 1) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            errorMessages.cannotChangeMultipleToSingle,
          );
        }

        console.log(
          `Banner update: ${existingBannerCount} → ${newBannerCount} banners for giveaway ${giveawayId}`,
        );
      }

      // Charge wallet Stars when toggling ads flags ON (Path A — in-app balance)
      // Main-page posting: free for Lottery / Random with Linked gifts / already paid (advertisedAt)
      // Notification: always paid on first enable (Oleksandr)
      let adsChargeStars = 0;
      let postingPaidThisUpdate = false;
      const postingEligibility =
        await isMainPagePostingFreeEligible(existingGiveaway);
      if (
        dto.isPostingOn === true &&
        !existingGiveaway.isPostingOn &&
        !existingGiveaway.advertisedAt &&
        !postingEligibility.free
      ) {
        adsChargeStars += postingFee;
        postingPaidThisUpdate = true;
      }
      if (
        dto.isNotificationOn === true &&
        !existingGiveaway.isNotificationOn &&
        !existingGiveaway.notificationPaidAt
      )
        adsChargeStars += notificationFee;

      if (adsChargeStars > 0) {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet || Number(wallet.starsBalance) < adsChargeStars) {
          throw HttpException.BadRequest(
            ErrorCodes.NegativeBalance,
            'Insufficient Stars balance for advertising',
          );
        }
        const balanceBefore = Number(wallet.starsBalance);
        await tx.wallet.update({
          where: { userId },
          data: { starsBalance: { decrement: adsChargeStars } },
        });
        await tx.transactionHistory.create({
          data: {
            userId,
            walletId: wallet.id,
            type: TransactionType.Outcoming,
            status: TransactionStatus.Completed,
            currency: Currencies.Stars,
            value: adsChargeStars,
            balanceBefore,
            balanceAfter: balanceBefore - adsChargeStars,
            additionalInfo: `Giveaway advertising | giveaway_${giveawayId}`,
          },
        });
        shouldSendAdMessage = true;
      }

      // Prepare update data - only include fields that are provided
      const updateData: Prisma.GiveawayUncheckedUpdateInput = {};

      if (dto.description !== undefined)
        updateData.description = dto.description;
      if (dto.banner !== undefined) updateData.banner = dto.banner;
      // participationType cannot be changed - validation above will prevent this
      if (dto.completionType !== undefined)
        updateData.completionType = dto.completionType;
      if (dto.language !== undefined) updateData.language = dto.language;
      if (dto.maxParticipants !== undefined)
        updateData.maxParticipants = dto.maxParticipants;
      if (dto.winnerSlots !== undefined)
        updateData.winnerSlots = dto.winnerSlots;
      if (dto.participiationPrice !== undefined)
        updateData.participiationPrice = dto.participiationPrice;
      if (dto.participiationCurr !== undefined)
        updateData.participiationCurr = dto.participiationCurr;
      if (dto.startingAt !== undefined) updateData.startingAt = dto.startingAt;
      if (dto.endingAt !== undefined) updateData.endingAt = dto.endingAt;

      // Non-premium fields (available to all)
      if (dto.numerifyWinners !== undefined)
        updateData.numerifyWinners = dto.numerifyWinners;
      if (existingGiveaway.participiationType === GiveawayStartType.Lottery) {
        // This toggle belongs to Random giveaways. Lottery always draws all
        // ticket rows and therefore permits the same user to win more than once.
        updateData.allowMultipleWinPlaces = true;
      } else if (dto.allowMultipleWinPlaces !== undefined) {
        if (existingGiveaway.finishedAt !== null) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            'Cannot change allowMultipleWinPlaces after giveaway is finished',
          );
        }
        updateData.allowMultipleWinPlaces = dto.allowMultipleWinPlaces;
      }
      if (dto.isResultsInMainPost !== undefined)
        updateData.isResultsInMainPost = dto.isResultsInMainPost;
      if (dto.isCommentsOn !== undefined)
        updateData.isCommentsOn = dto.isCommentsOn;
      if (dto.variant !== undefined) updateData.variant = dto.variant;
      if (dto.isPostingOn !== undefined) {
        updateData.isPostingOn = dto.isPostingOn;
        // advertisedAt only when posting was actually paid (not lottery/gift free)
        if (
          dto.isPostingOn === true &&
          !existingGiveaway.advertisedAt &&
          postingPaidThisUpdate
        ) {
          updateData.advertisedAt = new Date();
        }
      }
      if (dto.isNotificationOn !== undefined) {
        updateData.isNotificationOn = dto.isNotificationOn;
        if (
          dto.isNotificationOn === true &&
          !existingGiveaway.notificationPaidAt
        ) {
          updateData.notificationPaidAt = new Date();
        }
      }

      // Trigger notification when advertising is enabled on an active giveaway that has never been notified
      if (
        dto.isNotificationOn === true &&
        existingGiveaway.isActive &&
        !existingGiveaway.lastNotifiedAt
      ) {
        shouldNotify = true;
      }

      if (dto.isCaptchaNeeded !== undefined)
        updateData.isCaptchaNeeded = dto.isCaptchaNeeded;
      if (dto.participationButtonText !== undefined) {
        updateData.participationButtonText = dto.participationButtonText;
      }
      if (dto.participationButtonStyle !== undefined) {
        updateData.participationButtonStyle = dto.participationButtonStyle;
      }
      if (dto.showParticipationCount !== undefined) {
        updateData.showParticipationCount = dto.showParticipationCount;
      }
      if (dto.showParticipationMaxCount !== undefined) {
        updateData.showParticipationMaxCount = dto.showParticipationMaxCount;
      }

      // Additional tickets (free feature — no subscription required)
      const effectiveCanEarnAdditionalTickets =
        dto.canEarnAdditionalTickets !== undefined
          ? dto.canEarnAdditionalTickets
          : existingGiveaway.canEarnAdditionalTickets;

      if (dto.canEarnAdditionalTickets !== undefined) {
        updateData.canEarnAdditionalTickets = dto.canEarnAdditionalTickets;
      }
      if (dto.countRefsOnParticipation !== undefined) {
        updateData.countRefsOnParticipation = effectiveCanEarnAdditionalTickets
          ? dto.countRefsOnParticipation
          : false;
      } else if (dto.canEarnAdditionalTickets === false) {
        updateData.countRefsOnParticipation = false;
      }
      if (dto.refsPerTicket !== undefined)
        updateData.refsPerTicket = dto.refsPerTicket;
      if (dto.boostsPerTicket !== undefined)
        updateData.boostsPerTicket = dto.boostsPerTicket;
      if (dto.maxAdditionalTickets !== undefined)
        updateData.maxAdditionalTickets = dto.maxAdditionalTickets;

      // Co-sponsor slots (free feature — no subscription required)
      if (dto.sponsorSlots !== undefined)
        updateData.sponsorSlots = dto.sponsorSlots;
      if (dto.starsPerSlot !== undefined)
        updateData.starsPerSlot = dto.starsPerSlot;

      // Premium features - only if user has subscription or used free premium use
      if (canUsePremiumFeatures) {
        if (dto.twinkBlock !== undefined)
          updateData.twinkBlock = dto.twinkBlock;
        if (dto.neededReferals !== undefined)
          updateData.neededReferals = dto.neededReferals;
        if (dto.isOnlyPremium !== undefined)
          updateData.isOnlyPremium = dto.isOnlyPremium;
        if (dto.isBoostNeeded !== undefined)
          updateData.isBoostNeeded = dto.isBoostNeeded;
        if (dto.boostedId !== undefined) updateData.boostedId = dto.boostedId;
        if (dto.allowedGeoCountries !== undefined)
          updateData.allowedGeoCountries = dto.allowedGeoCountries;
        if (dto.doApiSessionCheck !== undefined)
          updateData.doApiSessionCheck = dto.doApiSessionCheck;
        if (dto.isStaySubscribed !== undefined)
          updateData.isStaySubscribed = dto.isStaySubscribed;
      } else {
        // Allow DISABLING premium features even without an active subscription
        if (dto.isStaySubscribed === false) updateData.isStaySubscribed = false;
        if (dto.twinkBlock === false) updateData.twinkBlock = false;
        if (dto.isOnlyPremium === false) updateData.isOnlyPremium = false;
        if (dto.isBoostNeeded === false) updateData.isBoostNeeded = false;
        if (dto.doApiSessionCheck === false)
          updateData.doApiSessionCheck = false;
        if (dto.neededReferals === 0) updateData.neededReferals = 0;
        if (dto.allowedGeoCountries === '') updateData.allowedGeoCountries = '';
      }

      // Update isActive and isPlanned based on startingAt if it's being updated
      if (dto.startingAt !== undefined) {
        const now = moment();
        const startingAtMoment = moment(dto.startingAt);
        updateData.isActive = startingAtMoment.diff(now, 'minutes') <= 1;
        updateData.isPlanned = !updateData.isActive;
      }

      // If the giveaway is stuck in planned state (startingAt already passed but cron missed it
      // because endingAt was expired), heal it immediately so the cron doesn't re-activate it
      // and send a duplicate announcement/notification.
      if (
        !existingGiveaway.isActive &&
        existingGiveaway.isPlanned &&
        updateData.isActive === undefined
      ) {
        const effectiveStartingAt =
          dto.startingAt !== undefined
            ? moment(dto.startingAt)
            : moment(existingGiveaway.startingAt);
        if (
          effectiveStartingAt.isBefore(moment()) ||
          effectiveStartingAt.diff(moment(), 'minutes') <= 1
        ) {
          updateData.isActive = true;
          updateData.isPlanned = false;
        }
      }

      if (updateData.isActive === true && !existingGiveaway.isActive) {
        becameActive = true;
      }

      // Update the giveaway
      await tx.giveaway.update({
        where: { id: giveawayId },
        data: updateData,
      });

      // Decrement free premium uses if used
      if (usedFreePremiumUse) {
        await tx.user.update({
          where: { id: userId },
          data: { freePremiumUses: { decrement: 1 } },
        });
        console.log(
          `[AUDIT] freePremiumUses decremented — userId=${userId}, giveawayId=${giveawayId}, trigger=updateGiveaway(isChangingToPremium), premiumFlags=${dto.listPremiumFeatureFlags().join(',')}`,
        );
      }

      // Update sponsor links if provided
      if (dto.sponsorLinks !== undefined) {
        // Delete existing sponsor links
        // Get sponsorLinkIds for this giveaway's link-type sponsors
        const existingSponsors = await tx.sponsors.findMany({
          where: {
            giveawayId,
            sponsorType: SponsorType.Link,
          },
          select: {
            sponsorLinkId: true,
          },
        });

        // Extract non-null sponsorLinkIds
        const sponsorLinkIds = existingSponsors
          .map((s) => s.sponsorLinkId)
          .filter((id): id is number => id !== null);

        // Delete all SponsorLinks in one operation
        // The CASCADE constraint will automatically delete the associated Sponsors records
        if (sponsorLinkIds.length > 0) {
          await tx.sponsorLink.deleteMany({
            where: {
              id: { in: sponsorLinkIds },
            },
          });
        }

        // Create new sponsor links
        if (dto.sponsorLinks && dto.sponsorLinks.length > 0) {
          for (const linkData of dto.sponsorLinks) {
            if (!linkData || typeof linkData !== 'object') {
              console.warn('Invalid sponsor link data:', linkData);
              continue;
            }

            const title =
              typeof linkData.title === 'string' ? linkData.title : '';
            const link = typeof linkData.link === 'string' ? linkData.link : '';

            if (!link) {
              console.warn('Sponsor link missing URL:', linkData);
              continue;
            }

            const sponsorLink = await tx.sponsorLink.create({
              data: {
                title,
                link,
                imageUrl: null, // Will be populated in background
              },
            });

            await tx.sponsors.create({
              data: {
                giveawayId,
                sponsorType: SponsorType.Link,
                sponsorLinkId: sponsorLink.id,
              },
            });

            // Track for background processing
            updatedSponsorLinks.push({ id: sponsorLink.id, url: link });
          }
        }
      }

      // Update linked channels if provided — upsert/diff to preserve statistics relations
      if (dto.linkedChannels !== undefined) {
        const existingLinkedChannels = await tx.linkedChannels.findMany({
          where: { giveawayId },
        });
        const existingMap = new Map(
          existingLinkedChannels.map((lc) => [lc.channelId.toString(), lc]),
        );

        // Build new desired state from dto
        const newChannelMap = new Map<
          string,
          'All' | 'Posting' | 'Subscription'
        >();
        for (const { id, role } of dto.linkedChannels) {
          if (!id || isNaN(+id)) continue;
          newChannelMap.set(id, role);
        }

        // Delete channels no longer in the new list
        const toDelete = [...existingMap.keys()].filter(
          (id) => !newChannelMap.has(id),
        );
        if (toDelete.length > 0) {
          for (const deletedId of toDelete) {
            if (existingGiveaway.createdById) {
              const tgRefund = await refundAcceptedJointForChannelInTx(
                tx,
                giveawayId,
                BigInt(deletedId),
                existingGiveaway.createdById,
              );
              if (tgRefund) updateJointTelegramRefunds.push(tgRefund);
            }
          }
          await tx.linkedChannels.deleteMany({
            where: {
              giveawayId,
              channelId: { in: toDelete.map((id) => BigInt(id)) },
            },
          });
        }

        const effectiveIsCommentsOn =
          dto.isCommentsOn ?? existingGiveaway.isCommentsOn;
        const effectiveIsResultsInMainPost =
          dto.isResultsInMainPost ?? existingGiveaway.isResultsInMainPost;

        for (const [channelId, role] of newChannelMap.entries()) {
          const channelBigInt = BigInt(channelId);
          const existing = existingMap.get(channelId);

          if (existing) {
            // Update role only — preserve isPostingResults, isResultsInMainPost, isCommentsOn
            if (existing.role !== role) {
              await tx.linkedChannels.update({
                where: {
                  channelId_giveawayId: {
                    channelId: channelBigInt,
                    giveawayId,
                  },
                },
                data: { role },
              });
            }
          } else {
            // New channel — verify it exists
            const channel = await tx.channel.findUnique({
              where: { id: channelBigInt },
              include: { addedBy: { where: { userId } } },
            });
            if (channel) {
              await tx.linkedChannels.create({
                data: {
                  channelId: channelBigInt,
                  giveawayId,
                  role,
                  isResultsInMainPost: effectiveIsResultsInMainPost,
                  isCommentsOn: effectiveIsCommentsOn,
                },
              });
              if (channel.addedBy.length === 0) {
                userService
                  .saveChannelToSearchHistory(userId, channelBigInt)
                  .catch(console.error);
              }
            }
          }
        }
      }

      const linkedForGuards = await tx.linkedChannels.findMany({
        where: { giveawayId },
        select: { role: true },
      });
      const persistedGiveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        select: {
          canEarnAdditionalTickets: true,
          refsPerTicket: true,
          boostsPerTicket: true,
          maxAdditionalTickets: true,
          isBoostNeeded: true,
          boostedId: true,
          neededReferals: true,
          language: true,
        },
      });
      if (persistedGiveaway) {
        assertGiveawayTicketsAndBoostGuards(
          persistedGiveaway,
          countPostingLinkedChannels(linkedForGuards),
          persistedGiveaway.language,
        );
      }

      const giveawayResult = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: GIVEAWAY_OWNER_RELATIONS_INCLUDE,
      });
      return {
        giveaway: giveawayResult,
        jointTelegramRefunds: updateJointTelegramRefunds,
        activatedOnUpdate: becameActive,
      };
    });

    jointTelegramRefunds = updateTxResult.jointTelegramRefunds;
    activatedOnUpdate = updateTxResult.activatedOnUpdate;
    let updatedGiveaway = updateTxResult.giveaway;

    await applyTelegramJointRefunds(jointTelegramRefunds);

    if (activatedOnUpdate) {
      await finalizeJointsOnGiveawayStart(giveawayId);
    }

    // Sync prizes if provided — replace-all semantics, must be inactive giveaway
    if (dto.prizes !== undefined && shouldSyncPrizes) {
      await syncUpdatePrizes(giveawayId, userId, dto.prizes);
      updatedGiveaway = await prisma.giveaway.findUnique({
        where: { id: giveawayId },
        include: GIVEAWAY_OWNER_RELATIONS_INCLUDE,
      });
    }

    // Send "Advertising applied" bot message to creator when paid via in-app balance
    if (shouldSendAdMessage) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { telegramId: true, language_code: true },
        });
        if (user?.telegramId) {
          NotificationService.sendAdvertisingApplied(
            user.telegramId,
            giveawayId,
            user.language_code,
          ).catch((error) => {
            console.error('Error sending advertising applied message:', error);
          });
        }
      } catch (error) {
        console.error(
          'Error fetching user for advertising applied message:',
          error,
        );
      }
    }

    // Send notification if advertising was just enabled on an active giveaway.
    // Use an atomic updateMany to claim the notification slot — prevents duplicate
    // notifications if both this path and the cron activation path run concurrently.
    if (shouldNotify) {
      try {
        const claimed = await prisma.giveaway.updateMany({
          where: { id: giveawayId, lastNotifiedAt: null },
          data: { lastNotifiedAt: new Date() },
        });
        if (claimed.count > 0) {
          NotificationService.notifyGiveawayCreated(giveawayId).catch(
            (error) => {
              console.error(
                'Error sending notification after advertising enabled:',
                error,
              );
            },
          );
        }
      } catch (error) {
        console.error('Error claiming notification slot:', error);
      }
    }

    // Fetch preview images in background (fire-and-forget)
    if (updatedSponsorLinks.length > 0) {
      setImmediate(() => {
        for (const { id, url } of updatedSponsorLinks) {
          updateSponsorLinkImage(id, url, prisma).catch((error) => {
            console.error(
              `Background image fetch failed for link ${id}:`,
              error,
            );
          });
        }
      });
    }

    // Update Telegram messages in channels after successful update.
    // If the giveaway has a real (non-default) description, only update the message
    // when the description actually changed — to preserve any manual edits made in Telegram.
    // For default descriptions, always update (completion conditions are rendered in the body).
    const allDefaultDescs = new Set(
      Object.values(GIVEAWAY_POST_INTRO).flatMap((lang) => Object.values(lang)),
    );
    const hadRealDescription =
      originalDescription !== null && !allDefaultDescs.has(originalDescription);
    const descriptionExplicitlyChanged =
      dto.description !== undefined && dto.description !== originalDescription;
    const bannerExplicitlyChanged =
      dto.banner !== undefined &&
      (dto.banner.length !== originalBanner.length ||
        dto.banner.some((url, index) => url !== originalBanner[index]));
    const shouldUpdateMessages =
      !hadRealDescription ||
      descriptionExplicitlyChanged ||
      bannerExplicitlyChanged;

    try {
      const webappUrl = process.env.BOT_URL;
      if (webappUrl && updatedGiveaway && shouldUpdateMessages) {
        await updateGiveawayMessages(updatedGiveaway.id, webappUrl);
        console.log(
          `Updated Telegram messages for giveaway ${giveawayId} after update`,
        );
      }
    } catch (error) {
      console.error(
        `Error updating Telegram messages for giveaway ${giveawayId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    // Confirm temp banner uploads used in this giveaway (fire-and-forget)
    if (dto.banner?.length) {
      userService.confirmTempBanners(userId, dto.banner).catch(() => {});
    }

    return updatedGiveaway;
  }

  /**
   * Check if user is already participating (for Random type giveaways only)
   */
  async isUserAlreadyParticipating(
    userId: number,
    giveawayId: string,
    tx?: PrismaTransaction,
  ): Promise<boolean> {
    const prismaClient = tx || prisma;
    if (!tx) {
      const giveaway = await prismaClient.giveaway.findUnique({
        where: {
          id: giveawayId,
        },
      });
      if (giveaway.participiationType == GiveawayStartType.Random) {
        return await this.findParticipiation(userId, giveawayId, prismaClient);
      }
      return false;
    }

    return await this.findParticipiation(userId, giveawayId, prismaClient);
  }

  async findParticipiation(
    userId: number,
    giveawayId: string,
    prismaClient: PrismaTransaction | PrismaClient = prisma,
  ) {
    const existingParticipation = await prismaClient.participant.findFirst({
      where: {
        userId,
        giveawayId,
      },
    });
    return !!existingParticipation;
  }

  /**
   * Check if giveaway has reached maximum capacity.
   * Lottery: counts participant rows (tickets). Random: distinct users.
   */
  async hasReachedMaxCapacity(
    giveawayId: string,
    maxParticipants?: number | null,
    tx?: PrismaTransaction,
    additionalSlots: number = 0,
    participiationType?: string,
  ): Promise<boolean> {
    if (!maxParticipants) return false;

    const prismaClient = tx || prisma;
    const current = participiationType
      ? await getCapacityFillCount(prismaClient, giveawayId, participiationType)
      : (
          await prismaClient.participant.groupBy({
            by: ['userId'],
            where: { giveawayId },
          })
        ).length;

    return current + additionalSlots > maxParticipants;
  }

  /**
   * Check if user is subscribed to all sponsor channels
   */
  async isUserSubscribedToSponsors(
    userId: number,
    sponsorChannelIds: (number | bigint)[],
    tx?: PrismaTransaction,
  ): Promise<boolean> {
    if (sponsorChannelIds.length === 0) return true;

    const prismaClient = tx || prisma;
    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });

    return Array.from(
      (
        await batchCheckUserMembership(user.telegramId, sponsorChannelIds)
      ).values(),
    ).every((value) => value);
  }

  /**
   * Check if user is subscribed to all linked channels
   */
  async isUserSubscribedToLinkedChannels(
    userId: number,
    linkedChannelIds: (number | bigint)[],
    tx?: PrismaTransaction,
  ): Promise<boolean> {
    if (linkedChannelIds.length === 0) return true;

    const prismaClient = tx || prisma;
    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });

    return Array.from(
      (
        await batchCheckUserMembership(user.telegramId, linkedChannelIds)
      ).values(),
    ).every((value) => value);
  }

  /**
   * Get detailed subscription status for each sponsor channel
   */
  async getSponsorChannelsSubscriptionStatus(
    userId: number,
    sponsorChannelIds: (number | bigint)[],
    tx?: PrismaTransaction,
  ): Promise<Array<{ channelId: number | bigint; isSubscribed: boolean }>> {
    if (sponsorChannelIds.length === 0) return [];

    const prismaClient = tx || prisma;

    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });
    console.log(userId, sponsorChannelIds, user.telegramId);

    const membershipMap = await batchCheckUserMembership(
      user.telegramId,
      sponsorChannelIds,
    );

    console.log(membershipMap);

    return sponsorChannelIds.map((channelId) => ({
      channelId,
      isSubscribed: membershipMap.get(String(channelId)) || false,
    }));
  }

  /**
   * Get detailed subscription status for each linked channel
   */
  async getLinkedChannelsSubscriptionStatus(
    userId: number,
    linkedChannelIds: (number | bigint)[],
    tx?: PrismaTransaction,
  ): Promise<Array<{ channelId: number | bigint; isSubscribed: boolean }>> {
    if (linkedChannelIds.length === 0) return [];

    const prismaClient = tx || prisma;
    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });

    const membershipMap = await batchCheckUserMembership(
      user.telegramId,
      linkedChannelIds,
    );

    return linkedChannelIds.map((channelId) => ({
      channelId,
      isSubscribed: membershipMap.get(String(channelId)) || false,
    }));
  }

  /**
   * Validate that selected winners are still subscribed to all linked channels
   * Returns only participants who are subscribed to all required channels
   */
  async validateWinnerSubscriptions<
    T extends { user: { telegramId: bigint | string } },
  >(
    participants: T[],
    giveawayId: string,
    tx?: PrismaTransaction,
  ): Promise<T[]> {
    if (participants.length === 0) return [];

    const prismaClient = tx || prisma;

    // Get giveaway — only subscription-required channels matter for stay-subscribed check
    const giveaway = await prismaClient.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        linkedChannels: {
          where: { role: { in: ['All', 'Subscription'] } },
          select: { channelId: true },
        },
      },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // If no subscription channels, all participants are valid
    const linkedChannelIds = giveaway.linkedChannels.map((lc) => lc.channelId);
    if (linkedChannelIds.length === 0) return participants;

    // Check subscription status for each participant
    const validParticipants: typeof participants = [];

    for (const participant of participants) {
      const membershipMap = await batchCheckUserMembership(
        participant.user.telegramId,
        linkedChannelIds,
      );

      // Check if subscribed to ALL linked channels
      const isSubscribedToAll = linkedChannelIds.every(
        (channelId) => membershipMap.get(String(channelId)) === true,
      );

      if (isSubscribedToAll) {
        validParticipants.push(participant);
      }
    }

    return validParticipants;
  }

  /**
   * Check if user has enough referrals for the giveaway
   */
  async hasEnoughReferrals(
    userId: number,
    giveawayId: string,
    neededReferals: number,
    tx?: PrismaTransaction,
  ): Promise<{
    hasEnoughReferrals: boolean;
    referrals: Array<{
      id: number;
      username: string | null;
      first_name: string;
      last_name: string | null;
      photo_url: string;
    }>;
  }> {
    const prismaClient = tx || prisma;

    if (neededReferals === 0) {
      return {
        hasEnoughReferrals: true,
        referrals: [],
      };
    }

    const userReferrals = await prismaClient.giveawayReferral.findMany({
      where: {
        referrerId: userId,
        giveawayId: giveawayId,
      },
      select: {
        referred: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
      },
    });

    const referrals = userReferrals.map((ref) => ref.referred);

    return {
      hasEnoughReferrals: referrals.length >= neededReferals,
      referrals,
    };
  }

  /**
   * Check if user has premium status
   */
  async userHasPremium(userId: number): Promise<boolean> {
    const user = await userService.getOne(userId);
    return user.is_premium;
  }

  /**
   * Check if user is boosting all required channels
   */
  async isUserBoostingChannels(
    userId: number,
    channelIds: (number | bigint)[],
    tx?: PrismaTransaction,
  ): Promise<boolean> {
    if (channelIds.length === 0) return true;

    const prismaClient = tx || prisma;
    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });

    return Array.from(
      (
        await batchCheckUserBoosts(user.telegramId.toString(), channelIds)
      ).values(),
    ).every((value) => value);
  }

  /**
   * Get detailed boost status for each channel
   */
  async getChannelsBoostStatus(
    userId: number,
    channelIds: (number | bigint)[],
    tx?: PrismaTransaction,
  ): Promise<Array<{ channelId: number | bigint; isBoosting: boolean }>> {
    if (channelIds.length === 0) return [];

    const prismaClient = tx || prisma;

    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });

    const boostMap = await batchCheckUserBoosts(
      user.telegramId.toString(),
      channelIds,
    );

    return channelIds.map((channelId) => ({
      channelId,
      isBoosting: boostMap.get(String(channelId)) || false,
    }));
  }

  /**
   * Check if user's country is allowed
   */
  async isUserCountryAllowed(
    userCountry: string,
    allowedGeoCountries: string,
  ): Promise<boolean> {
    if (!allowedGeoCountries || allowedGeoCountries === '') return true;

    return allowedGeoCountries.includes(userCountry);
  }

  /**
   * Check if user has active session (API session check)
   */
  async userHasActiveSession(
    userId: number,
    tx?: PrismaTransaction,
  ): Promise<boolean> {
    const prismaClient = tx || prisma;
    const userSessions = await prismaClient.userSession.count({
      where: {
        userId,
      },
    });

    return userSessions > 0;
  }

  /**
   * Check if user has sufficient balance for lottery participation
   */
  async hasSufficientBalance(
    userId: number,
    participationType: GiveawayStartType,
    participationPrice: number,
    participationCurrency: Currencies,
    tickets: number,
  ): Promise<boolean> {
    if (
      participationType !== GiveawayStartType.Lottery ||
      participationPrice === 0
    ) {
      return true;
    }

    if (isNaN(tickets) || tickets <= 0) {
      return false;
    }

    const user = await userService.getOne(userId);
    const balanceField =
      participationCurrency === Currencies.Stars
        ? 'starsBalance'
        : 'tonBalance';

    return user.wallet[balanceField] >= participationPrice * tickets;
  }

  /**
   * Deduct participation fee from user's balance (for lottery type)
   */
  async deductParticipationFee(
    userId: number,
    participationType: GiveawayStartType,
    participationPrice: number,
    participationCurrency: Currencies,
    tickets: number,
    tx?: PrismaTransaction,
    giveawayId?: string,
  ): Promise<boolean> {
    if (
      participationType !== GiveawayStartType.Lottery ||
      participationPrice === 0
    ) {
      return true;
    }

    const prismaClient = tx || prisma;
    const balanceField =
      participationCurrency === Currencies.Stars
        ? 'starsBalance'
        : 'tonBalance';
    if (participationPrice * tickets < 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        "Value of fee can't be negative",
      );
    }
    try {
      // Get wallet with current balance
      const currentWallet = await prismaClient.wallet.findUnique({
        where: { userId },
      });

      if (!currentWallet) {
        throw new Error('Wallet not found');
      }

      const balanceBefore =
        participationCurrency === Currencies.Stars
          ? currentWallet.starsBalance
          : currentWallet.tonBalance;

      const wallet = await prismaClient.wallet.update({
        where: { userId },
        data: { [balanceField]: { decrement: participationPrice * tickets } },
      });

      const balanceAfter =
        participationCurrency === Currencies.Stars
          ? wallet.starsBalance
          : wallet.tonBalance;

      await prismaClient.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: participationCurrency,
          value: participationPrice * tickets,
          balanceBefore,
          balanceAfter,
          additionalInfo: `Lottery tickets | giveaway_${giveawayId ?? 'unknown'}`,
        },
      });

      return true;
    } catch (error) {
      console.error('Error deducting participation fee:', error);
      return false;
    }
  }

  /**
   * Core validation function for giveaway participation
   * Checks ALL conditions WITHOUT deducting fees or adding participants
   * Creates/updates participation confirmation in DB
   */
  async validateGiveawayParticipation(
    userId: number,
    giveawayId: string,
    userCountry: string,
    tickets: number = 1,
    tx?: PrismaTransaction,
  ) {
    const prismaClient = tx || prisma;

    // Get giveaway with necessary relations
    const giveaway = await prismaClient.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        linkedChannels: true,
      },
    });

    // Giveaway exists
    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Negative balance check
    const userWallet = await prismaClient.wallet.findUnique({
      where: { userId },
      select: { starsBalance: true },
    });
    if (userWallet && userWallet.starsBalance < 0) {
      const lang = giveaway.language?.toLowerCase();
      let giveawayLang: 'en' | 'ru' | 'ua' = 'en';
      if (lang?.startsWith('uk') || lang?.startsWith('ua')) giveawayLang = 'ua';
      else if (lang?.startsWith('ru')) giveawayLang = 'ru';

      throw HttpException.BadRequest(
        ErrorCodes.NegativeBalance,
        GIVEAWAY_ERROR_MESSAGES[giveawayLang].negativeBalance,
      );
    }

    // Giveaway is active
    if (!giveaway.isActive) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Giveaway is not active',
      );
    }

    // Giveaway not cancelled
    if (giveaway.isCancelled) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Giveaway has been cancelled',
      );
    }

    // User not already participating (lottery allows buying additional tickets)
    if (
      giveaway.participiationType !== GiveawayStartType.Lottery &&
      (await this.isUserAlreadyParticipating(userId, giveawayId, prismaClient))
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.Conflict,
        'User is already participating in this giveaway',
      );
    }

    // Capacity check
    if (
      await this.hasReachedMaxCapacity(
        giveawayId,
        giveaway.maxParticipants,
        prismaClient,
        tickets,
        giveaway.participiationType,
      )
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Giveaway has reached maximum participants',
      );
    }

    // Subscription channel check — channels with role All or Subscription
    const subscriptionChannelIds = giveaway.linkedChannels
      .filter((lc) => lc.role === 'All' || lc.role === 'Subscription')
      .map((lc) => lc.channelId);

    if (
      !(await this.isUserSubscribedToLinkedChannels(
        userId,
        subscriptionChannelIds,
        prismaClient,
      ))
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'User is not subscribed to all required channels',
      );
    }

    // Sponsor link visit validation
    const hasVisitedAllLinks =
      await sponsorLinkService.hasVisitedAllSponsorLinks(userId, giveawayId);

    if (!hasVisitedAllLinks) {
      const unvisitedLinks = await sponsorLinkService.getUnvisitedSponsorLinks(
        userId,
        giveawayId,
      );

      throw HttpException.BadRequest(
        ErrorCodes.SponsorLinksNotVisited,
        `Please visit all sponsor links before participating. Unvisited: ${unvisitedLinks.length}`,
      );
    }

    // Referrals check
    const referralCheck = await this.hasEnoughReferrals(
      userId,
      giveawayId,
      giveaway.neededReferals,
      prismaClient,
    );

    if (!referralCheck.hasEnoughReferrals) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Too few referrals',
      );
    }

    // Premium status check
    if (giveaway.isOnlyPremium && !(await this.userHasPremium(userId))) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'User does not have premium',
      );
    }

    // Boost check
    if (giveaway.isBoostNeeded) {
      if (
        !(await this.isUserBoostingChannels(
          userId,
          [giveaway.boostedId],
          prismaClient,
        ))
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'User is not boosting all channels',
        );
      }
    }

    // Country restrictions
    if (
      !(await this.isUserCountryAllowed(
        userCountry,
        giveaway.allowedGeoCountries,
      ))
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        "User's country is blocked in this giveaway",
      );
    }

    // Session check
    if (
      giveaway.doApiSessionCheck &&
      !(await this.userHasActiveSession(userId, prismaClient))
    ) {
      console.log(
        `[ApiSession] Blocked userId=${userId} from joining giveawayId=${giveaway.id} — no active session`,
      );
      prismaClient.giveaway
        .update({
          where: { id: giveaway.id },
          data: { apiSessionBlockCount: { increment: 1 } },
        })
        .catch(() => {});
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        "User doesn't have an active session",
      );
    }

    // NOTE: Balance check is NOT included here - will be done at join time

    // After successful validation - create/update confirmation
    const expiresAt =
      giveaway.endingAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // Giveaway end time or 1 year

    const confirmation =
      await prismaClient.giveawayParticipationConfirmation.upsert({
        where: {
          userId_giveawayId_isUsed: {
            userId,
            giveawayId,
            isUsed: false,
          },
        },
        update: {
          tickets,
          expiresAt,
        },
        create: {
          userId,
          giveawayId,
          tickets,
          expiresAt,
          isUsed: false,
        },
      });

    return confirmation;
  }

  /**
   * Updated joinGiveaway method - simplified to only handle critical checks and payment
   * Non-critical validations should be done via validateGiveawayParticipation first
   */
  async joinGiveaway(
    userId: number,
    giveawayId: string,
    _userCountry: string,
    tickets = 1,
  ) {
    return await prisma.$transaction(async (tx) => {
      // Check confirm
      const confirmation =
        await tx.giveawayParticipationConfirmation.findUnique({
          where: {
            userId_giveawayId_isUsed: {
              userId,
              giveawayId,
              isUsed: false,
            },
          },
        });

      if (!confirmation) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participation not confirmed. Please validate participation first.',
        );
      }

      // Confirm is not expired
      if (confirmation.expiresAt < new Date()) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participation confirmation expired. Please validate again.',
        );
      }

      // Tickets are the same
      if (confirmation.tickets !== tickets) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Ticket count mismatch. Confirmed for ${confirmation.tickets} tickets.`,
        );
      }

      // Get giveaway
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      // Critical checks only
      if (!giveaway.isActive) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway is not active',
        );
      }

      if (giveaway.isCancelled) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway has been cancelled',
        );
      }

      if (await this.isUserAlreadyParticipating(userId, giveawayId, tx)) {
        throw HttpException.BadRequest(
          ErrorCodes.Conflict,
          'User is already participating in this giveaway',
        );
      }

      if (
        await this.hasReachedMaxCapacity(
          giveawayId,
          giveaway.maxParticipants,
          tx,
          tickets,
          giveaway.participiationType,
        )
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway has reached maximum participants',
        );
      }

      // Balance check
      if (
        !(await this.hasSufficientBalance(
          userId,
          giveaway.participiationType,
          Number(giveaway.participiationPrice),
          giveaway.participiationCurr,
          tickets,
        ))
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Insufficient funds',
        );
      }

      // Deduct participation fee
      const feeDeducted = await this.deductParticipationFee(
        userId,
        giveaway.participiationType,
        Number(giveaway.participiationPrice),
        giveaway.participiationCurr,
        tickets,
        tx,
        giveawayId,
      );

      if (!feeDeducted) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Failed to process participation fee',
        );
      }

      // Make it used (for future potential one-time joins)
      // await tx.giveawayParticipationConfirmation.update({
      //   where: { id: confirmation.id },
      //   data: { isUsed: true },
      // });

      // Create participations
      const participations: ({
        giveaway: {
          id: string;
          description: string;
          banner: string[];
          winnerSlots: number;
        };
      } & {
        uuid: string;
        isWinner: boolean;
        winPlace: number;
        participatedAt: Date;
        userId: number;
        giveawayId: string;
      })[] = [];

      for (let i = 0; i < tickets; i++) {
        participations.push(
          await tx.participant.create({
            data: {
              userId,
              giveawayId,
            },
            include: {
              giveaway: {
                select: {
                  id: true,
                  description: true,
                  banner: true,
                  winnerSlots: true,
                },
              },
            },
          }),
        );
      }

      await markReferralParticipatedAndAward(tx, userId, giveawayId);

      if (giveaway.completionType === GiveawayEndType.ByCapacity) {
        const fillCount = await getCapacityFillCount(
          tx,
          giveawayId,
          giveaway.participiationType,
        );
        scheduleCapacityAutoComplete(this, giveaway, fillCount);
      }

      return participations;
    });
  }

  /**
   * Buy additional tickets for a lottery the user is already participating in
   */
  async buyAdditionalTickets(userId: number, giveawayId: string, tickets = 1) {
    return await prisma.$transaction(async (tx) => {
      // Get giveaway
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      // Verify giveaway is a lottery type
      if (giveaway.participiationType !== GiveawayStartType.Lottery) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'This endpoint is only for lottery-type giveaways',
        );
      }

      // Check if user is already participating
      const existingParticipation = await tx.participant.findFirst({
        where: {
          userId,
          giveawayId,
        },
      });

      if (!existingParticipation) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'User must join the lottery first before buying additional tickets',
        );
      }

      // Verify giveaway is active
      if (!giveaway.isActive) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway is not active',
        );
      }

      // Verify giveaway is not cancelled
      if (giveaway.isCancelled) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway has been cancelled',
        );
      }

      if (
        await this.hasReachedMaxCapacity(
          giveawayId,
          giveaway.maxParticipants,
          tx,
          tickets,
          giveaway.participiationType,
        )
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway has reached maximum participants',
        );
      }

      // Verify user has sufficient balance
      if (
        !(await this.hasSufficientBalance(
          userId,
          giveaway.participiationType,
          Number(giveaway.participiationPrice),
          giveaway.participiationCurr,
          tickets,
        ))
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Insufficient funds',
        );
      }

      // Deduct participation fee
      const feeDeducted = await this.deductParticipationFee(
        userId,
        giveaway.participiationType,
        Number(giveaway.participiationPrice),
        giveaway.participiationCurr,
        tickets,
        tx,
        giveawayId,
      );

      if (!feeDeducted) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Failed to process participation fee',
        );
      }

      // Create new ticket participations
      const participations: ({
        giveaway: {
          id: string;
          description: string;
          banner: string[];
          winnerSlots: number;
        };
      } & {
        uuid: string;
        isWinner: boolean;
        winPlace: number;
        participatedAt: Date;
        userId: number;
        giveawayId: string;
      })[] = [];

      for (let i = 0; i < tickets; i++) {
        participations.push(
          await tx.participant.create({
            data: {
              userId,
              giveawayId,
            },
            include: {
              giveaway: {
                select: {
                  id: true,
                  description: true,
                  banner: true,
                  winnerSlots: true,
                },
              },
            },
          }),
        );
      }

      if (giveaway.completionType === GiveawayEndType.ByCapacity) {
        const fillCount = await getCapacityFillCount(
          tx,
          giveawayId,
          giveaway.participiationType,
        );
        scheduleCapacityAutoComplete(this, giveaway, fillCount);
      }

      return participations;
    });
  }

  /**
   * Core logic to cancel a giveaway (internal use only, no permission checks)
   */
  private async cancelGiveawayCore(
    tx: PrismaTransaction,
    giveawayId: string,
    cancelDescription: string,
    includeOptions?: Prisma.GiveawayInclude,
  ): Promise<{
    giveaway: Awaited<ReturnType<typeof tx.giveaway.update>>;
    jointTelegramRefunds: LinkRequestRefundContext[];
  }> {
    // Get giveaway
    const giveaway = await tx.giveaway.findUnique({
      where: { id: giveawayId },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    if (giveaway.isCancelled) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Giveaway is already cancelled',
      );
    }

    // Cancel the giveaway
    const updatedGiveaway = await tx.giveaway.update({
      where: { id: giveawayId },
      data: {
        isCancelled: true,
        isActive: false,
        cancelDescription,
        finishedAt: new Date(),
      },
      include: includeOptions || {
        createdBy: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
        _count: {
          select: {
            participants: true,
          },
        },
      },
    });

    const jointTelegramRefunds = giveaway.createdById
      ? await refundJointsOnCancelInTx(tx, giveawayId, giveaway.createdById)
      : [];

    // Refund ticket fees to participants for paid Lottery giveaways
    if (
      giveaway.participiationType === GiveawayStartType.Lottery &&
      Number(giveaway.participiationPrice) > 0
    ) {
      const participants = await tx.participant.findMany({
        where: { giveawayId },
        select: { userId: true },
      });

      const ticketsByUser = new Map<number, number>();
      for (const p of participants) {
        ticketsByUser.set(p.userId, (ticketsByUser.get(p.userId) ?? 0) + 1);
      }

      const currency = giveaway.participiationCurr;
      const pricePerTicket = Number(giveaway.participiationPrice);
      const balanceField =
        currency === Currencies.Stars ? 'starsBalance' : 'tonBalance';

      for (const [participantUserId, tickets] of ticketsByUser) {
        const refundAmount = pricePerTicket * tickets;

        const wallet = await tx.wallet.upsert({
          where: { userId: participantUserId },
          create: {
            userId: participantUserId,
            starsBalance: 0,
            holdedStarsBalance: 0,
            tonBalance: 0,
          },
          update: {},
        });

        const balanceBefore = wallet[balanceField] as number;

        const updatedWallet = await tx.wallet.update({
          where: { userId: participantUserId },
          data: { [balanceField]: { increment: refundAmount } },
        });

        await tx.transactionHistory.create({
          data: {
            walletId: wallet.id,
            userId: participantUserId,
            type: TransactionType.Incoming,
            status: TransactionStatus.Completed,
            currency,
            value: refundAmount,
            balanceBefore,
            balanceAfter: updatedWallet[balanceField] as number,
            additionalInfo: `Refund: cancelled lottery | giveaway_${giveawayId} (${tickets} ticket(s))`,
          },
        });
      }
    }

    // Refund prizes — at cancel time prizes are always Linked (finished giveaway can't be cancelled)
    const prizesToRefund = await tx.giveawayPrize.findMany({
      where: { giveawayId, status: GiveawayPrizeStatus.Linked },
    });

    for (const prize of prizesToRefund) {
      if ((prize as any).prizeType === 'StandardGift') {
        const starCount = ((prize as any).starCount as number) ?? 0;
        if (starCount > 0) {
          const wallet = await tx.wallet.findUnique({
            where: { userId: giveaway.createdById },
          });
          if (wallet) {
            const balanceBefore = wallet.starsBalance;
            const updated = await tx.wallet.update({
              where: { userId: giveaway.createdById },
              data: { starsBalance: { increment: starCount } },
            });
            await tx.transactionHistory.create({
              data: {
                walletId: wallet.id,
                userId: giveaway.createdById,
                type: TransactionType.Incoming,
                status: TransactionStatus.Completed,
                currency: Currencies.Stars,
                value: starCount,
                balanceBefore,
                balanceAfter: updated.starsBalance,
                additionalInfo: `StandardGift refund on cancel | prize_${prize.id}`,
              },
            });
          }
        }
        await tx.giveawayPrize.update({
          where: { id: prize.id },
          data: { status: GiveawayPrizeStatus.Failed },
        });
      } else {
        // UniqueGift: detach from giveaway so creator can re-use it
        await tx.giveawayPrize.update({
          where: { id: prize.id },
          data: {
            status: GiveawayPrizeStatus.Available,
            giveawayId: null,
            winPlace: null,
            winnerUserId: null,
            claimDeadline: null,
            commissionPaid: false,
            commissionTransactionId: null,
          },
        });
      }
    }

    return { giveaway: updatedGiveaway, jointTelegramRefunds };
  }

  async activateGiveaway(userId: number, giveawayId: string) {
    const activatedGiveaway = await prisma.$transaction(async (tx) => {
      // Get giveaway with creator info
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: {
          createdBy: true,
        },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      // Get user with role
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
      }

      // Check permissions: user must be creator or admin/super admin
      const isCreator = giveaway.createdById === userId;
      const isAdmin =
        user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

      if (!isCreator && !isAdmin) {
        throw HttpException.Forbidden(
          ErrorCodes.Forbidden,
          'You do not have permission to activate this giveaway',
        );
      }

      // Check if giveaway is planned and not active
      if (!giveaway.isPlanned) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway is not in planned state',
        );
      }

      if (giveaway.isActive) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway is already active',
        );
      }

      // Block activation if any linked prizes have unpaid transfer fees
      await validateGiftFeesBeforeActivation(giveawayId);

      const linkedChannels = await tx.linkedChannels.findMany({
        where: { giveawayId },
        select: { role: true },
      });
      assertGiveawayTicketsAndBoostGuards(
        {
          canEarnAdditionalTickets: giveaway.canEarnAdditionalTickets,
          refsPerTicket: giveaway.refsPerTicket,
          boostsPerTicket: giveaway.boostsPerTicket,
          maxAdditionalTickets: giveaway.maxAdditionalTickets,
          isBoostNeeded: giveaway.isBoostNeeded,
          boostedId: giveaway.boostedId,
          neededReferals: giveaway.neededReferals,
        },
        countPostingLinkedChannels(linkedChannels),
        giveaway.language,
      );

      // Activate giveaway
      const activatedGiveaway = await tx.giveaway.update({
        where: { id: giveawayId },
        data: {
          isActive: true,
          isPlanned: false,
        },
        include: {
          createdBy: true,
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
          boostedChannel: true,
        },
      });

      return activatedGiveaway;
    });

    await finalizeJointsOnGiveawayStart(giveawayId);

    // Send announcements and notifications after activation
    if (activatedGiveaway && activatedGiveaway.linkedChannels.length > 0) {
      try {
        const webappUrl = process.env.BOT_URL;
        const linkedChannelIds = activatedGiveaway.linkedChannels.map((lc) =>
          lc.channelId.toString(),
        );

        // Identify co-owner channels — exclude from immediate posting (require approval)
        const sponsorChannels = await identifySponsorChannels(
          activatedGiveaway.id,
          activatedGiveaway.createdById,
        );
        const sponsorChannelIds = new Set(
          sponsorChannels.map((sc) => sc.channelId.toString()),
        );

        // Only post to channels the creator owns
        const hasCreatorChannels = linkedChannelIds.some(
          (channelId) => !sponsorChannelIds.has(channelId),
        );

        if (hasCreatorChannels) {
          const announcementResult = await sendGiveawayAnnouncement(
            activatedGiveaway.id,
            webappUrl,
            Array.from(sponsorChannelIds).map((id) => BigInt(id)),
          );
          console.log(
            `Giveaway ${activatedGiveaway.id} activated - announcements sent to creator channels: ${announcementResult.success} successful, ${announcementResult.failed} failed`,
          );
          if (announcementResult.failed > 0) {
            const failedChannels = announcementResult.results
              .filter((r) => !r.success)
              .map((r) => `Channel ${r.channelId}: ${r.error}`)
              .join(', ');
            console.warn(
              `Failed to send announcements to some channels: ${failedChannels}`,
            );
          }
        }

        // Send approval requests to co-owner channels
        if (sponsorChannels.length > 0) {
          for (const sponsorChannel of sponsorChannels) {
            for (const owner of sponsorChannel.owners) {
              const trackingCode = generateTrackingCode(
                activatedGiveaway.id,
                sponsorChannel.channelId,
              );
              const createdApproval = await prisma.sponsorApproval.upsert({
                where: {
                  giveawayId_channelId_ownerUserId: {
                    giveawayId: activatedGiveaway.id,
                    channelId: sponsorChannel.channelId,
                    ownerUserId: owner.userId,
                  },
                },
                create: {
                  giveawayId: activatedGiveaway.id,
                  channelId: sponsorChannel.channelId,
                  ownerUserId: owner.userId,
                  trackingCode,
                  status: 'Pending',
                },
                update: {},
              });
              const targetUser = await prisma.user.findFirst({
                where: { telegramId: owner.telegramId },
                select: {
                  first_name: true,
                  last_name: true,
                  picked_language: true,
                  language_code: true,
                },
              });
              const result = await sendSponsorApprovalRequest(
                owner.telegramId,
                targetUser?.first_name || '',
                targetUser?.last_name || null,
                {
                  id: activatedGiveaway.id,
                  type: activatedGiveaway.participiationType,
                  createdById: activatedGiveaway.createdById,
                  banner: activatedGiveaway.banner,
                },
                sponsorChannel.channelId,
                sponsorChannel.channelTitle,
                createdApproval.id,
                getUserLanguage(targetUser ?? {}),
                owner.userId,
              );
              if (result.success && result.messageId) {
                await prisma.sponsorApproval.update({
                  where: { id: createdApproval.id },
                  data: { messageId: BigInt(result.messageId) },
                });
              }
              console.log(
                `Sent sponsor approval request to owner ${owner.userId} for channel ${sponsorChannel.channelId}`,
              );
            }
          }
        }

        // Channel subscribers: always notify on activation (free, no isNotificationOn gate)
        await NotificationService.notifyChannelSubscribers(
          activatedGiveaway.id,
        );
        await prisma.giveaway.update({
          where: { id: activatedGiveaway.id },
          data: { lastChannelNotifiedAt: new Date() },
        });

        // Paid broadcast: notify FromAll users not in channel list
        if (
          activatedGiveaway.isNotificationOn &&
          !activatedGiveaway.lastNotifiedAt
        ) {
          await NotificationService.notifyGiveawayCreated(activatedGiveaway.id);
          await prisma.giveaway.update({
            where: { id: activatedGiveaway.id },
            data: { lastNotifiedAt: new Date() },
          });
        }
      } catch (error) {
        console.error(
          `Error sending giveaway announcements for ${activatedGiveaway.id}:`,
          error,
        );
      }
    }

    // Notify creator that giveaway has started (fire-and-forget)
    const creatorTelegramId = activatedGiveaway.createdBy.telegramId;
    if (creatorTelegramId) {
      const giveawayType =
        activatedGiveaway.participiationType === 'Lottery'
          ? 'lottery'
          : 'random';
      identifySponsorChannels(
        activatedGiveaway.id,
        activatedGiveaway.createdById,
      )
        .then((sponsorChannels) =>
          sendCreatorActivationNotification(
            creatorTelegramId,
            activatedGiveaway.id,
            giveawayType,
            activatedGiveaway.language ?? 'en',
            sponsorChannels.length > 0,
            activatedGiveaway.banner,
          ),
        )
        .catch((err) =>
          console.error(
            `Error sending activation notification for ${activatedGiveaway.id}:`,
            err,
          ),
        );
    }

    return activatedGiveaway;
  }

  /**
   * Manually post giveaway announcement to linked channels (creator or admin only)
   */
  async getPostlotChannels(giveawayId: string, userId: number) {
    const addedChannels = await prisma.addedBy.findMany({
      where: { userId },
      include: {
        channel: {
          include: {
            messages: { where: { giveawayId } },
            postlotPublications: { where: { giveawayId } },
          },
        },
      },
    });

    const available = addedChannels
      .map((ab) => ab.channel)
      .filter(
        (ch) => ch.messages.length === 0 && ch.postlotPublications.length === 0,
      )
      .map((ch) => ({
        id: ch.id,
        title: ch.title,
        username: ch.username,
        botCanPostMessages: ch.botCanPostMessages,
      }));

    return { available, total: available.length };
  }

  async postAnnouncement(
    userId: number,
    giveawayId: string,
    channelIds: string[],
  ) {
    // Fetch giveaway with linked channels, creator, and banners
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        linkedChannels: {
          include: {
            channel: {
              include: {
                addedBy: {
                  select: { userId: true },
                },
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            username: true,
          },
        },
      },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Auth check: creator, admin, or channel owner
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
    }

    const isGiveawayCreator = giveaway.createdById === userId;
    const isAdmin =
      user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

    // Resolve requested channels early so we can check channel ownership
    const allowedChannelIds = new Set(channelIds.map(String));
    const filteredLinkedChannels = giveaway.linkedChannels.filter((lc) =>
      allowedChannelIds.has(lc.channelId.toString()),
    );
    if (filteredLinkedChannels.length === 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'No matching linked channels found for this giveaway',
      );
    }

    // Shared access requires both channel ownership and the atomic manager claim.
    const ownedSelectedChannelIds = filteredLinkedChannels
      .filter(
        (lc) =>
          lc.managedByUserId === userId &&
          lc.channel.addedBy.some((entry) => entry.userId === userId),
      )
      .map((lc) => lc.channelId.toString());
    const isChannelOwner = ownedSelectedChannelIds.length > 0;

    if (!isGiveawayCreator && !isAdmin && !isChannelOwner) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You do not have permission to post announcements for this giveaway',
      );
    }

    // Validate state
    if (giveaway.isCancelled) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Giveaway is cancelled',
      );
    }

    // Finished giveaway (not active, not cancelled) → publish results only
    if (!giveaway.isActive) {
      // Creator/admin may target requested channels. A shared manager may only
      // target the channels they claimed above.
      const resultChannelIds =
        isGiveawayCreator || isAdmin
          ? filteredLinkedChannels.map((lc) => lc.channelId)
          : ownedSelectedChannelIds.map(BigInt);
      const targetChannelIds = new Set(resultChannelIds);
      const result = await sendWinnersAnnouncement(
        giveawayId,
        targetChannelIds,
        { forcePublish: true },
      );
      if (result.success === 0) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          result.failed > 0
            ? 'Failed to publish results to the selected channels'
            : 'No channel posts found to update with results. The giveaway announcement may not have been saved.',
        );
      }
      return { republishedResults: true, ...result };
    }

    if (giveaway.linkedChannels.length === 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Giveaway has no linked channels',
      );
    }

    const webappUrl = process.env.BOT_URL;
    let announcementSuccess = 0;
    let announcementFailed = 0;
    let sponsorApprovalsSent = 0;

    const creatorUserId = giveaway.createdBy?.id;

    if (isGiveawayCreator || isAdmin) {
      // Creator / admin path: post to selected channels, send sponsor approvals where needed
      if (creatorUserId) {
        const sponsorChannels = (
          await identifySponsorChannels(giveawayId, creatorUserId)
        ).filter((sc) => allowedChannelIds.has(sc.channelId.toString()));

        const sponsorChannelIds = new Set(
          sponsorChannels.map((sc) => sc.channelId.toString()),
        );

        // Check if there are any creator's own channels among selected
        const hasCreatorChannels = filteredLinkedChannels.some(
          (lc) => !sponsorChannelIds.has(lc.channelId.toString()),
        );

        // Post only to selected non-sponsor channels (exclude everything else)
        if (hasCreatorChannels) {
          const excludeFromPost = giveaway.linkedChannels
            .filter(
              (lc) =>
                !allowedChannelIds.has(lc.channelId.toString()) ||
                sponsorChannelIds.has(lc.channelId.toString()),
            )
            .map((lc) => lc.channelId);
          const announcementResult = await sendGiveawayAnnouncement(
            giveawayId,
            webappUrl,
            excludeFromPost,
          );
          announcementSuccess = announcementResult.success;
          announcementFailed = announcementResult.failed;
        }

        // Send approval requests to sponsor channel owners
        if (sponsorChannels.length > 0) {
          for (const sponsorChannel of sponsorChannels) {
            for (const owner of sponsorChannel.owners) {
              const trackingCode = generateTrackingCode(
                giveawayId,
                sponsorChannel.channelId,
              );

              // Create approval record first to get ID
              const createdApproval = await prisma.sponsorApproval.create({
                data: {
                  giveawayId,
                  channelId: sponsorChannel.channelId,
                  ownerUserId: owner.userId,
                  trackingCode,
                  status: 'Pending',
                },
              });

              // Fetch target user for first_name and last_name
              const targetUser = await prisma.user.findFirst({
                where: {
                  telegramId: owner.telegramId,
                },
                select: {
                  first_name: true,
                  last_name: true,
                  picked_language: true,
                  language_code: true,
                },
              });

              // Send approval request with approval ID
              const result = await sendSponsorApprovalRequest(
                owner.telegramId,
                targetUser?.first_name || '',
                targetUser?.last_name || null,
                {
                  id: giveaway.id,
                  type: giveaway.participiationType,
                  createdById: giveaway.createdById,
                  banner: giveaway.banner,
                },
                sponsorChannel.channelId,
                sponsorChannel.channelTitle,
                createdApproval.id,
                getUserLanguage(targetUser ?? {}),
                owner.userId,
              );

              if (result.success && result.messageId) {
                await prisma.sponsorApproval.update({
                  where: { id: createdApproval.id },
                  data: {
                    messageId: BigInt(result.messageId),
                  },
                });
              }

              sponsorApprovalsSent++;
            }
          }
        }
      } else {
        // No creator - post to selected channels only
        const excludeFromPost = giveaway.linkedChannels
          .filter((lc) => !allowedChannelIds.has(lc.channelId.toString()))
          .map((lc) => lc.channelId);
        const announcementResult = await sendGiveawayAnnouncement(
          giveawayId,
          webappUrl,
          excludeFromPost,
        );
        announcementSuccess = announcementResult.success;
        announcementFailed = announcementResult.failed;
      }
    } else {
      // Shared manager path: reserve each channel before any Telegram side
      // effect so API and bot callbacks cannot publish concurrently.
      const reservedChannelIds: bigint[] = [];
      for (const channelIdString of ownedSelectedChannelIds) {
        const channelId = BigInt(channelIdString);
        if (
          await reserveSharedChannelPublication(giveawayId, channelId, userId)
        ) {
          reservedChannelIds.push(channelId);
        }
      }
      if (reservedChannelIds.length === 0) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'The selected channels are already published or being published',
        );
      }

      let publicationResults:
        | Array<{ channelId: bigint; success: boolean; error?: string }>
        | undefined;
      try {
        const reservedSet = new Set(reservedChannelIds.map(String));
        const excludeFromPost = giveaway.linkedChannels
          .filter((lc) => !reservedSet.has(lc.channelId.toString()))
          .map((lc) => lc.channelId);
        const announcementResult = await sendGiveawayAnnouncement(
          giveawayId,
          webappUrl,
          excludeFromPost,
        );
        publicationResults = announcementResult.results;
        announcementSuccess = announcementResult.success;
        announcementFailed = announcementResult.failed;
      } finally {
        await Promise.all(
          reservedChannelIds.map(async (channelId) => {
            const durableMessage = await prisma.giveawayMessage.findFirst({
              where: { giveawayId, channelId },
              select: { id: true },
            });
            const channelResult = publicationResults?.find(
              (result) => result.channelId === channelId,
            );

            // Clear on a durable DB record or a confirmed Telegram failure.
            // Keep the lock for ambiguous success-without-DB-record to prevent
            // a retry from producing a duplicate channel post.
            if (durableMessage || channelResult?.success === false) {
              await releaseSharedChannelPublication(
                giveawayId,
                channelId,
                userId,
              );
            }
          }),
        );
      }
    }

    // Send user notifications once per giveaway
    if (giveaway.isNotificationOn && !giveaway.lastNotifiedAt) {
      await NotificationService.notifyGiveawayCreated(giveawayId);
      await prisma.giveaway.update({
        where: { id: giveawayId },
        data: { lastNotifiedAt: new Date() },
      });
    }

    return {
      success: announcementSuccess,
      failed: announcementFailed,
      sponsorApprovalsSent,
    };
  }

  async updateChannelSettings(
    userId: number,
    giveawayId: string,
    dto: {
      isPostingResults?: boolean;
      isResultsInMainPost?: boolean;
      isCommentsOn?: boolean;
    },
  ) {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: { createdById: true },
    });
    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Creator keeps their existing own-channel access. A shared admin must both
    // own the channel and be its atomically selected manager.
    const ownedLinkedChannels = await prisma.linkedChannels.findMany({
      where: {
        giveawayId,
        channel: { addedBy: { some: { userId } } },
        ...(giveaway.createdById === userId ? {} : { managedByUserId: userId }),
      },
      select: { channelId: true },
    });

    if (ownedLinkedChannels.length === 0) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You do not manage any channels linked to this giveaway',
      );
    }

    const updateData: {
      isPostingResults?: boolean;
      isResultsInMainPost?: boolean;
      isCommentsOn?: boolean;
    } = {};
    if (dto.isPostingResults !== undefined)
      updateData.isPostingResults = dto.isPostingResults;
    if (dto.isResultsInMainPost !== undefined)
      updateData.isResultsInMainPost = dto.isResultsInMainPost;
    if (dto.isCommentsOn !== undefined)
      updateData.isCommentsOn = dto.isCommentsOn;

    await prisma.linkedChannels.updateMany({
      where: {
        giveawayId,
        channelId: { in: ownedLinkedChannels.map((lc) => lc.channelId) },
      },
      data: updateData,
    });

    return { updatedChannels: ownedLinkedChannels.length };
  }

  async cancelGiveaway(
    userId: number,
    giveawayId: string,
    cancelDescription?: string,
  ) {
    const { giveaway, finalCancelDescription, jointTelegramRefunds } =
      await prisma.$transaction(async (tx) => {
        // Get giveaway with creator info
        const giveaway = await tx.giveaway.findUnique({
          where: { id: giveawayId },
          include: {
            createdBy: true,
          },
        });

        if (!giveaway) {
          throw HttpException.BadRequest(
            ErrorCodes.NotFound,
            'Giveaway not found',
          );
        }

        // Get user with role
        const user = await tx.user.findUnique({
          where: { id: userId },
          include: {
            role: true,
          },
        });

        if (!user) {
          throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
        }

        // Check permissions: user must be creator or admin/super admin
        const isCreator = giveaway.createdById === userId;
        const isAdmin =
          user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

        if (!isCreator && !isAdmin) {
          throw HttpException.Forbidden(
            ErrorCodes.Forbidden,
            'You do not have permission to cancel this giveaway',
          );
        }

        if (
          giveaway.participiationType === GiveawayStartType.Lottery &&
          giveaway.isActive &&
          !giveaway.isPlanned &&
          !giveaway.isCancelled
        ) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            formatGiveawayGuardMessage(
              giveaway.language,
              'cannotCancelActiveLottery',
            ),
          );
        }

        if (
          giveaway.participiationType === GiveawayStartType.Random &&
          giveaway.isActive &&
          !giveaway.isPlanned &&
          !giveaway.isCancelled &&
          (giveaway.sponsorSlots ?? 0) > 0
        ) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            formatGiveawayGuardMessage(
              giveaway.language,
              'cannotCancelActiveGiveawayWithSponsorship',
            ),
          );
        }

        // If no cancel description provided, use localized default
        let finalCancelDescription = cancelDescription;
        if (!finalCancelDescription) {
          const language = normalizeGiveawayLanguage(giveaway.language);
          finalCancelDescription =
            GIVEAWAY_CANCEL_MESSAGES[language].defaultCancel;
        }

        // Use core method to cancel
        const result = await this.cancelGiveawayCore(
          tx,
          giveawayId,
          finalCancelDescription,
        );

        return {
          giveaway: result.giveaway,
          finalCancelDescription,
          jointTelegramRefunds: result.jointTelegramRefunds,
        };
      },
    );

    await applyTelegramJointRefunds(jointTelegramRefunds);

    // After commit: update Telegram posts (do not schedule inside the transaction)
    setTimeout(async () => {
      try {
        await updateCancelledGiveawayMessages(
          giveawayId,
          finalCancelDescription!,
        );
      } catch (error) {
        console.error('Error updating cancelled giveaway messages:', error);
      }
    }, 100);

    return giveaway;
  }

  /**
   * Core logic to finish a giveaway (shared between manual and auto-complete)
   */
  private async finishGiveawayCore(
    tx: PrismaTransaction,
    giveawayId: string,
    includeOptions?: Prisma.GiveawayInclude,
  ) {
    // Get giveaway with participants
    const giveaway = await tx.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        participants: true,
      },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    if (giveaway.isCancelled) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Cannot finish a cancelled giveaway',
      );
    }

    if (giveaway.participants.length === 0) {
      const giveawayLang = normalizeGiveawayLanguage(giveaway.language);
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        GIVEAWAY_ERROR_MESSAGES[giveawayLang].cannotFinishNoParticipants,
      );
    }

    const linkedPrizeCount = await tx.giveawayPrize.count({
      where: { giveawayId, status: GiveawayPrizeStatus.Linked },
    });
    const allowMultipleWinPlaces = effectiveAllowMultipleWinPlaces(
      giveaway.participiationType,
      giveaway.allowMultipleWinPlaces,
    );
    await assertCanFinishGiveawayWithLinkedPrizes(
      giveaway.participants.length,
      giveaway.participants.map((p) => p.userId),
      linkedPrizeCount,
      giveaway.language,
      allowMultipleWinPlaces,
    );

    // Select winners
    const pool = buildMainWinnerCandidatePool(
      giveaway.participants,
      allowMultipleWinPlaces,
    );

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const winners = takeMainWinnerRows(
      pool,
      giveaway.winnerSlots,
      allowMultipleWinPlaces,
    );

    // Update winners (parallel — sequential updates timeout on large giveaways)
    await Promise.all(
      winners.map((winner, i) => {
        const winPlace = giveaway.numerifyWinners ? i + 1 : 0;
        return tx.participant.update({
          where: { uuid: winner.uuid },
          data: {
            isWinner: true,
            winPlace,
          },
        });
      }),
    );

    // Distribute gift prizes to winners (no-op if giveaway has no prizes)
    const winnerPlaces = winners.map((w, i) => ({
      uuid: w.uuid,
      userId: w.userId,
      winPlace: giveaway.numerifyWinners ? i + 1 : 0,
    }));
    await distributePrizeGifts(giveawayId, winnerPlaces, tx);

    await releaseUnassignedLinkedPrizesAfterFinish(
      giveawayId,
      giveaway.createdById,
      tx,
    );

    const finishedGiveaway = await tx.giveaway.update({
      where: { id: giveawayId },
      data: {
        isActive: false,
        isPlanned: false,
        finishedAt: new Date(),
      },
      include: includeOptions || {
        createdBy: true,
        participants: {
          where: {
            isWinner: true,
          },
          orderBy: {
            winPlace: 'asc',
          },
          include: {
            user: true,
          },
        },
      },
    });

    return finishedGiveaway;
  }

  async finishGiveaway(userId: number, giveawayId: string) {
    const finishedGiveaway = await prisma.$transaction(async (tx) => {
      // Get giveaway with creator info for permission check
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: {
          createdBy: true,
          participants: true,
        },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      // Check if giveaway is active before finishing
      if (!giveaway.isActive) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway is not active',
        );
      }

      if (giveaway.isCancelled) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Cannot finish a cancelled giveaway',
        );
      }

      // Get user with role
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
      }

      // Check permissions: user must be creator or admin/super admin
      const isCreator = giveaway.createdById === userId;
      const isAdmin =
        user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

      if (!isCreator && !isAdmin) {
        throw HttpException.Forbidden(
          ErrorCodes.Forbidden,
          'You do not have permission to finish this giveaway',
        );
      }

      // Mark as inactive to prevent duplicate processing
      await tx.giveaway.update({
        where: { id: giveawayId },
        data: { isActive: false },
      });

      const finishedGiveaway = await this.finishGiveawayCore(tx, giveawayId, {
        createdBy: true,
        participants: {
          where: { isWinner: true },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
          },
          orderBy: {
            winPlace: 'asc',
          },
        },
        _count: {
          select: {
            participants: true,
          },
        },
      });

      return finishedGiveaway;
    }, GIVEAWAY_FINISH_TX_OPTIONS);

    schedulePostFinishSideEffects(giveawayId);
    return finishedGiveaway;
  }

  /**
   * Get giveaways that should be completed by capacity
   */
  async getGiveawaysToCompleteByCapacity() {
    const giveaways = await prisma.giveaway.findMany({
      where: {
        isActive: true,
        isPlanned: false,
        completionType: GiveawayEndType.ByCapacity,
        maxParticipants: {
          not: null,
        },
      },
      select: {
        id: true,
        participiationType: true,
        maxParticipants: true,
        _count: { select: { participants: true } },
        participants: { select: { userId: true } },
      },
    });

    return giveaways.filter((g) => {
      if (!g.maxParticipants) return false;
      const fillCount = capacityUsesTicketRows(g.participiationType)
        ? g._count.participants
        : new Set(g.participants.map((p) => p.userId)).size;
      return fillCount >= g.maxParticipants;
    });
  }

  /**
   * Get giveaways that should be completed by time
   */
  async getGiveawaysToCompleteByTime() {
    const now = new Date();
    return await prisma.giveaway.findMany({
      where: {
        isPlanned: false,
        isCancelled: false,
        completionType: GiveawayEndType.ByTime,
        endingAt: {
          not: null,
          lte: now,
        },
        OR: [
          { isActive: true },
          // Retry stuck finish: inactive but never got finishedAt (failed tx + side effects)
          { isActive: false, finishedAt: null },
        ],
      },
    });
  }

  /**
   * Auto-complete a giveaway (used by cron jobs)
   */
  async autoCompleteGiveaway(giveawayId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: {
          participants: true,
        },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      if (giveaway.finishedAt != null) {
        console.log(`Giveaway ${giveawayId} already finished, skipping`);
        return null;
      }

      if (giveaway.isCancelled) {
        console.log(`Giveaway ${giveawayId} is cancelled, skipping`);
        return null;
      }

      if (giveaway.isActive) {
        await tx.giveaway.update({
          where: { id: giveawayId },
          data: { isActive: false },
        });
      } else {
        console.log(
          `Giveaway ${giveawayId} inactive without finishedAt, retrying finish`,
        );
      }

      if (giveaway.participants.length === 0) {
        const language = normalizeGiveawayLanguage(giveaway.language);
        const cancelMessage = GIVEAWAY_CANCEL_MESSAGES[language].autoCancel;
        const cancelled = await this.cancelGiveawayCore(
          tx,
          giveawayId,
          cancelMessage,
        );
        return {
          outcome: 'cancelled' as const,
          cancelMessage,
          giveaway: cancelled.giveaway,
          jointTelegramRefunds: cancelled.jointTelegramRefunds,
        };
      }

      const finishedGiveaway = await this.finishGiveawayCore(tx, giveawayId);
      return { outcome: 'finished' as const, giveaway: finishedGiveaway };
    }, GIVEAWAY_FINISH_TX_OPTIONS);

    if (result?.outcome === 'cancelled') {
      const { cancelMessage, giveaway, jointTelegramRefunds } = result;
      await applyTelegramJointRefunds(jointTelegramRefunds);
      setTimeout(async () => {
        try {
          await updateCancelledGiveawayMessages(giveawayId, cancelMessage);
        } catch (error) {
          console.error(
            `Error updating cancelled giveaway messages for ${giveawayId}:`,
            error,
          );
        }
      }, 100);
      return giveaway;
    }

    if (result?.outcome === 'finished') {
      schedulePostFinishSideEffects(giveawayId);
      return result.giveaway;
    }

    return null;
  }

  /**
   * Get webapp URL for a giveaway
   */
  getGiveawayWebappUrl(giveawayId: string): string {
    const webappUrl = process.env.BOT_URL;
    return `${webappUrl}?startapp=giveawayId_${giveawayId}`;
  }

  async getGiveawayReferralUrl(
    userId: number,
    giveawayId: string,
  ): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
    }
    return `${process.env.BOT_URL}?startapp=giveawayId_${giveawayId}__rId_${user.id}`;
  }

  async getAdditionalTicketsStatus(
    userId: number,
    giveawayId: string,
  ): Promise<AdditionalTicketsStatus> {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: {
        canEarnAdditionalTickets: true,
        maxAdditionalTickets: true,
        countRefsOnParticipation: true,
        refsPerTicket: true,
        boostsPerTicket: true,
        startingAt: true,
        linkedChannels: {
          where: { role: { in: ['All', 'Posting'] } },
          select: {
            channelId: true,
            role: true,
            channel: {
              select: { id: true, title: true, username: true, photo: true },
            },
          },
        },
      },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    const [record, userReferrals, user] = await Promise.all([
      prisma.giveawayEarnedTickets.findUnique({
        where: { giveawayId_userId: { giveawayId, userId } },
      }),
      prisma.giveawayReferral.findMany({
        where: { referrerId: userId, giveawayId },
        select: {
          hasParticipated: true,
          referred: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true },
      }),
    ]);

    const earnedFromRefs = record?.earnedFromRefs ?? 0;
    const earnedFromBoosts = record?.earnedFromBoosts ?? 0;
    const max = giveaway.maxAdditionalTickets;

    // Check which linked channels the user is currently boosting
    // Only count boosts added after the giveaway started to prevent cross-giveaway contamination
    let boostStatuses: Array<{
      channelId: string;
      title: string | null;
      username: string | null;
      photo: string | null;
      isBoosting: boolean;
    }> = [];
    // Boosts are earned by boosting channels the giveaway is posted to (All or Posting)
    // linkedChannels already pre-filtered by the query above
    if (user && giveaway.linkedChannels.length > 0) {
      const channelIds = giveaway.linkedChannels.map((lc) => lc.channelId);
      const sinceUnix = giveaway.startingAt
        ? Math.floor(giveaway.startingAt.getTime() / 1000)
        : undefined;
      const boostMap = await batchCheckUserBoosts(
        user.telegramId,
        channelIds,
        sinceUnix,
      );
      boostStatuses = giveaway.linkedChannels.map((lc) => ({
        channelId: lc.channelId.toString(),
        title: lc.channel.title ?? null,
        username: lc.channel.username ?? null,
        photo: lc.channel.photo ?? null,
        isBoosting: boostMap.get(lc.channelId.toString()) ?? false,
      }));
    }

    const qualifyingReferralsCount = giveaway.countRefsOnParticipation
      ? userReferrals.filter((r) => r.hasParticipated).length
      : userReferrals.length;

    const referralTicketProgress =
      giveaway.canEarnAdditionalTickets && giveaway.refsPerTicket > 0
        ? computeReferralTicketProgress(
            qualifyingReferralsCount,
            giveaway.refsPerTicket,
          )
        : null;

    return {
      canEarnAdditionalTickets: giveaway.canEarnAdditionalTickets,
      earnedFromRefs,
      earnedFromBoosts,
      maxAdditionalTickets: max,
      remaining: max > 0 ? max - earnedFromRefs - earnedFromBoosts : null,
      countRefsOnParticipation: giveaway.countRefsOnParticipation,
      qualifyingReferralsCount,
      refsPerTicket: giveaway.refsPerTicket,
      boostsPerTicket: giveaway.boostsPerTicket,
      referralsTowardNextTicket:
        referralTicketProgress?.referralsTowardNextTicket ?? null,
      referralsNeededForNextTicket:
        referralTicketProgress?.referralsNeededForNextTicket ?? null,
      ticketsFromQualifyingReferrals:
        referralTicketProgress?.ticketsFromQualifyingReferrals ?? null,
      referrals: userReferrals.map((r) => ({
        ...r.referred,
        hasParticipated: r.hasParticipated,
      })),
      boostStatuses,
    };
  }

  async claimBoostTickets(
    userId: number,
    giveawayId: string,
  ): Promise<ClaimBoostResult> {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: { linkedChannels: { select: { channelId: true } } },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    if (!giveaway.canEarnAdditionalTickets || giveaway.boostsPerTicket <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Boost tickets not enabled for this giveaway',
      );
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
    }

    const channelIds = giveaway.linkedChannels.map((lc) => lc.channelId);
    const sinceUnix = giveaway.startingAt
      ? Math.floor(giveaway.startingAt.getTime() / 1000)
      : undefined;
    const boostMap = await batchCheckUserBoosts(
      user.telegramId,
      channelIds,
      sinceUnix,
    );

    // Count how many linked channels the user is currently boosting
    const totalBoosts = [...boostMap.values()].filter(Boolean).length;
    const newlyEarned = Math.floor(totalBoosts / giveaway.boostsPerTicket);

    return await prisma.$transaction(async (tx) => {
      const earnedRecord = await tx.giveawayEarnedTickets.upsert({
        where: { giveawayId_userId: { giveawayId, userId } },
        create: { giveawayId, userId, earnedFromRefs: 0, earnedFromBoosts: 0 },
        update: {},
      });

      let delta = newlyEarned - earnedRecord.earnedFromBoosts;

      if (delta > 0 && giveaway.maxAdditionalTickets > 0) {
        const remaining =
          giveaway.maxAdditionalTickets -
          earnedRecord.earnedFromRefs -
          earnedRecord.earnedFromBoosts;
        delta = Math.min(delta, remaining);
      }

      if (delta > 0) {
        for (let i = 0; i < delta; i++) {
          await tx.participant.create({ data: { userId, giveawayId } });
        }
        await tx.giveawayEarnedTickets.update({
          where: { giveawayId_userId: { giveawayId, userId } },
          data: { earnedFromBoosts: { increment: delta } },
        });
      }

      const updated = await tx.giveawayEarnedTickets.findUnique({
        where: { giveawayId_userId: { giveawayId, userId } },
      });

      const totalEarned =
        (updated?.earnedFromRefs ?? 0) + (updated?.earnedFromBoosts ?? 0);

      return {
        awarded: delta,
        totalEarned,
        remaining:
          giveaway.maxAdditionalTickets > 0
            ? giveaway.maxAdditionalTickets - totalEarned
            : null,
      };
    });
  }

  /**
   * Create a referral for a giveaway if it doesn't exist
   */
  async createReferral(
    giveawayId: string,
    referrerId: number,
    referredId: number,
  ) {
    return await prisma.$transaction(async (tx) => {
      // Verify giveaway exists
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        select: {
          id: true,
          canEarnAdditionalTickets: true,
          countRefsOnParticipation: true,
          refsPerTicket: true,
          maxAdditionalTickets: true,
        },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      // Check if referral already exists
      const existingReferral = await tx.giveawayReferral.findUnique({
        where: {
          giveawayId_referrerId_referredId: {
            giveawayId,
            referrerId,
            referredId,
          },
        },
      });

      if (referrerId == referredId) {
        throw HttpException.BadRequest(
          ErrorCodes.Conflict,
          'Cannot be referal to yourself',
        );
      }

      if (existingReferral) {
        throw HttpException.BadRequest(
          ErrorCodes.Conflict,
          'Referral already exists',
        );
      }

      // Verify both users exist
      const [referrer, referred] = await Promise.all([
        tx.user.findUnique({ where: { id: referrerId } }),
        tx.user.findUnique({ where: { id: referredId } }),
      ]);

      if (!referrer) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Referrer not found',
        );
      }

      if (!referred) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Referred user not found',
        );
      }

      // Create the referral
      let referral;
      try {
        referral = await tx.giveawayReferral.create({
          data: {
            giveawayId,
            referrerId,
            referredId,
          },
          include: {
            giveaway: {
              select: {
                id: true,
                description: true,
                banner: true,
              },
            },
            referrer: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
            referred: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw HttpException.BadRequest(
            ErrorCodes.Conflict,
            'Referral already exists',
          );
        }
        throw e;
      }

      if (giveaway.canEarnAdditionalTickets && giveaway.refsPerTicket > 0) {
        if (!giveaway.countRefsOnParticipation) {
          await syncReferralEarnedTickets(tx, giveaway, referrerId);
        } else {
          const alreadyJoined = await tx.participant.findFirst({
            where: { userId: referredId, giveawayId },
          });
          if (alreadyJoined) {
            await tx.giveawayReferral.update({
              where: { id: referral.id },
              data: { hasParticipated: true },
            });
            await syncReferralEarnedTickets(tx, giveaway, referrerId);
          }
        }
      }

      return referral;
    });
  }

  async getAllParticipants(giveawayId: string, paginateDto: any) {
    // Verify giveaway exists
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Get paginated participants sorted by participatedAt asc
    const participants = await paginate({
      page: paginateDto.page,
      pageSize: paginateDto.pageSize,
      modelName: 'Participant',
      where: {
        giveawayId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
        wonPrize: true,
      },
      orderBy: [
        { participatedAt: 'asc' },
        { winPlace: 'asc' },
        { addPlace: 'asc' },
      ],
    });

    return participants;
  }

  async getNonWinnerParticipants(giveawayId: string, paginateDto: any) {
    // Verify giveaway exists
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Get paginated non-winner participants sorted by participatedAt asc
    const participants = await paginate({
      page: paginateDto.page,
      pageSize: paginateDto.pageSize,
      modelName: 'Participant',
      where: {
        giveawayId,
        isWinner: false,
        isAddWinner: false,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
      },
      orderBy: {
        participatedAt: 'asc',
      },
    });

    return participants;
  }

  async getWinners(giveawayId: string, paginateDto: any) {
    // Verify giveaway exists
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Get paginated main winners sorted by winPlace asc
    const participants = await paginate({
      page: paginateDto.page,
      pageSize: paginateDto.pageSize,
      modelName: 'Participant',
      where: {
        giveawayId,
        isWinner: true,
        wasReplaced: false,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
        wonPrize: true,
      },
      orderBy: {
        winPlace: 'asc',
      },
    });

    return {
      ...participants,
      items: participants.items.map(withWinnerReplaceEligibility),
    };
  }

  async getAdditionalWinners(giveawayId: string, paginateDto: any) {
    // Verify giveaway exists
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    // Get paginated additional winners sorted by addPlace asc
    const participants = await paginate({
      page: paginateDto.page,
      pageSize: paginateDto.pageSize,
      modelName: 'Participant',
      where: {
        giveawayId,
        isAddWinner: true,
        wasReplaced: false,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
        wonPrize: true,
      },
      orderBy: {
        addPlace: 'asc',
      },
    });

    return {
      ...participants,
      items: participants.items.map(withWinnerReplaceEligibility),
    };
  }

  private async getEligibleAdditionalWinnerParticipants(
    prismaClient: PrismaTransaction | PrismaClient,
    giveawayId: string,
  ): Promise<AdditionalWinnerCandidate[]> {
    const existingWinners = await prismaClient.participant.findMany({
      where: {
        giveawayId,
        OR: [{ isWinner: true }, { isAddWinner: true }],
      },
      select: {
        userId: true,
      },
    });

    const excludedUserIds = [
      ...new Set(existingWinners.map((participant) => participant.userId)),
    ];

    const availableParticipants = await prismaClient.participant.findMany({
      where: {
        giveawayId,
        isWinner: false,
        isAddWinner: false,
        ...(excludedUserIds.length > 0
          ? { userId: { notIn: excludedUserIds } }
          : {}),
      },
      orderBy: {
        participatedAt: 'asc',
      },
      include: {
        user: {
          select: ADDITIONAL_WINNER_USER_SELECT,
        },
      },
    });

    const uniqueParticipants: AdditionalWinnerCandidate[] = [];
    const seenUserIds = new Set<number>();

    for (const participant of availableParticipants) {
      if (seenUserIds.has(participant.userId)) continue;
      seenUserIds.add(participant.userId);
      uniqueParticipants.push(participant);
    }

    return uniqueParticipants;
  }

  async selectAdditionalWinners(
    userId: number,
    giveawayId: string,
    rangeStart: number,
    rangeEnd: number,
    count: number,
  ) {
    return await prisma.$transaction(async (tx) => {
      // Verify giveaway exists and user is creator/admin
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: { createdBy: true },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
      }

      // Check authorization
      const isCreator = giveaway.createdById === userId;
      const isAdmin =
        user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

      if (!isCreator && !isAdmin) {
        throw HttpException.Forbidden(
          ErrorCodes.Forbidden,
          'You are not authorized to select additional winners for this giveaway',
        );
      }

      // Check if giveaway is finished
      if (giveaway.isActive) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway must be finished before selecting additional winners',
        );
      }

      // Validate range
      if (rangeStart < 1 || rangeEnd < rangeStart || count < 1) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Invalid range or count parameters',
        );
      }

      // Additional winners are selected from the unique participant list, not ticket rows.
      const allParticipants =
        await this.getEligibleAdditionalWinnerParticipants(tx, giveawayId);

      // Get participants in the specified range (1-based indexing)
      const rangeParticipants = allParticipants.slice(rangeStart - 1, rangeEnd);

      // Validate count doesn't exceed available positions in range
      const maxPositionsInRange = rangeEnd - rangeStart + 1; // +1 because range is inclusive
      if (count > maxPositionsInRange) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Cannot select ${count} winners from range ${rangeStart}-${rangeEnd}. Maximum positions available in range: ${maxPositionsInRange}`,
        );
      }

      // Check if range has enough actual participants
      if (rangeParticipants.length < count) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Not enough participants in range ${rangeStart}-${rangeEnd}. Found ${rangeParticipants.length} participants, need ${count}`,
        );
      }

      // Randomly select 'count' winners from the range
      const shuffled = [...rangeParticipants].sort(() => Math.random() - 0.5);
      let selectedWinners: typeof rangeParticipants = shuffled.slice(0, count);

      // If isStaySubscribed is enabled, validate winners and reselect if needed
      if (giveaway.isStaySubscribed) {
        const validatedWinners = await this.validateWinnerSubscriptions(
          selectedWinners,
          giveawayId,
          tx,
        );

        // If some winners are invalid, try to select more from remaining participants
        if (validatedWinners.length < count) {
          const selectedUuids = new Set(selectedWinners.map((w) => w.uuid));
          const remainingParticipants = rangeParticipants.filter(
            (p) => !selectedUuids.has(p.uuid),
          );

          // Keep trying to find valid winners until we have enough or run out of participants
          let currentValid = validatedWinners;
          let remainingPool = remainingParticipants;

          while (currentValid.length < count && remainingPool.length > 0) {
            const neededCount = count - currentValid.length;
            const nextCandidates = [...remainingPool]
              .sort(() => Math.random() - 0.5)
              .slice(0, Math.min(neededCount * 2, remainingPool.length));

            const validCandidates = await this.validateWinnerSubscriptions(
              nextCandidates,
              giveawayId,
              tx,
            );

            currentValid = [...currentValid, ...validCandidates];

            // Remove tested candidates from remaining pool
            const testedUuids = new Set(nextCandidates.map((c) => c.uuid));
            remainingPool = remainingPool.filter(
              (p) => !testedUuids.has(p.uuid),
            );

            // If we found enough valid winners, break
            if (currentValid.length >= count) {
              break;
            }
          }

          selectedWinners = currentValid.slice(0, count);

          // If we still don't have enough winners, that's okay - we select what we can
          if (selectedWinners.length < count) {
            console.warn(
              `Could only select ${selectedWinners.length} valid additional winners out of ${count} requested for giveaway ${giveawayId}`,
            );
          }
        } else {
          selectedWinners = validatedWinners;
        }
      }

      // Get the current highest addPlace
      const highestAddPlace = await tx.participant.findFirst({
        where: {
          giveawayId,
          isAddWinner: true,
        },
        orderBy: {
          addPlace: 'desc',
        },
        select: {
          addPlace: true,
        },
      });

      let nextAddPlace = (highestAddPlace?.addPlace || 0) + 1;

      // Update the selected participants as additional winners
      const updatedWinners = [];
      for (const winner of selectedWinners) {
        const updated = await tx.participant.update({
          where: { uuid: winner.uuid },
          data: {
            isAddWinner: true,
            addPlace: nextAddPlace,
            range: `${rangeStart}-${rangeEnd}`,
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
          },
        });
        updatedWinners.push(updated);
        nextAddPlace++;
      }

      // Update winner announcement messages asynchronously (don't block response)
      setTimeout(async () => {
        try {
          await updateWinnersAnnouncement(giveawayId);
        } catch (error) {
          console.error(
            'Error updating winner announcements after selecting additional winners:',
            error,
          );
        }
      }, 100);

      return updatedWinners;
    });
  }

  async selectMainWinners(
    userId: number,
    giveawayId: string,
    rangeStart?: number,
    rangeEnd?: number,
    count: number = 1,
  ) {
    return await prisma.$transaction(async (tx) => {
      // Verify giveaway exists and user is creator/admin
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: { createdBy: true },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
      }

      // Check authorization
      const isCreator = giveaway.createdById === userId;
      const isAdmin =
        user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

      if (!isCreator && !isAdmin) {
        throw HttpException.Forbidden(
          ErrorCodes.Forbidden,
          'You are not authorized to select main winners for this giveaway',
        );
      }

      // Check if giveaway is finished
      if (giveaway.isActive) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway must be finished before selecting main winners',
        );
      }

      // Get all participants sorted by participatedAt asc
      const allParticipants = await tx.participant.findMany({
        where: {
          giveawayId,
          isWinner: false,
          isAddWinner: false,
        },
        orderBy: {
          participatedAt: 'asc',
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
              telegramId: true,
            },
          },
        },
      });
      const allowMultipleWinPlaces = effectiveAllowMultipleWinPlaces(
        giveaway.participiationType,
        giveaway.allowMultipleWinPlaces,
      );
      const pool = buildMainWinnerCandidatePool(
        allParticipants,
        allowMultipleWinPlaces,
      );

      // Set default range to all participants if not provided
      const actualRangeStart = rangeStart ?? 1;
      const actualRangeEnd = rangeEnd ?? pool.length;

      // Validate range and count
      if (
        actualRangeStart < 1 ||
        actualRangeEnd < actualRangeStart ||
        count < 1
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Invalid range or count parameters',
        );
      }

      const currentMainWinnerCount = await tx.participant.count({
        where: { giveawayId, isWinner: true },
      });

      // Check if count doesn't exceed configured winner slots
      if (currentMainWinnerCount + count > giveaway.winnerSlots) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Cannot select more winners than winner slots. Winner slots: ${giveaway.winnerSlots}, current: ${currentMainWinnerCount}`,
        );
      }

      // Get participants in the specified range (1-based indexing)
      const rangeParticipants = pool.slice(
        actualRangeStart - 1,
        actualRangeEnd,
      );

      // Validate count doesn't exceed available positions in range
      const maxPositionsInRange = actualRangeEnd - actualRangeStart + 1; // +1 because range is inclusive
      if (count > maxPositionsInRange) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Cannot select ${count} winners from range ${actualRangeStart}-${actualRangeEnd}. Maximum positions available in range: ${maxPositionsInRange}`,
        );
      }

      // Lottery counts ticket rows. Random giveaways count unique users unless
      // multiple places are explicitly enabled.
      const availableWinnerCount = allowMultipleWinPlaces
        ? rangeParticipants.length
        : new Set(rangeParticipants.map((participant) => participant.userId))
            .size;
      if (availableWinnerCount < count) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Not enough participants in range ${actualRangeStart}-${actualRangeEnd}. Found ${availableWinnerCount} eligible participants, need ${count}`,
        );
      }

      // Randomly select ticket rows. Lottery always permits multiple winning
      // rows from the same user; Random follows its configured toggle.
      const shuffled = [...rangeParticipants];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let selectedWinners = takeMainWinnerRows(
        shuffled,
        count,
        allowMultipleWinPlaces,
      );

      // If isStaySubscribed is enabled, validate winners and reselect if needed
      if (giveaway.isStaySubscribed) {
        const validatedWinners = await this.validateWinnerSubscriptions(
          selectedWinners,
          giveawayId,
          tx,
        );

        // If some winners are invalid, try to select more from remaining participants
        if (validatedWinners.length < count) {
          const selectedUuids = new Set(selectedWinners.map((w) => w.uuid));
          const remainingParticipants = rangeParticipants.filter(
            (p) => !selectedUuids.has(p.uuid),
          );

          // Keep trying to find valid winners until we have enough or run out of participants
          let currentValid = validatedWinners;
          let remainingPool = remainingParticipants;

          while (currentValid.length < count && remainingPool.length > 0) {
            const neededCount = count - currentValid.length;
            const nextCandidates = remainingPool
              .sort(() => Math.random() - 0.5)
              .slice(0, Math.min(neededCount * 2, remainingPool.length)); // Select 2x needed to improve chances

            const validCandidates = await this.validateWinnerSubscriptions(
              nextCandidates,
              giveawayId,
              tx,
            );

            currentValid = takeMainWinnerRows(
              [...currentValid, ...validCandidates],
              count,
              allowMultipleWinPlaces,
            );

            // Remove tested candidates from remaining pool
            const testedUuids = new Set(nextCandidates.map((c) => c.uuid));
            remainingPool = remainingPool.filter(
              (p) => !testedUuids.has(p.uuid),
            );

            // If we found enough valid winners, break
            if (currentValid.length >= count) {
              break;
            }
          }

          selectedWinners = currentValid.slice(0, count);

          // If we still don't have enough winners, that's okay - we select what we can
          if (selectedWinners.length < count) {
            console.warn(
              `Could only select ${selectedWinners.length} valid winners out of ${count} requested for giveaway ${giveawayId}`,
            );
          }
        } else {
          selectedWinners = validatedWinners;
        }
      }

      // Get the current highest winPlace
      const highestWinPlace = await tx.participant.findFirst({
        where: {
          giveawayId,
          isWinner: true,
        },
        orderBy: {
          winPlace: 'desc',
        },
        select: {
          winPlace: true,
        },
      });

      let nextWinPlace = giveaway.numerifyWinners
        ? (highestWinPlace?.winPlace || 0) + 1
        : 0;

      // Update the selected participants as main winners
      const updatedWinners = [];
      for (const winner of selectedWinners) {
        const updated = await tx.participant.update({
          where: { uuid: winner.uuid },
          data: {
            isWinner: true,
            winPlace: nextWinPlace,
            range: `${actualRangeStart}-${actualRangeEnd}`,
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                photo_url: true,
              },
            },
          },
        });
        updatedWinners.push(updated);
        if (giveaway.numerifyWinners) {
          nextWinPlace++;
        }
      }

      // Update winner announcement messages asynchronously (don't block response)
      setTimeout(async () => {
        try {
          await updateWinnersAnnouncement(giveawayId);
        } catch (error) {
          console.error(
            'Error updating winner announcements after selecting winners:',
            error,
          );
        }
      }, 100);

      return updatedWinners;
    });
  }

  async replaceWinner(
    userId: number,
    giveawayId: string,
    participantUuid: string,
    options?: { requiredWinnerKind?: WinnerKindFilter },
  ) {
    return await prisma.$transaction(async (tx) => {
      // Verify giveaway exists and user is creator/admin
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: { createdBy: true },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
      }

      // Check authorization
      const isCreator = giveaway.createdById === userId;
      const isAdmin =
        user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

      if (!isCreator && !isAdmin) {
        throw HttpException.Forbidden(
          ErrorCodes.Forbidden,
          'You are not authorized to replace winners for this giveaway',
        );
      }

      // Check if giveaway is finished
      if (giveaway.isActive) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway must be finished before replacing winners',
        );
      }

      // Find the participant to replace
      const oldWinner = await tx.participant.findUnique({
        where: { uuid: participantUuid },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
          wonPrize: {
            select: {
              id: true,
              status: true,
              claimDeadline: true,
              winPlace: true,
            },
          },
        },
      });

      if (!oldWinner) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Participant not found',
        );
      }

      if (oldWinner.giveawayId !== giveawayId) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participant does not belong to this giveaway',
        );
      }

      // Check if participant is actually a winner
      if (
        options?.requiredWinnerKind === 'additional' &&
        !oldWinner.isAddWinner
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participant is not an additional winner',
        );
      }

      if (options?.requiredWinnerKind === 'main' && !oldWinner.isWinner) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participant is not a main winner',
        );
      }

      if (!oldWinner.isWinner && !oldWinner.isAddWinner) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participant is not a winner',
        );
      }

      assertWinnerReplaceAllowed(oldWinner.wonPrize, giveaway.language);

      const prizeToReassign =
        oldWinner.wonPrize?.status === GiveawayPrizeStatus.ReadyToClaim
          ? oldWinner.wonPrize.id
          : null;

      // Get all non-winner participants
      const availableParticipants = oldWinner.isAddWinner
        ? await this.getEligibleAdditionalWinnerParticipants(tx, giveawayId)
        : await tx.participant.findMany({
            where: {
              giveawayId,
              isWinner: false,
              isAddWinner: false,
            },
            orderBy: {
              participatedAt: 'asc',
            },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  first_name: true,
                  last_name: true,
                  photo_url: true,
                  telegramId: true,
                },
              },
            },
          });

      const allowMultipleWinPlaces = effectiveAllowMultipleWinPlaces(
        giveaway.participiationType,
        giveaway.allowMultipleWinPlaces,
      );
      const candidatePool = oldWinner.isAddWinner
        ? availableParticipants
        : buildMainWinnerCandidatePool(
            availableParticipants,
            allowMultipleWinPlaces,
            allowMultipleWinPlaces
              ? []
              : await getMainWinnerUserIds(tx, giveawayId),
          );

      if (candidatePool.length === 0) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'No available participants to replace the winner',
        );
      }

      // Select a new winner, with subscription validation if enabled
      let newWinnerCandidate;

      if (giveaway.isStaySubscribed) {
        // Validate available participants and select from valid ones only
        const validParticipants = await this.validateWinnerSubscriptions(
          candidatePool,
          giveawayId,
          tx,
        );

        if (validParticipants.length === 0) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            'No available participants are subscribed to all required channels',
          );
        }

        // Randomly select from valid participants
        const randomIndex = Math.floor(
          Math.random() * validParticipants.length,
        );
        newWinnerCandidate = validParticipants[randomIndex];
      } else {
        // Randomly select any available participant
        const randomIndex = Math.floor(Math.random() * candidatePool.length);
        newWinnerCandidate = candidatePool[randomIndex];
      }

      // Remove winner status from old winner
      const removedWinner = await tx.participant.update({
        where: { uuid: participantUuid },
        data: {
          isWinner: false,
          isAddWinner: false,
          winPlace: 0,
          addPlace: 0,
          range: '',
          wasReplaced: true,
          wonPrizeId: null,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
          wonPrize: true,
        },
      });

      // Assign winner status to new winner
      const newWinner = await tx.participant.update({
        where: { uuid: newWinnerCandidate.uuid },
        data: {
          isWinner: oldWinner.isWinner,
          isAddWinner: oldWinner.isAddWinner,
          winPlace: oldWinner.winPlace,
          addPlace: oldWinner.addPlace,
          range: oldWinner.range,
          replacedWinnerUuid: participantUuid,
          ...(prizeToReassign ? { wonPrizeId: prizeToReassign } : {}),
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
          wonPrize: true,
        },
      });

      if (prizeToReassign) {
        await tx.giveawayPrize.update({
          where: { id: prizeToReassign },
          data: {
            winnerUserId: newWinnerCandidate.userId,
            status: GiveawayPrizeStatus.ReadyToClaim,
            claimDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      }

      // Send notifications and update winner announcements asynchronously
      setTimeout(async () => {
        try {
          // Notify old winner about being replaced
          await NotificationService.notifyWinnerReplaced(
            removedWinner.userId,
            giveawayId,
          );

          // Notify new winner about being selected
          await NotificationService.notifyNewWinnerSelected(
            newWinner.userId,
            giveawayId,
            newWinner.isWinner ? newWinner.winPlace : newWinner.addPlace,
          );

          // Update winner announcement messages in all channels
          await updateWinnersAnnouncement(giveawayId);
        } catch (error) {
          console.error(
            'Error sending notifications or updating announcements:',
            error,
          );
        }
      }, 100);

      return {
        oldWinner: removedWinner,
        newWinner,
      };
    });
  }

  async removeWinner(
    userId: number,
    giveawayId: string,
    participantUuid: string,
    options?: { requiredWinnerKind?: WinnerKindFilter },
  ) {
    return await prisma.$transaction(async (tx) => {
      // Verify giveaway exists and user is creator/admin
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
        include: { createdBy: true },
      });

      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
      }

      // Check authorization
      const isCreator = giveaway.createdById === userId;
      const isAdmin =
        user.role.id === Roles.Admin || user.role.id === Roles.SuperAdmin;

      if (!isCreator && !isAdmin) {
        throw HttpException.Forbidden(
          ErrorCodes.Forbidden,
          'You are not authorized to remove winners from this giveaway',
        );
      }

      // Check if giveaway is finished
      if (giveaway.isActive) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway must be finished before removing winners',
        );
      }

      // Find the participant to remove
      const winnerToRemove = await tx.participant.findUnique({
        where: { uuid: participantUuid },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
          wonPrize: {
            select: {
              id: true,
              status: true,
              claimDeadline: true,
              winPlace: true,
            },
          },
        },
      });

      if (!winnerToRemove) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Participant not found',
        );
      }

      if (winnerToRemove.giveawayId !== giveawayId) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participant does not belong to this giveaway',
        );
      }

      assertWinnerReplaceAllowed(winnerToRemove.wonPrize, giveaway.language);

      // Check if participant is actually a winner
      if (
        options?.requiredWinnerKind === 'additional' &&
        !winnerToRemove.isAddWinner
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participant is not an additional winner',
        );
      }

      if (options?.requiredWinnerKind === 'main' && !winnerToRemove.isWinner) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participant is not a main winner',
        );
      }

      if (!winnerToRemove.isWinner && !winnerToRemove.isAddWinner) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participant is not a winner',
        );
      }

      // Store place info before removal
      const placeInfo = {
        isWinner: winnerToRemove.isWinner,
        isAddWinner: winnerToRemove.isAddWinner,
        winPlace: winnerToRemove.winPlace,
        addPlace: winnerToRemove.addPlace,
      };

      // Remove winner status
      const removedWinner = await tx.participant.update({
        where: { uuid: participantUuid },
        data: {
          isWinner: false,
          isAddWinner: false,
          winPlace: 0,
          addPlace: 0,
          range: '',
          wonPrizeId: null,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
        },
      });

      // Send notification and update winner announcements asynchronously
      setTimeout(async () => {
        try {
          // Notify removed winner
          await NotificationService.notifyWinnerRemoved(
            removedWinner.userId,
            giveawayId,
            placeInfo.isWinner ? placeInfo.winPlace : placeInfo.addPlace,
          );

          // Update winner announcement messages in all channels
          await updateWinnersAnnouncement(giveawayId);
        } catch (error) {
          console.error(
            'Error sending notification or updating announcements:',
            error,
          );
        }
      }, 100);

      return {
        removedWinner,
      };
    });
  }

  async rechooseAdditionalWinner(
    userId: number,
    giveawayId: string,
    participantUuid: string,
  ) {
    return this.replaceWinner(userId, giveawayId, participantUuid, {
      requiredWinnerKind: 'additional',
    });
  }

  async deleteAdditionalWinner(
    userId: number,
    giveawayId: string,
    participantUuid: string,
  ) {
    return this.removeWinner(userId, giveawayId, participantUuid, {
      requiredWinnerKind: 'additional',
    });
  }

  /**
   * Get default description based on giveaway type and language
   * @param participationType - Type of giveaway (Lottery or Random)
   * @param language - Language code (ua, ru, en)
   * @returns Localized default description
   */
  private getDefaultDescription(
    participationType: GiveawayStartType,
    language: string,
  ): string {
    // Normalize language to ensure it's valid
    const normalizedLang = normalizeGiveawayLanguage(language);

    // Get messages for the language
    const langMessages = GIVEAWAY_POST_INTRO[normalizedLang];

    // Select appropriate variant based on participation type
    return participationType === GiveawayStartType.Lottery
      ? langMessages.lottery
      : langMessages.giveaway;
  }

  /**
   * Create a Telegram Stars invoice link for lottery ticket purchase (direct from Telegram account).
   * Validates participation eligibility, creates/updates a GiveawayParticipationConfirmation,
   * and returns a Telegram Stars invoice link. In-app wallet is NOT involved.
   */
  async createTicketInvoice(
    userId: number,
    giveawayId: string,
    userCountry: string,
    tickets = 1,
  ): Promise<string> {
    await this.validateGiveawayParticipation(
      userId,
      giveawayId,
      userCountry,
      tickets,
    );

    // Get giveaway price
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: { participiationPrice: true },
    });
    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    const totalAmount = Number(giveaway.participiationPrice) * tickets;

    const paymentBody: PaymentBody = {
      userId,
      amount: totalAmount,
      currency: Currencies.Stars,
      p: 2,
      pg: giveawayId,
      pt: tickets,
    };
    const payload = JSON.stringify(paymentBody);

    const title = `Lottery Tickets (${tickets})`;
    const desc = `Buy ${tickets} ticket${tickets > 1 ? 's' : ''} for the lottery`;
    return await createStarsPaymentLink(title, desc, totalAmount, payload);
  }

  /**
   * Register lottery participation after a successful Telegram Stars invoice payment.
   * Unlike joinGiveaway, this does NOT deduct from the in-app wallet — Stars were paid
   * directly via Telegram Payments.
   */
  async joinGiveawayViaInvoice(
    userId: number,
    giveawayId: string,
    tickets: number,
    telegramPaymentChargeId: string,
    paidAmount: number,
  ) {
    return await prisma.$transaction(async (tx) => {
      // Find valid confirmation
      const confirmation =
        await tx.giveawayParticipationConfirmation.findUnique({
          where: {
            userId_giveawayId_isUsed: { userId, giveawayId, isUsed: false },
          },
        });
      if (!confirmation) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Participation not confirmed.',
        );
      }
      if (confirmation.expiresAt < new Date()) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Confirmation expired.',
        );
      }
      if (confirmation.tickets !== tickets) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Ticket count mismatch.',
        );
      }

      // Giveaway still valid
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
      });
      if (!giveaway || !giveaway.isActive || giveaway.isCancelled) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway not available.',
        );
      }

      if (
        await this.hasReachedMaxCapacity(
          giveawayId,
          giveaway.maxParticipants,
          tx,
          tickets,
          giveaway.participiationType,
        )
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Giveaway has reached maximum participants.',
        );
      }

      // Mark confirmation used (delete to avoid P2002 unique constraint violation
      // when user purchases multiple ticket batches for the same giveaway).
      // Wrap in try/catch to handle race condition where two concurrent requests
      // both pass the findUnique check before either deletes the confirmation.
      try {
        await tx.giveawayParticipationConfirmation.delete({
          where: { id: confirmation.id },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2025'
        ) {
          // Another concurrent request already consumed this confirmation
          console.warn(
            `joinGiveawayViaInvoice: confirmation ${confirmation.id} already consumed (race condition) — userId=${userId}, giveawayId=${giveawayId}`,
          );
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            'Payment already processed. Please do not submit twice.',
          );
        }
        throw err;
      }

      // Create participant records
      for (let i = 0; i < tickets; i++) {
        await tx.participant.create({ data: { userId, giveawayId } });
      }

      await markReferralParticipatedAndAward(tx, userId, giveawayId);

      // Record transaction (Outgoing — Stars spent via Telegram, in-app balance unchanged)
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: {
          userId,
          starsBalance: 0,
          holdedStarsBalance: 0,
          tonBalance: 0,
        },
        update: {},
      });
      await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: Currencies.Stars,
          value: paidAmount,
          balanceBefore: wallet.starsBalance,
          balanceAfter: wallet.starsBalance,
          telegramPaymentId: telegramPaymentChargeId,
          additionalInfo: `Lottery tickets | giveaway_${giveawayId} (${tickets} ticket(s), via Telegram Stars)`,
        },
      });

      if (giveaway.completionType === GiveawayEndType.ByCapacity) {
        const fillCount = await getCapacityFillCount(
          tx,
          giveawayId,
          giveaway.participiationType,
        );
        scheduleCapacityAutoComplete(this, giveaway, fillCount);
      }

      return wallet;
    });
  }

  /**
   * Create a Telegram Stars invoice link for enabling advertising on a giveaway.
   * The creator pays directly from their Telegram account — in-app wallet is NOT involved.
   */
  async getAdvertisingInvoiceLink(
    giveawayId: string,
    userId: number,
    isPostingOn: boolean,
    isNotificationOn: boolean,
  ): Promise<AdvertisingInvoiceResult> {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
    });

    if (!giveaway) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    }

    if (giveaway.createdById !== userId) {
      throw HttpException.BadRequest(ErrorCodes.Forbidden, 'Not your giveaway');
    }

    const { postingStars, notificationStars } =
      await advertisingPriceService.getPrices();
    const { free: postingFree } = await isMainPagePostingFreeEligible(giveaway);

    const needPosting = isPostingOn && !giveaway.isPostingOn;
    const needNotification = isNotificationOn && !giveaway.isNotificationOn;

    const postingCharge =
      needPosting && !postingFree && !giveaway.advertisedAt ? postingStars : 0;
    const notificationCharge =
      needNotification && !giveaway.notificationPaidAt ? notificationStars : 0;
    const totalStars = postingCharge + notificationCharge;

    // Free main-page only (no Stars invoice) — apply immediately
    if (totalStars === 0) {
      if (needPosting && postingFree) {
        await prisma.giveaway.update({
          where: { id: giveawayId },
          data: { isPostingOn: true },
        });
        return {
          invoiceLink: null,
          totalStars: 0,
          freePostingApplied: true,
        };
      }
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'No new ad features are being enabled',
      );
    }

    const paymentBody: PaymentBody = {
      p: 3,
      userId,
      amount: totalStars,
      currency: Currencies.Stars,
      pg: giveawayId,
      // Still enable free posting alongside paid notification in one invoice payment
      ppa: needPosting,
      pna: needNotification,
    };

    const title = 'Giveaway Advertising';
    const desc = [
      postingCharge > 0
        ? `Post on front page (${postingStars}⭐)`
        : needPosting && postingFree
          ? 'Post on front page (free)'
          : null,
      notificationCharge > 0
        ? `Notify subscribers (${notificationStars}⭐)`
        : null,
    ]
      .filter(Boolean)
      .join(', ');

    const invoiceLink = await createStarsPaymentLink(
      title,
      desc,
      totalStars,
      JSON.stringify(paymentBody),
    );

    return { invoiceLink, totalStars };
  }

  /**
   * Apply advertising flags after a successful Telegram Stars invoice payment (p=3).
   * Called from the bot's successful_payment handler.
   */
  async applyAdsFromInvoice(
    giveawayId: string,
    userId: number,
    isPostingOn: boolean,
    isNotificationOn: boolean,
    telegramPaymentChargeId: string,
    paidAmount: number,
  ) {
    return await prisma.$transaction(async (tx) => {
      const giveaway = await tx.giveaway.findUnique({
        where: { id: giveawayId },
      });
      if (!giveaway) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Giveaway not found',
        );
      }

      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: {
          userId,
          starsBalance: 0,
          holdedStarsBalance: 0,
          tonBalance: 0,
        },
        update: {},
      });

      await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: Currencies.Stars,
          value: paidAmount,
          balanceBefore: wallet.starsBalance,
          balanceAfter: wallet.starsBalance,
          telegramPaymentId: telegramPaymentChargeId,
          additionalInfo: `Giveaway advertising (via Telegram Stars) | giveaway_${giveawayId}`,
        },
      });

      const updateData: Prisma.GiveawayUncheckedUpdateInput = {};
      if (isPostingOn) {
        updateData.isPostingOn = true;
        const { free: postingFree } =
          await isMainPagePostingFreeEligible(giveaway);
        // Only mark as paid purchase when posting was not free-eligible
        if (!giveaway.advertisedAt && !postingFree) {
          updateData.advertisedAt = new Date();
        }
      }
      if (isNotificationOn) {
        updateData.isNotificationOn = true;
        if (!giveaway.notificationPaidAt)
          updateData.notificationPaidAt = new Date();
      }

      return await tx.giveaway.update({
        where: { id: giveawayId },
        data: updateData,
      });
    });

    // Trigger subscriber notifications when isNotificationOn is enabled on an already-active giveaway
    if (isNotificationOn) {
      try {
        const claimed = await prisma.giveaway.updateMany({
          where: { id: giveawayId, isActive: true, lastNotifiedAt: null },
          data: { lastNotifiedAt: new Date() },
        });
        if (claimed.count > 0) {
          NotificationService.notifyGiveawayCreated(giveawayId).catch(
            (error) => {
              console.error(
                'Error sending notification after Stars advertising payment:',
                error,
              );
            },
          );
        }
      } catch (error) {
        console.error(
          'Error claiming notification slot after Stars advertising:',
          error,
        );
      }
    }
  }

  async getAdvertisingStatus(
    giveawayId: string,
    userId: number,
  ): Promise<AdvertisingStatusResult> {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: {
        id: true,
        participiationType: true,
        isPostingOn: true,
        isNotificationOn: true,
        advertisedAt: true,
        notificationPaidAt: true,
        createdById: true,
      },
    });
    if (!giveaway)
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
    if (giveaway.createdById !== userId)
      throw HttpException.Forbidden(ErrorCodes.Forbidden, 'Access denied');

    const { postingStars, notificationStars } =
      await advertisingPriceService.getPrices();
    const { free: postingFreeEligible, linkedGiftCount } =
      await isMainPagePostingFreeEligible(giveaway);

    return {
      isPostingOn: giveaway.isPostingOn,
      isNotificationOn: giveaway.isNotificationOn,
      advertisedAt: giveaway.advertisedAt,
      notificationPaidAt: giveaway.notificationPaidAt,
      postingFreeEligible,
      postingPriceStars: postingFreeEligible ? 0 : postingStars,
      notificationPriceStars: notificationStars,
      linkedGiftCount,
    };
  }

  async getJoints(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const giveaways = await prisma.giveaway.findMany({
      where: {
        sponsorSlots: { gt: 0 },
        isPlanned: true,
        isCancelled: false,
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
        linkedChannels: { include: { channel: true } },
        sponsoredBy: { include: { sponsorChannel: true, sponsorLink: true } },
        prizes: GIVEAWAY_LINKED_PRIZES_INCLUDE,
        _count: {
          select: {
            participants: true,
            linkRequests: { where: { status: 'Accepted' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Exclude fully-booked giveaways (accepted >= sponsorSlots)
    const available = giveaways.filter(
      (g) => g._count.linkRequests < (g.sponsorSlots ?? 0),
    );
    const total = available.length;
    const paginated = available.slice(skip, skip + limit);

    return {
      data: paginated.map((g) => {
        const { _count, ...giveaway } = g;
        const filledSlots = _count.linkRequests;
        return {
          ...giveaway,
          _count: { participants: _count.participants },
          filledSlots,
          freeSlots: (g.sponsorSlots ?? 0) - filledSlots,
        };
      }),
      total,
      page,
      limit,
    };
  }

  async getJointPaymentQuote(
    giveawayId: string,
    channelId: bigint,
    userId: number,
  ) {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: {
        id: true,
        language: true,
        starsPerSlot: true,
        isPlanned: true,
        isCancelled: true,
        sponsorSlots: true,
        createdById: true,
        _count: { select: { linkRequests: { where: { status: 'Accepted' } } } },
      },
    });

    if (!giveaway || !giveaway.isPlanned || giveaway.isCancelled)
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Giveaway not found or not accepting joint requests',
      );

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { addedBy: { where: { userId } } },
    });

    if (!channel)
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Channel not found');

    if (channel.addedBy.length === 0)
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You do not own this channel',
      );

    const requester = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!requester)
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');

    const starsAmount = giveaway.starsPerSlot ?? 0;
    const walletBalance = requester.wallet?.starsBalance ?? 0;
    const lang = normalizeLang(
      requester.picked_language ?? requester.language_code ?? giveaway.language,
    );

    return {
      starsAmount,
      walletBalance,
      canPayFromWallet: starsAmount === 0 || walletBalance >= starsAmount,
      canPayFromTelegram: starsAmount > 0,
      labels: {
        wallet: PAYMENT_LABELS.payFromBalance[lang],
        telegram: PAYMENT_LABELS.payFromTelegram[lang],
      },
      endpoints: {
        wallet: `POST /api/giveaways/${giveawayId}/joints`,
        telegram: `POST /api/giveaways/${giveawayId}/joints/invoice`,
      },
    };
  }

  async createJoint(giveawayId: string, channelId: bigint, userId: number) {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        createdBy: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            username: true,
            telegramId: true,
          },
        },
        _count: { select: { linkRequests: { where: { status: 'Accepted' } } } },
      },
    });

    if (!giveaway || !giveaway.isPlanned || giveaway.isCancelled)
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Giveaway not found or not accepting joint requests',
      );

    if (!giveaway.sponsorSlots || giveaway.sponsorSlots <= 0)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'This giveaway has no open sponsor slots',
      );

    if (giveaway._count.linkRequests >= giveaway.sponsorSlots)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'All sponsor slots are filled',
      );

    if (giveaway.createdById === userId)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'You cannot join your own giveaway',
      );

    await syncChannelFromTelegram(channelId);

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { addedBy: { where: { userId } } },
    });

    if (!channel)
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Channel not found');

    if (channel.addedBy.length === 0)
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You do not own this channel',
      );

    const existing = await prisma.linkRequest.findUnique({
      where: { giveawayId_channelId: { giveawayId, channelId } },
    });
    if (existing)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'A request for this channel already exists',
      );

    const starsAmount = giveaway.starsPerSlot ?? 0;

    const requester = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!requester)
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');

    if (starsAmount > 0) {
      if (!requester.wallet || requester.wallet.starsBalance < starsAmount)
        throw HttpException.BadRequest(
          ErrorCodes.NegativeBalance,
          'Insufficient Stars balance',
        );
    }

    const linkRequest = await prisma.$transaction(async (tx) => {
      if (starsAmount > 0 && requester.wallet) {
        const balanceBefore = requester.wallet.starsBalance;
        await tx.wallet.update({
          where: { userId },
          data: { starsBalance: { decrement: starsAmount } },
        });
        await tx.transactionHistory.create({
          data: {
            userId,
            walletId: requester.wallet.id,
            type: TransactionType.Outcoming,
            status: TransactionStatus.Completed,
            currency: Currencies.Stars,
            value: starsAmount,
            balanceBefore,
            balanceAfter: balanceBefore - starsAmount,
            additionalInfo: `Giveaway joint ${giveawayId}`,
          },
        });
      }

      return tx.linkRequest.create({
        data: {
          giveawayId,
          channelId,
          requesterId: userId,
          starsAmount,
          paidFromBalance: true,
        },
      });
    });

    // Send bot notifications (non-blocking)
    setImmediate(async () => {
      try {
        if (giveaway.createdBy?.telegramId) {
          const creatorResult = await sendLinkRequestCreatorNotification(
            giveaway.createdBy.telegramId,
            requester.first_name,
            requester.last_name ?? null,
            channel.title ?? `Channel ${channelId}`,
            channel.username ?? null,
            requester.telegramId,
            giveaway.language,
            linkRequest.id,
          );
          if (creatorResult.messageId) {
            await prisma.linkRequest.update({
              where: { id: linkRequest.id },
              data: { creatorMessageId: BigInt(creatorResult.messageId) },
            });
          }
        }
      } catch (err) {
        console.error('createJoint: creator notification error', err);
      }

      try {
        if (requester.telegramId) {
          const senderResult = await sendLinkRequestSenderNotification(
            requester.telegramId,
            requester.first_name,
            requester.last_name ?? null,
            giveaway.language,
            linkRequest.id,
          );
          if (senderResult.messageId) {
            await prisma.linkRequest.update({
              where: { id: linkRequest.id },
              data: { senderMessageId: BigInt(senderResult.messageId) },
            });
          }
        }
      } catch (err) {
        console.error('createJoint: sender notification error', err);
      }
    });

    return { requestId: linkRequest.id };
  }

  async withdrawJoint(giveawayId: string, channelId: bigint, userId: number) {
    const linkRequest = await prisma.linkRequest.findUnique({
      where: { giveawayId_channelId: { giveawayId, channelId } },
      include: {
        requester: {
          select: {
            id: true,
            telegramId: true,
            first_name: true,
            last_name: true,
            wallet: true,
          },
        },
        giveaway: {
          select: {
            language: true,
            createdBy: { select: { telegramId: true } },
          },
        },
        channel: { select: { title: true, username: true } },
      },
    });

    if (!linkRequest)
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Link request not found',
      );

    if (linkRequest.requesterId !== userId)
      throw HttpException.Forbidden(ErrorCodes.Forbidden, 'Access denied');

    if (linkRequest.status !== 'Pending')
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Request is no longer pending',
      );

    await prisma.$transaction(async (tx) => {
      await tx.linkRequest.update({
        where: { id: linkRequest.id },
        data: { status: 'Withdrawn' },
      });

      await refundLinkRequestWalletInTx(tx, linkRequest);
    });

    if (!linkRequest.paidFromBalance) {
      await refundLinkRequestViaTelegram(linkRequest);
    }

    // Edit bot messages (non-blocking)
    setImmediate(async () => {
      const lang = normalizeLang(linkRequest.giveaway.language);
      const messages = LINK_REQUEST_MESSAGES[lang];
      const requester = linkRequest.requester;
      const channelTitle = linkRequest.channel.title ?? '';
      const channelUsername = linkRequest.channel.username ?? null;

      try {
        if (
          linkRequest.creatorMessageId &&
          linkRequest.giveaway.createdBy?.telegramId
        ) {
          const originalText = messages.creatorRequest(
            requester.first_name,
            requester.last_name ?? null,
            channelTitle,
          );
          const remainingButtons: Array<Array<{ text: string; url?: string }>> =
            [];
          if (channelUsername) {
            remainingButtons.push([
              { text: channelTitle, url: `https://t.me/${channelUsername}` },
            ]);
          }
          remainingButtons.push([
            {
              text: messages.creatorContactBtn,
              url: `tg://user?id=${requester.telegramId}`,
            },
          ]);
          await editLinkRequestMessage(
            linkRequest.giveaway.createdBy.telegramId,
            linkRequest.creatorMessageId,
            originalText,
            messages.creatorWithdrawnStatus,
            remainingButtons,
          );
        }
      } catch (err) {
        console.error('withdrawJoint: edit creator message error', err);
      }

      try {
        if (linkRequest.senderMessageId && requester.telegramId) {
          const originalText = messages.senderSubmitted(
            requester.first_name,
            requester.last_name ?? null,
          );
          await editLinkRequestMessage(
            requester.telegramId,
            linkRequest.senderMessageId,
            originalText,
            messages.senderWithdrawnStatus,
            [],
          );
        }
      } catch (err) {
        console.error('withdrawJoint: edit sender message error', err);
      }
    });

    return { success: true };
  }

  async createJointInvoice(
    giveawayId: string,
    channelId: bigint,
    userId: number,
  ): Promise<string> {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        _count: { select: { linkRequests: { where: { status: 'Accepted' } } } },
      },
    });

    if (!giveaway || !giveaway.isPlanned || giveaway.isCancelled)
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Giveaway not found or not accepting joint requests',
      );

    if (!giveaway.sponsorSlots || giveaway.sponsorSlots <= 0)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'This giveaway has no open sponsor slots',
      );

    if (giveaway._count.linkRequests >= giveaway.sponsorSlots)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'All sponsor slots are filled',
      );

    if (giveaway.createdById === userId)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'You cannot join your own giveaway',
      );

    await syncChannelFromTelegram(channelId);

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { addedBy: { where: { userId } } },
    });

    if (!channel)
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Channel not found');

    if (channel.addedBy.length === 0)
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You do not own this channel',
      );

    const existing = await prisma.linkRequest.findUnique({
      where: { giveawayId_channelId: { giveawayId, channelId } },
    });
    if (existing)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'A request for this channel already exists',
      );

    const starsAmount = giveaway.starsPerSlot ?? 0;
    if (starsAmount <= 0)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'This giveaway does not have a Stars price set for slots',
      );

    const paymentBody: PaymentBody = {
      userId,
      amount: starsAmount,
      currency: Currencies.Stars,
      p: 4,
      pg: giveawayId,
      pch: channelId.toString(),
    };

    const title = 'Giveaway Co-Sponsor Slot';
    const desc = `Join giveaway as co-sponsor (${starsAmount}⭐)`;
    return await createStarsPaymentLink(
      title,
      desc,
      starsAmount,
      JSON.stringify(paymentBody),
    );
  }

  async processJointPayment(
    userId: number,
    giveawayId: string,
    channelId: bigint,
    telegramPaymentChargeId: string,
    paidAmount: number,
  ): Promise<void> {
    const existingCharge = await prisma.transactionHistory.findFirst({
      where: { telegramPaymentId: telegramPaymentChargeId },
    });
    if (existingCharge) return;

    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        createdBy: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            username: true,
            telegramId: true,
          },
        },
        _count: { select: { linkRequests: { where: { status: 'Accepted' } } } },
      },
    });

    if (!giveaway || !giveaway.isPlanned || giveaway.isCancelled)
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Giveaway not found or not accepting joint requests',
      );

    if (!giveaway.sponsorSlots || giveaway.sponsorSlots <= 0)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'This giveaway has no open sponsor slots',
      );

    if (giveaway._count.linkRequests >= giveaway.sponsorSlots)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'All sponsor slots are filled',
      );

    if (giveaway.createdById === userId)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'You cannot join your own giveaway',
      );

    const existing = await prisma.linkRequest.findUnique({
      where: { giveawayId_channelId: { giveawayId, channelId } },
    });
    if (existing)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'A request for this channel already exists',
      );

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { addedBy: { where: { userId } } },
    });

    if (!channel)
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Channel not found');

    if (channel.addedBy.length === 0)
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'You do not own this channel',
      );

    const expectedAmount = giveaway.starsPerSlot ?? 0;
    if (expectedAmount <= 0)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'This giveaway does not have a Stars price set for slots',
      );

    if (paidAmount !== expectedAmount)
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Payment amount does not match slot price',
      );

    await syncChannelFromTelegram(channelId);

    const refreshedChannel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { title: true, username: true },
    });

    const requester = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!requester)
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');

    const linkRequest = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: {
          userId,
          starsBalance: 0,
          holdedStarsBalance: 0,
          tonBalance: 0,
        },
        update: {},
      });

      await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: Currencies.Stars,
          value: paidAmount,
          balanceBefore: wallet.starsBalance,
          balanceAfter: wallet.starsBalance,
          additionalInfo: `Giveaway joint ${giveawayId}`,
          telegramPaymentId: telegramPaymentChargeId,
        },
      });

      return tx.linkRequest.create({
        data: {
          giveawayId,
          channelId,
          requesterId: userId,
          starsAmount: paidAmount,
          paidFromBalance: false,
        },
      });
    });

    // Send bot notifications (non-blocking)
    setImmediate(async () => {
      try {
        if (giveaway.createdBy?.telegramId) {
          const creatorResult = await sendLinkRequestCreatorNotification(
            giveaway.createdBy.telegramId,
            requester.first_name,
            requester.last_name ?? null,
            refreshedChannel?.title ?? channel?.title ?? `Channel ${channelId}`,
            refreshedChannel?.username ?? channel?.username ?? null,
            requester.telegramId,
            giveaway.language,
            linkRequest.id,
          );
          if (creatorResult.messageId) {
            await prisma.linkRequest.update({
              where: { id: linkRequest.id },
              data: { creatorMessageId: BigInt(creatorResult.messageId) },
            });
          }
        }
      } catch (err) {
        console.error('processJointPayment: creator notification error', err);
      }

      try {
        if (requester.telegramId) {
          const senderResult = await sendLinkRequestSenderNotification(
            requester.telegramId,
            requester.first_name,
            requester.last_name ?? null,
            giveaway.language,
            linkRequest.id,
          );
          if (senderResult.messageId) {
            await prisma.linkRequest.update({
              where: { id: linkRequest.id },
              data: { senderMessageId: BigInt(senderResult.messageId) },
            });
          }
        }
      } catch (err) {
        console.error('processJointPayment: sender notification error', err);
      }
    });
  }
}

export const giveawayService = new GiveawayService();

/** Still-active giveaways — only these get sponsor-approval DMs resent on /start. */
export const SPONSOR_APPROVAL_OPEN_GIVEAWAY_WHERE = {
  isCancelled: false,
  finishedAt: null,
  isActive: true,
} as const;

// Giveaway update rules (PATCH /giveaways/:id only)

type GiveawayForUpdateRules = {
  participiationType: GiveawayStartType;
  isActive: boolean;
  isPlanned: boolean;
  isCancelled: boolean;
  language: string;
  winnerSlots: number;
  maxParticipants: number | null;
  sponsorSlots: number | null;
  participiationPrice: Prisma.Decimal;
  startingAt: Date;
  endingAt: Date | null;
};

type LotteryGiveawayForUpdate = GiveawayForUpdateRules;
type RandomGiveawayForUpdate = GiveawayForUpdateRules;

/**
 * Enforces editable fields for planned vs active lotteries on giveaway update.
 * Early finish / cancel have separate rules outside this function.
 */
async function assertLotteryGiveawayUpdateAllowed(
  existing: LotteryGiveawayForUpdate,
  dto: UpdateGiveawayDto,
  giveawayId: string,
  tx: PrismaTransaction,
  prizesChanged: boolean,
  errorLanguage: string,
) {
  if (existing.participiationType !== GiveawayStartType.Lottery) {
    return;
  }

  const isActiveLottery =
    existing.isActive && !existing.isPlanned && !existing.isCancelled;
  const isPlannedLottery =
    existing.isPlanned && !existing.isActive && !existing.isCancelled;

  if (
    dto.winnerSlots !== undefined &&
    dto.winnerSlots !== existing.winnerSlots
  ) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(
        existing.language,
        'cannotChangeWinningTicketCountLottery',
      ),
    );
  }

  if (dto.sponsorSlots !== undefined) {
    const prevSlots = existing.sponsorSlots ?? 0;
    const nextSlots = dto.sponsorSlots ?? 0;
    if (prevSlots > 0 && nextSlots < prevSlots) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'cannotDisableSponsorSearchLottery',
        ),
      );
    }
  }

  if (dto.prizes !== undefined && prizesChanged) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(errorLanguage, 'cannotChangeGiftsOnUpdate'),
    );
  }

  if (dto.maxParticipants !== undefined && dto.maxParticipants !== null) {
    const soldTickets = await tx.participant.count({ where: { giveawayId } });
    const minTickets = Math.max(existing.winnerSlots, soldTickets);
    if (dto.maxParticipants < minTickets) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'ticketCapacityBelowMinimum',
          minTickets,
        ),
      );
    }
  }

  if (dto.endingAt !== undefined && dto.endingAt !== null) {
    const newEnd = moment(dto.endingAt);
    if (isActiveLottery) {
      if (newEnd.isBefore(moment())) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          formatGiveawayGuardMessage(
            existing.language,
            'endTimeCannotBeBeforeNow',
          ),
        );
      }
    } else if (isPlannedLottery) {
      const effectiveStart = dto.startingAt
        ? moment(dto.startingAt)
        : moment(existing.startingAt);
      if (newEnd.isBefore(effectiveStart)) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          formatGiveawayGuardMessage(
            existing.language,
            'endTimeCannotBeBeforeStart',
          ),
        );
      }
    }
  }

  if (dto.startingAt !== undefined && isPlannedLottery) {
    const newStart = moment(dto.startingAt);
    if (newStart.isBefore(moment())) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'startTimeCannotBeBeforeNow',
        ),
      );
    }
  }

  if (dto.participiationPrice !== undefined) {
    const newPrice = Number(dto.participiationPrice);
    const oldPrice = Number(existing.participiationPrice);
    if (isActiveLottery && newPrice < oldPrice) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'ticketPriceIncreaseOnlyActiveLottery',
        ),
      );
    }
  }
}

/**
 * Enforces editable fields for planned vs active random giveaways on update.
 * Early finish / cancel have separate rules outside this function.
 */
async function assertRandomGiveawayUpdateAllowed(
  existing: RandomGiveawayForUpdate,
  dto: UpdateGiveawayDto,
  giveawayId: string,
  tx: PrismaTransaction,
  prizesChanged: boolean,
  errorLanguage: string,
) {
  if (existing.participiationType !== GiveawayStartType.Random) {
    return;
  }

  const isActiveRandom =
    existing.isActive && !existing.isPlanned && !existing.isCancelled;
  const isPlannedRandom =
    existing.isPlanned && !existing.isActive && !existing.isCancelled;
  const hasSponsorship = (existing.sponsorSlots ?? 0) > 0;

  const linkedPrizeCount = await tx.giveawayPrize.count({
    where: { giveawayId, status: GiveawayPrizeStatus.Linked },
  });
  const hasLinkedGifts = linkedPrizeCount > 0;

  const participantCount = await tx.participant.count({
    where: { giveawayId },
  });

  if (dto.prizes !== undefined && prizesChanged) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(errorLanguage, 'cannotChangeGiftsOnUpdate'),
    );
  }

  if (hasSponsorship && dto.sponsorSlots !== undefined) {
    const prevSlots = existing.sponsorSlots ?? 0;
    const nextSlots = dto.sponsorSlots ?? 0;
    if (nextSlots < prevSlots) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'cannotDisableSponsorSearch',
        ),
      );
    }
  }

  if (hasSponsorship && dto.sponsorLinks !== undefined) {
    const existingLinkCount = await tx.sponsors.count({
      where: { giveawayId, sponsorType: SponsorType.Link },
    });
    if (dto.sponsorLinks.length < existingLinkCount) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'cannotRemoveSponsorLinks',
        ),
      );
    }
  }

  if (
    dto.winnerSlots !== undefined &&
    dto.winnerSlots !== existing.winnerSlots
  ) {
    if (hasLinkedGifts) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'winnerCountFixedByLinkedGifts',
        ),
      );
    }

    if (isActiveRandom) {
      const minWinners = Math.max(participantCount, existing.winnerSlots);
      if (dto.winnerSlots < minWinners) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          formatGiveawayGuardMessage(
            existing.language,
            'winnerCountBelowMinimum',
            minWinners,
          ),
        );
      }
    }
  }

  if (dto.maxParticipants !== undefined && dto.maxParticipants !== null) {
    const effectiveWinners = dto.winnerSlots ?? existing.winnerSlots;

    if (dto.maxParticipants < effectiveWinners) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'participantCapacityBelowWinnerCount',
          effectiveWinners,
        ),
      );
    }

    if (hasSponsorship) {
      const currentCap = existing.maxParticipants;
      if (currentCap != null && dto.maxParticipants < currentCap) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          formatGiveawayGuardMessage(
            existing.language,
            'participantCapacityIncreaseOnlyWithSponsorship',
          ),
        );
      }
    } else if (isActiveRandom && dto.maxParticipants < participantCount) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'participantCapacityBelowParticipantCount',
          participantCount,
        ),
      );
    }
  }

  if (dto.endingAt !== undefined && dto.endingAt !== null) {
    const newEnd = moment(dto.endingAt);

    if (isActiveRandom) {
      if (newEnd.isBefore(moment())) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          formatGiveawayGuardMessage(
            existing.language,
            'endTimeCannotBeBeforeNow',
          ),
        );
      }
      if (
        hasSponsorship &&
        existing.endingAt &&
        newEnd.isBefore(moment(existing.endingAt))
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          formatGiveawayGuardMessage(
            existing.language,
            'endTimeExtendOnlyWithSponsorship',
          ),
        );
      }
    } else if (isPlannedRandom) {
      const effectiveStart = dto.startingAt
        ? moment(dto.startingAt)
        : moment(existing.startingAt);
      if (newEnd.isBefore(effectiveStart)) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          formatGiveawayGuardMessage(
            existing.language,
            'endTimeCannotBeBeforeStart',
          ),
        );
      }
      if (
        hasSponsorship &&
        existing.endingAt &&
        newEnd.isBefore(moment(existing.endingAt))
      ) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          formatGiveawayGuardMessage(
            existing.language,
            'endTimeExtendOnlyWithSponsorship',
          ),
        );
      }
    }
  }

  if (dto.startingAt !== undefined && isPlannedRandom) {
    const newStart = moment(dto.startingAt);
    if (newStart.isBefore(moment())) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        formatGiveawayGuardMessage(
          existing.language,
          'startTimeCannotBeBeforeNow',
        ),
      );
    }
  }
}

// Prizes sync for update (replace-all)
async function syncUpdatePrizes(
  giveawayId: string,
  userId: number,
  newPrizes: Array<{ prizeId: number; winPlace?: number | null }>,
) {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      isActive: true,
      isCancelled: true,
      finishedAt: true,
      participiationType: true,
      language: true,
    },
  });
  if (!giveaway)
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
  if (
    giveaway.participiationType === GiveawayStartType.Lottery ||
    giveaway.participiationType === GiveawayStartType.Random
  ) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(
        giveaway.language,
        'cannotChangeGiftsViaGiveawayUpdate',
      ),
    );
  }
  if (
    giveaway.isActive ||
    giveaway.isCancelled ||
    giveaway.finishedAt !== null
  ) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Cannot update prizes on an active, cancelled, or finished giveaway',
    );
  }

  // Unlink all currently linked prizes (preserve Cooldown if transfer date still in future)
  const linkedPrizes = await prisma.giveawayPrize.findMany({
    where: { giveawayId, status: GiveawayPrizeStatus.Linked },
    select: { id: true, nextTransferDate: true },
  });
  for (const prize of linkedPrizes) {
    const restored = resolvePrizeStatusFromTransferDate(prize.nextTransferDate);
    await prisma.giveawayPrize.update({
      where: { id: prize.id },
      data: {
        giveawayId: null,
        status: restored.status,
        nextTransferDate: restored.nextTransferDate,
        winPlace: null,
      },
    });
  }

  if (newPrizes.length > 0) {
    const prizeIds = newPrizes.map((p) => p.prizeId);
    const valid = await prisma.giveawayPrize.findMany({
      where: {
        id: { in: prizeIds },
        depositedByUserId: userId,
        status: { in: [...LINKABLE_PRIZE_STATUSES] },
        commissionPaid: true,
      },
      select: { id: true },
    });

    if (valid.length !== prizeIds.length) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'One or more prizes are not available or not paid. Purchase them first via POST /api/prizes/pay.',
      );
    }

    for (const entry of newPrizes) {
      await prisma.giveawayPrize.update({
        where: { id: entry.prizeId },
        data: {
          giveawayId,
          status: GiveawayPrizeStatus.Linked,
          winPlace: entry.winPlace ?? null,
        },
      });
    }
  }

  await syncWinnerCountToPrizes(giveawayId);
}

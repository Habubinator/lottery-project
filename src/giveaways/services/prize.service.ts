import {
  prisma,
  Currencies,
  TransactionStatus,
  TransactionType,
  GiveawayPrizeStatus,
  GiveawayPrizeType,
  GiveawayStartType,
} from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import {
  getBusinessGifts,
  transferGiftToUser,
  sendGiftToUser,
  getBusinessUsername,
  sendMessage,
  createStarsPaymentLink,
  downloadGiftStickerTgs,
  downloadUniqueGiftStickerTgs,
  downloadUniqueGiftStickerPaths,
  isUniqueGift,
} from '@bot/service/bot.service';
import type { PaymentBody } from '@wallet/types';
import type { TelegramUniqueGift } from '@bot/service/bot.service';
import { sendGiftTransferredNotification } from '@bot/service/notification.service';
import {
  formatUtcDateForLanguage,
  formatGiveawayGuardMessage,
  GIFT_PRIZE_MESSAGES,
  Language,
} from '@bot/service/localization';
import { exchangeRateService } from '@admin/services/exchange-rate.service';
import { paymentCommissionSettingsService } from '@admin/services/payment-commission-settings.service';
import { telegramGiftService } from '@telegram-gifts';
import {
  findSubstituteGift,
  getCatalogGiftLabel,
  isCatalogGiftAvailable,
} from './gift-substitute.service';
import {
  GIVEAWAY_LINKED_PRIZES_INCLUDE,
  GIVEAWAY_PRIZE_ORDER_BY,
} from './prize-include';
import {
  ensureStickerGifAssets,
  publicStickerPathToLocal,
} from '../../userbot/sticker-gif';

export {
  GIVEAWAY_LINKED_PRIZES_INCLUDE,
  GIVEAWAY_LINKED_PRIZE_STATUSES,
  GIVEAWAY_OWNER_RELATIONS_INCLUDE,
  GIVEAWAY_PRIZE_ORDER_BY,
} from './prize-include';

type PrismaTransaction = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

function roundStarsAmount(value: number): number {
  return Math.ceil(value);
}

function roundTonAmount(value: number): number {
  return Number(value.toFixed(2));
}

async function convertStarsToTonRounded(stars: number): Promise<number> {
  const ton = await exchangeRateService.convertStarsToTon(stars);
  return roundTonAmount(ton);
}

async function convertStarsToTon(stars: number): Promise<number> {
  return exchangeRateService.convertStarsToTon(stars);
}

async function getPaymentCommissionSettings() {
  return paymentCommissionSettingsService.getSettings();
}

async function getNftWithdrawalStarsFeePerPrize(): Promise<number> {
  const settings = await getPaymentCommissionSettings();
  return settings.nftWithdrawalBaseStars;
}

async function getNftWithdrawalTonFeePerPrize(): Promise<number> {
  const starsFee = await getNftWithdrawalStarsFeePerPrize();
  return convertStarsToTonRounded(starsFee);
}

type BusinessGift = Awaited<ReturnType<typeof getBusinessGifts>>[number];
type DepositSyncUser = {
  id: number;
  telegramId: string | bigint | null;
};

function isLikelyMtprotoDocumentId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\d+$/.test(value);
}

/** Telegram owned_gift_id is a long token, not a short numeric row id. */
function isPlausibleOwnedGiftId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length >= 16;
}

type StandardGiftStickerAssets = {
  modelStickerFileId: string | null;
  modelStickerPath: string | null;
  modelStickerGifPath: string | null;
  modelStickerGifPosterPath: string | null;
};

async function resolveStandardGiftStickerAssets(
  telegramGiftId: string,
  catalogGift?: { sticker?: { file_id: string } } | null,
): Promise<StandardGiftStickerAssets> {
  const modelStickerFileId = catalogGift?.sticker?.file_id ?? null;
  const modelStickerPath =
    (await telegramGiftService
      .resolveCatalogGiftImageUrl(telegramGiftId)
      .catch(() => undefined)) ?? null;

  let modelStickerGifPath: string | null = null;
  let modelStickerGifPosterPath: string | null = null;
  if (modelStickerPath) {
    const assets = await ensureStickerGifAssets(
      publicStickerPathToLocal(modelStickerPath),
    );
    modelStickerGifPath = assets.gifPath;
    modelStickerGifPosterPath = assets.posterPath;
  }

  return {
    modelStickerFileId,
    modelStickerPath,
    modelStickerGifPath,
    modelStickerGifPosterPath,
  };
}

async function applyStandardGiftStickerAssetsToPrizes(
  prizes: { id: number; telegramGiftId: string | null }[],
  catalogGifts: { id: string; sticker?: { file_id: string } }[],
): Promise<void> {
  const assetsByGiftId = new Map<string, StandardGiftStickerAssets>();

  for (const prize of prizes) {
    if (!prize.telegramGiftId) continue;

    let assets = assetsByGiftId.get(prize.telegramGiftId);
    if (!assets) {
      const catalogGift = catalogGifts.find(
        (gift) => gift.id === prize.telegramGiftId,
      );
      assets = await resolveStandardGiftStickerAssets(
        prize.telegramGiftId,
        catalogGift,
      );
      assetsByGiftId.set(prize.telegramGiftId, assets);
    }

    if (
      !assets.modelStickerPath &&
      !assets.modelStickerGifPath &&
      !assets.modelStickerGifPosterPath &&
      !assets.modelStickerFileId
    ) {
      continue;
    }

    await prisma.giveawayPrize.update({
      where: { id: prize.id },
      data: {
        ...(assets.modelStickerFileId
          ? { modelStickerFileId: assets.modelStickerFileId }
          : {}),
        ...(assets.modelStickerPath
          ? { modelStickerPath: assets.modelStickerPath }
          : {}),
        ...(assets.modelStickerGifPath
          ? { modelStickerGifPath: assets.modelStickerGifPath }
          : {}),
        ...(assets.modelStickerGifPosterPath
          ? { modelStickerGifPosterPath: assets.modelStickerGifPosterPath }
          : {}),
      },
    });
  }
}

async function buildStickerGifPaths(
  modelStickerPath: string | null,
  symbolStickerPath: string | null,
  symbolTgsSourcePath?: string | null,
): Promise<{
  modelStickerGifPath: string | null;
  symbolStickerGifPath: string | null;
  modelStickerGifPosterPath: string | null;
  symbolStickerGifPosterPath: string | null;
}> {
  let modelStickerGifPath: string | null = null;
  let symbolStickerGifPath: string | null = null;
  let modelStickerGifPosterPath: string | null = null;
  let symbolStickerGifPosterPath: string | null = null;

  if (modelStickerPath) {
    const assets = await ensureStickerGifAssets(
      publicStickerPathToLocal(modelStickerPath),
    );
    modelStickerGifPath = assets.gifPath;
    modelStickerGifPosterPath = assets.posterPath;
  }

  const symbolAnimSource =
    symbolTgsSourcePath ??
    (symbolStickerPath?.toLowerCase().endsWith('.tgs') ? symbolStickerPath : null);
  if (symbolAnimSource) {
    const assets = await ensureStickerGifAssets(
      publicStickerPathToLocal(symbolAnimSource),
    );
    symbolStickerGifPath = assets.gifPath;
    symbolStickerGifPosterPath = assets.posterPath;
  }

  return {
    modelStickerGifPath,
    symbolStickerGifPath,
    modelStickerGifPosterPath,
    symbolStickerGifPosterPath,
  };
}

function extractDocumentIdFromStickerPath(
  stickerPath: string | null | undefined,
): string | null {
  if (typeof stickerPath !== 'string' || !stickerPath) return null;
  const fileName = stickerPath.split('/').pop();
  if (!fileName) return null;
  const dotIdx = fileName.lastIndexOf('.');
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  return /^\d+$/.test(base) ? base : null;
}

export type LinkablePrizeStatus = 'Available' | 'Cooldown';

export const LINKABLE_PRIZE_STATUSES = [
  GiveawayPrizeStatus.Available,
  GiveawayPrizeStatus.Cooldown,
] as const satisfies readonly LinkablePrizeStatus[];

function isLinkablePrizeStatus(status: GiveawayPrizeStatus): boolean {
  return (LINKABLE_PRIZE_STATUSES as readonly GiveawayPrizeStatus[]).includes(
    status,
  );
}

export function resolvePrizeStatusFromTransferDate(
  nextTransferDate: Date | null | undefined,
): {
  status: LinkablePrizeStatus;
  nextTransferDate: Date | null;
} {
  if (nextTransferDate && nextTransferDate.getTime() > Date.now()) {
    return { status: GiveawayPrizeStatus.Cooldown, nextTransferDate };
  }
  return { status: GiveawayPrizeStatus.Available, nextTransferDate: null };
}

function resolvePrizeStatusFromUnixCooldown(
  nextTransferUnix: number | undefined,
): {
  status: LinkablePrizeStatus;
  nextTransferDate: Date | null;
} {
  if (
    nextTransferUnix != null &&
    nextTransferUnix > Math.floor(Date.now() / 1000)
  ) {
    return {
      status: GiveawayPrizeStatus.Cooldown,
      nextTransferDate: new Date(nextTransferUnix * 1000),
    };
  }
  return { status: GiveawayPrizeStatus.Available, nextTransferDate: null };
}

async function syncDepositedGiftsForUser(
  user: DepositSyncUser,
  depositorTelegramId: string,
  userGifts: BusinessGift[],
  totalFetchedCount: number,
) {
  // Known ownedGiftIds must be global — otherwise the same Unique gift can be
  // re-imported under another depositor while still Cooldown/Available for the owner.
  const giftIds = userGifts.map((g) => g.owned_gift_id);
  const existing = giftIds.length
    ? await prisma.giveawayPrize.findMany({
        where: {
          ownedGiftId: { in: giftIds },
          status: {
            notIn: [
              GiveawayPrizeStatus.Transferred,
              GiveawayPrizeStatus.Failed,
            ],
          },
        },
        select: { ownedGiftId: true },
      })
    : [];
  const knownIds = new Set(
    existing.map((p) => p.ownedGiftId).filter((id): id is string => !!id),
  );

  const newGifts = userGifts.filter((g) => !knownIds.has(g.owned_gift_id));
  const historicalPrizes = newGifts.length
    ? await prisma.giveawayPrize.findMany({
        where: {
          depositedByUserId: user.id,
          ownedGiftId: { in: newGifts.map((gift) => gift.owned_gift_id) },
        },
        select: {
          id: true,
          ownedGiftId: true,
          status: true,
          commissionPaid: true,
          commissionTransactionId: true,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      })
    : [];
  const historicalPrizeByOwnedGiftId = new Map<
    string,
    {
      id: number;
      status: GiveawayPrizeStatus;
      commissionPaid: boolean;
      commissionTransactionId: string | null;
    }
  >();
  for (const prize of historicalPrizes) {
    if (
      !prize.ownedGiftId ||
      historicalPrizeByOwnedGiftId.has(prize.ownedGiftId)
    ) {
      continue;
    }
    historicalPrizeByOwnedGiftId.set(prize.ownedGiftId, {
      id: prize.id,
      status: prize.status,
      commissionPaid: prize.commissionPaid,
      commissionTransactionId: prize.commissionTransactionId,
    });
  }
  console.log(
    `[Gifts] syncDepositedGifts summary userId=${user.id} telegramId=${depositorTelegramId} fetched=${totalFetchedCount} matched=${userGifts.length} known=${knownIds.size} new=${newGifts.length}`,
  );

  if (!newGifts.length) {
    console.log(
      `[Gifts] syncDepositedGifts no new gifts to create for userId=${user.id} telegramId=${depositorTelegramId}`,
    );
  }

  for (const gift of newGifts) {
    const historicalPrize = historicalPrizeByOwnedGiftId.get(
      gift.owned_gift_id,
    );
    let giftName: string | null = null;
    let giftNumber: string | null = null;
    let giftNftName: string | null = null;
    let giftBaseName: string | null = null;
    let modelName: string | null = null;
    let symbolName: string | null = null;
    let backdropName: string | null = null;
    let modelRarityPermille: number | null = null;
    let symbolRarityPermille: number | null = null;
    let backdropRarityPermille: number | null = null;
    let backdropCenterColor: number | null = null;
    let backdropEdgeColor: number | null = null;
    let backdropPatternColor: number | null = null;
    let backdropTextColor: number | null = null;
    let modelStickerFileId: string | null = null;
    let symbolStickerFileId: string | null = null;
    let modelStickerPath: string | null = null;
    let symbolStickerPath: string | null = null;
    let modelStickerGifPath: string | null = null;
    let symbolStickerGifPath: string | null = null;
    let modelStickerGifPosterPath: string | null = null;
    let symbolStickerGifPosterPath: string | null = null;
    let prizeType: GiveawayPrizeType = GiveawayPrizeType.StandardGift;

    if (isUniqueGift(gift.gift)) {
      const ug = gift.gift;
      prizeType = GiveawayPrizeType.UniqueGift;
      giftName = ug.base_name;
      giftNumber = String(ug.number);
      giftNftName = ug.name;
      giftBaseName = ug.base_name;
      modelName = ug.model.name;
      symbolName = ug.symbol.name;
      backdropName = ug.backdrop.name;
      modelRarityPermille = ug.model.rarity_per_mille ?? null;
      symbolRarityPermille = ug.symbol.rarity_per_mille ?? null;
      backdropRarityPermille = ug.backdrop.rarity_per_mille ?? null;
      backdropCenterColor = ug.backdrop.center_color ?? null;
      backdropEdgeColor = ug.backdrop.edge_color ?? null;
      backdropPatternColor = ug.backdrop.pattern_color ?? null;
      backdropTextColor = ug.backdrop.text_color ?? null;
      modelStickerFileId = ug.model.sticker.file_id;
      symbolStickerFileId = ug.symbol.sticker.file_id;

      // Unique gift stickers come from MTProto saved-gift documents, so fetch them via GramJS.
      const [modelBundle, symbolThumbPath, symbolSourceBundle] =
        await Promise.all([
          downloadUniqueGiftStickerPaths(
            gift.owned_gift_id,
            ug.model.sticker.file_id,
            { buildStickerGif: true },
          ),
          downloadUniqueGiftStickerTgs(
            gift.owned_gift_id,
            ug.symbol.sticker.file_id,
            { outputFormat: 'webp' },
          ),
          downloadUniqueGiftStickerPaths(
            gift.owned_gift_id,
            ug.symbol.sticker.file_id,
            { buildStickerGif: true },
          ),
        ]);
      modelStickerPath = modelBundle.stickerPath;
      symbolStickerPath = symbolThumbPath;
      modelStickerGifPath = modelBundle.gifPath;
      modelStickerGifPosterPath = modelBundle.gifPosterPath;
      symbolStickerGifPath = symbolSourceBundle.gifPath;
      symbolStickerGifPosterPath = symbolSourceBundle.gifPosterPath;
      if (
        !modelStickerGifPath ||
        !symbolStickerGifPath ||
        !modelStickerGifPosterPath ||
        !symbolStickerGifPosterPath
      ) {
        const fallback = await buildStickerGifPaths(
          modelStickerPath,
          symbolStickerPath,
          symbolSourceBundle.stickerPath,
        );
        modelStickerGifPath ??= fallback.modelStickerGifPath;
        symbolStickerGifPath ??= fallback.symbolStickerGifPath;
        modelStickerGifPosterPath ??= fallback.modelStickerGifPosterPath;
        symbolStickerGifPosterPath ??= fallback.symbolStickerGifPosterPath;
      }
    } else {
      // Regular (standard) gift — use the gift sticker if available.
      const rg = gift.gift as {
        id?: string;
        sticker?: { file_id: string };
        name?: string;
      };
      giftName = rg.name ?? rg.id ?? null;
      if (rg.sticker?.file_id) {
        modelStickerFileId = rg.sticker.file_id;
        modelStickerPath = await downloadGiftStickerTgs(
          rg.sticker.file_id,
          `regular_${gift.owned_gift_id}`,
        );
        if (modelStickerPath) {
          const assets = await ensureStickerGifAssets(
            publicStickerPathToLocal(modelStickerPath),
          );
          modelStickerGifPath = assets.gifPath;
          modelStickerGifPosterPath = assets.posterPath;
        }
      }
    }

    const depositStatus = resolvePrizeStatusFromUnixCooldown(
      gift.next_transfer_date,
    );

    const syncPrizeData = {
      prizeType,
      ownedGiftId: gift.owned_gift_id,
      giftName,
      giftNumber,
      giftNftName,
      giftBaseName,
      modelName,
      symbolName,
      backdropName,
      modelRarityPermille,
      symbolRarityPermille,
      backdropRarityPermille,
      backdropCenterColor,
      backdropEdgeColor,
      backdropPatternColor,
      backdropTextColor,
      modelStickerFileId,
      symbolStickerFileId,
      modelStickerPath,
      symbolStickerPath,
      modelStickerGifPath,
      symbolStickerGifPath,
      modelStickerGifPosterPath,
      symbolStickerGifPosterPath,
      commissionPaid: historicalPrize?.commissionPaid ?? false,
      commissionTransactionId: historicalPrize?.commissionTransactionId ?? null,
      depositedByUserId: user.id,
      status: depositStatus.status,
      nextTransferDate: depositStatus.nextTransferDate,
    };

    const reactivatedFailedPrizeId =
      historicalPrize?.status === GiveawayPrizeStatus.Failed
        ? historicalPrize.id
        : null;
    if (reactivatedFailedPrizeId != null) {
      await prisma.giveawayPrize.update({
        where: { id: reactivatedFailedPrizeId },
        data: {
          ...syncPrizeData,
          winnerUserId: null,
          transferredAt: null,
        },
      });
    } else {
      await prisma.giveawayPrize.create({
        data: syncPrizeData,
      });
    }

    if (historicalPrize?.commissionPaid) {
      console.log(
        `[Gifts] Restored paid commission for re-imported gift userId=${user.id} ownedGiftId=${gift.owned_gift_id}`,
      );
    }

    console.log(
      reactivatedFailedPrizeId != null
        ? `[Gifts] Reactivated failed prize ${reactivatedFailedPrizeId} for user ${user.id}: ${gift.owned_gift_id} (${giftName ?? 'unknown'} #${giftNumber ?? '?'})`
        : `[Gifts] Created prize for user ${user.id}: ${gift.owned_gift_id} (${giftName ?? 'unknown'} #${giftNumber ?? '?'})`,
    );
  }
}

// Deposit

/**
 * Called from business_message or the userbot Unique listener when a new gift arrives.
 * Diffs getBusinessAccountGifts against known ownedGiftIds and
 * creates GiveawayPrize records for new ones.
 */
export async function syncDepositedGifts(
  depositorTelegramId?: string,
  connectionId?: string,
) {
  console.log(
    `[Gifts] syncDepositedGifts start depositor=${depositorTelegramId ?? 'all'} source=${connectionId ? 'business' : 'userbot'} connectionId=${connectionId ?? 'n/a'}`,
  );

  const businessGifts = await getBusinessGifts(connectionId);
  if (!businessGifts.length) {
    console.warn(
      `[Gifts] syncDepositedGifts fetched 0 gifts for depositor=${depositorTelegramId ?? 'all'}`,
    );
    return;
  }

  const missingSenderUserCount = businessGifts.filter(
    (g) => !g.sender_user?.id,
  ).length;
  const senderSamples = businessGifts
    .slice(0, 5)
    .map((g) => g.sender_user?.id?.toString() ?? 'missing')
    .join(', ');

  if (missingSenderUserCount > 0) {
    console.warn(
      `[Gifts] syncDepositedGifts found ${missingSenderUserCount}/${businessGifts.length} gifts without sender_user mapping for depositor=${depositorTelegramId ?? 'all'}; sampleSenders=[${senderSamples}]`,
    );
  }

  if (depositorTelegramId) {
    const user = await prisma.user.findFirst({
      where: { telegramId: depositorTelegramId },
      select: { id: true, telegramId: true },
    });

    if (!user) {
      console.warn(
        `[Gifts] syncDepositedGifts skipped: no local user for telegramId=${depositorTelegramId}`,
      );
      return;
    }

    // Only gifts sent by this user.
    const userGifts = businessGifts.filter(
      (g) => g.sender_user?.id?.toString() === depositorTelegramId,
    );

    if (!userGifts.length) {
      console.warn(
        `[Gifts] syncDepositedGifts matched 0/${businessGifts.length} gifts to depositor telegramId=${depositorTelegramId} userId=${user.id}; sampleSenders=[${senderSamples}]`,
      );
    }

    await syncDepositedGiftsForUser(
      user,
      depositorTelegramId,
      userGifts,
      businessGifts.length,
    );
    return;
  }

  const senderTelegramIds = [
    ...new Set(
      businessGifts
        .map((gift) => gift.sender_user?.id?.toString())
        .filter((senderId): senderId is string => Boolean(senderId)),
    ),
  ];

  if (!senderTelegramIds.length) {
    console.warn(
      `[Gifts] syncDepositedGifts full-scan found no sender_user ids in ${businessGifts.length} gifts; sampleSenders=[${senderSamples}]`,
    );
    return;
  }

  const users = await prisma.user.findMany({
    where: {
      telegramId: { in: senderTelegramIds },
    },
    select: { id: true, telegramId: true },
  });

  const usersByTelegramId = new Map(
    users
      .filter((user) => user.telegramId != null)
      .map((user) => [user.telegramId!.toString(), user] as const),
  );

  const unmatchedSenders = senderTelegramIds.filter(
    (senderId) => !usersByTelegramId.has(senderId),
  );
  if (unmatchedSenders.length) {
    console.warn(
      `[Gifts] syncDepositedGifts full-scan found ${unmatchedSenders.length} sender ids without local users: ${unmatchedSenders.slice(0, 10).join(', ')}`,
    );
  }

  let processedUsers = 0;
  for (const senderTelegramId of senderTelegramIds) {
    const user = usersByTelegramId.get(senderTelegramId);
    if (!user) continue;

    const userGifts = businessGifts.filter(
      (gift) => gift.sender_user?.id?.toString() === senderTelegramId,
    );
    await syncDepositedGiftsForUser(
      user,
      senderTelegramId,
      userGifts,
      businessGifts.length,
    );
    processedUsers += 1;
  }

  console.log(
    `[Gifts] syncDepositedGifts full-scan completed fetched=${businessGifts.length} senderCount=${senderTelegramIds.length} processedUsers=${processedUsers}`,
  );
}

type UniqueGiftMetadataPrize = {
  id: number;
  ownedGiftId: string | null;
  giftNftName: string | null;
  symbolStickerFileId: string | null;
  modelStickerFileId: string | null;
  modelRarityPermille: number | null;
  symbolRarityPermille: number | null;
  backdropRarityPermille: number | null;
  backdropCenterColor: number | null;
  backdropEdgeColor: number | null;
  backdropPatternColor: number | null;
  backdropTextColor: number | null;
};

function isUniquePrizeCandidate(prize: {
  giftNftName: string | null;
  symbolStickerFileId: string | null;
  modelStickerFileId: string | null;
}): boolean {
  return (
    !!prize.giftNftName ||
    !!prize.symbolStickerFileId ||
    isLikelyMtprotoDocumentId(prize.modelStickerFileId)
  );
}

function buildMissingUniqueGiftMetadataUpdate(
  prize: UniqueGiftMetadataPrize,
  ug: TelegramUniqueGift,
): Partial<
  Pick<
    UniqueGiftMetadataPrize,
    | 'modelRarityPermille'
    | 'symbolRarityPermille'
    | 'backdropRarityPermille'
    | 'backdropCenterColor'
    | 'backdropEdgeColor'
    | 'backdropPatternColor'
    | 'backdropTextColor'
  >
> | null {
  const data: Partial<
    Pick<
      UniqueGiftMetadataPrize,
      | 'modelRarityPermille'
      | 'symbolRarityPermille'
      | 'backdropRarityPermille'
      | 'backdropCenterColor'
      | 'backdropEdgeColor'
      | 'backdropPatternColor'
      | 'backdropTextColor'
    >
  > = {};

  if (prize.modelRarityPermille == null && ug.model.rarity_per_mille != null) {
    data.modelRarityPermille = ug.model.rarity_per_mille;
  }
  if (
    prize.symbolRarityPermille == null &&
    ug.symbol.rarity_per_mille != null
  ) {
    data.symbolRarityPermille = ug.symbol.rarity_per_mille;
  }
  if (
    prize.backdropRarityPermille == null &&
    ug.backdrop.rarity_per_mille != null
  ) {
    data.backdropRarityPermille = ug.backdrop.rarity_per_mille;
  }
  if (prize.backdropCenterColor == null && ug.backdrop.center_color != null) {
    data.backdropCenterColor = ug.backdrop.center_color;
  }
  if (prize.backdropEdgeColor == null && ug.backdrop.edge_color != null) {
    data.backdropEdgeColor = ug.backdrop.edge_color;
  }
  if (prize.backdropPatternColor == null && ug.backdrop.pattern_color != null) {
    data.backdropPatternColor = ug.backdrop.pattern_color;
  }
  if (prize.backdropTextColor == null && ug.backdrop.text_color != null) {
    data.backdropTextColor = ug.backdrop.text_color;
  }

  return Object.keys(data).length ? data : null;
}

async function fetchSavedUniqueGiftsForMetadataBackfill(): Promise<
  Map<string, TelegramUniqueGift>
> {
  if (process.env.GIFT_PROVIDER === 'business') {
    console.log(
      '[Gifts] Unique gift metadata backfill skipped: GIFT_PROVIDER=business is not supported yet',
    );
    return new Map();
  }

  let gifts: BusinessGift[];
  if (process.env.USERBOT_WORKER === 'true') {
    const { getSavedGiftsViaUserbot } = await import(
      '../../userbot/gift-sender.js'
    );
    gifts = await getSavedGiftsViaUserbot();
  } else {
    const { giftQueue, giftQueueEvents } = await import(
      '../../userbot/queue.js'
    );
    const job = await giftQueue.add(
      'list-gifts',
      { jobType: 'list-gifts', accountType: 'Unique' },
      { delay: 0 },
    );
    try {
      const result = await job.waitUntilFinished(giftQueueEvents, 90_000);
      gifts = result.gifts ?? [];
    } catch (error) {
      console.warn(
        '[Gifts] Unique gift metadata backfill list-gifts failed:',
        error instanceof Error ? error.message : error,
      );
      gifts = [];
    }
  }

  const byOwnedGiftId = new Map<string, TelegramUniqueGift>();
  for (const entry of gifts) {
    if (entry.type !== 'unique' || !isUniqueGift(entry.gift)) continue;
    byOwnedGiftId.set(entry.owned_gift_id, entry.gift);
  }
  return byOwnedGiftId;
}

export async function backfillMissingUniqueGiftMetadata() {
  try {
    console.log('[Gifts] Starting unique gift metadata backfill...');

    const prizes = await prisma.giveawayPrize.findMany({
      where: {
        ownedGiftId: { not: null },
        OR: [
          { modelRarityPermille: null },
          { symbolRarityPermille: null },
          { backdropRarityPermille: null },
          { backdropCenterColor: null },
          { backdropEdgeColor: null },
          { backdropPatternColor: null },
          { backdropTextColor: null },
        ],
      },
      select: {
        id: true,
        ownedGiftId: true,
        giftNftName: true,
        symbolStickerFileId: true,
        modelStickerFileId: true,
        modelRarityPermille: true,
        symbolRarityPermille: true,
        backdropRarityPermille: true,
        backdropCenterColor: true,
        backdropEdgeColor: true,
        backdropPatternColor: true,
        backdropTextColor: true,
      },
      orderBy: { id: 'asc' },
    });

    const uniquePrizes = prizes.filter(isUniquePrizeCandidate);

    if (!uniquePrizes.length) {
      console.log(
        '[Gifts] Unique gift metadata backfill skipped: nothing missing',
      );
      return;
    }

    const giftsByOwnedGiftId = await fetchSavedUniqueGiftsForMetadataBackfill();
    if (!giftsByOwnedGiftId.size) {
      console.log(
        `[Gifts] Unique gift metadata backfill skipped: no saved unique gifts fetched candidates=${uniquePrizes.length}`,
      );
      return;
    }

    let updatedPrizes = 0;
    let unresolvedPrizes = 0;

    for (const prize of uniquePrizes) {
      const ownedGiftId = prize.ownedGiftId;
      if (!ownedGiftId) continue;

      const ug = giftsByOwnedGiftId.get(ownedGiftId);
      if (!ug) {
        unresolvedPrizes += 1;
        continue;
      }

      const updateData = buildMissingUniqueGiftMetadataUpdate(prize, ug);
      if (!updateData) continue;

      await prisma.giveawayPrize.update({
        where: { id: prize.id },
        data: updateData,
      });
      updatedPrizes += 1;
    }

    console.log(
      `[Gifts] Unique gift metadata backfill complete candidates=${uniquePrizes.length} updatedPrizes=${updatedPrizes} unresolvedPrizes=${unresolvedPrizes} fetchedUniqueGifts=${giftsByOwnedGiftId.size}`,
    );
  } catch (error) {
    console.error(
      '[Gifts] Unique gift metadata backfill failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

export async function backfillMissingPrizeStickerImages() {
  try {
    await backfillMissingUniqueGiftMetadata();

    console.log('[Gifts] Starting prize sticker image backfill...');

    const prizes = await prisma.giveawayPrize.findMany({
      where: {
        OR: [
          {
            giftNftName: { not: null },
            ownedGiftId: { not: null },
            modelStickerPath: null,
          },
          {
            giftNftName: { not: null },
            ownedGiftId: { not: null },
            symbolStickerPath: null,
          },
          {
            modelStickerFileId: { not: null },
            modelStickerPath: null,
          },
          {
            symbolStickerFileId: { not: null },
            symbolStickerPath: null,
          },
          {
            symbolStickerPath: { contains: '.tgs', mode: 'insensitive' },
          },
          {
            modelStickerPath: { not: null },
            modelStickerGifPath: null,
          },
          {
            symbolStickerPath: { not: null },
            symbolStickerGifPath: null,
          },
          {
            prizeType: GiveawayPrizeType.StandardGift,
            telegramGiftId: { not: null },
            modelStickerPath: null,
          },
          {
            prizeType: GiveawayPrizeType.StandardGift,
            telegramGiftId: { not: null },
            modelStickerPath: { not: null },
            modelStickerGifPath: null,
          },
          {
            modelStickerGifPath: { not: null },
            modelStickerGifPosterPath: null,
          },
          {
            symbolStickerGifPath: { not: null },
            symbolStickerGifPosterPath: null,
          },
        ],
      },
      select: {
        id: true,
        prizeType: true,
        telegramGiftId: true,
        ownedGiftId: true,
        giftNftName: true,
        modelStickerFileId: true,
        symbolStickerFileId: true,
        modelStickerPath: true,
        symbolStickerPath: true,
        modelStickerGifPath: true,
        symbolStickerGifPath: true,
        modelStickerGifPosterPath: true,
        symbolStickerGifPosterPath: true,
      },
      orderBy: { id: 'asc' },
    });

    if (!prizes.length) {
      console.log(
        '[Gifts] Prize sticker image backfill skipped: nothing missing',
      );
      return;
    }

    let updatedPrizes = 0;
    let recoveredModelPaths = 0;
    let recoveredSymbolPaths = 0;
    let recoveredModelGif = 0;
    let recoveredSymbolGif = 0;
    let recoveredModelPoster = 0;
    let recoveredSymbolPoster = 0;
    let unresolvedPaths = 0;
    let skippedInvalidOwnedGiftId = 0;
    const needsUniqueGiftLookup = prizes.some(
      (prize) =>
        !!prize.giftNftName &&
        !!prize.ownedGiftId &&
        (!prize.modelStickerFileId || !prize.symbolStickerFileId),
    );
    const giftsByOwnedGiftId = needsUniqueGiftLookup
      ? await fetchSavedUniqueGiftsForMetadataBackfill()
      : new Map<string, TelegramUniqueGift>();

    const catalogGifts = prizes.some(
      (prize) =>
        prize.prizeType === GiveawayPrizeType.StandardGift && prize.telegramGiftId,
    )
      ? await telegramGiftService.getAll().catch(() => [])
      : [];

    for (const prize of prizes) {
      const updateData: {
        modelStickerFileId?: string;
        symbolStickerFileId?: string;
        modelStickerPath?: string;
        symbolStickerPath?: string;
        modelStickerGifPath?: string;
        symbolStickerGifPath?: string;
        modelStickerGifPosterPath?: string;
        symbolStickerGifPosterPath?: string;
      } = {};
      let symbolTgsSourcePath: string | null = null;

      if (
        prize.prizeType === GiveawayPrizeType.StandardGift &&
        prize.telegramGiftId &&
        (!prize.modelStickerPath ||
          !prize.modelStickerGifPath ||
          !prize.modelStickerGifPosterPath)
      ) {
        const catalogGift = catalogGifts.find(
          (gift) => gift.id === prize.telegramGiftId,
        );
        const assets = await resolveStandardGiftStickerAssets(
          prize.telegramGiftId,
          catalogGift,
        );
        if (!prize.modelStickerFileId && assets.modelStickerFileId) {
          updateData.modelStickerFileId = assets.modelStickerFileId;
        }
        if (!prize.modelStickerPath && assets.modelStickerPath) {
          updateData.modelStickerPath = assets.modelStickerPath;
          recoveredModelPaths += 1;
        }
        if (!prize.modelStickerGifPath && assets.modelStickerGifPath) {
          updateData.modelStickerGifPath = assets.modelStickerGifPath;
          recoveredModelGif += 1;
        }
        if (!prize.modelStickerGifPosterPath && assets.modelStickerGifPosterPath) {
          updateData.modelStickerGifPosterPath = assets.modelStickerGifPosterPath;
          recoveredModelPoster += 1;
        }
        if (
          !assets.modelStickerPath &&
          !assets.modelStickerGifPath &&
          !assets.modelStickerGifPosterPath &&
          !assets.modelStickerFileId
        ) {
          unresolvedPaths += 1;
        }
      }

      const ownedGiftId = prize.ownedGiftId ?? undefined;
      const isUniquePrize =
        !!prize.giftNftName ||
        !!prize.symbolStickerFileId ||
        isLikelyMtprotoDocumentId(prize.modelStickerFileId);
      const uniqueGift = ownedGiftId ? giftsByOwnedGiftId.get(ownedGiftId) : null;
      const modelStickerFileId =
        prize.modelStickerFileId ?? uniqueGift?.model.sticker.file_id ?? null;
      const symbolStickerFileId =
        prize.symbolStickerFileId ?? uniqueGift?.symbol.sticker.file_id ?? null;

      if (!prize.modelStickerFileId && modelStickerFileId) {
        updateData.modelStickerFileId = modelStickerFileId;
      }
      if (!prize.symbolStickerFileId && symbolStickerFileId) {
        updateData.symbolStickerFileId = symbolStickerFileId;
      }

      const ownedGiftIdOk = isPlausibleOwnedGiftId(ownedGiftId);

      if (!prize.modelStickerPath && modelStickerFileId) {
        if (isUniquePrize && !ownedGiftIdOk) {
          skippedInvalidOwnedGiftId += 1;
          console.warn(
            `[Gifts] backfill skip model download prizeId=${prize.id}: invalid ownedGiftId=${ownedGiftId}`,
          );
        } else if (isUniquePrize) {
          const bundle = await downloadUniqueGiftStickerPaths(
            prize.ownedGiftId!,
            modelStickerFileId,
            { buildStickerGif: true },
          );
          if (bundle.stickerPath) {
            updateData.modelStickerPath = bundle.stickerPath;
            recoveredModelPaths += 1;
          }
          if (bundle.gifPath) {
            updateData.modelStickerGifPath = bundle.gifPath;
            recoveredModelGif += 1;
          }
          if (bundle.gifPosterPath) {
            updateData.modelStickerGifPosterPath = bundle.gifPosterPath;
            recoveredModelPoster += 1;
          }
          if (!bundle.stickerPath && !bundle.gifPath) {
            unresolvedPaths += 1;
          }
        } else {
          const recoveredPath = await downloadGiftStickerTgs(
            modelStickerFileId,
            modelStickerFileId,
          );
          if (recoveredPath) {
            updateData.modelStickerPath = recoveredPath;
            recoveredModelPaths += 1;
          } else {
            unresolvedPaths += 1;
          }
        }
      }

      if (!prize.symbolStickerPath && symbolStickerFileId) {
        if (isUniquePrize && !ownedGiftIdOk) {
          skippedInvalidOwnedGiftId += 1;
          console.warn(
            `[Gifts] backfill skip symbol download prizeId=${prize.id}: invalid ownedGiftId=${ownedGiftId}`,
          );
        } else if (isUniquePrize) {
          const recoveredPath = await downloadUniqueGiftStickerTgs(
            prize.ownedGiftId,
            symbolStickerFileId,
            { outputFormat: 'webp' },
          );
          if (recoveredPath) {
            updateData.symbolStickerPath = recoveredPath;
            recoveredSymbolPaths += 1;
          } else {
            unresolvedPaths += 1;
          }
        } else {
          const recoveredPath = await downloadGiftStickerTgs(
            symbolStickerFileId,
            symbolStickerFileId,
          );
          if (recoveredPath) {
            updateData.symbolStickerPath = recoveredPath;
            recoveredSymbolPaths += 1;
          } else {
            unresolvedPaths += 1;
          }
        }
      }
      const hasLegacyTgsSymbolPath =
        typeof prize.symbolStickerPath === 'string' &&
        prize.symbolStickerPath.toLowerCase().endsWith('.tgs');
      const symbolStickerDocumentId =
        symbolStickerFileId ??
        extractDocumentIdFromStickerPath(prize.symbolStickerPath);
      if (
        hasLegacyTgsSymbolPath &&
        symbolStickerDocumentId &&
        !updateData.symbolStickerPath
      ) {
        const convertedPath = await downloadUniqueGiftStickerTgs(
          prize.ownedGiftId,
          symbolStickerDocumentId,
          { outputFormat: 'webp' },
        );
        if (convertedPath && convertedPath !== prize.symbolStickerPath) {
          updateData.symbolStickerPath = convertedPath;
          recoveredSymbolPaths += 1;
        } else {
          unresolvedPaths += 1;
        }
      }

      if (
        !prize.modelStickerGifPath ||
        !prize.symbolStickerGifPath ||
        !prize.modelStickerGifPosterPath ||
        !prize.symbolStickerGifPosterPath
      ) {
        if (
          (!prize.modelStickerGifPath || !prize.modelStickerGifPosterPath) &&
          !updateData.modelStickerGifPath &&
          !updateData.modelStickerGifPosterPath &&
          isUniquePrize &&
          ownedGiftIdOk &&
          modelStickerFileId
        ) {
          const bundle = await downloadUniqueGiftStickerPaths(
            prize.ownedGiftId!,
            modelStickerFileId,
            { buildStickerGif: true },
          );
          if (bundle.gifPath) {
            updateData.modelStickerGifPath = bundle.gifPath;
            recoveredModelGif += 1;
          }
          if (bundle.gifPosterPath) {
            updateData.modelStickerGifPosterPath = bundle.gifPosterPath;
            recoveredModelPoster += 1;
          }
          if (!updateData.modelStickerPath && bundle.stickerPath) {
            updateData.modelStickerPath = bundle.stickerPath;
            recoveredModelPaths += 1;
          }
        }

        if (
          (!prize.symbolStickerGifPath || !prize.symbolStickerGifPosterPath) &&
          !updateData.symbolStickerGifPath &&
          !updateData.symbolStickerGifPosterPath &&
          isUniquePrize &&
          ownedGiftIdOk &&
          symbolStickerFileId
        ) {
          const bundle = await downloadUniqueGiftStickerPaths(
            prize.ownedGiftId!,
            symbolStickerFileId,
            { buildStickerGif: true },
          );
          symbolTgsSourcePath = bundle.stickerPath;
          if (bundle.gifPath) {
            updateData.symbolStickerGifPath = bundle.gifPath;
            recoveredSymbolGif += 1;
          }
          if (bundle.gifPosterPath) {
            updateData.symbolStickerGifPosterPath = bundle.gifPosterPath;
            recoveredSymbolPoster += 1;
          }
        }

        const gifPaths = await buildStickerGifPaths(
          updateData.modelStickerPath ?? prize.modelStickerPath,
          updateData.symbolStickerPath ?? prize.symbolStickerPath,
          symbolTgsSourcePath,
        );
        if (
          !prize.modelStickerGifPath &&
          !updateData.modelStickerGifPath &&
          gifPaths.modelStickerGifPath
        ) {
          updateData.modelStickerGifPath = gifPaths.modelStickerGifPath;
          recoveredModelGif += 1;
        }
        if (
          !prize.modelStickerGifPosterPath &&
          !updateData.modelStickerGifPosterPath &&
          gifPaths.modelStickerGifPosterPath
        ) {
          updateData.modelStickerGifPosterPath = gifPaths.modelStickerGifPosterPath;
          recoveredModelPoster += 1;
        }
        if (
          !prize.symbolStickerGifPath &&
          !updateData.symbolStickerGifPath &&
          gifPaths.symbolStickerGifPath
        ) {
          updateData.symbolStickerGifPath = gifPaths.symbolStickerGifPath;
          recoveredSymbolGif += 1;
        }
        if (
          !prize.symbolStickerGifPosterPath &&
          !updateData.symbolStickerGifPosterPath &&
          gifPaths.symbolStickerGifPosterPath
        ) {
          updateData.symbolStickerGifPosterPath = gifPaths.symbolStickerGifPosterPath;
          recoveredSymbolPoster += 1;
        }
      }

      if (Object.keys(updateData).length === 0) {
        continue;
      }

      await prisma.giveawayPrize.update({
        where: { id: prize.id },
        data: updateData,
      });
      updatedPrizes += 1;
    }

    console.log(
      `[Gifts] Prize sticker image backfill complete candidates=${prizes.length} updatedPrizes=${updatedPrizes} recoveredModelPaths=${recoveredModelPaths} recoveredSymbolPaths=${recoveredSymbolPaths} recoveredModelGif=${recoveredModelGif} recoveredSymbolGif=${recoveredSymbolGif} recoveredModelPoster=${recoveredModelPoster} recoveredSymbolPoster=${recoveredSymbolPoster} unresolvedPaths=${unresolvedPaths} skippedInvalidOwnedGiftId=${skippedInvalidOwnedGiftId}`,
    );
  } catch (error) {
    console.error(
      '[Gifts] Prize sticker image backfill failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

// CRUD

/** Hide claimDeadline on withdraw UI — only meaningful for won prizes awaiting accept. */
export function mapPrizeForUserApi<
  T extends { status: GiveawayPrizeStatus; claimDeadline: Date | null },
>(prize: T): T {
  if (prize.status === GiveawayPrizeStatus.ReadyToClaim) {
    return prize;
  }
  return { ...prize, claimDeadline: null };
}

export async function fetchPrizesForApi(ids: number[]) {
  if (!ids.length) return [];
  const rows = await prisma.giveawayPrize.findMany({
    where: { id: { in: ids } },
    orderBy: GIVEAWAY_PRIZE_ORDER_BY,
  });
  return rows.map((p) => mapPrizeForUserApi(p));
}

export async function getUserPrizes(userId: number) {
  return prisma.giveawayPrize.findMany({
    where: {
      OR: [
        // Own gifts available, cooling down, or queued for send (Stage 2)
        {
          depositedByUserId: userId,
          status: {
            in: [
              GiveawayPrizeStatus.Available,
              GiveawayPrizeStatus.Processing,
              GiveawayPrizeStatus.Cooldown,
            ],
          },
        },
        // Won prizes awaiting acceptance (Stage 1 pending)
        {
          winnerUserId: userId,
          status: {
            in: [
              GiveawayPrizeStatus.ReadyToClaim,
              GiveawayPrizeStatus.Cooldown,
            ],
          },
        },
      ],
    },
    include: { giveaway: { select: { id: true, description: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Gifts linkable to a giveaway — Available or Cooldown (not Processing; poll GET /prizes/my for in-flight claims). */
export type ClaimPrerequisiteItem = {
  prizeId: number;
  prizeType: GiveawayPrizeType;
  accountType: 'Standard' | 'Unique';
  /** Userbot/business @username without @ — open chat before claim */
  contactUsername: string | null;
  /** `https://t.me/{contactUsername}` for Telegram open-chat button */
  contactUrl: string | null;
  needsChat: boolean;
  catalogAvailable?: boolean;
  giftUnavailable?: boolean;
  substituteGiftId?: string;
  substituteGiftName?: string | null;
  /** Worker/queue could not verify reachability — retry prerequisites, not "message bot" */
  recipientCheckUnavailable?: boolean;
  canEnqueue: boolean;
};

async function resolveRecipientPrerequisites(
  accountType: 'Standard' | 'Unique',
  recipientTelegramId: string,
  telegramGiftId?: string | null,
  recipientUsername?: string | null,
): Promise<
  import('../../userbot/recipient-check.js').RecipientPrerequisiteResult
> {
  const {
    checkRecipientPrerequisitesViaQueue,
    normalizeTelegramUsername,
    resolveUserbotContactUsername,
  } = await import('../../userbot/recipient-check.js');

  if (process.env.GIFT_PROVIDER === 'business') {
    const raw = await getBusinessUsername(accountType);
    return {
      needsChat: false,
      contactUsername: normalizeTelegramUsername(raw),
    };
  }

  if (process.env.USERBOT_WORKER === 'true') {
    const { checkRecipientReachable } = await import(
      '../../userbot/gift-sender.js'
    );
    const { isClientReady } = await import('../../userbot/clients.js');
    const contactUsername = await resolveUserbotContactUsername(accountType);
    if (!isClientReady(accountType)) {
      return { needsChat: true, contactUsername };
    }
    const check = await checkRecipientReachable(
      accountType,
      recipientTelegramId,
      {
        telegramGiftId,
        recipientUsername,
      },
    );
    return { needsChat: check.needsChat, contactUsername };
  }

  return checkRecipientPrerequisitesViaQueue(accountType, recipientTelegramId, {
    telegramGiftId,
    recipientUsername,
  });
}

export async function getClaimPrerequisites(
  prizeIds: number[],
  claimerUserId: number,
  recipientTelegramId: string,
  recipientUsername?: string | null,
): Promise<ClaimPrerequisiteItem[]> {
  if (!prizeIds.length) {
    throw HttpException.BadRequest(ErrorCodes.BadRequest, 'prizeIds required');
  }

  const prizes = await prisma.giveawayPrize.findMany({
    where: { id: { in: prizeIds } },
  });

  if (prizes.length !== prizeIds.length) {
    throw HttpException.BadRequest(
      ErrorCodes.NotFound,
      'One or more prizes not found',
    );
  }

  const catalog = await telegramGiftService.getAll().catch(() => []);
  const items: ClaimPrerequisiteItem[] = [];

  for (const id of prizeIds) {
    const prize = prizes.find((p) => p.id === id);
    if (!prize) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        `Prize ${id} not found`,
      );
    }
    if (prize.depositedByUserId !== claimerUserId) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        `Prize ${id} does not belong to you`,
      );
    }
    if (prize.status !== GiveawayPrizeStatus.Available) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        `Prize ${id} is not available to claim`,
      );
    }

    const accountType: 'Standard' | 'Unique' = 'Unique';

    let catalogAvailable: boolean | undefined;
    let giftUnavailable: boolean | undefined;
    let substituteGiftId: string | undefined;
    let substituteGiftName: string | null | undefined;
    let probeGiftId: string | null = null;

    if (
      prize.prizeType === GiveawayPrizeType.StandardGift &&
      prize.telegramGiftId
    ) {
      catalogAvailable = isCatalogGiftAvailable(prize.telegramGiftId, catalog);
      giftUnavailable = !catalogAvailable;
      probeGiftId = prize.telegramGiftId;
      if (giftUnavailable && prize.starCount != null) {
        const substitute = findSubstituteGift(
          prize.starCount,
          [prize.telegramGiftId],
          catalog,
        );
        if (substitute) {
          substituteGiftId = substitute.id;
          substituteGiftName = getCatalogGiftLabel(substitute);
          probeGiftId = substitute.id;
        }
      }
    }

    const { needsChat, contactUsername, recipientCheckUnavailable } =
      await resolveRecipientPrerequisites(
        accountType,
        recipientTelegramId,
        probeGiftId,
        recipientUsername,
      );
    const { buildTelegramContactUrl } = await import(
      '../../userbot/recipient-check.js'
    );
    const contactUrl = buildTelegramContactUrl(contactUsername);

    const canEnqueue =
      !recipientCheckUnavailable &&
      !needsChat &&
      (!giftUnavailable || !!substituteGiftId);

    items.push({
      prizeId: prize.id,
      prizeType: prize.prizeType,
      accountType,
      contactUsername,
      contactUrl,
      needsChat,
      catalogAvailable,
      giftUnavailable,
      substituteGiftId,
      substituteGiftName,
      recipientCheckUnavailable: recipientCheckUnavailable || undefined,
      canEnqueue,
    });
  }

  return items;
}

export async function getAvailablePrizes(userId: number) {
  return prisma.giveawayPrize.findMany({
    where: {
      depositedByUserId: userId,
      giveawayId: null,
      status: { in: [...LINKABLE_PRIZE_STATUSES] },
    },
    orderBy: [
      { status: 'asc' },
      { nextTransferDate: 'asc' },
      { createdAt: 'desc' },
    ],
  });
}

export async function getGiveawayPrizes(giveawayId: string) {
  return prisma.giveawayPrize.findMany({
    where: { giveawayId },
    orderBy: GIVEAWAY_PRIZE_ORDER_BY,
  });
}

async function findPrizeByIdOrThrow(prizeId: number) {
  const prize = await prisma.giveawayPrize.findUnique({ where: { id: prizeId } });
  if (!prize) {
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Prize not found');
  }
  return prize;
}

export async function assignPrizeToGiveaway(
  prizeId: number,
  giveawayId: string,
  userId: number,
  winPlace?: number | null,
) {
  const prize = await prisma.giveawayPrize.findUnique({
    where: { id: prizeId },
  });

  if (!prize) {
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Prize not found');
  }

  if (prize.depositedByUserId !== userId) {
    throw HttpException.Forbidden(ErrorCodes.Forbidden, 'Not your prize');
  }

  if (!isLinkablePrizeStatus(prize.status)) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      prize.status === GiveawayPrizeStatus.Linked
        ? 'Prize is already linked to a giveaway'
        : `Prize is not available to link (status: ${prize.status})`,
    );
  }

  if (!prize.commissionPaid) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Prize transfer fee is not paid. Purchase it first via POST /api/prizes/pay.',
    );
  }

  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      createdById: true,
      isActive: true,
      isCancelled: true,
      participiationType: true,
      language: true,
    },
  });

  if (!giveaway) {
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
  }

  if (giveaway.createdById !== userId) {
    throw HttpException.Forbidden(ErrorCodes.Forbidden, 'Not your giveaway');
  }

  if (giveaway.isActive || giveaway.isCancelled) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Cannot add prizes to an active or cancelled giveaway',
    );
  }

  if (
    giveaway.participiationType === GiveawayStartType.Lottery &&
    prize.prizeType === GiveawayPrizeType.StandardGift
  ) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(
        giveaway.language,
        'cannotAddStandardGiftToLottery',
      ),
    );
  }

  await prisma.giveawayPrize.update({
    where: { id: prizeId },
    data: {
      giveawayId,
      status: GiveawayPrizeStatus.Linked,
      winPlace: winPlace ?? null,
    },
  });

  await syncWinnerCountToPrizes(giveawayId);
  return findPrizeByIdOrThrow(prizeId);
}

export async function updatePrizeWinPlace(
  prizeId: number,
  giveawayId: string,
  userId: number,
  winPlace: number | null,
) {
  const prize = await prisma.giveawayPrize.findFirst({
    where: { id: prizeId, giveawayId },
    include: { giveaway: { select: { createdById: true, isActive: true } } },
  });

  if (!prize) {
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Prize not found');
  }

  if (prize.giveaway?.createdById !== userId) {
    throw HttpException.Forbidden(ErrorCodes.Forbidden, 'Not your giveaway');
  }

  if (prize.giveaway?.isActive) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Cannot update prizes on an active giveaway',
    );
  }

  await prisma.giveawayPrize.update({
    where: { id: prizeId },
    data: { winPlace },
  });
  return findPrizeByIdOrThrow(prizeId);
}

export async function unassignPrize(
  prizeId: number,
  giveawayId: string,
  userId: number,
) {
  const prize = await prisma.giveawayPrize.findFirst({
    where: { id: prizeId, giveawayId },
    include: { giveaway: { select: { createdById: true, isActive: true } } },
  });

  if (!prize) {
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Prize not found');
  }

  if (prize.giveaway?.createdById !== userId) {
    throw HttpException.Forbidden(ErrorCodes.Forbidden, 'Not your giveaway');
  }

  if (prize.giveaway?.isActive) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Cannot remove prizes from an active giveaway',
    );
  }

  const restoredStatus = resolvePrizeStatusFromTransferDate(
    prize.nextTransferDate,
  );

  await prisma.giveawayPrize.update({
    where: { id: prizeId },
    data: {
      giveawayId: null,
      status: restoredStatus.status,
      nextTransferDate: restoredStatus.nextTransferDate,
      winPlace: null,
      commissionPaid: false,
      commissionTransactionId: null,
    },
  });

  await syncWinnerCountToPrizes(giveawayId);

  // Free main-page ads for Random: turn off when last Linked gift is removed (unpaid only)
  const giveawayAds = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      participiationType: true,
      isPostingOn: true,
      advertisedAt: true,
    },
  });
  if (
    giveawayAds?.isPostingOn &&
    !giveawayAds.advertisedAt &&
    giveawayAds.participiationType !== 'Lottery'
  ) {
    const remainingLinked = await prisma.giveawayPrize.count({
      where: { giveawayId, status: GiveawayPrizeStatus.Linked },
    });
    if (remainingLinked === 0) {
      await prisma.giveaway.update({
        where: { id: giveawayId },
        data: { isPostingOn: false },
      });
    }
  }

  return findPrizeByIdOrThrow(prizeId);
}

// Winner count sync

export async function syncWinnerCountToPrizes(
  giveawayId: string,
  tx?: PrismaTransaction,
) {
  const db = tx ?? prisma;
  const count = await db.giveawayPrize.count({
    where: { giveawayId, status: GiveawayPrizeStatus.Linked },
  });

  await db.giveaway.update({
    where: { id: giveawayId },
    data: { winnerSlots: count },
  });
}

/**
 * Validates that manual winner count changes are blocked when prizes are linked.
 * Call this in update/create when winnerSlots is being explicitly set.
 */
export async function assertNoLinkedPrizesForWinnerChange(giveawayId: string) {
  const count = await prisma.giveawayPrize.count({
    where: { giveawayId, status: GiveawayPrizeStatus.Linked },
  });

  if (count > 0) {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: { language: true },
    });
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(
        giveaway?.language,
        'winnerCountFixedByLinkedGifts',
      ),
    );
  }
}

/**
 * Giveaways with linked gifts can only finish when there are enough distinct
 * participants to fill every linked prize (winner slot).
 */
export async function assertCanFinishGiveawayWithLinkedPrizes(
  participantRowCount: number,
  participantUserIds: number[],
  linkedPrizeCount: number,
  language: string | null | undefined,
  allowMultipleWinPlaces: boolean,
) {
  if (linkedPrizeCount <= 0) return;

  const eligibleCount = allowMultipleWinPlaces
    ? participantRowCount
    : new Set(participantUserIds).size;
  if (eligibleCount < linkedPrizeCount) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(
        language,
        'cannotFinishInsufficientParticipantsForGifts',
      ),
    );
  }
}

async function refundLinkedPrizeToOwner(
  prize: {
    id: number;
    prizeType: GiveawayPrizeType;
    starCount: number | null;
  },
  ownerUserId: number,
  tx: PrismaTransaction,
) {
  if (prize.prizeType === GiveawayPrizeType.StandardGift) {
    const starCount = prize.starCount ?? 0;
    if (starCount > 0) {
      const wallet = await tx.wallet.findUnique({
        where: { userId: ownerUserId },
      });
      if (wallet) {
        const balanceBefore = wallet.starsBalance;
        const updated = await tx.wallet.update({
          where: { userId: ownerUserId },
          data: { starsBalance: { increment: starCount } },
        });
        await tx.transactionHistory.create({
          data: {
            walletId: wallet.id,
            userId: ownerUserId,
            type: TransactionType.Incoming,
            status: TransactionStatus.Completed,
            currency: Currencies.Stars,
            value: starCount,
            balanceBefore,
            balanceAfter: updated.starsBalance,
            additionalInfo: `StandardGift refund on finish (unassigned) | prize_${prize.id}`,
          },
        });
      }
    }
    await tx.giveawayPrize.update({
      where: { id: prize.id },
      data: { status: GiveawayPrizeStatus.Failed },
    });
    return;
  }

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

/** Return linked prizes that were not awarded to any winner after finish. */
export async function releaseUnassignedLinkedPrizesAfterFinish(
  giveawayId: string,
  ownerUserId: number,
  tx: PrismaTransaction,
) {
  const stillLinked = await tx.giveawayPrize.findMany({
    where: { giveawayId, status: GiveawayPrizeStatus.Linked },
    select: { id: true, prizeType: true, starCount: true },
  });

  for (const prize of stillLinked) {
    await refundLinkedPrizeToOwner(prize, ownerUserId, tx);
  }
}

// Transfer fees

export async function validateGiftFeesBeforeActivation(giveawayId: string) {
  const unpaid = await prisma.giveawayPrize.count({
    where: {
      giveawayId,
      status: GiveawayPrizeStatus.Linked,
      commissionPaid: false,
    },
  });

  if (unpaid > 0) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      `${unpaid} gift(s) have unpaid transfer fees. Pay fees before activating.`,
    );
  }
}

export async function payGiftTransferFees(
  giveawayId: string,
  userId: number,
  currency: Currencies,
) {
  const unpaidPrizes = await prisma.giveawayPrize.findMany({
    where: {
      giveawayId,
      status: GiveawayPrizeStatus.Linked,
      commissionPaid: false,
    },
  });

  if (!unpaidPrizes.length) {
    const prizes = await prisma.giveawayPrize.findMany({
      where: { giveawayId, status: GiveawayPrizeStatus.Linked },
      orderBy: GIVEAWAY_PRIZE_ORDER_BY,
    });
    return { paid: 0, totalFee: 0, prizes };
  }

  const standardBaseStars = unpaidPrizes
    .filter((prize) => prize.prizeType === GiveawayPrizeType.StandardGift)
    .reduce((sum, prize) => sum + (prize.starCount ?? 0), 0);
  const settings = await getPaymentCommissionSettings();
  const uniqueUnpaidCount = unpaidPrizes.filter(
    (prize) => prize.prizeType === GiveawayPrizeType.UniqueGift,
  ).length;

  const nftStarsPerGift = await getNftWithdrawalStarsFeePerPrize();

  let totalFee = 0;
  if (currency === Currencies.Stars) {
    totalFee = roundStarsAmount(
      standardBaseStars * (1 + settings.standardGiftStarsMarkupPercent / 100) +
        uniqueUnpaidCount * nftStarsPerGift,
    );
  } else {
    const standardBaseTon =
      standardBaseStars > 0
        ? await convertStarsToTon(standardBaseStars)
        : 0;
    const standardTonTotal = roundTonAmount(
      standardBaseTon * (1 + settings.standardGiftTonMarkupPercent / 100),
    );
    const nftTonFeePerPrize =
      uniqueUnpaidCount > 0 ? await getNftWithdrawalTonFeePerPrize() : 0;
    const nftTonTotal = roundTonAmount(uniqueUnpaidCount * nftTonFeePerPrize);
    totalFee = roundTonAmount(standardTonTotal + nftTonTotal);
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Wallet not found');
  }

  const balance =
    currency === Currencies.Stars ? wallet.starsBalance : wallet.tonBalance;

  if (balance < totalFee) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Insufficient balance for gift transfer fees',
    );
  }

  const balanceField =
    currency === Currencies.Stars ? 'starsBalance' : 'tonBalance';

  await prisma.$transaction(async (tx) => {
    const updatedWallet = await tx.wallet.update({
      where: { userId },
      data: { [balanceField]: { decrement: totalFee } },
    });

    const balanceAfter =
      currency === Currencies.Stars
        ? updatedWallet.starsBalance
        : updatedWallet.tonBalance;

    const txRecord = await tx.transactionHistory.create({
      data: {
        walletId: wallet.id,
        userId,
        type: TransactionType.Outcoming,
        status: TransactionStatus.Completed,
        currency,
        value: totalFee,
        balanceBefore: balance,
        balanceAfter,
        additionalInfo: `Gift transfer fees | giveaway_${giveawayId}`,
      },
    });

    // Mark all unpaid prizes as commissionPaid, link to transaction
    for (const prize of unpaidPrizes) {
      await tx.giveawayPrize.update({
        where: { id: prize.id },
        data: {
          commissionPaid: true,
          commissionTransactionId: txRecord.id,
        },
      });
    }
  });

  const prizes = await prisma.giveawayPrize.findMany({
    where: { giveawayId, status: GiveawayPrizeStatus.Linked },
    orderBy: GIVEAWAY_PRIZE_ORDER_BY,
  });

  return { paid: unpaidPrizes.length, totalFee, prizes };
}

// Distribution

/**
 * Called inside finishGiveawayCore after winners are selected.
 * winners: array of participant UUIDs with their winPlace
 */
export async function distributePrizeGifts(
  giveawayId: string,
  winners: { uuid: string; userId: number; winPlace: number }[],
  tx: PrismaTransaction,
) {
  const prizes = await tx.giveawayPrize.findMany({
    where: { giveawayId, status: GiveawayPrizeStatus.Linked },
    orderBy: [{ winPlace: 'asc' }, { createdAt: 'asc' }],
  });

  if (!prizes.length) return;

  const giveaway = await tx.giveaway.findUnique({
    where: { id: giveawayId },
    select: { numerifyPrizes: true, numerifyWinners: true },
  });

  const sortedWinners = [...winners].sort((a, b) => a.winPlace - b.winPlace);
  if (!sortedWinners.length) return;

  const resolveWinnerForPrizePlace = (
    prizeWinPlace: number,
  ): (typeof sortedWinners)[0] | undefined => {
    if (giveaway?.numerifyWinners) {
      return sortedWinners.find((w) => w.winPlace === prizeWinPlace);
    }
    // numerifyWinners off: winPlace is 0 on every row; prize place N → Nth selected winner
    return sortedWinners[prizeWinPlace - 1];
  };

  const assignPrizeToWinner = async (
    prizeId: number,
    winner: (typeof sortedWinners)[0],
  ) => {
    await tx.giveawayPrize.update({
      where: { id: prizeId },
      data: {
        status: GiveawayPrizeStatus.ReadyToClaim,
        winnerUserId: winner.userId,
        claimDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await tx.participant.update({
      where: { uuid: winner.uuid },
      data: { wonPrizeId: prizeId },
    });
  };

  if (prizes.length === 1 && sortedWinners.length === 1) {
    await assignPrizeToWinner(prizes[0].id, sortedWinners[0]);
    return;
  }

  let sequentialIndex = 0;
  for (const prize of prizes) {
    let winner: (typeof sortedWinners)[0] | undefined;

    if (giveaway?.numerifyPrizes && prize.winPlace != null) {
      winner = resolveWinnerForPrizePlace(prize.winPlace);
    } else {
      winner = sortedWinners[sequentialIndex];
      sequentialIndex += 1;
    }

    if (!winner) continue;

    await assignPrizeToWinner(prize.id, winner);
  }
}

export type WinnerReplaceBlockReason =
  | 'wait_claim_deadline'
  | 'gift_claimed'
  | 'gift_delivered'
  | 'gift_linked_to_place'
  | null;

const NON_REPLACEABLE_CLAIMED_STATUSES: GiveawayPrizeStatus[] = [
  GiveawayPrizeStatus.Available,
  GiveawayPrizeStatus.Processing,
  GiveawayPrizeStatus.Cooldown,
];

export function getWinnerReplaceEligibility(
  wonPrize?: {
    status: GiveawayPrizeStatus;
    claimDeadline: Date | null;
    winPlace?: number | null;
  } | null,
): {
  canReplace: boolean;
  reason: WinnerReplaceBlockReason;
  replaceAvailableAt: Date | null;
} {
  if (!wonPrize) {
    return { canReplace: true, reason: null, replaceAvailableAt: null };
  }

  // Gift pinned to a prize place — remove/replace disabled (Oleksandr)
  if (wonPrize.winPlace != null && wonPrize.winPlace > 0) {
    return {
      canReplace: false,
      reason: 'gift_linked_to_place',
      replaceAvailableAt: null,
    };
  }

  if (wonPrize.status === GiveawayPrizeStatus.Transferred) {
    return {
      canReplace: false,
      reason: 'gift_delivered',
      replaceAvailableAt: null,
    };
  }

  if (NON_REPLACEABLE_CLAIMED_STATUSES.includes(wonPrize.status)) {
    return { canReplace: false, reason: 'gift_claimed', replaceAvailableAt: null };
  }

  if (
    wonPrize.status === GiveawayPrizeStatus.ReadyToClaim &&
    wonPrize.claimDeadline &&
    wonPrize.claimDeadline > new Date()
  ) {
    return {
      canReplace: false,
      reason: 'wait_claim_deadline',
      replaceAvailableAt: wonPrize.claimDeadline,
    };
  }

  return { canReplace: true, reason: null, replaceAvailableAt: null };
}

// Claim

export async function getClaimCommission(prizeIds: number[]) {
  const prizes = await prisma.giveawayPrize.findMany({
    where: { id: { in: prizeIds } },
    select: { id: true, commissionPaid: true, status: true },
  });

  const inFlight = prizes.filter(
    (p) => p.status === GiveawayPrizeStatus.Processing,
  );
  if (inFlight.length > 0) {
    throw HttpException.Conflict(
      ErrorCodes.Conflict,
      'Gift delivery already in progress for one or more prizes',
    );
  }

  const unpaidCount = prizes.filter((p) => !p.commissionPaid).length;
  const starsPerGift = await getNftWithdrawalStarsFeePerPrize();
  const tonPerGift = await getNftWithdrawalTonFeePerPrize();

  const prizeRows = await fetchPrizesForApi(prizeIds);

  return {
    unpaidCount,
    starsTotal: starsPerGift * unpaidCount,
    tonTotal: roundTonAmount(tonPerGift * unpaidCount),
    commissionPerGift: {
      starsAmount: starsPerGift,
      tonAmount: tonPerGift,
    },
    prizes: prizeRows,
  };
}

// Pre-pay commission (create / link gifts)

export type PrizePaymentSource = 'wallet' | 'telegram';

export type StandardGiftPayInput = {
  telegramGiftId: string;
  count: number;
};

export type StandardGiftPaySpec = StandardGiftPayInput & {
  starCount: number;
  emoji: string | null;
};

export type PrizePaymentDisabledReason =
  | 'standard_gifts_present'
  | 'no_nft'
  | 'subscription_required';

export type PrizePaymentMethodOption = {
  currency: Currencies;
  source: PrizePaymentSource;
  enabled: boolean;
  disabledReason?: PrizePaymentDisabledReason;
};

export type PrizePaymentFeesQuote = {
  stars: { nft: number; standard: number; total: number };
  ton: { nft: number; standard: number; total: number };
  nftCount: number;
  standardGiftCount: number;
};

export async function hasActiveBotSubscription(userId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscription: { select: { subscriptionExpiringAt: true } },
    },
  });
  if (!user) return false;
  return user.subscription.some(
    (sub) =>
      sub.subscriptionExpiringAt && sub.subscriptionExpiringAt > new Date(),
  );
}

export async function validatePayableNftPrizeIds(
  userId: number,
  nftPrizeIds: number[],
) {
  if (!nftPrizeIds.length) return;

  const nftPrizes = await prisma.giveawayPrize.findMany({
    where: {
      id: { in: nftPrizeIds },
      depositedByUserId: userId,
      status: { in: [...LINKABLE_PRIZE_STATUSES] },
      commissionPaid: false,
    },
  });
  if (nftPrizes.length !== nftPrizeIds.length) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'One or more NFT prizes are not available, already paid, or do not belong to you',
    );
  }
}

async function resolveStandardGiftPaySpecs(
  standardGifts: StandardGiftPayInput[],
  catalogGifts?: Awaited<ReturnType<typeof telegramGiftService.getAll>>,
): Promise<StandardGiftPaySpec[]> {
  const catalog =
    catalogGifts ?? (await telegramGiftService.getAll().catch(() => []));
  const specs: StandardGiftPaySpec[] = [];

  for (const sg of standardGifts) {
    const catalogGift = catalog.find((g: any) => g.id === sg.telegramGiftId);
    if (!catalogGift) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        `Catalog gift not found: ${sg.telegramGiftId}`,
      );
    }
    specs.push({
      telegramGiftId: sg.telegramGiftId,
      count: Math.max(1, Math.min(sg.count, 500)),
      starCount: (catalogGift as any).star_count ?? 0,
      emoji: (catalogGift as any).sticker?.emoji ?? null,
    });
  }

  return specs;
}

export async function calculatePrizePaymentFees(
  nftCount: number,
  standardSpecs: Pick<StandardGiftPaySpec, 'starCount' | 'count'>[],
): Promise<PrizePaymentFeesQuote> {
  const standardBaseStars = standardSpecs.reduce(
    (sum, s) => sum + s.starCount * s.count,
    0,
  );
  const settings = await getPaymentCommissionSettings();
  const nftStarsPerGift = await getNftWithdrawalStarsFeePerPrize();
  const nftTonPerGift = await getNftWithdrawalTonFeePerPrize();

  const standardStars = roundStarsAmount(
    standardBaseStars * (1 + settings.standardGiftStarsMarkupPercent / 100),
  );
  const nftStars = nftCount * nftStarsPerGift;

  const standardTon =
    standardBaseStars > 0
      ? roundTonAmount(
          (await convertStarsToTon(standardBaseStars)) *
            (1 + settings.standardGiftTonMarkupPercent / 100),
        )
      : 0;
  const nftTon = roundTonAmount(nftCount * nftTonPerGift);

  return {
    stars: {
      nft: nftStars,
      standard: standardStars,
      total: roundStarsAmount(nftStars + standardStars),
    },
    ton: {
      nft: nftTon,
      standard: standardTon,
      total: roundTonAmount(nftTon + standardTon),
    },
    nftCount,
    standardGiftCount: standardSpecs.reduce((sum, s) => sum + s.count, 0),
  };
}

export function resolveAllowedPaymentMethods(params: {
  nftCount: number;
  standardGiftCount: number;
  hasActiveSubscription: boolean;
}): PrizePaymentMethodOption[] {
  const { nftCount, standardGiftCount, hasActiveSubscription } = params;
  const cartNonEmpty = nftCount > 0 || standardGiftCount > 0;

  const walletStars: PrizePaymentMethodOption = {
    currency: Currencies.Stars,
    source: 'wallet',
    enabled: cartNonEmpty,
  };
  const walletTon: PrizePaymentMethodOption = {
    currency: Currencies.TON,
    source: 'wallet',
    enabled: cartNonEmpty,
  };

  let telegramStars: PrizePaymentMethodOption = {
    currency: Currencies.Stars,
    source: 'telegram',
    enabled: false,
  };

  if (standardGiftCount > 0) {
    telegramStars = {
      ...telegramStars,
      disabledReason: 'standard_gifts_present',
    };
  } else if (nftCount === 0) {
    telegramStars = { ...telegramStars, disabledReason: 'no_nft' };
  } else if (!hasActiveSubscription) {
    telegramStars = {
      ...telegramStars,
      disabledReason: 'subscription_required',
    };
  } else {
    telegramStars = { ...telegramStars, enabled: true };
  }

  return [walletStars, walletTon, telegramStars];
}

export async function getPayCommission(
  userId: number,
  nftPrizeIds: number[],
  standardGifts: StandardGiftPayInput[],
) {
  if (!nftPrizeIds.length && !standardGifts.length) {
    throw HttpException.BadRequest(ErrorCodes.BadRequest, 'Nothing to pay for');
  }

  await validatePayableNftPrizeIds(userId, nftPrizeIds);

  const catalogGifts = await telegramGiftService.getAll().catch(() => []);
  const standardSpecs = await resolveStandardGiftPaySpecs(
    standardGifts,
    catalogGifts,
  );
  const fees = await calculatePrizePaymentFees(
    nftPrizeIds.length,
    standardSpecs,
  );
  const hasSubscription = await hasActiveBotSubscription(userId);

  const wallet = await prisma.wallet.findUnique({ where: { userId } });

  const prizes = await fetchPrizesForApi(nftPrizeIds);

  return {
    hasActiveSubscription: hasSubscription,
    wallet: {
      starsBalance: Number(wallet?.starsBalance ?? 0),
      tonBalance: Number(wallet?.tonBalance ?? 0),
    },
    fees,
    allowedMethods: resolveAllowedPaymentMethods({
      nftCount: fees.nftCount,
      standardGiftCount: fees.standardGiftCount,
      hasActiveSubscription: hasSubscription,
    }),
    prizes,
  };
}

export async function processPrizeCommissionFromInvoice(
  userId: number,
  nftPrizeIds: number[],
  telegramPaymentChargeId: string,
  paidAmount: number,
): Promise<void> {
  const existing = await prisma.transactionHistory.findFirst({
    where: {
      telegramPaymentId: telegramPaymentChargeId,
      status: TransactionStatus.Completed,
    },
  });
  if (existing) return;

  if (!nftPrizeIds.length) {
    throw HttpException.BadRequest(ErrorCodes.BadRequest, 'No prizes to pay for');
  }

  if (!(await hasActiveBotSubscription(userId))) {
    throw HttpException.Forbidden(
      ErrorCodes.Forbidden,
      'Active subscription required to pay NFT commission via Telegram Stars',
    );
  }

  await validatePayableNftPrizeIds(userId, nftPrizeIds);

  const fees = await calculatePrizePaymentFees(nftPrizeIds.length, []);
  if (paidAmount !== fees.stars.total) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Paid amount does not match expected commission',
    );
  }

  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: { userId, starsBalance: 0, holdedStarsBalance: 0, tonBalance: 0 },
    update: {},
  });

  const walletBalance = wallet.starsBalance;

  await prisma.$transaction(async (tx) => {
    // Incoming + unchanged balance: external Telegram Stars payment, not an in-app debit
    await tx.transactionHistory.create({
      data: {
        walletId: wallet.id,
        userId,
        type: TransactionType.Incoming,
        status: TransactionStatus.Completed,
        currency: Currencies.Stars,
        value: paidAmount,
        balanceBefore: walletBalance,
        balanceAfter: walletBalance,
        telegramPaymentId: telegramPaymentChargeId,
        additionalInfo: `Gift NFT commission (via Telegram Stars, in-app balance unchanged) | prizes_${nftPrizeIds.join(',')}`,
      },
    });

    await tx.giveawayPrize.updateMany({
      where: { id: { in: nftPrizeIds } },
      data: { commissionPaid: true },
    });
  });
}

export type GiftDeliveryOutcome = {
  success: boolean;
  needsChat?: boolean;
  giftUnavailable?: boolean;
  balanceTooLow?: boolean;
  substituteTelegramGiftId?: string;
  businessUsername?: string;
  nextTransferDate?: Date;
  /** Unique userbot lacks Telegram Stars for MTProto transfer fee */
  transferPaymentRequired?: boolean;
  errorCode?: string;
};

export type GiftDeliveryJobContext = {
  claimerUserId?: number;
  commissionRefundAmount?: number;
  commissionCurrency?: Currencies;
  recipientTelegramId?: string;
};

async function returnUniquePrizeToAvailable(prizeId: number) {
  await prisma.giveawayPrize.update({
    where: { id: prizeId },
    data: {
      status: GiveawayPrizeStatus.Available,
      winnerUserId: null,
      nextTransferDate: null,
      transferredAt: null,
    },
  });
}

/** Temporary pause after Unique/Standard Stars shortage — never leave Cooldown without a date. */
const BALANCE_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
/** Treat near-term cooldowns as bank-balance retries when rejecting claim. */
const BALANCE_RETRY_MESSAGE_WINDOW_MS = 6 * 60 * 1000;

function balanceRetryAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + BALANCE_RETRY_COOLDOWN_MS);
}

function isLikelyBankBalanceCooldown(nextTransferDate: Date | null): boolean {
  if (!nextTransferDate) return false;
  const remaining = nextTransferDate.getTime() - Date.now();
  return remaining > 0 && remaining <= BALANCE_RETRY_MESSAGE_WINDOW_MS;
}

async function putPrizeOnBalanceRetryCooldown(prizeId: number): Promise<Date> {
  const nextTransferDate = balanceRetryAt();
  await prisma.giveawayPrize.update({
    where: { id: prizeId },
    data: {
      status: GiveawayPrizeStatus.Cooldown,
      nextTransferDate,
    },
  });
  return nextTransferDate;
}

export async function applyGiftDeliveryResult(
  prizeId: number,
  jobContext: GiftDeliveryJobContext,
  outcome: GiftDeliveryOutcome,
): Promise<GiveawayPrizeStatus> {
  const prize = await prisma.giveawayPrize.findUnique({
    where: { id: prizeId },
  });
  if (!prize) return GiveawayPrizeStatus.Failed;
  if (prize.status !== GiveawayPrizeStatus.Processing) {
    return prize.status;
  }

  const isStandard = prize.prizeType === GiveawayPrizeType.StandardGift;
  const recipientTelegramId = jobContext.recipientTelegramId;

  if (outcome.success) {
    const transferData: {
      status: GiveawayPrizeStatus;
      transferredAt: Date;
      commissionPaid?: boolean;
      commissionTransactionId?: null;
      telegramGiftId?: string;
    } = {
      status: GiveawayPrizeStatus.Transferred,
      transferredAt: new Date(),
      commissionPaid: isStandard ? undefined : false,
      commissionTransactionId: isStandard ? undefined : null,
    };
    if (isStandard && outcome.substituteTelegramGiftId) {
      transferData.telegramGiftId = outcome.substituteTelegramGiftId;
    }
    await prisma.giveawayPrize.update({
      where: { id: prizeId },
      data: transferData,
    });

    if (!isStandard && recipientTelegramId) {
      const recipient = await prisma.user.findFirst({
        where: { telegramId: recipientTelegramId },
        select: {
          first_name: true,
          last_name: true,
          language_code: true,
          picked_language: true,
        },
      });
      sendGiftTransferredNotification(
        recipientTelegramId,
        recipient?.first_name ?? '',
        recipient?.last_name ?? null,
        prize.giftName ?? '?',
        prize.giftNumber ?? null,
        recipient?.picked_language ?? recipient?.language_code ?? null,
      ).catch(() => {});
    }
    return GiveawayPrizeStatus.Transferred;
  }

  if (outcome.balanceTooLow) {
    console.error(
      `[Gifts] prize ${prizeId} ${isStandard ? 'Standard' : 'NFT'} delivery failed: gift-bank Stars balance too low (${outcome.errorCode ?? 'BALANCE_TOO_LOW'})`,
    );
    const refundAmount = jobContext.commissionRefundAmount ?? 0;
    if (
      refundAmount > 0 &&
      jobContext.claimerUserId &&
      jobContext.commissionCurrency
    ) {
      await refundCommissionForPrize(
        jobContext.claimerUserId,
        refundAmount,
        jobContext.commissionCurrency,
        prizeId,
      );
    }
    await putPrizeOnBalanceRetryCooldown(prizeId);
    return GiveawayPrizeStatus.Cooldown;
  }

  if (isStandard) {
    if (outcome.needsChat || outcome.giftUnavailable) {
      await prisma.giveawayPrize.update({
        where: { id: prizeId },
        data: { status: GiveawayPrizeStatus.Available },
      });
      return GiveawayPrizeStatus.Available;
    }
    await prisma.giveawayPrize.update({
      where: { id: prizeId },
      data: { status: GiveawayPrizeStatus.Failed },
    });
    return GiveawayPrizeStatus.Failed;
  }

  if (outcome.nextTransferDate) {
    await prisma.giveawayPrize.update({
      where: { id: prizeId },
      data: {
        status: GiveawayPrizeStatus.Cooldown,
        nextTransferDate: outcome.nextTransferDate,
      },
    });
    return GiveawayPrizeStatus.Cooldown;
  }

  if (outcome.transferPaymentRequired) {
    console.error(
      `[Gifts] prize ${prizeId} NFT transfer failed: paid transfer flow error (${outcome.errorCode ?? 'PAYMENT_REQUIRED'})`,
    );
    const refundAmount = jobContext.commissionRefundAmount ?? 0;
    if (
      refundAmount > 0 &&
      jobContext.claimerUserId &&
      jobContext.commissionCurrency
    ) {
      await refundCommissionForPrize(
        jobContext.claimerUserId,
        refundAmount,
        jobContext.commissionCurrency,
        prizeId,
      );
    }
    await returnUniquePrizeToAvailable(prizeId);
    return GiveawayPrizeStatus.Available;
  }

  if (outcome.needsChat) {
    console.warn(
      `[Gifts] prize ${prizeId} NFT transfer needsChat code=${outcome.errorCode ?? 'unknown'}`,
    );
    await returnUniquePrizeToAvailable(prizeId);
    return GiveawayPrizeStatus.Available;
  }

  const refundAmount = jobContext.commissionRefundAmount ?? 0;
  if (
    refundAmount > 0 &&
    jobContext.claimerUserId &&
    jobContext.commissionCurrency
  ) {
    await refundCommissionForPrize(
      jobContext.claimerUserId,
      refundAmount,
      jobContext.commissionCurrency,
      prizeId,
    );
  }
  await returnUniquePrizeToAvailable(prizeId);
  return GiveawayPrizeStatus.Available;
}

export async function applyGiftDeliveryJobFailed(
  prizeId: number,
  jobContext: GiftDeliveryJobContext,
): Promise<void> {
  const prize = await prisma.giveawayPrize.findUnique({
    where: { id: prizeId },
  });
  if (!prize || prize.status !== GiveawayPrizeStatus.Processing) return;

  const refundAmount = jobContext.commissionRefundAmount ?? 0;
  if (
    refundAmount > 0 &&
    jobContext.claimerUserId &&
    jobContext.commissionCurrency
  ) {
    await refundCommissionForPrize(
      jobContext.claimerUserId,
      refundAmount,
      jobContext.commissionCurrency,
      prizeId,
    );
  }

  // System job failure (crash/timeout) ≠ bank balance shortage.
  // Standard gifts: immediate Available so the user can retry right away.
  if (prize.prizeType === GiveawayPrizeType.StandardGift) {
    await prisma.giveawayPrize.update({
      where: { id: prizeId },
      data: {
        status: GiveawayPrizeStatus.Available,
        nextTransferDate: null,
      },
    });
    return;
  }

  // Unique/NFT: short Cooldown with a real date (never sticky Cooldown without nextTransferDate).
  await putPrizeOnBalanceRetryCooldown(prizeId);
}

function staleProcessingRevertStatus(prize: {
  nextTransferDate: Date | null;
  winnerUserId: number | null;
}): GiveawayPrizeStatus {
  if (prize.nextTransferDate != null || prize.winnerUserId != null) {
    return GiveawayPrizeStatus.Cooldown;
  }
  return GiveawayPrizeStatus.Available;
}

/** Undo a claim batch after lock/commission when enqueue fails or API crashes mid-loop. */
async function rollbackClaimBatch(params: {
  prizeIds: number[];
  claimerUserId: number;
  currency: Currencies;
  feePerPrize: number;
  uniqueUnpaidIds: Set<number>;
  cancelJobs: boolean;
}): Promise<void> {
  const {
    prizeIds,
    claimerUserId,
    currency,
    feePerPrize,
    uniqueUnpaidIds,
    cancelJobs,
  } = params;

  const rows = await prisma.giveawayPrize.findMany({
    where: { id: { in: prizeIds }, depositedByUserId: claimerUserId },
    select: { id: true, status: true },
  });

  const { cancelGiftDeliveryJob, isGiftDeliveryJobActive } = await import(
    '../../userbot/gift-delivery.js'
  );

  let refundTotal = 0;

  for (const row of rows) {
    // Already delivered (worker may have finished before enqueue loop failed)
    if (row.status === GiveawayPrizeStatus.Transferred) continue;
    if (row.status !== GiveawayPrizeStatus.Processing) continue;

    if (cancelJobs) {
      const active = await isGiftDeliveryJobActive(row.id);
      if (active) continue;
      await cancelGiftDeliveryJob(row.id);
    }

    await prisma.giveawayPrize.update({
      where: { id: row.id },
      data: {
        status: GiveawayPrizeStatus.Available,
        commissionTransactionId: null,
      },
    });

    if (uniqueUnpaidIds.has(row.id) && feePerPrize > 0) {
      refundTotal += feePerPrize;
    }
  }

  if (refundTotal > 0) {
    await refundCommissionForPrize(claimerUserId, refundTotal, currency);
  }
}

const GIFT_PROCESSING_STALE_MS = parseInt(
  process.env.GIFT_PROCESSING_STALE_MS ?? '900000',
  10,
);

/**
 * Recover prizes stuck in Processing with no active queue job (crash / partial enqueue).
 */
export async function releaseStaleProcessingPrizes(): Promise<number> {
  const cutoff = new Date(Date.now() - GIFT_PROCESSING_STALE_MS);
  const stale = await prisma.giveawayPrize.findMany({
    where: {
      status: GiveawayPrizeStatus.Processing,
      updatedAt: { lt: cutoff },
    },
  });
  if (stale.length === 0) return 0;

  const { giftQueue } = await import('../../userbot/queue.js');
  let released = 0;

  for (const prize of stale) {
    const job = await giftQueue.getJob(`gift-prize-${prize.id}`);
    if (job) {
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed' || state === 'active') {
        continue;
      }
    }

    const revertStatus = staleProcessingRevertStatus(prize);
    await prisma.giveawayPrize.update({
      where: { id: prize.id },
      data: {
        status: revertStatus,
        commissionTransactionId: null,
      },
    });

    if (
      prize.commissionTransactionId &&
      prize.depositedByUserId &&
      prize.prizeType !== GiveawayPrizeType.StandardGift &&
      !prize.commissionPaid
    ) {
      const tx = await prisma.transactionHistory.findUnique({
        where: { id: prize.commissionTransactionId },
        select: { currency: true, value: true },
      });
      if (tx) {
        const nftStarsFee = await getNftWithdrawalStarsFeePerPrize();
        const perPrize =
          tx.currency === Currencies.TON
            ? await getNftWithdrawalTonFeePerPrize()
            : nftStarsFee;
        if (perPrize > 0) {
          await refundCommissionForPrize(
            prize.depositedByUserId,
            perPrize,
            tx.currency,
            prize.id,
          );
        }
      }
    }

    released++;
    console.warn(
      `[Gifts] Released stale Processing prize ${prize.id} → ${revertStatus}`,
    );
  }

  return released;
}

/**
 * Release cooldown prizes whose transfer window already passed.
 * Keeps linkage/provenance fields intact, only unlocks status and clears cooldown date.
 */
export async function releaseExpiredCooldownPrizes(): Promise<number> {
  const now = new Date();
  const released = await prisma.giveawayPrize.updateMany({
    where: {
      status: GiveawayPrizeStatus.Cooldown,
      nextTransferDate: { lte: now },
    },
    data: {
      status: GiveawayPrizeStatus.Available,
      nextTransferDate: null,
    },
  });

  if (released.count > 0) {
    console.log(
      `[Gifts] Released ${released.count} expired Cooldown prize(s) at ${now.toISOString()}`,
    );
  }

  return released.count;
}

async function enqueuePrizeGiftDelivery(
  prize: {
    id: number;
    prizeType: GiveawayPrizeType;
    telegramGiftId: string | null;
    ownedGiftId: string | null;
    starCount: number | null;
    commissionPaid: boolean;
  },
  recipientTelegramId: string,
  staggerIndex: number,
  claimerUserId: number,
  commissionRefundAmount: number,
  commissionCurrency: Currencies,
  recipientUsername?: string | null,
): Promise<void> {
  const { enqueueGiftDelivery } = await import(
    '../../userbot/gift-delivery.js'
  );

  if (prize.prizeType === GiveawayPrizeType.StandardGift) {
    if (!prize.telegramGiftId) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        `Prize ${prize.id} has no telegramGiftId`,
      );
    }
    await enqueueGiftDelivery({
      prizeId: prize.id,
      jobType: 'send',
      accountType: 'Unique',
      recipientTelegramId,
      recipientUsername,
      telegramGiftId: prize.telegramGiftId,
      starCount: prize.starCount,
      staggerIndex,
      claimerUserId,
      commissionRefundAmount: 0,
      commissionCurrency,
    });
    return;
  }

  if (!prize.ownedGiftId) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      `Prize ${prize.id} has no ownedGiftId`,
    );
  }
  await enqueueGiftDelivery({
    prizeId: prize.id,
    jobType: 'transfer',
    accountType: 'Unique',
    recipientTelegramId,
    recipientUsername,
    ownedGiftId: prize.ownedGiftId,
    staggerIndex,
    claimerUserId,
    commissionRefundAmount,
    commissionCurrency,
  });
}

async function assertClaimPrerequisitesForWithdrawal(
  prizeIds: number[],
  claimerUserId: number,
  recipientTelegramId: string,
  recipientUsername: string | null | undefined,
  lang: Language,
): Promise<void> {
  if (process.env.GIFT_PROVIDER === 'business') {
    return;
  }

  const prerequisites = await getClaimPrerequisites(
    prizeIds,
    claimerUserId,
    recipientTelegramId,
    recipientUsername,
  );

  for (const item of prerequisites) {
    if (item.recipientCheckUnavailable) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Gift delivery check is temporarily unavailable. Please try again in a moment.',
      );
    }
    if (item.needsChat) {
      const username = item.contactUsername ?? 'userbot';
      const messages = GIFT_PRIZE_MESSAGES[lang] ?? GIFT_PRIZE_MESSAGES.en;
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        messages.noConversation(username),
      );
    }
    if (!item.canEnqueue) {
      if (item.giftUnavailable && !item.substituteGiftId) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Gift is no longer available in the catalog',
        );
      }
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Cannot claim this prize right now',
      );
    }
  }
}

export async function claimPrizes(
  prizeIds: number[],
  claimerUserId: number,
  recipientTelegramId: string,
  currency: Currencies,
  recipientUsername?: string | null,
  lang: Language = 'en',
) {
  const prizes = await prisma.giveawayPrize.findMany({
    where: { id: { in: prizeIds } },
  });

  if (prizes.length !== prizeIds.length) {
    throw HttpException.BadRequest(
      ErrorCodes.NotFound,
      'One or more prizes not found',
    );
  }

  for (const prize of prizes) {
    if (prize.depositedByUserId !== claimerUserId) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        `Prize ${prize.id} does not belong to you`,
      );
    }
  }

  await assertClaimPrerequisitesForWithdrawal(
    prizeIds,
    claimerUserId,
    recipientTelegramId,
    recipientUsername,
    lang,
  );

  const uniqueUnpaidPrizes = prizes.filter(
    (p) => p.prizeType !== GiveawayPrizeType.StandardGift && !p.commissionPaid,
  );
  if (uniqueUnpaidPrizes.length > 0 && currency !== Currencies.TON) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'NFT withdrawal fee can only be paid in TON',
    );
  }
  const feePerPrize = await getNftWithdrawalTonFeePerPrize();
  const totalFee = roundTonAmount(feePerPrize * uniqueUnpaidPrizes.length);
  const uniqueUnpaidIds = new Set(uniqueUnpaidPrizes.map((p) => p.id));
  const commissionCurrency =
    uniqueUnpaidPrizes.length > 0 ? Currencies.TON : currency;

  let commissionTransactionId: string | null = null;

  if (totalFee > 0) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: claimerUserId },
    });
    if (!wallet) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Wallet not found');
    }
    const balance =
      commissionCurrency === Currencies.Stars
        ? wallet.starsBalance
        : wallet.tonBalance;
    if (balance < totalFee) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Insufficient balance to pay claim commission',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const id of prizeIds) {
      const updated = await tx.giveawayPrize.updateMany({
        where: {
          id,
          depositedByUserId: claimerUserId,
          status: GiveawayPrizeStatus.Available,
        },
        data: { status: GiveawayPrizeStatus.Processing },
      });
      if (updated.count !== 1) {
        const row = await tx.giveawayPrize.findUnique({ where: { id } });
        if (!row) {
          throw HttpException.BadRequest(
            ErrorCodes.NotFound,
            `Prize ${id} not found`,
          );
        }
        if (row.status === GiveawayPrizeStatus.Processing) {
          throw HttpException.Conflict(
            ErrorCodes.Conflict,
            'Gift delivery already in progress',
          );
        }
        if (row.status === GiveawayPrizeStatus.Cooldown) {
          const msg = isLikelyBankBalanceCooldown(row.nextTransferDate)
            ? GIFT_PRIZE_MESSAGES[lang].claimBankBalanceLow
            : row.nextTransferDate
              ? GIFT_PRIZE_MESSAGES[lang].claimCooldownUntil(
                  formatUtcDateForLanguage(row.nextTransferDate, lang),
                )
              : GIFT_PRIZE_MESSAGES[lang].claimCooldownUnknown;
          throw HttpException.BadRequest(ErrorCodes.BadRequest, msg);
        }
        if (
          row.status === GiveawayPrizeStatus.Transferred ||
          row.status === GiveawayPrizeStatus.Failed
        ) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            'Already claimed',
          );
        }
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Prize ${id} is not available`,
        );
      }
    }

    if (totalFee > 0) {
      const wallet = await tx.wallet.findUnique({
        where: { userId: claimerUserId },
      });
      if (!wallet) {
        throw HttpException.BadRequest(ErrorCodes.NotFound, 'Wallet not found');
      }
      const balanceField =
        commissionCurrency === Currencies.Stars ? 'starsBalance' : 'tonBalance';
      const balance =
        commissionCurrency === Currencies.Stars
          ? wallet.starsBalance
          : wallet.tonBalance;

      const updatedWallet = await tx.wallet.update({
        where: { userId: claimerUserId },
        data: { [balanceField]: { decrement: totalFee } },
      });
      const balanceAfter =
        commissionCurrency === Currencies.Stars
          ? updatedWallet.starsBalance
          : updatedWallet.tonBalance;
      const txRecord = await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId: claimerUserId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: commissionCurrency,
          value: totalFee,
          balanceBefore: balance,
          balanceAfter,
          additionalInfo: `NFT withdrawal commission (Stars base converted to TON) | prizes_${prizeIds.join(',')}`,
        },
      });
      commissionTransactionId = txRecord.id;

      for (const p of uniqueUnpaidPrizes) {
        await tx.giveawayPrize.update({
          where: { id: p.id },
          data: { commissionTransactionId },
        });
      }
    }
  });

  const useUserbotQueue = process.env.GIFT_PROVIDER !== 'business';
  const jobContext: GiftDeliveryJobContext = {
    claimerUserId,
    commissionCurrency,
  };

  const results: {
    prizeId: number;
    success: boolean;
    status: GiveawayPrizeStatus;
    message?: string;
  }[] = [];

  let needsChat = false;
  let businessUsername: string | null = null;
  let staggerIndex = 0;

  if (useUserbotQueue) {
    try {
      for (const prize of prizes) {
        const commissionRefundAmount = uniqueUnpaidIds.has(prize.id)
          ? feePerPrize
          : 0;
        await enqueuePrizeGiftDelivery(
          prize,
          recipientTelegramId,
          staggerIndex,
          claimerUserId,
          commissionRefundAmount,
          commissionCurrency,
          recipientUsername,
        );
        staggerIndex++;
        results.push({
          prizeId: prize.id,
          success: true,
          status: GiveawayPrizeStatus.Processing,
        });
      }
    } catch (err) {
      await rollbackClaimBatch({
        prizeIds,
        claimerUserId,
        currency: commissionCurrency,
        feePerPrize,
        uniqueUnpaidIds,
        cancelJobs: true,
      });
      throw err;
    }

    const prizeRows = await fetchPrizesForApi(prizeIds);

    return {
      results,
      prizes: prizeRows,
      queued: prizes.length,
      processing: prizes.length,
      transferred: 0,
      cooldown: 0,
      failed: 0,
      message:
        'Queued for delivery; poll GET /prizes/my for Transferred or Available',
    };
  }

  for (const prize of prizes) {
    const commissionRefundAmount = uniqueUnpaidIds.has(prize.id)
      ? feePerPrize
      : 0;

    let outcome: GiftDeliveryOutcome;
    if (prize.prizeType === GiveawayPrizeType.StandardGift) {
      const result = await sendGiftToUser(
        prize.telegramGiftId!,
        recipientTelegramId,
      );
      if (!result.success && result.needsChat) {
        if (!businessUsername) {
          businessUsername =
            result.businessUsername ?? (await getBusinessUsername('Unique'));
        }
        needsChat = true;
      }
      outcome = {
        success: result.success,
        needsChat: result.needsChat,
        giftUnavailable: result.giftUnavailable,
        balanceTooLow: result.balanceTooLow,
        businessUsername:
          result.businessUsername ?? businessUsername ?? undefined,
        errorCode: result.errorCode,
      };
    } else {
      const result = await transferGiftToUser(
        prize.ownedGiftId!,
        recipientTelegramId,
      );
      outcome = {
        success: result.success,
        nextTransferDate: result.nextTransferDate,
        balanceTooLow: result.balanceTooLow,
        transferPaymentRequired: result.paymentRequired,
        needsChat: result.needsChat,
        errorCode: result.errorCode,
      };
    }

    const status = await applyGiftDeliveryResult(
      prize.id,
      {
        ...jobContext,
        recipientTelegramId,
        commissionRefundAmount,
      },
      outcome,
    );
    results.push({
      prizeId: prize.id,
      success: status === GiveawayPrizeStatus.Transferred,
      status,
      ...(status === GiveawayPrizeStatus.Cooldown && outcome.balanceTooLow
        ? { message: GIFT_PRIZE_MESSAGES[lang].claimBankBalanceLow }
        : {}),
    });
  }

  const prizeRows = await fetchPrizesForApi(prizeIds);

  return {
    results,
    prizes: prizeRows,
    transferred: results.filter(
      (r) => r.status === GiveawayPrizeStatus.Transferred,
    ).length,
    cooldown: results.filter((r) => r.status === GiveawayPrizeStatus.Cooldown)
      .length,
    failed: results.filter((r) => r.status === GiveawayPrizeStatus.Failed)
      .length,
    ...(needsChat ? { needsChat: true, businessUsername } : {}),
  };
}

async function refundCommissionForPrize(
  userId: number,
  amount: number,
  currency: Currencies,
  _prizeId?: number,
) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet || amount <= 0) return;

  const balanceField =
    currency === Currencies.Stars ? 'starsBalance' : 'tonBalance';
  const balance =
    currency === Currencies.Stars ? wallet.starsBalance : wallet.tonBalance;

  const updatedWallet = await prisma.wallet.update({
    where: { userId },
    data: { [balanceField]: { increment: amount } },
  });

  const balanceAfter =
    currency === Currencies.Stars
      ? updatedWallet.starsBalance
      : updatedWallet.tonBalance;

  await prisma.transactionHistory.create({
    data: {
      walletId: wallet.id,
      userId,
      type: TransactionType.Incoming,
      status: TransactionStatus.Completed,
      currency,
      value: amount,
      balanceBefore: balance,
      balanceAfter,
      additionalInfo: `Gift claim commission refund`,
    },
  });
}

// Owner refund after 24h claim deadline

export async function refundPrize(prizeId: number, ownerUserId: number) {
  const prize = await prisma.giveawayPrize.findFirst({
    where: {
      id: prizeId,
      status: {
        in: [GiveawayPrizeStatus.ReadyToClaim, GiveawayPrizeStatus.Failed],
      },
    },
    include: { giveaway: { select: { createdById: true } } },
  });

  if (!prize) {
    throw HttpException.BadRequest(
      ErrorCodes.NotFound,
      'Prize not found or not in a refundable status',
    );
  }

  if (prize.giveaway?.createdById !== ownerUserId) {
    throw HttpException.Forbidden(ErrorCodes.Forbidden, 'Not your giveaway');
  }

  const claimDeadline = (prize as any).claimDeadline as Date | null;
  if (claimDeadline && claimDeadline > new Date()) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      `Winner has until ${claimDeadline.toISOString()} to claim`,
    );
  }

  if ((prize as any).prizeType === 'StandardGift') {
    const starCount = (prize as any).starCount as number | null;
    if (starCount && starCount > 0) {
      const wallet = await prisma.wallet.findUnique({
        where: { userId: ownerUserId },
      });
      if (wallet) {
        const balanceBefore = wallet.starsBalance;
        const updatedWallet = await prisma.wallet.update({
          where: { userId: ownerUserId },
          data: { starsBalance: { increment: starCount } },
        });
        await prisma.transactionHistory.create({
          data: {
            walletId: wallet.id,
            userId: ownerUserId,
            type: TransactionType.Incoming,
            status: TransactionStatus.Completed,
            currency: Currencies.Stars,
            value: starCount,
            balanceBefore,
            balanceAfter: updatedWallet.starsBalance,
            additionalInfo: `StandardGift refund | prize_${prizeId}`,
          },
        });
      }
    }
    await prisma.giveawayPrize.update({
      where: { id: prizeId },
      data: { status: GiveawayPrizeStatus.Failed },
    });
    return {
      prizeId,
      prizeType: 'StandardGift',
      refundedStars: starCount ?? 0,
    };
  } else {
    // UniqueGift: return to Available so owner can re-use it
    await prisma.giveawayPrize.update({
      where: { id: prizeId },
      data: {
        status: GiveawayPrizeStatus.Available,
        winnerUserId: null,
        claimDeadline: null,
        giveawayId: null,
        winPlace: null,
        commissionPaid: false,
        commissionTransactionId: null,
      },
    });
    return { prizeId, prizeType: 'UniqueGift', refundedStars: null };
  }
}

// No-conversation fallback

export async function sendNoConversationFallback(
  recipientTelegramId: string,
  lang = 'en',
) {
  const msgs =
    GIFT_PRIZE_MESSAGES[lang as keyof typeof GIFT_PRIZE_MESSAGES] ??
    GIFT_PRIZE_MESSAGES.en;
  const businessUsername = await getBusinessUsername();
  const message = msgs.noConversation(businessUsername ?? '');

  try {
    await sendMessage(recipientTelegramId, message);
  } catch {
    // Best-effort — recipient may not have started the bot
  }
}

// Cron retry

export async function retryCooldownPrizes() {
  const released = await releaseStaleProcessingPrizes();
  if (released > 0) {
    console.log(`[Gifts Cron] Released ${released} stale Processing prize(s)`);
  }

  const ready = await prisma.giveawayPrize.findMany({
    where: {
      status: GiveawayPrizeStatus.Cooldown,
      OR: [
        { nextTransferDate: null },
        { nextTransferDate: { lte: new Date() } },
      ],
    },
    include: { winnerUser: { select: { telegramId: true, username: true } } },
  });

  const useUserbotQueue = process.env.GIFT_PROVIDER !== 'business';
  let staggerIndex = 0;

  for (const prize of ready) {
    if (!prize.winnerUser?.telegramId) continue;
    const recipientTelegramId = prize.winnerUser.telegramId;
    const ownerUserId = prize.depositedByUserId ?? prize.winnerUserId;
    if (!ownerUserId) continue;

    const locked = await prisma.giveawayPrize.updateMany({
      where: {
        id: prize.id,
        status: GiveawayPrizeStatus.Cooldown,
      },
      data: { status: GiveawayPrizeStatus.Processing },
    });
    if (locked.count !== 1) continue;

    const jobContext: GiftDeliveryJobContext = {
      recipientTelegramId,
      claimerUserId: ownerUserId,
      commissionRefundAmount: 0,
    };

    if (useUserbotQueue) {
      try {
        await enqueuePrizeGiftDelivery(
          prize,
          recipientTelegramId,
          staggerIndex,
          ownerUserId,
          0,
          Currencies.Stars,
          prize.winnerUser.username,
        );
        staggerIndex++;
        console.log(`[Gifts Cron] Prize ${prize.id} queued for delivery`);
      } catch (err) {
        await prisma.giveawayPrize.update({
          where: { id: prize.id },
          data: { status: GiveawayPrizeStatus.Cooldown },
        });
        console.error(`[Gifts Cron] Failed to queue prize ${prize.id}:`, err);
      }
      continue;
    }

    let outcome: GiftDeliveryOutcome;
    if (prize.prizeType === GiveawayPrizeType.StandardGift) {
      if (!prize.telegramGiftId) {
        await prisma.giveawayPrize.update({
          where: { id: prize.id },
          data: { status: GiveawayPrizeStatus.Cooldown },
        });
        continue;
      }
      const result = await sendGiftToUser(
        prize.telegramGiftId,
        recipientTelegramId,
      );
      outcome = { success: result.success, needsChat: result.needsChat };
      if (!result.success) {
        await prisma.giveawayPrize.update({
          where: { id: prize.id },
          data: { status: GiveawayPrizeStatus.Cooldown },
        });
        console.warn(
          `[Gifts Cron] StandardGift prize ${prize.id} still not deliverable`,
        );
        continue;
      }
    } else {
      const result = await transferGiftToUser(
        prize.ownedGiftId!,
        recipientTelegramId,
      );
      outcome = {
        success: result.success,
        nextTransferDate: result.nextTransferDate,
      };
    }

    const status = await applyGiftDeliveryResult(prize.id, jobContext, outcome);
    if (status === GiveawayPrizeStatus.Transferred) {
      console.log(`[Gifts Cron] Prize ${prize.id} transferred successfully`);
    } else if (status === GiveawayPrizeStatus.Failed) {
      console.error(`[Gifts Cron] Prize ${prize.id} failed permanently`);
    }
  }
}

/**
 * Called from business_message handler when a user sends a message to
 * the business account — retry any Cooldown prizes waiting for them.
 */
export async function retryPrizesForUser(senderTelegramId: string) {
  const user = await prisma.user.findFirst({
    where: { telegramId: senderTelegramId },
  });
  if (!user) return;

  const cooldownPrizes = await prisma.giveawayPrize.findMany({
    where: {
      winnerUserId: user.id,
      status: GiveawayPrizeStatus.Cooldown,
    },
  });

  const useUserbotQueue = process.env.GIFT_PROVIDER !== 'business';
  let staggerIndex = 0;

  for (const prize of cooldownPrizes) {
    const ownerUserId = prize.depositedByUserId ?? user.id;

    const locked = await prisma.giveawayPrize.updateMany({
      where: { id: prize.id, status: GiveawayPrizeStatus.Cooldown },
      data: { status: GiveawayPrizeStatus.Processing },
    });
    if (locked.count !== 1) continue;

    const jobContext: GiftDeliveryJobContext = {
      recipientTelegramId: senderTelegramId,
      claimerUserId: ownerUserId,
      commissionRefundAmount: 0,
    };

    if (useUserbotQueue) {
      try {
        await enqueuePrizeGiftDelivery(
          prize,
          senderTelegramId,
          staggerIndex,
          ownerUserId,
          0,
          Currencies.Stars,
          user.username,
        );
        staggerIndex++;
        console.log(
          `[Gifts] Retried prize ${prize.id} for user ${user.id} — queued`,
        );
      } catch {
        await prisma.giveawayPrize.update({
          where: { id: prize.id },
          data: { status: GiveawayPrizeStatus.Cooldown },
        });
      }
      continue;
    }

    let outcome: GiftDeliveryOutcome;
    if (prize.prizeType === GiveawayPrizeType.StandardGift) {
      if (!prize.telegramGiftId) {
        await prisma.giveawayPrize.update({
          where: { id: prize.id },
          data: { status: GiveawayPrizeStatus.Cooldown },
        });
        continue;
      }
      const result = await sendGiftToUser(
        prize.telegramGiftId,
        senderTelegramId,
      );
      if (!result.success) {
        await prisma.giveawayPrize.update({
          where: { id: prize.id },
          data: { status: GiveawayPrizeStatus.Cooldown },
        });
        continue;
      }
      outcome = { success: true };
    } else {
      const result = await transferGiftToUser(
        prize.ownedGiftId!,
        senderTelegramId,
      );
      outcome = {
        success: result.success,
        nextTransferDate: result.nextTransferDate,
      };
    }

    const status = await applyGiftDeliveryResult(prize.id, jobContext, outcome);
    if (status === GiveawayPrizeStatus.Transferred) {
      console.log(
        `[Gifts] Retried prize ${prize.id} for user ${user.id} — transferred`,
      );
    }
  }
}

export async function getPrizeByOwnedGiftId(
  ownedGiftId: string,
  userId: number,
) {
  return prisma.giveawayPrize.findFirst({
    where: { ownedGiftId, depositedByUserId: userId },
  });
}

export async function addStandardGifts(
  giveawayId: string,
  userId: number,
  telegramGiftId: string,
  count: number,
  winPlaceStart: number | null,
) {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      createdById: true,
      isActive: true,
      isCancelled: true,
      participiationType: true,
      language: true,
    },
  });

  if (!giveaway)
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
  if (giveaway.createdById !== userId)
    throw HttpException.Forbidden(ErrorCodes.Forbidden, 'Not your giveaway');
  if (giveaway.isActive || giveaway.isCancelled) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Cannot add prizes to an active or cancelled giveaway',
    );
  }
  if (giveaway.participiationType === GiveawayStartType.Lottery) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      formatGiveawayGuardMessage(
        giveaway.language,
        'cannotAddStandardGiftToLottery',
      ),
    );
  }

  const catalogGifts = await telegramGiftService.getAll().catch(() => []);
  const catalogGift = catalogGifts.find((g: any) => g.id === telegramGiftId);
  const safeCount = Math.max(1, Math.min(count, 500));

  const created = await prisma.$transaction(
    Array.from({ length: safeCount }, (_, i) =>
      prisma.giveawayPrize.create({
        data: {
          giveawayId,
          prizeType: 'StandardGift' as any,
          telegramGiftId,
          starCount: catalogGift?.star_count ?? null,
          giftName: catalogGift?.sticker?.emoji ?? null,
          status: GiveawayPrizeStatus.Linked,
          depositedByUserId: userId,
          ownedGiftId: null,
          winPlace: winPlaceStart != null ? winPlaceStart + i : null,
        },
      }),
    ),
  );

  await syncWinnerCountToPrizes(giveawayId);
  await applyStandardGiftStickerAssetsToPrizes(created, catalogGifts);
  const ids = created.map((p) => p.id);
  return prisma.giveawayPrize.findMany({
    where: { id: { in: ids } },
    orderBy: GIVEAWAY_PRIZE_ORDER_BY,
  });
}

// Pre-payment (standalone, outside giveaway context)

export async function payForPrizes(
  userId: number,
  nftPrizeIds: number[],
  standardGifts: StandardGiftPayInput[],
  currency: Currencies,
  paymentSource: PrizePaymentSource = 'wallet',
) {
  if (!nftPrizeIds.length && !standardGifts.length) {
    throw HttpException.BadRequest(ErrorCodes.BadRequest, 'Nothing to pay for');
  }

  await validatePayableNftPrizeIds(userId, nftPrizeIds);

  const catalogGifts = await telegramGiftService.getAll().catch(() => []);
  const standardSpecs = await resolveStandardGiftPaySpecs(
    standardGifts,
    catalogGifts,
  );
  const fees = await calculatePrizePaymentFees(
    nftPrizeIds.length,
    standardSpecs,
  );

  if (paymentSource === 'telegram') {
    if (standardGifts.length > 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Telegram Stars payment is not available when standard gifts are in the cart',
      );
    }
    if (currency !== Currencies.Stars) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Telegram payment for NFT commission supports Stars only',
      );
    }
    if (!nftPrizeIds.length) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'No NFT prizes to pay commission for',
      );
    }
    if (!(await hasActiveBotSubscription(userId))) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        'Active subscription required to pay NFT commission via Telegram Stars',
      );
    }

    const amount = fees.stars.total;
    const paymentBody: PaymentBody = {
      userId,
      amount,
      currency: Currencies.Stars,
      p: 5,
      ppids: nftPrizeIds,
    };
    const paymentLink = await createStarsPaymentLink(
      'Gift NFT Commission',
      `Pay commission for ${nftPrizeIds.length} NFT gift(s)`,
      amount,
      JSON.stringify(paymentBody),
    );
    if (!paymentLink) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Failed to create Telegram payment link',
      );
    }

    const prizes = await fetchPrizesForApi(nftPrizeIds);

    return {
      paymentLink,
      amount,
      nftPrizeIds,
      totalFeeStars: amount,
      totalFeeTon: 0,
      prizes,
    };
  }

  const totalStarsFee =
    currency === Currencies.Stars ? fees.stars.total : 0;
  const totalTonFee = currency === Currencies.TON ? fees.ton.total : 0;

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet)
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Wallet not found');
  if (totalStarsFee > 0 && wallet.starsBalance < totalStarsFee) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Insufficient Stars balance',
    );
  }
  if (totalTonFee > 0 && wallet.tonBalance < totalTonFee) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Insufficient TON balance',
    );
  }

  const createdStandardPrizes: Awaited<
    ReturnType<typeof prisma.giveawayPrize.create>
  >[] = [];

  await prisma.$transaction(async (tx) => {
    if (totalStarsFee > 0) {
      await tx.wallet.update({
        where: { userId },
        data: { starsBalance: { decrement: totalStarsFee } },
      });
      await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: Currencies.Stars,
          value: totalStarsFee,
          balanceBefore: wallet.starsBalance,
          balanceAfter: wallet.starsBalance - totalStarsFee,
          additionalInfo: `Gift fees`,
        },
      });
    }
    if (totalTonFee > 0) {
      await tx.wallet.update({
        where: { userId },
        data: { tonBalance: { decrement: totalTonFee } },
      });
      await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: Currencies.TON,
          value: totalTonFee,
          balanceBefore: wallet.tonBalance,
          balanceAfter: wallet.tonBalance - totalTonFee,
          additionalInfo: `Gift NFT commission`,
        },
      });
    }

    if (nftPrizeIds.length > 0) {
      await tx.giveawayPrize.updateMany({
        where: { id: { in: nftPrizeIds } },
        data: { commissionPaid: true },
      });
    }

    for (const spec of standardSpecs) {
      for (let i = 0; i < spec.count; i++) {
        const prize = await tx.giveawayPrize.create({
          data: {
            prizeType: GiveawayPrizeType.StandardGift,
            telegramGiftId: spec.telegramGiftId,
            starCount: spec.starCount,
            giftName: spec.emoji,
            status: GiveawayPrizeStatus.Available,
            commissionPaid: true,
            depositedByUserId: userId,
            ownedGiftId: null,
            giveawayId: null,
          },
        });
        createdStandardPrizes.push(prize);
      }
    }
  });

  await applyStandardGiftStickerAssetsToPrizes(
    createdStandardPrizes,
    catalogGifts,
  );

  const allPrizeIds = [
    ...nftPrizeIds,
    ...createdStandardPrizes.map((p) => p.id),
  ];
  const prizes = await fetchPrizesForApi(allPrizeIds);

  return {
    prizes,
    totalFeeStars: totalStarsFee,
    totalFeeTon: totalTonFee,
  };
}

// Stage 1 — accept a won prize into the winner's account
export async function acceptWonPrize(prizeId: number, claimerUserId: number) {
  const prize = await prisma.giveawayPrize.findUnique({
    where: { id: prizeId },
  });
  if (!prize)
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Prize not found');
  if (prize.winnerUserId !== claimerUserId)
    throw HttpException.Forbidden(
      ErrorCodes.Forbidden,
      'Prize does not belong to you',
    );
  if (prize.status !== GiveawayPrizeStatus.ReadyToClaim)
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Prize is not ready to accept',
    );

  return prisma.giveawayPrize.update({
    where: { id: prizeId },
    data: {
      depositedByUserId: claimerUserId,
      status: GiveawayPrizeStatus.Available,
      winnerUserId: null,
      claimDeadline: null,
    },
  });
}

export async function transferPrizesToUser(
  prizeIds: number[],
  ownerUserId: number,
  recipientUserId: number,
) {
  if (ownerUserId === recipientUserId) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Recipient user must be different from the current owner',
    );
  }

  const recipient = await prisma.user.findUnique({
    where: { id: recipientUserId },
    select: { id: true },
  });
  if (!recipient) {
    throw HttpException.BadRequest(
      ErrorCodes.NotFound,
      'Recipient user not found',
    );
  }

  const prizes = await prisma.giveawayPrize.findMany({
    where: { id: { in: prizeIds } },
  });

  if (prizes.length !== prizeIds.length) {
    throw HttpException.BadRequest(
      ErrorCodes.NotFound,
      'One or more prizes not found',
    );
  }

  for (const prize of prizes) {
    if (prize.depositedByUserId !== ownerUserId) {
      throw HttpException.Forbidden(
        ErrorCodes.Forbidden,
        `Prize ${prize.id} does not belong to you`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const id of prizeIds) {
      const updated = await tx.giveawayPrize.updateMany({
        where: {
          id,
          depositedByUserId: ownerUserId,
          status: GiveawayPrizeStatus.Available,
        },
        data: {
          depositedByUserId: recipientUserId,
        },
      });

      if (updated.count !== 1) {
        const row = await tx.giveawayPrize.findUnique({ where: { id } });
        if (!row) {
          throw HttpException.BadRequest(
            ErrorCodes.NotFound,
            `Prize ${id} not found`,
          );
        }
        if (row.depositedByUserId !== ownerUserId) {
          throw HttpException.Forbidden(
            ErrorCodes.Forbidden,
            `Prize ${id} does not belong to you`,
          );
        }
        if (row.status === GiveawayPrizeStatus.Processing) {
          throw HttpException.Conflict(
            ErrorCodes.Conflict,
            'Gift delivery already in progress',
          );
        }
        if (
          row.status === GiveawayPrizeStatus.Transferred ||
          row.status === GiveawayPrizeStatus.Failed
        ) {
          throw HttpException.BadRequest(
            ErrorCodes.BadRequest,
            'Already claimed',
          );
        }
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Prize ${id} is not available`,
        );
      }
    }
  });

  return {
    results: prizeIds.map((prizeId) => ({
      prizeId,
      success: true,
      status: GiveawayPrizeStatus.Available,
    })),
    transferred: prizeIds.length,
    cooldown: 0,
    failed: 0,
  };
}

export const prizeService = {
  syncDepositedGifts,
  backfillMissingUniqueGiftMetadata,
  backfillMissingPrizeStickerImages,
  getUserPrizes,
  mapPrizeForUserApi,
  getClaimPrerequisites,
  getAvailablePrizes,
  getGiveawayPrizes,
  assignPrizeToGiveaway,
  updatePrizeWinPlace,
  unassignPrize,
  syncWinnerCountToPrizes,
  assertNoLinkedPrizesForWinnerChange,
  assertCanFinishGiveawayWithLinkedPrizes,
  releaseUnassignedLinkedPrizesAfterFinish,
  validateGiftFeesBeforeActivation,
  payGiftTransferFees,
  distributePrizeGifts,
  getClaimCommission,
  claimPrizes,
  acceptWonPrize,
  transferPrizesToUser,
  refundPrize,
  getPrizeByOwnedGiftId,
  addStandardGifts,
  sendNoConversationFallback,
  releaseExpiredCooldownPrizes,
  releaseStaleProcessingPrizes,
  retryCooldownPrizes,
  retryPrizesForUser,
  payForPrizes,
  getPayCommission,
  processPrizeCommissionFromInvoice,
  hasActiveBotSubscription,
  validatePayableNftPrizeIds,
  calculatePrizePaymentFees,
  resolveAllowedPaymentMethods,
};

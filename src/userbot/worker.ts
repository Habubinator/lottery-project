import { Worker } from 'bullmq';
import { prisma, GiveawayPrizeStatus } from '@database';
import { GIFT_QUEUE_NAME, GiftJobData, GiftJobResult } from './queue';
import { AUTH_QUEUE_NAME, AuthJobData, AuthJobResult } from './auth-queue';
import {
  sendGiftViaUserbot,
  transferGiftViaUserbot,
  getSavedGiftsViaUserbot,
  checkRecipientReachable,
  downloadUniqueGiftStickerViaUserbot,
} from './gift-sender';
import { getUserbotUsername, reconnectClient } from './clients';
import { telegramGiftService } from '@telegram-gifts';
import { findSubstituteGift } from '@giveaways/services/gift-substitute.service';
import { startAuth, confirmCode, submit2FA } from './auth';
import {
  handleGiftJobCompleted,
  handleGiftJobFailed,
} from './gift-job-handler';
import { getGiftWorkerConcurrency } from './gift-worker-config';

function isGramJsTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === 'TIMEOUT' || msg.includes('TIMEOUT');
}

async function resolvePrizeBeforeSend(
  prizeId: number,
): Promise<'send' | 'skip_done' | 'skip_not_processing'> {
  const prize = await prisma.giveawayPrize.findUnique({
    where: { id: prizeId },
    select: { status: true },
  });
  if (!prize) return 'skip_not_processing';
  if (prize.status === GiveawayPrizeStatus.Transferred) return 'skip_done';
  if (prize.status !== GiveawayPrizeStatus.Processing)
    return 'skip_not_processing';

  return 'send';
}

async function runSendGiftJob(
  telegramGiftId: string,
  recipientTelegramId: string,
  starCount: number | null | undefined,
  prizeId: number | undefined,
  recipientUsername?: string,
): Promise<GiftJobResult> {
  const logCtx = prizeId != null ? `prizeId=${prizeId} ` : '';

  const finishNeedsChat = async (): Promise<GiftJobResult> => {
    const username = await getUserbotUsername('Unique');
    return {
      success: false,
      needsChat: true,
      businessUsername: username ?? undefined,
    };
  };

  const giftId = telegramGiftId;
  let result = await sendGiftViaUserbot(
    giftId,
    recipientTelegramId,
    recipientUsername,
  );

  if (result.success) {
    return { success: true };
  }
  if (result.needsChat) {
    return finishNeedsChat();
  }

  if (result.balanceTooLow) {
    console.error(
      `[Userbot Worker] ${logCtx}balanceTooLow giftId=${telegramGiftId} code=${result.errorCode ?? 'unknown'}`,
    );
    return { success: false, balanceTooLow: true };
  }

  if (result.giftUnavailable && starCount != null) {
    const catalog = await telegramGiftService.getAll().catch(() => []);
    const substitute = findSubstituteGift(
      starCount,
      [telegramGiftId],
      catalog as any,
    );
    if (substitute) {
      console.log(
        `[Userbot Worker] ${logCtx}substitute gift ${substitute.id} for unavailable ${telegramGiftId}`,
      );
      result = await sendGiftViaUserbot(
        substitute.id,
        recipientTelegramId,
        recipientUsername,
      );
      if (result.success) {
        return { success: true, substituteTelegramGiftId: substitute.id };
      }
      if (result.needsChat) {
        return finishNeedsChat();
      }
      if (result.balanceTooLow) {
        console.error(
          `[Userbot Worker] ${logCtx}balanceTooLow after substitute giftId=${substitute.id} code=${result.errorCode ?? 'unknown'}`,
        );
        return { success: false, balanceTooLow: true };
      }
    }
    console.error(
      `[Userbot Worker] ${logCtx}giftUnavailable giftId=${telegramGiftId} code=${result.errorCode ?? 'unknown'}`,
    );
    return { success: false, giftUnavailable: true };
  }

  if (!result.success) {
    console.error(
      `[Userbot Worker] ${logCtx}send failed giftId=${giftId} code=${result.errorCode ?? 'unknown'}`,
    );
  }
  return { success: false };
}

async function runGiftJobHandler(job: {
  data: GiftJobData;
}): Promise<GiftJobResult> {
  const {
    jobType,
    recipientTelegramId,
    telegramGiftId,
    ownedGiftId,
    accountType,
    prizeId,
    starCount,
  } = job.data;

  if (jobType === 'list-gifts') {
    const gifts = await getSavedGiftsViaUserbot();
    return { success: true, gifts };
  }

  if (jobType === 'get-username') {
    const username = await getUserbotUsername(accountType);
    return { success: true, businessUsername: username ?? undefined };
  }

  if (jobType === 'download-unique-sticker') {
    const downloadedStickerPath = await downloadUniqueGiftStickerViaUserbot(
      ownedGiftId!,
      job.data.stickerDocumentId!,
      { outputFormat: job.data.stickerOutputFormat },
    );
    let downloadedStickerGifPath: string | undefined;
    let downloadedStickerGifPosterPath: string | undefined;
    if (
      downloadedStickerPath &&
      job.data.stickerOutputFormat !== 'webp' &&
      job.data.buildStickerGif
    ) {
      const {
        ensureStickerGifAssets,
        publicStickerPathToLocal,
      } = await import('./sticker-gif.js');
      const localStickerPath = publicStickerPathToLocal(downloadedStickerPath);
      const assets = await ensureStickerGifAssets(localStickerPath);
      downloadedStickerGifPath = assets.gifPath ?? undefined;
      downloadedStickerGifPosterPath = assets.posterPath ?? undefined;
    }
    return {
      success: !!downloadedStickerPath,
      downloadedStickerPath: downloadedStickerPath ?? undefined,
      downloadedStickerGifPath,
      downloadedStickerGifPosterPath,
    };
  }

  if (jobType === 'check-recipient') {
    const [check, username] = await Promise.all([
      checkRecipientReachable(accountType, recipientTelegramId!, {
        telegramGiftId: job.data.telegramGiftId,
        recipientUsername: job.data.recipientUsername,
      }),
      getUserbotUsername(accountType),
    ]);
    return {
      success: true,
      needsChat: check.needsChat,
      businessUsername: username ?? undefined,
    };
  }

  if (prizeId) {
    const gate = await resolvePrizeBeforeSend(prizeId);
    if (gate === 'skip_done') {
      console.log(`[Userbot Worker] prizeId=${prizeId} skip send — already Transferred`);
      return { success: true };
    }
    if (gate === 'skip_not_processing') {
      console.warn(
        `[Userbot Worker] prizeId=${prizeId} skip send — prize not in Processing`,
      );
      return { success: false };
    }
  }

  if (
    (jobType === 'send' || jobType === 'transfer') &&
    recipientTelegramId
  ) {
    const check = await checkRecipientReachable(accountType, recipientTelegramId, {
      telegramGiftId: jobType === 'send' ? telegramGiftId : undefined,
      recipientUsername: job.data.recipientUsername,
    });
    if (check.needsChat) {
      const username = await getUserbotUsername(accountType);
      console.warn(
        `[Userbot Worker] blocked delivery — recipient not in dialogs prizeId=${prizeId ?? 'n/a'} jobType=${jobType} account=${accountType} recipient=${recipientTelegramId} code=${check.errorCode ?? 'PEER_NOT_IN_DIALOGS'}`,
      );
      return {
        success: false,
        needsChat: true,
        businessUsername: username ?? undefined,
        errorCode: check.errorCode,
      };
    }
  }

  try {
    if (jobType === 'send') {
      return runSendGiftJob(
        telegramGiftId!,
        recipientTelegramId!,
        starCount,
        prizeId,
        job.data.recipientUsername,
      );
    }

    if (jobType === 'transfer') {
      const result = await transferGiftViaUserbot(
        ownedGiftId!,
        recipientTelegramId!,
        job.data.recipientUsername,
      );
      if (!result.success && result.nextTransferDate) {
        return {
          success: false,
          nextTransferDate: result.nextTransferDate.toISOString(),
        };
      }
      if (!result.success && result.balanceTooLow) {
        return {
          success: false,
          balanceTooLow: true,
          errorCode: result.errorCode,
        };
      }
      if (!result.success && result.paymentRequired) {
        return {
          success: false,
          transferPaymentRequired: true,
          errorCode: result.errorCode,
        };
      }
      if (!result.success && result.needsChat) {
        const username = await getUserbotUsername('Unique');
        return {
          success: false,
          needsChat: true,
          errorCode: result.errorCode,
          businessUsername: username ?? undefined,
        };
      }
      return {
        success: result.success,
        errorCode: result.errorCode,
      };
    }

    return { success: false };
  } catch (err) {
    if (isGramJsTimeout(err)) {
      console.warn(
        `[Userbot Worker] TIMEOUT on ${jobType} — reconnecting ${accountType}`,
      );
      await reconnectClient(accountType).catch((e) =>
        console.error(`[Userbot Worker] reconnect failed:`, e),
      );
    }
    throw err;
  }
}

function summarizeGiftJobResult(result: GiftJobResult): string {
  if (result.success) return 'success';
  if (result.needsChat) return 'needsChat';
  if (result.giftUnavailable) return 'giftUnavailable';
  if (result.balanceTooLow) return 'balanceTooLow';
  if (result.transferPaymentRequired) return 'paymentRequired';
  if (result.nextTransferDate) return 'cooldown';
  return result.errorCode ? `failed:${result.errorCode}` : 'failed';
}

export function startGiftWorker(): Worker<GiftJobData, GiftJobResult> {
  const worker = new Worker<GiftJobData, GiftJobResult>(
    GIFT_QUEUE_NAME,
    async (job) => {
      const { jobType, prizeId, recipientTelegramId, accountType, ownedGiftId, stickerDocumentId } =
        job.data;
      if (
        jobType === 'send' ||
        jobType === 'transfer' ||
        jobType === 'download-unique-sticker'
      ) {
        console.log(
          `[Userbot Worker] Job ${job.id} (${jobType}) start prizeId=${prizeId ?? 'n/a'} account=${accountType} recipient=${recipientTelegramId ?? 'n/a'} ownedGiftId=${ownedGiftId ?? 'n/a'} stickerDocumentId=${stickerDocumentId ?? 'n/a'}`,
        );
      }

      const result = await runGiftJobHandler(job);
      if (job.data.prizeId) {
        try {
          await handleGiftJobCompleted(job.data, result);
        } catch (dbErr) {
          if (result.success) {
            console.error(
              `[Userbot Worker] DB update failed after successful gift send for prize ${job.data.prizeId} — not retrying to avoid duplicate send`,

              dbErr,
            );

            return result;
          }

          throw dbErr;
        }
      }
      return result;
    },
    {
      connection: { url: process.env.REDIS_URL },
      concurrency: getGiftWorkerConcurrency(),
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );

  console.log(`[Userbot Worker] gift queue concurrency=${getGiftWorkerConcurrency()}`);

  worker.on('failed', async (job, err) => {
    console.error(
      `[Userbot Worker] Job ${job?.id} (${job?.data.jobType}) failed:`,
      err.message,
    );
    if (!job?.data.prizeId) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;
    await handleGiftJobFailed(job.data);
  });

  worker.on('completed', (job) => {
    const { jobType, prizeId } = job.data;
    const result = job.returnvalue as GiftJobResult | undefined;
    const outcome =
      jobType === 'send' ||
      jobType === 'transfer' ||
      jobType === 'download-unique-sticker'
        ? ` outcome=${summarizeGiftJobResult(result ?? { success: false })}`
        : '';
    console.log(
      `[Userbot Worker] Job ${job.id} (${jobType}) completed prizeId=${prizeId ?? 'n/a'}${outcome}`,
    );
  });

  return worker;
}

export function startAuthWorker(): Worker<AuthJobData, AuthJobResult> {
  const worker = new Worker<AuthJobData, AuthJobResult>(
    AUTH_QUEUE_NAME,
    async (job) => {
      const { jobType, accountType, code, password } = job.data;

      try {
        if (jobType === 'start') {
          await startAuth(accountType);
          return { success: true };
        }

        if (jobType === 'confirm') {
          try {
            await confirmCode(accountType, code!);
            return { success: true };
          } catch (e: any) {
            if (e.message === '2FA_REQUIRED') {
              return { success: false, requires2FA: true };
            }
            throw e;
          }
        }

        if (jobType === '2fa') {
          await submit2FA(accountType, password!);
          return { success: true };
        }

        if (jobType === 'reconnect') {
          await reconnectClient(accountType);
          return { success: true };
        }

        return { success: false, error: 'Unknown job type' };
      } catch (e: any) {
        return { success: false, error: e?.message ?? String(e) };
      }
    },
    {
      connection: { url: process.env.REDIS_URL },
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Userbot Auth Worker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

/** @deprecated Use startGiftWorker */
export function startWorker(): Worker<GiftJobData, GiftJobResult> {
  return startGiftWorker();
}

import { TelegramBot } from 'typescript-telegram-bot-api';
import '../config';
import {
  prisma,
  SponsorType,
  SponsorApprovalStatus,
  TransactionStatus,
  TransactionType,
  Currencies,
} from '@database';
import fs from 'fs/promises';
import path from 'path';
import {
  downloadFile,
  parseChannelConnectStartParam,
  parseGiveawayDeepLinkStartParam,
  buildManageGiveawayStartappUrl,
} from '@common/utils';
import { walletService } from '@wallet/services';
import { PaymentBody } from '@wallet/types';
import {
  giveawayService,
  prizeService,
  SPONSOR_APPROVAL_OPEN_GIVEAWAY_WHERE,
  refundLinkRequestWalletInTx,
  refundLinkRequestViaTelegram,
  refundAcceptedJointForChannelInTx,
  applyTelegramJointRefunds,
} from '@giveaways/services';
import axios from 'axios';
import {
  getUserLanguage,
  WELCOME_MESSAGES,
  SPONSOR_APPROVAL_MESSAGES,
  COOWNER_RESULTS_MESSAGES,
  START_MESSAGES,
  DESCRIPTION_REQUEST_MESSAGES,
  PAYMENT_SUCCESS_MESSAGES,
  ADVERTISING_APPLIED_MESSAGES,
  LINK_REQUEST_MESSAGES,
  POSTLOT_MESSAGES,
  GIVEAWAY_ACTIVATION_MESSAGES,
  normalizeGiveawayLanguage,
} from './service/localization';
import {
  generateInviteLink,
  postGiveawayToSponsorChannel,
  postGiveawayToAdditionalChannel,
  sendSponsorApprovalRequest,
  sendCoOwnerResultsNotification,
  sendWinnersAnnouncement,
  isTelegramMessageNotModifiedError,
  toAbsoluteUrl,
  sendMessage,
  editLinkRequestMessage,
  generateTrackingCode,
  reconcileChannelAddedBy,
  claimSharedChannelManagement,
  getSharedChannelClaimant,
  rejectAndLockSponsorApproval,
  releaseSharedChannelManagement,
  reserveSharedChannelPublication,
  releaseSharedChannelPublication,
  reconcileChannelsForGiveaway,
  refundTelegramStarPayment,
} from './service/bot.service';
import {
  handleDescriptionFlowCallback,
  handleDescriptionTextMessage,
} from './service/description-flow.service';
import { telegramEntitiesToHtml } from './utils';
import { Roles } from '@auth/enums';
import { InlineKeyboardMarkup, TelegramChatMember } from './types';
export * from './service';
export * from './utils';
export * from './types';

BigInt.prototype['toJSON'] = function () {
  return this.toString();
};

function postCodeToUuid(code: string): string {
  return `${code.slice(0, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}-${code.slice(16, 20)}-${code.slice(20)}`;
}

const bot = new TelegramBot({ botToken: process.env.BOT_TOKEN });
bot.startPolling();

// Graceful shutdown flag
let isShuttingDown = false;

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log but don't crash - let the bot continue running
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Critical error - let PM2 restart
  gracefulShutdown(1);
});

// Graceful shutdown
async function gracefulShutdown(exitCode: number = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('Shutting down gracefully...');

  try {
    await bot.stopPolling();
    await prisma.$disconnect();
    console.log('Shutdown complete');
    process.exit(exitCode);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown());
process.on('SIGINT', () => gracefulShutdown());

const channelsDir = path.join(process.env.MULTER_DEST!, 'channels');
fs.mkdir(channelsDir, { recursive: true }).catch(console.error);

// Set localized bot commands
async function setupBotCommands() {
  try {
    // Commands in Russian (default)
    await bot.setMyCommands({
      commands: [
        { command: 'start', description: 'Запустить бота и открыть веб-апп' },
      ],
      language_code: 'ru',
    });

    // Commands in Ukrainian
    await bot.setMyCommands({
      commands: [
        { command: 'start', description: 'Запустити бота та відкрити веб-апп' },
      ],
      language_code: 'uk',
    });

    // Commands in English
    await bot.setMyCommands({
      commands: [
        { command: 'start', description: 'Start the bot and open web app' },
      ],
      language_code: 'en',
    });

    console.log('Bot commands set successfully for all languages');
  } catch (error) {
    console.error('Error setting bot commands:', error);
  }
}

// Bot profile descriptions are managed in Telegram/BotFather and must not be
// overwritten on deploy or process restart.
setupBotCommands();

// Refresh invite links on startup
async function refreshInviteLinksOnStartup() {
  try {
    console.log('Refreshing channel invite links on startup...');

    // Find all active private channels to refresh their invite links
    const channels = await prisma.channel.findMany({
      where: {
        isActive: true,
        botCanInviteUsers: true,
        username: null, // Only private channels need invite links
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (channels.length === 0) {
      console.log('No private channels found to update');
      return;
    }

    console.log(`Refreshing invite links for ${channels.length} channel(s)...`);
    let successCount = 0;

    for (const channel of channels) {
      try {
        const inviteLink = await generateInviteLink(channel.id);
        if (inviteLink) {
          await prisma.channel.update({
            where: { id: channel.id },
            data: { inviteLink },
          });
          successCount++;
        }
      } catch (error) {
        console.error(
          `Failed to refresh link for channel ${channel.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log(
      `✓ Successfully refreshed ${successCount}/${channels.length} invite links`,
    );
  } catch (error) {
    console.error('Error refreshing invite links on startup:', error);
  }
}
refreshInviteLinksOnStartup();

async function cleanupExpiredTempBanners() {
  try {
    const expired = await prisma.tempBannerUpload.findMany({
      where: { expiresAt: { lt: new Date() } },
    });
    for (const record of expired) {
      for (const filePath of record.filePaths) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
    if (expired.length > 0) {
      await prisma.tempBannerUpload.deleteMany({
        where: { id: { in: expired.map((r) => r.id) } },
      });
      console.log(`Cleaned up ${expired.length} expired temp banner upload(s)`);
    }
  } catch (error) {
    console.error('Error cleaning up expired temp banners:', error);
  }
}
cleanupExpiredTempBanners();

bot.on('message:text', async (msg) => {
  const match = msg.text?.match(/\/start(?:\s+(.+))?/);
  if (!match) return;

  const chatId = msg.chat.id;
  const startParam = match[1];

  if (msg.chat.type === 'private' && startParam) {
    const deepLink = parseGiveawayDeepLinkStartParam(startParam);
    if (deepLink) {
      try {
        await reconcileChannelsForGiveaway(deepLink.giveawayId);
      } catch (err: any) {
        console.warn(
          `[Bot /start] reconcileChannelsForGiveaway failed giveawayId=${deepLink.giveawayId}: ${err?.message}`,
        );
      }
    }
  }

  if (msg.chat.type === 'private') {
    // Get user from database to check role and language
    const user = await prisma.user.findFirst({
      where: { telegramId: msg.from.id.toString() },
      select: {
        id: true,
        roleId: true,
        picked_language: true,
        language_code: true,
        first_name: true,
        last_name: true,
      },
    });

    const lang = getUserLanguage(
      user ?? { language_code: msg.from.language_code },
    );

    const inlineKeyboard = [
      [
        {
          text: START_MESSAGES.openAppButton[lang],
          web_app: { url: process.env.CLIENT_URL },
        },
      ],
    ];

    // Add admin panel button if user is Admin or SuperAdmin
    if (
      user &&
      (user.roleId === Roles.Admin || user.roleId === Roles.SuperAdmin)
    ) {
      inlineKeyboard.push([
        {
          text: START_MESSAGES.adminPanelButton[lang],
          web_app: { url: `${process.env.CLIENT_URL}/admin/balance` },
        },
      ]);
    }

    const developerIds = [933012482, 513950472, 5708309883];
    if (developerIds.includes(msg.from.id)) {
      inlineKeyboard.push([
        {
          text: '👨‍💻 Developer',
          web_app: {
            url: process.env.DEV_LINK || 'http://localhost:5173/',
          },
        },
      ]);
    }

    const options = {
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    };

    await bot.sendMessage({
      chat_id: chatId,
      text: START_MESSAGES.welcomeText[lang],
      ...options,
    });

    // Resend pending co-owner publish DMs only for giveaways still running (not finished/cancelled)
    if (user?.id) {
      try {
        const staleSkipped = await prisma.sponsorApproval.updateMany({
          where: {
            ownerUserId: user.id,
            status: SponsorApprovalStatus.Pending,
            NOT: { giveaway: SPONSOR_APPROVAL_OPEN_GIVEAWAY_WHERE },
          },
          data: {
            status: SponsorApprovalStatus.Rejected,
            respondedAt: new Date(),
          },
        });

        const pendingApprovals = await prisma.sponsorApproval.findMany({
          where: {
            ownerUserId: user.id,
            status: SponsorApprovalStatus.Pending,
            giveaway: SPONSOR_APPROVAL_OPEN_GIVEAWAY_WHERE,
            channel: {
              addedBy: { some: { userId: user.id } },
            },
          },
          include: {
            giveaway: {
              select: {
                id: true,
                participiationType: true,
                language: true,
                banner: true,
                createdById: true,
              },
            },
            channel: { select: { title: true, id: true } },
          },
        });

        console.log(
          `[Bot /start] sponsorApprovalResend userId=${user.id} skippedFinished=${staleSkipped.count} toResend=${pendingApprovals.length}`,
        );

        for (const approval of pendingApprovals) {
          try {
            const result = await sendSponsorApprovalRequest(
              msg.from.id.toString(),
              user.first_name,
              user.last_name,
              {
                id: approval.giveaway.id,
                type: approval.giveaway.participiationType,
                createdById: approval.giveaway.createdById,
                banner: approval.giveaway.banner,
              },
              approval.channelId,
              approval.channel.title || `Channel ${approval.channelId}`,
              approval.id,
              getUserLanguage(
                user ?? { language_code: msg.from.language_code },
              ),
              user.id,
            );

            if (result.success && result.messageId) {
              await prisma.sponsorApproval.update({
                where: { id: approval.id },
                data: { messageId: BigInt(result.messageId) },
              });
            }
          } catch (err: any) {
            console.log(
              `[Bot /start] Could not resend approval giveawayId=${approval.giveawayId}: ${err?.message}`,
            );
          }
        }
      } catch (err: any) {
        console.log(
          `Error checking pending approvals on /start: ${err?.message}`,
        );
      }
    }

    return;
  }

  if (
    startParam &&
    (msg.chat.type === 'group' ||
      msg.chat.type === 'supergroup' ||
      msg.chat.type === 'channel')
  ) {
    // https://t.me/bot?startgroup=sponsor-{giveawayUuid} | linked-{giveawayUuid}
    const connect = parseChannelConnectStartParam(startParam);
    if (!connect) {
      // Mini-app deep links (giveawayId_{uuid}, etc.) or unknown shapes — do not spam the channel.
      console.log(
        `[Bot] Ignored group /start (not channel connect) chat=${chatId} type=${msg.chat.type} param=${startParam}`,
      );
      return;
    }

    const { connectionType, giveawayId } = connect;

    try {
      await handleChannelConnection(msg.chat, giveawayId, connectionType);

      const connectionText =
        connectionType === 'sponsor' ? 'спонсором' : 'связанным каналом';
      await bot.sendMessage({
        chat_id: chatId,
        text: `🎉 Канал успешно подключен к розыгрышу как ${connectionText}!`,
      });
    } catch (error: any) {
      console.error(
        `Error connecting channel to giveaway (param=${startParam}):`,
        error,
      );
      await bot.sendMessage({
        chat_id: chatId,
        text: `❌ Произошла ошибка при подключении канала к розыгрышу: ${error?.message}`,
      });
    }
  }
});

// /postlot handler — post giveaway to an additional channel
bot.on('message:text', async (msg) => {
  if (msg.chat.type !== 'private') return;
  const postlotMatch = msg.text?.match(/^\/postlot([a-f0-9]{32})$/i);
  if (!postlotMatch) return;

  const chatId = msg.chat.id;
  const telegramId = msg.from?.id?.toString();
  if (!telegramId) return;

  const user = await prisma.user.findFirst({
    where: { telegramId },
    select: { id: true, picked_language: true, language_code: true },
  });

  const lang = getUserLanguage(
    user ?? { language_code: msg.from?.language_code },
  );
  const msgs = POSTLOT_MESSAGES[lang];

  if (!user) {
    await bot.sendMessage({ chat_id: chatId, text: msgs.notRegistered });
    return;
  }

  const giveawayId = postCodeToUuid(postlotMatch[1].toLowerCase());

  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    select: { id: true, isActive: true, isCancelled: true, createdById: true },
  });

  if (!giveaway || !giveaway.isActive || giveaway.isCancelled) {
    await bot.sendMessage({ chat_id: chatId, text: msgs.giveawayNotFound });
    return;
  }

  try {
    await reconcileChannelsForGiveaway(giveawayId);
  } catch (err: any) {
    console.warn(
      `reconcileChannelsForGiveaway failed for ${giveawayId}:`,
      err?.message ?? err,
    );
  }

  const addedChannels = await prisma.addedBy.findMany({
    where: { userId: user.id },
    include: {
      channel: {
        include: {
          messages: { where: { giveawayId } },
          postlotPublications: { where: { giveawayId } },
        },
      },
    },
  });

  const availableChannels = addedChannels
    .map((ab) => ab.channel)
    .filter(
      (ch) => ch.messages.length === 0 && ch.postlotPublications.length === 0,
    );

  if (availableChannels.length === 0) {
    await bot.sendMessage({ chat_id: chatId, text: msgs.noChannels });
    return;
  }

  const activationMsgs = GIVEAWAY_ACTIVATION_MESSAGES[lang];
  const isGiveawayCreator = user.id === giveaway.createdById;
  const manageRow = isGiveawayCreator
    ? [
        [
          {
            text: activationMsgs.manageButton,
            url: buildManageGiveawayStartappUrl(
              process.env.BOT_URL,
              giveaway.id,
              user.id,
              giveaway.createdById,
            ),
          },
        ],
      ]
    : [];

  const keyboard = {
    inline_keyboard: [
      ...availableChannels.map((ch) => [
        {
          text: ch.botCanPostMessages
            ? ch.title || `Channel ${ch.id}`
            : `⚠️ ${ch.title || `Channel ${ch.id}`}`,
          callback_data: `pl_ch:${giveaway.id}:${ch.id}`,
        },
      ]),
      ...manageRow,
      [{ text: msgs.cancelButton, callback_data: `pl_cancel:${giveaway.id}` }],
    ],
  };

  await bot.sendMessage({
    chat_id: chatId,
    text: msgs.selectChannel,
    reply_markup: keyboard,
  });
});

// Description capture handler
bot.on('message:text', async (msg) => {
  if (msg.chat.type !== 'private') return;
  if (msg.text?.startsWith('/')) return;

  const telegramId = msg.from?.id?.toString();
  if (!telegramId) return;

  const user = await prisma.user.findFirst({
    where: { telegramId },
    select: { id: true, picked_language: true, language_code: true },
  });
  if (!user) return;

  const request = await prisma.descriptionRequest.findUnique({
    where: { userId: user.id },
  });
  if (!request || new Date() > request.expiresAt) return;

  const lang = getUserLanguage(user);
  const htmlDescription = telegramEntitiesToHtml(msg.text, msg.entities);

  const handled = await handleDescriptionTextMessage(
    bot,
    msg.chat.id,
    user.id,
    htmlDescription,
  );
  if (handled) return;

  // Legacy guard: ignore stray text while preview is open (user must use buttons)
  if (request.description !== null) return;
});

// Payment handlers
bot.on('pre_checkout_query', async (query) => {
  try {
    console.log('Pre-checkout query received:', JSON.stringify(query, null, 2));

    const parsedPayload: PaymentBody = JSON.parse(query.invoice_payload);

    // Validate before persisting wallet / pending transaction records
    let isValid = true;
    let errorMessage = '';

    if ((parsedPayload.p === 2 || parsedPayload.p === 3) && parsedPayload.pg) {
      // Check if giveaway exists and hasn't been cancelled
      const giveaway = await prisma.giveaway.findUnique({
        where: { id: parsedPayload.pg },
      });

      if (!giveaway) {
        isValid = false;
        errorMessage = 'Giveaway not found.';
      } else if (parsedPayload.p === 2 && !giveaway.isActive) {
        isValid = false;
        errorMessage = 'Giveaway is no longer active.';
      } else if (giveaway.isCancelled) {
        isValid = false;
        errorMessage = 'Giveaway has been cancelled.';
      }
    } else if (parsedPayload.p === 5) {
      try {
        const nftPrizeIds = parsedPayload.ppids ?? [];
        const hasSubscription = await prizeService.hasActiveBotSubscription(
          parsedPayload.userId,
        );
        if (!hasSubscription) {
          isValid = false;
          errorMessage = 'Active subscription required.';
        } else if (!nftPrizeIds.length) {
          isValid = false;
          errorMessage = 'No prizes specified.';
        } else {
          await prizeService.validatePayableNftPrizeIds(
            parsedPayload.userId,
            nftPrizeIds,
          );
          const fees = await prizeService.calculatePrizePaymentFees(
            nftPrizeIds.length,
            [],
          );
          if (query.total_amount !== fees.stars.total) {
            isValid = false;
            errorMessage = 'Payment amount mismatch.';
          }
        }
      } catch {
        isValid = false;
        errorMessage = 'Invalid prize payment.';
      }
    }

    if (isValid) {
      const wallet = await prisma.wallet.upsert({
        where: { userId: parsedPayload.userId },
        create: {
          userId: parsedPayload.userId,
          starsBalance: 0,
          holdedStarsBalance: 0,
          tonBalance: 0,
        },
        update: {},
      });

      const balanceBefore = wallet.starsBalance;

      await prisma.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId: parsedPayload.userId,
          type: TransactionType.Incoming,
          status: TransactionStatus.Pending,
          currency: Currencies.Stars,
          value: query.total_amount,
          balanceBefore,
          balanceAfter: balanceBefore,
          telegramPaymentId: query.id,
          additionalInfo: `Pre-checkout: ${query.invoice_payload}`,
        },
      });
    }

    await bot.answerPreCheckoutQuery({
      pre_checkout_query_id: query.id,
      ok: isValid as any,
      error_message: isValid ? undefined : errorMessage,
    });
  } catch (error) {
    console.error('Error handling pre-checkout query:', error);
    await bot.answerPreCheckoutQuery({
      pre_checkout_query_id: query.id,
      ok: false,
      error_message: 'Payment processing error. Please try again.',
    });
  }
});

bot.on('message', async (msg) => {
  try {
    // Handle successful payments (existing code)
    if (msg.successful_payment) {
      console.log(
        'Successful payment received:',
        JSON.stringify(msg.successful_payment, null, 2),
      );

      const paymentDetails = msg.successful_payment;
      const { telegram_payment_charge_id, invoice_payload, total_amount } =
        paymentDetails;
      const parsedPayload: PaymentBody = JSON.parse(invoice_payload);

      const lang = getUserLanguage({ language_code: msg.from?.language_code });
      let message = '';
      let replyMarkup: InlineKeyboardMarkup | undefined = undefined;

      if (parsedPayload.p === 1) {
        // Deposit — add Stars/TON to in-app wallet
        const { wallet } = await walletService.processSuccessfulPayment(
          parsedPayload,
          telegram_payment_charge_id,
          total_amount,
        );
        const currency = parsedPayload.currency === 'Stars' ? '⭐' : 'TON';
        message = PAYMENT_SUCCESS_MESSAGES[lang].deposit(
          parsedPayload.amount,
          currency,
          Number(wallet.starsBalance),
          Number(wallet.tonBalance),
        );
      } else if (parsedPayload.p === 2) {
        // Lottery ticket purchase via Telegram Stars — register participation, wallet balance unchanged
        const tickets = parsedPayload.pt || 1;
        let wallet: {
          starsBalance: number | bigint;
          tonBalance: number | bigint;
        };
        try {
          wallet = await giveawayService.joinGiveawayViaInvoice(
            parsedPayload.userId,
            parsedPayload.pg!,
            tickets,
            telegram_payment_charge_id,
            parsedPayload.amount,
          );
        } catch (err) {
          console.error('joinGiveawayViaInvoice failed:', err);
          wallet = await walletService.getUserWallet(parsedPayload.userId);
        }

        message = PAYMENT_SUCCESS_MESSAGES[lang].tickets(
          parsedPayload.amount,
          tickets,
          Number(wallet.starsBalance),
          Number(wallet.tonBalance),
        );

        if (parsedPayload.pg) {
          const lotteryUrl = `${process.env.BOT_URL}?startapp=giveawayId_${parsedPayload.pg}`;
          replyMarkup = {
            inline_keyboard: [
              [
                {
                  text: PAYMENT_SUCCESS_MESSAGES[lang].goToLottery,
                  url: lotteryUrl,
                },
              ],
            ],
          };
        }
      } else if (parsedPayload.p === 3) {
        // Advertising payment via Telegram Stars — enable ads on the giveaway
        try {
          await giveawayService.applyAdsFromInvoice(
            parsedPayload.pg!,
            parsedPayload.userId,
            parsedPayload.ppa ?? false,
            parsedPayload.pna ?? false,
            telegram_payment_charge_id,
            total_amount,
          );
        } catch (err) {
          console.error('applyAdsFromInvoice failed:', err);
        }

        const giveawayUrl = parsedPayload.pg
          ? `${process.env.BOT_URL}?startapp=giveawayId_${parsedPayload.pg}`
          : undefined;
        message = ADVERTISING_APPLIED_MESSAGES[lang].text;
        if (giveawayUrl) {
          replyMarkup = {
            inline_keyboard: [
              [
                {
                  text: ADVERTISING_APPLIED_MESSAGES[lang].button,
                  url: giveawayUrl,
                },
              ],
            ],
          };
        }
      } else if (parsedPayload.p === 4) {
        // Giveaway co-sponsor slot payment via Telegram Stars
        try {
          await giveawayService.processJointPayment(
            parsedPayload.userId,
            parsedPayload.pg!,
            BigInt(parsedPayload.pch!),
            telegram_payment_charge_id,
            total_amount,
          );
        } catch (err) {
          console.error('processJointPayment failed:', err);
        }
        message = PAYMENT_SUCCESS_MESSAGES[lang].joint;
      } else if (parsedPayload.p === 5) {
        // NFT gift commission pre-pay via Telegram Stars
        try {
          await prizeService.processPrizeCommissionFromInvoice(
            parsedPayload.userId,
            parsedPayload.ppids ?? [],
            telegram_payment_charge_id,
            total_amount,
          );
          message = PAYMENT_SUCCESS_MESSAGES[lang].giftCommission(total_amount);
        } catch (err) {
          console.error('processPrizeCommissionFromInvoice failed:', err);
          message = PAYMENT_SUCCESS_MESSAGES[lang].giftCommissionFailed;
        }
      }

      await bot.sendMessage({
        chat_id: msg.from.id,
        text: message,
        reply_markup: replyMarkup,
      });

      console.log(
        `Payment processed successfully for user ${parsedPayload.userId}: ${parsedPayload.amount} ${parsedPayload.currency}`,
      );
    }

    if (msg.refunded_payment) {
      console.log(
        'Refunded payment received:',
        JSON.stringify(msg.refunded_payment, null, 2),
      );

      const refundDetails = msg.refunded_payment;
      const {
        telegram_payment_charge_id,
        invoice_payload,
        total_amount,
        currency,
      } = refundDetails;

      try {
        const parsedPayload: PaymentBody = JSON.parse(invoice_payload);

        // Process the refund through wallet service
        const { wallet } = await walletService.processRefund(
          parsedPayload,
          telegram_payment_charge_id,
          total_amount,
        );

        // If this was a ticket purchase (p=2), remove the participant records
        if (parsedPayload.p === 2 && parsedPayload.pg && parsedPayload.pt) {
          const ticketsToRemove = parsedPayload.pt;
          const ticketRecords = await prisma.participant.findMany({
            where: {
              userId: parsedPayload.userId,
              giveawayId: parsedPayload.pg,
            },
            select: { uuid: true },
            take: ticketsToRemove,
          });
          if (ticketRecords.length > 0) {
            await prisma.participant.deleteMany({
              where: { uuid: { in: ticketRecords.map((r) => r.uuid) } },
            });
            console.log(
              `Refund: removed ${ticketRecords.length} ticket(s) for user ${parsedPayload.userId} from giveaway ${parsedPayload.pg}`,
            );
          }
        }

        // Send refund notification message to user
        const currencySymbol = currency === 'XTR' ? '⭐' : 'TON';
        const refundMessage = `🔄 Payment Refunded\n💰 ${parsedPayload.amount} ${currencySymbol} has been refunded to your wallet.\n💳 Current balance: ${wallet.starsBalance} ⭐ | ${wallet.tonBalance} TON`;

        await bot.sendMessage({
          chat_id: msg.from.id,
          text: refundMessage,
        });

        console.log(
          `Payment refunded successfully for user ${parsedPayload.userId}: ${parsedPayload.amount} ${parsedPayload.currency} (Charge ID: ${telegram_payment_charge_id})`,
        );
      } catch (parseError) {
        console.error('Error parsing refund payload:', parseError);

        // Try to notify user even if payload parsing fails
        if (msg.from) {
          try {
            await bot.sendMessage({
              chat_id: msg.from.id,
              text: '🔄 A payment refund was processed, but there was an issue updating your wallet. Please contact support if needed.',
            });
          } catch (msgError) {
            console.error(
              'Could not send refund notification to user:',
              msgError,
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('Error handling message:', error);

    if (msg.from) {
      try {
        let errorMessage = '⚠️ There was an error processing your transaction.';

        if (msg.successful_payment) {
          errorMessage =
            '⚠️ There was an error processing your payment. Please contact support if the issue persists.';
        } else if (msg.refunded_payment) {
          errorMessage =
            '⚠️ There was an error processing your refund. Please contact support if the issue persists.';
        }

        await bot.sendMessage({
          chat_id: msg.from.id,
          text: errorMessage,
        });
      } catch (msgError) {
        console.error('Could not send error message to user:', msgError);
      }
    }
  }
});

/**
 * Refund a Star payment (for testing or error handling)
 */
export async function refundStarPayment(
  telegramUserId: number,
  telegramPaymentChargeId: string,
): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { telegramId: telegramUserId.toString() },
    select: { id: true },
  });
  if (!user) {
    console.error(
      `refundStarPayment: no app user for telegram id ${telegramUserId}`,
    );
    return false;
  }
  return refundTelegramStarPayment(
    telegramUserId,
    telegramPaymentChargeId,
    user.id,
  );
}

async function trackChannelAddition(channelId: bigint, userId: number) {
  await prisma.addedBy.upsert({
    where: {
      channelId_userId: {
        channelId: BigInt(channelId),
        userId: userId,
      },
    },
    create: {
      channelId: BigInt(channelId),
      userId: userId,
    },
    update: {
      updatedAt: new Date(),
    },
  });
}

async function handleChannelConnection(
  chat: any,
  giveawayId: string,
  connectionType: string,
) {
  console.log(
    'Handling channel connection for: ',
    chat,
    giveawayId,
    connectionType,
  );
  let photoPath: string | null = null;

  if (chat.photo) {
    try {
      const chatPhotos = await bot.getUserProfilePhotos({
        user_id: chat.id,
        limit: 1,
      });
      console.log(chatPhotos);
      if (chatPhotos.total_count > 0) {
        const photo = chatPhotos.photos[0];
        const highestResPhoto = photo[photo.length - 1];
        const file = await bot.getFile({ file_id: highestResPhoto.file_id });

        if (file.file_path) {
          const fileExtension = path.extname(file.file_path) || '.jpg';
          const fileName = `${chat.id}_${Date.now()}${fileExtension}`;
          const fullPath = path.join(channelsDir, fileName);

          const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
          await downloadFile(fileUrl, fullPath);

          photoPath = path.join('channels', fileName);
        }
      }
    } catch (photoError) {
      console.error('Error downloading chat photo:', photoError);
    }
  }

  // Generate invite link for private channels (without username)
  let inviteLink: string | null = null;
  if (!chat.username) {
    console.log(
      `Channel ${chat.id} is private (no username), generating invite link...`,
    );
    inviteLink = await generateInviteLink(chat.id);
    if (inviteLink) {
      console.log(`Generated invite link: ${inviteLink}`);
    } else {
      console.warn(
        `Failed to generate invite link for private channel ${chat.id}`,
      );
    }
  }

  await prisma.channel.upsert({
    where: { id: BigInt(chat.id) },
    create: {
      id: BigInt(chat.id),
      title: chat.title || `Chat ${chat.id}`,
      username: chat.username || null,
      photo: photoPath,
      type: chat.type,
      inviteLink: inviteLink,
      isActive: true,
    },
    update: {
      title: chat.title || `Chat ${chat.id}`,
      username: chat.username || null,
      photo: photoPath,
      type: chat.type,
      inviteLink: inviteLink,
      isActive: true,
    },
  });

  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
  });

  if (!giveaway) {
    throw new Error(`Giveaway with ID ${giveawayId} not found`);
  }

  // Track who added this channel
  if (giveaway.createdById) {
    await trackChannelAddition(BigInt(chat.id), giveaway.createdById);
  }

  if (connectionType === 'sponsor') {
    await prisma.sponsors.upsert({
      where: {
        giveawayId_sponsorLinkId_sponsorChannelId: {
          sponsorChannelId: BigInt(chat.id),
          giveawayId: giveawayId,
          sponsorLinkId: null,
        },
      },
      create: {
        sponsorChannelId: BigInt(chat.id),
        giveawayId: giveawayId,
        sponsorLinkId: null,
        sponsorType: SponsorType.Channel,
      },
      update: {},
    });

    console.log(
      `Created sponsor connection: Channel ${chat.id} -> Giveaway ${giveawayId}`,
    );
  } else if (connectionType === 'linked') {
    await prisma.linkedChannels.upsert({
      where: {
        channelId_giveawayId: {
          channelId: BigInt(chat.id),
          giveawayId: giveawayId,
        },
      },
      create: {
        channelId: BigInt(chat.id),
        giveawayId: giveawayId,
      },
      update: {},
    });

    console.log(
      `Created linked channel connection: Channel ${chat.id} -> Giveaway ${giveawayId}`,
    );
  }
}

bot.on('my_chat_member', async (update) => {
  console.log('my_chat_member update:', JSON.stringify(update, null, 2));

  try {
    const { chat, new_chat_member, old_chat_member, from } = update;

    if (chat.type === 'private') {
      return;
    }

    if (
      new_chat_member.status === 'member' ||
      new_chat_member.status === 'administrator'
    ) {
      console.log(`Bot was added to ${chat.type}: ${chat.title || chat.id}`);

      // If bot was previously kicked, wait a bit for Telegram to propagate the status change
      if (
        old_chat_member.status === 'kicked' ||
        old_chat_member.status === 'left'
      ) {
        console.log('Bot was re-added, waiting for status propagation...');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      let photoPath: string | null = null;

      try {
        const chatInfo = await bot.getChat({ chat_id: chat.id });

        if (chatInfo.photo && chatInfo.photo.big_file_id) {
          const file = await bot.getFile({
            file_id: chatInfo.photo.big_file_id,
          });

          if (file.file_path) {
            const fileExtension = path.extname(file.file_path) || '.jpg';
            const fileName = `${chat.id}_${Date.now()}${fileExtension}`;
            const fullPath = path.join(channelsDir, fileName);

            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
            await downloadFile(fileUrl, fullPath);

            photoPath = path.join('/static/channels', fileName);
          }
        }
      } catch (photoError) {
        console.error('Error downloading chat photo:', photoError);
      }

      // Generate invite link for private channels (without username)
      let inviteLink: string | null = null;
      if (!chat.username) {
        console.log(
          `Channel ${chat.id} is private (no username), generating invite link...`,
        );
        inviteLink = await generateInviteLink(chat.id);
        if (inviteLink) {
          console.log(`Generated invite link: ${inviteLink}`);
        } else {
          console.warn(
            `Failed to generate invite link for private channel ${chat.id}. Channel will be saved without invite link.`,
          );
          console.warn(
            `To fix this: Edit bot permissions in the channel and enable "Invite users via link"`,
          );
        }
      }

      // Determine bot's effective permissions from the my_chat_member update
      const botPerms = new_chat_member as TelegramChatMember;
      const botIsAdmin = new_chat_member.status === 'administrator';
      // Channels: can_post_messages OR can_edit_messages is enough to manage our own posts
      // (add-bot deep-link with admin= rights is built on the frontend, not here)
      // Groups/supergroups: any member can post
      const botCanPostMessages =
        chat.type === 'channel'
          ? botIsAdmin &&
            ((botPerms.can_post_messages ?? false) ||
              (botPerms.can_edit_messages ?? false))
          : true;
      // can_invite_users requires admin status with the permission
      const botCanInviteUsers =
        botIsAdmin && (botPerms.can_invite_users ?? false);

      await prisma.channel.upsert({
        where: { id: BigInt(chat.id) },
        create: {
          id: BigInt(chat.id),
          title: chat.title || `Chat ${chat.id}`,
          username: chat.username || null,
          photo: photoPath,
          type: chat.type,
          inviteLink: inviteLink,
          isActive: true,
          botCanPostMessages,
          botCanInviteUsers,
        },
        update: {
          title: chat.title || `Chat ${chat.id}`,
          username: chat.username || null,
          photo: photoPath,
          type: chat.type,
          inviteLink: inviteLink,
          isActive: true,
          botCanPostMessages,
          botCanInviteUsers,
        },
      });

      console.log(`Successfully saved chat data for: ${chat.title || chat.id}`);

      // Track who added this channel
      if (from && from.id && !from.is_bot) {
        try {
          let user = await prisma.user.findFirst({
            where: { telegramId: from.id.toString() },
          });

          if (!user) {
            // Channel owner not yet in our system — register them so ownership is tracked
            console.log(
              `User with Telegram ID ${from.id} not found in database, creating account for channel owner tracking`,
            );
            user = await prisma.user.create({
              data: {
                telegramId: from.id.toString(),
                username: from.username ?? null,
                first_name: from.first_name,
                last_name: from.last_name ?? null,
                language_code: from.language_code ?? 'en',
                picked_language: from.language_code ?? 'en',
                photo_url: '',
                is_premium: from.is_premium ?? false,
                role: { connect: { id: Roles.User } },
                wallet: { create: {} },
              },
            });
            console.log(
              `Created account for channel owner: user ${user.id} (${from.username || from.first_name})`,
            );
          }

          await reconcileChannelAddedBy(BigInt(chat.id));
          console.log(
            `Reconciled channel ownership for ${chat.id} after bot add`,
          );
          try {
            // Get user's preferred language and send localized message
            const userLang = getUserLanguage(user);
            const welcomeMessage = WELCOME_MESSAGES[userLang];

            await sendMessage(user.telegramId, welcomeMessage);
          } catch (sendError: any) {
            console.log('Could not send welcome message:', sendError?.message);
          }
        } catch (trackError) {
          console.error('Error tracking channel addition:', trackError);
        }
      }
    } else if (
      (old_chat_member.status === 'member' ||
        old_chat_member.status === 'administrator') &&
      (new_chat_member.status === 'left' || new_chat_member.status === 'kicked')
    ) {
      console.log(
        `Bot was removed from ${chat.type}: ${chat.title || chat.id}`,
      );

      // Use updateMany to avoid error if record doesn't exist
      const result = await prisma.channel.updateMany({
        where: { id: BigInt(chat.id) },
        data: {
          isActive: false,
          botCanPostMessages: false,
          botCanInviteUsers: false,
        },
      });

      if (result.count === 0) {
        console.log(
          `Channel ${chat.id} not found in database, skipping update`,
        );
      } else {
        // Remove channel from active giveaway requirements
        try {
          const channelBigIntId = BigInt(chat.id);

          // Find all linked channels for active giveaways
          const linkedChannels = await prisma.linkedChannels.findMany({
            where: {
              channelId: channelBigIntId,
              giveaway: {
                isActive: true,
                isCancelled: false,
              },
            },
            include: {
              giveaway: {
                select: {
                  id: true,
                  description: true,
                  isActive: true,
                },
              },
            },
          });

          if (linkedChannels.length > 0) {
            console.log(
              `Removing channel ${chat.id} from ${linkedChannels.length} active giveaway(s)`,
            );

            const telegramRefunds: NonNullable<
              Awaited<ReturnType<typeof refundAcceptedJointForChannelInTx>>
            >[] = [];

            for (const lc of linkedChannels) {
              try {
                const giveaway = await prisma.giveaway.findUnique({
                  where: { id: lc.giveawayId },
                  select: { createdById: true },
                });
                if (!giveaway?.createdById) continue;

                // Collect refund context only after the DB tx commits successfully
                const tg = await prisma.$transaction(async (tx) => {
                  const refund = await refundAcceptedJointForChannelInTx(
                    tx,
                    lc.giveawayId,
                    channelBigIntId,
                    giveaway.createdById,
                  );

                  await tx.linkedChannels.deleteMany({
                    where: {
                      channelId: channelBigIntId,
                      giveawayId: lc.giveawayId,
                    },
                  });

                  return refund;
                });

                if (tg) telegramRefunds.push(tg);
              } catch (jointErr) {
                console.error(
                  `Error refunding joint for channel ${chat.id} giveaway ${lc.giveawayId}:`,
                  jointErr,
                );
              }
            }

            await applyTelegramJointRefunds(telegramRefunds);

            console.log(
              `Removed channel from ${linkedChannels.length} giveaway requirement(s)`,
            );

            linkedChannels.forEach((lc) => {
              console.log(`- Giveaway: ${lc.giveaway.id}`);
            });
          }
        } catch (removeError) {
          console.error(
            `Error removing channel ${chat.id} from giveaway requirements:`,
            removeError,
          );
        }
      }
    }
  } catch (error) {
    console.error('Error processing my_chat_member update:', error);
  }
});

// Auto-approve join requests for channels linked to active giveaways
bot.on('chat_join_request', async (update) => {
  console.log('chat_join_request update:', JSON.stringify(update, null, 2));

  try {
    const { chat, from } = update;
    const channelId = BigInt(chat.id);
    const userId = from.id;

    // Find all active giveaways linked to this channel
    const activeGiveaways = await prisma.giveaway.findMany({
      where: {
        isActive: true,
        isCancelled: false,
        isPlanned: false,
        linkedChannels: {
          some: {
            channelId: channelId,
          },
        },
      },
      select: {
        id: true,
        description: true,
      },
    });

    // If no active giveaways found, don't auto-approve
    if (activeGiveaways.length === 0) {
      console.log(
        `No active giveaways for channel ${channelId}, join request not auto-approved`,
      );
      return;
    }

    console.log(
      `Found ${activeGiveaways.length} active giveaway(s) for channel ${channelId}, attempting auto-approval`,
    );

    // Attempt to approve the join request via Telegram API
    try {
      await bot.approveChatJoinRequest({
        chat_id: chat.id,
        user_id: userId,
      });

      console.log(
        `✅ Approved join request for user ${userId} (${from.username || from.first_name}) in channel ${channelId}`,
      );

      // Log approval to database for all linked active giveaways
      const approvalPromises = activeGiveaways.map((giveaway) =>
        prisma.channelJoinRequestApproval
          .create({
            data: {
              userId: userId,
              channelId: channelId,
              giveawayId: giveaway.id,
              status: 'Approved',
            },
          })
          .catch((error) => {
            // Handle duplicate entries gracefully
            if (error.code === 'P2002') {
              console.log(
                `Approval already logged for user ${userId} in channel ${channelId} for giveaway ${giveaway.id}`,
              );
            } else {
              console.error(
                `Error logging approval for user ${userId} in channel ${channelId} for giveaway ${giveaway.id}:`,
                error.message || error,
              );
            }
          }),
      );

      await Promise.all(approvalPromises);

      console.log(
        `✅ Logged ${activeGiveaways.length} approval record(s) to database`,
      );
    } catch (approvalError: any) {
      // Log error but continue - don't crash the bot
      const errorMessage =
        approvalError.response?.data?.description || approvalError.message;
      const errorCode = approvalError.response?.data?.error_code;

      console.error(
        `❌ Failed to approve join request for user ${userId} in channel ${channelId}:`,
        errorMessage,
        errorCode ? `(Error code: ${errorCode})` : '',
      );

      // Specific error handling
      if (errorCode === 403) {
        console.error(
          `⚠️ Bot doesn't have permission to approve join requests in channel ${channelId}. ` +
            `Please ensure bot has 'can_invite_users' permission.`,
        );
      } else if (
        errorCode === 400 &&
        errorMessage.includes('USER_ALREADY_PARTICIPANT')
      ) {
        console.log(
          `User ${userId} is already a participant in channel ${channelId}, continuing...`,
        );
      }
    }
  } catch (error: any) {
    console.error('Error processing chat_join_request:', error);
  }
});

/**
 * Handle sponsor publish callback queries
 * Pattern: sponsor_publish:{approvalId}
 */
bot.on('callback_query', async (query) => {
  let pendingSharedPublication:
    | { giveawayId: string; channelId: bigint; userId: number }
    | undefined;
  try {
    const callbackData = query.data;
    if (!callbackData) return;

    if (await handleDescriptionFlowCallback(bot, query)) {
      return;
    }

    // Route to the correct handler based on callback prefix
    if (
      callbackData.startsWith('co_r:') ||
      callbackData.startsWith('coowner_results:')
    ) {
      // Handle co-owner publishing results: co_r:{giveawayId}:{channelId}
      // Legacy prefix 'coowner_results:' kept for buttons already sent before the rename
      const parts = callbackData.split(':');
      const giveawayId = parts[1];
      const channelId = BigInt(parts[2]);
      const telegramUserId = query.from.id;

      console.log(
        `[co_r] publish click tg=${telegramUserId} giveawayId=${giveawayId} channelId=${channelId}`,
      );

      try {
        // Verify user owns this channel
        const user = await prisma.user.findFirst({
          where: { telegramId: telegramUserId.toString() },
          select: {
            id: true,
            first_name: true,
            last_name: true,
            picked_language: true,
            language_code: true,
          },
        });

        if (!user) {
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: 'User not found.',
            show_alert: true,
          });
          return;
        }

        const isOwner = await prisma.addedBy.findFirst({
          where: { userId: user.id, channelId },
        });

        if (!isOwner) {
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: 'You do not own this channel.',
            show_alert: true,
          });
          return;
        }

        const claimant = await getSharedChannelClaimant(giveawayId, channelId);
        if (!claimant || claimant.userId !== user.id) {
          const lang = getUserLanguage(user);
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: SPONSOR_APPROVAL_MESSAGES[lang].managementTakenAlert,
            show_alert: true,
          });
          return;
        }

        // Publish results to this channel (forcePublish bypasses isPostingResults guard)
        const publishResult = await sendWinnersAnnouncement(
          giveawayId,
          new Set([channelId]),
          { forcePublish: true },
        );

        console.log(
          `[co_r] publish result giveawayId=${giveawayId} channelId=${channelId} success=${publishResult.success} failed=${publishResult.failed}`,
        );

        if (publishResult.success === 0) {
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: 'Could not publish results. Make sure the giveaway was posted to this channel.',
            show_alert: true,
          });
          return;
        }

        // Edit the notification message to show published status
        if (query.message) {
          const lang = getUserLanguage(user);
          const msgs = COOWNER_RESULTS_MESSAGES[lang];
          const giveaway = await prisma.giveaway.findUnique({
            where: { id: giveawayId },
            select: { createdById: true },
          });
          const manageUrl = giveaway
            ? buildManageGiveawayStartappUrl(
                process.env.BOT_URL,
                giveawayId,
                user.id,
                giveaway.createdById,
              )
            : `${process.env.BOT_URL}?startapp=sharedId_${giveawayId}`;

          const newKeyboard = {
            inline_keyboard: [[{ text: msgs.manageButton, url: manageUrl }]],
          };
          try {
            if ('caption' in query.message) {
              await bot.editMessageCaption({
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                caption:
                  (query.message.caption || '') + `\n\n${msgs.publishedStatus}`,
                parse_mode: 'HTML',
                reply_markup: newKeyboard,
              });
            } else if ('text' in query.message) {
              await bot.editMessageText({
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                text:
                  (query.message.text || '') + `\n\n${msgs.publishedStatus}`,
                parse_mode: 'HTML',
                reply_markup: newKeyboard,
              });
            }
          } catch (editErr: any) {
            if (!isTelegramMessageNotModifiedError(editErr)) {
              console.error(
                '[co_r] Error editing notification message:',
                editErr,
              );
            }
          }
        }

        await bot.answerCallbackQuery({ callback_query_id: query.id });
      } catch (err: any) {
        console.error(
          `[co_r] Error handling callback giveawayId=${giveawayId} channelId=${channelId}:`,
          err,
        );
        await bot.answerCallbackQuery({
          callback_query_id: query.id,
          text: 'Error publishing results.',
          show_alert: true,
        });
      }
      return;
    }

    // pl_ch: channel selection for /postlot
    if (callbackData.startsWith('pl_ch:')) {
      const parts = callbackData.split(':');
      const giveawayId = parts[1];
      const channelId = BigInt(parts[2]);
      const telegramUserId = query.from.id;

      try {
        const user = await prisma.user.findFirst({
          where: { telegramId: telegramUserId.toString() },
          select: { id: true, picked_language: true, language_code: true },
        });
        const lang = getUserLanguage(
          user ?? { language_code: query.from.language_code },
        );
        const msgs = POSTLOT_MESSAGES[lang];

        if (!user) {
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: msgs.userNotFound,
            show_alert: true,
          });
          return;
        }

        const isOwner = await prisma.addedBy.findFirst({
          where: { userId: user.id, channelId },
        });
        if (!isOwner) {
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: msgs.notYourChannel,
            show_alert: true,
          });
          return;
        }

        const giveawayAccess = await prisma.giveaway.findUnique({
          where: { id: giveawayId },
          select: { createdById: true },
        });

        const linkedChannel = await prisma.linkedChannels.findUnique({
          where: { channelId_giveawayId: { channelId, giveawayId } },
          select: { channelId: true },
        });

        let reservedSharedManagement = false;
        let reservedLinkedPublication = false;
        if (giveawayAccess && user.id !== giveawayAccess.createdById) {
          const reservation = await claimSharedChannelManagement(
            giveawayId,
            channelId,
            user.id,
            { finalize: false },
          );
          if (!reservation.claimed) {
            await bot.answerCallbackQuery({
              callback_query_id: query.id,
              text: msgs.managementTaken,
              show_alert: true,
            });
            return;
          }
          reservedSharedManagement = true;
        }

        if (linkedChannel) {
          reservedLinkedPublication = await reserveSharedChannelPublication(
            giveawayId,
            channelId,
            user.id,
          );
          if (!reservedLinkedPublication) {
            const existingMessage = await prisma.giveawayMessage.findFirst({
              where: { giveawayId, channelId },
              select: { id: true },
            });
            if (existingMessage && reservedSharedManagement) {
              await claimSharedChannelManagement(
                giveawayId,
                channelId,
                user.id,
              );
            }
            await bot.answerCallbackQuery({
              callback_query_id: query.id,
              text: msgs.alreadyPosted,
              show_alert: true,
            });
            return;
          }
          pendingSharedPublication = {
            giveawayId,
            channelId,
            userId: user.id,
          };
        }

        const result = await postGiveawayToAdditionalChannel(
          giveawayId,
          channelId,
          user.id,
        );

        if (result.success || result.error === 'posted_but_not_saved') {
          if (
            reservedLinkedPublication &&
            result.error !== 'posted_but_not_saved'
          ) {
            await releaseSharedChannelPublication(
              giveawayId,
              channelId,
              user.id,
            );
          }
          pendingSharedPublication = undefined;
          const [channel, giveaway] = await Promise.all([
            prisma.channel.findUnique({
              where: { id: channelId },
              select: { title: true },
            }),
            prisma.giveaway.findUnique({
              where: { id: giveawayId },
              select: { createdById: true },
            }),
          ]);

          // Non-creator postlot = claim shared management for this channel
          if (giveaway && user.id !== giveaway.createdById) {
            const claim = await claimSharedChannelManagement(
              giveawayId,
              channelId,
              user.id,
            );
            if (!claim.claimed) {
              await bot.answerCallbackQuery({
                callback_query_id: query.id,
                text: msgs.managementTaken,
                show_alert: true,
              });
              return;
            }
          }

          const title = channel?.title || channelId.toString();
          const activationMsgs = GIVEAWAY_ACTIVATION_MESSAGES[lang];
          const successReplyMarkup = giveaway
            ? {
                inline_keyboard: [
                  [
                    {
                      text: activationMsgs.manageButton,
                      url: buildManageGiveawayStartappUrl(
                        process.env.BOT_URL,
                        giveawayId,
                        user.id,
                        giveaway.createdById,
                      ),
                    },
                  ],
                ],
              }
            : undefined;
          await bot.answerCallbackQuery({ callback_query_id: query.id });
          if (query.message) {
            try {
              if ('caption' in query.message) {
                await bot.editMessageCaption({
                  chat_id: query.message.chat.id,
                  message_id: query.message.message_id,
                  caption: msgs.success(title),
                  parse_mode: 'HTML',
                  reply_markup: successReplyMarkup,
                });
              } else {
                await bot.editMessageText({
                  chat_id: query.message.chat.id,
                  message_id: query.message.message_id,
                  text: msgs.success(title),
                  parse_mode: 'HTML',
                  reply_markup: successReplyMarkup,
                });
              }
            } catch (_) {}
          }
        } else if (result.error === 'already_posted') {
          if (reservedLinkedPublication) {
            await releaseSharedChannelPublication(
              giveawayId,
              channelId,
              user.id,
            );
          }
          pendingSharedPublication = undefined;
          const claim = await getSharedChannelClaimant(giveawayId, channelId);
          if (claim && claim.userId !== user.id) {
            await bot.answerCallbackQuery({
              callback_query_id: query.id,
              text: msgs.managementTaken,
              show_alert: true,
            });
          } else {
            if (reservedSharedManagement) {
              await claimSharedChannelManagement(
                giveawayId,
                channelId,
                user.id,
              );
            }
            await bot.answerCallbackQuery({
              callback_query_id: query.id,
              text: msgs.alreadyPosted,
              show_alert: true,
            });
          }
        } else if (
          result.error === 'Bot cannot post messages to this channel'
        ) {
          if (reservedLinkedPublication) {
            await releaseSharedChannelPublication(
              giveawayId,
              channelId,
              user.id,
            );
          }
          pendingSharedPublication = undefined;
          if (reservedSharedManagement) {
            await releaseSharedChannelManagement(
              giveawayId,
              channelId,
              user.id,
            );
          }
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: msgs.botNeedsAdmin,
            show_alert: true,
          });
        } else {
          if (reservedLinkedPublication) {
            await releaseSharedChannelPublication(
              giveawayId,
              channelId,
              user.id,
            );
          }
          pendingSharedPublication = undefined;
          if (reservedSharedManagement) {
            await releaseSharedChannelManagement(
              giveawayId,
              channelId,
              user.id,
            );
          }
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: msgs.error,
            show_alert: true,
          });
        }
      } catch (err: any) {
        console.error('Error handling pl_ch: callback:', err);
        // Let the outer handler release any DB-backed claim/publication lock.
        throw err;
      }
      return;
    }

    // pl_cancel: cancel /postlot channel selection
    if (callbackData.startsWith('pl_cancel:')) {
      const telegramUserId = query.from.id;
      try {
        const user = await prisma.user.findFirst({
          where: { telegramId: telegramUserId.toString() },
          select: { picked_language: true, language_code: true },
        });
        const lang = getUserLanguage(
          user ?? { language_code: query.from.language_code },
        );
        const msgs = POSTLOT_MESSAGES[lang];
        await bot.answerCallbackQuery({ callback_query_id: query.id });
        if (query.message) {
          try {
            await bot.editMessageText({
              chat_id: query.message.chat.id,
              message_id: query.message.message_id,
              text: msgs.cancelled,
            });
          } catch (_) {}
        }
      } catch (err: any) {
        console.error('Error handling pl_cancel: callback:', err);
        await bot.answerCallbackQuery({
          callback_query_id: query.id,
          text: 'Error.',
          show_alert: true,
        });
      }
      return;
    }

    // Link-request callbacks: la: (accept), ld: (decline), lw: (withdraw)
    if (
      callbackData.startsWith('la:') ||
      callbackData.startsWith('ld:') ||
      callbackData.startsWith('lw:')
    ) {
      const action = callbackData.substring(0, 2); // 'la', 'ld', 'lw'
      const requestId = parseInt(callbackData.slice(3));
      const callerTelegramId = query.from.id.toString();

      const linkRequest = await prisma.linkRequest.findUnique({
        where: { id: requestId },
        include: {
          giveaway: {
            select: {
              id: true,
              createdById: true,
              language: true,
              startingAt: true,
              participiationType: true,
              createdBy: {
                select: {
                  telegramId: true,
                  first_name: true,
                  last_name: true,
                  username: true,
                  picked_language: true,
                  language_code: true,
                },
              },
            },
          },
          channel: { select: { title: true, username: true } },
          requester: {
            select: {
              telegramId: true,
              first_name: true,
              last_name: true,
              wallet: true,
              picked_language: true,
              language_code: true,
            },
          },
        },
      });

      if (!linkRequest) {
        await bot.answerCallbackQuery({
          callback_query_id: query.id,
          text: 'Request not found.',
          show_alert: true,
        });
        return;
      }

      const channelTitle = linkRequest.channel.title ?? '';
      const channelUsername = linkRequest.channel.username ?? null;
      const requester = linkRequest.requester;
      const creator = linkRequest.giveaway.createdBy;

      const requesterLang = getUserLanguage(requester);
      const creatorLang = creator ? getUserLanguage(creator) : requesterLang;
      const requesterMsgs = LINK_REQUEST_MESSAGES[requesterLang];
      const creatorMsgs = LINK_REQUEST_MESSAGES[creatorLang];

      // lw: sender withdraws
      if (action === 'lw') {
        if (requester.telegramId !== callerTelegramId) return;

        if (linkRequest.status !== 'Pending') {
          await bot.answerCallbackQuery({
            callback_query_id: query.id,
            text: requesterMsgs.alreadyResponded,
            show_alert: true,
          });
          return;
        }

        await prisma.$transaction(async (tx) => {
          await tx.linkRequest.update({
            where: { id: requestId },
            data: { status: 'Withdrawn' },
          });
          await refundLinkRequestWalletInTx(tx, {
            giveawayId: linkRequest.giveawayId,
            starsAmount: linkRequest.starsAmount,
            paidFromBalance: linkRequest.paidFromBalance,
            requesterId: linkRequest.requesterId,
            requester,
          });
        });

        if (!linkRequest.paidFromBalance) {
          await refundLinkRequestViaTelegram({
            giveawayId: linkRequest.giveawayId,
            starsAmount: linkRequest.starsAmount,
            paidFromBalance: linkRequest.paidFromBalance,
            requesterId: linkRequest.requesterId,
            requester,
          });
        }

        // Edit creator message
        if (linkRequest.creatorMessageId && creator?.telegramId) {
          const originalText = creatorMsgs.creatorRequest(
            requester.first_name,
            requester.last_name ?? null,
            channelTitle,
          );
          const remainingButtons: any[] = [];
          if (channelUsername)
            remainingButtons.push([
              { text: channelTitle, url: `https://t.me/${channelUsername}` },
            ]);
          remainingButtons.push([
            {
              text: creatorMsgs.creatorContactBtn,
              url: `tg://user?id=${requester.telegramId}`,
            },
          ]);
          await editLinkRequestMessage(
            creator.telegramId,
            linkRequest.creatorMessageId,
            originalText,
            creatorMsgs.creatorWithdrawnStatus,
            remainingButtons,
          );
        }

        // Edit sender message (the current message)
        if (
          query.message &&
          'chat' in query.message &&
          'text' in query.message &&
          query.message.text
        ) {
          try {
            await bot.editMessageText({
              chat_id: query.message.chat.id,
              message_id: query.message.message_id,
              text: `${query.message.text}\n\n<blockquote>${requesterMsgs.senderWithdrawnStatus}</blockquote>`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [] },
            });
          } catch (_) {}
        }

        await bot.answerCallbackQuery({ callback_query_id: query.id });
        return;
      }

      // la / ld: creator accepts or declines
      if (creator?.telegramId !== callerTelegramId) {
        await bot.answerCallbackQuery({
          callback_query_id: query.id,
          text: creatorMsgs.notCreator,
          show_alert: true,
        });
        return;
      }

      if (linkRequest.status !== 'Pending') {
        await bot.answerCallbackQuery({
          callback_query_id: query.id,
          text: creatorMsgs.alreadyResponded,
          show_alert: true,
        });
        return;
      }

      const originalCreatorText = creatorMsgs.creatorRequest(
        requester.first_name,
        requester.last_name ?? null,
        channelTitle,
      );
      const channelBtn = channelUsername
        ? [[{ text: channelTitle, url: `https://t.me/${channelUsername}` }]]
        : [];
      const contactCreatorBtn = creator?.username
        ? [
            [
              {
                text: requesterMsgs.senderContactBtn,
                url: `https://t.me/${creator.username}`,
              },
            ],
          ]
        : creator?.telegramId
          ? [
              [
                {
                  text: requesterMsgs.senderContactBtn,
                  url: `tg://user?id=${creator.telegramId}`,
                },
              ],
            ]
          : [];

      if (action === 'la') {
        // Accept — add channel, create SponsorApproval, notify both sides
        await prisma.$transaction(async (tx) => {
          await tx.linkRequest.update({
            where: { id: requestId },
            data: { status: 'Accepted' },
          });
          // Add channel to giveaway
          await tx.linkedChannels.upsert({
            where: {
              channelId_giveawayId: {
                channelId: linkRequest.channelId,
                giveawayId: linkRequest.giveawayId,
              },
            },
            create: {
              channelId: linkRequest.channelId,
              giveawayId: linkRequest.giveawayId,
            },
            update: {},
          });
          // Create SponsorApproval so the publish button works
          const trackingCode = generateTrackingCode(
            linkRequest.giveawayId,
            linkRequest.channelId,
          );
          await tx.sponsorApproval.upsert({
            where: {
              giveawayId_channelId_ownerUserId: {
                giveawayId: linkRequest.giveawayId,
                channelId: linkRequest.channelId,
                ownerUserId: linkRequest.requesterId,
              },
            },
            create: {
              giveawayId: linkRequest.giveawayId,
              channelId: linkRequest.channelId,
              ownerUserId: linkRequest.requesterId,
              trackingCode,
              status: SponsorApprovalStatus.Pending,
            },
            update: {},
          });
        });

        // Edit creator message (current message via bot)
        if (
          query.message &&
          'chat' in query.message &&
          'text' in query.message &&
          query.message.text
        ) {
          try {
            await bot.editMessageText({
              chat_id: query.message.chat.id,
              message_id: query.message.message_id,
              text: `${originalCreatorText}\n\n<blockquote>${creatorMsgs.creatorAcceptedStatus}</blockquote>`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  ...channelBtn,
                  [
                    {
                      text: creatorMsgs.creatorContactBtn,
                      url: `tg://user?id=${requester.telegramId}`,
                    },
                  ],
                ],
              },
            });
          } catch (_) {}
        }

        // Notify sender: accepted
        if (requester.telegramId) {
          const startDateStr = linkRequest.giveaway.startingAt
            ? new Date(linkRequest.giveaway.startingAt).toLocaleString(
                'uk-UA',
                {
                  timeZone: 'UTC',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                },
              )
            : '';
          const senderText = requesterMsgs.senderAccepted(
            requester.first_name,
            requester.last_name ?? null,
            channelTitle,
          );
          const senderStatusLine =
            requesterMsgs.senderAcceptedStartTime(startDateStr);
          try {
            if (linkRequest.senderMessageId) {
              await editLinkRequestMessage(
                requester.telegramId,
                linkRequest.senderMessageId,
                senderText,
                senderStatusLine,
                [...channelBtn, ...contactCreatorBtn],
              );
            }
          } catch (_) {}

          // Send the standard sendSponsorApprovalRequest so owner can publish
          try {
            const approvalRecord = await prisma.sponsorApproval.findFirst({
              where: {
                giveawayId: linkRequest.giveawayId,
                channelId: linkRequest.channelId,
                ownerUserId: linkRequest.requesterId,
              },
            });
            if (approvalRecord) {
              const giveawayType =
                linkRequest.giveaway.participiationType === 'Lottery'
                  ? 'lottery'
                  : 'random';
              await sendSponsorApprovalRequest(
                requester.telegramId,
                requester.first_name,
                requester.last_name ?? null,
                {
                  id: linkRequest.giveawayId,
                  type: giveawayType,
                  createdById: linkRequest.giveaway.createdById,
                },
                linkRequest.channelId,
                channelTitle,
                approvalRecord.id,
                getUserLanguage(requester),
                linkRequest.requesterId,
              );
            }
          } catch (err) {
            console.error('la: sendSponsorApprovalRequest error', err);
          }
        }

        await bot.answerCallbackQuery({ callback_query_id: query.id });
      } else if (action === 'ld') {
        // Decline — refund stars
        await prisma.$transaction(async (tx) => {
          await tx.linkRequest.update({
            where: { id: requestId },
            data: { status: 'Declined' },
          });
          await refundLinkRequestWalletInTx(tx, {
            giveawayId: linkRequest.giveawayId,
            starsAmount: linkRequest.starsAmount,
            paidFromBalance: linkRequest.paidFromBalance,
            requesterId: linkRequest.requesterId,
            requester,
          });
        });

        if (!linkRequest.paidFromBalance) {
          await refundLinkRequestViaTelegram({
            giveawayId: linkRequest.giveawayId,
            starsAmount: linkRequest.starsAmount,
            paidFromBalance: linkRequest.paidFromBalance,
            requesterId: linkRequest.requesterId,
            requester,
          });
        }

        // Edit creator message (current)
        if (
          query.message &&
          'chat' in query.message &&
          'text' in query.message &&
          query.message.text
        ) {
          try {
            await bot.editMessageText({
              chat_id: query.message.chat.id,
              message_id: query.message.message_id,
              text: `${originalCreatorText}\n\n<blockquote>${creatorMsgs.creatorDeclinedStatus}</blockquote>`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  ...channelBtn,
                  [
                    {
                      text: creatorMsgs.creatorContactBtn,
                      url: `tg://user?id=${requester.telegramId}`,
                    },
                  ],
                ],
              },
            });
          } catch (_) {}
        }

        // Notify sender: declined
        if (requester.telegramId && linkRequest.senderMessageId) {
          const senderText = requesterMsgs.senderDeclined(
            requester.first_name,
            requester.last_name ?? null,
          );
          try {
            await editLinkRequestMessage(
              requester.telegramId,
              linkRequest.senderMessageId,
              senderText,
              requesterMsgs.senderDeclinedRefund,
              [...channelBtn, ...contactCreatorBtn],
            );
          } catch (_) {}
        }

        await bot.answerCallbackQuery({ callback_query_id: query.id });
      }

      return;
    }

    // Check if this is a sponsor publish callback
    if (!callbackData.startsWith('sponsor_publish:')) {
      return;
    }

    const approvalId = parseInt(callbackData.split(':')[1]);
    const telegramUserId = query.from.id;

    console.log(
      `Sponsor publish callback: approvalId=${approvalId}, user=${telegramUserId}`,
    );

    // Fetch approval record by ID
    const approval = await prisma.sponsorApproval.findUnique({
      where: { id: approvalId },
      include: {
        giveaway: {
          select: {
            id: true,
            createdById: true,
            participiationType: true,
            language: true,
            isActive: true,
            isCancelled: true,
          },
        },
        owner: {
          select: {
            id: true,
            telegramId: true,
            picked_language: true,
            language_code: true,
          },
        },
      },
    });

    if (!approval) {
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: 'Approval request not found.',
        show_alert: true,
      });
      return;
    }

    // Verify user is the owner
    if (approval.owner.telegramId !== telegramUserId.toString()) {
      const lang = getUserLanguage(approval.owner);
      const messages = SPONSOR_APPROVAL_MESSAGES[lang];
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: messages.notOwner,
        show_alert: true,
      });
      return;
    }

    const liveOwner = await prisma.addedBy.findFirst({
      where: {
        channelId: approval.channelId,
        userId: approval.ownerUserId,
      },
    });
    if (!liveOwner) {
      const lang = getUserLanguage(approval.owner);
      const messages = SPONSOR_APPROVAL_MESSAGES[lang];
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: messages.notOwner,
        show_alert: true,
      });
      return;
    }

    const lang = getUserLanguage(approval.owner);
    const messages = SPONSOR_APPROVAL_MESSAGES[lang];

    // Check the durable claimant before status so historical Rejected/Approved
    // messages from another admin are also converted to the locked DM state.
    const currentClaimant = await getSharedChannelClaimant(
      approval.giveawayId,
      approval.channelId,
    );
    if (currentClaimant && currentClaimant.userId !== approval.ownerUserId) {
      await rejectAndLockSponsorApproval(approvalId, currentClaimant.userId);
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: messages.managementTakenAlert,
        show_alert: true,
      });
      return;
    }

    // Check if already responded
    if (approval.status !== SponsorApprovalStatus.Pending) {
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: messages.alreadyResponded,
        show_alert: true,
      });
      return;
    }

    // Check if giveaway is still active
    if (!approval.giveaway.isActive || approval.giveaway.isCancelled) {
      const giveawayType =
        approval.giveaway.participiationType === 'Lottery'
          ? 'lottery'
          : 'random';
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: messages.expiredRequest(giveawayType),
        show_alert: true,
      });
      return;
    }

    // Atomically reserve management BEFORE the Telegram side effect.
    const reservation = await claimSharedChannelManagement(
      approval.giveawayId,
      approval.channelId,
      approval.ownerUserId,
      { finalize: false },
    );
    if (!reservation.claimed) {
      await rejectAndLockSponsorApproval(
        approvalId,
        reservation.alreadyClaimedBy,
      );
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: messages.managementTakenAlert,
        show_alert: true,
      });
      return;
    }

    const publicationReserved = await reserveSharedChannelPublication(
      approval.giveawayId,
      approval.channelId,
      approval.ownerUserId,
    );
    if (!publicationReserved) {
      const existingMessage = await prisma.giveawayMessage.findFirst({
        where: {
          giveawayId: approval.giveawayId,
          channelId: approval.channelId,
        },
        select: { id: true },
      });
      if (existingMessage) {
        await claimSharedChannelManagement(
          approval.giveawayId,
          approval.channelId,
          approval.ownerUserId,
        );
      }
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: messages.alreadyResponded,
        show_alert: true,
      });
      return;
    }
    pendingSharedPublication = {
      giveawayId: approval.giveawayId,
      channelId: approval.channelId,
      userId: approval.ownerUserId,
    };

    // Post giveaway to sponsor channel
    const result = await postGiveawayToSponsorChannel(
      approval.giveawayId,
      approval.channelId,
      approval.trackingCode,
    );

    const giveawayType =
      approval.giveaway.participiationType === 'Lottery' ? 'lottery' : 'random';

    if (
      result.success ||
      result.error === 'already_posted' ||
      result.error === 'posted_but_not_saved'
    ) {
      if (result.error !== 'posted_but_not_saved') {
        await releaseSharedChannelPublication(
          approval.giveawayId,
          approval.channelId,
          approval.ownerUserId,
        );
      }
      pendingSharedPublication = undefined;
      const claim = await claimSharedChannelManagement(
        approval.giveawayId,
        approval.channelId,
        approval.ownerUserId,
      );

      if (!claim.claimed) {
        await rejectAndLockSponsorApproval(approvalId, claim.alreadyClaimedBy);
        await bot.answerCallbackQuery({
          callback_query_id: query.id,
          text: messages.managementTakenAlert,
          show_alert: true,
        });
        return;
      }

      // Ensure this approval is Approved (claim also does updateMany)
      await prisma.sponsorApproval.update({
        where: { id: approvalId },
        data: {
          status: SponsorApprovalStatus.Approved,
          respondedAt: new Date(),
        },
      });

      // Edit message to show published status
      if (query.message && 'chat' in query.message) {
        try {
          const manageUrl = buildManageGiveawayStartappUrl(
            process.env.BOT_URL,
            approval.giveaway.id,
            approval.ownerUserId,
            approval.giveaway.createdById,
          );

          const msg = query.message;

          // Update message text or caption
          if ('text' in msg && msg.text) {
            await bot.editMessageText({
              chat_id: msg.chat.id,
              message_id: msg.message_id,
              text: msg.text + `\n\n${messages.publishedStatus}`,
              parse_mode: 'HTML',
            });
          } else if ('caption' in msg) {
            await bot.editMessageCaption({
              chat_id: msg.chat.id,
              message_id: msg.message_id,
              caption: (msg.caption || '') + `\n\n${messages.publishedStatus}`,
              parse_mode: 'HTML',
            });
          }

          // Create NEW keyboard with ONLY Management button
          await bot.editMessageReplyMarkup({
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: messages.manageButton,
                    url: manageUrl,
                  },
                ],
              ],
            },
          });
        } catch (editError) {
          console.error('Error editing approval message:', editError);
        }
      }

      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: messages.publishedResponse(giveawayType),
        show_alert: false,
      });

      console.log(
        `Posted giveaway ${approval.giveawayId} to sponsor channel ${approval.channelId}`,
      );
    } else {
      await releaseSharedChannelPublication(
        approval.giveawayId,
        approval.channelId,
        approval.ownerUserId,
      );
      await releaseSharedChannelManagement(
        approval.giveawayId,
        approval.channelId,
        approval.ownerUserId,
      );
      pendingSharedPublication = undefined;
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: result.error || 'Failed to publish announcement',
        show_alert: true,
      });

      console.error(
        `Failed to post giveaway ${approval.giveawayId} to sponsor channel ${approval.channelId}: ${result.error}`,
      );
    }
  } catch (error: any) {
    if (pendingSharedPublication) {
      const pending = pendingSharedPublication;
      try {
        const durablePost = await prisma.giveawayMessage.findFirst({
          where: {
            giveawayId: pending.giveawayId,
            channelId: pending.channelId,
          },
          select: { id: true },
        });

        await releaseSharedChannelPublication(
          pending.giveawayId,
          pending.channelId,
          pending.userId,
        );
        if (!durablePost) {
          await releaseSharedChannelManagement(
            pending.giveawayId,
            pending.channelId,
            pending.userId,
          );
        }
      } catch (cleanupError) {
        console.error(
          '[SharedClaim] Failed to clean up callback reservation:',
          cleanupError,
        );
      }
    }
    console.error('Error handling bot callback:', error);

    try {
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: 'An error occurred. Please try again.',
        show_alert: true,
      });
    } catch (answerError) {
      console.error('Error answering callback query:', answerError);
    }
  }
});

// Business account connection handler
// Fires when a Telegram Business account connects or disconnects this bot.
// Saves the connection ID to the admin user's DB record so gift operations
// can look it up without a hardcoded env var.
// Only active when GIFT_PROVIDER=business; userbot mode handles gifts via MTProto.
if (process.env.GIFT_PROVIDER === 'business')
  bot.on('business_connection', async (conn) => {
    const telegramId = conn.user.id.toString();
    try {
      if (conn.is_enabled) {
        // Detect which business account type connected based on known Telegram user IDs
        const standardId = process.env.BUSINESS_ACCOUNT_STANDARD_ID;
        const uniqueId = process.env.BUSINESS_ACCOUNT_UNIQUE_ID;
        let accountType: 'Standard' | 'Unique' | null = null;
        if (standardId && telegramId === standardId) accountType = 'Standard';
        else if (uniqueId && telegramId === uniqueId) accountType = 'Unique';

        if (!accountType) {
          console.warn(
            `[Business] Connection from unknown Telegram user ${telegramId} — ignored`,
          );
          return;
        }

        let user = await prisma.user.findFirst({
          where: { telegramId },
          select: { id: true },
        });
        if (!user) {
          user = await prisma.user.create({
            data: {
              telegramId,
              first_name: conn.user.first_name ?? '',
              username: conn.user.username,
              roleId: 2,
              wallet: { create: {} },
            },
            select: { id: true },
          });
          console.log(
            `[Business] Created user record for Telegram ID ${telegramId}`,
          );
        }
        await prisma.user.update({
          where: { id: user.id },
          data: {
            businessConnectionId: conn.id,
            businessAccountType: accountType,
          },
        });
        console.log(
          `[Business] Connection "${conn.id}" saved for Telegram user ${telegramId} (type: ${accountType})`,
        );
      } else {
        await prisma.user.updateMany({
          where: { telegramId },
          data: { businessConnectionId: null, businessAccountType: null },
        });
        console.log(
          `[Business] Connection "${conn.id}" cleared for user ${telegramId}`,
        );
      }
    } catch (err) {
      console.error(
        '[Business] Error handling business_connection event:',
        err,
      );
    }
  });

// Business account message handler
// Triggered when someone sends a message to the bot's business account.
// Guard: only process messages for a connection belonging to an admin in our DB.
// Retry any Cooldown prizes waiting for this sender.
// If the message contains a gift, sync new deposits from the business account.
// Only active when GIFT_PROVIDER=business; userbot mode handles this via message-listener.ts.
if (process.env.GIFT_PROVIDER === 'business')
  bot.on('business_message', async (msg) => {
    const connectionId = (msg as any).business_connection_id as
      | string
      | undefined;
    if (!connectionId) return;

    // Look up the connection owner and account type
    const owner = await prisma.user.findFirst({
      where: { businessConnectionId: connectionId },
      select: { id: true, businessAccountType: true },
    });
    if (!owner) return;

    const senderTelegramId = msg.from?.id?.toString();
    if (!senderTelegramId) return;

    if (owner.businessAccountType === 'Unique') {
      // Unique account: only receives NFT deposits — sync when a gift arrives
      const hasGift = !!(msg as any).gift || !!(msg as any).unique_gift;
      if (hasGift) {
        try {
          await prizeService.syncDepositedGifts(senderTelegramId, connectionId);
        } catch (error) {
          console.error(
            '[Gifts] Error syncing deposits for user:',
            senderTelegramId,
            error,
          );
        }
      }
    } else if (owner.businessAccountType === 'Standard') {
      // Standard account: user started chat — retry any cooldown StandardGift prizes
      try {
        await prizeService.retryPrizesForUser(senderTelegramId);
      } catch (error) {
        console.error(
          '[Gifts] Error retrying cooldown prizes for user:',
          senderTelegramId,
          error,
        );
      }
    }
  });

console.log('Бот запущен...');

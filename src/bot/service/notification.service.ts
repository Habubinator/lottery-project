import { prisma, NotificationSetting, GiveawayStartType } from '@database';
import { sendPhoto, sendAnimation, sendMessage, sendMediaGroup, getBusinessUsername, toAbsoluteUrl, isGifUrl } from './bot.service';
import {
  getUserLanguage,
  GIVEAWAY_CREATION_MESSAGES,
  WIN_MESSAGES,
  WINNER_REPLACEMENT_MESSAGES,
  WINNER_REMOVAL_MESSAGES,
  ADVERTISING_APPLIED_MESSAGES,
  GIFT_PRIZE_MESSAGES,
} from './localization';
import { formatUniqueGiftNftHtml } from '../../common/utils/gift-nft-link.util';

const WEBAPP_URL = process.env.BOT_URL || 'https://your-webapp-url.com';

interface Channel {
  id: bigint;
  title: string;
  username: string | null;
  inviteLink: string | null;
}

/**
 * Paid broadcast path: FromAll users who do NOT have any of this giveaway's
 * posting channels in their personal list. Channel-list users are notified via
 * notifyChannelSubscribers; excluding them here prevents double notifications
 * when isNotificationOn is enabled (including multi-channel giveaways).
 */
async function getUsersForPaidBroadcast(
  postingChannelIds: bigint[],
): Promise<string[]> {
  if (postingChannelIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      isBanned: false,
      notificationList: NotificationSetting.FromAll,
      notificationChannels: { none: { channelId: { in: postingChannelIds } } },
    },
    select: { telegramId: true },
  });
  return users.map((u) => u.telegramId);
}

/**
 * Always-notify path: any non-NoOne user who has this channel in their list.
 * Fired on every giveaway activation regardless of isNotificationOn.
 */
async function getUsersWithChannelInList(channelId: bigint): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      isBanned: false,
      notificationList: { not: NotificationSetting.NoOne },
      notificationChannels: { some: { channelId } },
    },
    select: { telegramId: true },
  });
  return users.map((u) => u.telegramId);
}

/**
 * Get giveaway data with channels
 */
async function getGiveawayWithChannels(giveawayId: string) {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    include: {
      linkedChannels: {
        where: { role: { in: ['All', 'Posting'] } },
        include: { channel: true },
      },
    },
  });

  if (!giveaway) return null;

  const channels = giveaway.linkedChannels.map((lc) => ({
    id: lc.channel.id,
    title: lc.channel.title || 'Канал',
    username: lc.channel.username,
    inviteLink: lc.channel.inviteLink,
  }));

  return { giveaway, channels };
}

/**
 * Create inline keyboard with webapp and channel buttons
 * Note: Only includes channels with valid URLs (inviteLink or username)
 * t.me/c/ links require message IDs and can't be used in inline keyboards without them
 */
function createInlineKeyboard(
  webappLink: string,
  buttonText: string,
  channels: Channel[],
) {
  // Filter out channels without valid URLs
  const validChannelButtons = channels
    .filter((ch) => ch.inviteLink || ch.username)
    .map((ch) => {
      const url = ch.inviteLink || `https://t.me/${ch.username}`;
      return [
        {
          text: ch.title,
          url,
        },
      ];
    });

  return {
    inline_keyboard: [
      [{ text: buttonText, url: webappLink }],
      ...validChannelButtons,
    ],
  };
}

/**
 * Format user name with bold HTML tags
 */
function formatUserName(firstName: string, lastName: string | null): string {
  return `<b>${firstName}${lastName ? ' ' + lastName : ''}</b>`;
}

/**
 * Create channel links HTML
 */
function createChannelLinks(channels: Channel[]): string {
  return channels
    .map((ch) =>
      ch.username
        ? `<a href="https://t.me/${ch.username}">${ch.title}</a>`
        : ch.title,
    )
    .join(', ');
}

/**
 * Generic function to send giveaway creation notifications
 */
async function sendGiveawayCreationNotification(
  giveawayId: string,
  messageType: GiveawayStartType,
  audience: 'channel-list' | 'paid-broadcast',
): Promise<void> {
  try {
    const data = await getGiveawayWithChannels(giveawayId);
    if (!data) {
      console.error(`Giveaway ${giveawayId} not found`);
      return;
    }

    const { giveaway, channels } = data;

    if (channels.length === 0) {
      console.log('No channels to notify about');
      return;
    }

    const allUserIds = new Set<string>();
    if (audience === 'channel-list') {
      for (const channel of channels) {
        const userIds = await getUsersWithChannelInList(channel.id);
        userIds.forEach((id) => allUserIds.add(id));
      }
    } else {
      const userIds = await getUsersForPaidBroadcast(channels.map((c) => c.id));
      userIds.forEach((id) => allUserIds.add(id));
    }

    if (allUserIds.size === 0) {
      console.log('No users to notify');
      return;
    }

    const webappLink = `${WEBAPP_URL}?startapp=giveawayId_${giveawayId}`;
    const messageTypeKey =
      messageType === GiveawayStartType.Lottery ? 'lottery' : 'random';

    // Send notification to each user
    const promises = Array.from(allUserIds).map(async (telegramId) => {
      try {
        const user = await prisma.user.findFirst({
          where: { telegramId },
          select: {
            first_name: true,
            last_name: true,
            picked_language: true,
            language_code: true,
          },
        });

        if (!user) return;

        // Get user's language and corresponding translations
        const userLang = getUserLanguage(user);
        const translations =
          GIVEAWAY_CREATION_MESSAGES[messageTypeKey][userLang];

        const userName = formatUserName(user.first_name, user.last_name);
        const channelLinks = createChannelLinks(channels);
        const caption = translations.caption(userName, channelLinks);
        const inlineKeyboard = createInlineKeyboard(
          webappLink,
          translations.buttonText,
          channels,
        );
        console.log(JSON.stringify(inlineKeyboard), webappLink);

        // Send photo/media group if banner exists, otherwise send text message
        const banners = giveaway.banner || [];
        const validBanners = banners.filter((b: string) => b && b.trim() !== '');

        if (validBanners.length === 0) {
          // No banners: Send text
          await sendMessage(telegramId, caption, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: inlineKeyboard,
          });
        } else if (validBanners.length === 1) {
          // Single banner: Send photo
          await sendPhoto(telegramId, validBanners[0], caption, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: inlineKeyboard,
          });
        } else {
          // Multiple banners: Send media group WITHOUT caption, then text WITH buttons
          const mediaGroupResult = await sendMediaGroup(
            BigInt(telegramId),
            validBanners,
            undefined,
            {
              parse_mode: 'HTML',
              disable_notification: false,
            },
          );

          if (mediaGroupResult.success) {
            await sendMessage(telegramId, caption, {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: inlineKeyboard,
            });
          } else {
            console.error(
              `Failed to send media group to ${telegramId}: ${mediaGroupResult.error}`,
            );
          }
        }
      } catch (error) {
        console.error(`Failed to send notification to ${telegramId}:`, error);
      }
    });

    await Promise.all(promises);
    console.log(
      `Sent ${messageTypeKey} creation notifications to ${allUserIds.size} users`,
    );
  } catch (error) {
    console.error(
      `Error sending ${messageType} creation notifications:`,
      error,
    );
  }
}

/**
 * Send notification about new lottery creation
 */
export async function notifyLotteryCreated(giveawayId: string): Promise<void> {
  await sendGiveawayCreationNotification(
    giveawayId,
    GiveawayStartType.Lottery,
    'paid-broadcast',
  );
}

/**
 * Send notification about new random giveaway creation
 */
export async function notifyRandomGiveawayCreated(
  giveawayId: string,
): Promise<void> {
  await sendGiveawayCreationNotification(
    giveawayId,
    GiveawayStartType.Random,
    'paid-broadcast',
  );
}

/**
 * Always-path: notify users who have the giveaway's channel(s) in their personal list.
 * Called on every activation regardless of isNotificationOn.
 */
export async function notifyChannelSubscribers(giveawayId: string): Promise<void> {
  try {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: { participiationType: true },
    });
    if (!giveaway) return;
    const messageType =
      giveaway.participiationType === GiveawayStartType.Lottery
        ? GiveawayStartType.Lottery
        : GiveawayStartType.Random;
    await sendGiveawayCreationNotification(
      giveawayId,
      messageType,
      'channel-list',
    );
  } catch (error) {
    console.error('Error in notifyChannelSubscribers:', error);
  }
}

/**
 * Generic function to send win notifications
 */
async function sendWinNotification(
  userId: number,
  giveawayId: string,
  messageType: 'lottery' | 'random',
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        telegramId: true,
        first_name: true,
        last_name: true,
        picked_language: true,
        language_code: true,
      },
    });

    if (!user) {
      console.error(`User ${userId} not found`);
      return;
    }

    const data = await getGiveawayWithChannels(giveawayId);
    if (!data) {
      console.error(`Giveaway ${giveawayId} not found`);
      return;
    }

    const { giveaway, channels } = data;

    // Get user's language and corresponding translations
    const userLang = getUserLanguage(user);
    const translations = WIN_MESSAGES[messageType][userLang];
    const giftMsgs = GIFT_PRIZE_MESSAGES[userLang];

    const userName = formatUserName(user.first_name, user.last_name);

    // Check if this winner has a prize to claim
    const wonPrize = await prisma.giveawayPrize.findFirst({
      where: { giveawayId, winnerUserId: userId, status: 'ReadyToClaim' },
      select: {
        id: true,
        giftName: true,
        giftNumber: true,
        giftNftName: true,
        prizeType: true,
      },
    });

    let caption = translations.caption(userName);
    if (wonPrize) {
      const prizeDisplay =
        wonPrize.prizeType === 'StandardGift'
          ? (wonPrize.giftName ?? '🎁')
          : formatUniqueGiftNftHtml(wonPrize);
      caption += `\n\n${giftMsgs.yourGift} ${prizeDisplay}`;
    }

    const webappLink = `${WEBAPP_URL}?startapp=resultsId_${giveawayId}`;
    const baseKeyboard = createInlineKeyboard(webappLink, translations.buttonText, channels);

    // Add "Claim Gift" button as second row when winner has a prize
    // For StandardGift: also add "Write to gift bank" button (prior chat required for sendGift)
    let inlineKeyboard = baseKeyboard;
    if (wonPrize) {
      const extraRows: { text: string; url: string }[][] = [
        [{ text: giftMsgs.claimGift, url: `${WEBAPP_URL}?startapp=gifts` }],
      ];
      if (wonPrize.prizeType === 'StandardGift') {
        const businessUsername = await getBusinessUsername().catch(() => null);
        if (businessUsername) {
          extraRows.push([{ text: giftMsgs.writeToGiftBank, url: `https://t.me/${businessUsername}` }]);
        }
      }
      inlineKeyboard = { inline_keyboard: [...baseKeyboard.inline_keyboard, ...extraRows] };
    }

    // Send photo/media group if banner exists, otherwise send text message
    const banners = giveaway.banner || [];
    const validBanners = banners.filter((b: string) => b && b.trim() !== '');

    if (validBanners.length === 0) {
      // No banners: Send text
      await sendMessage(user.telegramId, caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });
    } else if (validBanners.length === 1) {
      // Single banner: Send photo or animation (GIF)
      const bannerUrl = toAbsoluteUrl(validBanners[0]);
      if (isGifUrl(bannerUrl)) {
        await sendAnimation(user.telegramId, bannerUrl, caption, {
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard,
        });
      } else {
        await sendPhoto(user.telegramId, bannerUrl, caption, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: inlineKeyboard,
        });
      }
    } else {
      // Multiple banners: Send media group WITHOUT caption, then text WITH buttons
      const mediaGroupResult = await sendMediaGroup(
        BigInt(user.telegramId),
        validBanners.map(toAbsoluteUrl),
        undefined,
        {
          parse_mode: 'HTML',
          disable_notification: false,
        },
      );

      if (mediaGroupResult.success) {
        await sendMessage(user.telegramId, caption, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: inlineKeyboard,
        });
      } else {
        console.error(
          `Failed to send media group to ${user.telegramId}: ${mediaGroupResult.error}`,
        );
      }
    }

    console.log(`Sent ${messageType} win notification to user ${userId}`);
  } catch (error) {
    console.error(
      `Error sending ${messageType} win notification to user ${userId}:`,
      error,
    );
  }
}

/**
 * Send notification about lottery win
 */
export async function notifyLotteryWin(
  userId: number,
  giveawayId: string,
): Promise<void> {
  await sendWinNotification(userId, giveawayId, 'lottery');
}

/**
 * Send notification about random giveaway win
 */
export async function notifyRandomGiveawayWin(
  userId: number,
  giveawayId: string,
): Promise<void> {
  await sendWinNotification(userId, giveawayId, 'random');
}

/**
 * Send notifications to all winners of a giveaway
 * @param giveawayId - The giveaway ID
 */
export async function notifyAllWinners(giveawayId: string): Promise<void> {
  try {
    // Get giveaway type to determine notification style
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: {
        participiationType: true,
        createdBy: {
          select: { picked_language: true, language_code: true },
        },
      },
    });

    if (!giveaway) {
      console.error(`Giveaway ${giveawayId} not found`);
      return;
    }

    const participants = await prisma.participant.findMany({
      where: {
        giveawayId,
        isWinner: true,
      },
      select: {
        userId: true,
        winPlace: true,
      },
    });

    if (participants.length === 0) {
      console.log('No winners to notify');
      return;
    }

    // DEDUPLICATION: Get unique user IDs
    const uniqueUserIds = new Set<number>();
    participants.forEach((participant) => {
      uniqueUserIds.add(participant.userId);
    });

    console.log(
      `Found ${participants.length} winning participations from ${uniqueUserIds.size} unique users`,
    );

    // Send appropriate notification based on giveaway type (only to unique users)
    const promises = Array.from(uniqueUserIds).map((userId) => {
      if (giveaway.participiationType === GiveawayStartType.Lottery) {
        return notifyLotteryWin(userId, giveawayId);
      } else {
        return notifyRandomGiveawayWin(userId, giveawayId);
      }
    });

    await Promise.all(promises);
    console.log(`Sent win notifications to ${uniqueUserIds.size} unique winners`);
  } catch (error) {
    console.error('Error sending win notifications:', error);
  }
}

/**
 * Send notification about winner replacement (to old winner)
 * @param userId - The user ID of the old winner
 * @param giveawayId - The giveaway ID
 */
export async function notifyWinnerReplaced(
  userId: number,
  giveawayId: string,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        telegramId: true,
        first_name: true,
        last_name: true,
        picked_language: true,
        language_code: true,
      },
    });

    if (!user) {
      console.error(`User ${userId} not found`);
      return;
    }

    const data = await getGiveawayWithChannels(giveawayId);
    if (!data) {
      console.error(`Giveaway ${giveawayId} not found`);
      return;
    }

    const { giveaway, channels } = data;

    // Determine message type based on giveaway type
    const messageType =
      giveaway.participiationType === GiveawayStartType.Lottery
        ? 'lottery'
        : 'random';

    // Get user's language and corresponding translations
    const userLang = getUserLanguage(user);
    const translations =
      WINNER_REPLACEMENT_MESSAGES.oldWinner[messageType][userLang];

    const userName = formatUserName(user.first_name, user.last_name);
    const caption = translations.caption(userName);

    const webappLink = `${WEBAPP_URL}?startapp=resultsId_${giveawayId}`;
    const inlineKeyboard = createInlineKeyboard(
      webappLink,
      translations.buttonText,
      channels,
    );

    // Send photo/media group if banner exists, otherwise send text message
    const banners = giveaway.banner || [];
    const validBanners = banners.filter((b: string) => b && b.trim() !== '');

    if (validBanners.length === 0) {
      // No banners: Send text
      await sendMessage(user.telegramId, caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });
    } else if (validBanners.length === 1) {
      // Single banner: Send photo
      await sendPhoto(user.telegramId, validBanners[0], caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });
    } else {
      // Multiple banners: Send media group WITHOUT caption, then text WITH buttons
      const mediaGroupResult = await sendMediaGroup(
        BigInt(user.telegramId),
        validBanners,
        undefined,
        {
          parse_mode: 'HTML',
          disable_notification: false,
        },
      );

      if (mediaGroupResult.success) {
        await sendMessage(user.telegramId, caption, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: inlineKeyboard,
        });
      } else {
        console.error(
          `Failed to send media group to ${user.telegramId}: ${mediaGroupResult.error}`,
        );
      }
    }

    console.log(`Sent winner replacement notification to user ${userId}`);
  } catch (error) {
    console.error(
      `Error sending winner replacement notification to user ${userId}:`,
      error,
    );
  }
}

/**
 * Send notification about being selected as new winner (to new winner)
 * @param userId - The user ID of the new winner
 * @param giveawayId - The giveaway ID
 * @param place - The place number (for lottery)
 */
export async function notifyNewWinnerSelected(
  userId: number,
  giveawayId: string,
  place?: number,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        telegramId: true,
        first_name: true,
        last_name: true,
        picked_language: true,
        language_code: true,
      },
    });

    if (!user) {
      console.error(`User ${userId} not found`);
      return;
    }

    const data = await getGiveawayWithChannels(giveawayId);
    if (!data) {
      console.error(`Giveaway ${giveawayId} not found`);
      return;
    }

    const { giveaway, channels } = data;

    // Determine message type based on giveaway type
    const messageType =
      giveaway.participiationType === GiveawayStartType.Lottery
        ? 'lottery'
        : 'random';

    // Get user's language and corresponding translations
    const userLang = getUserLanguage(user);
    const translations =
      WINNER_REPLACEMENT_MESSAGES.newWinner[messageType][userLang];

    const userName = formatUserName(user.first_name, user.last_name);
    const giftMsgs = GIFT_PRIZE_MESSAGES[userLang];

    const wonPrize = await prisma.giveawayPrize.findFirst({
      where: {
        giveawayId,
        winnerUserId: userId,
        status: 'ReadyToClaim',
      },
      select: {
        id: true,
        giftName: true,
        giftNumber: true,
        giftNftName: true,
        prizeType: true,
      },
    });

    let caption = translations.caption(userName, place);
    if (wonPrize) {
      const prizeDisplay =
        wonPrize.prizeType === 'StandardGift'
          ? (wonPrize.giftName ?? '🎁')
          : formatUniqueGiftNftHtml(wonPrize);
      caption += `\n\n${giftMsgs.yourGift} ${prizeDisplay}`;
    }

    const webappLink = `${WEBAPP_URL}?startapp=resultsId_${giveawayId}`;
    const baseKeyboard = createInlineKeyboard(
      webappLink,
      translations.buttonText,
      channels,
    );

    let inlineKeyboard = baseKeyboard;
    if (wonPrize) {
      const extraRows: { text: string; url: string }[][] = [
        [{ text: giftMsgs.claimGift, url: `${WEBAPP_URL}?startapp=gifts` }],
      ];
      if (wonPrize.prizeType === 'StandardGift') {
        const businessUsername = await getBusinessUsername().catch(() => null);
        if (businessUsername) {
          extraRows.push([
            {
              text: giftMsgs.writeToGiftBank,
              url: `https://t.me/${businessUsername}`,
            },
          ]);
        }
      }
      inlineKeyboard = {
        inline_keyboard: [...baseKeyboard.inline_keyboard, ...extraRows],
      };
    }

    // Send photo/media group if banner exists, otherwise send text message
    const banners = giveaway.banner || [];
    const validBanners = banners.filter((b: string) => b && b.trim() !== '');

    if (validBanners.length === 0) {
      // No banners: Send text
      await sendMessage(user.telegramId, caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });
    } else if (validBanners.length === 1) {
      // Single banner: Send photo
      await sendPhoto(user.telegramId, validBanners[0], caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });
    } else {
      // Multiple banners: Send media group WITHOUT caption, then text WITH buttons
      const mediaGroupResult = await sendMediaGroup(
        BigInt(user.telegramId),
        validBanners,
        undefined,
        {
          parse_mode: 'HTML',
          disable_notification: false,
        },
      );

      if (mediaGroupResult.success) {
        await sendMessage(user.telegramId, caption, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: inlineKeyboard,
        });
      } else {
        console.error(
          `Failed to send media group to ${user.telegramId}: ${mediaGroupResult.error}`,
        );
      }
    }

    console.log(`Sent new winner selection notification to user ${userId}`);
  } catch (error) {
    console.error(
      `Error sending new winner selection notification to user ${userId}:`,
      error,
    );
  }
}

/**
 * Send notification about winner removal
 * @param userId - The user ID of the removed winner
 * @param giveawayId - The giveaway ID
 * @param place - The place number (for lottery)
 */
export async function notifyWinnerRemoved(
  userId: number,
  giveawayId: string,
  place?: number,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        telegramId: true,
        first_name: true,
        last_name: true,
        picked_language: true,
        language_code: true,
      },
    });

    if (!user) {
      console.error(`User ${userId} not found`);
      return;
    }

    const data = await getGiveawayWithChannels(giveawayId);
    if (!data) {
      console.error(`Giveaway ${giveawayId} not found`);
      return;
    }

    const { giveaway, channels } = data;

    // Determine message type based on giveaway type
    const messageType =
      giveaway.participiationType === GiveawayStartType.Lottery
        ? 'lottery'
        : 'random';

    // Get user's language and corresponding translations
    const userLang = getUserLanguage(user);
    const translations = WINNER_REMOVAL_MESSAGES[messageType][userLang];

    const userName = formatUserName(user.first_name, user.last_name);
    const caption = translations.caption(userName, place);

    const webappLink = `${WEBAPP_URL}?startapp=resultsId_${giveawayId}`;
    const inlineKeyboard = createInlineKeyboard(
      webappLink,
      translations.buttonText,
      channels,
    );

    // Send photo/media group if banner exists, otherwise send text message
    const banners = giveaway.banner || [];
    const validBanners = banners.filter((b: string) => b && b.trim() !== '');

    if (validBanners.length === 0) {
      // No banners: Send text
      await sendMessage(user.telegramId, caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });
    } else if (validBanners.length === 1) {
      // Single banner: Send photo
      await sendPhoto(user.telegramId, validBanners[0], caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });
    } else {
      // Multiple banners: Send media group WITHOUT caption, then text WITH buttons
      const mediaGroupResult = await sendMediaGroup(
        BigInt(user.telegramId),
        validBanners,
        undefined,
        {
          parse_mode: 'HTML',
          disable_notification: false,
        },
      );

      if (mediaGroupResult.success) {
        await sendMessage(user.telegramId, caption, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: inlineKeyboard,
        });
      } else {
        console.error(
          `Failed to send media group to ${user.telegramId}: ${mediaGroupResult.error}`,
        );
      }
    }

    console.log(`Sent winner removal notification to user ${userId}`);
  } catch (error) {
    console.error(
      `Error sending winner removal notification to user ${userId}:`,
      error,
    );
  }
}

/**
 * Main notification handler - decides which type of notification to send based on giveaway type
 * @param giveawayId - The giveaway ID
 */
export async function notifyGiveawayCreated(giveawayId: string): Promise<void> {
  try {
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: {
        participiationType: true,
        createdBy: {
          select: { picked_language: true, language_code: true },
        },
      },
    });

    if (!giveaway) {
      console.error(`Giveaway ${giveawayId} not found`);
      return;
    }

    if (giveaway.participiationType === GiveawayStartType.Lottery) {
      await notifyLotteryCreated(giveawayId);
    } else {
      await notifyRandomGiveawayCreated(giveawayId);
    }
  } catch (error) {
    console.error('Error in notifyGiveawayCreated:', error);
  }
}

async function sendAdvertisingApplied(
  telegramId: string,
  giveawayId: string,
  languageCode: string | null,
): Promise<void> {
  const lang = getUserLanguage({ language_code: languageCode ?? undefined });
  const url = `${WEBAPP_URL}?startapp=giveawayId_${giveawayId}`;
  await sendMessage(telegramId, ADVERTISING_APPLIED_MESSAGES[lang].text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: ADVERTISING_APPLIED_MESSAGES[lang].button, url }],
      ],
    },
  });
}

/**
 * Notify a recipient that a gift has been transferred to them.
 * Sent after a successful transferGift API call.
 * Best-effort — silently skips if recipient has never started the bot.
 */
export async function sendGiftTransferredNotification(
  recipientTelegramId: string,
  recipientFirstName: string,
  recipientLastName: string | null,
  giftName: string,
  giftNumber: string | null,
  languageCode?: string | null,
): Promise<void> {
  try {
    const lang = getUserLanguage({ language_code: languageCode ?? undefined });
    const giftMsgs = GIFT_PRIZE_MESSAGES[lang];
    const userName = formatUserName(recipientFirstName, recipientLastName);

    const text = giftMsgs.giftTransferred(
      userName,
      giftName,
      giftNumber ?? '',
    );

    const viewUrl = `${WEBAPP_URL}?startapp=gifts`;

    await sendMessage(recipientTelegramId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: giftMsgs.giftTransferredBtn, url: viewUrl }],
        ],
      },
    });
  } catch {
    // Best-effort — recipient may not have started the bot
  }
}

// Export all notification functions
export const NotificationService = {
  notifyGiveawayCreated,
  notifyChannelSubscribers,
  notifyLotteryCreated,
  notifyRandomGiveawayCreated,
  notifyLotteryWin,
  notifyRandomGiveawayWin,
  notifyAllWinners,
  notifyWinnerReplaced,
  notifyNewWinnerSelected,
  notifyWinnerRemoved,
  sendAdvertisingApplied,
  sendGiftTransferredNotification,
};

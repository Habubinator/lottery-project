import axios from 'axios';
import {
  TelegramApiResponse,
  TelegramChatMember,
  UserChatBoosts,
  ChatBoost,
  LabeledPrice,
  InvoiceLinkParams,
  InlineKeyboardButton,
  InlineKeyboardButtonStyle,
  InlineKeyboardMarkup,
  MessageEntity,
  WinnerUser,
  WinnerParticipant,
  GiveawayFormatData,
  GiveawayLinkedChannel,
  GiveawaySponsor,
} from '../types';
import { prisma } from '@database';
import moment from 'moment';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { queueTelegramRequest } from '../utils/telegram-queue';
import { stripHtmlTags, normalizeHtml, htmlToEntities } from '../utils';
import {
  buildGiveawayStartappUrl,
  buildManageGiveawayStartappUrl,
} from '../../common/utils/string.util';
import {
  findLinkedChannelForMessage,
  isGiveawayCreatorOwnedChannel,
} from './giveaway-channel-ownership';
import {
  formatUniqueGiftNftHtml,
  formatWinnerPrizeHtml,
} from '../../common/utils/gift-nft-link.util';
import {
  GIVEAWAY_ANNOUNCEMENT_PRIZE_STATUSES,
  GIVEAWAY_FORMAT_PRIZES_INCLUDE,
  GIVEAWAY_LINKED_ONLY_PRIZES_INCLUDE,
} from '../../giveaways/services/prize-include';
import {
  REQUIREMENTS_MESSAGES,
  COMPLETION_CONDITION_MESSAGES,
  GIVEAWAY_MESSAGE_FORMAT,
  GIVEAWAY_POST_INTRO,
  BUTTON_TEXT_MESSAGES,
  WINNERS_ANNOUNCEMENT_MESSAGES,
  GIVEAWAY_CANCEL_MESSAGES,
  SPONSOR_APPROVAL_MESSAGES,
  GIVEAWAY_ACTIVATION_MESSAGES,
  LINK_REQUEST_MESSAGES,
  COOWNER_RESULTS_MESSAGES,
  WINNERS_UPDATED_MESSAGES,
  GIFT_PRIZE_MESSAGES,
  getMedalEmoji,
  Language,
  normalizeGiveawayLanguage,
  getUserLanguage,
} from './localization';
import crypto from 'crypto';
import {
  GiveawayEndType,
  GiveawayStartType,
  SponsorApprovalStatus,
  TransactionStatus,
  TransactionType,
  Currencies,
} from '@database';
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Convert relative URLs to absolute URLs for Telegram API
 * Telegram requires absolute URLs when fetching media via HTTP
 */
export function toAbsoluteUrl(url: string): string {
  if (url.startsWith('/')) {
    const domain = process.env.DOMAIN;
    if (domain) {
      return `https://${domain}${url}`;
    }
  }
  return url;
}

/**
 * Returns true if the given URL/path points to a GIF file
 */
export function isGifUrl(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0]; // strip query string
  return lower.endsWith('.gif');
}

/**
 * Check if a user is a member of a specific channel/chat
 * @param userId - Telegram user ID
 * @param chatId - Chat/channel ID (can be @username or numeric ID)
 * @returns Promise<boolean> - true if user is a member, false otherwise
 */
export async function isUserMemberOfChannel(
  userId: string | number | bigint,
  chatId: string | number | bigint,
): Promise<boolean> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await axios.get<TelegramApiResponse<TelegramChatMember>>(
      `${TELEGRAM_API_BASE}/getChatMember`,
      {
        params: {
          chat_id: chatId.toString(),
          user_id: userId.toString(),
        },
        timeout: 10000, // 10 second timeout
      },
    );

    if (!response.data.ok) {
      console.error(
        `[Telegram API] getChatMember failed for user ${userId} in chat ${chatId}: ${response.data.description}`,
      );
      return false;
    }

    const member = response.data.result;

    // Log the actual status for debugging
    console.log(
      `[DEBUG] User ${userId} status in chat ${chatId}: ${member.status}`,
    );

    // Consider user as member if they have any of these statuses
    const memberStatuses = ['creator', 'administrator', 'member', 'restricted'];
    const isMember = memberStatuses.includes(member.status);

    if (!isMember) {
      console.log(
        `[DEBUG] User ${userId} is not a member of chat ${chatId} (status: ${member.status})`,
      );
    }

    return isMember;
  } catch (error: any) {
    // Handle specific Telegram API errors
    const description = error.response?.data?.description || error.message;
    const errorCode = error.response?.data?.error_code;

    // Only log non-PARTICIPANT_ID_INVALID errors to reduce noise
    if (
      !description.includes('PARTICIPANT_ID_INVALID') &&
      !description.includes('USER_NOT_PARTICIPANT')
    ) {
      if (errorCode === 400) {
        console.error(
          `[Telegram API] Bad request for user ${userId} in chat ${chatId}: ${description}`,
        );
      } else if (errorCode === 403) {
        console.error(
          `[Telegram API] Bot doesn't have access to chat ${chatId}: ${description}`,
        );
      } else {
        console.error(
          `[Telegram API] Error checking membership for user ${userId} in chat ${chatId}: ${description}`,
        );
      }
    }

    return false;
  }
}

/**
 * Check if a user has boosted a specific channel
 * Note: Requires administrator rights in the chat
 * @param userId - Telegram user ID
 * @param chatId - Channel ID (must be a channel, not a regular group)
 * @returns Promise<boolean> - true if user is boosting, false otherwise
 */
export async function isUserBoostingChannel(
  userId: string | number | bigint,
  chatId: string | number | bigint,
  sinceUnix?: number,
): Promise<boolean> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    // Use getUserChatBoosts API to get user's boosts for this chat
    const response = await axios.get<TelegramApiResponse<UserChatBoosts>>(
      `${TELEGRAM_API_BASE}/getUserChatBoosts`,
      {
        params: {
          chat_id: chatId.toString(),
          user_id: userId.toString(),
        },
        timeout: 10000,
      },
    );
    console.log(response.data);
    if (!response.data.ok) {
      console.error(
        `[Telegram API] getUserChatBoosts failed for user ${userId} in chat ${chatId}: ${response.data.description}`,
      );
      return false;
    }

    const userBoosts = response.data.result;

    // Check if user has any active boosts
    if (!userBoosts.boosts || userBoosts.boosts.length === 0) {
      return false;
    }

    // Check if any boosts are currently active (not expired) and added after sinceUnix if provided
    const currentTime = Math.floor(Date.now() / 1000);
    const hasActiveBoosts = userBoosts.boosts.some(
      (boost) =>
        boost.expiration_date > currentTime &&
        (sinceUnix === undefined || boost.add_date >= sinceUnix),
    );

    return hasActiveBoosts;
  } catch (error: any) {
    const description = error.response?.data?.description || error.message;
    const errorCode = error.response?.data?.error_code;

    // Only log meaningful errors, skip common expected errors
    if (
      !description.includes('PARTICIPANT_ID_INVALID') &&
      !description.includes('USER_NOT_PARTICIPANT')
    ) {
      if (errorCode === 400) {
        console.error(
          `[Telegram API] Bad request for boost check - user ${userId} in chat ${chatId}: ${description}`,
        );
      } else if (errorCode === 403) {
        console.error(
          `[Telegram API] Bot doesn't have admin rights in chat ${chatId}: ${description}`,
        );
      } else {
        console.error(
          `[Telegram API] Error checking boost status for user ${userId} in chat ${chatId}: ${description}`,
        );
      }
    }

    return false;
  }
}

/**
 * Get all active boosts from a user in a specific chat
 * @param userId - Telegram user ID
 * @param chatId - Channel ID
 * @returns Promise<ChatBoost[]> - array of active boosts or empty array
 */
export async function getUserActiveBoosts(
  userId: string | number | bigint,
  chatId: string | number | bigint,
): Promise<ChatBoost[]> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await axios.get<TelegramApiResponse<UserChatBoosts>>(
      `${TELEGRAM_API_BASE}/getUserChatBoosts`,
      {
        params: {
          chat_id: chatId.toString(),
          user_id: userId.toString(),
        },
        timeout: 10000,
      },
    );

    if (!response.data.ok) {
      console.error(`Telegram API error: ${response.data.description}`);
      return [];
    }

    const userBoosts = response.data.result;

    if (!userBoosts.boosts || userBoosts.boosts.length === 0) {
      return [];
    }

    // Filter only active (non-expired) boosts
    const currentTime = Math.floor(Date.now() / 1000);
    return userBoosts.boosts.filter(
      (boost) => boost.expiration_date > currentTime,
    );
  } catch (error: any) {
    console.error(`Error getting user boosts: ${error.message}`);
    return [];
  }
}

/**
 * Get detailed chat member information
 * @param userId - Telegram user ID
 * @param chatId - Chat/channel ID
 * @returns Promise<TelegramChatMember | null> - member details or null if error
 */
export async function getChatMemberInfo(
  userId: string | number | bigint,
  chatId: string | number | bigint,
): Promise<TelegramChatMember | null> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await axios.get<TelegramApiResponse<TelegramChatMember>>(
      `${TELEGRAM_API_BASE}/getChatMember`,
      {
        params: {
          chat_id: chatId.toString(),
          user_id: userId.toString(),
        },
        timeout: 10000,
      },
    );

    if (!response.data.ok) {
      console.error(`Telegram API error: ${response.data.description}`);
      return null;
    }

    return response.data.result;
  } catch (error: any) {
    console.error(`Error getting chat member info: ${error.message}`);
    return null;
  }
}

/**
 * Batch check if user is member of multiple channels
 * @param userId - Telegram user ID
 * @param chatIds - Array of chat/channel IDs
 * @returns Promise<Map<string, boolean>> - object with chatId as key and membership status as value
 */
export async function batchCheckUserMembership(
  userId: string | number | bigint,
  chatIds: (string | number | bigint)[],
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  // Execute checks in parallel with a reasonable concurrency limit
  const promises = chatIds.map(async (chatId) => {
    try {
      const isMember = await isUserMemberOfChannel(
        userId.toString(),
        chatId.toString(),
      );
      results.set(chatId.toString(), isMember);
    } catch (error) {
      console.error(`Error checking membership for chat ${chatId}:`, error);
      results.set(chatId.toString(), false);
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Check if the bot has necessary permissions in a chat
 * @param chatId - Chat/channel ID
 * @returns Promise<boolean> - true if bot has access, false otherwise
 */
export async function checkBotAccess(
  chatId: string | number | bigint,
): Promise<boolean> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await axios.get<TelegramApiResponse<any>>(
      `${TELEGRAM_API_BASE}/getChat`,
      {
        params: {
          chat_id: chatId.toString(),
        },
        timeout: 10000,
      },
    );

    return response.data.ok;
  } catch (error: any) {
    console.error(`Error checking bot access: ${error.message}`);
    return false;
  }
}

/**
 * Generate an infinite invite link for a chat/channel
 * First tries to export the primary invite link (requires can_invite_users)
 * If that fails, tries to create a new invite link
 * @param chatId - Chat/channel ID
 * @returns Promise<string | null> - Invite link or null if error
 */
export async function generateInviteLink(
  chatId: string | number | bigint,
): Promise<string | null> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    console.log(`Generating invite link for chat ${chatId}...`);

    // First, try to export the primary invite link (simpler, requires can_invite_users)
    try {
      const exportResponse = await queueTelegramRequest(() =>
        axios.post<TelegramApiResponse<string>>(
          `${TELEGRAM_API_BASE}/exportChatInviteLink`,
          {
            chat_id: chatId.toString(),
          },
          {
            timeout: 10000,
          },
        ),
      );

      if (exportResponse.data.ok) {
        const inviteLink = exportResponse.data.result;
        console.log(
          `Successfully exported primary invite link for chat ${chatId}: ${inviteLink}`,
        );
        return inviteLink;
      }
    } catch (exportError: any) {
      console.log(
        `Could not export primary invite link, trying to create new one: ${exportError.response?.data?.description || exportError.message}`,
      );
    }

    // If export fails, try to create a new invite link
    const response = await queueTelegramRequest(() =>
      axios.post<TelegramApiResponse<{ invite_link: string }>>(
        `${TELEGRAM_API_BASE}/createChatInviteLink`,
        {
          chat_id: chatId.toString(),
          name: 'Giveaway Battle Link',
          creates_join_request: false,
        },
        {
          timeout: 10000,
        },
      ),
    );

    if (!response.data.ok) {
      console.error(
        `[Telegram API] Failed to generate invite link for chat ${chatId}: ${response.data.description}`,
      );
      return null;
    }

    const inviteLink = response.data.result.invite_link;
    console.log(
      `Successfully created invite link for chat ${chatId}: ${inviteLink}`,
    );

    return inviteLink;
  } catch (error: any) {
    const description = error.response?.data?.description || error.message;
    const errorCode = error.response?.data?.error_code;

    if (errorCode === 400) {
      console.error(
        `[Telegram API] Bad request when generating invite link for chat ${chatId}: ${description}`,
      );
      // Permanent failure (chat not found / deleted) — deactivate to stop retry spam on next startup
      try {
        await prisma.channel.updateMany({
          where: { id: BigInt(chatId.toString()) },
          data: { isActive: false, botCanInviteUsers: false },
        });
        console.log(
          `[Telegram API] Deactivated channel ${chatId} due to permanent 400 error`,
        );
      } catch (dbErr: any) {
        console.error(
          `[Telegram API] Failed to deactivate channel ${chatId}:`,
          dbErr.message,
        );
      }
    } else if (errorCode === 403) {
      console.error(
        `[Telegram API] Bot doesn't have permission to generate invite link in chat ${chatId}: ${description}`,
      );
      // Bot lost invite permission — mark it so future link generation is skipped
      try {
        await prisma.channel.updateMany({
          where: { id: BigInt(chatId.toString()) },
          data: { botCanInviteUsers: false },
        });
      } catch (dbErr: any) {
        console.error(
          `[Telegram API] Failed to update botCanInviteUsers for channel ${chatId}:`,
          dbErr.message,
        );
      }
    } else {
      console.error(
        `[Telegram API] Error generating invite link for chat ${chatId}: ${description}`,
      );
    }

    return null;
  }
}

/**
 * Batch check if users are boosting multiple channels
 * @param userId - Telegram user ID
 * @param chatIds - Array of chat/channel IDs
 * @returns Map<Record<string, boolean>> - object with chatId as key and boost status as value
 */
export async function batchCheckUserBoosts(
  userId: string | number | bigint,
  chatIds: (string | number | bigint)[],
  sinceUnix?: number,
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  // Execute checks in parallel with a reasonable concurrency limit
  const promises = chatIds.map(async (chatId) => {
    try {
      const isBoosting = await isUserBoostingChannel(
        userId.toString(),
        chatId.toString(),
        sinceUnix,
      );
      results.set(chatId.toString(), isBoosting);
    } catch (error) {
      console.error(
        `Error checking boosts for chat ${chatId}:`,
        error instanceof Error ? error.message : error,
      );
      results.set(chatId.toString(), false);
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Create a Telegram invoice link for payments
 * @param params - Invoice parameters
 * @returns Promise<string | null> - Invoice link URL or null if error
 */
export async function createInvoiceLink(
  params: InvoiceLinkParams,
): Promise<string | null> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    // Build request body, excluding undefined fields
    const requestBody: any = {
      title: params.title,
      description: params.description,
      payload: params.payload,
      provider_token: params.provider_token || '', // Empty for Telegram Stars
      currency: params.currency,
      prices: params.prices,
    };

    // Only add optional fields if they are defined
    if (params.max_tip_amount !== undefined)
      requestBody.max_tip_amount = params.max_tip_amount;
    if (params.suggested_tip_amounts !== undefined)
      requestBody.suggested_tip_amounts = params.suggested_tip_amounts;
    if (params.provider_data !== undefined)
      requestBody.provider_data = params.provider_data;
    if (params.photo_url !== undefined)
      requestBody.photo_url = params.photo_url;
    if (params.photo_size !== undefined)
      requestBody.photo_size = params.photo_size;
    if (params.photo_width !== undefined)
      requestBody.photo_width = params.photo_width;
    if (params.photo_height !== undefined)
      requestBody.photo_height = params.photo_height;
    if (params.need_name !== undefined)
      requestBody.need_name = params.need_name;
    if (params.need_phone_number !== undefined)
      requestBody.need_phone_number = params.need_phone_number;
    if (params.need_email !== undefined)
      requestBody.need_email = params.need_email;
    if (params.need_shipping_address !== undefined)
      requestBody.need_shipping_address = params.need_shipping_address;
    if (params.send_phone_number_to_provider !== undefined)
      requestBody.send_phone_number_to_provider =
        params.send_phone_number_to_provider;
    if (params.send_email_to_provider !== undefined)
      requestBody.send_email_to_provider = params.send_email_to_provider;
    if (params.is_flexible !== undefined)
      requestBody.is_flexible = params.is_flexible;

    // Log request for debugging
    console.log(
      '[Telegram API] Creating invoice link with params:',
      JSON.stringify(requestBody, null, 2),
    );

    const response = await queueTelegramRequest(() =>
      axios.post<TelegramApiResponse<string>>(
        `${TELEGRAM_API_BASE}/createInvoiceLink`,
        requestBody,
        {
          timeout: 15000, // 15 second timeout for payment operations
        },
      ),
    );

    if (!response.data.ok) {
      console.error(`Telegram API error: ${response.data.description}`);
      return null;
    }

    return response.data.result;
  } catch (error: any) {
    if (error.response?.data?.error_code === 400) {
      console.error(
        `Bad request - invalid invoice parameters: ${error.response.data.description}`,
      );
      console.error('Request body was:', JSON.stringify(params, null, 2));
    } else if (error.response?.data?.error_code === 401) {
      console.error(
        `Unauthorized - invalid bot token: ${error.response.data.description}`,
      );
    } else {
      console.error(`Error creating invoice link: ${error.message}`);
    }

    return null;
  }
}

/**
 * Create a simple Stars payment link for giveaway participation
 * @param title - Payment title
 * @param description - Payment description
 * @param starsAmount - Amount in Telegram Stars
 * @param payload - Custom payload for tracking
 * @returns Promise<string | null> - Invoice link URL or null if error
 */
export async function createStarsPaymentLink(
  title: string,
  description: string,
  starsAmount: number,
  payload: string,
): Promise<string | null> {
  const prices: LabeledPrice[] = [
    {
      label: 'Participation Fee',
      amount: starsAmount,
    },
  ];

  return await createInvoiceLink({
    title,
    description,
    payload,
    provider_token: '', // Empty for Telegram Stars
    currency: 'XTR', // Telegram Stars currency code
    prices,
  });
}

/**
 * Create a TON payment link
 * @param title - Payment title
 * @param description - Payment description
 * @param tonAmount - Amount in TON (in the smallest units)
 * @param payload - Custom payload for tracking
 * @param providerToken - TON payment provider token
 * @returns Promise<string | null> - Invoice link URL or null if error
 */
export async function createTonPaymentLink(
  title: string,
  description: string,
  tonAmount: number,
  payload: string,
  providerToken: string,
): Promise<string | null> {
  const prices: LabeledPrice[] = [
    {
      label: 'Participation Fee',
      amount: tonAmount,
    },
  ];

  return await createInvoiceLink({
    title,
    description,
    payload,
    provider_token: providerToken,
    currency: 'TON',
    prices,
  });
}

/**
 * Append a local file to multipart FormData with filename + content-type.
 * Telegram requires a filename in Content-Disposition; without it, sendAnimation
 * can return ok:true with message_id:0 and the post is then orphaned (no DB row).
 */
function appendLocalFileToFormData(
  formData: FormData,
  fieldName: string,
  filePath: string,
): void {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType =
    ext === '.mp4' || ext === '.mov'
      ? 'video/mp4'
      : ext === '.gif'
        ? 'image/gif'
        : ext === '.webm'
          ? 'video/webm'
          : ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : 'application/octet-stream';

  formData.append(fieldName, fs.createReadStream(filePath), {
    filename,
    contentType,
  });
}

/** Telegram message_id must be a positive integer; 0/NaN means the send cannot be tracked. */
function parseTelegramMessageId(result: unknown): number | undefined {
  const raw =
    result && typeof result === 'object'
      ? (result as { message_id?: unknown }).message_id
      : undefined;
  const messageId =
    typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return undefined;
  }
  return Math.trunc(messageId);
}

/**
 * Send a message to a specific chat/channel
 * @param chatId - Chat/channel ID (can be @username or numeric ID)
 * @param text - Message text (supports HTML formatting)
 * @param options - Additional options for the message
 * @returns Promise<{success: boolean, messageId?: number}> - result with success status and messageId if successful
 */
export async function sendMessage(
  chatId: string | number | bigint,
  text: string,
  options?: {
    parse_mode?: 'HTML' | 'Markdown';
    disable_web_page_preview?: boolean;
    disable_notification?: boolean;
    reply_markup?: InlineKeyboardMarkup;
    entities?: MessageEntity[];
  },
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await queueTelegramRequest(() =>
      axios.post<TelegramApiResponse<any>>(
        `${TELEGRAM_API_BASE}/sendMessage`,
        {
          chat_id: chatId,
          text,
          ...(options?.entities
            ? { entities: options.entities }
            : { parse_mode: options?.parse_mode || 'HTML' }),
          disable_web_page_preview: options?.disable_web_page_preview || false,
          disable_notification: options?.disable_notification || false,
          reply_markup: options?.reply_markup,
        },
        {
          timeout: 15000, // 15 second timeout
        },
      ),
    );

    if (!response.data.ok) {
      console.error(`Telegram API error: ${response.data.description}`);
      return {
        success: false,
        error:
          response.data.description || 'Unknown API error: ' + response.status,
      };
    }

    const messageId = parseTelegramMessageId(response.data.result);
    if (!messageId) {
      console.error(
        `Message send reported ok but missing message_id for chat ${chatId}:`,
        JSON.stringify(response.data.result)?.slice(0, 500),
      );
      return {
        success: false,
        error: 'Telegram returned ok without a valid message_id',
      };
    }
    console.log(
      `Message sent successfully to chat ${chatId}, message_id: ${messageId}`,
    );
    return { success: true, messageId };
  } catch (error: any) {
    let errorMessage: string;

    if (error.response?.data?.error_code === 400) {
      errorMessage =
        error.response.data.description || 'Bad request - invalid parameters';
      console.error(
        `Bad request - possibly invalid chat_id or message: ${errorMessage}`,
      );
    } else if (error.response?.data?.error_code === 403) {
      errorMessage =
        error.response.data.description ||
        "Forbidden - bot doesn't have permission";
      console.error(
        `Forbidden - bot doesn't have permission to send messages to this chat: ${errorMessage}`,
      );
    } else if (error.response?.data?.error_code === 429) {
      errorMessage =
        error.response.data.description || 'Rate limited - too many requests';
      console.error(`Rate limited - too many requests: ${errorMessage}`);
    } else {
      errorMessage = error.message || 'Unknown error';
      console.error(`Error sending message: ${errorMessage}`);
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Send a photo with caption to a specific chat/channel
 * @param chatId - Chat/channel ID (can be @username or numeric ID)
 * @param photo - Photo file path (relative or absolute) or Telegram file_id
 * @param caption - Photo caption (supports HTML formatting)
 * @param options - Additional options for the message
 * @returns Promise<{success: boolean, messageId?: number}> - result with success status and messageId if successful
 */
export async function sendPhoto(
  chatId: string | number | bigint,
  photo: string,
  caption?: string,
  options?: {
    parse_mode?: 'HTML' | 'Markdown';
    disable_notification?: boolean;
    disable_web_page_preview?: boolean;
    reply_markup?: InlineKeyboardMarkup;
    caption_entities?: MessageEntity[];
  },
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    // Check if photo is a file path or file_id
    const isFilePath =
      photo.startsWith('/') || photo.startsWith('./') || photo.includes('\\');

    if (isFilePath) {
      // Send as file upload using multipart/form-data
      const formData = new FormData();

      // Resolve the file path (handle both relative and absolute paths)
      let filePath = photo;
      if (photo.startsWith('/static/')) {
        // Convert /static/ to actual file path
        filePath = path.join(
          process.env.MULTER_DEST || './uploads',
          photo.replace('/static/', ''),
        );
      } else if (!path.isAbsolute(photo)) {
        filePath = path.resolve(photo);
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error(`Photo file not found: ${filePath}`);
        return { success: false, error: `Photo file not found: ${filePath}` };
      }

      formData.append('chat_id', chatId.toString());
      appendLocalFileToFormData(formData, 'photo', filePath);

      if (caption) {
        formData.append('caption', caption);
      }

      formData.append('parse_mode', options?.parse_mode || 'HTML');
      formData.append(
        'disable_notification',
        String(options?.disable_notification || false),
      );

      if (options?.disable_web_page_preview !== undefined) {
        formData.append(
          'disable_web_page_preview',
          String(options.disable_web_page_preview),
        );
      }

      if (options?.reply_markup) {
        formData.append('reply_markup', JSON.stringify(options.reply_markup));
      }

      const response = await queueTelegramRequest(() =>
        axios.post<TelegramApiResponse<any>>(
          `${TELEGRAM_API_BASE}/sendPhoto`,
          formData,
          {
            headers: formData.getHeaders(),
            timeout: 30000, // 30 second timeout for file uploads
          },
        ),
      );

      if (!response.data.ok) {
        console.error(`Telegram API error: ${response.data.description}`);
        return {
          success: false,
          error:
            response.data.description ||
            'Unknown API error: ' + response.status,
        };
      }

      const messageId = parseTelegramMessageId(response.data.result);
      if (!messageId) {
        console.error(
          `Photo send reported ok but missing message_id for chat ${chatId}:`,
          JSON.stringify(response.data.result)?.slice(0, 500),
        );
        return {
          success: false,
          error: 'Telegram returned ok without a valid message_id',
        };
      }
      console.log(
        `Photo sent successfully to chat ${chatId}, message_id: ${messageId}`,
      );
      return { success: true, messageId };
    } else {
      // Send as file_id or URL (for already uploaded photos)
      const response = await queueTelegramRequest(() =>
        axios.post<TelegramApiResponse<any>>(
          `${TELEGRAM_API_BASE}/sendPhoto`,
          {
            chat_id: chatId,
            photo,
            caption,
            ...(options?.caption_entities
              ? { caption_entities: options.caption_entities }
              : { parse_mode: options?.parse_mode || 'HTML' }),
            disable_notification: options?.disable_notification || false,
            disable_web_page_preview: options?.disable_web_page_preview,
            reply_markup: options?.reply_markup,
          },
          {
            timeout: 15000, // 15 second timeout
          },
        ),
      );

      if (!response.data.ok) {
        console.error(`Telegram API error: ${response.data.description}`);
        return {
          success: false,
          error:
            response.data.description ||
            'Unknown API error: ' + response.status,
        };
      }

      const messageId = parseTelegramMessageId(response.data.result);
      if (!messageId) {
        console.error(
          `Photo send reported ok but missing message_id for chat ${chatId}:`,
          JSON.stringify(response.data.result)?.slice(0, 500),
        );
        return {
          success: false,
          error: 'Telegram returned ok without a valid message_id',
        };
      }
      console.log(
        `Photo sent successfully to chat ${chatId}, message_id: ${messageId}`,
      );
      return { success: true, messageId };
    }
  } catch (error: any) {
    let errorMessage: string;

    if (error.response?.data?.error_code === 400) {
      errorMessage =
        error.response.data.description ||
        'Bad request - invalid photo or parameters';
      console.error(
        `Bad request - possibly invalid photo URL or chat_id: ${errorMessage}`,
      );
    } else if (error.response?.data?.error_code === 403) {
      errorMessage =
        error.response.data.description ||
        "Forbidden - bot doesn't have permission";
      console.error(
        `Forbidden - bot doesn't have permission to send photos to this chat: ${errorMessage}`,
      );
    } else if (error.response?.data?.error_code === 429) {
      errorMessage =
        error.response.data.description || 'Rate limited - too many requests';
      console.error(`Rate limited - too many requests: ${errorMessage}`);
    } else {
      errorMessage = error.message || 'Unknown error';
      console.error(`Error sending photo: ${errorMessage}`);
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Send an animation (GIF) with caption to a specific chat/channel
 * @param chatId - Chat/channel ID (can be @username or numeric ID)
 * @param animation - Animation file path (relative or absolute) or Telegram file_id/URL
 * @param caption - Animation caption (supports HTML formatting)
 * @param options - Additional options for the message
 * @returns Promise<{success: boolean, messageId?: number}> - result with success status and messageId if successful
 */
export async function sendAnimation(
  chatId: string | number | bigint,
  animation: string,
  caption?: string,
  options?: {
    parse_mode?: 'HTML' | 'Markdown';
    disable_notification?: boolean;
    reply_markup?: InlineKeyboardMarkup;
    caption_entities?: MessageEntity[];
  },
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const isFilePath =
      animation.startsWith('/') ||
      animation.startsWith('./') ||
      animation.includes('\\');

    if (isFilePath) {
      const formData = new FormData();

      let filePath = animation;
      if (animation.startsWith('/static/')) {
        filePath = path.join(
          process.env.MULTER_DEST || './uploads',
          animation.replace('/static/', ''),
        );
      } else if (!path.isAbsolute(animation)) {
        filePath = path.resolve(animation);
      }

      if (!fs.existsSync(filePath)) {
        console.error(`Animation file not found: ${filePath}`);
        return {
          success: false,
          error: `Animation file not found: ${filePath}`,
        };
      }

      formData.append('chat_id', chatId.toString());
      appendLocalFileToFormData(formData, 'animation', filePath);

      if (caption) {
        formData.append('caption', caption);
      }

      if (options?.caption_entities) {
        formData.append(
          'caption_entities',
          JSON.stringify(options.caption_entities),
        );
      } else {
        formData.append('parse_mode', options?.parse_mode || 'HTML');
      }
      formData.append(
        'disable_notification',
        String(options?.disable_notification || false),
      );

      if (options?.reply_markup) {
        formData.append('reply_markup', JSON.stringify(options.reply_markup));
      }

      const response = await queueTelegramRequest(() =>
        axios.post<TelegramApiResponse<any>>(
          `${TELEGRAM_API_BASE}/sendAnimation`,
          formData,
          {
            headers: formData.getHeaders(),
            timeout: 30000,
          },
        ),
      );

      if (!response.data.ok) {
        console.error(`Telegram API error: ${response.data.description}`);
        return {
          success: false,
          error:
            response.data.description ||
            'Unknown API error: ' + response.status,
        };
      }

      const messageId = parseTelegramMessageId(response.data.result);
      if (!messageId) {
        console.error(
          `Animation send reported ok but missing message_id for chat ${chatId}:`,
          JSON.stringify(response.data.result)?.slice(0, 500),
        );
        return {
          success: false,
          error: 'Telegram returned ok without a valid message_id',
        };
      }
      console.log(
        `Animation sent successfully to chat ${chatId}, message_id: ${messageId}`,
      );
      return { success: true, messageId };
    } else {
      const response = await queueTelegramRequest(() =>
        axios.post<TelegramApiResponse<any>>(
          `${TELEGRAM_API_BASE}/sendAnimation`,
          {
            chat_id: chatId.toString(),
            animation,
            caption,
            ...(options?.caption_entities
              ? { caption_entities: options.caption_entities }
              : { parse_mode: options?.parse_mode || 'HTML' }),
            disable_notification: options?.disable_notification || false,
            reply_markup: options?.reply_markup,
          },
          {
            timeout: 15000,
          },
        ),
      );

      if (!response.data.ok) {
        console.error(`Telegram API error: ${response.data.description}`);
        return {
          success: false,
          error:
            response.data.description ||
            'Unknown API error: ' + response.status,
        };
      }

      const messageId = parseTelegramMessageId(response.data.result);
      if (!messageId) {
        console.error(
          `Animation send reported ok but missing message_id for chat ${chatId}:`,
          JSON.stringify(response.data.result)?.slice(0, 500),
        );
        return {
          success: false,
          error: 'Telegram returned ok without a valid message_id',
        };
      }
      console.log(
        `Animation sent successfully to chat ${chatId}, message_id: ${messageId}`,
      );
      return { success: true, messageId };
    }
  } catch (error: any) {
    let errorMessage: string;

    if (error.response?.data?.error_code === 400) {
      errorMessage =
        error.response.data.description ||
        'Bad request - invalid animation or parameters';
      console.error(
        `Bad request - possibly invalid animation or chat_id: ${errorMessage}`,
      );
    } else if (error.response?.data?.error_code === 403) {
      errorMessage =
        error.response.data.description ||
        "Forbidden - bot doesn't have permission";
      console.error(
        `Forbidden - bot doesn't have permission to send animations to this chat: ${errorMessage}`,
      );
    } else if (error.response?.data?.error_code === 429) {
      errorMessage =
        error.response.data.description || 'Rate limited - too many requests';
      console.error(`Rate limited - too many requests: ${errorMessage}`);
    } else {
      errorMessage = error.message || 'Unknown error';
      console.error(`Error sending animation: ${errorMessage}`);
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Send multiple photos as a media group to a Telegram chat
 * @param chatId - Telegram chat ID
 * @param photos - Array of photo URLs/file_ids (2-10 items)
 * @param caption - Caption for the first photo
 * @param options - Additional options (parse_mode, etc)
 * @returns Promise<{ success: boolean; messageIds?: number[] }>
 */
export async function sendMediaGroup(
  chatId: bigint,
  photos: string[],
  caption?: string,
  options?: {
    parse_mode?: 'HTML' | 'Markdown';
    disable_notification?: boolean;
    disable_web_page_preview?: boolean;
  },
): Promise<{ success: boolean; messageIds?: number[]; error?: string }> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    // Validate photo count (2-10 for media groups)
    if (photos.length < 2 || photos.length > 10) {
      throw new Error(
        `Media group must contain 2-10 photos, got ${photos.length}`,
      );
    }

    // Detect which photos are local file paths vs URLs/file_ids
    const isFilePath = (photo: string) =>
      photo.startsWith('/') || photo.startsWith('./') || photo.includes('\\');

    const needsUpload = photos.some(isFilePath);

    let response: any;

    if (needsUpload) {
      // Use attach:// syntax for local files
      const media = photos.map((photo, index) => {
        const useAttach = isFilePath(photo);
        return {
          type: 'photo',
          media: useAttach ? `attach://photo${index}` : photo,
          ...(index === 0 && caption
            ? { caption, parse_mode: options?.parse_mode || 'HTML' }
            : {}),
        };
      });

      // Create FormData for file uploads
      const formData = new FormData();

      // Attach each local file
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        if (isFilePath(photo)) {
          // Resolve file path (same logic as sendPhoto)
          let filePath = photo;
          if (photo.startsWith('/static/')) {
            filePath = path.join(
              process.env.MULTER_DEST || './uploads',
              photo.replace('/static/', ''),
            );
          } else if (!path.isAbsolute(photo)) {
            filePath = path.resolve(photo);
          }

          // Check if file exists
          if (!fs.existsSync(filePath)) {
            console.error(`Photo file not found: ${filePath}`);
            return {
              success: false,
              error: `Photo file not found: ${filePath}`,
            };
          }

          // Attach file with unique identifier
          formData.append(`photo${i}`, fs.createReadStream(filePath));
        }
      }

      // Attach other parameters
      formData.append('chat_id', chatId.toString());
      formData.append('media', JSON.stringify(media));
      formData.append(
        'disable_notification',
        String(options?.disable_notification || false),
      );

      // Send with FormData headers
      response = await queueTelegramRequest(() =>
        axios.post<TelegramApiResponse<any[]>>(
          `${TELEGRAM_API_BASE}/sendMediaGroup`,
          formData,
          {
            headers: formData.getHeaders(),
            timeout: 30000, // Longer timeout for file uploads
          },
        ),
      );
    } else {
      // No local files - use original logic for URLs/file_ids
      const media = photos.map((photo, index) => ({
        type: 'photo',
        media: photo,
        ...(index === 0 && caption
          ? { caption, parse_mode: options?.parse_mode || 'HTML' }
          : {}),
      }));

      response = await queueTelegramRequest(() =>
        axios.post<TelegramApiResponse<any[]>>(
          `${TELEGRAM_API_BASE}/sendMediaGroup`,
          {
            chat_id: chatId.toString(),
            media,
            disable_notification: options?.disable_notification || false,
          },
          {
            timeout: 20000,
          },
        ),
      );
    }

    // Common response handling
    if (!response.data.ok) {
      console.error(`Telegram API error: ${response.data.description}`);
      return {
        success: false,
        error:
          response.data.description || 'Unknown API error: ' + response.status,
      };
    }

    // Extract message IDs from all messages in the group
    const messageIds =
      response.data.result?.map(
        (msg: { message_id: number }) => msg.message_id,
      ) || [];
    console.log(
      `Media group sent successfully to chat ${chatId}, message_ids: ${messageIds.join(', ')}`,
    );

    return { success: true, messageIds };
  } catch (error: any) {
    let errorMessage: string;

    if (error.response?.data?.error_code === 400) {
      errorMessage =
        error.response.data.description ||
        'Bad request - invalid media or parameters';
      console.error(
        `Bad request - possibly invalid photo URLs or chat_id: ${errorMessage}`,
      );
    } else if (error.response?.data?.error_code === 403) {
      errorMessage =
        error.response.data.description ||
        "Forbidden - bot doesn't have permission";
      console.error(
        `Forbidden - bot doesn't have permission to send media to this chat: ${errorMessage}`,
      );
    } else if (error.response?.data?.error_code === 429) {
      errorMessage =
        error.response.data.description || 'Rate limited - too many requests';
      console.error(`Rate limited - too many requests: ${errorMessage}`);
    } else {
      errorMessage = error.message || 'Unknown error';
      console.error(`Error sending media group: ${errorMessage}`);
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Participant / ticket count for button labels.
 * Lottery = ticket rows; Random = unique users.
 */
function resolveParticipantCount(giveaway: GiveawayFormatData): number {
  const isLottery = giveaway.participiationType === 'Lottery';
  if (isLottery) {
    return giveaway.participants?.length || 0;
  }
  return new Set(
    (giveaway.participants || []).map((p: WinnerParticipant) => p.userId),
  ).size;
}

/**
 * Active/ended/cancelled participation button: plain ` • N` / ` • N/M`
 * (👤/🎟 removed from template — Oleksandr 13.07).
 */
function formatParticipationCountSuffix(
  _giveaway: GiveawayFormatData,
  count: number,
  max?: number | null,
): string {
  if (max != null && max > 0) {
    return ` • ${count}/${max}`;
  }
  return ` • ${count}`;
}

/**
 * Results announcement button/hyperlink only (Oleksandr 20.07):
 * giveaway ` • 100`, lottery ` • 🎟100`.
 */
function formatResultsCountSuffix(isLottery: boolean, count: number): string {
  return isLottery ? ` • 🎟${count}` : ` • ${count}`;
}

/**
 * Generate button text based on giveaway status and participation
 * @param giveaway - Giveaway data with participants
 * @returns Button text string
 */
function generateButtonText(giveaway: GiveawayFormatData): string {
  // Normalize language: 'uk' maps to 'ua'
  let language: Language = 'en';
  if (giveaway.language) {
    const lang = giveaway.language.toLowerCase();
    if (lang.startsWith('uk') || lang.startsWith('ua')) {
      language = 'ua';
    } else if (lang.startsWith('ru')) {
      language = 'ru';
    }
  }

  const messages = BUTTON_TEXT_MESSAGES[language];
  const isLottery = giveaway.participiationType === 'Lottery';
  const participantCount = resolveParticipantCount(giveaway);

  // Check cancelled FIRST - show "Cancelled" instead of "Ended"
  if (giveaway.isCancelled) {
    const cancelMessages = GIVEAWAY_CANCEL_MESSAGES[language];
    const cancelledText = stripLeadingStatusEmoji(
      isLottery
        ? cancelMessages.lotteryCancelledButton
        : cancelMessages.cancelledButton,
    );
    return `${cancelledText}${formatParticipationCountSuffix(giveaway, participantCount)}`;
  }

  // Check completed (finished, not cancelled)
  if (!giveaway.isActive) {
    const endedText = isLottery
      ? messages.lotteryEnded
      : messages.giveawayEnded;
    if (giveaway.completionType === 'ByCapacity' && giveaway.maxParticipants) {
      return `${endedText}${formatParticipationCountSuffix(giveaway, participantCount, giveaway.maxParticipants)}`;
    }
    return `${endedText}${formatParticipationCountSuffix(giveaway, participantCount)}`;
  }

  // Giveaway is active
  const participateLabel =
    giveaway.participationButtonText?.trim() || messages.participate;

  const showCount = giveaway.showParticipationCount !== false;
  if (!showCount) {
    return participateLabel;
  }

  const showMax =
    giveaway.showParticipationMaxCount !== false &&
    giveaway.completionType === 'ByCapacity' &&
    !!giveaway.maxParticipants;

  if (showMax) {
    return `${participateLabel}${formatParticipationCountSuffix(giveaway, participantCount, giveaway.maxParticipants)}`;
  }

  return `${participateLabel}${formatParticipationCountSuffix(giveaway, participantCount)}`;
}

/** Strip 🔴/❌/🚫 from button label when Telegram `style` carries the color. */
function stripLeadingStatusEmoji(text: string): string {
  return text.replace(/^[\u{1F534}\u{274C}\u{1F6AB}]\s*/u, '');
}

function resolveParticipationButtonStyle(
  giveaway: GiveawayFormatData,
): InlineKeyboardButtonStyle | undefined {
  if (giveaway.isCancelled || !giveaway.isActive) {
    return 'danger';
  }
  const style = giveaway.participationButtonStyle?.trim().toLowerCase();
  if (style === 'primary' || style === 'success' || style === 'danger') {
    return style;
  }
  return undefined;
}

export function buildParticipationInlineButton(
  giveaway: GiveawayFormatData,
  url: string,
): InlineKeyboardButton {
  const button: InlineKeyboardButton = {
    text: generateButtonText(giveaway),
    url,
  };
  const style = resolveParticipationButtonStyle(giveaway);
  if (style) {
    button.style = style;
  }
  return button;
}

export function buildParticipationKeyboard(
  giveaway: GiveawayFormatData,
  url: string,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[buildParticipationInlineButton(giveaway, url)]],
  };
}

export type DescriptionPreviewDraft = {
  participationButtonText?: string | null;
  participationButtonStyle?: string | null;
  showParticipationCount?: boolean | null;
  showParticipationMaxCount?: boolean | null;
  participiationType?: string | null;
  language?: string | null;
  completionType?: string | null;
  maxParticipants?: number | null;
};

export function buildDescriptionPreviewGiveawayData(
  draft: DescriptionPreviewDraft,
  fallbackLanguage?: string | null,
): GiveawayFormatData {
  const language = draft.language ?? fallbackLanguage ?? 'en';
  const maxParticipants = draft.maxParticipants ?? undefined;
  const completionType =
    draft.completionType ??
    (maxParticipants != null && maxParticipants > 0 ? 'ByCapacity' : 'ByTime');

  return {
    participiationType: draft.participiationType ?? 'Random',
    language,
    completionType,
    maxParticipants,
    isActive: true,
    isCancelled: false,
    participants: [],
    participationButtonText: draft.participationButtonText,
    participationButtonStyle: draft.participationButtonStyle,
    showParticipationCount: draft.showParticipationCount ?? true,
    showParticipationMaxCount: draft.showParticipationMaxCount ?? true,
  };
}

export function previewParticipationButtonText(
  opts: DescriptionPreviewDraft,
  fallbackLanguage?: string | null,
): string {
  return generateButtonText(
    buildDescriptionPreviewGiveawayData(opts, fallbackLanguage),
  );
}

/**
 * Format winner name with link to profile
 * @param user - User object with username, first_name, last_name, telegramId
 * @returns Formatted name with HTML link
 */
function formatWinnerName(user: WinnerUser): string {
  const name =
    [user.first_name, user.last_name].filter(Boolean).join(' ') ||
    user.username ||
    String(user.telegramId);
  return `<a href="tg://user?id=${user.telegramId}">${name}</a>`;
}

/**
 * Send winners announcement to channels
 * @param giveawayId - The giveaway ID
 * @returns Promise<{ success: number, failed: number }>
 */
export async function sendWinnersAnnouncement(
  giveawayId: string,
  channelFilter?: Set<bigint>,
  options?: { forcePublish?: boolean },
): Promise<{
  success: number;
  failed: number;
  messageIds: Map<number, bigint>;
}> {
  try {
    // Fetch giveaway with all participants and messages
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        participants: {
          where: {
            OR: [{ isWinner: true }, { isAddWinner: true }],
          },
          include: {
            user: {
              select: {
                username: true,
                first_name: true,
                last_name: true,
                telegramId: true,
              },
            },
            wonPrize: {
              select: {
                id: true,
                giftName: true,
                giftNumber: true,
                giftNftName: true,
                prizeType: true,
              },
            },
          },
          orderBy: [
            { isWinner: 'desc' },
            { winPlace: 'asc' },
            { addPlace: 'asc' },
          ],
        },
        messages: {
          include: {
            channel: {
              include: {
                addedBy: { select: { userId: true } },
              },
            },
          },
        },
        linkedChannels: {
          include: {
            channel: {
              include: {
                addedBy: { select: { userId: true } },
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
        prizes: GIVEAWAY_FORMAT_PRIZES_INCLUDE,
      },
    });

    if (!giveaway) {
      throw new Error('Giveaway not found');
    }

    const language = resolveGiveawayLanguage(giveaway.language);
    const isLottery = giveaway.participiationType === 'Lottery';
    const hasWinnerPrizes = giveawayHasWinnerPrizes(giveaway);

    // Total participants/tickets for check-results button (winners query above is filtered)
    const allParticipantRows = await prisma.participant.findMany({
      where: { giveawayId },
      select: { userId: true },
    });
    const participantCount = resolveParticipantCount({
      ...giveaway,
      participants: allParticipantRows as WinnerParticipant[],
    });

    let successCount = 0;
    let failedCount = 0;
    const messageIds = new Map<number, bigint>();

    // Single loop over all posted messages with per-channel effective settings
    for (const msg of giveaway.messages) {
      if (channelFilter && !channelFilter.has(msg.channelId)) {
        continue;
      }

      if (!msg.messageId) {
        console.warn(
          `No message ID found for channel ${msg.channelId}, skipping`,
        );
        continue;
      }

      const linkedChannel = findLinkedChannelForMessage(
        giveaway.linkedChannels,
        msg.channelId,
      );
      const channelAddedBy =
        linkedChannel?.channel.addedBy ?? msg.channel.addedBy ?? [];
      const isCreatorOwned = isGiveawayCreatorOwnedChannel(
        giveaway.createdById,
        channelAddedBy,
      );

      // Sponsor channels opt-in: skip if isPostingResults is false
      // Exception: bypass for channels explicitly targeted via channelFilter + forcePublish
      const isForcedChannel =
        options?.forcePublish && channelFilter?.has(msg.channelId);
      if (
        !isCreatorOwned &&
        !linkedChannel?.isPostingResults &&
        !isForcedChannel
      ) {
        continue;
      }

      // Resolve effective settings per channel
      const effectiveIsResultsInMainPost = isCreatorOwned
        ? giveaway.isResultsInMainPost
        : (linkedChannel?.isResultsInMainPost ?? giveaway.isResultsInMainPost);
      const effectiveIsCommentsOn = isCreatorOwned
        ? giveaway.isCommentsOn
        : (linkedChannel?.isCommentsOn ?? giveaway.isCommentsOn);

      // Build keyboard per channel: no keyboard when comments/hyperlink mode is on
      const channelKeyboard = effectiveIsCommentsOn
        ? undefined
        : buildWinnerAnnouncementKeyboard(
            giveawayId,
            giveaway,
            effectiveIsResultsInMainPost ? participantCount : undefined,
          );

      try {
        if (effectiveIsResultsInMainPost) {
          const winnerText = buildWinnerResultsBody(giveaway, {
            includeClaimHint: hasWinnerPrizes,
            includeClaimHyperlink: effectiveIsCommentsOn,
            wrapWinnersInBlockquote: true,
          });
          const checkResultsLink = effectiveIsCommentsOn
            ? buildCheckResultsHyperlinkSuffix(
                giveawayId,
                language,
                isLottery,
                participantCount,
              )
            : '';

          const originalContent = formatGiveawayMessage(giveaway);
          const updatedContent = `${originalContent}\n\n${winnerText}${checkResultsLink}`;

          const validBanners = (giveaway.banner || []).filter(
            (b: string) => b && b.trim() !== '',
          );

          // Detect message type:
          // - Animation: no banners (standard banner was used) + no media group
          // - Single photo: 1 banner + no media group
          const isStandardAnimation =
            validBanners.length === 0 && !msg.mediaGroupMessageId;
          const isSinglePhoto =
            validBanners.length === 1 && !msg.mediaGroupMessageId;

          let response;
          if (isStandardAnimation || isSinglePhoto) {
            // Both animations and single photos use captions - use editMessageCaption
            response = await queueTelegramRequest(() =>
              axios.post<TelegramApiResponse<{ message_id: number }>>(
                `${TELEGRAM_API_BASE}/editMessageCaption`,
                {
                  chat_id: msg.channelId.toString(),
                  message_id: Number(msg.messageId),
                  caption: updatedContent,
                  parse_mode: 'HTML',
                  ...(channelKeyboard
                    ? { reply_markup: { inline_keyboard: channelKeyboard } }
                    : { reply_markup: { inline_keyboard: [] } }),
                },
              ),
            );
          } else {
            // Text messages or separate posts use editMessageText
            response = await queueTelegramRequest(() =>
              axios.post<TelegramApiResponse<{ message_id: number }>>(
                `${TELEGRAM_API_BASE}/editMessageText`,
                {
                  chat_id: msg.channelId.toString(),
                  message_id: Number(msg.messageId),
                  text: updatedContent,
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                  ...(channelKeyboard
                    ? { reply_markup: { inline_keyboard: channelKeyboard } }
                    : { reply_markup: { inline_keyboard: [] } }),
                },
              ),
            );
          }

          if (response.data.ok) {
            successCount++;
            messageIds.set(msg.id, msg.messageId);
            console.log(
              `Updated main post with results for channel ${msg.channelId}`,
            );
          } else if (
            response.data.description?.includes('message is not modified')
          ) {
            // Rate-limit retry: original request already succeeded — results are already in the post
            successCount++;
            console.log(
              `Results already in main post for channel ${msg.channelId} (idempotent retry)`,
            );
          } else {
            failedCount++;
            console.error(
              `Failed to update main post for channel ${msg.channelId}: ${response.data.description}`,
            );
          }
        } else {
          let resultText = buildWinnerResultsBody(giveaway, {
            includeClaimHint: hasWinnerPrizes,
            includeClaimHyperlink: effectiveIsCommentsOn,
          });
          if (effectiveIsCommentsOn) {
            resultText += buildCheckResultsHyperlinkSuffix(
              giveawayId,
              language,
              isLottery,
            );
          }

          const response = await queueTelegramRequest(() =>
            axios.post<TelegramApiResponse<{ message_id: number }>>(
              `${TELEGRAM_API_BASE}/sendMessage`,
              {
                chat_id: msg.channelId.toString(),
                text: resultText,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_to_message_id: msg.messageId.toString(),
                ...(channelKeyboard && {
                  reply_markup: { inline_keyboard: channelKeyboard },
                }),
              },
            ),
          );

          if (response.data.ok && response.data.result?.message_id) {
            successCount++;
            messageIds.set(msg.id, BigInt(response.data.result.message_id));
            console.log(
              `Winner announcement sent to channel ${msg.channelId}, message_id: ${response.data.result.message_id}`,
            );
          } else {
            failedCount++;
            console.error(
              `Failed to send winners announcement to channel ${msg.channelId}: ${response.data.description}`,
            );
          }
        }
      } catch (error: any) {
        console.error(
          `Failed to send winners announcement to channel ${msg.channelId}:`,
          error.response?.data || error.message,
        );
        failedCount++;
      }
    }

    // Fallback when GiveawayMessage rows are missing (e.g. standart.mp4 send
    // returned message_id:0 and the DB row was never saved). Manual republish
    // and finish tasks previously no-op'd with success:0 / failed:0.
    if (successCount === 0 && giveaway.messages.length === 0) {
      console.warn(
        `[WinnersAnnouncement] No GiveawayMessage rows for ${giveawayId}; posting fresh results to linked channels`,
      );

      const fallbackChannels = giveaway.linkedChannels.filter((lc) => {
        if (lc.role === 'Subscription') return false;
        if (channelFilter && !channelFilter.has(lc.channelId)) return false;

        const channelAddedBy = lc.channel.addedBy ?? [];
        const isCreatorOwned = isGiveawayCreatorOwnedChannel(
          giveaway.createdById,
          channelAddedBy,
        );
        const isForcedChannel =
          options?.forcePublish && channelFilter?.has(lc.channelId);
        return (
          isCreatorOwned ||
          lc.isPostingResults ||
          isForcedChannel ||
          options?.forcePublish === true
        );
      });

      for (const lc of fallbackChannels) {
        const channelAddedBy = lc.channel.addedBy ?? [];
        const isCreatorOwned = isGiveawayCreatorOwnedChannel(
          giveaway.createdById,
          channelAddedBy,
        );
        const effectiveIsCommentsOn = isCreatorOwned
          ? giveaway.isCommentsOn
          : (lc.isCommentsOn ?? giveaway.isCommentsOn);

        const channelKeyboard = effectiveIsCommentsOn
          ? undefined
          : buildWinnerAnnouncementKeyboard(giveawayId, giveaway);

        let resultText = buildWinnerResultsBody(giveaway, {
          includeClaimHint: hasWinnerPrizes,
          includeClaimHyperlink: effectiveIsCommentsOn,
          wrapWinnersInBlockquote: false,
        });
        if (effectiveIsCommentsOn) {
          resultText += buildCheckResultsHyperlinkSuffix(
            giveawayId,
            language,
            isLottery,
          );
        }

        try {
          const sendResult = await sendMessage(lc.channelId, resultText, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: channelKeyboard
              ? { inline_keyboard: channelKeyboard }
              : undefined,
          });

          if (sendResult.success && sendResult.messageId) {
            successCount++;
            try {
              await prisma.giveawayMessage.create({
                data: {
                  giveawayId,
                  channelId: lc.channelId,
                  messageId: BigInt(sendResult.messageId),
                  winnerMessageId: BigInt(sendResult.messageId),
                },
              });
            } catch (dbError: any) {
              console.error(
                `[WinnersAnnouncement] Fallback posted but failed to save GiveawayMessage for channel ${lc.channelId}: ${dbError.message}`,
              );
            }
            console.log(
              `[WinnersAnnouncement] Fallback results posted to channel ${lc.channelId}, message_id: ${sendResult.messageId}`,
            );
          } else {
            failedCount++;
            console.error(
              `[WinnersAnnouncement] Fallback failed for channel ${lc.channelId}: ${sendResult.error}`,
            );
          }
        } catch (error: any) {
          failedCount++;
          console.error(
            `[WinnersAnnouncement] Fallback error for channel ${lc.channelId}:`,
            error.response?.data || error.message,
          );
        }
      }
    }

    // Store winner message IDs for any newly-sent separate posts
    if (messageIds.size > 0) {
      try {
        await storeWinnerMessageIds(messageIds);
      } catch (error) {
        console.error('Error storing winner message IDs:', error);
      }
    }

    return { success: successCount, failed: failedCount, messageIds };
  } catch (error: any) {
    console.error('Error sending winners announcement:', error);
    throw error;
  }
}

function resolveGiveawayLanguage(giveawayLanguage?: string | null): Language {
  if (!giveawayLanguage) return 'en';
  const lang = giveawayLanguage.toLowerCase();
  if (lang.startsWith('uk') || lang.startsWith('ua')) return 'ua';
  if (lang.startsWith('ru')) return 'ru';
  return 'en';
}

function giveawayHasWinnerPrizes(giveaway: GiveawayFormatData): boolean {
  return (
    giveaway.participants?.some(
      (p: WinnerParticipant) => p.isWinner && p.wonPrize?.id,
    ) ?? false
  );
}

function buildWinnerClaimBlockquote(
  giveaway: GiveawayFormatData,
  options: { includeClaimHint: boolean; includeClaimHyperlink: boolean },
): string {
  if (!giveawayHasWinnerPrizes(giveaway)) return '';

  const language = resolveGiveawayLanguage(giveaway.language);
  const messages = WINNERS_ANNOUNCEMENT_MESSAGES[language];
  const giftMsgs = GIFT_PRIZE_MESSAGES[language];
  const lines: string[] = [];

  if (options.includeClaimHint) {
    lines.push(messages.claimWindowHint);
  }

  if (options.includeClaimHyperlink) {
    const claimUrl = `${process.env.BOT_URL}?startapp=gifts`;
    lines.push(createHyperlink(giftMsgs.claimGift, claimUrl));
  }

  if (lines.length === 0) return '';

  return `<blockquote>${lines.join('\n')}</blockquote>`;
}

/** Winners list + optional claim blockquote (hint/link only — not the whole results text). */
function buildWinnerResultsBody(
  giveaway: GiveawayFormatData,
  options: {
    includeClaimHint: boolean;
    includeClaimHyperlink: boolean;
    wrapWinnersInBlockquote?: boolean;
  },
): string {
  let winnerText = buildWinnerAnnouncementText(giveaway);
  if (options.wrapWinnersInBlockquote) {
    winnerText = `<blockquote>${winnerText}</blockquote>`;
  }
  const claimBlockquote = buildWinnerClaimBlockquote(giveaway, options);
  return claimBlockquote ? `${winnerText}\n\n${claimBlockquote}` : winnerText;
}

function buildCheckResultsHyperlinkSuffix(
  giveawayId: string,
  language: Language,
  isLottery: boolean,
  participantCount?: number,
): string {
  const messages = WINNERS_ANNOUNCEMENT_MESSAGES[language];
  const typeMessages = isLottery ? messages.lottery : messages.giveaway;
  const webappLink = `${process.env.BOT_URL}?startapp=resultsId_${giveawayId}`;
  const countSuffix =
    participantCount == null
      ? ''
      : formatResultsCountSuffix(isLottery, participantCount);
  return `\n\n${createHyperlink(
    `${typeMessages.checkResultsWithIcon}${countSuffix}`,
    webappLink,
  )}`;
}

/**
 * Build winner announcement message text (extracted for reuse)
 * @param giveaway - Giveaway object with participants
 * @returns Formatted message text
 */
function buildWinnerAnnouncementText(giveaway: GiveawayFormatData): string {
  const language = resolveGiveawayLanguage(giveaway.language);

  const messages = WINNERS_ANNOUNCEMENT_MESSAGES[language];
  const isLottery = giveaway.participiationType === 'Lottery';
  const typeMessages = isLottery ? messages.lottery : messages.giveaway;

  const mainWinners =
    giveaway.participants?.filter((p: WinnerParticipant) => p.isWinner) ?? [];
  const additionalWinners =
    giveaway.participants?.filter((p: WinnerParticipant) => p.isAddWinner) ??
    [];

  const sections: string[] = [];
  sections.push(typeMessages.title);
  sections.push('');

  if (mainWinners.length > 0) {
    sections.push(`<b>${messages.winners}</b>`);

    if (giveaway.numerifyWinners) {
      mainWinners.forEach((winner: WinnerParticipant) => {
        const medal = getMedalEmoji(winner.winPlace);
        const name = formatWinnerName(winner.user);
        const prizeStr = winner.wonPrize?.giftName
          ? formatWinnerPrizeHtml(winner.wonPrize)
          : '';
        sections.push(`${medal}${name}${prizeStr}`);
      });
    } else {
      const names = mainWinners.map((w: WinnerParticipant) => {
        const name = formatWinnerName(w.user);
        const prizeStr = w.wonPrize?.giftName
          ? formatWinnerPrizeHtml(w.wonPrize)
          : '';
        return `${name}${prizeStr}`;
      });
      sections.push(names.join(', '));
    }
  }

  if (additionalWinners.length > 0) {
    sections.push('');
    sections.push(`<b>${messages.additionalWinners}</b>`);

    if (giveaway.numerifyWinners) {
      additionalWinners.forEach((winner: WinnerParticipant) => {
        const name = formatWinnerName(winner.user);
        sections.push(` ${winner.addPlace} ${name} • ${winner.range}`); // Space before number, no parentheses
      });
    } else {
      additionalWinners.forEach((winner: WinnerParticipant) => {
        const name = formatWinnerName(winner.user);
        sections.push(`${name} • ${winner.range}`);
      });
    }
  }

  return sections.join('\n');
}

/**
 * Generate button or hyperlink based on giveaway settings
 * @param giveaway - Giveaway object with settings
 * @param buttonText - The text to display
 * @param url - The URL to link to
 * @returns Inline keyboard object OR null (if hyperlink should be used)
 */
function generateButtonOrHyperlink(
  giveaway: GiveawayFormatData,
  buttonText: string,
  url: string,
): InlineKeyboardMarkup | null {
  // Use hyperlink if comments are enabled
  if (giveaway.isCommentsOn) {
    return null; // Caller should append hyperlink to message text
  }

  // Use button
  return buildParticipationKeyboard(giveaway, url);
}

/**
 * Create hyperlink HTML for message text
 * @param text - The text to display
 * @param url - The URL to link to
 * @returns HTML hyperlink string
 */
function createHyperlink(text: string, url: string): string {
  return `<a href="${url}">${text}</a>`;
}

/**
 * Build winner announcement inline keyboard (extracted for reuse)
 * @param giveawayId - Giveaway ID
 * @param giveaway - Giveaway object
 * @returns Inline keyboard array
 */
function buildWinnerAnnouncementKeyboard(
  giveawayId: string,
  giveaway: GiveawayFormatData,
  participantCount?: number,
): InlineKeyboardButton[][] {
  const webappLink = `${process.env.BOT_URL}?startapp=resultsId_${giveawayId}`;

  let language: Language = 'en';
  if (giveaway.language) {
    const lang = giveaway.language.toLowerCase();
    if (lang.startsWith('uk') || lang.startsWith('ua')) {
      language = 'ua';
    } else if (lang.startsWith('ru')) {
      language = 'ru';
    }
  }

  const messages = WINNERS_ANNOUNCEMENT_MESSAGES[language];
  const giftMsgs = GIFT_PRIZE_MESSAGES[language];
  const isLottery = giveaway.participiationType === 'Lottery';
  const typeMessages = isLottery ? messages.lottery : messages.giveaway;
  const countSuffix =
    participantCount == null
      ? ''
      : formatResultsCountSuffix(isLottery, participantCount);

  const keyboard: InlineKeyboardButton[][] = [
    [
      {
        text: `${typeMessages.checkResultsWithIcon}${countSuffix}`,
        url: webappLink,
        style: 'primary',
      },
    ],
  ];

  // Add "Claim Gift" button if any winners have a prize
  const winnersWithPrize =
    giveaway.participants?.filter(
      (p: WinnerParticipant) => p.isWinner && p.wonPrize?.id,
    ) ?? [];
  if (winnersWithPrize.length > 0) {
    keyboard.push([
      {
        text: giftMsgs.claimGift,
        url: `${process.env.BOT_URL}?startapp=gifts`,
      },
    ]);
  }

  return keyboard;
}

/**
 * Store winner message IDs in database
 * @param messageIds - Map of GiveawayMessage.id to Telegram message ID
 */
async function storeWinnerMessageIds(
  messageIds: Map<number, bigint>,
): Promise<void> {
  const updates = Array.from(messageIds.entries()).map(
    ([giveawayMessageId, telegramMessageId]) =>
      prisma.giveawayMessage.update({
        where: { id: giveawayMessageId },
        data: { winnerMessageId: telegramMessageId },
      }),
  );

  await Promise.all(updates);
  console.log(`Stored ${messageIds.size} winner message IDs`);
}

/**
 * Edit a specific winner message using Telegram's editMessageText API
 * @param channelId - Channel/chat ID
 * @param messageId - Message ID to edit
 * @param text - New message text
 * @param inlineKeyboard - Inline keyboard markup
 * @returns Promise with success status and update status
 */
async function editWinnerMessage(
  channelId: bigint,
  messageId: bigint,
  text: string,
  inlineKeyboard: InlineKeyboardButton[][],
): Promise<{ success: boolean; updated: boolean; error?: string }> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await queueTelegramRequest(() =>
      axios.post<TelegramApiResponse<any>>(
        `${TELEGRAM_API_BASE}/editMessageText`,
        {
          chat_id: channelId.toString(),
          message_id: Number(messageId),
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: inlineKeyboard ?? [],
          },
        },
        { timeout: 15000 },
      ),
    );

    if (response.data.ok) {
      console.log(
        `Successfully updated winner message ${messageId} in channel ${channelId}`,
      );
      return { success: true, updated: true };
    } else {
      // Handle "message is not modified" (same content)
      if (response.data.description?.includes('message is not modified')) {
        console.log(
          `Winner message ${messageId} in channel ${channelId} already has the same content`,
        );
        return { success: true, updated: false };
      }

      console.error(
        `Telegram API error editing message ${messageId} in channel ${channelId}: ${response.data.description}`,
      );
      return {
        success: false,
        updated: false,
        error: response.data.description,
      };
    }
  } catch (error: any) {
    const errorCode = error.response?.data?.error_code;
    const description = error.response?.data?.description;

    // Handle specific error cases
    if (
      errorCode === 400 &&
      description?.includes('message to edit not found')
    ) {
      console.error(
        `Message ${messageId} not found in channel ${channelId} - it may have been deleted`,
      );
      return { success: false, updated: false, error: 'message_not_found' };
    } else if (
      errorCode === 400 &&
      description?.includes("message can't be edited")
    ) {
      console.error(
        `Message ${messageId} in channel ${channelId} is too old to edit (>48h)`,
      );
      return { success: false, updated: false, error: 'message_too_old' };
    } else if (errorCode === 403) {
      console.error(
        `Bot lost permissions to edit messages in channel ${channelId}`,
      );
      return { success: false, updated: false, error: 'no_permissions' };
    } else if (errorCode === 429) {
      console.error(
        `Rate limited when trying to edit message ${messageId} - should retry later`,
      );
      return { success: false, updated: false, error: 'rate_limited' };
    }

    console.error(
      `Error editing message ${messageId} in channel ${channelId}:`,
      error.message,
    );
    return { success: false, updated: false, error: error.message };
  }
}

/**
 * Update existing winner announcement messages in all channels
 * @param giveawayId - The giveaway ID
 * @returns Promise with statistics about the update operation
 */
export async function updateWinnersAnnouncement(giveawayId: string): Promise<{
  success: number;
  failed: number;
  updated: number;
  notFound: number;
}> {
  try {
    // Fetch giveaway with all participants and messages (including winnerMessageId)
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        participants: {
          where: {
            OR: [{ isWinner: true }, { isAddWinner: true }],
          },
          include: {
            user: {
              select: {
                username: true,
                first_name: true,
                last_name: true,
                telegramId: true,
              },
            },
            wonPrize: {
              select: {
                id: true,
                giftName: true,
                giftNumber: true,
                giftNftName: true,
                prizeType: true,
              },
            },
          },
          orderBy: [
            { isWinner: 'desc' },
            { winPlace: 'asc' },
            { addPlace: 'asc' },
          ],
        },
        messages: {
          include: {
            channel: {
              include: {
                addedBy: { select: { userId: true } },
              },
            },
          },
        },
        linkedChannels: {
          include: {
            channel: {
              include: {
                addedBy: { select: { userId: true } },
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
        prizes: GIVEAWAY_FORMAT_PRIZES_INCLUDE,
      },
    });

    if (!giveaway) {
      throw new Error('Giveaway not found');
    }

    const language = resolveGiveawayLanguage(giveaway.language);
    const isLottery = giveaway.participiationType === 'Lottery';
    const hasWinnerPrizes = giveawayHasWinnerPrizes(giveaway);
    const updPrefix = WINNERS_UPDATED_MESSAGES[language];
    const originalContent = formatGiveawayMessage(giveaway);

    const allParticipantRows = await prisma.participant.findMany({
      where: { giveawayId },
      select: { userId: true },
    });
    const participantCount = resolveParticipantCount({
      ...giveaway,
      participants: allParticipantRows as WinnerParticipant[],
    });

    let successCount = 0;
    let failedCount = 0;
    let updatedCount = 0;
    let notFoundCount = 0;

    for (const msg of giveaway.messages) {
      const linkedChannel = findLinkedChannelForMessage(
        giveaway.linkedChannels,
        msg.channelId,
      );
      const channelAddedBy =
        linkedChannel?.channel.addedBy ?? msg.channel.addedBy ?? [];
      const isCreatorOwned = isGiveawayCreatorOwnedChannel(
        giveaway.createdById,
        channelAddedBy,
      );

      if (!isCreatorOwned && !linkedChannel?.isPostingResults) {
        continue;
      }

      const effectiveIsResultsInMainPost = isCreatorOwned
        ? giveaway.isResultsInMainPost
        : (linkedChannel?.isResultsInMainPost ?? giveaway.isResultsInMainPost);
      const effectiveIsCommentsOn = isCreatorOwned
        ? giveaway.isCommentsOn
        : (linkedChannel?.isCommentsOn ?? giveaway.isCommentsOn);
      const channelKeyboard = effectiveIsCommentsOn
        ? undefined
        : buildWinnerAnnouncementKeyboard(
            giveawayId,
            giveaway,
            effectiveIsResultsInMainPost ? participantCount : undefined,
          );

      if (effectiveIsResultsInMainPost) {
        if (!msg.messageId) {
          notFoundCount++;
          console.log(`No message ID for channel ${msg.channelId} - skipping`);
          continue;
        }

        const winnerText = `${updPrefix}\n\n${buildWinnerResultsBody(giveaway, {
          includeClaimHint: hasWinnerPrizes,
          includeClaimHyperlink: effectiveIsCommentsOn,
          wrapWinnersInBlockquote: true,
        })}`;
        const checkResultsLink = effectiveIsCommentsOn
          ? buildCheckResultsHyperlinkSuffix(
              giveawayId,
              language,
              isLottery,
              participantCount,
            )
          : '';

        try {
          const updatedContent = `${originalContent}\n\n${winnerText}${checkResultsLink}`;

          const validBanners = (giveaway.banner || []).filter(
            (b: string) => b && b.trim() !== '',
          );

          const isStandardAnimation =
            validBanners.length === 0 && !msg.mediaGroupMessageId;
          const isSinglePhoto =
            validBanners.length === 1 && !msg.mediaGroupMessageId;

          let response: any;
          if (isStandardAnimation || isSinglePhoto) {
            response = await queueTelegramRequest(() =>
              axios.post<TelegramApiResponse<{ message_id: number }>>(
                `${TELEGRAM_API_BASE}/editMessageCaption`,
                {
                  chat_id: msg.channelId.toString(),
                  message_id: Number(msg.messageId),
                  caption: updatedContent,
                  parse_mode: 'HTML',
                  reply_markup: channelKeyboard
                    ? { inline_keyboard: channelKeyboard }
                    : { inline_keyboard: [] },
                },
              ),
            );
          } else {
            response = await queueTelegramRequest(() =>
              axios.post<TelegramApiResponse<{ message_id: number }>>(
                `${TELEGRAM_API_BASE}/editMessageText`,
                {
                  chat_id: msg.channelId.toString(),
                  message_id: Number(msg.messageId),
                  text: updatedContent,
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                  reply_markup: channelKeyboard
                    ? { inline_keyboard: channelKeyboard }
                    : { inline_keyboard: [] },
                },
              ),
            );
          }

          if (response.data.ok) {
            successCount++;
            updatedCount++;
            console.log(
              `Updated main post with new results for channel ${msg.channelId}`,
            );
          } else {
            failedCount++;
            console.error(
              `Failed to update main post for channel ${msg.channelId}: ${response.data.description}`,
            );
          }
        } catch (error: any) {
          console.error(
            `Failed to update main post for channel ${msg.channelId}:`,
            error.response?.data || error.message,
          );
          failedCount++;
        }

        continue;
      }

      if (!msg.winnerMessageId) {
        notFoundCount++;
        console.log(
          `No winner message to update for channel ${msg.channelId} - skipping`,
        );
        continue;
      }

      try {
        let resultText = `${updPrefix}\n\n${buildWinnerResultsBody(giveaway, {
          includeClaimHint: hasWinnerPrizes,
          includeClaimHyperlink: effectiveIsCommentsOn,
        })}`;
        if (effectiveIsCommentsOn) {
          resultText += buildCheckResultsHyperlinkSuffix(
            giveawayId,
            language,
            isLottery,
          );
        }

        const result = await editWinnerMessage(
          msg.channelId,
          msg.winnerMessageId,
          resultText,
          channelKeyboard,
        );

        if (result.success) {
          if (result.updated) {
            updatedCount++;
          }
          successCount++;
        } else {
          failedCount++;
        }
      } catch (error: any) {
        console.error(
          `Failed to update winner message in channel ${msg.channelId}:`,
          error,
        );
        failedCount++;
      }
    }

    console.log(
      `Winner announcement update: ${updatedCount} updated, ${successCount} total success, ${failedCount} failed, ${notFoundCount} not found`,
    );

    return {
      success: successCount,
      failed: failedCount,
      updated: updatedCount,
      notFound: notFoundCount,
    };
  } catch (error: any) {
    console.error('Error updating winners announcement:', error);
    throw error;
  }
}

/**
 * Escape plain user text for Telegram HTML parse_mode (cancel reasons, etc.).
 */
function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Update giveaway messages in all channels to show cancellation
 * Changes button text and appends cancel reason blockquote
 * @param giveawayId - The cancelled giveaway ID
 * @param cancelDescription - The localized cancellation reason
 * @returns Promise<{ success: number; failed: number }>
 */
export async function updateCancelledGiveawayMessages(
  giveawayId: string,
  cancelDescription: string,
): Promise<{ success: number; failed: number }> {
  try {
    // Fetch giveaway with messages and channels
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        messages: {
          include: {
            channel: true,
          },
        },
        participants: true,
        linkedChannels: {
          include: {
            channel: {
              include: {
                addedBy: { select: { userId: true } },
              },
            },
          },
        },
      },
    });

    if (!giveaway) {
      throw new Error('Giveaway not found');
    }

    // Get language for this giveaway
    const language = normalizeGiveawayLanguage(giveaway.language);
    const cancelMessages = GIVEAWAY_CANCEL_MESSAGES[language];

    // Generate updated message content
    const webappLink = `${process.env.BOT_URL}?startapp=giveawayId_${giveawayId}`;
    const originalMessage = formatGiveawayMessage(giveaway);

    // Escape user/default cancel text so HTML parse_mode does not break the edit
    const safeCancelDescription = escapeTelegramHtml(cancelDescription);
    const cancelBlockquote = `\n\n<blockquote><b>${cancelMessages.cancelReason}</b>\n${safeCancelDescription}</blockquote>`;
    const updatedMessage = originalMessage + cancelBlockquote;

    // Cancelled post button: shared builder (red style, label without status emoji)
    const cancelledKeyboard = buildParticipationKeyboard(giveaway, webappLink);

    let successCount = 0;
    let failedCount = 0;

    if (giveaway.messages.length === 0) {
      console.warn(
        `[Cancel] No stored messages found for giveaway ${giveawayId} — Telegram posts will NOT be updated`,
      );
    }

    // Update each channel message
    for (const msg of giveaway.messages) {
      try {
        let updateResult: { success: boolean; error?: string };

        const banners = giveaway.banner || [];
        const validBanners = banners.filter(
          (b: string) => b && b.trim() !== '',
        );

        // Same media detection as finish/results posting:
        // - no banners → standart.mp4 animation (caption)
        // - 1 banner → photo/gif (caption)
        // - media group / multi → separate text message
        const isCaptionPost =
          (validBanners.length === 0 || validBanners.length === 1) &&
          !msg.mediaGroupMessageId;

        if (isCaptionPost) {
          updateResult = await editCaptionMessage(
            msg.channelId,
            msg.messageId,
            updatedMessage,
            cancelledKeyboard,
          );
        } else {
          // Multiple banners: messageId points to the text message with buttons
          updateResult = await editTextMessage(
            msg.channelId,
            msg.messageId,
            updatedMessage,
            cancelledKeyboard,
          );
        }

        if (updateResult.success) {
          successCount++;
        } else {
          failedCount++;
          console.error(
            `[Cancel] Failed to update message ${msg.messageId} in channel ${msg.channelId}: ${updateResult.error}`,
          );
        }
      } catch (error: any) {
        console.error(
          `Failed to update cancelled message in channel ${msg.channelId}:`,
          error,
        );
        failedCount++;
      }
    }

    console.log(
      `Cancelled giveaway message update: ${successCount} success, ${failedCount} failed`,
    );

    return { success: successCount, failed: failedCount };
  } catch (error: any) {
    console.error('Error updating cancelled giveaway messages:', error);
    throw error;
  }
}

/**
 * Edit a text message (no photo)
 */
async function editTextMessage(
  channelId: bigint,
  messageId: bigint,
  text: string,
  keyboard: InlineKeyboardMarkup,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await queueTelegramRequest(() =>
      axios.post<TelegramApiResponse<any>>(
        `${TELEGRAM_API_BASE}/editMessageText`,
        {
          chat_id: channelId.toString(),
          message_id: Number(messageId),
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard,
        },
        { timeout: 15000 },
      ),
    );

    if (response.data.ok) {
      console.log(
        `Successfully updated text message ${messageId} in channel ${channelId}`,
      );
      return { success: true };
    } else {
      // Handle "message is not modified" (same content)
      if (response.data.description?.includes('message is not modified')) {
        console.log(`Message ${messageId} already has the same content`);
        return { success: true };
      }

      console.error(`Telegram API error: ${response.data.description}`);
      return { success: false, error: response.data.description };
    }
  } catch (error: any) {
    const errorCode = error.response?.data?.error_code;
    const description = error.response?.data?.description;

    // Handle specific error cases
    if (
      errorCode === 400 &&
      description?.includes('message to edit not found')
    ) {
      console.error(`Message ${messageId} not found - may have been deleted`);
      return { success: false, error: 'message_not_found' };
    } else if (
      errorCode === 400 &&
      description?.includes("message can't be edited")
    ) {
      console.error(`Message ${messageId} is too old to edit (>48h)`);
      return { success: false, error: 'message_too_old' };
    } else if (errorCode === 403) {
      console.error(`Bot lost permissions in channel ${channelId}`);
      return { success: false, error: 'no_permissions' };
    }

    console.error(
      `Error editing text message ${messageId}:`,
      description || error.message,
    );
    return { success: false, error: description || error.message };
  }
}

/**
 * Edit a photo message (with media)
 */
async function editPhotoMessage(
  channelId: bigint,
  messageId: bigint,
  photoUrl: string,
  caption: string,
  keyboard: InlineKeyboardMarkup,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await queueTelegramRequest(() =>
      axios.post<TelegramApiResponse<any>>(
        `${TELEGRAM_API_BASE}/editMessageMedia`,
        {
          chat_id: channelId.toString(),
          message_id: Number(messageId),
          media: {
            type: 'photo',
            media: toAbsoluteUrl(photoUrl),
            caption: caption,
            parse_mode: 'HTML',
          },
          reply_markup: keyboard,
        },
        { timeout: 15000 },
      ),
    );

    if (response.data.ok) {
      console.log(
        `Successfully updated photo message ${messageId} in channel ${channelId}`,
      );
      return { success: true };
    } else {
      // Handle "message is not modified"
      if (response.data.description?.includes('message is not modified')) {
        console.log(`Message ${messageId} already has the same content`);
        return { success: true };
      }

      console.error(`Telegram API error: ${response.data.description}`);
      return { success: false, error: response.data.description };
    }
  } catch (error: any) {
    const errorCode = error.response?.data?.error_code;
    const description = error.response?.data?.description;

    if (
      errorCode === 400 &&
      description?.includes('message to edit not found')
    ) {
      console.error(`Message ${messageId} not found - may have been deleted`);
      return { success: false, error: 'message_not_found' };
    } else if (
      errorCode === 400 &&
      description?.includes("message can't be edited")
    ) {
      console.error(`Message ${messageId} is too old to edit (>48h)`);
      return { success: false, error: 'message_too_old' };
    } else if (errorCode === 403) {
      console.error(`Bot lost permissions in channel ${channelId}`);
      return { success: false, error: 'no_permissions' };
    }

    console.error(`Error editing photo message ${messageId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Edit only the caption and keyboard of an existing photo/animation message
 * without re-uploading the media. Use this instead of editMessageMedia when
 * only text or buttons need updating (avoids URL expiry issues).
 */
async function editCaptionMessage(
  channelId: bigint,
  messageId: bigint,
  caption: string,
  keyboard: InlineKeyboardMarkup,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN environment variable is not set');
    }

    const response = await queueTelegramRequest(() =>
      axios.post<TelegramApiResponse<any>>(
        `${TELEGRAM_API_BASE}/editMessageCaption`,
        {
          chat_id: channelId.toString(),
          message_id: Number(messageId),
          caption: caption,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        },
        { timeout: 15000 },
      ),
    );

    if (response.data.ok) {
      console.log(
        `Successfully updated caption of message ${messageId} in channel ${channelId}`,
      );
      return { success: true };
    } else {
      if (response.data.description?.includes('message is not modified')) {
        console.log(`Message ${messageId} already has the same content`);
        return { success: true };
      }
      console.error(`Telegram API error: ${response.data.description}`);
      return { success: false, error: response.data.description };
    }
  } catch (error: any) {
    const errorCode = error.response?.data?.error_code;
    const description = error.response?.data?.description;

    if (
      errorCode === 400 &&
      description?.includes('message to edit not found')
    ) {
      console.error(`Message ${messageId} not found - may have been deleted`);
      return { success: false, error: 'message_not_found' };
    } else if (
      errorCode === 400 &&
      description?.includes("message can't be edited")
    ) {
      console.error(`Message ${messageId} is too old to edit (>48h)`);
      return { success: false, error: 'message_too_old' };
    } else if (errorCode === 403) {
      console.error(`Bot lost permissions in channel ${channelId}`);
      return { success: false, error: 'no_permissions' };
    }

    console.error(
      `Error editing caption of message ${messageId}:`,
      error.message,
    );
    return { success: false, error: error.message };
  }
}

function resolveMediaGroupAlbumMessageIds(
  knownIds: bigint[],
  photoCount: number,
): bigint[] {
  if (photoCount <= 0 || knownIds.length === 0) {
    return [];
  }
  if (knownIds.length >= photoCount) {
    return knownIds.slice(0, photoCount);
  }
  // Linked channels store only the first album message id; Telegram assigns consecutive ids.
  const first = knownIds[0];
  return Array.from(
    { length: photoCount },
    (_, index) => first + BigInt(index),
  );
}

async function editAlbumPhotoMessage(
  channelId: bigint,
  messageId: bigint,
  photoUrl: string,
): Promise<{ success: boolean; error?: string }> {
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN environment variable is not set');
  }

  const response = await queueTelegramRequest(() =>
    axios.post<TelegramApiResponse<any>>(
      `${TELEGRAM_API_BASE}/editMessageMedia`,
      {
        chat_id: channelId.toString(),
        message_id: Number(messageId),
        media: {
          type: 'photo',
          media: toAbsoluteUrl(photoUrl),
        },
      },
      { timeout: 15000 },
    ),
  );

  if (response.data.ok) {
    return { success: true };
  }

  const description = response.data.description || 'Unknown API error';
  if (description.includes('message is not modified')) {
    return { success: true };
  }

  return { success: false, error: description };
}

/**
 * Update every photo in a Telegram media-group album.
 * @param albumMessageIds - Known album message ids (postlot stores all; linked may store only the first)
 * @param photos - Array of photo URLs
 */
async function updateMediaGroupPhotos(
  channelId: bigint,
  albumMessageIds: bigint[],
  photos: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    if (photos.length === 0) {
      return { success: false, error: 'No photos provided' };
    }

    const resolvedIds = resolveMediaGroupAlbumMessageIds(
      albumMessageIds,
      photos.length,
    );
    if (resolvedIds.length !== photos.length) {
      return {
        success: false,
        error: `Expected ${photos.length} album message id(s), got ${resolvedIds.length}`,
      };
    }

    for (let index = 0; index < photos.length; index++) {
      const result = await editAlbumPhotoMessage(
        channelId,
        resolvedIds[index],
        photos[index],
      );
      if (!result.success) {
        console.error(
          `Failed to update media group photo ${index + 1}/${photos.length} (message ${resolvedIds[index]}) in channel ${channelId}: ${result.error}`,
        );
        return result;
      }
    }

    console.log(
      `Successfully updated ${photos.length} photo(s) in media group for channel ${channelId}`,
    );
    return { success: true };
  } catch (error: any) {
    const description = error.response?.data?.description;
    console.error(
      `Error updating media group in channel ${channelId}: ${description || error.message}`,
    );
    return {
      success: false,
      error: description || error.message || 'Unknown error',
    };
  }
}

/**
 * Send giveaway announcement to connected channels with formatted message
 * @param giveawayId - The giveaway ID for the webapp start parameter
 * @param webappUrl - Base URL of the webapp
 * @returns Promise<{ success: number, failed: number, results: Array<{channelId: bigint, success: boolean}> }>
 */
export async function sendGiveawayAnnouncement(
  giveawayId: string,
  webappUrl: string,
  excludeChannelIds?: bigint[],
): Promise<{
  success: number;
  failed: number;
  results: Array<{ channelId: bigint; success: boolean; error?: string }>;
}> {
  // VALIDATION: Check if webappUrl is provided
  if (!webappUrl) {
    console.error('sendGiveawayAnnouncement: Missing webappUrl parameter');
    return {
      success: 0,
      failed: 0,
      results: [],
    };
  }

  // VALIDATION: Check if webappUrl is a valid URL
  try {
    new URL(webappUrl);
  } catch (_error) {
    console.error('sendGiveawayAnnouncement: Invalid webappUrl:', webappUrl);
    return {
      success: 0,
      failed: 0,
      results: [],
    };
  }

  const results: Array<{
    channelId: bigint;
    success: boolean;
    error?: string;
  }> = [];
  let successCount = 0;
  let failedCount = 0;

  try {
    // Fetch giveaway data with related information
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
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
        participants: true,
        prizes: GIVEAWAY_LINKED_ONLY_PRIZES_INCLUDE,
      },
    });

    if (!giveaway) {
      throw new Error(`Giveaway with ID ${giveawayId} not found`);
    }

    // Get channels to send the announcement to (excluding sponsor channels if specified)
    const excludeSet = excludeChannelIds
      ? new Set(excludeChannelIds.map((id) => id.toString()))
      : new Set<string>();

    const channels = giveaway.linkedChannels
      .filter(
        (lc) =>
          (lc.role === 'All' || lc.role === 'Posting') &&
          !excludeSet.has(lc.channel.id.toString()),
      )
      .map((lc) => ({
        id: lc.channel.id,
        title: lc.channel.title,
        username: lc.channel.username,
        inviteLink: lc.channel.inviteLink,
        type: lc.channel.type,
      }));

    if (channels.length === 0) {
      return {
        success: 0,
        failed: 0,
        results: [],
      };
    }

    // Refresh invite links for all channels before sending announcement
    console.log(
      `[Announcement] Refreshing invite links for ${channels.length} channel(s)...`,
    );
    const inviteLinkRefreshPromises = channels.map(async (channel) => {
      try {
        // Skip if channel has a username (public channels don't need invite links)
        if (channel.username) {
          console.log(
            `[Announcement] Channel ${channel.id} has username @${channel.username}, skipping invite link refresh`,
          );
          return;
        }

        // Generate fresh invite link
        const freshInviteLink = await generateInviteLink(channel.id);

        if (freshInviteLink) {
          // Update channel in database with fresh link
          await prisma.channel.update({
            where: { id: channel.id },
            data: { inviteLink: freshInviteLink },
          });

          // Update the channel object with fresh link
          channel.inviteLink = freshInviteLink;

          console.log(
            `[Announcement] Successfully refreshed invite link for channel ${channel.id}`,
          );
        } else {
          console.warn(
            `[Announcement] Failed to generate invite link for channel ${channel.id}`,
          );
        }
      } catch (error: any) {
        console.error(
          `[Announcement] Error refreshing invite link for channel ${channel.id}:`,
          error.message,
        );
        // Continue with existing link if refresh fails
      }
    });

    // Wait for all invite link refreshes to complete
    await Promise.all(inviteLinkRefreshPromises);
    console.log(`[Announcement] Invite link refresh completed`);

    // Format the message content
    const messageContent = formatGiveawayMessage(giveaway);

    // Create the webapp link with giveaway start parameter
    const webappLink = `${webappUrl}?startapp=giveawayId_${giveawayId}`;

    // Giveaway posts ALWAYS use inline button (isCommentsOn only affects results)
    const inlineKeyboard = buildParticipationKeyboard(giveaway, webappLink);

    const finalMessageContent = messageContent;

    // Send message to each channel
    const promises = channels.map(async (channel) => {
      try {
        let sendResult: {
          success: boolean;
          messageId?: number;
          messageIds?: number[];
          error?: string;
        };

        // Determine how to send based on banner count
        const banners = giveaway.banner || [];
        const validBanners = banners.filter(
          (b: string) => b && b.trim() !== '',
        );

        // For Telegram channels, use entities array instead of HTML parse_mode.
        // HTML parse_mode requires the bot to own the emoji pack for <tg-emoji> to render,
        // whereas entities resolves custom emoji via the viewer's installed packs (works universally).
        const isChannel = channel.type === 'channel';
        const entitiesResult = isChannel
          ? htmlToEntities(finalMessageContent)
          : null;
        const channelText = entitiesResult
          ? entitiesResult.text
          : finalMessageContent;
        const captionEntities = entitiesResult?.entities?.length
          ? entitiesResult.entities
          : undefined;

        if (validBanners.length === 0) {
          // No banners: Send standart gif animation with caption
          sendResult = await sendAnimation(
            channel.id,
            '/static/giveaways/standart.mp4',
            channelText,
            {
              ...(captionEntities
                ? { caption_entities: captionEntities }
                : { parse_mode: 'HTML' }),
              reply_markup: inlineKeyboard || undefined,
            },
          );
        } else if (validBanners.length === 1) {
          // Single banner: Send photo or animation (GIF)
          const singleBanner = validBanners[0];
          sendResult = isGifUrl(singleBanner)
            ? await sendAnimation(channel.id, singleBanner, channelText, {
                ...(captionEntities
                  ? { caption_entities: captionEntities }
                  : { parse_mode: 'HTML' }),
                reply_markup: inlineKeyboard || undefined,
              })
            : await sendPhoto(channel.id, singleBanner, channelText, {
                ...(captionEntities
                  ? { caption_entities: captionEntities }
                  : { parse_mode: 'HTML' }),
                disable_web_page_preview: true,
                reply_markup: inlineKeyboard || undefined,
              });
        } else {
          // Multiple banners: Send media group WITHOUT caption, then text WITH buttons
          const mediaGroupResult = await sendMediaGroup(
            channel.id,
            validBanners,
            undefined, // БЕЗ caption
            {
              parse_mode: 'HTML',
              disable_notification: false,
            },
          );

          let textMessageId: number | undefined;
          if (
            mediaGroupResult.success &&
            mediaGroupResult.messageIds?.length > 0
          ) {
            const textMessageResult = await sendMessage(
              channel.id,
              channelText,
              {
                ...(captionEntities
                  ? { entities: captionEntities }
                  : { parse_mode: 'HTML' }),
                disable_web_page_preview: true,
                reply_markup: inlineKeyboard || undefined,
              },
            );

            if (textMessageResult.success && textMessageResult.messageId) {
              textMessageId = textMessageResult.messageId;
            } else {
              console.error(
                `Failed to send text after media group for channel ${channel.id}: ${textMessageResult.error}`,
              );
            }
          }

          sendResult = {
            success: mediaGroupResult.success,
            messageId: textMessageId,
            messageIds: mediaGroupResult.messageIds,
            error: mediaGroupResult.error,
          };
        }

        // Fallback: if Telegram rejected due to invalid HTML entities, retry with plain text
        if (
          !sendResult.success &&
          sendResult.error?.includes("can't parse entities")
        ) {
          const plainContent = stripHtmlTags(finalMessageContent);
          if (validBanners.length === 0) {
            sendResult = await sendAnimation(
              channel.id,
              '/static/giveaways/standart.mp4',
              plainContent,
              { reply_markup: inlineKeyboard || undefined },
            );
          } else if (validBanners.length === 1) {
            const singleBanner = validBanners[0];
            sendResult = isGifUrl(singleBanner)
              ? await sendAnimation(channel.id, singleBanner, plainContent, {
                  reply_markup: inlineKeyboard || undefined,
                })
              : await sendPhoto(channel.id, singleBanner, plainContent, {
                  disable_web_page_preview: true,
                  reply_markup: inlineKeyboard || undefined,
                });
          } else {
            // Media group already sent; only the text message needs a retry
            const textRetry = await sendMessage(channel.id, plainContent, {
              disable_web_page_preview: true,
              reply_markup: inlineKeyboard || undefined,
            });
            if (textRetry.success)
              sendResult = { success: true, messageId: textRetry.messageId };
          }
          if (sendResult.success) {
            console.log(
              `[Announcement] Retried giveaway ${giveawayId} to channel ${channel.id} with plain text (HTML was invalid)`,
            );
          }
        }

        const hasTrackableMessage =
          sendResult.success &&
          ((sendResult.messageIds && sendResult.messageIds.length > 0) ||
            (typeof sendResult.messageId === 'number' &&
              sendResult.messageId > 0));

        const result = {
          channelId: channel.id,
          success: !!hasTrackableMessage,
          error: hasTrackableMessage
            ? undefined
            : sendResult.error ||
              (sendResult.success
                ? 'Telegram returned ok without a valid message_id'
                : 'Failed to send message'),
        };

        results.push(result);

        if (hasTrackableMessage) {
          successCount++;

          // Save message ID(s) to database
          if (sendResult.messageIds && sendResult.messageIds.length > 0) {
            // Media group with separate text message
            try {
              await prisma.giveawayMessage.create({
                data: {
                  giveawayId: giveawayId,
                  channelId: channel.id,
                  messageId: sendResult.messageId
                    ? BigInt(sendResult.messageId)
                    : BigInt(sendResult.messageIds[0]),
                  mediaGroupMessageId: BigInt(sendResult.messageIds[0]),
                },
              });
              console.log(
                `Saved media group (first ID: ${sendResult.messageIds[0]}) ` +
                  `and text message (ID: ${sendResult.messageId}) for channel ${channel.id}`,
              );
            } catch (dbError: any) {
              console.error(
                `[GiveawayMessage] Failed to save media group record — giveaway ${giveawayId}, channel ${channel.id}: ${dbError.message}`,
              );
            }
          } else if (
            typeof sendResult.messageId === 'number' &&
            sendResult.messageId > 0
          ) {
            // Single message (photo, animation, or text)
            try {
              await prisma.giveawayMessage.create({
                data: {
                  giveawayId: giveawayId,
                  channelId: channel.id,
                  messageId: BigInt(sendResult.messageId),
                },
              });
            } catch (dbError: any) {
              console.error(
                `[GiveawayMessage] Failed to save message record — giveaway ${giveawayId}, channel ${channel.id}, messageId ${sendResult.messageId}: ${dbError.message}`,
              );
            }
          }
        } else {
          failedCount++;
        }

        return result;
      } catch (error: any) {
        const result = {
          channelId: channel.id,
          success: false,
          error: error.message || 'Unknown error',
        };

        results.push(result);
        failedCount++;
        return result;
      }
    });

    // Wait for all messages to be sent
    await Promise.all(promises);

    console.log(
      `[Announcement] Giveaway ${giveawayId} announcements sent: ${successCount} successful, ${failedCount} failed`,
    );

    // Log detailed errors for failures
    if (failedCount > 0) {
      console.error('[Announcement] Failed channels:');
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.error(`  - Channel ${r.channelId}: ${r.error}`);
        });
    }

    return {
      success: successCount,
      failed: failedCount,
      results,
    };
  } catch (error: any) {
    console.error('Error sending giveaway announcement:', error);
    throw error;
  }
}

/**
 * Re-post a giveaway message to a specific channel (used when original message was deleted)
 * @param giveawayId - The giveaway ID
 * @param channelId - The channel ID to re-post to
 * @param webappUrl - Base URL of the webapp
 * @returns Promise<{ success: boolean; messageId?: number; error?: string }>
 */
export async function repostGiveawayToChannel(
  giveawayId: string,
  channelId: bigint,
  webappUrl: string,
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  try {
    // Fetch giveaway data with all required relations
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
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
        participants: true,
        prizes: GIVEAWAY_LINKED_ONLY_PRIZES_INCLUDE,
      },
    });

    if (!giveaway) {
      return { success: false, error: 'Giveaway not found' };
    }

    // Format the message content
    const messageContent = formatGiveawayMessage(giveaway);

    // Create the webapp link with giveaway start parameter
    const webappLink = `${webappUrl}?startapp=giveawayId_${giveawayId}`;

    // Giveaway posts ALWAYS use inline button (isCommentsOn only affects results)
    const inlineKeyboard = buildParticipationKeyboard(giveaway, webappLink);

    const finalMessageContent = messageContent;

    let sendResult: {
      success: boolean;
      messageId?: number;
      messageIds?: number[];
      error?: string;
    };

    // Determine how to send based on banner count
    const banners = giveaway.banner || [];
    const validBanners = banners.filter((b: string) => b && b.trim() !== '');

    if (validBanners.length === 0) {
      // No banners: Send standart gif animation with caption
      sendResult = await sendAnimation(
        channelId,
        '/static/giveaways/standart.mp4',
        finalMessageContent,
        {
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard || undefined,
        },
      );
    } else if (validBanners.length === 1) {
      // Single banner: Send photo or animation (GIF)
      const singleBanner = validBanners[0];
      sendResult = isGifUrl(singleBanner)
        ? await sendAnimation(channelId, singleBanner, finalMessageContent, {
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard || undefined,
          })
        : await sendPhoto(channelId, singleBanner, finalMessageContent, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: inlineKeyboard || undefined,
          });
    } else {
      // Multiple banners: Send media group WITHOUT caption, then text WITH buttons
      const mediaGroupResult = await sendMediaGroup(
        channelId,
        validBanners,
        undefined,
        {
          parse_mode: 'HTML',
          disable_notification: false,
        },
      );

      let textMessageId: number | undefined;
      if (mediaGroupResult.success && mediaGroupResult.messageIds?.length > 0) {
        const textMessageResult = await sendMessage(channelId, messageContent, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: inlineKeyboard || undefined,
        });

        if (textMessageResult.success && textMessageResult.messageId) {
          textMessageId = textMessageResult.messageId;
        }
      }

      sendResult = {
        success: mediaGroupResult.success,
        messageId: textMessageId,
        messageIds: mediaGroupResult.messageIds,
        error: mediaGroupResult.error,
      };
    }

    // Fallback: if Telegram rejected due to invalid HTML entities, retry with plain text
    if (
      !sendResult.success &&
      sendResult.error?.includes("can't parse entities")
    ) {
      const plainContent = stripHtmlTags(finalMessageContent);
      if (validBanners.length === 0) {
        sendResult = await sendAnimation(
          channelId,
          '/static/giveaways/standart.mp4',
          plainContent,
          { reply_markup: inlineKeyboard || undefined },
        );
      } else if (validBanners.length === 1) {
        const singleBanner = validBanners[0];
        sendResult = isGifUrl(singleBanner)
          ? await sendAnimation(channelId, singleBanner, plainContent, {
              reply_markup: inlineKeyboard || undefined,
            })
          : await sendPhoto(channelId, singleBanner, plainContent, {
              disable_web_page_preview: true,
              reply_markup: inlineKeyboard || undefined,
            });
      } else {
        // Media group already sent; only the text message needs a retry
        const textRetry = await sendMessage(channelId, plainContent, {
          disable_web_page_preview: true,
          reply_markup: inlineKeyboard || undefined,
        });
        if (textRetry.success)
          sendResult = { success: true, messageId: textRetry.messageId };
      }
      if (sendResult.success) {
        console.log(
          `[Repost] Retried giveaway ${giveawayId} to channel ${channelId} with plain text (HTML was invalid)`,
        );
      }
    }

    if (sendResult.success) {
      // Save message ID(s) to database
      if (sendResult.messageIds && sendResult.messageIds.length > 0) {
        await prisma.giveawayMessage.create({
          data: {
            giveawayId: giveawayId,
            channelId: channelId,
            messageId: sendResult.messageId
              ? BigInt(sendResult.messageId)
              : BigInt(sendResult.messageIds[0]),
            mediaGroupMessageId: BigInt(sendResult.messageIds[0]),
          },
        });
      } else if (sendResult.messageId) {
        await prisma.giveawayMessage.create({
          data: {
            giveawayId: giveawayId,
            channelId: channelId,
            messageId: BigInt(sendResult.messageId),
          },
        });
      }

      console.log(
        `[Repost] Successfully re-posted giveaway ${giveawayId} to channel ${channelId}, messageId: ${sendResult.messageId}`,
      );
    }

    return {
      success: sendResult.success,
      messageId: sendResult.messageId,
      error: sendResult.error,
    };
  } catch (error: any) {
    console.error(
      `[Repost] Error re-posting giveaway ${giveawayId} to channel ${channelId}:`,
      error,
    );
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Format giveaway data into localized message template
 */
function formatGiveawayMessage(giveaway: GiveawayFormatData): string {
  const sections: string[] = [];

  // Normalize language: 'uk' maps to 'ua'
  let language: Language = 'en';
  if (giveaway.language) {
    const lang = giveaway.language.toLowerCase();
    if (lang.startsWith('uk') || lang.startsWith('ua')) {
      language = 'ua';
    } else if (lang.startsWith('ru')) {
      language = 'ru';
    }
  }

  const messages = GIVEAWAY_MESSAGE_FORMAT[language];
  const introMessages = GIVEAWAY_POST_INTRO[language];
  const isLottery = giveaway.participiationType === 'Lottery';

  // If a real (non-default) description is provided: show ONLY description
  const allDefaultDescriptions = new Set(
    Object.values(GIVEAWAY_POST_INTRO).flatMap((lang) => Object.values(lang)),
  );
  const hasRealDescription =
    giveaway.description && !allDefaultDescriptions.has(giveaway.description);

  if (hasRealDescription) {
    return normalizeHtml(giveaway.description);
  }

  // No description (or default intro): Show intro line + formatted info
  // Add intro line based on type
  const introLine = isLottery ? introMessages.lottery : introMessages.giveaway;
  sections.push(introLine);
  sections.push('');

  // End date/time
  if (giveaway.completionType == GiveawayEndType.ByTime && giveaway.endingAt) {
    const endDate = new Date(giveaway.endingAt);
    const formattedDate = endDate.toLocaleDateString(messages.locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const formattedTime = endDate.toLocaleTimeString(messages.locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    sections.push(
      `<b>•</b> ${messages.ending} ${formattedDate}, ${formattedTime} UTC`,
    );
  }

  // Completion conditions with icons (👤 for giveaway, 🎟️ for lottery)
  const participantIcon = isLottery ? '🎟️' : '👤';
  if (
    giveaway.completionType == GiveawayEndType.ByCapacity &&
    giveaway.maxParticipants
  ) {
    sections.push(
      `<b>•</b> ${messages.completionConditions} ${participantIcon} ${giveaway.maxParticipants}`,
    );
  }

  // Channel subscriptions - SINGLE LINE with commas
  const channelSubscriptions = getChannelSubscriptions(giveaway);
  if (channelSubscriptions.length > 0) {
    sections.push(
      `<b>•</b> ${messages.subscriptions} ${channelSubscriptions.join(', ')}`,
    );
  }

  // Other links (sponsor links) - SINGLE LINE with commas
  const sponsorLinks = getSponsorLinks(giveaway);
  if (sponsorLinks.length > 0) {
    sections.push(`<b>•</b> ${messages.otherLinks} ${sponsorLinks.join(', ')}`);
  }

  // Requirements section
  const requirements = getRequirements(giveaway);
  if (requirements.length > 0) {
    sections.push('');
    sections.push(`<b>${messages.requirements}</b>`);
    requirements.forEach((req) => {
      sections.push(`<b>•</b> ${req}`);
    });
  }

  // Gifts section — prizes still tied to this giveaway (including after claim)
  const prizes =
    giveaway.prizes?.filter((p) =>
      (GIVEAWAY_ANNOUNCEMENT_PRIZE_STATUSES as readonly string[]).includes(
        p.status,
      ),
    ) ?? [];
  if (prizes.length > 0) {
    const giftMsgs = GIFT_PRIZE_MESSAGES[language];
    sections.push('');
    sections.push(`<b>${giftMsgs.giftsHeader}</b>`);

    const GIFT_WORD: Record<Language, string> = {
      ua: 'подарунків',
      ru: 'подарков',
      en: 'gifts',
    };
    const uniquePrizes = prizes.filter(
      (p) => !p.prizeType || p.prizeType === 'UniqueGift',
    );
    const standardPrizes = prizes.filter((p) => p.prizeType === 'StandardGift');

    // Group standard gifts by telegramGiftId
    const standardGroups = new Map<string, { emoji: string; count: number }>();
    for (const p of standardPrizes) {
      const key = p.telegramGiftId ?? 'unknown';
      const g = standardGroups.get(key) ?? {
        emoji: p.giftName ?? '🎁',
        count: 0,
      };
      g.count++;
      standardGroups.set(key, g);
    }
    const standardParts = [...standardGroups.values()].map(
      ({ emoji, count }) => `${count}x ${emoji} ${GIFT_WORD[language]}`,
    );

    const uniqueLines: string[] = [];
    if (giveaway.numerifyPrizes) {
      const sorted = [...uniquePrizes].sort(
        (a, b) => (a.winPlace ?? 999) - (b.winPlace ?? 999),
      );
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        const place = p.winPlace ?? i + 1;
        uniqueLines.push(
          formatUniqueGiftNftHtml(p, { medalPrefix: getMedalEmoji(place) }),
        );
      }
    } else {
      uniqueLines.push(...uniquePrizes.map((p) => formatUniqueGiftNftHtml(p)));
    }
    sections.push(...uniqueLines);
    if (standardParts.length > 0) {
      sections.push(standardParts.join(', '));
    }
  }

  return sections.join('\n');
}

/**
 * Get completion condition text based on giveaway settings
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getCompletionCondition(giveaway: GiveawayFormatData): string | null {
  // Normalize language: 'uk' maps to 'ua'
  let language: Language = 'en';
  if (giveaway.language) {
    const lang = giveaway.language.toLowerCase();
    if (lang.startsWith('uk') || lang.startsWith('ua')) {
      language = 'ua';
    } else if (lang.startsWith('ru')) {
      language = 'ru';
    }
  }

  const messages = COMPLETION_CONDITION_MESSAGES[language];

  if (giveaway.completionType === 'ByCapacity' && giveaway.maxParticipants) {
    // For lottery type, show tickets instead of participants
    if (giveaway.participiationType === GiveawayStartType.Lottery) {
      return messages.byCapacityTickets(giveaway.maxParticipants);
    }
    return messages.byCapacity(giveaway.maxParticipants);
  }
  if (giveaway.completionType === 'ByTime') {
    return messages.byTime;
  }
  return null;
}

/**
 * Get channel subscriptions from sponsored channels
 */
function getChannelSubscriptions(giveaway: GiveawayFormatData): string[] {
  const channelSubs: string[] = [];

  giveaway.linkedChannels
    ?.filter(
      (linked) =>
        !linked.role || linked.role === 'All' || linked.role === 'Subscription',
    )
    .forEach((linked: GiveawayLinkedChannel) => {
      const channel = linked.channel;
      if (channel) {
        if (channel.username) {
          channelSubs.push(`@${channel.username}`);
        } else if (channel.inviteLink && channel.title) {
          channelSubs.push(
            `<a href="${channel.inviteLink}">${channel.title}</a>`,
          );
        } else if (channel.title) {
          channelSubs.push(channel.title);
        }
      }
    });

  giveaway.sponsoredBy?.forEach((sponsor: GiveawaySponsor) => {
    if (sponsor.sponsorType === 'Channel' && sponsor.sponsorChannel) {
      const channel = sponsor.sponsorChannel;
      if (channel.username) {
        channelSubs.push(`@${channel.username}`);
      } else if (channel.inviteLink && channel.title) {
        channelSubs.push(
          `<a href="${channel.inviteLink}">${channel.title}</a>`,
        );
      } else if (channel.title) {
        channelSubs.push(channel.title);
      }
    }
  });

  return channelSubs;
}

/**
 * Get sponsor links
 */
function getSponsorLinks(giveaway: GiveawayFormatData): string[] {
  const links: string[] = [];

  giveaway.sponsoredBy?.forEach((sponsor: GiveawaySponsor) => {
    if (sponsor.sponsorType === 'Link' && sponsor.sponsorLink) {
      const title = sponsor.sponsorLink.title || 'Посилання';
      const url = sponsor.sponsorLink.link;
      links.push(`<a href="${url}">${title}</a>`);
    }
  });

  return links;
}

/**
 * Get requirements based on giveaway settings
 */
function getRequirements(giveaway: GiveawayFormatData): string[] {
  const requirements: string[] = [];

  let language: Language = 'en';
  if (giveaway.language) {
    const lang = giveaway.language.toLowerCase();
    if (lang.startsWith('uk') || lang.startsWith('ua')) {
      language = 'ua';
    } else if (lang.startsWith('ru')) {
      language = 'ru';
    }
  }

  const messages = REQUIREMENTS_MESSAGES[language];

  if (giveaway.isBoostNeeded) {
    requirements.push(messages.boost);
  }

  if (giveaway.isOnlyPremium) {
    requirements.push(messages.onlyPremium);
  }

  if (giveaway.neededReferals > 0) {
    requirements.push(messages.referrals(giveaway.neededReferals));
  }

  if (Number(giveaway.participiationPrice) > 0) {
    const currency = giveaway.participiationCurr === 'Stars' ? '⭐' : 'TON';
    requirements.push(
      messages.participationPrice(
        Number(giveaway.participiationPrice),
        currency,
      ),
    );
  }

  if (giveaway.isStaySubscribed) {
    requirements.push(messages.staySubscribed);
  }

  // if (giveaway.isCaptchaNeeded) {
  //   requirements.push(messages.captcha);
  // }

  // if (
  //   giveaway.allowedGeoCountries &&
  //   giveaway.allowedGeoCountries.trim() !== ''
  // ) {
  //   requirements.push(messages.geoRestrictions);
  // }

  return requirements;
}

/**
 * Perform tasks after giveaway is finished
 * @param giveawayId - The giveaway ID
 * @param webappUrl - Base URL of the webapp (optional, defaults to BOT_URL env variable)
 */
export async function finishGiveAwayTasks(
  giveawayId: string,
  webappUrl?: string,
): Promise<void> {
  try {
    const url = webappUrl || process.env.BOT_URL;

    console.log(`Running finish tasks for giveaway ${giveawayId}...`);

    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      select: { finishedAt: true },
    });

    if (!giveaway?.finishedAt) {
      console.warn(
        `Skipping finish tasks for ${giveawayId}: finishedAt is not set (finish transaction may have failed)`,
      );
      return;
    }

    // Update buttons to show giveaway is finished
    try {
      const result = await updateGiveawayButtons(giveawayId, url);
      console.log(
        `Finish tasks: Updated ${result.success} message(s), failed ${result.failed}`,
      );
    } catch (error) {
      console.error(
        `Error updating buttons for finished giveaway ${giveawayId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    // Process funds distribution for lottery giveaways
    try {
      await distributeLotteryFunds(giveawayId);
    } catch (error) {
      console.error(
        `Error distributing funds for giveaway ${giveawayId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    // send an msg with winners
    try {
      const announcementResult = await sendWinnersAnnouncement(giveawayId);
      if (announcementResult.failed > 0 && announcementResult.success === 0) {
        // All channels failed — notify creator to use Republish button
        const giveawayForNotify = await prisma.giveaway.findUnique({
          where: { id: giveawayId },
          select: { createdBy: { select: { telegramId: true } } },
        });
        if (giveawayForNotify?.createdBy?.telegramId) {
          try {
            // await sendMessage(
            //   giveawayForNotify.createdBy.telegramId,
            //   `⚠️ Could not auto-post results for your giveaway. Please use the "Republish" button in the app to publish results manually.`,
            //   {
            //     reply_markup: {
            //       inline_keyboard: [
            //         [
            //           {
            //             text: '📋 Open Giveaway',
            //             url: `${process.env.BOT_URL}?startapp=resultsId_${giveawayId}`,
            //           },
            //         ],
            //       ],
            //     },
            //   },
            // );
          } catch (_) {}
        }
      }
    } catch (error) {
      console.error(
        `Error sending winner announcement for giveaway ${giveawayId}:`,
        error instanceof Error ? error.message : error,
      );
      // Notify creator about the failure
      try {
        const giveawayForNotify = await prisma.giveaway.findUnique({
          where: { id: giveawayId },
          select: { createdBy: { select: { telegramId: true } } },
        });
        if (giveawayForNotify?.createdBy?.telegramId) {
          // await sendMessage(
          //   giveawayForNotify.createdBy.telegramId,
          //   `⚠️ Could not auto-post results for your giveaway. Please use the "Republish" button in the app to publish results manually.`,
          //   {
          //     reply_markup: {
          //       inline_keyboard: [
          //         [
          //           {
          //             text: '📋 Open Giveaway',
          //             url: `${process.env.BOT_URL}?startapp=resultsId_${giveawayId}`,
          //           },
          //         ],
          //       ],
          //     },
          //   },
          // );
        }
      } catch (_) {}
    }

    // Notify co-owners whose channels have isPostingResults = false
    try {
      const giveawayForCoOwners = await prisma.giveaway.findUnique({
        where: { id: giveawayId },
        select: {
          id: true,
          participiationType: true,
          language: true,
          banner: true,
          createdById: true,
          linkedChannels: {
            where: {
              isPostingResults: false,
              role: { in: ['All', 'Posting'] },
            },
            include: {
              channel: {
                include: {
                  addedBy: {
                    select: {
                      userId: true,
                      user: {
                        select: {
                          telegramId: true,
                          first_name: true,
                          last_name: true,
                          picked_language: true,
                          language_code: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (giveawayForCoOwners) {
        for (const lc of giveawayForCoOwners.linkedChannels) {
          // Only notify co-owner channels (not creator's own channels)
          const isCreatorChannel = lc.channel.addedBy.some(
            (ab) => ab.userId === giveawayForCoOwners.createdById,
          );
          if (isCreatorChannel) continue;

          // Only the admin who claimed shared management can publish results.
          for (const addedBy of lc.channel.addedBy) {
            if (addedBy.userId !== lc.managedByUserId) continue;
            if (!addedBy.user?.telegramId) continue;
            try {
              await sendCoOwnerResultsNotification(
                addedBy.user.telegramId,
                addedBy.user.first_name,
                addedBy.user.last_name,
                {
                  id: giveawayForCoOwners.id,
                  type: giveawayForCoOwners.participiationType,
                  createdById: giveawayForCoOwners.createdById,
                  banner: giveawayForCoOwners.banner,
                },
                lc.channelId,
                lc.channel.title || `Channel ${lc.channelId}`,
                getUserLanguage(addedBy.user),
                addedBy.userId,
              );
            } catch (dmErr: any) {
              console.log(
                `Could not notify co-owner ${addedBy.user.telegramId} about results: ${dmErr?.message}`,
              );
            }
          }
        }
      }
    } catch (coOwnerErr) {
      console.error(
        `Error notifying co-owners about results for ${giveawayId}:`,
        coOwnerErr,
      );
    }

    console.log(`Finish tasks completed for giveaway ${giveawayId}`);
  } catch (error) {
    console.error(
      `Error running finish tasks for giveaway ${giveawayId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Distribute funds from lottery giveaway to the owner
 * Stars go to holding wallet, other currencies go directly to wallet
 * @param giveawayId - The giveaway ID
 */
async function distributeLotteryFunds(giveawayId: string): Promise<void> {
  try {
    // Fetch giveaway with creator and participants
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        createdBy: true,
        participants: true,
      },
    });

    if (!giveaway) {
      console.log(
        `Giveaway ${giveawayId} not found, skipping funds distribution`,
      );
      return;
    }

    // Only distribute funds for lottery type giveaways
    if (giveaway.participiationType !== 'Lottery') {
      console.log(
        `Giveaway ${giveawayId} is not a lottery type, skipping funds distribution`,
      );
      return;
    }

    // Check if there's a participation price
    const participationPrice = Number(giveaway.participiationPrice);
    if (participationPrice <= 0) {
      console.log(
        `Giveaway ${giveawayId} has no participation price, skipping funds distribution`,
      );
      return;
    }

    // Check if giveaway has an owner
    if (!giveaway.createdById || !giveaway.createdBy) {
      console.log(
        `Giveaway ${giveawayId} has no owner, skipping funds distribution`,
      );
      return;
    }

    const participantCount = giveaway.participants.length;
    const totalAmount = participantCount * participationPrice;

    if (totalAmount <= 0) {
      console.log(
        `Giveaway ${giveawayId} has no funds to distribute (0 participants or 0 price)`,
      );
      return;
    }

    const ownerId = giveaway.createdById;
    const currency = giveaway.participiationCurr;

    console.log(
      `Distributing ${totalAmount} ${currency} from giveaway ${giveawayId} to owner ${ownerId} (${participantCount} participants x ${participationPrice})`,
    );

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Ensure owner's wallet exists
      const wallet = await tx.wallet.upsert({
        where: { userId: ownerId },
        create: {
          userId: ownerId,
          starsBalance: 0,
          holdedStarsBalance: 0,
          tonBalance: 0,
        },
        update: {},
      });

      // Distribute funds based on currency type
      if (currency === 'Stars') {
        const balanceBefore = wallet.holdedStarsBalance;

        // Stars go to holding wallet
        const updatedWallet = await tx.wallet.update({
          where: { userId: ownerId },
          data: {
            holdedStarsBalance: { increment: totalAmount },
          },
        });

        const balanceAfter = updatedWallet.holdedStarsBalance;

        // Calculate when the hold expires (21 days from now)
        const validWhen = moment().add(21, 'days').toDate();

        // Create one holding record per giveaway (never upsert - each giveaway has its own hold period)
        await tx.holdingStars.create({
          data: {
            transactionId: `giveaway_${giveawayId}`,
            userId: ownerId,
            giveawayId,
            validWhen,
            ammount: totalAmount,
            status: 'Pending',
          },
        });

        // Create transaction record (additionalInfo includes transactionId for release matching)
        await tx.transactionHistory.create({
          data: {
            walletId: wallet.id,
            userId: ownerId,
            type: 'Incoming',
            status: 'Pending',
            currency: currency,
            value: totalAmount,
            balanceBefore,
            balanceAfter,
            additionalInfo: `Lottery earnings | giveaway_${giveawayId}`,
          },
        });

        console.log(
          `Added ${totalAmount} Stars to holding wallet for user ${ownerId}, will be released on ${validWhen.toISOString()}`,
        );
      } else {
        const balanceBefore = wallet.tonBalance;

        // Other currencies (TON) go directly to wallet
        const updatedWallet = await tx.wallet.update({
          where: { userId: ownerId },
          data: {
            tonBalance: { increment: totalAmount },
          },
        });

        const balanceAfter = updatedWallet.tonBalance;

        // Create transaction record
        await tx.transactionHistory.create({
          data: {
            walletId: wallet.id,
            userId: ownerId,
            type: 'Incoming',
            status: 'Completed',
            currency: currency,
            value: totalAmount,
            balanceBefore,
            balanceAfter,
            additionalInfo: `Lottery earnings ${giveawayId}`,
          },
        });

        console.log(
          `Added ${totalAmount} ${currency} directly to wallet for user ${ownerId}`,
        );
      }
    });

    console.log(
      `Successfully distributed ${totalAmount} ${currency} from giveaway ${giveawayId} to owner ${ownerId}`,
    );
  } catch (error) {
    console.error(
      `Error in distributeLotteryFunds for giveaway ${giveawayId}:`,
      error instanceof Error ? error.message : error,
    );
    throw error;
  }
}

/**
 * Update the full content (message/caption + buttons) for all messages of a specific giveaway
 * @param giveawayId - The giveaway ID
 * @param webappUrl - Base URL of the webapp
 * @returns Promise<{ success: number, failed: number }>
 */
export async function updateGiveawayMessages(
  giveawayId: string,
  webappUrl: string,
): Promise<{ success: number; failed: number }> {
  let successCount = 0;
  let failedCount = 0;

  try {
    // Fetch giveaway data with participants, messages and sponsors
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        linkedChannels: {
          include: {
            channel: {
              include: {
                addedBy: { select: { userId: true } },
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
        participants: true,
        messages: true,
        prizes: GIVEAWAY_LINKED_ONLY_PRIZES_INCLUDE,
      },
    });

    if (!giveaway) {
      console.error(`Giveaway ${giveawayId} not found`);
      return { success: 0, failed: 0 };
    }

    const postlotPublications = await prisma.postlotPublication.findMany({
      where: { giveawayId },
      select: { channelId: true, messageIds: true },
    });

    const postUpdateTargets: GiveawayPostUpdateTarget[] = [
      ...(giveaway.messages ?? []).map((message) =>
        linkedMessageToPostUpdateTarget(message),
      ),
      ...postlotPublications.flatMap((publication) => {
        const target = postlotPublicationToPostUpdateTarget(publication);
        return target ? [target] : [];
      }),
    ];

    if (postUpdateTargets.length === 0) {
      console.log(`No messages found for giveaway ${giveawayId}`);
      return { success: 0, failed: 0 };
    }

    // Format the message content
    const messageContent = formatGiveawayMessage(giveaway);

    // Create the webapp link with giveaway start parameter
    const webappLink = `${webappUrl}?startapp=giveawayId_${giveawayId}`;

    const inlineKeyboard = buildParticipationKeyboard(giveaway, webappLink);

    // Update each linked channel post and /postlot publication
    const promises = postUpdateTargets.map(async (target) => {
      if (target.source === 'linked') {
        // Skip co-owner channels — they manage their own post content
        const linkedChannel = giveaway.linkedChannels.find(
          (lc) => lc.channelId === target.channelId,
        );
        const isCreatorOwned =
          !giveaway.createdById ||
          (linkedChannel?.channel.addedBy.some(
            (e) => e.userId === giveaway.createdById,
          ) ??
            true);

        if (!isCreatorOwned) return;
      }

      try {
        let response: any;

        const banners = giveaway.banner || [];
        const validBanners = banners.filter(
          (b: string) => b && b.trim() !== '',
        );

        if (validBanners.length === 1) {
          // Single banner: Update photo media with new caption
          response = await queueTelegramRequest(() =>
            axios.post<TelegramApiResponse<any>>(
              `${TELEGRAM_API_BASE}/editMessageMedia`,
              {
                chat_id: target.channelId.toString(),
                message_id: Number(target.messageId),
                media: {
                  type: 'photo',
                  media: toAbsoluteUrl(validBanners[0]),
                  caption: messageContent,
                  parse_mode: 'HTML',
                },
                reply_markup: inlineKeyboard,
              },
              { timeout: 15000 },
            ),
          );
        } else if (validBanners.length === 0) {
          // No banners: Update text message
          response = await queueTelegramRequest(() =>
            axios.post<TelegramApiResponse<any>>(
              `${TELEGRAM_API_BASE}/editMessageText`,
              {
                chat_id: target.channelId.toString(),
                message_id: Number(target.messageId),
                text: messageContent,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: inlineKeyboard,
              },
              { timeout: 15000 },
            ),
          );
        } else {
          // Media group: Update photos + text message separately
          try {
            if (target.mediaGroupMessageIds.length > 0) {
              const updateMediaResult = await updateMediaGroupPhotos(
                target.channelId,
                target.mediaGroupMessageIds,
                validBanners,
              );

              if (!updateMediaResult.success) {
                console.error(
                  `Failed to update media group in channel ${target.channelId} (${target.source}): ${updateMediaResult.error}`,
                );
                failedCount++;
                return;
              }

              response = await queueTelegramRequest(() =>
                axios.post<TelegramApiResponse<any>>(
                  `${TELEGRAM_API_BASE}/editMessageText`,
                  {
                    chat_id: target.channelId.toString(),
                    message_id: Number(target.messageId),
                    text: messageContent,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: inlineKeyboard,
                  },
                  { timeout: 15000 },
                ),
              );

              if (response.data.ok) {
                successCount++;
              } else {
                const errorMessage =
                  response.data.description || 'Unknown error';
                const kind = classifyGiveawayButtonEditError(errorMessage);
                if (kind === 'not_modified') {
                  successCount++;
                  return;
                }
                if (kind === 'message_not_found' || kind === 'bot_kicked') {
                  try {
                    if (target.source === 'linked') {
                      await prisma.giveawayMessage.deleteMany({
                        where: {
                          giveawayId,
                          channelId: target.channelId,
                          messageId: target.messageId,
                        },
                      });
                    } else {
                      await removeStalePostlotPublication(
                        giveawayId,
                        target.channelId,
                      );
                    }
                  } catch (dbError: any) {
                    console.error(
                      `Error removing stale post reference for channel ${target.channelId}:`,
                      dbError.message || dbError,
                    );
                  }
                  successCount++;
                  return;
                }
                failedCount++;
                console.error(
                  `Failed to update text message ${target.messageId} in channel ${target.channelId} (${target.source}): ${errorMessage}`,
                );
              }
            } else {
              console.warn(
                `Media group post ${target.messageId} in channel ${target.channelId} (${target.source}) cannot be updated without a first media message id. Re-send giveaway to use the current format.`,
              );
              successCount++;
            }
          } catch (error: any) {
            console.error(
              `Error updating media group for channel ${target.channelId} (${target.source}): ${error.message}`,
            );
            failedCount++;
          }
          return;
        }

        if (response.data.ok) {
          successCount++;
        } else {
          const errorMessage = response.data.description || 'Unknown error';
          const kind = classifyGiveawayButtonEditError(errorMessage);
          if (kind === 'not_modified') {
            successCount++;
            return;
          }
          if (kind === 'message_not_found' || kind === 'bot_kicked') {
            console.log(
              `Message ${target.messageId} in channel ${target.channelId} cannot be updated (${kind}, ${target.source}), removing from database`,
            );
            try {
              if (target.source === 'linked') {
                await prisma.giveawayMessage.deleteMany({
                  where: {
                    giveawayId,
                    channelId: target.channelId,
                    messageId: target.messageId,
                  },
                });
              } else {
                await removeStalePostlotPublication(
                  giveawayId,
                  target.channelId,
                );
              }
            } catch (dbError: any) {
              console.error(
                `Error removing stale post reference for channel ${target.channelId}:`,
                dbError.message || dbError,
              );
            }
            successCount++;
            return;
          }
          failedCount++;
          console.error(
            `Failed to update message ${target.messageId} in channel ${target.channelId} (${target.source}): ${errorMessage}`,
          );
        }
      } catch (error: any) {
        const errorMessage =
          error.response?.data?.description || error.message || 'Unknown error';

        const kind = classifyGiveawayButtonEditError(errorMessage);

        if (kind === 'not_modified') {
          successCount++;
          return;
        }

        if (kind === 'message_not_found' || kind === 'bot_kicked') {
          const reason =
            kind === 'bot_kicked'
              ? 'bot was kicked from chat'
              : 'message not found';
          console.log(
            `Message ${target.messageId} in channel ${target.channelId} cannot be updated (${reason}, ${target.source}), removing from database`,
          );

          try {
            if (target.source === 'linked') {
              await prisma.giveawayMessage.deleteMany({
                where: {
                  giveawayId,
                  channelId: target.channelId,
                  messageId: target.messageId,
                },
              });
            } else {
              await removeStalePostlotPublication(giveawayId, target.channelId);
            }
            console.log(
              `Successfully removed stale post reference for channel ${target.channelId} (${target.source})`,
            );
          } catch (dbError: any) {
            console.error(
              `Error removing stale post reference for channel ${target.channelId}:`,
              dbError.message || dbError,
            );
          }

          successCount++;
          return;
        }

        failedCount++;
        console.error(
          `Error updating message ${target.messageId} in channel ${target.channelId} (${target.source}): ${errorMessage}`,
        );
      }
    });

    // Wait for all updates to complete
    await Promise.all(promises);

    console.log(
      `Giveaway messages updated: ${successCount} successful, ${failedCount} failed`,
    );

    return { success: successCount, failed: failedCount };
  } catch (error: any) {
    console.error('Error updating giveaway messages:', error);
    return { success: 0, failed: 0 };
  }
}

type GiveawayPostUpdateTarget = {
  channelId: bigint;
  /** Message that carries the participation inline keyboard. */
  messageId: bigint;
  /** Album message ids preceding the keyboard message (empty for single-message posts). */
  mediaGroupMessageIds: bigint[];
  source: 'linked' | 'postlot';
};

function linkedMessageToPostUpdateTarget(message: {
  channelId: bigint;
  messageId: bigint;
  mediaGroupMessageId: bigint | null;
}): GiveawayPostUpdateTarget {
  return {
    channelId: message.channelId,
    messageId: message.messageId,
    mediaGroupMessageIds: message.mediaGroupMessageId
      ? [message.mediaGroupMessageId]
      : [],
    source: 'linked',
  };
}

function postlotPublicationToPostUpdateTarget(publication: {
  channelId: bigint;
  messageIds: bigint[];
}): GiveawayPostUpdateTarget | null {
  if (publication.messageIds.length === 0) {
    return null;
  }
  return {
    channelId: publication.channelId,
    messageId: publication.messageIds[publication.messageIds.length - 1],
    mediaGroupMessageIds:
      publication.messageIds.length > 1
        ? publication.messageIds.slice(0, -1)
        : [],
    source: 'postlot',
  };
}

/** Drop an entire postlot publication — media-only message IDs cannot be updated alone. */
async function removeStalePostlotPublication(
  giveawayId: string,
  channelId: bigint,
): Promise<void> {
  await prisma.postlotPublication.deleteMany({
    where: { giveawayId, channelId },
  });
}

/** Batch stale removals after parallel Telegram updates. */
async function removeStaleGiveawayButtonMessageRecordsBatch(
  giveawayId: string,
  targets: GiveawayPostUpdateTarget[],
): Promise<void> {
  if (targets.length === 0) {
    return;
  }

  const linkedTargets = targets.filter((t) => t.source === 'linked');
  if (linkedTargets.length > 0) {
    await prisma.$transaction(
      linkedTargets.map((target) =>
        prisma.giveawayMessage.deleteMany({
          where: {
            giveawayId,
            channelId: target.channelId,
            messageId: target.messageId,
          },
        }),
      ),
    );
  }

  const postlotChannelIds = new Set(
    targets
      .filter((t) => t.source === 'postlot')
      .map((t) => t.channelId.toString()),
  );
  for (const channelIdStr of postlotChannelIds) {
    await removeStalePostlotPublication(giveawayId, BigInt(channelIdStr));
  }
}

export function isTelegramMessageNotModifiedError(err: unknown): boolean {
  const description =
    (err as { response?: { data?: { description?: string } } })?.response?.data
      ?.description ??
    (err as { description?: string })?.description ??
    (err as { message?: string })?.message ??
    '';
  return String(description).toLowerCase().includes('message is not modified');
}

function classifyGiveawayButtonEditError(
  errorMessage: string,
): 'not_modified' | 'message_not_found' | 'bot_kicked' | 'other' {
  const lower = errorMessage.toLowerCase();
  if (
    lower.includes('message is not modified') ||
    lower.includes(
      'specified new message content and reply markup are exactly the same',
    )
  ) {
    return 'not_modified';
  }
  if (
    lower.includes('message to edit not found') ||
    lower.includes('message not found') ||
    lower.includes('message_id_invalid')
  ) {
    return 'message_not_found';
  }
  if (
    lower.includes('bot was kicked') ||
    lower.includes('bot was blocked') ||
    lower.includes('user is deactivated') ||
    lower.includes('chat not found')
  ) {
    return 'bot_kicked';
  }
  return 'other';
}

type GiveawayButtonEditOutcome = {
  channelId: bigint;
  messageId: bigint;
  success: boolean;
  error?: string;
};

function processGiveawayButtonEditFailure(
  message: GiveawayPostUpdateTarget,
  errorMessage: string,
  staleRemovalTargets: GiveawayPostUpdateTarget[],
): GiveawayButtonEditOutcome {
  const kind = classifyGiveawayButtonEditError(errorMessage);

  if (kind === 'not_modified') {
    return {
      channelId: message.channelId,
      messageId: message.messageId,
      success: true,
    };
  }

  if (kind === 'message_not_found') {
    console.log(
      `Message ${message.messageId} in channel ${message.channelId} was deleted, removing from database (${message.source})`,
    );
    staleRemovalTargets.push(message);
    return {
      channelId: message.channelId,
      messageId: message.messageId,
      success: true,
      error: 'Message was deleted, removed from database',
    };
  }

  if (kind === 'bot_kicked') {
    console.log(
      `Message ${message.messageId} in channel ${message.channelId} cannot be updated (bot was kicked), deleting from database (${message.source})`,
    );
    staleRemovalTargets.push(message);
    return {
      channelId: message.channelId,
      messageId: message.messageId,
      success: true,
      error: 'Message deleted from database (bot was kicked)',
    };
  }

  console.error(
    `Error updating message ${message.messageId} in channel ${message.channelId}: ${errorMessage}`,
  );
  return {
    channelId: message.channelId,
    messageId: message.messageId,
    success: false,
    error: errorMessage,
  };
}

/**
 * Update buttons for all messages of a specific giveaway
 * @param giveawayId - The giveaway ID
 * @param webappUrl - Base URL of the webapp
 * @returns Promise<{ success: number, failed: number, results: Array<{channelId: bigint, messageId: bigint, success: boolean}> }>
 */
export async function updateGiveawayButtons(
  giveawayId: string,
  webappUrl: string,
): Promise<{
  success: number;
  failed: number;
  results: Array<{
    channelId: bigint;
    messageId: bigint;
    success: boolean;
    error?: string;
  }>;
}> {
  const results: Array<{
    channelId: bigint;
    messageId: bigint;
    success: boolean;
    error?: string;
  }> = [];
  let successCount = 0;
  let failedCount = 0;

  try {
    // Fetch giveaway data with participants and messages
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        participants: true,
        messages: true,
      },
    });

    if (!giveaway) {
      throw new Error(`Giveaway with ID ${giveawayId} not found`);
    }

    const postlotPublications = await prisma.postlotPublication.findMany({
      where: { giveawayId },
      select: { channelId: true, messageIds: true },
    });

    const messageTargets: GiveawayPostUpdateTarget[] = [
      ...(giveaway.messages ?? []).map((message) =>
        linkedMessageToPostUpdateTarget(message),
      ),
      ...postlotPublications.flatMap((publication) => {
        const target = postlotPublicationToPostUpdateTarget(publication);
        return target ? [target] : [];
      }),
    ];

    if (messageTargets.length === 0) {
      console.log(`No messages found for giveaway ${giveawayId}`);
      return {
        success: 0,
        failed: 0,
        results: [],
      };
    }

    // Create the webapp link with giveaway start parameter
    const webappLink = `${webappUrl}?startapp=giveawayId_${giveawayId}`;

    const inlineKeyboard = buildParticipationKeyboard(giveaway, webappLink);
    const staleRemovalTargets: GiveawayPostUpdateTarget[] = [];

    // editMessageReplyMarkup applies only to messageId (keyboard message), not album items.
    const promises = messageTargets.map(async (message) => {
      try {
        if (!BOT_TOKEN) {
          throw new Error('BOT_TOKEN environment variable is not set');
        }

        const response = await queueTelegramRequest(() =>
          axios.post<TelegramApiResponse<any>>(
            `${TELEGRAM_API_BASE}/editMessageReplyMarkup`,
            {
              chat_id: message.channelId.toString(),
              message_id: Number(message.messageId),
              reply_markup: inlineKeyboard,
            },
            {
              timeout: 15000,
            },
          ),
        );

        if (response.data.ok) {
          const result = {
            channelId: message.channelId,
            messageId: message.messageId,
            success: true as const,
            error: undefined,
          };
          results.push(result);
          successCount++;
          return result;
        }

        const errorMessage = response.data.description || 'Unknown error';
        const result = processGiveawayButtonEditFailure(
          message,
          errorMessage,
          staleRemovalTargets,
        );
        results.push(result);
        if (result.success) {
          successCount++;
        } else {
          failedCount++;
        }
        return result;
      } catch (error: any) {
        const errorMessage =
          error.response?.data?.description || error.message || 'Unknown error';

        const result = processGiveawayButtonEditFailure(
          message,
          errorMessage,
          staleRemovalTargets,
        );
        results.push(result);
        if (result.success) {
          successCount++;
        } else {
          failedCount++;
        }
        return result;
      }
    });

    // Wait for all updates to complete
    await Promise.all(promises);

    if (staleRemovalTargets.length > 0) {
      try {
        await removeStaleGiveawayButtonMessageRecordsBatch(
          giveawayId,
          staleRemovalTargets,
        );
        console.log(
          `Removed ${staleRemovalTargets.length} stale giveaway button message reference(s) for giveaway ${giveawayId}`,
        );
      } catch (dbError: any) {
        console.error(
          `Error removing stale giveaway button message references for ${giveawayId}:`,
          dbError.message || dbError,
        );
      }
    }

    // console.log(
    //   `Giveaway buttons updated: ${successCount} successful, ${failedCount} failed`,
    // );

    return {
      success: successCount,
      failed: failedCount,
      results,
    };
  } catch (error: any) {
    console.error('Error updating giveaway buttons:', error);
    throw error;
  }
}

// ============================================
// SPONSOR APPROVAL FUNCTIONS
// ============================================

/**
 * Generate a unique tracking code for sponsor channel statistics
 * @param giveawayId - The giveaway ID
 * @param channelId - The channel ID
 * @returns Unique 16-char tracking code string
 */
export function generateTrackingCode(
  giveawayId: string,
  channelId: bigint,
): string {
  const data = `${giveawayId}-${channelId.toString()}-${Date.now()}`;
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Identify sponsor channels for a giveaway (channels NOT added by giveaway creator)
 * @param giveawayId - The giveaway ID
 * @param creatorUserId - The giveaway creator's user ID
 * @returns Array of sponsor channels with their owners
 */
export async function identifySponsorChannels(
  giveawayId: string,
  creatorUserId: number,
): Promise<
  Array<{
    channelId: bigint;
    channelTitle: string;
    channelUsername: string | null;
    owners: Array<{ userId: number; telegramId: string }>;
  }>
> {
  // Get posting channels only — subscription-only channels don't need owner approval
  const linkedChannels = await prisma.linkedChannels.findMany({
    where: { giveawayId, role: { in: ['All', 'Posting'] } },
    include: {
      channel: {
        include: {
          addedBy: {
            include: {
              user: {
                select: {
                  id: true,
                  telegramId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const sponsorChannels: Array<{
    channelId: bigint;
    channelTitle: string;
    channelUsername: string | null;
    owners: Array<{ userId: number; telegramId: string }>;
  }> = [];

  for (const lc of linkedChannels) {
    // Check if the giveaway creator is among the channel owners
    const isCreatorOwner = lc.channel.addedBy.some(
      (ab) => ab.userId === creatorUserId,
    );

    if (!isCreatorOwner) {
      // This is a sponsor channel - get all owners
      const owners = lc.channel.addedBy
        .filter((ab) => ab.user.telegramId) // Only include owners with telegramId
        .map((ab) => ({
          userId: ab.user.id,
          telegramId: ab.user.telegramId,
        }));

      // Always add to sponsorChannels to exclude from immediate publish,
      // even if no owners have telegramId yet (callers iterate owners safely).
      sponsorChannels.push({
        channelId: lc.channel.id,
        channelTitle: lc.channel.title || `Channel ${lc.channel.id}`,
        channelUsername: lc.channel.username,
        owners,
      });
    }
  }

  return sponsorChannels;
}

/**
 * Send approval request message to a sponsor channel owner
 * @param ownerTelegramId - Owner's Telegram ID
 * @param ownerFirstName - Owner's first name
 * @param ownerLastName - Owner's last name
 * @param giveaway - Giveaway data with type and language
 * @param channelId - Channel ID
 * @param channelTitle - Channel title
 * @param approvalId - Approval record ID for callback
 * @returns Result with message ID if successful
 */
export async function sendSponsorApprovalRequest(
  ownerTelegramId: string,
  ownerFirstName: string,
  ownerLastName: string | null,
  giveaway: {
    id: string;
    type: string;
    createdById: number;
    banner?: string[];
  },
  channelId: bigint,
  channelTitle: string,
  approvalId: number,
  recipientLanguage: string,
  recipientUserId: number,
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const lang = normalizeGiveawayLanguage(recipientLanguage);
  const messages = SPONSOR_APPROVAL_MESSAGES[lang];
  const giveawayType = giveaway.type === 'lottery' ? 'lottery' : 'random';

  // Format the request message
  const text = messages.requestMessage(
    ownerFirstName,
    ownerLastName || '',
    channelTitle,
    giveawayType,
  );

  const manageUrl = buildManageGiveawayStartappUrl(
    process.env.BOT_URL,
    giveaway.id,
    recipientUserId,
    giveaway.createdById,
  );

  // Create inline keyboard with manage/publish buttons
  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: messages.manageButton,
          url: manageUrl,
        },
        {
          text: messages.publishButton(giveawayType),
          callback_data: `sponsor_publish:${approvalId}`,
        },
      ],
    ],
  };

  // Handle banners similar to regular giveaway posts
  const banners = giveaway.banner || [];
  const validBanners = banners.filter((b: string) => b && b.trim() !== '');

  if (validBanners.length === 0) {
    // No banners - send default animation
    return await sendAnimation(
      ownerTelegramId,
      '/static/giveaways/standart.mp4',
      text,
      {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
      },
    );
  } else if (validBanners.length === 1) {
    // Single banner - send photo or animation (GIF) with caption
    const singleBanner = validBanners[0];
    if (isGifUrl(singleBanner)) {
      return await sendAnimation(ownerTelegramId, singleBanner, text, {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
      });
    }
    return await sendPhoto(ownerTelegramId, singleBanner, text, {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard,
    });
  } else {
    // Multiple banners - send media group first, then text with buttons
    const chatIdBigInt = BigInt(ownerTelegramId);
    const photoUrls = validBanners.slice(0, 10);

    await sendMediaGroup(chatIdBigInt, photoUrls, text, {
      parse_mode: 'HTML',
    });

    // Send text message with buttons after media group
    return await sendMessage(ownerTelegramId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: inlineKeyboard,
    });
  }
}

/**
 * Who currently manages a shared channel for this giveaway (first publisher wins).
 */
export async function getSharedChannelClaimant(
  giveawayId: string,
  channelId: bigint,
): Promise<{ userId: number } | null> {
  const linked = await prisma.linkedChannels.findUnique({
    where: { channelId_giveawayId: { channelId, giveawayId } },
    select: { managedByUserId: true },
  });
  if (linked) {
    return linked.managedByUserId == null
      ? null
      : { userId: linked.managedByUserId };
  }

  // /postlot to a channel not linked to the giveaway uses its unique
  // publication row as the ownership record.
  const postlot = await prisma.postlotPublication.findUnique({
    where: { channelId_giveawayId: { channelId, giveawayId } },
    select: { publishedById: true },
  });
  if (postlot) {
    return { userId: postlot.publishedById };
  }

  return null;
}

async function lockSponsorApprovalDm(
  telegramId: string,
  messageId: bigint,
  text: string,
): Promise<void> {
  const chatId = telegramId;
  const msgId = Number(messageId);

  try {
    await axios.post(`${TELEGRAM_API_BASE}/editMessageReplyMarkup`, {
      chat_id: chatId,
      message_id: msgId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch {
    // Message may already have no keyboard / be deleted
  }

  try {
    await axios.post(`${TELEGRAM_API_BASE}/editMessageCaption`, {
      chat_id: chatId,
      message_id: msgId,
      caption: text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },
    });
    return;
  } catch {
    // Not a caption message — try text
  }

  try {
    await axios.post(`${TELEGRAM_API_BASE}/editMessageText`, {
      chat_id: chatId,
      message_id: msgId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },
    });
  } catch (error: any) {
    console.error(
      `[SharedClaim] Failed to lock approval DM tg=${telegramId} msg=${messageId}:`,
      error.response?.data || error.message,
    );
  }
}

/**
 * Claim shared management for a channel: approve claimant, reject other Pending
 * approvals, and edit other admins' DMs (remove buttons + lock text).
 */
export async function claimSharedChannelManagement(
  giveawayId: string,
  channelId: bigint,
  claimantUserId: number,
  options: { finalize?: boolean } = {},
): Promise<{ claimed: boolean; alreadyClaimedBy?: number }> {
  const linked = await prisma.linkedChannels.findUnique({
    where: { channelId_giveawayId: { channelId, giveawayId } },
    select: { managedByUserId: true },
  });

  if (linked) {
    // Atomic compare-and-set: only one admin can change NULL -> their user id.
    const reserved = await prisma.linkedChannels.updateMany({
      where: {
        giveawayId,
        channelId,
        OR: [{ managedByUserId: null }, { managedByUserId: claimantUserId }],
      },
      data: { managedByUserId: claimantUserId },
    });
    if (reserved.count === 0) {
      const current = await prisma.linkedChannels.findUnique({
        where: { channelId_giveawayId: { channelId, giveawayId } },
        select: { managedByUserId: true },
      });
      return {
        claimed: false,
        alreadyClaimedBy: current?.managedByUserId ?? undefined,
      };
    }
  } else {
    const postlot = await prisma.postlotPublication.findUnique({
      where: { channelId_giveawayId: { channelId, giveawayId } },
      select: { publishedById: true },
    });
    if (postlot && postlot.publishedById !== claimantUserId) {
      return { claimed: false, alreadyClaimedBy: postlot.publishedById };
    }
    // For an unlinked channel, postGiveawayToAdditionalChannel atomically
    // reserves PostlotPublication before sending to Telegram.
    if (!postlot) return { claimed: true };
  }

  if (options.finalize === false) return { claimed: true };

  const others = await prisma.$transaction(async (tx) => {
    await tx.sponsorApproval.updateMany({
      where: {
        giveawayId,
        channelId,
        ownerUserId: claimantUserId,
        status: {
          in: [SponsorApprovalStatus.Pending, SponsorApprovalStatus.Approved],
        },
      },
      data: {
        status: SponsorApprovalStatus.Approved,
        respondedAt: new Date(),
      },
    });

    const pendingOthers = await tx.sponsorApproval.findMany({
      where: {
        giveawayId,
        channelId,
        ownerUserId: { not: claimantUserId },
        status: SponsorApprovalStatus.Pending,
      },
      include: {
        owner: {
          select: {
            telegramId: true,
            first_name: true,
            last_name: true,
            picked_language: true,
            language_code: true,
          },
        },
        channel: { select: { title: true } },
        giveaway: { select: { participiationType: true } },
      },
    });

    if (pendingOthers.length > 0) {
      await tx.sponsorApproval.updateMany({
        where: {
          id: { in: pendingOthers.map((p) => p.id) },
        },
        data: {
          status: SponsorApprovalStatus.Rejected,
          respondedAt: new Date(),
        },
      });
    }

    return { rows: pendingOthers };
  });

  for (const other of others.rows) {
    if (!other.messageId || !other.owner.telegramId) continue;
    const lang = getUserLanguage(other.owner);
    const msgs = SPONSOR_APPROVAL_MESSAGES[lang];
    const giveawayType =
      other.giveaway.participiationType === 'Lottery' ? 'lottery' : 'random';
    const text =
      msgs.requestMessage(
        other.owner.first_name || '',
        other.owner.last_name || '',
        other.channel.title || String(channelId),
        giveawayType,
      ) + `\n\n${msgs.managementTakenStatus}`;
    await lockSponsorApprovalDm(other.owner.telegramId, other.messageId, text);
  }

  return { claimed: true };
}

/**
 * Release a linked-channel reservation when Telegram publication failed.
 * Never releases a completed post or another user's claim.
 */
export async function releaseSharedChannelManagement(
  giveawayId: string,
  channelId: bigint,
  claimantUserId: number,
): Promise<void> {
  const published = await prisma.giveawayMessage.findFirst({
    where: { giveawayId, channelId },
    select: { id: true },
  });
  if (published) return;

  await prisma.linkedChannels.updateMany({
    where: { giveawayId, channelId, managedByUserId: claimantUserId },
    data: { managedByUserId: null, publicationReservedAt: null },
  });
}

/**
 * DB-backed publication mutex for linked channels. It blocks double clicks
 * from the same claimant as well as concurrent bot instances. It is not
 * auto-expired: after an ambiguous Telegram timeout, retrying could duplicate
 * a post. Operations can clear a confirmed stale reservation manually.
 */
export async function reserveSharedChannelPublication(
  giveawayId: string,
  channelId: bigint,
  claimantUserId: number,
): Promise<boolean> {
  const published = await prisma.giveawayMessage.findFirst({
    where: { giveawayId, channelId },
    select: { id: true },
  });
  if (published) return false;

  const reserved = await prisma.linkedChannels.updateMany({
    where: {
      giveawayId,
      channelId,
      AND: [
        {
          OR: [
            { managedByUserId: claimantUserId },
            { giveaway: { createdById: claimantUserId } },
          ],
        },
        { publicationReservedAt: null },
      ],
    },
    data: { publicationReservedAt: new Date() },
  });
  return reserved.count === 1;
}

export async function releaseSharedChannelPublication(
  giveawayId: string,
  channelId: bigint,
  claimantUserId: number,
): Promise<void> {
  await prisma.linkedChannels.updateMany({
    where: {
      giveawayId,
      channelId,
      OR: [
        { managedByUserId: claimantUserId },
        { giveaway: { createdById: claimantUserId } },
      ],
    },
    data: { publicationReservedAt: null },
  });
}

/**
 * Lock one admin's pending approval DM after another admin already claimed.
 */
export async function rejectAndLockSponsorApproval(
  approvalId: number,
  claimantUserId?: number,
): Promise<void> {
  const approval = await prisma.sponsorApproval.findUnique({
    where: { id: approvalId },
    include: {
      owner: {
        select: {
          telegramId: true,
          first_name: true,
          last_name: true,
          picked_language: true,
          language_code: true,
        },
      },
      channel: { select: { title: true } },
      giveaway: { select: { participiationType: true } },
    },
  });
  if (!approval) return;
  if (claimantUserId != null && approval.ownerUserId === claimantUserId) return;

  if (approval.status === SponsorApprovalStatus.Pending) {
    await prisma.sponsorApproval.update({
      where: { id: approvalId },
      data: {
        status: SponsorApprovalStatus.Rejected,
        respondedAt: new Date(),
      },
    });
  }

  if (!approval.messageId || !approval.owner.telegramId) return;

  const lang = getUserLanguage(approval.owner);
  const msgs = SPONSOR_APPROVAL_MESSAGES[lang];
  const giveawayType =
    approval.giveaway.participiationType === 'Lottery' ? 'lottery' : 'random';
  const text =
    msgs.requestMessage(
      approval.owner.first_name || '',
      approval.owner.last_name || '',
      approval.channel.title || String(approval.channelId),
      giveawayType,
    ) + `\n\n${msgs.managementTakenStatus}`;

  await lockSponsorApprovalDm(
    approval.owner.telegramId,
    approval.messageId,
    text,
  );
}

/**
 * Notify a co-owner that the giveaway on their channel has ended and they can publish results.
 * Called when a co-owner has isPostingResults = false at giveaway end.
 */
export async function sendCoOwnerResultsNotification(
  ownerTelegramId: string,
  ownerFirstName: string,
  ownerLastName: string | null,
  giveaway: {
    id: string;
    type: string;
    createdById: number;
    banner?: string[];
  },
  channelId: bigint,
  channelTitle: string,
  recipientLanguage: string,
  recipientUserId: number,
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const lang = normalizeGiveawayLanguage(recipientLanguage);
  const messages = COOWNER_RESULTS_MESSAGES[lang];
  const giveawayType = giveaway.type === 'Lottery' ? 'lottery' : 'random';

  const text = messages.notification(
    ownerFirstName,
    ownerLastName,
    channelTitle,
    giveawayType,
  );

  const manageUrl = buildManageGiveawayStartappUrl(
    process.env.BOT_URL,
    giveaway.id,
    recipientUserId,
    giveaway.createdById,
  );

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: messages.manageButton, url: manageUrl },
        {
          text: messages.publishButton,
          callback_data: `co_r:${giveaway.id}:${channelId}`,
        },
      ],
    ],
  };

  const banners = giveaway.banner || [];
  const validBanners = banners.filter((b: string) => b && b.trim() !== '');

  if (validBanners.length === 0) {
    return await sendAnimation(
      ownerTelegramId,
      '/static/giveaways/standart.mp4',
      text,
      {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
      },
    );
  } else if (validBanners.length === 1) {
    const singleBanner = validBanners[0];
    if (isGifUrl(singleBanner)) {
      return await sendAnimation(ownerTelegramId, singleBanner, text, {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
      });
    }
    return await sendPhoto(ownerTelegramId, singleBanner, text, {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard,
    });
  } else {
    await sendMediaGroup(
      BigInt(ownerTelegramId),
      validBanners.slice(0, 10),
      text,
      {
        parse_mode: 'HTML',
      },
    );
    return await sendMessage(ownerTelegramId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: inlineKeyboard,
    });
  }
}

/**
 * Post giveaway announcement to a specific sponsor channel with unique tracking link
 * @param giveawayId - The giveaway ID
 * @param channelId - The channel ID to post to
 * @param trackingCode - Unique tracking code for statistics
 * @returns Result with message IDs
 */
export async function postGiveawayToSponsorChannel(
  giveawayId: string,
  channelId: bigint,
  trackingCode: string,
): Promise<{
  success: boolean;
  messageIds?: number[];
  error?: string;
}> {
  const messageIds: number[] = [];
  try {
    const webappUrl = process.env.BOT_URL;

    // Fetch giveaway with all relations
    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
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
        participants: true,
        createdBy: true,
        prizes: GIVEAWAY_LINKED_ONLY_PRIZES_INCLUDE,
      },
    });

    if (!giveaway) {
      return { success: false, error: 'Giveaway not found' };
    }

    if (!giveaway.isActive || giveaway.isCancelled) {
      return { success: false, error: 'Giveaway is not active' };
    }

    // Find the specific channel
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      return { success: false, error: 'Channel not found' };
    }

    const existingMessage = await prisma.giveawayMessage.findFirst({
      where: { giveawayId, channelId },
    });
    if (existingMessage) {
      return { success: false, error: 'already_posted' };
    }

    // Generate tracking URL
    const trackingWebappUrl = `${webappUrl}?startapp=giveawayId_${giveawayId}_sponsor_${trackingCode}`;

    // Format message (reuse existing logic)
    const messageText = formatGiveawayMessage(giveaway);

    const inlineKeyboard = buildParticipationKeyboard(
      giveaway,
      trackingWebappUrl,
    );

    const banners = giveaway.banner.filter((b) => b && b.trim() !== '');

    if (banners.length === 0) {
      // No banners - send standard video animation with caption
      let result = await sendAnimation(
        channelId,
        '/static/giveaways/standart.mp4',
        messageText,
        {
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard,
        },
      );

      // Fallback: retry with plain text if HTML entities are invalid
      if (!result.success && result.error?.includes("can't parse entities")) {
        const plainContent = stripHtmlTags(messageText);
        result = await sendAnimation(
          channelId,
          '/static/giveaways/standart.mp4',
          plainContent,
          {
            reply_markup: inlineKeyboard,
          },
        );
      }

      if (result.success && result.messageId) {
        messageIds.push(result.messageId);
      } else {
        return {
          success: false,
          error: result.error || 'Failed to send message',
        };
      }
    } else if (banners.length === 1) {
      // Single banner - send photo or animation (GIF) with caption
      const bannerUrl = toAbsoluteUrl(banners[0]);
      let result = isGifUrl(bannerUrl)
        ? await sendAnimation(channelId.toString(), bannerUrl, messageText, {
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard,
          })
        : await sendPhoto(channelId.toString(), bannerUrl, messageText, {
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard,
          });

      // Fallback: retry with plain text if HTML entities are invalid
      if (!result.success && result.error?.includes("can't parse entities")) {
        const plainContent = stripHtmlTags(messageText);
        result = isGifUrl(bannerUrl)
          ? await sendAnimation(channelId.toString(), bannerUrl, plainContent, {
              reply_markup: inlineKeyboard,
            })
          : await sendPhoto(channelId.toString(), bannerUrl, plainContent, {
              reply_markup: inlineKeyboard,
            });
      }

      if (result.success && result.messageId) {
        messageIds.push(result.messageId);
      } else {
        return {
          success: false,
          error: result.error || 'Failed to send photo',
        };
      }
    } else {
      // Multiple banners - send media group then text message
      const mediaGroupResult = await sendMediaGroup(
        channelId,
        banners.map((b) => toAbsoluteUrl(b)),
      );

      if (!mediaGroupResult.success) {
        return {
          success: false,
          error: mediaGroupResult.error || 'Failed to send media group',
        };
      }

      if (mediaGroupResult.messageIds) {
        messageIds.push(...mediaGroupResult.messageIds);
      }

      // Send text message with button
      let textResult = await sendMessage(channelId.toString(), messageText, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });

      // Fallback: retry with plain text if HTML entities are invalid
      if (
        !textResult.success &&
        textResult.error?.includes("can't parse entities")
      ) {
        const plainContent = stripHtmlTags(messageText);
        textResult = await sendMessage(channelId.toString(), plainContent, {
          disable_web_page_preview: true,
          reply_markup: inlineKeyboard,
        });
      }

      if (textResult.success && textResult.messageId) {
        messageIds.push(textResult.messageId);
      }
    }

    // Save message record to database
    if (messageIds.length > 0) {
      await prisma.giveawayMessage.create({
        data: {
          giveawayId,
          channelId,
          messageId: BigInt(messageIds[messageIds.length - 1]), // Main message (last one)
          mediaGroupMessageId:
            messageIds.length > 1 ? BigInt(messageIds[0]) : null, // First message if media group
        },
      });
    }

    console.log(
      `Posted giveaway ${giveawayId} to sponsor channel ${channelId} with tracking code ${trackingCode}`,
    );

    return { success: true, messageIds };
  } catch (error: any) {
    console.error(
      `Error posting giveaway to sponsor channel ${channelId}:`,
      error.message,
    );
    return {
      success: false,
      messageIds,
      error: messageIds.length > 0 ? 'posted_but_not_saved' : error.message,
    };
  }
}

export async function postGiveawayToAdditionalChannel(
  giveawayId: string,
  channelId: bigint,
  userId: number,
): Promise<{ success: boolean; messageIds?: number[]; error?: string }> {
  let reservedPostlotId: number | null = null;
  let postlotCompleted = false;
  const messageIds: number[] = [];
  try {
    const webappUrl = process.env.BOT_URL;

    const giveaway = await prisma.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        linkedChannels: { include: { channel: true } },
        sponsoredBy: { include: { sponsorChannel: true, sponsorLink: true } },
        participants: true,
        createdBy: true,
        prizes: GIVEAWAY_LINKED_ONLY_PRIZES_INCLUDE,
      },
    });

    if (!giveaway) {
      return { success: false, error: 'Giveaway not found' };
    }

    if (!giveaway.isActive || giveaway.isCancelled) {
      return { success: false, error: 'Giveaway is not active' };
    }

    const isLinkedChannel = await prisma.linkedChannels.findUnique({
      where: { channelId_giveawayId: { channelId, giveawayId } },
    });

    if (isLinkedChannel) {
      const alreadyMessage = await prisma.giveawayMessage.findFirst({
        where: { giveawayId, channelId },
      });
      if (alreadyMessage) return { success: false, error: 'already_posted' };
    } else {
      // Empty rows are durable reservations. Do not auto-expire them: an
      // ambiguous Telegram timeout may already have produced a channel post.
      const alreadyPublished = await prisma.postlotPublication.findUnique({
        where: { channelId_giveawayId: { channelId, giveawayId } },
      });
      if (alreadyPublished) return { success: false, error: 'already_posted' };
    }

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) {
      return { success: false, error: 'Channel not found' };
    }
    if (!channel.botCanPostMessages) {
      return {
        success: false,
        error: 'Bot cannot post messages to this channel',
      };
    }

    if (!isLinkedChannel) {
      try {
        const reservation = await prisma.postlotPublication.create({
          data: {
            giveawayId,
            channelId,
            publishedById: userId,
            messageIds: [],
          },
          select: { id: true },
        });
        reservedPostlotId = reservation.id;
      } catch {
        // @@unique([channelId, giveawayId]) is the atomic /postlot hard lock.
        return { success: false, error: 'already_posted' };
      }
    }

    const giveawayUrl = `${webappUrl}?startapp=giveawayId_${giveawayId}`;
    const messageText = formatGiveawayMessage(giveaway);
    const inlineKeyboard = buildParticipationKeyboard(giveaway, giveawayUrl);

    const banners = giveaway.banner.filter((b) => b && b.trim() !== '');

    if (banners.length === 0) {
      let result = await sendAnimation(
        channelId,
        '/static/giveaways/standart.mp4',
        messageText,
        {
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard,
        },
      );
      if (!result.success && result.error?.includes("can't parse entities")) {
        result = await sendAnimation(
          channelId,
          '/static/giveaways/standart.mp4',
          stripHtmlTags(messageText),
          {
            reply_markup: inlineKeyboard,
          },
        );
      }
      if (result.success && result.messageId) {
        messageIds.push(result.messageId);
      } else {
        return {
          success: false,
          error: result.error || 'Failed to send message',
        };
      }
    } else if (banners.length === 1) {
      const bannerUrl = toAbsoluteUrl(banners[0]);
      let result = isGifUrl(bannerUrl)
        ? await sendAnimation(channelId.toString(), bannerUrl, messageText, {
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard,
          })
        : await sendPhoto(channelId.toString(), bannerUrl, messageText, {
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard,
          });
      if (!result.success && result.error?.includes("can't parse entities")) {
        const plain = stripHtmlTags(messageText);
        result = isGifUrl(bannerUrl)
          ? await sendAnimation(channelId.toString(), bannerUrl, plain, {
              reply_markup: inlineKeyboard,
            })
          : await sendPhoto(channelId.toString(), bannerUrl, plain, {
              reply_markup: inlineKeyboard,
            });
      }
      if (result.success && result.messageId) {
        messageIds.push(result.messageId);
      } else {
        return {
          success: false,
          error: result.error || 'Failed to send photo',
        };
      }
    } else {
      const mediaGroupResult = await sendMediaGroup(
        channelId,
        banners.map((b) => toAbsoluteUrl(b)),
      );
      if (!mediaGroupResult.success) {
        return {
          success: false,
          error: mediaGroupResult.error || 'Failed to send media group',
        };
      }
      if (mediaGroupResult.messageIds) {
        messageIds.push(...mediaGroupResult.messageIds);
      }
      let textResult = await sendMessage(channelId.toString(), messageText, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard,
      });
      if (
        !textResult.success &&
        textResult.error?.includes("can't parse entities")
      ) {
        textResult = await sendMessage(
          channelId.toString(),
          stripHtmlTags(messageText),
          {
            disable_web_page_preview: true,
            reply_markup: inlineKeyboard,
          },
        );
      }
      if (textResult.success && textResult.messageId) {
        messageIds.push(textResult.messageId);
      }
    }

    if (messageIds.length > 0) {
      // A Telegram side effect happened. Keep the DB reservation even if the
      // subsequent metadata write fails, otherwise a retry can double-post.
      if (!isLinkedChannel) postlotCompleted = true;
      if (isLinkedChannel) {
        await prisma.giveawayMessage.create({
          data: {
            giveawayId,
            channelId,
            messageId: BigInt(messageIds[messageIds.length - 1]),
            mediaGroupMessageId:
              messageIds.length > 1 ? BigInt(messageIds[0]) : null,
          },
        });
      } else {
        await prisma.postlotPublication.update({
          where: { id: reservedPostlotId! },
          data: { messageIds: messageIds.map(BigInt) },
        });
      }
    }

    console.log(
      `Posted giveaway ${giveawayId} to additional channel ${channelId}`,
    );
    return { success: true, messageIds };
  } catch (error: any) {
    console.error(
      `Error posting giveaway to additional channel ${channelId}:`,
      error.message,
    );
    return {
      success: false,
      messageIds,
      error: messageIds.length > 0 ? 'posted_but_not_saved' : error.message,
    };
  } finally {
    if (reservedPostlotId != null && !postlotCompleted) {
      await prisma.postlotPublication
        .deleteMany({
          where: {
            id: reservedPostlotId,
            publishedById: userId,
            messageIds: { isEmpty: true },
          },
        })
        .catch(() => undefined);
    }
  }
}

export async function sendCreatorActivationNotification(
  creatorTelegramId: string,
  giveawayId: string,
  giveawayType: 'random' | 'lottery',
  language: string,
  hasSponsorChannels: boolean,
  banner?: string[],
): Promise<void> {
  const creator = await prisma.user.findFirst({
    where: { telegramId: creatorTelegramId },
    select: { picked_language: true, language_code: true },
  });
  const lang = creator
    ? getUserLanguage(creator)
    : normalizeGiveawayLanguage(language);
  const messages = GIVEAWAY_ACTIVATION_MESSAGES[lang];
  const webappUrl = process.env.BOT_URL;
  const manageUrl = buildGiveawayStartappUrl(webappUrl, 'owner', giveawayId);

  let text = messages.started(giveawayType);
  if (hasSponsorChannels) {
    text += `\n\n${messages.coOwnersNotified}`;
  }

  const postCode = giveawayId.replace(/-/g, '');
  text += `\n\n${messages.postlotShare(`/postlot${postCode}`)}`;

  const replyMarkup = {
    inline_keyboard: [[{ text: messages.manageButton, url: manageUrl }]],
  };

  const validBanners = (banner || []).filter((b) => b && b.trim() !== '');
  if (validBanners.length >= 1) {
    const bannerUrl = toAbsoluteUrl(validBanners[0]);
    if (isGifUrl(bannerUrl)) {
      await sendAnimation(creatorTelegramId, bannerUrl, text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    } else {
      await sendPhoto(creatorTelegramId, bannerUrl, text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    }
  } else {
    await sendMessage(creatorTelegramId, text, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }
}

export async function editLinkRequestMessage(
  chatId: string,
  messageId: bigint,
  originalText: string,
  statusLine: string,
  remainingKeyboard: Array<
    Array<{ text: string; url?: string; callback_data?: string }>
  >,
): Promise<void> {
  try {
    await queueTelegramRequest(() =>
      axios.post(`${TELEGRAM_API_BASE}/editMessageText`, {
        chat_id: chatId,
        message_id: Number(messageId),
        text: `${originalText}\n\n<blockquote>${statusLine}</blockquote>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: remainingKeyboard },
      }),
    );
  } catch (err) {
    console.error('editLinkRequestMessage error:', err);
  }
}

export async function sendLinkRequestCreatorNotification(
  creatorTelegramId: string,
  requesterFirstName: string,
  requesterLastName: string | null,
  channelTitle: string,
  channelUsername: string | null,
  requesterTelegramId: string,
  giveawayLanguage: string,
  requestId: number,
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const lang = normalizeGiveawayLanguage(giveawayLanguage);
  const messages = LINK_REQUEST_MESSAGES[lang];

  const text = messages.creatorRequest(
    requesterFirstName,
    requesterLastName,
    channelTitle,
  );

  const keyboard: Array<
    Array<{ text: string; url?: string; callback_data?: string }>
  > = [
    [
      { text: messages.creatorAcceptBtn, callback_data: `la:${requestId}` },
      { text: messages.creatorDeclineBtn, callback_data: `ld:${requestId}` },
    ],
  ];
  if (channelUsername) {
    keyboard.push([
      { text: channelTitle, url: `https://t.me/${channelUsername}` },
    ]);
  }
  keyboard.push([
    {
      text: messages.creatorContactBtn,
      url: `tg://user?id=${requesterTelegramId}`,
    },
  ]);

  return await sendMessage(creatorTelegramId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function sendLinkRequestSenderNotification(
  senderTelegramId: string,
  senderFirstName: string,
  senderLastName: string | null,
  giveawayLanguage: string,
  requestId: number,
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const lang = normalizeGiveawayLanguage(giveawayLanguage);
  const messages = LINK_REQUEST_MESSAGES[lang];

  const text = messages.senderSubmitted(senderFirstName, senderLastName);

  return await sendMessage(senderTelegramId, text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: messages.senderWithdrawBtn,
            callback_data: `lw:${requestId}`,
          },
        ],
      ],
    },
  });
}

const CHANNEL_ADMIN_STATUSES = new Set(['creator', 'administrator']);

export type SyncChannelFromTelegramOptions = {
  reconcileOwnership?: boolean;
};

/**
 * Refresh channel title/username/type from Telegram getChat.
 * Optionally reconcile addedBy rows against current creator/admins.
 */
export async function syncChannelFromTelegram(
  channelId: bigint,
  options?: SyncChannelFromTelegramOptions,
) {
  if (!BOT_TOKEN) {
    console.error('syncChannelFromTelegram: BOT_TOKEN is not set');
    return null;
  }

  try {
    const response = await axios.get<
      TelegramApiResponse<{
        id: number;
        title?: string;
        username?: string;
        type?: string;
      }>
    >(`${TELEGRAM_API_BASE}/getChat`, {
      params: { chat_id: channelId.toString() },
      timeout: 10000,
    });

    if (!response.data.ok || !response.data.result) {
      console.warn(
        `syncChannelFromTelegram: getChat failed for ${channelId}: ${response.data.description ?? 'unknown error'}`,
      );
      return null;
    }

    const chat = response.data.result;
    const channel = await prisma.channel.upsert({
      where: { id: channelId },
      create: {
        id: channelId,
        title: chat.title || `Chat ${channelId}`,
        username: chat.username ?? null,
        type: chat.type ?? 'channel',
        isActive: true,
      },
      update: {
        title: chat.title ?? undefined,
        username: chat.username ?? null,
        type: chat.type ?? undefined,
        isActive: true,
      },
    });

    if (options?.reconcileOwnership) {
      await reconcileChannelAddedBy(channelId);
    }

    return channel;
  } catch (error: any) {
    console.error(
      `syncChannelFromTelegram error for ${channelId}:`,
      error.response?.data || error.message,
    );
    return null;
  }
}

/**
 * Keep addedBy in sync with Telegram creator + administrators who have app accounts.
 * Removes stale owners and rejects their pending sponsor approvals.
 */
export async function reconcileChannelAddedBy(channelId: bigint) {
  if (!BOT_TOKEN) {
    console.error('reconcileChannelAddedBy: BOT_TOKEN is not set');
    return { removedUserIds: [] as number[], upsertedCount: 0 };
  }

  try {
    const response = await axios.get<
      TelegramApiResponse<
        Array<{
          status: string;
          user: { id: number; is_bot?: boolean };
        }>
      >
    >(`${TELEGRAM_API_BASE}/getChatAdministrators`, {
      params: { chat_id: channelId.toString() },
      timeout: 10000,
    });

    if (!response.data.ok || !response.data.result) {
      console.warn(
        `reconcileChannelAddedBy: getChatAdministrators failed for ${channelId}`,
      );
      return { removedUserIds: [] as number[], upsertedCount: 0 };
    }

    const adminTelegramIds = response.data.result
      .filter(
        (member) =>
          CHANNEL_ADMIN_STATUSES.has(member.status) && !member.user.is_bot,
      )
      .map((member) => member.user.id.toString());

    const adminUsers = await prisma.user.findMany({
      where: { telegramId: { in: adminTelegramIds } },
      select: { id: true },
    });
    const validUserIds = adminUsers.map((u) => u.id);

    const existingAddedBy = await prisma.addedBy.findMany({
      where: { channelId },
      select: { userId: true },
    });
    const removedUserIds = existingAddedBy
      .map((row) => row.userId)
      .filter((userId) => !validUserIds.includes(userId));

    await prisma.$transaction(async (tx) => {
      if (validUserIds.length === 0) {
        await tx.addedBy.deleteMany({ where: { channelId } });
      } else {
        await tx.addedBy.deleteMany({
          where: {
            channelId,
            userId: { notIn: validUserIds },
          },
        });

        for (const userId of validUserIds) {
          await tx.addedBy.upsert({
            where: {
              channelId_userId: { channelId, userId },
            },
            create: { channelId, userId },
            update: { updatedAt: new Date() },
          });
        }
      }

      if (removedUserIds.length > 0) {
        await tx.sponsorApproval.updateMany({
          where: {
            channelId,
            ownerUserId: { in: removedUserIds },
            status: SponsorApprovalStatus.Pending,
          },
          data: {
            status: SponsorApprovalStatus.Rejected,
            respondedAt: new Date(),
          },
        });
      }
    });

    if (removedUserIds.length > 0) {
      const linkedGiveaway = await prisma.linkedChannels.findFirst({
        where: {
          channelId,
          giveaway: {
            isCancelled: false,
            OR: [{ isActive: true }, { isPlanned: true }],
          },
        },
        select: { giveawayId: true },
      });
      if (linkedGiveaway) {
        console.warn(
          `[reconcileChannelAddedBy] channel ${channelId} linked to giveaway ${linkedGiveaway.giveawayId} has no valid addedBy admin after reconcile`,
        );
      }
    }

    return { removedUserIds, upsertedCount: validUserIds.length };
  } catch (error: any) {
    console.error(
      `reconcileChannelAddedBy error for ${channelId}:`,
      error.response?.data || error.message,
    );
    return { removedUserIds: [] as number[], upsertedCount: 0 };
  }
}

const OWNERSHIP_RECONCILE_BATCH = 5;

async function reconcileChannelIds(
  channelIds: Iterable<bigint>,
): Promise<void> {
  const unique = [...new Set(channelIds)];
  for (let i = 0; i < unique.length; i += OWNERSHIP_RECONCILE_BATCH) {
    await Promise.all(
      unique
        .slice(i, i + OWNERSHIP_RECONCILE_BATCH)
        .map((channelId) => reconcileChannelAddedBy(channelId)),
    );
  }
}

/**
 * Sync addedBy for all posting channels linked to a giveaway.
 * Call when user opens /postlot or a giveaway deep link so new channel admins appear in addedBy.
 */
export async function reconcileChannelsForGiveaway(
  giveawayId: string,
): Promise<void> {
  const linked = await prisma.linkedChannels.findMany({
    where: { giveawayId, role: { in: ['All', 'Posting'] } },
    select: { channelId: true },
  });
  await reconcileChannelIds(linked.map((lc) => lc.channelId));
}

/**
 * Sync addedBy for channels the user already owns or that host their giveaways.
 * Call before listing "my channels" in the app.
 */
export async function reconcileChannelsForUser(userId: number): Promise<void> {
  const channelIds = new Set<bigint>();

  const owned = await prisma.addedBy.findMany({
    where: { userId },
    select: { channelId: true },
  });
  owned.forEach((row) => channelIds.add(row.channelId));

  const linked = await prisma.linkedChannels.findMany({
    where: {
      role: { in: ['All', 'Posting'] },
      OR: [
        { giveaway: { createdById: userId, isCancelled: false } },
        { channel: { addedBy: { some: { userId } } } },
      ],
    },
    select: { channelId: true },
  });
  linked.forEach((row) => channelIds.add(row.channelId));

  await reconcileChannelIds(channelIds);
}

/** Channels linked to active/planned giveaways or with pending joint requests. */
export async function getChannelsNeedingMetadataSync() {
  return prisma.channel.findMany({
    where: {
      isActive: true,
      OR: [
        {
          refferencedIn: {
            some: {
              giveaway: {
                isCancelled: false,
                OR: [{ isActive: true }, { isPlanned: true }],
              },
            },
          },
        },
        {
          linkRequests: {
            some: { status: 'Pending' },
          },
        },
      ],
    },
    select: { id: true },
  });
}

/** Same scope as metadata sync — used for daily ownership reconcile. */
export async function getChannelsNeedingOwnershipReconcile() {
  return prisma.channel.findMany({
    where: {
      isActive: true,
      refferencedIn: {
        some: {
          giveaway: {
            isCancelled: false,
            OR: [{ isActive: true }, { isPlanned: true }],
          },
        },
      },
    },
    select: { id: true },
  });
}

export type RefundTelegramStarPaymentOptions = {
  /**
   * When true (default), decrement in-app Stars after Telegram refund.
   * Set false for invoice spends that never credited the app wallet
   * (e.g. lottery tickets paid via Telegram Stars).
   */
  adjustWallet?: boolean;
};

async function markInvoiceRefundInLedger(
  telegramPaymentChargeId: string,
  appUserId: number,
  adjustWallet: boolean,
): Promise<void> {
  const refundedTransaction = await prisma.transactionHistory.findFirst({
    where: {
      telegramPaymentId: telegramPaymentChargeId,
      userId: appUserId,
      status: TransactionStatus.Completed,
    },
    include: { wallet: true },
  });

  if (!refundedTransaction?.wallet) return;

  await prisma.$transaction(async (tx) => {
    const walletBefore = await tx.wallet.findUnique({
      where: { id: refundedTransaction.walletId },
    });
    if (!walletBefore) return;

    const balanceBefore = walletBefore.starsBalance;
    const walletAfter = adjustWallet
      ? await tx.wallet.update({
          where: { id: refundedTransaction.walletId },
          data: { starsBalance: { decrement: refundedTransaction.value } },
        })
      : walletBefore;

    const priorInfo = refundedTransaction.additionalInfo ?? '';
    await tx.transactionHistory.update({
      where: { id: refundedTransaction.id },
      data: {
        status: TransactionStatus.Failed,
        additionalInfo: priorInfo.includes('REFUNDED:')
          ? priorInfo
          : `${priorInfo}${priorInfo ? ' | ' : ''}REFUNDED: ${telegramPaymentChargeId}`,
      },
    });

    await tx.transactionHistory.create({
      data: {
        walletId: refundedTransaction.walletId,
        userId: appUserId,
        type: TransactionType.Outcoming,
        status: TransactionStatus.Completed,
        currency: Currencies.Stars,
        value: refundedTransaction.value,
        balanceBefore,
        balanceAfter: walletAfter.starsBalance,
        telegramPaymentId: telegramPaymentChargeId,
        additionalInfo: adjustWallet
          ? `Refund for: ${telegramPaymentChargeId}`
          : `Refund for: ${telegramPaymentChargeId} (invoice, wallet unchanged)`,
      },
    });
  });
}

/**
 * Refund a Telegram Stars invoice payment and mark the ledger entry refunded.
 */
export async function refundTelegramStarPayment(
  telegramUserId: number,
  telegramPaymentChargeId: string,
  appUserId: number,
  options?: RefundTelegramStarPaymentOptions,
): Promise<boolean> {
  const adjustWallet = options?.adjustWallet !== false;

  try {
    const response = await axios.post(
      `${TELEGRAM_API_BASE}/refundStarPayment`,
      {
        user_id: telegramUserId,
        telegram_payment_charge_id: telegramPaymentChargeId,
      },
      { timeout: 15000 },
    );

    if (!response.data.ok) {
      const description = String(response.data.description ?? '');
      if (/already.?refunded|CHARGE_ALREADY_REFUNDED/i.test(description)) {
        console.warn(
          `refundTelegramStarPayment: charge already refunded, syncing ledger: ${telegramPaymentChargeId}`,
        );
        await markInvoiceRefundInLedger(
          telegramPaymentChargeId,
          appUserId,
          adjustWallet,
        );
        return true;
      }
      console.error(
        'refundTelegramStarPayment failed:',
        response.data.description,
      );
      return false;
    }

    await markInvoiceRefundInLedger(
      telegramPaymentChargeId,
      appUserId,
      adjustWallet,
    );

    return true;
  } catch (error: any) {
    const description =
      error.response?.data?.description ||
      error.response?.data?.error_code ||
      error.message;
    const alreadyRefunded =
      typeof description === 'string' &&
      /already.?refunded|CHARGE_ALREADY_REFUNDED/i.test(description);

    if (alreadyRefunded) {
      console.warn(
        `refundTelegramStarPayment: charge already refunded, syncing ledger: ${telegramPaymentChargeId}`,
      );
      try {
        await markInvoiceRefundInLedger(
          telegramPaymentChargeId,
          appUserId,
          adjustWallet,
        );
        return true;
      } catch (ledgerError) {
        console.error(
          'refundTelegramStarPayment ledger sync after already-refunded failed:',
          ledgerError,
        );
        return false;
      }
    }

    console.error(
      'refundTelegramStarPayment error:',
      error.response?.data || error.message,
    );
    return false;
  }
}

// Export utility object for easier importing
export const TelegramBotUtils = {
  isUserMemberOfChannel,
  isUserBoostingChannel,
  getChatMemberInfo,
  batchCheckUserMembership,
  batchCheckUserBoosts,
  getUserActiveBoosts,
  checkBotAccess,
  generateInviteLink,
  sendMessage,
  sendPhoto,
  sendMediaGroup,
  sendGiveawayAnnouncement,
  repostGiveawayToChannel,
  updateGiveawayMessages,
  updateGiveawayButtons,
  finishGiveAwayTasks,
  generateTrackingCode,
  identifySponsorChannels,
  sendSponsorApprovalRequest,
  postGiveawayToSponsorChannel,
  claimSharedChannelManagement,
  getSharedChannelClaimant,
  rejectAndLockSponsorApproval,
  sendCoOwnerResultsNotification,
  sendCreatorActivationNotification,
  sendLinkRequestCreatorNotification,
  sendLinkRequestSenderNotification,
  editLinkRequestMessage,
  getBusinessGifts,
  transferGiftToUser,
  sendGiftToUser,
  getBusinessUsername,
  downloadGiftStickerTgs,
  isUniqueGift,
};

// Business account gift functions

async function getBusinessConnectionId(
  type: 'Standard' | 'Unique',
): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: {
      businessConnectionId: { not: null },
      businessAccountType: type,
      roleId: { in: [1, 2] }, // SuperAdmin = 1, Admin = 2
    },
    select: { businessConnectionId: true },
  });
  return user?.businessConnectionId ?? null;
}

export async function getBusinessUsername(
  type: 'Standard' | 'Unique' = 'Standard',
): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: {
      businessConnectionId: { not: null },
      businessAccountType: type,
      roleId: { in: [1, 2] }, // SuperAdmin = 1, Admin = 2
    },
    select: { username: true },
  });
  return user?.username ?? null;
}

export interface TgSticker {
  file_id: string;
  file_unique_id: string;
  is_animated?: boolean;
  is_video?: boolean;
  file_size?: number;
}

export interface TelegramUniqueGift {
  gift_id: string;
  base_name: string;
  name: string;
  number: number;
  model: { name: string; sticker: TgSticker; rarity_per_mille?: number };
  symbol: { name: string; sticker: TgSticker; rarity_per_mille?: number };
  backdrop: {
    name: string;
    rarity_per_mille?: number;
    center_color?: number;
    edge_color?: number;
    pattern_color?: number;
    text_color?: number;
  };
  is_premium?: boolean;
  is_burned?: boolean;
  is_from_blockchain?: boolean;
}

export interface TelegramRegularGift {
  id: string;
  sticker: TgSticker;
  star_count: number;
  upgrade_star_count?: number;
}

export interface OwnedGift {
  owned_gift_id: string;
  type: 'unique' | 'regular';
  gift: TelegramUniqueGift | TelegramRegularGift;
  sender_user?: { id: number; first_name: string; username?: string };
  send_date: number;
  is_saved?: boolean;
  can_be_transferred?: boolean;
  next_transfer_date?: number;
}

export function isUniqueGift(
  gift: TelegramUniqueGift | TelegramRegularGift,
): gift is TelegramUniqueGift {
  return 'name' in gift && 'number' in gift && 'model' in gift;
}

export async function downloadGiftStickerTgs(
  fileId: string,
  filename: string,
): Promise<string | null> {
  try {
    if (!BOT_TOKEN) {
      console.warn(
        `[Gifts] downloadGiftStickerTgs ${fileId}: BOT_TOKEN is not configured`,
      );
      return null;
    }

    const fileRes = await axios.get<TelegramApiResponse<{ file_path: string }>>(
      `${TELEGRAM_API_BASE}/getFile`,
      { params: { file_id: fileId }, timeout: 10000 },
    );
    if (!fileRes.data.ok) {
      console.warn(
        `[Gifts] downloadGiftStickerTgs ${fileId}: getFile failed ${fileRes.data.description ?? 'without description'}`,
      );
      return null;
    }
    if (!fileRes.data.result?.file_path) {
      console.warn(
        `[Gifts] downloadGiftStickerTgs ${fileId}: getFile returned no file_path`,
      );
      return null;
    }

    const remotePath = fileRes.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${remotePath}`;

    const dir = path.join(process.env.MULTER_DEST ?? 'static', 'gift-stickers');
    await fs.promises.mkdir(dir, { recursive: true });

    const ext = path.extname(remotePath) || '.tgs';
    const safeFilename = `${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`;
    const localPath = path.join(dir, safeFilename);
    const publicPath = `/static/gift-stickers/${safeFilename}`;

    if (fs.existsSync(localPath)) {
      return publicPath;
    }

    const fileData = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    await fs.promises.writeFile(localPath, Buffer.from(fileData.data));

    return publicPath;
  } catch (e) {
    console.error(
      `[Gifts] downloadGiftStickerTgs ${fileId}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

export type UniqueStickerDownloadResult = {
  stickerPath: string | null;
  gifPath: string | null;
  gifPosterPath: string | null;
};

export async function downloadUniqueGiftStickerPaths(
  ownedGiftId: string,
  stickerDocumentId: string,
  options?: { outputFormat?: 'source' | 'webp'; buildStickerGif?: boolean },
): Promise<UniqueStickerDownloadResult> {
  const empty = { stickerPath: null, gifPath: null, gifPosterPath: null };
  if (!ownedGiftId || !stickerDocumentId) {
    return empty;
  }

  const buildStickerGif =
    options?.buildStickerGif ?? options?.outputFormat !== 'webp';

  try {
    if (process.env.USERBOT_WORKER === 'true') {
      const { downloadUniqueGiftStickerViaUserbot } = await import(
        '../../userbot/gift-sender.js'
      );
      const stickerPath = await downloadUniqueGiftStickerViaUserbot(
        ownedGiftId,
        stickerDocumentId,
        { outputFormat: options?.outputFormat },
      );
      if (!stickerPath) {
        return empty;
      }
      let gifPath: string | null = null;
      let gifPosterPath: string | null = null;
      if (buildStickerGif && options?.outputFormat !== 'webp') {
        const { ensureStickerGifAssets, publicStickerPathToLocal } =
          await import('../../userbot/sticker-gif.js');
        const localStickerPath = publicStickerPathToLocal(stickerPath);
        const assets = await ensureStickerGifAssets(localStickerPath);
        gifPath = assets.gifPath;
        gifPosterPath = assets.posterPath;
      }
      return { stickerPath, gifPath, gifPosterPath };
    }

    const { giftQueue, giftQueueEvents } = await import(
      '../../userbot/queue.js'
    );
    const job = await giftQueue.add(
      'download-unique-sticker',
      {
        jobType: 'download-unique-sticker',
        accountType: 'Unique',
        ownedGiftId,
        stickerDocumentId,
        stickerOutputFormat: options?.outputFormat,
        buildStickerGif,
      },
      { delay: 0 },
    );
    const result = await job.waitUntilFinished(giftQueueEvents, 120_000);
    return {
      stickerPath: result.downloadedStickerPath ?? null,
      gifPath: result.downloadedStickerGifPath ?? null,
      gifPosterPath: result.downloadedStickerGifPosterPath ?? null,
    };
  } catch (error) {
    console.error(
      `[Gifts] downloadUniqueGiftStickerPaths failed ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}:`,
      error instanceof Error ? error.message : error,
    );
    return empty;
  }
}

export async function downloadUniqueGiftStickerTgs(
  ownedGiftId: string,
  stickerDocumentId: string,
  options?: { outputFormat?: 'source' | 'webp' },
): Promise<string | null> {
  const { stickerPath } = await downloadUniqueGiftStickerPaths(
    ownedGiftId,
    stickerDocumentId,
    { ...options, buildStickerGif: false },
  );
  return stickerPath;
}

export interface OwnedGiftsResult {
  gifts: OwnedGift[];
  next_offset?: string;
}

export interface TransferGiftResult {
  success: boolean;
  nextTransferDate?: Date;
  balanceTooLow?: boolean;
  paymentRequired?: boolean;
  needsChat?: boolean;
  errorCode?: string;
}

async function getBusinessGifts_business(
  connectionId?: string,
): Promise<OwnedGift[]> {
  const resolvedId = connectionId ?? (await getBusinessConnectionId('Unique'));
  if (!BOT_TOKEN || !resolvedId) {
    console.error('[Gifts] BOT_TOKEN or business connection ID not available');
    return [];
  }

  try {
    const allGifts: OwnedGift[] = [];
    let offset: string | undefined;

    do {
      const response = await axios.get<TelegramApiResponse<OwnedGiftsResult>>(
        `${TELEGRAM_API_BASE}/getBusinessAccountGifts`,
        {
          params: {
            business_connection_id: resolvedId,
            ...(offset && { offset }),
            limit: 100,
          },
          timeout: 15000,
        },
      );

      if (!response.data.ok || !response.data.result) break;

      allGifts.push(...response.data.result.gifts);
      offset = response.data.result.next_offset;
    } while (offset);

    return allGifts;
  } catch (error) {
    console.error(
      '[Gifts] getBusinessGifts error:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

async function transferGiftToUser_business(
  ownedGiftId: string,
  toTelegramId: string | number,
): Promise<TransferGiftResult> {
  const connectionId = await getBusinessConnectionId('Unique');
  if (!BOT_TOKEN || !connectionId) {
    return { success: false };
  }

  try {
    const response = await axios.post<TelegramApiResponse<true>>(
      `${TELEGRAM_API_BASE}/transferGift`,
      {
        business_connection_id: connectionId,
        owned_gift_id: ownedGiftId,
        new_owner_chat_id: toTelegramId.toString(),
      },
      { timeout: 15000 },
    );

    if (response.data.ok) {
      return { success: true };
    }

    const description = (response.data as any).description as
      | string
      | undefined;
    console.error(
      `[Gifts] transferGift failed for ${ownedGiftId}: ${description}`,
    );

    // Cooldown — extract next_transfer_date if present in error
    const nextDateUnix = (response.data as any).parameters?.retry_after as
      | number
      | undefined;
    if (nextDateUnix) {
      return {
        success: false,
        nextTransferDate: new Date(nextDateUnix * 1000),
      };
    }

    return { success: false };
  } catch (error: any) {
    console.error(
      '[Gifts] transferGiftToUser error:',
      error instanceof Error ? error.message : error,
    );

    // Axios 429 / Telegram cooldown
    const retryAfter = error?.response?.data?.parameters?.retry_after as
      | number
      | undefined;
    if (retryAfter) {
      return {
        success: false,
        nextTransferDate: new Date(Date.now() + retryAfter * 1000),
      };
    }

    return { success: false };
  }
}

async function sendGiftToUser_business(
  telegramGiftId: string,
  toTelegramId: string | number,
): Promise<{ success: boolean }> {
  const connectionId = await getBusinessConnectionId('Unique');
  if (!BOT_TOKEN || !connectionId) return { success: false };
  try {
    const response = await axios.post<TelegramApiResponse<true>>(
      `${TELEGRAM_API_BASE}/sendGift`,
      {
        business_connection_id: connectionId,
        user_id: toTelegramId.toString(),
        gift_id: telegramGiftId,
      },
      { timeout: 15000 },
    );
    return { success: !!response.data.ok };
  } catch (error: any) {
    console.error(
      '[Gifts] sendGiftToUser error:',
      error instanceof Error ? error.message : error,
    );
    return { success: false };
  }
}

// Provider wrappers: route to userbot or business based on GIFT_PROVIDER

async function sendGiftViaQueue(
  jobType: 'send' | 'transfer',
  accountType: 'Standard' | 'Unique',
  data: {
    telegramGiftId?: string;
    ownedGiftId?: string;
    recipientTelegramId: string;
  },
): Promise<{
  success: boolean;
  needsChat?: boolean;
  giftUnavailable?: boolean;
  balanceTooLow?: boolean;
  transferPaymentRequired?: boolean;
  businessUsername?: string;
  errorCode?: string;
  nextTransferDate?: Date;
}> {
  const { giftQueue, giftQueueEvents } = await import('../../userbot/queue.js');
  const { computeGiftSendDelayMs } = await import(
    '../../userbot/gift-send-delay.js'
  );
  const counts = await giftQueue.getJobCounts('wait', 'delayed', 'active');
  const pending =
    (counts.wait ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
  const delay = computeGiftSendDelayMs(0, pending > 0);
  const job = await giftQueue.add(
    jobType,
    { jobType, accountType, ...data },
    { delay },
  );
  try {
    const result = await job.waitUntilFinished(giftQueueEvents, 90_000);
    return {
      ...result,
      nextTransferDate: result.nextTransferDate
        ? new Date(result.nextTransferDate)
        : undefined,
    };
  } catch {
    return { success: false };
  }
}

export async function getBusinessGifts(
  connectionId?: string,
): Promise<OwnedGift[]> {
  if (process.env.GIFT_PROVIDER === 'business') {
    return getBusinessGifts_business(connectionId);
  }

  if (process.env.USERBOT_WORKER === 'true') {
    const { getSavedGiftsViaUserbot } = await import(
      '../../userbot/gift-sender.js'
    );
    return getSavedGiftsViaUserbot();
  }

  const { giftQueue, giftQueueEvents } = await import('../../userbot/queue.js');
  const job = await giftQueue.add(
    'list-gifts',
    { jobType: 'list-gifts', accountType: 'Unique' },
    { delay: 0 },
  );
  try {
    const result = await job.waitUntilFinished(giftQueueEvents, 90_000);
    return result.gifts ?? [];
  } catch {
    return [];
  }
}

export async function transferGiftToUser(
  ownedGiftId: string,
  toTelegramId: string | number,
): Promise<TransferGiftResult> {
  if (process.env.GIFT_PROVIDER === 'business') {
    return transferGiftToUser_business(ownedGiftId, toTelegramId);
  }
  const result = await sendGiftViaQueue('transfer', 'Unique', {
    ownedGiftId,
    recipientTelegramId: toTelegramId.toString(),
  });
  return {
    success: result.success,
    nextTransferDate: result.nextTransferDate,
    balanceTooLow: result.balanceTooLow,
    paymentRequired: result.transferPaymentRequired,
    needsChat: result.needsChat,
    errorCode: result.errorCode,
  };
}

export async function sendGiftToUser(
  telegramGiftId: string,
  toTelegramId: string | number,
): Promise<{
  success: boolean;
  needsChat?: boolean;
  giftUnavailable?: boolean;
  balanceTooLow?: boolean;
  businessUsername?: string;
  errorCode?: string;
}> {
  if (process.env.GIFT_PROVIDER === 'business') {
    return sendGiftToUser_business(telegramGiftId, toTelegramId);
  }
  return sendGiftViaQueue('send', 'Unique', {
    telegramGiftId,
    recipientTelegramId: toTelegramId.toString(),
  });
}

export interface TelegramChatMember {
  status:
    | 'creator'
    | 'administrator'
    | 'member'
    | 'restricted'
    | 'left'
    | 'kicked';
  user: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  is_member?: boolean;
  can_be_edited?: boolean;
  can_manage_chat?: boolean;
  can_change_info?: boolean;
  can_delete_messages?: boolean;
  can_invite_users?: boolean;
  can_restrict_members?: boolean;
  can_pin_messages?: boolean;
  can_manage_topics?: boolean;
  can_promote_members?: boolean;
  can_manage_video_chats?: boolean;
  can_post_messages?: boolean;
  can_edit_messages?: boolean;
  can_post_stories?: boolean;
  can_edit_stories?: boolean;
  can_delete_stories?: boolean;
  can_manage_voice_chats?: boolean;
  is_anonymous?: boolean;
  custom_title?: string;
  until_date?: number;
  can_send_messages?: boolean;
  can_send_audios?: boolean;
  can_send_documents?: boolean;
  can_send_photos?: boolean;
  can_send_videos?: boolean;
  can_send_video_notes?: boolean;
  can_send_voice_notes?: boolean;
  can_send_polls?: boolean;
  can_send_other_messages?: boolean;
  can_add_web_page_previews?: boolean;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface ChatBoostSourcePremium {
  source: 'premium';
  user: TelegramUser;
}

export interface ChatBoostSourceGiftCode {
  source: 'gift_code';
  user: TelegramUser;
}

export interface ChatBoostSourceGiveaway {
  source: 'giveaway';
  giveaway_message_id: number;
  user?: TelegramUser;
  is_unclaimed?: boolean;
}

export type ChatBoostSource =
  | ChatBoostSourcePremium
  | ChatBoostSourceGiftCode
  | ChatBoostSourceGiveaway;

export interface ChatBoost {
  boost_id: string;
  add_date: number;
  expiration_date: number;
  source: ChatBoostSource;
}

export interface UserChatBoosts {
  boosts: ChatBoost[];
}

/**
 * Represents a price with a label
 */
export interface LabeledPrice {
  /** Product label */
  label: string;
  /** Price of the product in the smallest units of the currency (integer, not float/double) */
  amount: number;
}

/**
 * Parameters for creating an invoice link
 */
export interface InvoiceLinkParams {
  /** Product name, 1-32 characters */
  title: string;
  /** Product description, 1-255 characters */
  description: string;
  /** Bot-defined invoice payload, 1-128 bytes */
  payload: string;
  /** Payment provider token, obtained via @BotFather. Pass empty string for Telegram Stars */
  provider_token?: string;
  /** Three-letter ISO 4217 currency code or "XTR" for Telegram Stars */
  currency: string;
  /** Price breakdown, a list of components */
  prices: LabeledPrice[];
  /** Maximum accepted tip amount in the smallest units of the currency */
  max_tip_amount?: number;
  /** Array of suggested tip amounts in the smallest units of the currency */
  suggested_tip_amounts?: number[];
  /** Data about the invoice, which will be shared with the payment provider */
  provider_data?: string;
  /** URL of the product photo for the invoice */
  photo_url?: string;
  /** Photo size in bytes */
  photo_size?: number;
  /** Photo width */
  photo_width?: number;
  /** Photo height */
  photo_height?: number;
  /** Pass True if you require the user's full name to complete the order */
  need_name?: boolean;
  /** Pass True if you require the user's phone number to complete the order */
  need_phone_number?: boolean;
  /** Pass True if you require the user's email address to complete the order */
  need_email?: boolean;
  /** Pass True if you require the user's shipping address to complete the order */
  need_shipping_address?: boolean;
  /** Pass True if the user's phone number should be sent to the provider */
  send_phone_number_to_provider?: boolean;
  /** Pass True if the user's email address should be sent to the provider */
  send_email_to_provider?: boolean;
  /** Pass True if the final price depends on the shipping method */
  is_flexible?: boolean;
}

/**
 * Represents a successful payment
 */
export interface SuccessfulPayment {
  /** Three-letter ISO 4217 currency code or "XTR" for Telegram Stars */
  currency: string;
  /** Total price in the smallest units of the currency */
  total_amount: number;
  /** Bot-defined invoice payload */
  invoice_payload: string;
  /** Identifier of the shipping option chosen by the user */
  shipping_option_id?: string;
  /** Order information provided by the user */
  order_info?: OrderInfo;
  /** Telegram payment identifier */
  telegram_payment_charge_id: string;
  /** Provider payment identifier */
  provider_payment_charge_id: string;
}

/**
 * Represents information about an order
 */
export interface OrderInfo {
  /** User name */
  name?: string;
  /** User's phone number */
  phone_number?: string;
  /** User email */
  email?: string;
  /** User shipping address */
  shipping_address?: ShippingAddress;
}

/**
 * Represents a shipping address
 */
export interface ShippingAddress {
  /** Two-letter ISO 3166-1 alpha-2 country code */
  country_code: string;
  /** State, if applicable */
  state: string;
  /** City */
  city: string;
  /** First line for the address */
  street_line1: string;
  /** Second line for the address */
  street_line2: string;
  /** Address post code */
  post_code: string;
}

/**
 * Response from creating an invoice link
 */
export interface InvoiceLinkResponse {
  /** The created invoice link */
  link: string;
}

/**
 * Webhook update for successful payment
 */
export interface PaymentUpdate {
  /** The update ID */
  update_id: number;
  /** The message containing payment information */
  message: {
    /** Message ID */
    message_id: number;
    /** Message date */
    date: number;
    /** Chat information */
    chat: {
      /** Chat ID */
      id: number;
      /** Chat type */
      type: string;
    };
    /** User who sent the payment */
    from: {
      /** User ID */
      id: number;
      /** User's first name */
      first_name: string;
      /** User's last name */
      last_name?: string;
      /** Username */
      username?: string;
    };
    /** Successful payment information */
    successful_payment: SuccessfulPayment;
  };
}

/**
 * Pre-checkout query for validating payment
 */
export interface PreCheckoutQuery {
  /** Unique query identifier */
  id: string;
  /** User who sent the query */
  from: {
    /** User ID */
    id: number;
    /** User's first name */
    first_name: string;
    /** User's last name */
    last_name?: string;
    /** Username */
    username?: string;
  };
  /** Three-letter ISO 4217 currency code or "XTR" for Telegram Stars */
  currency: string;
  /** Total price in the smallest units of the currency */
  total_amount: number;
  /** Bot-defined invoice payload */
  invoice_payload: string;
  /** Identifier of the shipping option chosen by the user */
  shipping_option_id?: string;
  /** Order information provided by the user */
  order_info?: OrderInfo;
}

export interface RefundedPayment {
  /** Three-letter ISO 4217 currency code, or "XTR" for payments in Telegram Stars. Currently, always "XTR" */
  currency: string;
  /** Total refunded price in the smallest units of the currency (integer, not float/double) */
  total_amount: number;
  /** Bot-specified invoice payload */
  invoice_payload: string;
  /** Telegram payment identifier */
  telegram_payment_charge_id: string;
  /** Optional provider payment identifier */
  provider_payment_charge_id?: string;
}

// Extend the TelegramBot Message type to include refunded_payment
declare module 'node-telegram-bot-api' {
  interface Message {
    refunded_payment?: RefundedPayment;
  }
}

export interface ChatJoinRequest {
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
  };
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  user_chat_id: number;
  date: number;
  bio?: string;
  invite_link?: {
    invite_link: string;
    creator: TelegramUser;
    creates_join_request: boolean;
    is_primary: boolean;
    is_revoked: boolean;
  };
}

import type { Prisma } from '@prisma/client';

/** Telegram Bot API 9.4+ inline button color */
export type InlineKeyboardButtonStyle = 'primary' | 'success' | 'danger';

/** Single button in a Telegram inline keyboard row */
export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  style?: InlineKeyboardButtonStyle;
}

/** Telegram inline keyboard markup */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/** Telegram message entity (bold, italic, mention, url, etc.) */
export interface MessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
  language?: string;
}

/** User shape needed for winner name formatting */
export interface WinnerUser {
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  telegramId: string | number;
}

/**
 * Participant row with winner info. All fields optional for structural
 * compatibility with Prisma Participant + user include results.
 * `user` is optional because some queries fetch participants without the user join.
 * Extend with `interface MyParticipant extends WinnerParticipant { ... }` as needed.
 */
export interface WinnerParticipant {
  isWinner?: boolean | null;
  isAddWinner?: boolean | null;
  winPlace?: number | null;
  addPlace?: number | null;
  range?: string | null;
  userId?: number;
  user?: WinnerUser;
  wonPrize?: {
    id: number;
    giftName?: string | null;
    giftNumber?: string | null;
    giftNftName?: string | null;
    prizeType?: string | null;
    telegramGiftId?: string | null;
  } | null;
}

/**
 * Linked channel shape for formatting. Extend as needed.
 */
export interface GiveawayLinkedChannel {
  channelId: bigint;
  role?: string | null;
  channel: {
    id?: bigint;
    title?: string | null;
    username?: string | null;
    photo?: string | null;
    inviteLink?: string | null;
  };
}

/**
 * Sponsor entry shape for formatting. Extend as needed.
 */
export interface GiveawaySponsor {
  sponsorType?: string | null;
  sponsorLink?: { title?: string | null; link: string } | null;
  sponsorChannel?: {
    title?: string | null;
    username?: string | null;
    inviteLink?: string | null;
  } | null;
  user?: WinnerUser | null;
}

/**
 * Minimal giveaway shape required by bot.service.ts formatting helpers.
 * All fields are optional so that any superset object (e.g. Prisma Giveaway with
 * includes) is structurally compatible without casting. Extend via
 * `interface MyGiveaway extends GiveawayFormatData { ... }` when extra fields
 * are needed in a specific context.
 */
export interface GiveawayFormatData {
  id?: string;
  language?: string | null;
  participiationType?: string | null;
  completionType?: string | null;
  description?: string | null;
  endingAt?: Date | null;
  winnerSlots?: number | null;
  maxParticipants?: number | null;
  participiationPrice?: Prisma.Decimal | number | bigint | null;
  participiationCurr?: string | null;
  neededReferals?: number | null;
  isBoostNeeded?: boolean | null;
  isOnlyPremium?: boolean | null;
  isStaySubscribed?: boolean | null;
  isCaptchaNeeded?: boolean | null;
  participationButtonText?: string | null;
  participationButtonStyle?: string | null;
  showParticipationCount?: boolean | null;
  showParticipationMaxCount?: boolean | null;
  allowedGeoCountries?: string | null;
  isCommentsOn?: boolean | null;
  numerifyWinners?: boolean | null;
  numerifyPrizes?: boolean | null;
  isActive?: boolean | null;
  isCancelled?: boolean | null;
  linkedChannels?: GiveawayLinkedChannel[];
  sponsoredBy?: GiveawaySponsor[];
  participants?: WinnerParticipant[];
  prizes?: {
    id: number;
    giftName?: string | null;
    giftNumber?: string | null;
    giftNftName?: string | null;
    winPlace?: number | null;
    status?: string | null;
    prizeType?: string | null;
    telegramGiftId?: string | null;
  }[];
}

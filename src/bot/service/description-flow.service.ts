import axios from 'axios';
import { prisma } from '@database';
import { TelegramBot } from 'typescript-telegram-bot-api';
import {
  buildDescriptionPreviewGiveawayData,
  buildParticipationInlineButton,
  isGifUrl,
  sendAnimation,
  sendMediaGroup,
  sendPhoto,
} from './bot.service';
import {
  BUTTON_TEXT_MESSAGES,
  DESC_FLOW_MESSAGES,
  DESCRIPTION_REQUEST_MESSAGES,
  Language,
  PARTICIPATION_BUTTON_PRESETS,
  getUserLanguage,
  normalizeGiveawayLanguage,
} from './localization';
import { InlineKeyboardButtonStyle, InlineKeyboardMarkup } from '../types';
import { queueTelegramRequest } from '../utils/telegram-queue';

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/** In-process lock: one description-flow action per user (blocks double-clicks). */
const descFlowInFlight = new Set<number>();

function tryAcquireDescFlowLock(userId: number): boolean {
  if (descFlowInFlight.has(userId)) return false;
  descFlowInFlight.add(userId);
  return true;
}

function releaseDescFlowLock(userId: number): void {
  descFlowInFlight.delete(userId);
}

export const DESC_FLOW_STATE = {
  AWAITING_TEXT: 'awaiting_text',
  AWAITING_TEXT_EDIT: 'awaiting_text_edit',
  PREVIEW: 'preview',
  CUSTOMIZE_NAME: 'customize_name',
  CUSTOMIZE_COLOR: 'customize_color',
  CUSTOMIZE_COUNTER: 'customize_counter',
  CONFIRMED: 'confirmed',
} as const;

function expectedStatesForCallback(
  callbackData: string,
): readonly string[] | null {
  if (
    callbackData === 'desc_save' ||
    callbackData === 'desc_edit' ||
    callbackData === 'desc_custom'
  ) {
    return [DESC_FLOW_STATE.PREVIEW];
  }
  if (callbackData === 'desc_back') {
    return [
      DESC_FLOW_STATE.CUSTOMIZE_NAME,
      DESC_FLOW_STATE.CUSTOMIZE_COLOR,
      DESC_FLOW_STATE.CUSTOMIZE_COUNTER,
    ];
  }
  if (callbackData.startsWith('desc_nm:')) {
    return [DESC_FLOW_STATE.CUSTOMIZE_NAME];
  }
  if (callbackData.startsWith('desc_clr:')) {
    return [DESC_FLOW_STATE.CUSTOMIZE_COLOR];
  }
  if (callbackData.startsWith('desc_cnt:')) {
    return [DESC_FLOW_STATE.CUSTOMIZE_COUNTER];
  }
  return null;
}

type DescriptionRequestRow = NonNullable<
  Awaited<ReturnType<typeof loadDescriptionRequest>>
>;

function parsePreviewMessageIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is number => typeof id === 'number');
}

/** Keep regular Unicode emoji; only strip HTML and trim length. */
function sanitizeButtonLabel(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function resolvePreviewLanguage(
  request: { language?: string | null },
  userLang: Language,
): Language {
  return request.language
    ? normalizeGiveawayLanguage(request.language)
    : userLang;
}

function isCapacityCompletion(request: {
  completionType?: string | null;
  maxParticipants?: number | null;
}): boolean {
  if (request.completionType === 'ByCapacity') return true;
  return (
    request.completionType !== 'ByTime' &&
    request.maxParticipants != null &&
    request.maxParticipants > 0
  );
}

function resolveButtonLabel(
  request: DescriptionRequestRow,
  lang: Language,
): string {
  return (
    request.participationButtonText?.trim() ||
    BUTTON_TEXT_MESSAGES[lang].participate
  );
}

function buildPreviewGiveaway(
  request: DescriptionRequestRow,
  userLang: Language,
) {
  return buildDescriptionPreviewGiveawayData(
    {
      participiationType: request.participiationType,
      language: request.language,
      completionType: request.completionType,
      maxParticipants: request.maxParticipants,
      participationButtonText: request.participationButtonText,
      participationButtonStyle: request.participationButtonStyle,
      showParticipationCount: request.showParticipationCount,
      showParticipationMaxCount: request.showParticipationMaxCount,
    },
    userLang,
  );
}

function buildPreviewButtonMarkup(
  request: DescriptionRequestRow,
  userLang: Language,
): InlineKeyboardMarkup {
  const previewGiveaway = buildPreviewGiveaway(request, userLang);
  return {
    inline_keyboard: [
      [
        buildParticipationInlineButton(
          previewGiveaway,
          process.env.BOT_URL || 'https://t.me',
        ),
      ],
    ],
  };
}

function buildConfirmKeyboard(lang: Language): InlineKeyboardMarkup {
  const m = DESC_FLOW_MESSAGES[lang];
  return {
    inline_keyboard: [
      [
        { text: m.saveButton, callback_data: 'desc_save' },
        { text: m.editButton, callback_data: 'desc_edit' },
      ],
      [{ text: m.customizeButton, callback_data: 'desc_custom' }],
    ],
  };
}

/** One preset per row, no back button. */
function buildNamePresetKeyboard(lang: Language): InlineKeyboardMarkup {
  const presets = PARTICIPATION_BUTTON_PRESETS[lang];
  return {
    inline_keyboard: presets.map((label, index) => [
      { text: label, callback_data: `desc_nm:${index}` },
    ]),
  };
}

/** Same label on each row; Telegram style colors; no back. */
function buildColorKeyboard(label: string): InlineKeyboardMarkup {
  const rows: Array<{
    text: string;
    callback_data: string;
    style?: InlineKeyboardButtonStyle;
  }>[] = [
    [{ text: label, callback_data: 'desc_clr:none' }],
    [{ text: label, callback_data: 'desc_clr:primary', style: 'primary' }],
    [{ text: label, callback_data: 'desc_clr:success', style: 'success' }],
    [{ text: label, callback_data: 'desc_clr:danger', style: 'danger' }],
  ];
  return { inline_keyboard: rows };
}

/**
 * Counter options use the picked label (no 👤/🎟 — removed from template):
 * - time: Label | Label • 0
 * - capacity: Label | Label • 0 | Label • 0/N
 */
function buildCounterKeyboard(
  request: DescriptionRequestRow,
  lang: Language,
): InlineKeyboardMarkup {
  const label = resolveButtonLabel(request, lang);
  const byCapacity = isCapacityCompletion(request);
  const max = request.maxParticipants ?? 100;

  const rows: InlineKeyboardMarkup['inline_keyboard'] = [
    [{ text: label, callback_data: 'desc_cnt:off' }],
    [{ text: `${label} • 0`, callback_data: 'desc_cnt:current' }],
  ];

  if (byCapacity) {
    rows.push([
      {
        text: `${label} • 0/${max}`,
        callback_data: 'desc_cnt:capacity',
      },
    ]);
  }

  return { inline_keyboard: rows };
}

async function deleteTrackedMessages(
  chatId: number,
  messageIds: number[],
): Promise<void> {
  await Promise.all(
    messageIds.map((messageId) =>
      queueTelegramRequest(() =>
        axios
          .post(`${TELEGRAM_API_BASE}/deleteMessage`, {
            chat_id: chatId,
            message_id: messageId,
          })
          .catch(() => undefined),
      ),
    ),
  );
}

async function clearPreviewMessages(
  chatId: number,
  request: DescriptionRequestRow,
): Promise<void> {
  const ids = parsePreviewMessageIds(request.previewMessageIds);
  if (ids.length > 0) {
    await deleteTrackedMessages(chatId, ids);
  }
  await prisma.descriptionRequest.update({
    where: { userId: request.userId },
    data: { previewMessageIds: [] },
  });
}

async function loadDescriptionRequest(userId: number) {
  return prisma.descriptionRequest.findUnique({ where: { userId } });
}

function isExpired(request: { expiresAt: Date }): boolean {
  return new Date() > request.expiresAt;
}

async function sendColorStep(
  bot: TelegramBot,
  chatId: number,
  request: DescriptionRequestRow,
  uiLang: Language,
  giveawayLang: Language,
  editMessageId?: number,
): Promise<number | undefined> {
  const label = resolveButtonLabel(request, giveawayLang);
  const text = DESC_FLOW_MESSAGES[uiLang].customizeColorPrompt;
  const reply_markup = buildColorKeyboard(label);

  if (editMessageId) {
    try {
      await bot.editMessageText({
        chat_id: chatId,
        message_id: editMessageId,
        text,
        reply_markup,
      });
      return editMessageId;
    } catch {
      // fall through to send
    }
  }

  const msg = await bot.sendMessage({
    chat_id: chatId,
    text,
    reply_markup,
  });
  return msg.message_id;
}

async function sendCounterStep(
  bot: TelegramBot,
  chatId: number,
  request: DescriptionRequestRow,
  uiLang: Language,
  giveawayLang: Language,
  editMessageId?: number,
): Promise<number | undefined> {
  const text = DESC_FLOW_MESSAGES[uiLang].customizeCounterPrompt;
  const reply_markup = buildCounterKeyboard(request, giveawayLang);

  if (editMessageId) {
    try {
      await bot.editMessageText({
        chat_id: chatId,
        message_id: editMessageId,
        text,
        reply_markup,
      });
      return editMessageId;
    } catch {
      // fall through
    }
  }

  const msg = await bot.sendMessage({
    chat_id: chatId,
    text,
    reply_markup,
  });
  return msg.message_id;
}

export async function showDescriptionPreview(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  options?: { headerMessage?: 'received' | 'descriptionUpdated' },
): Promise<void> {
  const request = await loadDescriptionRequest(userId);
  if (!request?.description) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { picked_language: true, language_code: true },
  });
  const userLang = getUserLanguage(
    user ?? { language_code: 'en', picked_language: 'en' },
  );
  const headerKey = options?.headerMessage ?? 'received';

  await clearPreviewMessages(chatId, request);

  const trackedIds: number[] = [];
  const track = (messageId: number | undefined) => {
    if (typeof messageId === 'number') trackedIds.push(messageId);
  };

  const previewButtonMarkup = buildPreviewButtonMarkup(request, userLang);
  const confirmKeyboard = buildConfirmKeyboard(userLang);
  const htmlDescription = request.description;

  const headerText =
    headerKey === 'descriptionUpdated'
      ? `${DESCRIPTION_REQUEST_MESSAGES.descriptionUpdated[userLang]}\n\n${DESCRIPTION_REQUEST_MESSAGES.preview[userLang]}`
      : `${DESCRIPTION_REQUEST_MESSAGES.received[userLang]}\n\n${DESCRIPTION_REQUEST_MESSAGES.preview[userLang]}`;

  const header = await bot.sendMessage({
    chat_id: chatId,
    text: headerText,
    parse_mode: 'HTML',
  });
  track(header.message_id);

  const tempBanners = await prisma.tempBannerUpload.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  const bannerUrls = (tempBanners?.urls ?? []).filter(
    (url) => typeof url === 'string' && url.trim() !== '',
  );

  const sendStandardPreview = async () => {
    const anim = await sendAnimation(
      chatId,
      '/static/giveaways/standart.mp4',
      htmlDescription,
      { parse_mode: 'HTML', reply_markup: previewButtonMarkup },
    );
    track(anim.messageId);
  };

  const sendSingleBannerPreview = async (banner: string) => {
    const sent = isGifUrl(banner)
      ? await sendAnimation(chatId, banner, htmlDescription, {
          parse_mode: 'HTML',
          reply_markup: previewButtonMarkup,
        })
      : await sendPhoto(chatId, banner, htmlDescription, {
          parse_mode: 'HTML',
          reply_markup: previewButtonMarkup,
        });
    if (sent.success && sent.messageId != null) {
      track(sent.messageId);
      return true;
    }
    console.error(
      `[DescriptionPreview] single banner send failed userId=${userId}:`,
      sent.error,
    );
    return false;
  };

  if (bannerUrls.length === 1) {
    // Local multipart upload (same as announcements) — avoid Telegram HTTP
    // fetch of DOMAIN URLs, which can fail and leave standart.mp4 as only path.
    if (!(await sendSingleBannerPreview(bannerUrls[0]))) {
      await sendStandardPreview();
    }
  } else if (bannerUrls.length > 1) {
    const mediaGroup = await sendMediaGroup(BigInt(chatId), bannerUrls);
    if (mediaGroup.success && mediaGroup.messageIds?.length) {
      for (const id of mediaGroup.messageIds) track(id);
      const textMsg = await bot.sendMessage({
        chat_id: chatId,
        text: htmlDescription,
        parse_mode: 'HTML',
        reply_markup: previewButtonMarkup,
      });
      track(textMsg.message_id);
    } else {
      console.error(
        `[DescriptionPreview] sendMediaGroup failed userId=${userId}:`,
        mediaGroup.error,
      );
      // Don't send caption-only text without media — fall back to one banner, then standart.
      if (!(await sendSingleBannerPreview(bannerUrls[0]))) {
        await sendStandardPreview();
      }
    }
  } else {
    await sendStandardPreview();
  }

  const footer = await bot.sendMessage({
    chat_id: chatId,
    text: DESC_FLOW_MESSAGES[userLang].confirmPrompt,
    parse_mode: 'HTML',
    reply_markup: confirmKeyboard,
  });
  track(footer.message_id);

  await prisma.descriptionRequest.update({
    where: { userId },
    data: {
      flowState: DESC_FLOW_STATE.PREVIEW,
      previewMessageIds: trackedIds,
    },
  });
}

export async function handleDescriptionTextMessage(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  htmlDescription: string,
): Promise<boolean> {
  const request = await loadDescriptionRequest(userId);
  if (!request || isExpired(request)) return false;

  if (request.flowState === DESC_FLOW_STATE.CONFIRMED) return false;

  const acceptsText =
    request.flowState === DESC_FLOW_STATE.CUSTOMIZE_NAME ||
    request.flowState === DESC_FLOW_STATE.AWAITING_TEXT ||
    request.flowState === DESC_FLOW_STATE.AWAITING_TEXT_EDIT;
  if (!acceptsText) return false;

  if (!tryAcquireDescFlowLock(userId)) {
    return true; // swallow duplicate while previous step is in flight
  }

  try {
    // Re-load under lock — state may have changed from a concurrent callback
    const lockedRequest = await loadDescriptionRequest(userId);
    if (!lockedRequest || isExpired(lockedRequest)) return false;

    if (lockedRequest.flowState === DESC_FLOW_STATE.CUSTOMIZE_NAME) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { picked_language: true, language_code: true },
      });
      const userLang = getUserLanguage(
        user ?? { language_code: 'en', picked_language: 'en' },
      );
      const previewLang = resolvePreviewLanguage(lockedRequest, userLang);
      const plain = sanitizeButtonLabel(htmlDescription);
      if (!plain) return true;

      await prisma.descriptionRequest.update({
        where: { userId },
        data: {
          participationButtonText: plain,
          flowState: DESC_FLOW_STATE.CUSTOMIZE_COLOR,
        },
      });

      await clearPreviewMessages(chatId, lockedRequest);

      const updated = await loadDescriptionRequest(userId);
      if (!updated) return true;

      const msgId = await sendColorStep(
        bot,
        chatId,
        updated,
        userLang,
        previewLang,
      );
      if (msgId) {
        await prisma.descriptionRequest.update({
          where: { userId },
          data: { previewMessageIds: [msgId] },
        });
      }
      return true;
    }

    if (
      lockedRequest.flowState !== DESC_FLOW_STATE.AWAITING_TEXT &&
      lockedRequest.flowState !== DESC_FLOW_STATE.AWAITING_TEXT_EDIT
    ) {
      return false;
    }

    const isEdit =
      lockedRequest.flowState === DESC_FLOW_STATE.AWAITING_TEXT_EDIT;

    await prisma.descriptionRequest.update({
      where: { userId },
      data: {
        description: htmlDescription,
        flowState: DESC_FLOW_STATE.PREVIEW,
      },
    });

    try {
      await showDescriptionPreview(bot, chatId, userId, {
        headerMessage: isEdit ? 'descriptionUpdated' : 'received',
      });
    } catch (err) {
      console.error('[DescriptionFlow] showDescriptionPreview failed:', err);
      await prisma.descriptionRequest.update({
        where: { userId },
        data: {
          flowState: isEdit
            ? DESC_FLOW_STATE.AWAITING_TEXT_EDIT
            : DESC_FLOW_STATE.AWAITING_TEXT,
        },
      });
      throw err;
    }
    return true;
  } finally {
    releaseDescFlowLock(userId);
  }
}

export async function handleDescriptionFlowCallback(
  bot: TelegramBot,
  query: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
  },
): Promise<boolean> {
  const callbackData = query.data;
  if (!callbackData?.startsWith('desc_')) return false;

  const telegramUserId = query.from.id.toString();
  const user = await prisma.user.findFirst({
    where: { telegramId: telegramUserId },
    select: {
      id: true,
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
    return true;
  }

  const userLang = getUserLanguage(user);
  const busyText = DESC_FLOW_MESSAGES[userLang].busy;

  if (!tryAcquireDescFlowLock(user.id)) {
    await bot
      .answerCallbackQuery({
        callback_query_id: query.id,
        text: busyText,
      })
      .catch(() => {});
    return true;
  }

  try {
    const request = await loadDescriptionRequest(user.id);
    const chatId = query.message?.chat.id;
    if (!request || !chatId) {
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: DESC_FLOW_MESSAGES.en.notActive,
        show_alert: true,
      });
      return true;
    }

    if (isExpired(request)) {
      await bot.answerCallbackQuery({
        callback_query_id: query.id,
        text: DESC_FLOW_MESSAGES[userLang].expired,
        show_alert: true,
      });
      return true;
    }

    const previewLang = resolvePreviewLanguage(request, userLang);
    const m = DESC_FLOW_MESSAGES[userLang];

    const expected = expectedStatesForCallback(callbackData);
    if (expected && !expected.includes(request.flowState)) {
      await bot
        .answerCallbackQuery({
          callback_query_id: query.id,
          text: m.notActive,
        })
        .catch(() => {});
      return true;
    }

    // Ignore clicks on stale/duplicate keyboards left in the chat
    const trackedIds = parsePreviewMessageIds(request.previewMessageIds);
    const clickedMessageId = query.message?.message_id;
    if (
      trackedIds.length > 0 &&
      clickedMessageId != null &&
      !trackedIds.includes(clickedMessageId)
    ) {
      await bot
        .answerCallbackQuery({
          callback_query_id: query.id,
          text: m.notActive,
        })
        .catch(() => {});
      return true;
    }

    // Answer immediately to avoid Telegram "loading" / perceived latency
    await bot
      .answerCallbackQuery({ callback_query_id: query.id })
      .catch(() => {});

    if (callbackData === 'desc_save') {
      if (
        !request.description ||
        request.flowState === DESC_FLOW_STATE.CONFIRMED
      ) {
        return true;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          defaultParticipationButtonText: request.participationButtonText,
          defaultParticipationButtonStyle: request.participationButtonStyle,
          defaultShowParticipationCount: request.showParticipationCount ?? true,
          defaultShowParticipationMaxCount:
            request.showParticipationMaxCount ?? true,
        },
      });

      // Keep preview in chat, but remove the confirm prompt after Save.
      const footerId = query.message?.message_id;
      if (footerId) {
        await deleteTrackedMessages(chatId, [footerId]);
      }

      await bot.sendMessage({
        chat_id: chatId,
        text: m.savedSettings,
        parse_mode: 'HTML',
      });

      // Stop tracking so poll/cancel won't delete the kept preview + saved note
      await prisma.descriptionRequest.update({
        where: { userId: user.id },
        data: {
          flowState: DESC_FLOW_STATE.CONFIRMED,
          confirmedAt: new Date(),
          previewMessageIds: [],
        },
      });
      return true;
    }

    if (callbackData === 'desc_edit') {
      await clearPreviewMessages(chatId, request);
      const editMsg = await bot.sendMessage({
        chat_id: chatId,
        text: m.editPrompt,
        parse_mode: 'HTML',
      });
      await prisma.descriptionRequest.update({
        where: { userId: user.id },
        data: {
          description: null,
          flowState: DESC_FLOW_STATE.AWAITING_TEXT_EDIT,
          previewMessageIds: editMsg.message_id ? [editMsg.message_id] : [],
        },
      });
      return true;
    }

    if (callbackData === 'desc_custom') {
      await clearPreviewMessages(chatId, request);
      await prisma.descriptionRequest.update({
        where: { userId: user.id },
        data: {
          flowState: DESC_FLOW_STATE.CUSTOMIZE_NAME,
          previewMessageIds: [],
        },
      });
      const nameMsg = await bot.sendMessage({
        chat_id: chatId,
        text: m.customizeNamePrompt,
        parse_mode: 'HTML',
        reply_markup: buildNamePresetKeyboard(previewLang),
      });
      await prisma.descriptionRequest.update({
        where: { userId: user.id },
        data: { previewMessageIds: [nameMsg.message_id] },
      });
      return true;
    }

    if (callbackData === 'desc_back') {
      if (!request.description) return true;
      await showDescriptionPreview(bot, chatId, user.id);
      return true;
    }

    if (callbackData.startsWith('desc_nm:')) {
      const index = Number(callbackData.slice('desc_nm:'.length));
      const presets = PARTICIPATION_BUTTON_PRESETS[previewLang];
      const label = presets[index];
      if (!label) return true;

      await prisma.descriptionRequest.update({
        where: { userId: user.id },
        data: {
          participationButtonText: label,
          flowState: DESC_FLOW_STATE.CUSTOMIZE_COLOR,
        },
      });

      const updated = await loadDescriptionRequest(user.id);
      if (!updated) return true;

      const msgId = await sendColorStep(
        bot,
        chatId,
        updated,
        userLang,
        previewLang,
        query.message?.message_id,
      );
      if (msgId) {
        await prisma.descriptionRequest.update({
          where: { userId: user.id },
          data: { previewMessageIds: [msgId] },
        });
      }
      return true;
    }

    if (callbackData.startsWith('desc_clr:')) {
      const color = callbackData.slice('desc_clr:'.length);
      const style =
        color === 'none'
          ? null
          : color === 'primary' || color === 'success' || color === 'danger'
            ? color
            : null;

      await prisma.descriptionRequest.update({
        where: { userId: user.id },
        data: {
          participationButtonStyle: style,
          flowState: DESC_FLOW_STATE.CUSTOMIZE_COUNTER,
        },
      });

      const updated = await loadDescriptionRequest(user.id);
      if (!updated) return true;

      const msgId = await sendCounterStep(
        bot,
        chatId,
        updated,
        userLang,
        previewLang,
        query.message?.message_id,
      );
      if (msgId) {
        await prisma.descriptionRequest.update({
          where: { userId: user.id },
          data: { previewMessageIds: [msgId] },
        });
      }
      return true;
    }

    if (callbackData.startsWith('desc_cnt:')) {
      const mode = callbackData.slice('desc_cnt:'.length);
      const showCount = mode !== 'off';
      const showMax = mode === 'capacity';

      await prisma.descriptionRequest.update({
        where: { userId: user.id },
        data: {
          showParticipationCount: showCount,
          showParticipationMaxCount: showMax,
          flowState: DESC_FLOW_STATE.PREVIEW,
        },
      });

      await showDescriptionPreview(bot, chatId, user.id);
      return true;
    }
  } catch (err) {
    console.error(
      `[DescriptionFlow] callback failed data=${callbackData}:`,
      err,
    );
  } finally {
    releaseDescFlowLock(user.id);
  }

  return false;
}

export async function cleanupDescriptionPreviewMessages(
  userId: number,
  telegramId: string,
): Promise<void> {
  const request = await loadDescriptionRequest(userId);
  if (!request) return;
  const ids = parsePreviewMessageIds(request.previewMessageIds);
  if (ids.length === 0) return;
  await deleteTrackedMessages(Number(telegramId), ids);
}

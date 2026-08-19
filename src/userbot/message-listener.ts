import { NewMessage, NewMessageEvent, Raw } from 'telegram/events';
import { getClient, isClientReady } from './clients';
import { prizeService } from '../giveaways/services';

function getMessageMeta(event: NewMessageEvent) {
  const message = event.message as any;
  return {
    messageId: message?.id ?? null,
    messageClass: message?.className ?? null,
    actionClass: message?.action?.className ?? null,
    senderId: message?.senderId?.toString?.() ?? null,
    peerClass: message?.peerId?.className ?? null,
    out: message?.out ?? null,
    hasGiftField: Boolean(message?.gift),
    hasUniqueGiftField: Boolean(message?.unique_gift),
    hasMedia: Boolean(message?.media),
  };
}

type RawMessageCandidate = {
  message: any;
  path: string;
  updateClass: string | null;
};

function collectRawMessageCandidates(
  update: any,
  path = 'root',
  candidates: RawMessageCandidate[] = [],
): RawMessageCandidate[] {
  if (!update || typeof update !== 'object') return candidates;

  const updateClass = update?.className ?? null;
  if (update?.message) {
    candidates.push({
      message: update.message,
      path,
      updateClass,
    });
  }

  if (update?.update) {
    collectRawMessageCandidates(update.update, `${path}.update`, candidates);
  }

  if (Array.isArray(update?.updates)) {
    update.updates.forEach((nested: any, index: number) => {
      collectRawMessageCandidates(nested, `${path}.updates[${index}]`, candidates);
    });
  }

  if (Array.isArray(update?.messages)) {
    update.messages.forEach((message: any, index: number) => {
      candidates.push({
        message,
        path: `${path}.messages[${index}]`,
        updateClass,
      });
    });
  }

  return candidates;
}

function getMessageGiftSignal(message: any) {
  const actionClass = message?.action?.className ?? null;
  const looksGiftRelated =
    Boolean(actionClass?.includes('Gift')) ||
    Boolean(message?.gift) ||
    Boolean(message?.unique_gift);
  const isKnownStarGift =
    actionClass === 'MessageActionStarGift' ||
    actionClass === 'MessageActionStarGiftUnique';

  return {
    actionClass,
    looksGiftRelated,
    isKnownStarGift,
  };
}

function buildProcessedMessageKey(message: any) {
  const msgId = message?.id ?? 'no-msg-id';
  const peerUserId = message?.peerId?.userId?.toString?.() ?? 'no-peer-user';
  const peerChannelId = message?.peerId?.channelId?.toString?.() ?? 'no-peer-channel';
  const actionClass = message?.action?.className ?? 'no-action';
  return `${msgId}:${peerUserId}:${peerChannelId}:${actionClass}`;
}

function getRawSenderResolution(message: any) {
  const directSenderId = message?.senderId?.toString?.();
  if (directSenderId) {
    return { senderTelegramId: directSenderId, source: 'senderId', confidence: 'high' as const };
  }

  const fromUserId = message?.fromId?.userId?.toString?.();
  if (fromUserId) {
    return { senderTelegramId: fromUserId, source: 'fromId.userId', confidence: 'high' as const };
  }

  const actionUserId = message?.action?.userId?.toString?.();
  if (actionUserId) {
    return { senderTelegramId: actionUserId, source: 'action.userId', confidence: 'medium' as const };
  }

  const actionPeerUserId = message?.action?.peer?.userId?.toString?.();
  if (actionPeerUserId) {
    return {
      senderTelegramId: actionPeerUserId,
      source: 'action.peer.userId',
      confidence: 'medium' as const,
    };
  }

  const peerUserId = message?.peerId?.userId?.toString?.();
  if (peerUserId) {
    return { senderTelegramId: peerUserId, source: 'peerId.userId', confidence: 'low' as const };
  }

  return { senderTelegramId: null, source: 'none', confidence: 'none' as const };
}

export function attachStandardListener() {
  if (!isClientReady('Standard')) return;

  const standardClient = getClient('Standard');

  standardClient.addEventHandler(async (event: NewMessageEvent) => {
    if ((event.message as any).className !== 'Message') return;
    const senderId = event.message.senderId;
    if (!senderId) return;
    const senderTelegramId = senderId.toString();
    try {
      await prizeService.retryPrizesForUser(senderTelegramId);
    } catch (e) {
      console.error('[Userbot] retryPrizesForUser error:', e);
    }
  }, new NewMessage({ incoming: true }));
}

export function attachUniqueListener() {
  if (!isClientReady('Unique')) return;

  const uniqueClient = getClient('Unique');
  console.log('[Userbot] Unique listener attached (NewMessage + Raw incoming)');

  // Shared dedup: whichever handler fires first marks the msgId so the other skips
  const processedMessageKeys = new Set<string>();

  // Primary handler via gramjs high-level NewMessage event
  uniqueClient.addEventHandler(async (event: NewMessageEvent) => {
    const message = event.message as any;
    const { actionClass, looksGiftRelated, isKnownStarGift } = getMessageGiftSignal(message);

    if (looksGiftRelated) {
      console.log('[Userbot] Unique incoming gift-like event (NewMessage)', getMessageMeta(event));
    }

    if (looksGiftRelated && !isKnownStarGift) {
      console.warn(
        `[Userbot] Gift-like event did not match expected action class: ${actionClass ?? 'none'}`,
        getMessageMeta(event),
      );
    }

    if (!looksGiftRelated) return;

    const processedKey = buildProcessedMessageKey(message);
    if (processedMessageKeys.has(processedKey)) return;
    processedMessageKeys.add(processedKey);

    const senderTelegramId = message?.senderId?.toString?.() ?? null;
    if (!senderTelegramId) {
      console.warn('[Userbot] Unique gift event is missing senderId', getMessageMeta(event));
    }

    try {
      console.log(
        `[Userbot] Unique gift event matched action=${actionClass ?? 'unknown'} sender=${senderTelegramId ?? 'n/a'} msgId=${message?.id ?? 'n/a'}`,
      );
      await prizeService.syncDepositedGifts(senderTelegramId ?? undefined);
      console.log(
        `[Userbot] syncDepositedGifts completed sender=${senderTelegramId ?? 'all'} source=new-message`,
      );
    } catch (e) {
      console.error('[Userbot] syncDepositedGifts error:', e);
    }
  }, new NewMessage({ incoming: true }));

  // Fallback: raw MTProto updates — unwrap wrappers and catch gift service messages NewMessage may miss.
  uniqueClient.addEventHandler(async (update: any) => {
    const candidates = collectRawMessageCandidates(update);
    for (const candidate of candidates) {
      const { message, path, updateClass } = candidate;
      if (message?.out === true) continue;

      const { actionClass, looksGiftRelated } = getMessageGiftSignal(message);
      if (!looksGiftRelated) continue;

      const processedKey = buildProcessedMessageKey(message);
      if (processedMessageKeys.has(processedKey)) continue;
      processedMessageKeys.add(processedKey);

      const sender = getRawSenderResolution(message);

      console.log('[Userbot] Raw gift candidate', {
        rawUpdateClass: update?.className ?? null,
        updateClass,
        path,
        actionClass,
        msgId: message?.id ?? null,
        senderId: sender.senderTelegramId,
        senderSource: sender.source,
        senderConfidence: sender.confidence,
      });

      if (!sender.senderTelegramId) {
        console.warn(
          `[Userbot] Raw gift candidate has no reliable sender; falling back to full deposit sync action=${actionClass ?? 'unknown'} msgId=${message?.id ?? 'n/a'}`,
        );
      } else if (sender.confidence === 'low') {
        console.warn(
          `[Userbot] Raw gift candidate only has low-confidence sender source=${sender.source}; running full deposit sync instead of sender-targeted sync`,
        );
      }

      try {
        await prizeService.syncDepositedGifts(
          sender.confidence === 'high' || sender.confidence === 'medium'
            ? sender.senderTelegramId
            : undefined,
        );
        console.log(
          `[Userbot] syncDepositedGifts (raw) completed sender=${sender.senderTelegramId ?? 'all'} source=${sender.source}`,
        );
      } catch (e) {
        console.error('[Userbot] syncDepositedGifts (raw) error:', e);
      }
    }
  }, new Raw({}));
}

/** @deprecated Use attachStandardListener + attachUniqueListener */
export function attachMessageListeners() {
  attachStandardListener();
  attachUniqueListener();
}

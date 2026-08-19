import fs from 'fs';
import path from 'path';
import { Api } from 'telegram';
import { TelegramClient } from 'telegram';
import bigInt from 'big-integer';
import type { OwnedGift } from '../bot/service/bot.service';
import type { AccountType } from './clients';
import { getClient, isAuthError, isClientReady, markSessionRevoked } from './clients';
import { getOwnedGiftId, mapSavedStarGiftsToOwnedGifts } from './gift-mapper';
import { parseGiftSendError, parseGiftTransferError } from './gift-error.util';
import {
  RecipientPeerNotFoundError,
  resolveRecipientPeer,
} from './resolve-recipient-peer';

export interface SendGiftResult {
  success: boolean;
  needsChat?: boolean;
  giftUnavailable?: boolean;
  balanceTooLow?: boolean;
  errorCode?: string;
}

export interface RecipientReachableResult {
  needsChat: boolean;
  errorCode?: string;
}

/**
 * Preflight whether we can deliver to this user on the given userbot account.
 * For StandardGift uses payments.GetPaymentForm (same as send) — getInputEntity alone
 * often succeeds after the user wrote to the bot while SendStarsForm still returns USER_NOT_MUTUAL_CONTACT.
 */
export async function checkRecipientReachable(
  accountType: AccountType,
  recipientTelegramId: string,
  options?: {
    telegramGiftId?: string | null;
    recipientUsername?: string | null;
  },
): Promise<RecipientReachableResult> {
  const client = getClient(accountType);
  const recipientId = recipientTelegramId.trim();
  const giftId = options?.telegramGiftId?.trim() || null;

  try {
    const peer = await resolveRecipientPeer(accountType, {
      recipientTelegramId: recipientId,
      recipientUsername: options?.recipientUsername,
    });

    if (giftId) {
      const invoice = new Api.InputInvoiceStarGift({
        peer: peer as any,
        giftId: bigInt(giftId),
        hideName: false,
      });
      await client.invoke(new Api.payments.GetPaymentForm({ invoice }));
    }

    return { needsChat: false };
  } catch (e: unknown) {
    if (e instanceof RecipientPeerNotFoundError) {
      console.warn(
        `[Userbot] checkRecipientReachable needsChat (no peer) account=${accountType} recipient=${recipientId} giftId=${giftId ?? 'n/a'}`,
      );
      return { needsChat: true, errorCode: 'PEER_NOT_IN_DIALOGS' };
    }

    const msg: string =
      (e as { errorMessage?: string; message?: string })?.errorMessage ??
      (e as Error)?.message ??
      '';
    const parsed = parseGiftSendError(msg);
    if (parsed.needsChat) {
      console.warn(
        `[Userbot] checkRecipientReachable needsChat account=${accountType} recipient=${recipientId} giftId=${giftId ?? 'n/a'} code=${parsed.errorCode}`,
      );
      return { needsChat: true, errorCode: parsed.errorCode };
    }
    if (parsed.giftUnavailable) {
      return { needsChat: false, errorCode: parsed.errorCode };
    }
    console.warn(
      `[Userbot] checkRecipientReachable non-chat error account=${accountType} recipient=${recipientId} code=${parsed.errorCode}`,
    );
    return { needsChat: false, errorCode: parsed.errorCode };
  }
}

export interface TransferGiftResult {
  success: boolean;
  nextTransferDate?: Date;
  errorCode?: string;
  /** Paid transfer flow failed (unexpected after GetPaymentForm) */
  paymentRequired?: boolean;
  /** Unique userbot Stars balance too low for transfer_stars fee */
  balanceTooLow?: boolean;
  needsChat?: boolean;
}

function getTransferCooldownDate(error: unknown): Date | undefined {
  const retryAfter = (error as { seconds?: number } | undefined)?.seconds;
  if (typeof retryAfter === 'number' && retryAfter > 0) {
    return new Date(Date.now() + retryAfter * 1000);
  }

  const errorMessage =
    (error as { errorMessage?: string; message?: string } | undefined)?.errorMessage ??
    (error as { message?: string } | undefined)?.message ??
    '';
  const cooldownMatch = errorMessage.match(/STARGIFT_TRANSFER_TOO_EARLY_(\d+)/);
  if (!cooldownMatch) {
    return undefined;
  }

  const retryAfterFromMessage = Number(cooldownMatch[1]);
  if (!Number.isFinite(retryAfterFromMessage) || retryAfterFromMessage <= 0) {
    return undefined;
  }

  return new Date(Date.now() + retryAfterFromMessage * 1000);
}

export async function sendGiftViaUserbot(
  telegramGiftId: string,
  recipientTelegramId: string,
  recipientUsername?: string | null,
): Promise<SendGiftResult> {
  // Catalog (standard) gifts are bought/sent from the Unique/Bank account (Oleksandr)
  const client = getClient('Unique');
  try {
    const peer = await resolveRecipientPeer('Unique', {
      recipientTelegramId,
      recipientUsername,
    });
    const invoice = new Api.InputInvoiceStarGift({
      peer: peer as any,
      giftId: bigInt(telegramGiftId),
      hideName: false,
    });

    const form = (await client.invoke(
      new Api.payments.GetPaymentForm({ invoice }),
    )) as any;

    await client.invoke(
      new Api.payments.SendStarsForm({
        formId: form.formId,
        invoice,
      }),
    );
    return { success: true };
  } catch (e: unknown) {
    if (e instanceof RecipientPeerNotFoundError) {
      console.warn(
        `[Userbot] sendGiftViaUserbot needsChat — not in dialogs giftId=${telegramGiftId} recipient=${recipientTelegramId}`,
      );
      return { success: false, needsChat: true, errorCode: 'PEER_NOT_IN_DIALOGS' };
    }
    if (isAuthError(e)) {
      await markSessionRevoked('Unique');
      return { success: false };
    }
    const msg: string =
      (e as { errorMessage?: string; message?: string })?.errorMessage ??
      (e as Error)?.message ??
      '';
    const parsed = parseGiftSendError(msg);
    if (parsed.needsChat) {
      return { success: false, needsChat: true, errorCode: parsed.errorCode };
    }
    if (parsed.balanceTooLow) {
      console.error(
        `[Userbot] sendGiftViaUserbot balanceTooLow giftId=${telegramGiftId} code=${parsed.errorCode}`,
      );
      return {
        success: false,
        balanceTooLow: true,
        errorCode: parsed.errorCode,
      };
    }
    if (parsed.giftUnavailable) {
      console.error(
        `[Userbot] sendGiftViaUserbot giftUnavailable giftId=${telegramGiftId} code=${parsed.errorCode}`,
      );
      return {
        success: false,
        giftUnavailable: true,
        errorCode: parsed.errorCode,
      };
    }
    console.error(
      `[Userbot] sendGiftViaUserbot error giftId=${telegramGiftId} code=${parsed.errorCode}`,
    );
    return { success: false, errorCode: parsed.errorCode };
  }
}

async function transferGiftViaUserbotWithStarsPayment(
  client: TelegramClient,
  msgId: number,
  peer: unknown,
  ownedGiftId: string,
  recipientTelegramId: string,
): Promise<TransferGiftResult> {
  const invoice = new Api.InputInvoiceStarGiftTransfer({
    stargift: new Api.InputSavedStarGiftUser({ msgId }) as any,
    toId: peer as any,
  });

  try {
    const form = (await client.invoke(
      new Api.payments.GetPaymentForm({ invoice }),
    )) as any;

    await client.invoke(
      new Api.payments.SendStarsForm({
        formId: form.formId,
        invoice,
      }),
    );

    console.log(
      `[Userbot] transferGiftViaUserbot paid transfer ok ownedGiftId=${ownedGiftId} recipient=${recipientTelegramId} msgId=${msgId}`,
    );
    return { success: true };
  } catch (e: any) {
    const msg: string = e?.errorMessage ?? e?.message ?? '';
    const parsed = parseGiftTransferError(msg);
    if (parsed.balanceTooLow) {
      console.error(
        `[Userbot] transferGiftViaUserbotWithStarsPayment balanceTooLow ownedGiftId=${ownedGiftId} recipient=${recipientTelegramId} code=${parsed.errorCode}`,
      );
      return {
        success: false,
        balanceTooLow: true,
        errorCode: parsed.errorCode,
      };
    }
    if (parsed.paymentRequired) {
      return {
        success: false,
        paymentRequired: true,
        errorCode: parsed.errorCode,
      };
    }
    if (parsed.needsChat) {
      return { success: false, needsChat: true, errorCode: parsed.errorCode };
    }
    throw e;
  }
}

export async function transferGiftViaUserbot(
  ownedGiftId: string,
  recipientTelegramId: string,
  recipientUsername?: string | null,
): Promise<TransferGiftResult> {
  const client = getClient('Unique');
  try {
    const msgId = await resolveGiftMsgId(client, ownedGiftId);
    if (!msgId) {
      console.error(`[Userbot] Could not resolve msgId for ownedGiftId ${ownedGiftId}`);
      return { success: false };
    }

    const peer = await resolveRecipientPeer('Unique', {
      recipientTelegramId,
      recipientUsername,
    });
    const stargift = new Api.InputSavedStarGiftUser({ msgId }) as any;

    try {
      await client.invoke(
        new Api.payments.TransferStarGift({
          stargift,
          toId: peer as any,
        }),
      );
      return { success: true };
    } catch (directError: any) {
      const directMsg: string =
        directError?.errorMessage ?? directError?.message ?? '';
      const directParsed = parseGiftTransferError(directMsg);
      if (!directParsed.paymentRequired) {
        throw directError;
      }

      console.log(
        `[Userbot] transferGiftViaUserbot free transfer unavailable ownedGiftId=${ownedGiftId} — using Stars payment flow`,
      );
      return transferGiftViaUserbotWithStarsPayment(
        client,
        msgId,
        peer,
        ownedGiftId,
        recipientTelegramId,
      );
    }
  } catch (e: any) {
    if (e instanceof RecipientPeerNotFoundError) {
      console.warn(
        `[Userbot] transferGiftViaUserbot needsChat — not in dialogs ownedGiftId=${ownedGiftId} recipient=${recipientTelegramId}`,
      );
      return { success: false, needsChat: true, errorCode: 'PEER_NOT_IN_DIALOGS' };
    }
    if (isAuthError(e)) {
      await markSessionRevoked('Unique');
      return { success: false };
    }
    const nextTransferDate = getTransferCooldownDate(e);
    if (nextTransferDate) {
      console.warn(
        `[Userbot] transferGiftViaUserbot cooldown ownedGiftId=${ownedGiftId} retryAt=${nextTransferDate.toISOString()}`,
      );
      return { success: false, nextTransferDate };
    }

    const msg: string = e?.errorMessage ?? e?.message ?? '';
    const parsed = parseGiftTransferError(msg);
    if (parsed.balanceTooLow) {
      console.error(
        `[Userbot] transferGiftViaUserbot balanceTooLow ownedGiftId=${ownedGiftId} recipient=${recipientTelegramId} code=${parsed.errorCode}`,
      );
      return {
        success: false,
        balanceTooLow: true,
        errorCode: parsed.errorCode,
      };
    }
    if (parsed.paymentRequired) {
      console.error(
        `[Userbot] transferGiftViaUserbot paymentRequired ownedGiftId=${ownedGiftId} recipient=${recipientTelegramId} code=${parsed.errorCode}`,
      );
      return {
        success: false,
        paymentRequired: true,
        errorCode: parsed.errorCode,
      };
    }
    if (parsed.needsChat) {
      console.warn(
        `[Userbot] transferGiftViaUserbot needsChat ownedGiftId=${ownedGiftId} code=${parsed.errorCode}`,
      );
      return { success: false, needsChat: true, errorCode: parsed.errorCode };
    }

    console.error(
      `[Userbot] transferGiftViaUserbot error ownedGiftId=${ownedGiftId} code=${parsed.errorCode}`,
    );
    return { success: false, errorCode: parsed.errorCode };
  }
}

async function resolveGiftMsgId(client: TelegramClient, ownedGiftId: string): Promise<number | null> {
  let offset = '';
  const me = await client.getInputEntity('me');
  do {
    const result = (await client.invoke(
      new Api.payments.GetSavedStarGifts({
        peer: me as any,
        offset,
        limit: 100,
      }),
    )) as any;

    const gifts: any[] = result.gifts ?? [];
    const match = gifts.find((g: any) => getOwnedGiftId(g) === ownedGiftId);
    if (match?.msgId != null) return match.msgId as number;

    offset = result.nextOffset ?? '';
  } while (offset);

  return null;
}

async function findSavedGiftByOwnedGiftId(
  client: TelegramClient,
  ownedGiftId: string,
): Promise<any | null> {
  let offset = '';
  const me = await client.getInputEntity('me');
  do {
    const result = (await client.invoke(
      new Api.payments.GetSavedStarGifts({
        peer: me as any,
        offset,
        limit: 100,
      }),
    )) as any;

    const gifts: any[] = result.gifts ?? [];
    const match = gifts.find((gift: any) => getOwnedGiftId(gift) === ownedGiftId);
    if (match) return match;

    offset = result.nextOffset ?? '';
  } while (offset);

  return null;
}

function findUniqueGiftStickerDocument(savedGift: any, stickerDocumentId: string): Api.Document | null {
  const attrs: any[] = savedGift?.gift?.attributes ?? [];
  for (const attr of attrs) {
    const doc = attr?.document;
    if (doc instanceof Api.Document && doc.id?.toString?.() === stickerDocumentId) {
      return doc;
    }
  }
  return null;
}

function resolveStickerExtension(document: Api.Document): string {
  if (document.mimeType === 'application/x-tgsticker') return '.tgs';
  if (document.mimeType === 'video/webm') return '.webm';
  if (document.mimeType === 'image/webp') return '.webp';
  return '.tgs';
}

async function saveDocumentThumbnailAsImage(
  client: TelegramClient,
  document: Api.Document,
  targetPathBase: string,
): Promise<string | null> {
  const media = new Api.MessageMediaDocument({ document });
  const thumbSelectors: Array<number | string> = [-1, 'w', 'm', 'x', 'y', 'a', 'b'];

  for (const thumb of thumbSelectors) {
    try {
      const buffer = await client.downloadMedia(media, { thumb: thumb as any });
      if (Buffer.isBuffer(buffer) && buffer.length > 0) {
        const imageExt = detectImageExtension(buffer);
        if (!imageExt) {
          continue;
        }
        const targetPath = `${targetPathBase}${imageExt}`;
        await fs.promises.writeFile(targetPath, buffer);
        return targetPath;
      }
    } catch {
      // Try next thumb selector.
    }
  }

  console.warn(
    `[Userbot] Unique sticker thumbnail download failed documentId=${document.id?.toString?.() ?? 'n/a'} targetBase=${targetPathBase}`,
  );
  return null;
}

function detectImageExtension(buffer: Buffer): '.jpg' | '.png' | '.webp' | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return '.jpg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return '.png';
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return '.webp';
  }
  return null;
}

export async function downloadUniqueGiftStickerViaUserbot(
  ownedGiftId: string,
  stickerDocumentId: string,
  options?: { outputFormat?: 'source' | 'webp' },
): Promise<string | null> {
  if (!isClientReady('Unique')) {
    console.warn(
      `[Userbot] Unique client not ready — cannot download sticker ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}`,
    );
    return null;
  }

  const client = getClient('Unique');
  try {
    console.log(
      `[Userbot] Unique sticker download start ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}`,
    );

    const savedGift = await findSavedGiftByOwnedGiftId(client, ownedGiftId);
    if (!savedGift) {
      console.warn(
        `[Userbot] Unique sticker download skipped: gift not found ownedGiftId=${ownedGiftId}`,
      );
      return null;
    }

    const document = findUniqueGiftStickerDocument(savedGift, stickerDocumentId);
    if (!document) {
      console.warn(
        `[Userbot] Unique sticker download skipped: document not found ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}`,
      );
      return null;
    }

    const ext = resolveStickerExtension(document);
    const dir = path.join(process.env.MULTER_DEST ?? 'static', 'gift-stickers');
    await fs.promises.mkdir(dir, { recursive: true });

    const safeBaseName = stickerDocumentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFilename = `${safeBaseName}${ext}`;
    const localPath = path.join(dir, safeFilename);
    const publicPath = `/static/gift-stickers/${safeFilename}`;
    const wantsWebp = options?.outputFormat === 'webp';
    const convertedPathBase = path.join(dir, `${safeBaseName}-thumb`);
    const convertedPublicBase = `/static/gift-stickers/${safeBaseName}-thumb`;
    const convertedExtCandidates: Array<'.jpg' | '.png' | '.webp'> = [
      '.jpg',
      '.png',
      '.webp',
    ];

    if (wantsWebp) {
      for (const extCandidate of convertedExtCandidates) {
        const cachedLocal = `${convertedPathBase}${extCandidate}`;
        if (fs.existsSync(cachedLocal)) {
          console.log(
            `[Userbot] Unique sticker thumb cache hit ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}`,
          );
          return `${convertedPublicBase}${extCandidate}`;
        }
      }
    }

    if (fs.existsSync(localPath)) {
      console.log(
        `[Userbot] Unique sticker download cache hit ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}`,
      );
      if (!wantsWebp) return publicPath;
      if (ext === '.webp') return publicPath;
      if (ext !== '.tgs') return publicPath;

      const convertedPath = await saveDocumentThumbnailAsImage(
        client,
        document,
        convertedPathBase,
      );
      if (!convertedPath) {
        console.warn(
          `[Userbot] Unique sticker static thumb required but failed (cache-hit source), returning null ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}`,
        );
      }
      const convertedFilename = path.basename(convertedPath ?? '');
      return convertedPath ? `/static/gift-stickers/${convertedFilename}` : null;
    }

    const media = new Api.MessageMediaDocument({ document });
    const buffer = await client.downloadMedia(media);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      console.warn(
        `[Userbot] Unique sticker download returned empty buffer ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}`,
      );
      return null;
    }

    await fs.promises.writeFile(localPath, buffer);
    console.log(
      `[Userbot] Unique sticker download saved ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId} bytes=${buffer.length}`,
    );
    if (!wantsWebp) return publicPath;
    if (ext === '.webp') return publicPath;
    if (ext !== '.tgs') return publicPath;

    const convertedPath = await saveDocumentThumbnailAsImage(
      client,
      document,
      convertedPathBase,
    );
    if (!convertedPath) {
      console.warn(
        `[Userbot] Unique sticker static thumb required but failed (fresh source), returning null ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}`,
      );
    }
    const convertedFilename = path.basename(convertedPath ?? '');
    return convertedPath ? `/static/gift-stickers/${convertedFilename}` : null;
  } catch (e: any) {
    if (isAuthError(e)) {
      await markSessionRevoked('Unique');
      return null;
    }
    console.error(
      `[Userbot] Unique sticker download failed ownedGiftId=${ownedGiftId} stickerDocumentId=${stickerDocumentId}:`,
      e?.errorMessage ?? e?.message ?? e,
    );
    return null;
  }
}

export async function getSavedGiftsViaUserbot(): Promise<OwnedGift[]> {
  if (!isClientReady('Unique')) {
    console.error('[Userbot] Unique client not ready — cannot list saved gifts');
    return [];
  }

  const client = getClient('Unique');
  const allSaved: any[] = [];
  const allUsers: any[] = [];
  let offset = '';
  const me = await client.getInputEntity('me');

  do {
    const result = (await client.invoke(
      new Api.payments.GetSavedStarGifts({
        peer: me as any,
        offset,
        limit: 100,
      }),
    )) as any;

    allSaved.push(...(result.gifts ?? []));
    if (result.users?.length) {
      const seen = new Set(allUsers.map((u: any) => u.id?.toString()));
      for (const u of result.users) {
        if (!seen.has(u.id?.toString())) {
          allUsers.push(u);
          seen.add(u.id?.toString());
        }
      }
    }
    offset = result.nextOffset ?? '';
  } while (offset);

  const mappedGifts = mapSavedStarGiftsToOwnedGifts(allSaved, allUsers);
  const uniqueCount = mappedGifts.filter((gift) => gift.type === 'unique').length;
  const missingSenderUserCount = mappedGifts.filter((gift) => !gift.sender_user?.id).length;
  console.log(
    `[Userbot] GetSavedStarGifts summary raw=${allSaved.length} users=${allUsers.length} mapped=${mappedGifts.length} unique=${uniqueCount} missingSender=${missingSenderUserCount}`,
  );

  if (missingSenderUserCount > 0) {
    const sampleOwnedGiftIds = mappedGifts
      .filter((gift) => !gift.sender_user?.id)
      .slice(0, 5)
      .map((gift) => gift.owned_gift_id)
      .join(', ');
    console.warn(
      `[Userbot] Some saved gifts are missing sender_user mapping count=${missingSenderUserCount} sampleOwnedGiftIds=[${sampleOwnedGiftIds}]`,
    );
  }

  return mappedGifts;
}

import type {
  OwnedGift,
  TelegramRegularGift,
  TelegramUniqueGift,
  TgSticker,
} from '../bot/service/bot.service';

/** Normalize MTProto / gramjs timestamp fields to Unix seconds. */
function toUnixTimestamp(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'object') {
    const wrapped = value as { value?: unknown; timestamp?: unknown };
    if (wrapped.value != null) return toUnixTimestamp(wrapped.value);
    if (wrapped.timestamp != null) return toUnixTimestamp(wrapped.timestamp);
  }
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/** Stable owned_gift_id — shared by mapper and resolveGiftMsgId. */
export function getOwnedGiftId(saved: any): string {
  if (saved.savedId != null && saved.savedId !== undefined) {
    return String(saved.savedId);
  }
  if (saved.msgId != null && saved.msgId !== undefined) {
    return String(saved.msgId);
  }
  if (saved.gift?.id != null) {
    return saved.gift.id.toString();
  }
  return '';
}

function documentToSticker(doc: any): TgSticker {
  return {
    file_id: doc?.id != null ? String(doc.id) : '',
    file_unique_id: doc?.id != null ? String(doc.id) : '',
    is_animated: doc?.mimeType === 'application/x-tgsticker',
  };
}

function isUniqueStarGift(gift: any): boolean {
  const cn = gift?.className ?? '';
  return cn === 'StarGiftUnique' || cn.includes('Unique');
}

function mapUniqueGift(gift: any): TelegramUniqueGift {
  const attrs: any[] = gift.attributes ?? [];
  let model = { name: '', sticker: documentToSticker(null), rarity_per_mille: 0 };
  let symbol = { name: '', sticker: documentToSticker(null), rarity_per_mille: 0 };
  let backdrop: TelegramUniqueGift['backdrop'] = { name: '', rarity_per_mille: 0 };

  for (const attr of attrs) {
    const attrClass = attr?.className ?? '';
    if (attrClass.includes('Model')) {
      model = {
        name: attr.name ?? '',
        sticker: documentToSticker(attr.document),
        rarity_per_mille: attr.rarityPermille ?? attr.rarity_per_mille,
      };
    } else if (attrClass.includes('Pattern') || attrClass.includes('Symbol')) {
      symbol = {
        name: attr.name ?? '',
        sticker: documentToSticker(attr.document),
        rarity_per_mille: attr.rarityPermille ?? attr.rarity_per_mille,
      };
    } else if (attrClass.includes('Backdrop')) {
      backdrop = {
        name: attr.name ?? '',
        rarity_per_mille: attr.rarityPermille ?? attr.rarity_per_mille,
        center_color: attr.centerColor ?? attr.center_color,
        edge_color: attr.edgeColor ?? attr.edge_color,
        pattern_color: attr.patternColor ?? attr.pattern_color,
        text_color: attr.textColor ?? attr.text_color,
      };
    }
  }

  const title = gift.title ?? gift.slug ?? '';
  const num = gift.num ?? gift.number ?? 0;

  return {
    gift_id: gift.id?.toString() ?? '',
    base_name: title,
    name: gift.slug ?? title,
    number: typeof num === 'number' ? num : Number(num),
    model,
    symbol,
    backdrop,
  };
}

function mapRegularGift(gift: any): TelegramRegularGift {
  const stickerDoc = gift.sticker ?? gift.document;
  return {
    id: gift.id?.toString() ?? '',
    sticker: documentToSticker(stickerDoc),
    star_count: gift.stars ?? gift.starCount ?? 0,
    upgrade_star_count: gift.upgradeStars ?? gift.upgrade_stars,
  };
}

function resolveSenderUser(fromId: any, users: any[]): OwnedGift['sender_user'] | undefined {
  if (!fromId) return undefined;

  let userId: number | undefined;
  if (fromId.className === 'PeerUser' || fromId.userId != null) {
    userId = Number(fromId.userId ?? fromId.user_id);
  }

  if (userId == null) return undefined;

  const user = users?.find((u: any) => Number(u.id) === userId);
  return {
    id: userId,
    first_name: user?.firstName ?? user?.first_name ?? '',
    username: user?.username,
  };
}

export function mapSavedStarGiftToOwnedGift(saved: any, users: any[] = []): OwnedGift | null {
  const owned_gift_id = getOwnedGiftId(saved);
  if (!owned_gift_id) return null;

  const gift = saved.gift;
  if (!gift) return null;

  const unique = isUniqueStarGift(gift);
  const nextTransferDate = toUnixTimestamp(saved.canTransferAt ?? saved.can_transfer_at);
  const nowSec = Math.floor(Date.now() / 1000);
  const inCooldown = nextTransferDate != null && nextTransferDate > nowSec;

  return {
    owned_gift_id,
    type: unique ? 'unique' : 'regular',
    gift: unique ? mapUniqueGift(gift) : mapRegularGift(gift),
    sender_user: resolveSenderUser(saved.fromId, users),
    send_date: toUnixTimestamp(saved.date) ?? 0,
    is_saved: !saved.unsaved,
    can_be_transferred: !inCooldown,
    ...(inCooldown ? { next_transfer_date: nextTransferDate } : {}),
  };
}

export function mapSavedStarGiftsToOwnedGifts(
  savedGifts: any[],
  users: any[] = [],
): OwnedGift[] {
  const result: OwnedGift[] = [];
  for (const saved of savedGifts) {
    const mapped = mapSavedStarGiftToOwnedGift(saved, users);
    if (mapped) result.push(mapped);
  }
  return result;
}

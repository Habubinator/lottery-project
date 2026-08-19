/** Fields needed to render a unique gift as a t.me/nft/ link in Telegram HTML. */
export type GiftNftLinkFields = {
  giftName?: string | null;
  giftNumber?: string | null;
  giftNftName?: string | null;
  prizeType?: string | null;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Telegram collectible slug, e.g. SnoopDogg-241262 (from giftNftName or name + number). */
export function resolveTelegramNftSlug(prize: GiftNftLinkFields): string | null {
  if (prize.prizeType === 'StandardGift') return null;

  const fromDb = prize.giftNftName?.trim();
  if (fromDb) return fromDb;

  const name = prize.giftName?.trim();
  const number = prize.giftNumber?.trim();
  if (!name || !number) return null;

  const base = name.replace(/\s+/g, '');
  return `${base}-${number}`;
}

export function buildTelegramNftGiftUrl(slug: string): string {
  return `https://t.me/nft/${slug}`;
}

/**
 * One unique gift line for giveaway posts (HTML parse_mode).
 * Example: 🎁<a href="https://t.me/nft/SnoopDogg-241262">Snoop Dogg</a>
 */
export function formatUniqueGiftNftHtml(
  prize: GiftNftLinkFields,
  opts?: { medalPrefix?: string },
): string {
  const medal = opts?.medalPrefix ?? '';
  const displayName = (prize.giftName ?? '?').trim();
  const slug = resolveTelegramNftSlug(prize);

  if (slug) {
    const url = buildTelegramNftGiftUrl(slug);
    return `${medal}🎁<a href="${url}">${escapeHtml(displayName)}</a>`;
  }

  const num = prize.giftNumber ? ` #${escapeHtml(prize.giftNumber)}` : '';
  return `${medal}🎁${escapeHtml(displayName)}${num}`;
}

/** Winner / results line suffix for a prize (HTML). */
export function formatWinnerPrizeHtml(
  prize: GiftNftLinkFields,
): string {
  if (prize.prizeType === 'StandardGift') {
    return ` • ${escapeHtml(prize.giftName ?? '🎁')}`;
  }
  return ` • ${formatUniqueGiftNftHtml(prize)}`;
}

export type CatalogGiftRef = {
  id: string;
  star_count: number;
  remaining_count?: number;
  total_count?: number;
  sticker?: { emoji?: string };
};

export function isCatalogGiftAvailable(
  giftId: string,
  catalog: CatalogGiftRef[],
): boolean {
  const g = catalog.find((x) => x.id === giftId);
  if (!g) return false;
  if (g.remaining_count == null) return true;
  return g.remaining_count > 0;
}

export function findSubstituteGift(
  starCount: number,
  excludeGiftIds: string[],
  catalog: CatalogGiftRef[],
): CatalogGiftRef | null {
  const exclude = new Set(excludeGiftIds);
  const candidates = catalog
    .filter(
      (g) =>
        g.star_count === starCount &&
        !exclude.has(g.id) &&
        (g.remaining_count == null || g.remaining_count > 0),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

export function getCatalogGiftLabel(gift: CatalogGiftRef): string | null {
  return gift.sticker?.emoji ?? null;
}

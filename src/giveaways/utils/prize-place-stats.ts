import { GiveawayStartType } from '@database';

export type PrizePlaceParticipant = {
  isWinner: boolean;
  isAddWinner: boolean;
  wasReplaced: boolean;
  giveaway: { participiationType: GiveawayStartType };
};

export type OccupiedPrizePlaceRow = PrizePlaceParticipant & {
  uuid?: string;
  giveawayId?: string;
  winPlace?: number;
  addPlace?: number;
};

/** Occupied prize place: main or additional winner, excluding replaced holders. */
export function isOccupiedPrizePlace(p: {
  isWinner: boolean;
  isAddWinner: boolean;
  wasReplaced: boolean;
}): boolean {
  return (p.isWinner || p.isAddWinner) && !p.wasReplaced;
}

/** One key per logical prize slot (not per giveaway — multi-place wins stay distinct). */
export function occupiedPrizePlaceKey(p: OccupiedPrizePlaceRow): string {
  const giveawayId = p.giveawayId ?? '';
  if (p.isAddWinner) {
    return `${giveawayId}:add:${p.addPlace ?? 0}`;
  }
  const winPlace = p.winPlace ?? 0;
  if (winPlace > 0) {
    return `${giveawayId}:main:${winPlace}`;
  }
  // numerifyWinners off: each winning ticket row is its own place
  return `${giveawayId}:main:row:${p.uuid ?? ''}`;
}

/** Occupied prize places, deduped by slot (avoids double-count from duplicate winner rows). */
export function filterOccupiedPrizePlaces<T extends OccupiedPrizePlaceRow>(
  participants: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const p of participants) {
    if (!isOccupiedPrizePlace(p)) continue;
    const key = occupiedPrizePlaceKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}

export function countOccupiedPrizePlaces(
  participants: OccupiedPrizePlaceRow[],
  filterType?: GiveawayStartType,
): number {
  return filterOccupiedPrizePlaces(participants).filter((p) => {
    if (filterType && p.giveaway.participiationType !== filterType) {
      return false;
    }
    return true;
  }).length;
}

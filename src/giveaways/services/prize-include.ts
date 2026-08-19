import { GiveawayPrizeStatus } from '@database';

/** Default sort for prize lists in API responses. */
export const GIVEAWAY_PRIZE_ORDER_BY = [
  { winPlace: 'asc' as const },
  { createdAt: 'asc' as const },
];

/** Prizes shown on public giveaway cards and detail views. */
export const GIVEAWAY_LINKED_PRIZE_STATUSES: GiveawayPrizeStatus[] = [
  GiveawayPrizeStatus.Linked,
  GiveawayPrizeStatus.ReadyToClaim,
  GiveawayPrizeStatus.Cooldown,
  GiveawayPrizeStatus.Transferred,
];

/**
 * Prizes shown in Telegram giveaway / results posts (gifts section).
 * Includes post-claim statuses while giveawayId is still set on the prize row.
 */
export const GIVEAWAY_ANNOUNCEMENT_PRIZE_STATUSES: GiveawayPrizeStatus[] = [
  ...GIVEAWAY_LINKED_PRIZE_STATUSES,
  GiveawayPrizeStatus.Available,
  GiveawayPrizeStatus.Processing,
];

/**
 * Prisma relation args: all GiveawayPrize columns (no field subset).
 */
export const GIVEAWAY_LINKED_PRIZES_INCLUDE = {
  where: { status: { in: GIVEAWAY_LINKED_PRIZE_STATUSES } },
  orderBy: GIVEAWAY_PRIZE_ORDER_BY,
};

/** Like GIVEAWAY_LINKED_PRIZES_INCLUDE but includes post-claim statuses (Available, Processing). */
export const GIVEAWAY_ANNOUNCEMENT_PRIZES_INCLUDE = {
  where: { status: { in: GIVEAWAY_ANNOUNCEMENT_PRIZE_STATUSES } },
  orderBy: GIVEAWAY_PRIZE_ORDER_BY,
};

/** Prize fields for Telegram giveaway / results message formatting (bot). */
export const GIVEAWAY_MESSAGE_PRIZE_SELECT = {
  id: true,
  giftName: true,
  giftNumber: true,
  giftNftName: true,
  winPlace: true,
  status: true,
  prizeType: true,
  telegramGiftId: true,
} as const;

export const GIVEAWAY_FORMAT_PRIZES_INCLUDE = {
  where: { status: { in: GIVEAWAY_ANNOUNCEMENT_PRIZE_STATUSES } },
  select: GIVEAWAY_MESSAGE_PRIZE_SELECT,
  orderBy: GIVEAWAY_PRIZE_ORDER_BY,
};

export const GIVEAWAY_LINKED_ONLY_PRIZES_INCLUDE = {
  where: { status: GiveawayPrizeStatus.Linked },
  select: GIVEAWAY_MESSAGE_PRIZE_SELECT,
  orderBy: GIVEAWAY_PRIZE_ORDER_BY,
};

export const GIVEAWAY_OWNER_RELATIONS_INCLUDE = {
  createdBy: {
    select: {
      id: true,
      username: true,
      first_name: true,
      last_name: true,
      photo_url: true,
    },
  },
  boostedChannel: true,
  sponsoredBy: {
    include: {
      sponsorChannel: true,
      sponsorLink: true,
    },
  },
  linkedChannels: {
    include: {
      channel: true,
    },
  },
  postlotPublications: { include: { channel: true } },
  prizes: GIVEAWAY_LINKED_PRIZES_INCLUDE,
};

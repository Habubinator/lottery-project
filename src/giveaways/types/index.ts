/**
 * User shape in referral list from getAdditionalTicketsStatus.
 * Extend with `interface MyReferral extends AdditionalTicketReferral { ... }`.
 */
export interface AdditionalTicketReferral {
  id: number;
  username?: string | null;
  first_name: string;
  last_name?: string | null;
  photo_url?: string | null;
  hasParticipated?: boolean;
}

/**
 * Boost status per linked channel.
 * Extend to add channel metadata if needed.
 */
export interface BoostChannelStatus {
  channelId: string;
  title: string | null;
  username: string | null;
  photo: string | null;
  isBoosting: boolean;
}

/** Return type of GiveawayService.getAdditionalTicketsStatus() */
export interface AdditionalTicketsStatus {
  canEarnAdditionalTickets: boolean;
  earnedFromRefs: number;
  earnedFromBoosts: number;
  maxAdditionalTickets: number;
  remaining: number | null;
  countRefsOnParticipation: boolean;
  qualifyingReferralsCount: number;
  refsPerTicket: number;
  boostsPerTicket: number;
  /** Progress within the current referral→ticket cycle (0 when refsPerTicket disabled). */
  referralsTowardNextTicket: number | null;
  /** Referrals still needed for the next extra ticket. */
  referralsNeededForNextTicket: number | null;
  /** Full tickets earned from current qualifying referrals (before max cap). */
  ticketsFromQualifyingReferrals: number | null;
  referrals: AdditionalTicketReferral[];
  boostStatuses: BoostChannelStatus[];
}

/** Return type of GiveawayService.claimBoostTickets() */
export interface ClaimBoostResult {
  awarded: number;
  totalEarned: number;
  remaining: number | null;
}

/** Return type of GiveawayService.getAdvertisingInvoiceLink() */
export interface AdvertisingInvoiceResult {
  /** Null when main-page posting was applied for free (no Stars invoice). */
  invoiceLink: string | null;
  totalStars: number;
  /** True when isPostingOn was enabled without payment (lottery / gifts). */
  freePostingApplied?: boolean;
}

/** Return type of GiveawayService.getAdvertisingStatus() */
export interface AdvertisingStatusResult {
  isPostingOn: boolean;
  isNotificationOn: boolean;
  advertisedAt: Date | null;
  notificationPaidAt: Date | null;
  /** Lottery always; Random when Linked gifts exist; or already paid (advertisedAt). */
  postingFreeEligible: boolean;
  postingPriceStars: number;
  notificationPriceStars: number;
  linkedGiftCount: number;
}

import { GiveawayStartType, GiveawayEndType, Currencies } from '@database';
import {
  parseParticipationButtonStyle,
  parseShowParticipationCount,
} from '../utils/participation-button.util';

// Create Giveaway DTO (from FormData - all strings)
export type CreateGiveawayArgs = {
  description?: string;
  banner: string[];
  participiationType: string;
  completionType: string;
  language: string;
  maxParticipants?: string;
  winnerSlots: string;
  participiationPrice?: string;
  participiationCurr?: string;
  startingAt?: string;
  endingAt?: string;
  numerifyWinners?: string;
  allowMultipleWinPlaces?: string;
  isResultsInMainPost?: string;
  isCommentsOn?: string;
  variant?: string;
  isPostingOn?: string; // Ads
  isNotificationOn?: string; // Ads
  twinkBlock?: string;

  // Subscription-only features (premium)
  neededReferals?: string;
  isOnlyPremium?: string;
  isBoostNeeded?: string;
  boostedId?: string;
  allowedGeoCountries?: string;
  isCaptchaNeeded?: string;
  doApiSessionCheck?: string;
  isStaySubscribed?: string;
  participationButtonText?: string;
  participationButtonStyle?: string;
  showParticipationCount?: string;
  showParticipationMaxCount?: string;

  // Additional tickets via referrals & boosts (free feature)
  canEarnAdditionalTickets?: string;
  countRefsOnParticipation?: string;
  refsPerTicket?: string;
  boostsPerTicket?: string;
  maxAdditionalTickets?: string;

  // Sponsors and channels (can be JSON string or already-parsed array from multipart/form-data)
  sponsorLinks?:
    | string // Single JSON string or single JSON object string
    | string[] // Array of JSON strings
    | Array<{
        // Already parsed array of objects
        title: string;
        link: string;
      }>;
  linkedChannelIds?:
    | string
    | string[]
    | Array<{ id: string; role?: string }>;
  sponsorSlots?: string;
  starsPerSlot?: string;
  prizes?: string | Array<{ prizeId: number; winPlace?: number | null }>;
};

export class CreateGiveawayDto {
  public readonly description?: string;
  public readonly banner: string[];
  public readonly participiationType: GiveawayStartType;
  public readonly completionType: GiveawayEndType;
  public readonly language: string;
  public readonly maxParticipants?: number;
  public readonly winnerSlots: number;
  public readonly participiationPrice: number;
  public readonly participiationCurr: Currencies;
  public readonly startingAt: Date;
  public readonly endingAt?: Date;
  public readonly numerifyWinners: boolean;
  public readonly allowMultipleWinPlaces: boolean;
  public readonly isResultsInMainPost: boolean;
  public readonly isCommentsOn: boolean;
  public readonly variant: string;
  public readonly isPostingOn: boolean; // Ads
  public readonly isNotificationOn: boolean; // Ads
  public readonly twinkBlock: boolean;

  // Premium features
  public readonly neededReferals: number;
  public readonly isOnlyPremium: boolean;
  public readonly isBoostNeeded: boolean;
  public readonly boostedId?: bigint;
  public readonly allowedGeoCountries: string;
  public readonly isCaptchaNeeded: boolean;
  public readonly doApiSessionCheck: boolean;
  public readonly isStaySubscribed: boolean;
  public readonly participationButtonText?: string;
  public readonly participationButtonStyle?: string | null;
  public readonly showParticipationCount?: boolean;
  public readonly showParticipationMaxCount?: boolean;

  // Additional tickets via referrals & boosts
  public readonly canEarnAdditionalTickets: boolean;
  public readonly countRefsOnParticipation: boolean;
  public readonly refsPerTicket: number;
  public readonly boostsPerTicket: number;
  public readonly maxAdditionalTickets: number;

  // Sponsors and channels
  public readonly sponsorLinks?: Array<{
    title: string;
    link: string;
  }>;
  public readonly linkedChannels?: Array<{ id: string; role: 'All' | 'Posting' | 'Subscription' }>;
  public readonly sponsorSlots?: number;
  public readonly starsPerSlot?: number;
  public readonly prizes?: Array<{ prizeId: number; winPlace?: number | null }>;

  constructor(args: CreateGiveawayArgs) {
    // Required fields
    this.banner = args.banner;

    if (
      !args.participiationType ||
      !Object.values(GiveawayStartType).includes(
        args.participiationType as GiveawayStartType,
      )
    ) {
      throw new Error(
        `Invalid participiationType: ${args.participiationType}. Must be one of: ${Object.values(GiveawayStartType).join(', ')}`,
      );
    }
    this.participiationType = args.participiationType as GiveawayStartType;

    if (
      !args.completionType ||
      !Object.values(GiveawayEndType).includes(
        args.completionType as GiveawayEndType,
      )
    ) {
      throw new Error(
        `Invalid completionType: ${args.completionType}. Must be one of: ${Object.values(GiveawayEndType).join(', ')}`,
      );
    }
    this.completionType = args.completionType as GiveawayEndType;

    this.language = args.language;
    this.winnerSlots = parseInt(args.winnerSlots);

    // Optional basic fields with defaults
    this.description = args.description;
    this.maxParticipants = args.maxParticipants
      ? parseInt(args.maxParticipants)
      : undefined;
    this.participiationPrice = args.participiationPrice
      ? parseFloat(args.participiationPrice)
      : 0;
    this.participiationCurr =
      (args.participiationCurr as Currencies) || Currencies.Stars;
    this.startingAt = args.startingAt ? new Date(args.startingAt) : new Date();
    this.endingAt = args.endingAt ? new Date(args.endingAt) : undefined;
    this.numerifyWinners = args.numerifyWinners === 'true';
    this.allowMultipleWinPlaces = args.allowMultipleWinPlaces === 'true';
    this.isResultsInMainPost = args.isResultsInMainPost === 'true';
    this.isCommentsOn = args.isCommentsOn === 'true';
    this.variant = args.variant || 'standard';
    this.isPostingOn = args.isPostingOn === 'true';
    this.isNotificationOn = args.isNotificationOn === 'true';
    this.twinkBlock = args.twinkBlock === 'true';

    // Premium features with defaults (will be validated against subscription)
    this.neededReferals = args.neededReferals
      ? parseInt(args.neededReferals)
      : 0;
    this.isOnlyPremium = args.isOnlyPremium === 'true';
    this.isBoostNeeded = args.isBoostNeeded === 'true';
    this.boostedId = args.boostedId ? BigInt(args.boostedId) : undefined;
    this.allowedGeoCountries = args.allowedGeoCountries || '';
    this.isCaptchaNeeded = args.isCaptchaNeeded === 'true';
    this.doApiSessionCheck = args.doApiSessionCheck === 'true';
    this.isStaySubscribed = args.isStaySubscribed === 'true';
    if (args.participationButtonText !== undefined) {
      const trimmed = String(args.participationButtonText).trim();
      this.participationButtonText = trimmed
        ? trimmed.slice(0, 40)
        : undefined;
    }
    const parsedStyle = parseParticipationButtonStyle(
      args.participationButtonStyle,
    );
    if (parsedStyle !== undefined) {
      this.participationButtonStyle = parsedStyle;
    }
    this.showParticipationCount = parseShowParticipationCount(
      args.showParticipationCount,
    );
    this.showParticipationMaxCount = parseShowParticipationCount(
      args.showParticipationMaxCount,
    );

    // Additional tickets
    this.canEarnAdditionalTickets = args.canEarnAdditionalTickets === 'true';
    this.countRefsOnParticipation = args.countRefsOnParticipation === 'true';
    this.refsPerTicket = args.refsPerTicket ? parseInt(args.refsPerTicket) : 0;
    this.boostsPerTicket = args.boostsPerTicket ? parseInt(args.boostsPerTicket) : 0;
    this.maxAdditionalTickets = args.maxAdditionalTickets ? parseInt(args.maxAdditionalTickets) : 0;

    // Co-sponsor slots
    this.sponsorSlots = args.sponsorSlots ? parseInt(args.sponsorSlots) : undefined;
    this.starsPerSlot = args.starsPerSlot ? parseInt(args.starsPerSlot) : undefined;

    // Relations - parse JSON strings or handle already-parsed arrays
    if (args.sponsorLinks) {
      const parsed: Array<{ title: string; link: string }> = [];

      if (typeof args.sponsorLinks === 'string') {
        // Single JSON string - could be a single object or an array
        try {
          const parsedData = JSON.parse(args.sponsorLinks);

          if (Array.isArray(parsedData)) {
            // It's an array of objects
            for (const item of parsedData) {
              if (
                typeof item === 'object' &&
                item &&
                typeof item.link === 'string'
              ) {
                parsed.push({
                  title: typeof item.title === 'string' ? item.title : '',
                  link: item.link,
                });
              }
            }
          } else if (
            typeof parsedData === 'object' &&
            parsedData &&
            typeof parsedData.link === 'string'
          ) {
            // It's a single object
            parsed.push({
              title:
                typeof parsedData.title === 'string' ? parsedData.title : '',
              link: parsedData.link,
            });
          }
        } catch (error) {
          console.error(
            'Failed to parse sponsorLinks JSON:',
            args.sponsorLinks,
            error,
          );
        }
      } else if (Array.isArray(args.sponsorLinks)) {
        // Array that might contain JSON strings or objects
        for (const item of args.sponsorLinks) {
          try {
            let linkObj: any;

            // If item is a string, parse it as JSON
            if (typeof item === 'string') {
              linkObj = JSON.parse(item);
            } else if (typeof item === 'object' && item !== null) {
              linkObj = item;
            } else {
              console.warn(
                'Invalid sponsor link item (unexpected type):',
                typeof item,
              );
              continue;
            }

            // Validate the parsed object
            if (typeof linkObj.link === 'string') {
              parsed.push({
                title: typeof linkObj.title === 'string' ? linkObj.title : '',
                link: linkObj.link,
              });
            } else {
              console.warn(
                'Invalid sponsor link item (link is not a string):',
                linkObj,
              );
            }
          } catch (error) {
            console.warn('Failed to parse sponsor link item:', item, error);
          }
        }
      } else {
        console.warn(
          'sponsorLinks is neither string nor array:',
          typeof args.sponsorLinks,
        );
      }

      this.sponsorLinks = parsed.length > 0 ? parsed : undefined;
    } else {
      this.sponsorLinks = undefined;
    }

    // Parse linked channels — accepts plain ID strings (role defaults to All)
    // or objects { id, role? } — supports JSON-encoded forms from multipart/form-data
    if (args.linkedChannelIds) {
      let items: any[] = [];

      if (typeof args.linkedChannelIds === 'string') {
        try {
          const p = JSON.parse(args.linkedChannelIds);
          items = Array.isArray(p) ? p : [p];
        } catch {
          items = [args.linkedChannelIds];
        }
      } else {
        items = (args.linkedChannelIds as any[]).flatMap((item) => {
          if (typeof item === 'string') {
            try {
              return [JSON.parse(item)];
            } catch {
              return [item];
            }
          }
          return [item];
        });
      }

      const result: Array<{ id: string; role: 'All' | 'Posting' | 'Subscription' }> = [];
      for (const item of items) {
        if (typeof item === 'string' || typeof item === 'number') {
          const id = String(item).replace(/^-/, '');
          if (/^\d+$/.test(id)) result.push({ id: String(item), role: 'All' });
        } else if (item && typeof item === 'object' && item.id) {
          const id = String(item.id).replace(/^-/, '');
          if (/^\d+$/.test(id)) {
            const role = (['All', 'Posting', 'Subscription'] as const).includes(item.role)
              ? (item.role as 'All' | 'Posting' | 'Subscription')
              : 'All';
            result.push({ id: String(item.id), role });
          }
        }
      }
      this.linkedChannels = result.length > 0 ? result : undefined;
    } else {
      this.linkedChannels = undefined;
    }

    // Parse prizes array — handles both a single JSON string and an array of
    // JSON strings (how multipart/form-data encodes repeated array fields)
    if (args.prizes) {
      if (typeof args.prizes === 'string') {
        try {
          const parsed = JSON.parse(args.prizes);
          this.prizes = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          this.prizes = undefined;
        }
      } else {
        this.prizes = (args.prizes as any[]).flatMap((item) => {
          if (typeof item === 'string') {
            try { return [JSON.parse(item)]; } catch { return []; }
          }
          return [item];
        }) as typeof this.prizes;
      }
    }
  }

  listPremiumFeatureFlags(): string[] {
    const flags: string[] = [];
    if (this.neededReferals > 0) flags.push('neededReferals');
    if (this.isOnlyPremium) flags.push('isOnlyPremium');
    if (this.isBoostNeeded) flags.push('isBoostNeeded');
    if (this.boostedId !== undefined) flags.push('boostedId');
    if (this.allowedGeoCountries !== '') flags.push('allowedGeoCountries');
    if (this.doApiSessionCheck) flags.push('doApiSessionCheck');
    if (this.isStaySubscribed) flags.push('isStaySubscribed');
    if (this.twinkBlock === true) flags.push('twinkBlock');
    return flags;
  }

  hasPremiumFeatures(): boolean {
    return this.listPremiumFeatureFlags().length > 0;
  }

  hasAdditionalTicketsConflict(): boolean {
    return (
      (this.refsPerTicket > 0 && this.neededReferals > 0) ||
      (this.boostsPerTicket > 0 && this.isBoostNeeded === true)
    );
  }
}

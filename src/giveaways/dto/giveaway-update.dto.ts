import { GiveawayStartType, GiveawayEndType, Currencies } from '@database';
import {
  parseParticipationButtonStyle,
  parseShowParticipationCount,
} from '../utils/participation-button.util';

// Update Giveaway DTO (from FormData - all strings, all optional)
export type UpdateGiveawayArgs = {
  description?: string;
  banner?: string[];
  participiationType?: string;
  completionType?: string;
  language?: string;
  maxParticipants?: string;
  winnerSlots?: string;
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

export class UpdateGiveawayDto {
  public readonly description?: string;
  public readonly banner?: string[];
  public readonly participiationType?: GiveawayStartType;
  public readonly completionType?: GiveawayEndType;
  public readonly language?: string;
  public readonly maxParticipants?: number;
  public readonly winnerSlots?: number;
  public readonly participiationPrice?: number;
  public readonly participiationCurr?: Currencies;
  public readonly startingAt?: Date;
  public readonly endingAt?: Date;
  public readonly numerifyWinners?: boolean;
  public readonly allowMultipleWinPlaces?: boolean;
  public readonly isResultsInMainPost?: boolean;
  public readonly isCommentsOn?: boolean;
  public readonly variant?: string;
  public readonly isPostingOn?: boolean; // Ads
  public readonly isNotificationOn?: boolean; // Ads
  public readonly twinkBlock?: boolean;

  // Premium features
  public readonly neededReferals?: number;
  public readonly isOnlyPremium?: boolean;
  public readonly isBoostNeeded?: boolean;
  public readonly boostedId?: bigint;
  public readonly allowedGeoCountries?: string;
  public readonly isCaptchaNeeded?: boolean;
  public readonly doApiSessionCheck?: boolean;
  public readonly isStaySubscribed?: boolean;
  public readonly participationButtonText?: string | null;
  public readonly participationButtonStyle?: string | null;
  public readonly showParticipationCount?: boolean;
  public readonly showParticipationMaxCount?: boolean;

  // Additional tickets via referrals & boosts
  public readonly canEarnAdditionalTickets?: boolean;
  public readonly countRefsOnParticipation?: boolean;
  public readonly refsPerTicket?: number;
  public readonly boostsPerTicket?: number;
  public readonly maxAdditionalTickets?: number;

  // Sponsors and channels
  public readonly sponsorLinks?: Array<{
    title: string;
    link: string;
  }>;
  public readonly linkedChannels?: Array<{ id: string; role: 'All' | 'Posting' | 'Subscription' }>;
  public readonly sponsorSlots?: number;
  public readonly starsPerSlot?: number;
  public readonly prizes?: Array<{ prizeId: number; winPlace?: number | null }>;

  constructor(args: UpdateGiveawayArgs) {
    // All fields are optional for update
    if (args.banner !== undefined) {
      this.banner = args.banner;
    }

    if (args.participiationType !== undefined) {
      if (
        !Object.values(GiveawayStartType).includes(
          args.participiationType as GiveawayStartType,
        )
      ) {
        throw new Error(
          `Invalid participiationType: ${args.participiationType}. Must be one of: ${Object.values(GiveawayStartType).join(', ')}`,
        );
      }
      this.participiationType = args.participiationType as GiveawayStartType;
    }

    if (args.completionType !== undefined) {
      if (
        !Object.values(GiveawayEndType).includes(
          args.completionType as GiveawayEndType,
        )
      ) {
        throw new Error(
          `Invalid completionType: ${args.completionType}. Must be one of: ${Object.values(GiveawayEndType).join(', ')}`,
        );
      }
      this.completionType = args.completionType as GiveawayEndType;
    }

    if (args.language !== undefined) {
      this.language = args.language;
    }

    if (args.winnerSlots !== undefined) {
      this.winnerSlots = parseInt(args.winnerSlots);
    }

    if (args.description !== undefined) {
      this.description = args.description;
    }

    if (args.maxParticipants !== undefined) {
      this.maxParticipants = parseInt(args.maxParticipants);
    }

    if (args.participiationPrice !== undefined) {
      this.participiationPrice = parseFloat(args.participiationPrice);
    }

    if (args.participiationCurr !== undefined) {
      this.participiationCurr = args.participiationCurr as Currencies;
    }

    if (args.startingAt !== undefined) {
      this.startingAt = new Date(args.startingAt);
    }

    if (args.endingAt !== undefined) {
      this.endingAt = new Date(args.endingAt);
    }

    // Premium features
    if (args.neededReferals !== undefined) {
      this.neededReferals = parseInt(args.neededReferals);
    }

    if (args.isOnlyPremium !== undefined) {
      this.isOnlyPremium = args.isOnlyPremium === 'true';
    }

    if (args.isBoostNeeded !== undefined) {
      this.isBoostNeeded = args.isBoostNeeded === 'true';
    }

    if (args.boostedId !== undefined) {
      this.boostedId = args.boostedId ? BigInt(args.boostedId) : undefined;
    }

    if (args.allowedGeoCountries !== undefined) {
      this.allowedGeoCountries = args.allowedGeoCountries;
    }

    if (args.isCaptchaNeeded !== undefined) {
      this.isCaptchaNeeded = args.isCaptchaNeeded === 'true';
    }

    if (args.doApiSessionCheck !== undefined) {
      this.doApiSessionCheck = args.doApiSessionCheck === 'true';
    }

    if (args.isStaySubscribed !== undefined) {
      this.isStaySubscribed = args.isStaySubscribed === 'true';
    }

    if (args.participationButtonText !== undefined) {
      const trimmed = String(args.participationButtonText).trim();
      this.participationButtonText = trimmed ? trimmed.slice(0, 40) : null;
    }

    const parsedStyle = parseParticipationButtonStyle(
      args.participationButtonStyle,
    );
    if (parsedStyle !== undefined) {
      this.participationButtonStyle = parsedStyle;
    }

    const parsedShowCount = parseShowParticipationCount(
      args.showParticipationCount,
    );
    if (parsedShowCount !== undefined) {
      this.showParticipationCount = parsedShowCount;
    }

    const parsedShowMax = parseShowParticipationCount(
      args.showParticipationMaxCount,
    );
    if (parsedShowMax !== undefined) {
      this.showParticipationMaxCount = parsedShowMax;
    }

    if (args.canEarnAdditionalTickets !== undefined) {
      this.canEarnAdditionalTickets = args.canEarnAdditionalTickets === 'true';
    }

    if (args.countRefsOnParticipation !== undefined) {
      this.countRefsOnParticipation = args.countRefsOnParticipation === 'true';
    }

    if (args.refsPerTicket !== undefined) {
      this.refsPerTicket = parseInt(args.refsPerTicket);
    }

    if (args.boostsPerTicket !== undefined) {
      this.boostsPerTicket = parseInt(args.boostsPerTicket);
    }

    if (args.maxAdditionalTickets !== undefined) {
      this.maxAdditionalTickets = parseInt(args.maxAdditionalTickets);
    }

    if (args.numerifyWinners !== undefined) {
      this.numerifyWinners = args.numerifyWinners === 'true';
    }
    if (args.allowMultipleWinPlaces !== undefined) {
      this.allowMultipleWinPlaces = args.allowMultipleWinPlaces === 'true';
    }

    if (args.isResultsInMainPost !== undefined) {
      this.isResultsInMainPost = args.isResultsInMainPost === 'true';
    }

    if (args.isCommentsOn !== undefined) {
      this.isCommentsOn = args.isCommentsOn === 'true';
    }

    if (args.variant !== undefined) {
      this.variant = args.variant;
    }

    if (args.isPostingOn !== undefined) {
      this.isPostingOn = args.isPostingOn === 'true';
    }

    if (args.isNotificationOn !== undefined) {
      this.isNotificationOn = args.isNotificationOn === 'true';
    }

    if (args.twinkBlock !== undefined) {
      this.twinkBlock = args.twinkBlock === 'true';
    }

    if (args.sponsorSlots !== undefined) {
      this.sponsorSlots = parseInt(args.sponsorSlots);
    }

    if (args.starsPerSlot !== undefined) {
      this.starsPerSlot = parseInt(args.starsPerSlot);
    }

    if (args.prizes !== undefined) {
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

    // Relations - parse JSON strings or handle already-parsed arrays
    if (args.sponsorLinks !== undefined) {
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
    }

    // Parse linked channels — accepts plain ID strings (role defaults to All)
    // or objects { id, role? } — supports JSON-encoded forms from multipart/form-data
    if (args.linkedChannelIds !== undefined) {
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
    }
  }

  listPremiumFeatureFlags(): string[] {
    const flags: string[] = [];
    if (this.neededReferals !== undefined && this.neededReferals > 0) {
      flags.push('neededReferals');
    }
    if (this.isOnlyPremium === true) flags.push('isOnlyPremium');
    if (this.isBoostNeeded === true) flags.push('isBoostNeeded');
    if (this.boostedId !== undefined) flags.push('boostedId');
    if (
      this.allowedGeoCountries !== undefined &&
      this.allowedGeoCountries !== ''
    ) {
      flags.push('allowedGeoCountries');
    }
    if (this.doApiSessionCheck === true) flags.push('doApiSessionCheck');
    if (this.isStaySubscribed === true) flags.push('isStaySubscribed');
    if (this.twinkBlock === true) flags.push('twinkBlock');
    return flags;
  }

  hasPremiumFeatures(): boolean {
    return this.listPremiumFeatureFlags().length > 0;
  }

  hasAdditionalTicketsConflict(): boolean {
    return (
      ((this.refsPerTicket ?? 0) > 0 && (this.neededReferals ?? 0) > 0) ||
      ((this.boostsPerTicket ?? 0) > 0 && this.isBoostNeeded === true)
    );
  }
}

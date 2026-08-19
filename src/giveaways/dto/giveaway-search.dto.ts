import { PaginateArgs, PaginateDto } from '@common/dto';
import { GiveawayStartType, GiveawayEndType, Currencies } from '@database';

export type GiveawaySearchArgs = PaginateArgs & {
  userCountry?: string;
  isActive?: boolean;
  isPlanned?: boolean;
  language?: string;
  participationType?: GiveawayStartType;
  completionType?: GiveawayEndType;
  isOnlyPremium?: boolean;
  currency?: Currencies;
  isMainPage?: boolean;
};

export class GiveawaySearchDto extends PaginateDto {
  public readonly userCountry?: string;
  public readonly isActive?: boolean;
  public readonly isPlanned?: boolean;
  public readonly language?: string;
  public readonly participationType?: GiveawayStartType;
  public readonly completionType?: GiveawayEndType;
  public readonly isOnlyPremium?: boolean;
  public readonly currency?: Currencies;
  public readonly isMainPage?: boolean;

  constructor(args: GiveawaySearchArgs) {
    super(args);
    this.userCountry = args.userCountry;
    this.isActive =
      args.isActive !== undefined
        ? String(args.isActive).toLowerCase() === 'true'
        : undefined;
    this.isPlanned =
      args.isPlanned !== undefined
        ? String(args.isPlanned).toLowerCase() === 'true'
        : undefined;
    this.language = args.language;

    // Validate and convert participationType enum
    if (args.participationType) {
      if (
        Object.values(GiveawayStartType).includes(
          args.participationType as GiveawayStartType,
        )
      ) {
        this.participationType = args.participationType as GiveawayStartType;
      } else {
        console.warn(`Invalid participationType: ${args.participationType}`);
        this.participationType = undefined;
      }
    }

    // Validate and convert completionType enum
    if (args.completionType) {
      if (
        Object.values(GiveawayEndType).includes(
          args.completionType as GiveawayEndType,
        )
      ) {
        this.completionType = args.completionType as GiveawayEndType;
      } else {
        console.warn(`Invalid completionType: ${args.completionType}`);
        this.completionType = undefined;
      }
    }

    this.isOnlyPremium =
      args.isOnlyPremium !== undefined
        ? String(args.isOnlyPremium).toLowerCase() === 'true'
        : undefined;

    // Validate and convert currency enum
    if (args.currency) {
      if (Object.values(Currencies).includes(args.currency as Currencies)) {
        this.currency = args.currency as Currencies;
      } else {
        console.warn(`Invalid currency: ${args.currency}`);
        this.currency = undefined;
      }
    }

    this.isMainPage =
      args.isMainPage !== undefined
        ? String(args.isMainPage).toLowerCase() === 'true'
        : undefined;
  }
}

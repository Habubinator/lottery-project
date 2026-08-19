import { Currencies, TransactionStatus } from '@database';

export interface PaymentLinkParams {
  userId: number;
  amount: number;
  currency: Currencies;
  description?: string;
  giveawayId?: string;
  tickets?: number;
}

export interface PaymentBody {
  userId: number;
  amount: number;
  currency: Currencies;
  p: 1 | 2 | 3 | 4 | 5; // 1 = deposit, 2 = lottery ticket, 3 = advertising, 4 = joint slot, 5 = NFT commission pre-pay
  pg?: string;   // giveaway ID (p=2, p=3, p=4)
  pt?: number;   // tickets count (p=2 only)
  ppa?: boolean; // isPostingOn flag (p=3 only)
  pna?: boolean; // isNotificationOn flag (p=3 only)
  pch?: string;  // channel ID as string (p=4 only)
  ppids?: number[]; // NFT prize IDs (p=5 only)
}

export interface HoldingStarsInfo {
  transactionId: string;
  userId: number;
  validWhen: Date;
  ammount: number;
  status: TransactionStatus;
  timeRemainingMs: number;
  isExpired: boolean;
  owner?: {
    id: number;
    username: string | null;
    first_name: string;
  };
}

export interface HoldProcessingResult {
  processed: number;
  successful: number;
  failed: number;
  details: Array<{
    success: boolean;
    holdId: number;
    amount?: number;
    error?: string;
  }>;
}

export interface WalletBalanceInfo {
  stars: number;
  holdedStars: number;
  ton: number;
}

export interface WalletStatsResponse {
  currentBalance: WalletBalanceInfo;
  totalDeposited: number;
  totalSpent: number;
  depositCount: number;
  withdrawalCount: number;
  pendingTransactions: number;
}

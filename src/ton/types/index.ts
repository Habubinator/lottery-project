import { InvoiceStatus, TonInvoice as PrismaTonInvoice } from '@prisma/client';

// Re-export Prisma TonInvoice type
export type TonInvoice = PrismaTonInvoice;

// Export invoice status type from Prisma
export { InvoiceStatus };

export interface TonPaymentDetails {
  invoiceId: string;
  walletAddress: string;
  amount: number;
  comment: string;
  tonscanLink: string;
  qrCode?: string;
}

export interface TonTransaction {
  hash: string;
  lt: string;
  from: string;
  to: string;
  value: number;
  comment?: string;
  timestamp: number;
}

export interface ProcessedPayment {
  invoiceId: string;
  userId: number;
  amount: number;
  transactionHash: string;
  tonscanLink: string;
  walletBalanceBefore: number;
  walletBalanceAfter: number;
}

export interface TonWalletConfig {
  address: string;
  mnemonics?: string[];
  apiEndpoint?: string;
  network?: 'mainnet' | 'testnet';
}

export interface CreateInvoiceDto {
  userId: number;
  amount: number;
  expirationMinutes?: number;
}

export interface InvoicePaymentResult {
  success: boolean;
  transactionId?: number;
  transactionHash?: string;
  tonscanLink?: string;
  error?: string;
  payment?: ProcessedPayment;
}

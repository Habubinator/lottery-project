import {
  Currencies,
  TransactionStatus,
  TransactionType,
  InvoiceStatus,
} from '@prisma/client';
import { prisma } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import {
  TonInvoice,
  TonPaymentDetails,
  TonTransaction,
  ProcessedPayment,
  CreateInvoiceDto,
  InvoicePaymentResult,
  TonWalletConfig,
} from '../types';
import { fetchWalletTransactions, verifyTransaction } from '../utils/ton-api';

export class TonService {
  private static instance: TonService;
  private walletAddress: string;
  private network: 'mainnet' | 'testnet';
  private apiEndpoint: string;
  private loggedSkippedHashes: Set<string> = new Set();

  private constructor(config?: TonWalletConfig) {
    this.walletAddress =
      config?.address || process.env.TON_WALLET_ADDRESS || '';
    this.network =
      config?.network ||
      (process.env.TON_NETWORK as 'mainnet' | 'testnet') ||
      'mainnet';
    this.apiEndpoint =
      config?.apiEndpoint ||
      process.env.TON_API_ENDPOINT ||
      'https://toncenter.com/api/v2/jsonRPC';

    if (!this.walletAddress) {
      throw new Error('TON wallet address is not configured');
    }
  }

  /**
   * Validate if a string is a valid UUID
   */
  private isValidUUID(str: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  public static getInstance(config?: TonWalletConfig): TonService {
    if (!TonService.instance) {
      TonService.instance = new TonService(config);
    }
    return TonService.instance;
  }

  /**
   * Create a new invoice for TON payment
   */
  public async createInvoice(
    dto: CreateInvoiceDto,
  ): Promise<TonPaymentDetails> {
    const { userId, amount, expirationMinutes = 30 } = dto;

    // Validate user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
    }

    // Validate amount
    if (amount <= 0) {
      throw HttpException.BadRequest(ErrorCodes.BadRequest, 'Invalid amount');
    }

    // Calculate expiration
    const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

    // Create invoice in database
    const invoice = await prisma.tonInvoice.create({
      data: {
        userId,
        amount,
        currency: Currencies.TON,
        status: InvoiceStatus.Pending,
        expiresAt,
      },
    });

    // Generate payment details
    const paymentDetails: TonPaymentDetails = {
      invoiceId: invoice.id,
      walletAddress: this.walletAddress,
      amount: invoice.amount,
      comment: invoice.id, // Invoice ID as comment for identification
      tonscanLink: this.generateTonscanLink('address', this.walletAddress),
    };

    console.log(
      `[TON Service] Invoice created: ${invoice.id} for user ${userId}, amount: ${amount} TON`,
    );

    return paymentDetails;
  }

  /**
   * Check for new transactions and process payments
   * This should be called periodically (e.g., via cron job)
   */
  public async processIncomingTransactions(): Promise<ProcessedPayment[]> {
    try {
      // First, mark expired invoices
      await this.markExpiredInvoices();

      // Get blockchain transactions
      const transactions = await this.getWalletTransactions();
      const processedPayments: ProcessedPayment[] = [];
      let skippedCount = 0;

      for (const tx of transactions) {
        // Check if transaction has a comment (invoice ID)
        if (!tx.comment) {
          continue;
        }

        // Validate that comment is a valid UUID before querying database
        // This prevents Prisma errors when transactions have non-UUID comments
        if (!this.isValidUUID(tx.comment)) {
          // Only log if we haven't seen this transaction before
          if (!this.loggedSkippedHashes.has(tx.hash)) {
            console.log(
              `[TON Service] Skipping transaction with non-UUID comment: "${tx.comment}" (hash: ${tx.hash})`,
            );
            this.loggedSkippedHashes.add(tx.hash);
          }
          skippedCount++;
          continue;
        }

        // Query invoice from database
        const invoice = await prisma.tonInvoice.findUnique({
          where: { id: tx.comment },
        });

        if (!invoice || invoice.status !== InvoiceStatus.Pending) {
          continue;
        }

        // Check if invoice is not expired
        if (new Date() > invoice.expiresAt) {
          await prisma.tonInvoice.update({
            where: { id: invoice.id },
            data: { status: InvoiceStatus.Expired },
          });
          continue;
        }

        // Verify transaction amount matches invoice
        if (tx.value < invoice.amount) {
          console.warn(
            `[TON Service] Transaction amount mismatch for invoice ${invoice.id}: expected ${invoice.amount}, got ${tx.value}`,
          );
          continue;
        }

        // Process payment
        const processedPayment = await this.processPayment(invoice, tx);
        processedPayments.push(processedPayment);
      }

      // Log summary if there were skipped transactions
      if (skippedCount > 0) {
        console.log(
          `[TON Service] Skipped ${skippedCount} transaction(s) with non-UUID comments (${this.loggedSkippedHashes.size} unique)`,
        );
      }

      return processedPayments;
    } catch (error) {
      console.error(
        '[TON Service] Error processing incoming transactions:',
        error,
      );
      throw error;
    }
  }

  /**
   * Process a single payment and update wallet
   */
  private async processPayment(
    invoice: TonInvoice,
    transaction: TonTransaction,
  ): Promise<ProcessedPayment> {
    const { userId, amount, id: invoiceId } = invoice;

    try {
      // Use Prisma transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Get user's wallet
        const wallet = await tx.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw HttpException.BadRequest(
            ErrorCodes.NotFound,
            'Wallet not found',
          );
        }

        const balanceBefore = wallet.tonBalance;
        const balanceAfter = balanceBefore + amount;

        // Update wallet balance
        await tx.wallet.update({
          where: { userId },
          data: {
            tonBalance: balanceAfter,
          },
        });

        // Create transaction history entry
        const transactionHistory = await tx.transactionHistory.create({
          data: {
            walletId: wallet.id,
            userId,
            type: TransactionType.Incoming,
            status: TransactionStatus.Completed,
            currency: Currencies.TON,
            value: Math.floor(amount * 1e9), // Convert TON to nanotons for Int storage
            balanceBefore,
            balanceAfter,
            additionalInfo: `TON invoice: ${invoiceId}`,
          },
        });

        // Mark invoice as completed
        await tx.tonInvoice.update({
          where: { id: invoiceId },
          data: {
            status: InvoiceStatus.Completed,
            processedAt: new Date(),
          },
        });

        return {
          transactionId: transactionHistory.id,
          balanceBefore,
          balanceAfter,
        };
      });

      const tonscanLink = this.generateTonscanLink(
        'transaction',
        transaction.hash,
      );

      console.log(
        `[TON Service] Payment processed: Invoice ${invoiceId}, User ${userId}, Amount ${amount} TON, TX: ${transaction.hash}`,
      );
      console.log(`[TON Service] Tonscan link: ${tonscanLink}`);

      const processedPayment: ProcessedPayment = {
        invoiceId,
        userId,
        amount,
        transactionHash: transaction.hash,
        tonscanLink,
        walletBalanceBefore: result.balanceBefore,
        walletBalanceAfter: result.balanceAfter,
      };

      return processedPayment;
    } catch (error) {
      console.error(
        `[TON Service] Error processing payment for invoice ${invoiceId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get wallet transactions from TON blockchain
   */
  private async getWalletTransactions(): Promise<TonTransaction[]> {
    try {
      const transactions = await fetchWalletTransactions(
        {
          endpoint: this.apiEndpoint,
          apiKey: process.env.TON_API_KEY,
          network: this.network,
        },
        this.walletAddress,
        50, // Using 50 to be conservative with lite server limits
      );

      return transactions;
    } catch (error: any) {
      // Log error message only (full error already logged in ton-api.ts)
      console.error(
        '[TON Service] Error fetching wallet transactions:',
        error?.message || error,
      );
      // Return empty array to prevent cron job from crashing
      return [];
    }
  }

  /**
   * Generate Tonscan explorer link
   */
  private generateTonscanLink(
    type: 'address' | 'transaction',
    identifier: string,
  ): string {
    const baseUrl =
      this.network === 'mainnet'
        ? 'https://tonscan.org'
        : 'https://testnet.tonscan.org';

    if (type === 'address') {
      return `${baseUrl}/address/${identifier}`;
    } else {
      return `${baseUrl}/tx/${identifier}`;
    }
  }

  /**
   * Mark expired invoices in database
   */
  private async markExpiredInvoices(): Promise<void> {
    try {
      await prisma.tonInvoice.updateMany({
        where: {
          status: InvoiceStatus.Pending,
          expiresAt: {
            lt: new Date(),
          },
        },
        data: {
          status: InvoiceStatus.Expired,
        },
      });
    } catch (error) {
      console.error('[TON Service] Error marking expired invoices:', error);
    }
  }

  /**
   * Get invoice status
   */
  public async getInvoiceStatus(invoiceId: string): Promise<TonInvoice | null> {
    try {
      // Validate invoice ID is a valid UUID
      if (!this.isValidUUID(invoiceId)) {
        console.warn(`[TON Service] Invalid invoice ID format: ${invoiceId}`);
        return null;
      }

      const invoice = await prisma.tonInvoice.findUnique({
        where: { id: invoiceId },
      });

      // Mark as expired if needed
      if (
        invoice &&
        invoice.status === InvoiceStatus.Pending &&
        new Date() > invoice.expiresAt
      ) {
        const updatedInvoice = await prisma.tonInvoice.update({
          where: { id: invoiceId },
          data: { status: InvoiceStatus.Expired },
        });
        return updatedInvoice;
      }

      return invoice;
    } catch (error) {
      console.error('[TON Service] Error getting invoice status:', error);
      return null;
    }
  }

  /**
   * Get all pending invoices for a user
   */
  public async getUserPendingInvoices(userId: number): Promise<TonInvoice[]> {
    try {
      const invoices = await prisma.tonInvoice.findMany({
        where: {
          userId,
          status: InvoiceStatus.Pending,
          expiresAt: {
            gt: new Date(), // Only return non-expired
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return invoices;
    } catch (error) {
      console.error('[TON Service] Error getting user invoices:', error);
      return [];
    }
  }

  /**
   * Cancel an invoice
   */
  public async cancelInvoice(invoiceId: string): Promise<boolean> {
    try {
      // Validate invoice ID is a valid UUID
      if (!this.isValidUUID(invoiceId)) {
        console.warn(`[TON Service] Invalid invoice ID format: ${invoiceId}`);
        return false;
      }

      const invoice = await prisma.tonInvoice.findUnique({
        where: { id: invoiceId },
      });

      if (invoice && invoice.status === InvoiceStatus.Pending) {
        await prisma.tonInvoice.update({
          where: { id: invoiceId },
          data: { status: InvoiceStatus.Cancelled },
        });
        return true;
      }

      return false;
    } catch (error) {
      console.error('[TON Service] Error cancelling invoice:', error);
      return false;
    }
  }

  /**
   * Get wallet address
   */
  public getWalletAddress(): string {
    return this.walletAddress;
  }

  /**
   * Get network
   */
  public getNetwork(): string {
    return this.network;
  }

  /**
   * Manually verify and process a specific transaction by hash
   * Useful for debugging or manual processing
   */
  public async verifyAndProcessTransaction(
    transactionHash: string,
    invoiceId: string,
  ): Promise<InvoicePaymentResult> {
    try {
      // Validate invoice ID is a valid UUID
      if (!this.isValidUUID(invoiceId)) {
        return {
          success: false,
          error: 'Invalid invoice ID format',
        };
      }

      const invoice = await prisma.tonInvoice.findUnique({
        where: { id: invoiceId },
      });

      if (!invoice) {
        return {
          success: false,
          error: 'Invoice not found',
        };
      }

      if (invoice.status !== InvoiceStatus.Pending) {
        return {
          success: false,
          error: `Invoice is ${invoice.status}`,
        };
      }

      // Verify transaction exists on blockchain
      const transaction = await verifyTransaction(
        {
          endpoint: this.apiEndpoint,
          apiKey: process.env.TON_API_KEY,
          network: this.network,
        },
        this.walletAddress,
        transactionHash,
      );

      if (!transaction) {
        return {
          success: false,
          error: 'Transaction not found on blockchain',
        };
      }

      // Check if transaction comment matches invoice ID
      if (transaction.comment !== invoiceId) {
        return {
          success: false,
          error: 'Transaction comment does not match invoice ID',
        };
      }

      // Check if amount matches
      if (transaction.value < invoice.amount) {
        return {
          success: false,
          error: `Insufficient payment amount. Expected ${invoice.amount} TON, received ${transaction.value} TON`,
        };
      }

      // Process the payment
      const processedPayment = await this.processPayment(invoice, transaction);

      return {
        success: true,
        payment: processedPayment,
      };
    } catch (error) {
      console.error('[TON Service] Error verifying transaction:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

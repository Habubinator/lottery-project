import {
  prisma,
  Currencies,
  TransactionStatus,
  TransactionType,
} from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import { createStarsPaymentLink, createTonPaymentLink } from '@bot/service';
import { PaymentBody, PaymentLinkParams } from '@wallet/types';
import { paginate } from '@common/pagination/pagination';
class WalletService {
  /**
   * Get user's wallet with balance information
   */
  async getUserWallet(userId: number) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      include: {
        transactionHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!wallet) {
      // Create wallet if it doesn't exist
      return await prisma.wallet.create({
        data: {
          userId,
          starsBalance: 0,
          holdedStarsBalance: 0,
          tonBalance: 0,
        },
        include: {
          transactionHistory: true,
        },
      });
    }

    return wallet;
  }

  /**
   * Create a payment link for wallet deposit
   */
  async createDepositPaymentLink(
    params: PaymentLinkParams,
  ): Promise<string | null> {
    const { userId, amount, currency, description } = params;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
    }

    if (amount <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Amount must be positive',
      );
    }

    const paymentBody: PaymentBody = {
      userId,
      amount,
      currency,
      p: 1,
    };

    const payload = JSON.stringify(paymentBody);
    const title = `Wallet Deposit - ${amount} ${currency}`;
    const desc = description || `Add ${amount} ${currency} to your wallet`;

    if (currency === Currencies.Stars) {
      return await createStarsPaymentLink(title, desc, amount, payload);
    } else if (currency === Currencies.TON) {
      const tonProviderToken = process.env.TON_PROVIDER_TOKEN;
      if (!tonProviderToken) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'TON payments not configured',
        );
      }
      return await createTonPaymentLink(
        title,
        desc,
        amount,
        payload,
        tonProviderToken,
      );
    }

    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Unsupported currency',
    );
  }

  //   /**
  //    * Create a payment link for giveaway entry
  //    */
  //   async createGiveawayPaymentLink(
  //     userId: number,
  //     giveawayId: string,
  //     tickets: number = 1,
  //   ): Promise<string | null> {
  //     // Get giveaway details
  //     const giveaway = await prisma.giveaway.findUnique({
  //       where: { id: giveawayId },
  //     });

  //     if (!giveaway) {
  //       throw HttpException.BadRequest(ErrorCodes.NotFound, 'Giveaway not found');
  //     }

  //     if (!giveaway.isActive) {
  //       throw HttpException.BadRequest(
  //         ErrorCodes.BadRequest,
  //         'Giveaway is not active',
  //       );
  //     }

  //     if (giveaway.participiationPrice <= 0) {
  //       throw HttpException.BadRequest(
  //         ErrorCodes.BadRequest,
  //         'This giveaway is free to join',
  //       );
  //     }

  //     const totalAmount = giveaway.participiationPrice * tickets;

  //     const paymentBody: PaymentBody = {
  //       userId,
  //       amount: totalAmount,
  //       currency: giveaway.participiationCurr,
  //       giveawayId,
  //       tickets,
  //       purpose: 'giveaway_entry',
  //     };

  //     const payload = JSON.stringify(paymentBody);
  //     const title = `Giveaway Entry - ${tickets} ticket${tickets > 1 ? 's' : ''}`;
  //     const desc = `Join giveaway: ${giveaway.description || 'Untitled'} (${tickets} tickets)`;

  //     if (giveaway.participiationCurr === Currencies.Stars) {
  //       return await createStarsPaymentLink(title, desc, totalAmount, payload);
  //     } else if (giveaway.participiationCurr === Currencies.TON) {
  //       const tonProviderToken = process.env.TON_PROVIDER_TOKEN;
  //       if (!tonProviderToken) {
  //         throw HttpException.BadRequest(
  //           ErrorCodes.BadRequest,
  //           'TON payments not configured',
  //         );
  //       }
  //       return await createTonPaymentLink(
  //         title,
  //         desc,
  //         totalAmount,
  //         payload,
  //         tonProviderToken,
  //       );
  //     }

  //     throw HttpException.BadRequest(
  //       ErrorCodes.BadRequest,
  //       'Unsupported currency',
  //     );
  //   }

  /**
   * Process successful payment and update wallet
   */
  async processSuccessfulPayment(
    paymentBody: PaymentBody,
    telegramPaymentChargeId: string,
    totalAmount: number,
  ) {
    return await prisma.$transaction(async (tx) => {
      // Ensure wallet exists
      const wallet = await tx.wallet.upsert({
        where: { userId: paymentBody.userId },
        create: {
          userId: paymentBody.userId,
          starsBalance: 0,
          holdedStarsBalance: 0,
          tonBalance: 0,
        },
        update: {},
      });

      const transactionStatus: TransactionStatus = TransactionStatus.Completed;
      const additionalInfo = `Payment via Telegram: ${telegramPaymentChargeId} (deposit)`;

      // Handle deposits - add directly to main balance
      const balanceField =
        paymentBody.currency === Currencies.Stars
          ? 'starsBalance'
          : 'tonBalance';

      const balanceBefore =
        paymentBody.currency === Currencies.Stars
          ? wallet.starsBalance
          : wallet.tonBalance;

      const updatedWallet = await tx.wallet.update({
        where: { userId: paymentBody.userId },
        data: {
          [balanceField]: { increment: paymentBody.amount },
        },
      });

      const balanceAfter =
        paymentBody.currency === Currencies.Stars
          ? updatedWallet.starsBalance
          : updatedWallet.tonBalance;

      // Create transaction record
      const transaction = await tx.transactionHistory.create({
        data: {
          walletId: wallet.id,
          userId: paymentBody.userId,
          type: TransactionType.Incoming,
          status: transactionStatus,
          currency: paymentBody.currency,
          value: totalAmount,
          balanceBefore,
          balanceAfter,
          telegramPaymentId: telegramPaymentChargeId,
          additionalInfo,
        },
      });

      return { wallet, transaction };
    });
  }

  /**
   * Process held Stars that are ready to be released (for cron job)
   */
  async processExpiredHolds() {
    const now = new Date();

    const expiredHolds = await prisma.holdingStars.findMany({
      where: {
        status: TransactionStatus.Pending,
        validWhen: {
          lte: now,
        },
      },
    });

    const results = [];

    for (const hold of expiredHolds) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          // Snapshot starsBalance BEFORE release
          const wallet = await tx.wallet.findFirst({
            where: { userId: hold.userId },
          });
          const balanceBefore = wallet?.starsBalance ?? 0;

          // Move Stars: holdedStarsBalance → starsBalance
          const updatedWallet = await tx.wallet.update({
            where: { userId: hold.userId },
            data: {
              holdedStarsBalance: { decrement: hold.ammount },
              starsBalance: { increment: hold.ammount },
            },
          });
          const balanceAfter = updatedWallet.starsBalance;

          // Mark this specific HoldingStars record as Completed (by id)
          await tx.holdingStars.update({
            where: { id: hold.id },
            data: { status: TransactionStatus.Completed },
          });

          // Find and mark original Pending hold-creation transaction as Completed
          const pendingTransaction = await tx.transactionHistory.findFirst({
            where: {
              userId: hold.userId,
              additionalInfo: { contains: hold.transactionId },
              status: TransactionStatus.Pending,
            },
          });

          if (pendingTransaction) {
            await tx.transactionHistory.update({
              where: { id: pendingTransaction.id },
              data: { status: TransactionStatus.Completed },
            });
          }

          // Create a new release transaction showing the starsBalance change
          await tx.transactionHistory.create({
            data: {
              walletId: wallet!.id,
              userId: hold.userId,
              type: TransactionType.Incoming,
              status: TransactionStatus.Completed,
              currency: Currencies.Stars,
              value: hold.ammount,
              balanceBefore,
              balanceAfter,
              additionalInfo: `Hold released | ${hold.transactionId}`,
            },
          });

          return { holdId: hold.id, userId: hold.userId, amount: hold.ammount };
        });

        results.push({ success: true, ...result });
      } catch (error) {
        results.push({
          success: false,
          holdId: hold.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      details: results,
    };
  }

  /**
   * Get user's transaction history
   */
  async getTransactionHistory(
    userId: number,
    page: number = 1,
    pageSize: number = 20,
  ) {
    return await paginate({
      modelName: 'TransactionHistory',
      where: { userId, value: { not: 0 } },
      orderBy: { createdAt: 'desc' },
      include: {
        wallet: true,
      },
      page,
      pageSize,
    });
  }

  /**
   * Get all transaction history (for admin use)
   */
  async getAllTransactionHistory(
    page: number = 1,
    pageSize: number = 20,
    currency?: Currencies,
    isExchange?: boolean,
    transactionId?: string,
  ) {
    const where: any = {};

    // Filter by transaction ID if provided
    if (transactionId) {
      where.id = transactionId;
    }

    // Filter by currency if provided
    if (currency) {
      where.currency = currency;
    }

    // Filter by exchange transactions if provided
    if (isExchange !== undefined) {
      if (isExchange) {
        // Only exchange transactions (additionalInfo starts with "Exchange:")
        where.additionalInfo = {
          startsWith: 'Exchange:',
        };
      } else {
        // Only non-exchange transactions
        where.OR = [
          { additionalInfo: null },
          {
            additionalInfo: {
              not: {
                startsWith: 'Exchange:',
              },
            },
          },
        ];
      }
    }

    return await paginate({
      modelName: 'TransactionHistory',
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        wallet: true,
        user: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            photo_url: true,
          },
        },
      },
      page,
      pageSize,
    });
  }

  /**
   * Get wallet statistics
   */
  async getWalletStats(userId: number) {
    const [wallet, totalDeposits, totalWithdrawals, pendingTransactions] =
      await Promise.all([
        this.getUserWallet(userId),
        prisma.transactionHistory.aggregate({
          where: {
            userId,
            type: TransactionType.Incoming,
            status: TransactionStatus.Completed,
          },
          _sum: { value: true },
          _count: true,
        }),
        prisma.transactionHistory.aggregate({
          where: {
            userId,
            type: TransactionType.Outcoming,
            status: TransactionStatus.Completed,
          },
          _sum: { value: true },
          _count: true,
        }),
        prisma.transactionHistory.count({
          where: {
            userId,
            status: TransactionStatus.Pending,
          },
        }),
      ]);

    return {
      currentBalance: {
        stars: wallet.starsBalance,
        holdedStars: wallet.holdedStarsBalance,
        ton: wallet.tonBalance,
      },
      totalDeposited: totalDeposits._sum.value || 0,
      totalSpent: totalWithdrawals._sum.value || 0,
      depositCount: totalDeposits._count,
      withdrawalCount: totalWithdrawals._count,
      pendingTransactions,
    };
  }

  /**
   * Get user's current holding status (all pending holds)
   */
  async getUserHoldingStatus(userId: number) {
    const holdingRecords = await prisma.holdingStars.findMany({
      where: {
        userId,
        status: TransactionStatus.Pending,
      },
      orderBy: { validWhen: 'asc' },
    });

    if (holdingRecords.length === 0) {
      return null;
    }

    const now = new Date();

    return holdingRecords.map((holdingRecord) => {
      const timeRemaining =
        holdingRecord.validWhen.getTime() - now.getTime();
      return {
        ...holdingRecord,
        timeRemainingMs: Math.max(0, timeRemaining),
        isExpired: timeRemaining <= 0,
      };
    });
  }
  /**
   * Process refund from Telegram (when bot receives refunded_payment message)
   */
  async processRefund(
    paymentBody: PaymentBody,
    telegramPaymentChargeId: string,
    totalAmount: number,
  ) {
    return await prisma.$transaction(async (tx) => {
      // Find the original successful transaction
      const originalTransaction = await tx.transactionHistory.findFirst({
        where: {
          telegramPaymentId: telegramPaymentChargeId,
          userId: paymentBody.userId,
          status: TransactionStatus.Completed,
          type: TransactionType.Incoming,
        },
        include: { wallet: true },
      });

      if (!originalTransaction) {
        throw new Error(
          `Original transaction not found for charge ID: ${telegramPaymentChargeId}`,
        );
      }

      // Remove funds from main balance
      const balanceField =
        paymentBody.currency === Currencies.Stars
          ? 'starsBalance'
          : 'tonBalance';

      const currentWallet = await tx.wallet.findUnique({
        where: { userId: paymentBody.userId },
      });

      const balanceBefore =
        paymentBody.currency === Currencies.Stars
          ? currentWallet.starsBalance
          : currentWallet.tonBalance;

      const updatedWalletT = await tx.wallet.update({
        where: { userId: paymentBody.userId },
        data: {
          [balanceField]: { decrement: paymentBody.amount },
        },
      });

      const balanceAfter =
        paymentBody.currency === Currencies.Stars
          ? updatedWalletT.starsBalance
          : updatedWalletT.tonBalance;

      // Update original transaction status to failed
      await tx.transactionHistory.update({
        where: { id: originalTransaction.id },
        data: {
          status: TransactionStatus.Failed,
          additionalInfo: `REFUNDED: ${telegramPaymentChargeId}`,
        },
      });

      // Create refund transaction record
      const refundTransaction = await tx.transactionHistory.create({
        data: {
          walletId: originalTransaction.walletId,
          userId: paymentBody.userId,
          type: TransactionType.Outcoming,
          status: TransactionStatus.Completed,
          currency: paymentBody.currency,
          value: totalAmount,
          balanceBefore,
          balanceAfter,
          telegramPaymentId: telegramPaymentChargeId,
          additionalInfo: `Refund for: ${telegramPaymentChargeId}`,
        },
      });

      // Get updated wallet info
      const updatedWallet = await tx.wallet.findUnique({
        where: { userId: paymentBody.userId },
      });

      return { wallet: updatedWallet, refundTransaction, originalTransaction };
    });
  }
}

export const walletService = new WalletService();

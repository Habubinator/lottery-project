import {
  prisma,
  Currencies,
  WithdrawalStatus,
  TransactionStatus,
  TransactionType,
} from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import { paginate } from '@common/pagination';
import { PaginateDto } from '@common/dto';
import type { PrismaTransaction } from '../types/prisma-transaction';

interface CreateWithdrawalDto {
  currency: Currencies;
  amount: number;
  notes?: string;
}

interface AdminWithdrawalActionDto {
  photos?: string[];
  notes?: string;
}

export async function userHasPendingWithdrawal(
  tx: PrismaTransaction,
  userId: number,
): Promise<boolean> {
  const pendingCount = await tx.withdrawal.count({
    where: {
      userId,
      status: WithdrawalStatus.Reviewed,
    },
  });
  return pendingCount > 0;
}

function buildWithdrawalNotes(
  notes: string,
  commissionPercent: number,
  commissionAmount: number,
  finalAmount: number,
  currency: Currencies,
): string {
  if (commissionAmount <= 0) return notes;
  return `${notes ? notes + '\n' : ''}Commission: ${commissionPercent}% (${commissionAmount.toFixed(2)} ${currency}). You will receive: ${finalAmount.toFixed(2)} ${currency}`;
}

export async function createTonWithdrawalInTx(
  tx: PrismaTransaction,
  userId: number,
  tonAmount: number,
  notes = '',
) {
  if (tonAmount <= 0) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Amount must be greater than 0',
    );
  }

  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { wallet: true },
  });

  if (!user) {
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Could not find user');
  }

  const wallet = user.wallet;
  if (!wallet) {
    throw HttpException.BadRequest(
      ErrorCodes.NotFound,
      'Could not find wallet',
    );
  }

  if (wallet.tonBalance < tonAmount) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Insufficient balance',
    );
  }

  const commissionConfig = await tx.withdrawalCommission.findFirst();
  const commissionPercent = commissionConfig?.tonPercent ?? 0;
  const commissionAmount = (tonAmount * commissionPercent) / 100;
  const finalAmount = tonAmount - commissionAmount;

  const withdrawal = await tx.withdrawal.create({
    data: {
      userId,
      walletId: wallet.id,
      currency: Currencies.TON,
      amount: tonAmount,
      notes: buildWithdrawalNotes(
        notes,
        commissionPercent,
        commissionAmount,
        finalAmount,
        Currencies.TON,
      ),
      status: WithdrawalStatus.Reviewed,
      photos: [],
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          first_name: true,
          last_name: true,
          photo_url: true,
        },
      },
      wallet: true,
    },
  });

  const balanceBefore = wallet.tonBalance;

  await tx.transactionHistory.create({
    data: {
      walletId: wallet.id,
      userId,
      type: TransactionType.Outcoming,
      status: TransactionStatus.Pending,
      currency: Currencies.TON,
      value: tonAmount,
      balanceBefore,
      balanceAfter: balanceBefore,
      additionalInfo:
        commissionAmount > 0
          ? `Withdrawal request: ${tonAmount} TON (Commission: ${commissionPercent}%, Final: ${finalAmount.toFixed(2)} TON)`
          : `Withdrawal request: ${tonAmount} TON`,
    },
  });

  return {
    withdrawal,
    commissionPercent,
    commissionAmount,
    tonNet: finalAmount,
  };
}

async function createCurrencyWithdrawalInTx(
  tx: PrismaTransaction,
  userId: number,
  currency: Currencies,
  amount: number,
  notes: string,
) {
  if (currency === Currencies.TON) {
    const result = await createTonWithdrawalInTx(tx, userId, amount, notes);
    return result.withdrawal;
  }

  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { wallet: true },
  });

  if (!user?.wallet) {
    throw HttpException.BadRequest(
      ErrorCodes.NotFound,
      'Could not find wallet',
    );
  }

  const wallet = user.wallet;
  if (wallet.starsBalance < amount) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Insufficient balance',
    );
  }

  const commissionConfig = await tx.withdrawalCommission.findFirst();
  const commissionPercent = commissionConfig?.starsPercent ?? 0;
  const commissionAmount = (amount * commissionPercent) / 100;
  const finalAmount = amount - commissionAmount;

  const withdrawal = await tx.withdrawal.create({
    data: {
      userId,
      walletId: wallet.id,
      currency,
      amount,
      notes: buildWithdrawalNotes(
        notes,
        commissionPercent,
        commissionAmount,
        finalAmount,
        currency,
      ),
      status: WithdrawalStatus.Reviewed,
      photos: [],
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          first_name: true,
          last_name: true,
          photo_url: true,
        },
      },
      wallet: true,
    },
  });

  const balanceBefore = wallet.starsBalance;

  await tx.transactionHistory.create({
    data: {
      walletId: wallet.id,
      userId,
      type: TransactionType.Outcoming,
      status: TransactionStatus.Pending,
      currency,
      value: amount,
      balanceBefore,
      balanceAfter: balanceBefore,
      additionalInfo:
        commissionAmount > 0
          ? `Withdrawal request: ${amount} ${currency} (Commission: ${commissionPercent}%, Final: ${finalAmount.toFixed(2)} ${currency})`
          : `Withdrawal request: ${amount} ${currency}`,
    },
  });

  return withdrawal;
}

class WithdrawalService {
  async createWithdrawal(userId: number, data: CreateWithdrawalDto) {
    const { currency, amount, notes = '' } = data;

    if (amount <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Amount must be greater than 0',
      );
    }

    return await prisma.$transaction(async (tx) => {
      const minTransactionValue = await tx.minTransactionValue.findFirst();
      const minAmount =
        currency === Currencies.Stars
          ? minTransactionValue?.stars ?? 0
          : typeof minTransactionValue?.ton === 'number'
            ? minTransactionValue.ton
            : minTransactionValue?.ton?.toNumber() ?? 0;

      if (amount < minAmount) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          `Minimum withdrawal amount for ${currency} is ${minAmount}`,
        );
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Could not find user',
        );
      }

      if (await userHasPendingWithdrawal(tx, userId)) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'You have pending withdrawal requests',
        );
      }

      return createCurrencyWithdrawalInTx(tx, userId, currency, amount, notes);
    });
  }

  async approveWithdrawal(
    withdrawalId: number,
    adminData?: AdminWithdrawalActionDto,
  ) {
    const { photos = [], notes } = adminData || {};

    return await prisma.$transaction(async (tx) => {
      // Find withdrawal request
      const withdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        include: {
          user: true,
          wallet: true,
        },
      });

      if (!withdrawal) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Could not find withdrawal request',
        );
      }

      if (withdrawal.status !== WithdrawalStatus.Reviewed) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Withdrawal request is already processed',
        );
      }

      // Check if user still has sufficient balance
      const availableBalance =
        withdrawal.currency === Currencies.Stars
          ? withdrawal.wallet.starsBalance
          : withdrawal.wallet.tonBalance;

      if (availableBalance < withdrawal.amount) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'User has insufficient balance',
        );
      }

      // Update wallet balance
      const newBalance =
        withdrawal.currency === Currencies.Stars
          ? { starsBalance: withdrawal.wallet.starsBalance - withdrawal.amount }
          : { tonBalance: withdrawal.wallet.tonBalance - withdrawal.amount };

      await tx.wallet.update({
        where: { id: withdrawal.walletId },
        data: newBalance,
      });

      // Update withdrawal status
      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: WithdrawalStatus.Accepted,
          photos,
          notes: notes || withdrawal.notes,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
          wallet: true,
        },
      });

      // Update transaction history
      await tx.transactionHistory.updateMany({
        where: {
          userId: withdrawal.userId,
          value: withdrawal.amount,
          status: TransactionStatus.Pending,
          additionalInfo: {
            contains: `Withdrawal request: ${withdrawal.amount} ${withdrawal.currency}`,
          },
        },
        data: {
          status: TransactionStatus.Completed,
          additionalInfo: `Withdrawal approved: ${withdrawal.amount} ${withdrawal.currency}`,
        },
      });

      return updatedWithdrawal;
    });
  }

  async rejectWithdrawal(
    withdrawalId: number,
    adminData?: AdminWithdrawalActionDto,
  ) {
    const { photos = [], notes } = adminData || {};

    return await prisma.$transaction(async (tx) => {
      // Find withdrawal request
      const withdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
          wallet: true,
        },
      });

      if (!withdrawal) {
        throw HttpException.BadRequest(
          ErrorCodes.NotFound,
          'Could not find withdrawal request',
        );
      }

      if (withdrawal.status !== WithdrawalStatus.Reviewed) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'Withdrawal request is already processed',
        );
      }

      // Update withdrawal status
      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: WithdrawalStatus.Denied,
          photos,
          notes: notes || withdrawal.notes,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              photo_url: true,
            },
          },
          wallet: true,
        },
      });

      // Update transaction history
      await tx.transactionHistory.updateMany({
        where: {
          userId: withdrawal.userId,
          value: withdrawal.amount,
          status: TransactionStatus.Pending,
          additionalInfo: {
            contains: `Withdrawal request: ${withdrawal.amount} ${withdrawal.currency}`,
          },
        },
        data: {
          status: TransactionStatus.Failed,
          additionalInfo: `Withdrawal rejected: ${withdrawal.amount} ${withdrawal.currency}`,
        },
      });

      return updatedWithdrawal;
    });
  }

  async getUserWithdrawals(userId: number, paginationArgs?: PaginateDto) {
    const pagination = new PaginateDto(
      paginationArgs || { page: 1, pageSize: 20 },
    );

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find user',
      );
    }

    return await paginate({
      page: pagination.page,
      pageSize: pagination.pageSize,
      modelName: 'Withdrawal',
      where: {
        userId,
      },
      include: {
        user: {
          include: {
            role: true,
            wallet: true,
            subscription: {
              include: {
                tariff: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getAllWithdrawals(
    status?: WithdrawalStatus,
    paginationArgs?: PaginateDto,
  ) {
    const pagination = new PaginateDto(
      paginationArgs || { page: 1, pageSize: 20 },
    );

    const whereCondition = status ? { status } : {};

    return await paginate({
      page: pagination.page,
      pageSize: pagination.pageSize,
      modelName: 'Withdrawal',
      where: whereCondition,
      include: {
        user: {
          include: {
            role: true,
            wallet: true,
            subscription: {
              include: {
                tariff: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getWithdrawal(withdrawalId: number) {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: {
        user: {
          include: {
            role: true,
            wallet: true,
            subscription: {
              include: {
                tariff: true,
              },
            },
          },
        },
        wallet: true,
      },
    });

    if (!withdrawal) {
      throw HttpException.BadRequest(
        ErrorCodes.NotFound,
        'Could not find withdrawal request',
      );
    }

    return withdrawal;
  }
}

export const withdrawalService = new WithdrawalService();

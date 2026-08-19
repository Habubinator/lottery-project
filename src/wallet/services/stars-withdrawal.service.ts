import { prisma, WithdrawalStatus } from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import { exchangeRateService } from '@admin';
import { exchangeStarsToTonInTx } from './exchange.service';
import {
  createTonWithdrawalInTx,
  userHasPendingWithdrawal,
} from './withdrawal.service';
import { floorTonAmount } from '../utils/ton-amount';

async function getMinTransactionLimits() {
  const minTransactionValue = await prisma.minTransactionValue.findFirst();
  return {
    minStars: minTransactionValue?.stars ?? 0,
    minTon:
      typeof minTransactionValue?.ton === 'number'
        ? minTransactionValue.ton
        : minTransactionValue?.ton?.toNumber() ?? 0,
  };
}

async function getTonCommissionPercent(): Promise<number> {
  const commissionConfig = await prisma.withdrawalCommission.findFirst();
  return commissionConfig?.tonPercent ?? 0;
}

export async function buildStarsWithdrawalQuote(starsAmount: number) {
  const tonGrossRaw = await exchangeRateService.convertStarsToTon(starsAmount);
  const tonGross = floorTonAmount(tonGrossRaw);
  const tonCommissionPercent = await getTonCommissionPercent();
  const tonCommissionAmount = floorTonAmount(
    (tonGross * tonCommissionPercent) / 100,
  );
  const tonNet = floorTonAmount(tonGross - tonCommissionAmount);
  const exchangeRate = await exchangeRateService.getExchangeRate();

  return {
    starsAmount,
    tonGross,
    tonCommissionPercent,
    tonCommissionAmount,
    tonNet,
    exchangeRate: {
      starsInput: exchangeRate.starsInput.toNumber(),
      tonOutput: exchangeRate.tonOutput.toNumber(),
    },
  };
}

class StarsWithdrawalService {
  async preview(userId: number, starsAmount: number) {
    if (!Number.isFinite(starsAmount) || starsAmount <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'starsAmount must be greater than 0',
      );
    }

    const normalizedStarsAmount = Math.floor(starsAmount);

    const [user, wallet, limits, hasPendingWithdrawal] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { tonAddress: true },
      }),
      prisma.wallet.findUnique({ where: { userId } }),
      getMinTransactionLimits(),
      prisma.withdrawal.count({
        where: { userId, status: WithdrawalStatus.Reviewed },
      }),
    ]);

    if (!user) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
    }

    const quote = await buildStarsWithdrawalQuote(normalizedStarsAmount);

    return {
      ...quote,
      starsBalance: wallet?.starsBalance ?? 0,
      tonBalance: wallet?.tonBalance ?? 0,
      tonAddress: user.tonAddress,
      minStars: limits.minStars,
      minTon: limits.minTon,
      hasPendingWithdrawal: hasPendingWithdrawal > 0,
      meetsMinStars: normalizedStarsAmount >= limits.minStars,
      meetsMinTon: quote.tonGross >= limits.minTon,
    };
  }

  async submit(userId: number, starsAmount: number, notes = '') {
    if (!Number.isFinite(starsAmount) || starsAmount <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'starsAmount must be greater than 0',
      );
    }

    const normalizedStarsAmount = Math.floor(starsAmount);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tonAddress: true },
    });

    if (!user) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'User not found');
    }

    if (!user.tonAddress) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'TON wallet address is required before withdrawing Stars',
      );
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw HttpException.BadRequest(ErrorCodes.NotFound, 'Wallet not found');
    }

    if (wallet.starsBalance < normalizedStarsAmount) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Insufficient Stars balance',
      );
    }

    const limits = await getMinTransactionLimits();
    if (normalizedStarsAmount < limits.minStars) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        `Minimum withdrawal amount for Stars is ${limits.minStars}`,
      );
    }

    const quote = await buildStarsWithdrawalQuote(normalizedStarsAmount);
    if (quote.tonGross < limits.minTon) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        `Converted TON amount must be at least ${limits.minTon}`,
      );
    }

    return await prisma.$transaction(async (tx) => {
      if (await userHasPendingWithdrawal(tx, userId)) {
        throw HttpException.BadRequest(
          ErrorCodes.BadRequest,
          'You have pending withdrawal requests',
        );
      }

      const exchangeResult = await exchangeStarsToTonInTx(
        tx,
        userId,
        normalizedStarsAmount,
      );

      const withdrawalNotes = [
        `TON wallet: ${user.tonAddress}`,
        notes,
      ]
        .filter(Boolean)
        .join('\n');

      const withdrawalResult = await createTonWithdrawalInTx(
        tx,
        userId,
        exchangeResult.tonGross,
        withdrawalNotes,
      );

      return {
        exchange: {
          starsDebited: exchangeResult.starsDebited,
          tonGross: exchangeResult.tonGross,
        },
        withdrawal: withdrawalResult.withdrawal,
        quote: {
          tonNet: floorTonAmount(withdrawalResult.tonNet),
          tonCommissionAmount: floorTonAmount(
            withdrawalResult.commissionAmount,
          ),
          tonCommissionPercent: withdrawalResult.commissionPercent,
        },
      };
    });
  }
}

export const starsWithdrawalService = new StarsWithdrawalService();

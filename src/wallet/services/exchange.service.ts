import {
  prisma,
  Currencies,
  TransactionType,
  TransactionStatus,
} from '@database';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';
import { exchangeRateService } from '@admin';
import type { PrismaTransaction } from '../types/prisma-transaction';
import { floorTonAmount } from '../utils/ton-amount';

interface ExchangeRequestDto {
  fromCurrency: Currencies;
  toCurrency: Currencies;
  amount: number;
}

export async function exchangeStarsToTonInTx(
  tx: PrismaTransaction,
  userId: number,
  starsAmount: number,
) {
  const wallet = await tx.wallet.findUnique({
    where: { userId },
  });

  if (!wallet) {
    throw HttpException.BadRequest(ErrorCodes.NotFound, 'Wallet not found');
  }

  if (wallet.starsBalance < starsAmount) {
    throw HttpException.BadRequest(
      ErrorCodes.BadRequest,
      'Insufficient Stars balance',
    );
  }

  const tonGross = floorTonAmount(
    await exchangeRateService.convertStarsToTon(starsAmount),
  );

  const starsBalanceBefore = wallet.starsBalance;
  const tonBalanceBefore = wallet.tonBalance;

  const updatedWallet = await tx.wallet.update({
    where: { userId },
    data: {
      starsBalance: { decrement: starsAmount },
      tonBalance: { increment: tonGross },
    },
  });

  await tx.transactionHistory.create({
    data: {
      walletId: wallet.id,
      userId,
      type: TransactionType.Outcoming,
      status: TransactionStatus.Completed,
      currency: Currencies.Stars,
      value: starsAmount,
      balanceBefore: starsBalanceBefore,
      balanceAfter: updatedWallet.starsBalance,
      additionalInfo: `Exchange: ${starsAmount} Stars → ${tonGross.toFixed(8)} TON`,
    },
  });

  await tx.transactionHistory.create({
    data: {
      walletId: wallet.id,
      userId,
      type: TransactionType.Incoming,
      status: TransactionStatus.Completed,
      currency: Currencies.TON,
      value: Math.round(tonGross),
      balanceBefore: tonBalanceBefore,
      balanceAfter: updatedWallet.tonBalance,
      additionalInfo: `Exchange: ${starsAmount} Stars → ${tonGross.toFixed(8)} TON`,
    },
  });

  return {
    wallet: updatedWallet,
    tonGross,
    starsDebited: starsAmount,
  };
}

class ExchangeService {
  /**
   * Exchange Stars to TON or TON to Stars
   */
  async exchangeCurrency(userId: number, data: ExchangeRequestDto) {
    const { fromCurrency, toCurrency, amount } = data;

    if (amount <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Amount must be greater than 0',
      );
    }

    if (fromCurrency === toCurrency) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Cannot exchange to the same currency',
      );
    }

    if (
      (fromCurrency !== Currencies.Stars && fromCurrency !== Currencies.TON) ||
      (toCurrency !== Currencies.Stars && toCurrency !== Currencies.TON)
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Invalid currency. Only Stars and TON are supported',
      );
    }

    if (fromCurrency !== Currencies.Stars || toCurrency !== Currencies.TON) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Exchange is only allowed from Stars to TON',
      );
    }

    return await prisma.$transaction(async (tx) => {
      const result = await exchangeStarsToTonInTx(tx, userId, amount);

      return {
        wallet: result.wallet,
        exchanged: {
          from: {
            currency: Currencies.Stars,
            amount,
          },
          to: {
            currency: Currencies.TON,
            amount: result.tonGross,
          },
        },
      };
    });
  }

  /**
   * Calculate exchange rate preview without executing the exchange
   */
  async previewExchange(data: ExchangeRequestDto) {
    const { fromCurrency, toCurrency, amount } = data;

    if (amount <= 0) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Amount must be greater than 0',
      );
    }

    if (fromCurrency === toCurrency) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Cannot exchange to the same currency',
      );
    }

    if (
      (fromCurrency !== Currencies.Stars && fromCurrency !== Currencies.TON) ||
      (toCurrency !== Currencies.Stars && toCurrency !== Currencies.TON)
    ) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Invalid currency. Only Stars and TON are supported',
      );
    }

    if (fromCurrency !== Currencies.Stars || toCurrency !== Currencies.TON) {
      throw HttpException.BadRequest(
        ErrorCodes.BadRequest,
        'Exchange preview is only available for Stars to TON',
      );
    }

    const exchangeRate = await exchangeRateService.getExchangeRate();

    const convertedAmount = await exchangeRateService.convertStarsToTon(amount);

    return {
      from: {
        currency: fromCurrency,
        amount,
      },
      to: {
        currency: toCurrency,
        amount: convertedAmount,
      },
      rate: {
        starsInput: exchangeRate.starsInput.toNumber(),
        tonOutput: exchangeRate.tonOutput.toNumber(),
      },
    };
  }
}

export const exchangeService = new ExchangeService();

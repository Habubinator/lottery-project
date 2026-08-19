// eslint-disable-next-line @typescript-eslint/no-require-imports
require('buffer');
import { TonClient, Address } from '@ton/ton';
import { TonTransaction } from '../types';

interface TonCenterConfig {
  endpoint: string;
  apiKey?: string;
  network: 'mainnet' | 'testnet';
}

function createTonClient(config: TonCenterConfig): TonClient {
  return new TonClient({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
  });
}

export async function fetchWalletTransactions(
  config: TonCenterConfig,
  address: string,
  limit: number = 50,
  maxRetries: number = 3,
): Promise<TonTransaction[]> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = createTonClient(config);
      const tonAddress = Address.parse(address);

      // Fetch transactions from blockchain
      // Note: archival: true ensures we can query historical transactions
      // without hitting "lt not in db" errors on non-archival lite servers
      const transactions = await client.getTransactions(tonAddress, {
        limit,
        archival: true,
      });

      // Parse and filter incoming transactions
      const parsedTransactions: TonTransaction[] = [];

      for (const tx of transactions) {
        // Only process incoming transactions
        if (!tx.inMessage) continue;

        const inMsg = tx.inMessage;
        if (inMsg.info.type !== 'internal') continue;

        // Get sender address
        const from = inMsg.info.src?.toString() || '';

        // Get value in TON (convert from nanotons)
        const value = Number(inMsg.info.value.coins) / 1e9;

        if (value <= 0) continue;

        // Extract comment from message body
        const comment = extractCommentFromCell(inMsg.body);

        parsedTransactions.push({
          hash: tx.hash().toString('hex'),
          lt: tx.lt.toString(),
          from,
          to: address,
          value,
          comment,
          timestamp: tx.now,
        });
      }

      // Success - return parsed transactions
      if (attempt > 1) {
        console.log(`[TON API] Successfully fetched transactions on attempt ${attempt}`);
      }
      return parsedTransactions;
    } catch (error: any) {
      lastError = error;

      // Handle wallet with no transactions (uninitialized or new wallet)
      // This is expected behavior and not an actual error
      if (
        error?.message?.includes('LITE_SERVER_UNKNOWN') ||
        error?.message?.includes('cannot locate transaction') ||
        error?.message?.includes('cannot compute block') ||
        error?.message?.includes('cannot find block') ||
        error?.message?.includes('lt not in db')
      ) {
        console.log(
          `[TON API] Lite server issue (attempt ${attempt}/${maxRetries}): ${error.message?.substring(0, 150)}`,
        );

        // If this is the last retry, return empty array instead of throwing
        if (attempt === maxRetries) {
          console.log(
            '[TON API] Returning empty transactions array after all retries - wallet may be uninitialized or lite server is temporarily unavailable',
          );
          return [];
        }

        // Wait before retrying (exponential backoff)
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`[TON API] Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      // For other errors, retry with backoff
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.warn(
          `[TON API] Error fetching transactions (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms:`,
          error?.message || error,
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      // Last attempt failed
      console.error('[TON API] Error fetching transactions after all retries:', error);
      throw error;
    }
  }

  // Should not reach here, but just in case
  throw lastError;
}

function extractCommentFromCell(cell: any): string | undefined {
  try {
    if (!cell) return undefined;

    // Read cell as slice
    const slice = cell.beginParse();

    // Check if this is a text comment (opcode 0x00000000)
    if (slice.remainingBits < 32) return undefined;

    const op = slice.loadUint(32);
    if (op !== 0) return undefined; // Not a text comment

    // Read the text
    if (slice.remainingBits === 0) return undefined;

    const text = slice.loadStringTail();
    return text || undefined;
  } catch (error) {
    console.error('[TON API] Error extracting comment:', error);
    return undefined;
  }
}

export async function getAccountInfo(config: TonCenterConfig, address: string) {
  try {
    const client = createTonClient(config);
    const tonAddress = Address.parse(address);

    const state = await client.getContractState(tonAddress);

    return {
      balance: Number(state.balance) / 1e9, // Convert to TON
      state: state.state,
      lastTransactionId: state.lastTransaction
        ? {
            lt: state.lastTransaction.lt.toString(),
            hash: Buffer.from(state.lastTransaction.hash).toString('hex'),
          }
        : null,
    };
  } catch (error) {
    console.error('[TON API] Error fetching account info:', error);
    throw error;
  }
}

export async function verifyTransaction(
  config: TonCenterConfig,
  address: string,
  transactionHash: string,
): Promise<TonTransaction | null> {
  try {
    const transactions = await fetchWalletTransactions(config, address, 100);
    return transactions.find((tx) => tx.hash === transactionHash) || null;
  } catch (error) {
    console.error('[TON API] Error verifying transaction:', error);
    return null;
  }
}

export async function getTonPrice(currency: string = 'USD'): Promise<number> {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=${currency.toLowerCase()}`,
    );
    const data = await response.json();
    return data['the-open-network'][currency.toLowerCase()] || 0;
  } catch (error) {
    console.error('[TON API] Error fetching TON price:', error);
    return 0;
  }
}

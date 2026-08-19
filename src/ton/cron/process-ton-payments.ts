import cron from 'node-cron';
import { TonService } from '../services/ton.service';

/**
 * Cron job to process incoming TON payments
 * Runs every 2 minutes to check for new transactions
 */
export function startTonPaymentProcessing() {
  const tonService = TonService.getInstance();

  // Run every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      console.log('[TON Cron] Starting payment processing...');

      const processedPayments = await tonService.processIncomingTransactions();

      if (processedPayments.length > 0) {
        console.log(`[TON Cron] Processed ${processedPayments.length} payments:`);
        processedPayments.forEach((payment) => {
          console.log(
            `  - Invoice: ${payment.invoiceId}, User: ${payment.userId}, Amount: ${payment.amount} TON`
          );
          console.log(`    Tonscan: ${payment.tonscanLink}`);
        });
      } else {
        console.log('[TON Cron] No new payments to process');
      }
    } catch (error) {
      console.error('[TON Cron] Error processing payments:', error);
    }
  });

  console.log('[TON Cron] Payment processing cron job started (runs every 2 minutes)');
}

/**
 * Alternative: Process payments on-demand
 * Can be called manually or triggered by webhooks
 */
export async function processPaymentsNow(): Promise<void> {
  const tonService = TonService.getInstance();

  try {
    console.log('[TON] Processing payments on-demand...');
    const processedPayments = await tonService.processIncomingTransactions();

    console.log(`[TON] Processed ${processedPayments.length} payments`);
  } catch (error) {
    console.error('[TON] Error processing payments on-demand:', error);
    throw error;
  }
}

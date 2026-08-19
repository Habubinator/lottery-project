import './config';
import { cronService } from '@cron';
import { startTonPaymentProcessing } from '@ton';
import { fragmentStarsRateService } from '@admin/services/fragment-stars-rate.service';

BigInt.prototype['toJSON'] = function () {
  return this.toString();
};

const bootstrap = async () => {
  console.log('Starting cron service...');

  // Start all cron jobs
  cronService.start();

  // Start TON payment processing cron job
  startTonPaymentProcessing();

  if (process.env.FRAGMENT_EXCHANGE_RATE_SYNC_ENABLED !== 'false') {
    void fragmentStarsRateService
      .syncExchangeRateFromFragment()
      .then(({ starsInput, tonOutput }) => {
        console.log(
          `[Fragment] Initial exchange rate sync: ${starsInput} Stars = ${tonOutput} TON`,
        );
      })
      .catch((error) => {
        console.error('[Fragment] Initial exchange rate sync failed:', error);
      });
  }

  console.log('Cron service started successfully');
  console.log('Job status:', cronService.getStatus());
};

bootstrap()
  .then(() => console.log('Cron service initialized'))
  .catch((e) => {
    console.error('Failed to initialize cron service:', e);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, stopping cron jobs...');
  cronService.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, stopping cron jobs...');
  cronService.stop();
  process.exit(0);
});

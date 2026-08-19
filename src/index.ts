import './config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { mw } from 'request-ip';
import morgan from 'morgan';
import { PORT } from '@common/constants';
import { authRouter } from '@auth/routes';
import { csrfRouter } from '@csrf/routes';
import { permissionsRouter } from '@permissions/routes';
import { mailListener } from '@mail';
import { useSwagger } from '@swagger';
import { errorHandler } from '@common/middlewares';
import { i18n } from '@common/locales';
import { usersRouter } from '@users';
import { giveawaysRouter, prizesStandaloneRouter } from '@giveaways';
import { prizeService } from '@giveaways/services';
import { walletRouter, withdrawalRouter } from '@wallet';
import { subscriptionRouter } from '@subscriptions';
import {
  minTransactionValueRouter,
  minTransactionValueService,
  withdrawalCommissionRouter,
  withdrawalCommissionService,
  exchangeRateRouter,
  exchangeRateService,
  advertisingPriceRouter,
  advertisingPriceService,
  giftClaimCommissionRouter,
  giftClaimCommissionService,
  paymentCommissionSettingsRouter,
  paymentCommissionSettingsService,
  userbotSessionService,
} from '@admin';
import { tonRouter } from '@ton';
import { templateRouter } from '@templates';
import { sponsorLinkRouter } from '@sponsors';
import { telegramGiftRouter, telegramGiftService } from '@telegram-gifts';
import { statsRouter } from '@stats';
import { userbotAdminRouter, giftQueue } from '@userbot';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { auth, roles } from '@auth/middlewares';
import { Roles } from '@auth/enums';

BigInt.prototype['toJSON'] = function () {
  return this.toString();
};

const bootstrap = async () => {
  const app = express();

  app.use(
    cors({
      origin: process.env.CORS_ORIGINS.split(','),
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(helmet());
  app.use(helmet.hidePoweredBy());
  app.use(helmet.contentSecurityPolicy());

  app.use(i18n.init);

  app.use(mw());
  app.use(morgan('combined'));

  // Serve static files (giveaways, gifts, etc.)
  app.use('/static', express.static(process.env.MULTER_DEST!));

  app.use('/api/auth', authRouter);
  app.use('/api/csrf', csrfRouter);
  app.use('/api/permissions', permissionsRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/giveaways', giveawaysRouter);
  app.use('/api/prizes', prizesStandaloneRouter);
  app.use('/api/withdrawal', withdrawalRouter);
  app.use('/api/subscriptions', subscriptionRouter);
  app.use('/api/admin/min-transaction-value', minTransactionValueRouter);
  app.use('/api/admin/withdrawal-commission', withdrawalCommissionRouter);
  app.use('/api/admin/exchange-rate', exchangeRateRouter);
  app.use('/api/admin/advertising-price', advertisingPriceRouter);
  app.use('/api/admin/gift-claim-commission', giftClaimCommissionRouter);
  app.use(
    '/api/admin/payment-commission-settings',
    paymentCommissionSettingsRouter,
  );
  app.use('/api/admin/userbot', userbotAdminRouter);

  app.use('/api/ton', tonRouter);
  app.use('/api/templates', templateRouter);
  app.use('/api/sponsors', sponsorLinkRouter);
  app.use('/api/telegram-gifts', telegramGiftRouter);
  app.use('/api/stats', statsRouter);

  const bullAdapter = new ExpressAdapter();
  bullAdapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(giftQueue)],
    serverAdapter: bullAdapter,
  });
  app.use(
    '/admin/queues',
    auth,
    roles(Roles.SuperAdmin, Roles.Admin),
    bullAdapter.getRouter(),
  );

  useSwagger('/api/docs', app);

  app.use(errorHandler);

  app.listen(PORT, async () => {
    mailListener.initialize();
    // Config default states init
    await minTransactionValueService.initialize();
    await withdrawalCommissionService.initialize();
    await exchangeRateService.initialize();
    await advertisingPriceService.initialize();
    await giftClaimCommissionService.initialize();
    await paymentCommissionSettingsService.initialize();
    await userbotSessionService.initialize();

    // Initialize Telegram gift images (non-blocking)
    telegramGiftService.initializeGiftImages().catch((error) => {
      console.error('[App] Failed to initialize gift images:', error);
    });
    // Defer so userbot-worker is connected before sticker download jobs run.
    setTimeout(() => {
      prizeService.backfillMissingPrizeStickerImages().catch((error) => {
        console.error('[App] Failed to backfill prize sticker images:', error);
      });
    }, 30_000);

    console.log(`Server started on PORT: ${PORT}`);
  });
};

bootstrap()
  .then(() => console.log('App initialized'))
  .catch((e) => console.error(e));

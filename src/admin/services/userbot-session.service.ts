import { prisma } from '@database';

type AccountType = 'Standard' | 'Unique';

const ACCOUNTS: { accountType: AccountType; envKey: string }[] = [
  { accountType: 'Standard', envKey: 'BUSINESS_ACCOUNT_STANDARD_ID' },
  { accountType: 'Unique', envKey: 'BUSINESS_ACCOUNT_UNIQUE_ID' },
];

class UserbotSessionService {
  /**
   * Ensure UserbotSession rows exist for Standard and Unique accounts.
   * Does not overwrite existing session or phone on restart.
   */
  async initialize() {
    if (process.env.GIFT_PROVIDER !== 'userbot') {
      return;
    }

    try {
      for (const { accountType, envKey } of ACCOUNTS) {
        const telegramId = process.env[envKey];
        if (!telegramId) {
          console.warn(
            `[UserbotSession] ${envKey} is not set — skipping ${accountType} row bootstrap`,
          );
          continue;
        }

        await prisma.userbotSession.upsert({
          where: { accountType },
          create: {
            accountType,
            telegramId,
            phoneNumber: '',
            session: '',
            status: 'needs_reauth',
          },
          update: {},
        });
        console.log(`[UserbotSession] ${accountType} session row ready (telegramId=${telegramId})`);
      }
    } catch (error) {
      console.error('[UserbotSession] Error initializing:', error);
      throw error;
    }
  }
}

export const userbotSessionService = new UserbotSessionService();

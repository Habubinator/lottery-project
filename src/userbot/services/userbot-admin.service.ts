import { prisma } from '@database';
import { authQueue, authQueueEvents } from '../auth-queue';
import { getAuthState } from '../auth-state';

class UserbotAdminService {
  private async runAuthJob(
    jobType: 'start' | 'confirm' | '2fa' | 'reconnect',
    accountType: 'Standard' | 'Unique',
    extra?: { code?: string; password?: string },
  ) {
    const job = await authQueue.add(jobType, {
      jobType,
      accountType,
      ...extra,
    });
    const result = await job.waitUntilFinished(authQueueEvents, 60_000);
    if (!result.success && result.error) {
      throw new Error(result.error);
    }
    return result;
  }

  async updatePhone(accountType: 'Standard' | 'Unique', phoneNumber: string) {
    return prisma.userbotSession.update({
      where: { accountType },
      data: { phoneNumber },
      select: { accountType: true, phoneNumber: true, status: true, updatedAt: true },
    });
  }

  async getStatus() {
    const [standard, unique, standardAuth, uniqueAuth] = await Promise.all([
      prisma.userbotSession.findUnique({ where: { accountType: 'Standard' } }),
      prisma.userbotSession.findUnique({ where: { accountType: 'Unique' } }),
      getAuthState('Standard'),
      getAuthState('Unique'),
    ]);

    return {
      standard: {
        status: standard?.status ?? 'not_configured',
        authState: standardAuth.status,
        updatedAt: standard?.updatedAt,
      },
      unique: {
        status: unique?.status ?? 'not_configured',
        authState: uniqueAuth.status,
        updatedAt: unique?.updatedAt,
      },
    };
  }

  async startAuth(accountType: 'Standard' | 'Unique') {
    await this.runAuthJob('start', accountType);
  }

  async confirmCode(
    accountType: 'Standard' | 'Unique',
    code: string,
  ): Promise<{ requires2FA: boolean }> {
    const result = await this.runAuthJob('confirm', accountType, { code });
    return { requires2FA: !!result.requires2FA };
  }

  async submit2FA(accountType: 'Standard' | 'Unique', password: string) {
    await this.runAuthJob('2fa', accountType, { password });
  }
}

export const userbotAdminService = new UserbotAdminService();

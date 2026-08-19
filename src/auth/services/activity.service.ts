import { prisma } from '@database';

class ActivityService {
  async log(userId: number, ip: string) {
    await prisma.userActivity.upsert({
      where: { userId_ip: { userId, ip } },
      create: { userId, ip },
      update: { lastActivityAt: new Date() },
    });
  }
}

export const activityService = new ActivityService();

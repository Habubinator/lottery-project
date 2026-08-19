import { prisma } from '@database';

class SubscriptionService {
  async getAllTariffs() {
    const tariffs = await prisma.tariff.findMany({
      orderBy: {
        price: 'asc',
      },
    });

    return tariffs;
  }

  async getUserSubscription(userId: number) {
    const subscription = await prisma.subscribers.findFirst({
      where: {
        userId,
      },
      include: {
        tariff: true,
      },
    });

    return subscription;
  }
}

export const subscriptionService = new SubscriptionService();

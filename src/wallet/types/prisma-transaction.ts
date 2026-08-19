import { prisma } from '@database';

export type PrismaTransaction = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

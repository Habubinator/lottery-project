import { Queue, QueueEvents } from 'bullmq';

export type AuthJobType = 'start' | 'confirm' | '2fa' | 'reconnect';

export interface AuthJobData {
  jobType: AuthJobType;
  accountType: 'Standard' | 'Unique';
  code?: string;
  password?: string;
}

export interface AuthJobResult {
  success: boolean;
  requires2FA?: boolean;
  error?: string;
}

export const AUTH_QUEUE_NAME = 'userbot-auth';

const redisConnection = { url: process.env.REDIS_URL };

export const authQueue = new Queue<AuthJobData, AuthJobResult>(AUTH_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const authQueueEvents = new QueueEvents(AUTH_QUEUE_NAME, {
  connection: redisConnection,
});

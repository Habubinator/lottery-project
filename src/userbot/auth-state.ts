import IORedis from 'ioredis';

const AUTH_KEY_PREFIX = 'userbot:auth:';
const AUTH_TTL_SEC = 600;

export type RedisAuthState =
  | { status: 'idle' }
  | { status: 'waiting_code'; phone: string; phoneCodeHash: string }
  | { status: 'waiting_password'; phone: string; phoneCodeHash: string };

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  }
  return redis;
}

export async function setAuthState(
  accountType: 'Standard' | 'Unique',
  state: RedisAuthState,
): Promise<void> {
  const key = `${AUTH_KEY_PREFIX}${accountType}`;
  if (state.status === 'idle') {
    await getRedis().del(key);
    return;
  }
  await getRedis().set(key, JSON.stringify(state), 'EX', AUTH_TTL_SEC);
}

export async function getAuthState(
  accountType: 'Standard' | 'Unique',
): Promise<RedisAuthState> {
  const raw = await getRedis().get(`${AUTH_KEY_PREFIX}${accountType}`);
  if (!raw) return { status: 'idle' };
  try {
    return JSON.parse(raw) as RedisAuthState;
  } catch {
    return { status: 'idle' };
  }
}

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { prisma } from '@database';

export type AccountType = 'Standard' | 'Unique';
export type ClientStatus = 'active' | 'revoked' | 'needs_reauth';

let standardClient: TelegramClient | undefined;
let uniqueClient: TelegramClient | undefined;

const clientReady: Record<AccountType, boolean> = {
  Standard: false,
  Unique: false,
};

const usernameCache: Partial<Record<AccountType, string>> = {};

export function isAuthError(e: any): boolean {
  return ['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED'].includes(
    e?.errorMessage ?? e?.message ?? '',
  );
}

export async function markSessionRevoked(type: AccountType) {
  clientReady[type] = false;
  await prisma.userbotSession.update({
    where: { accountType: type },
    data: { status: 'revoked' },
  });
  console.error(
    `[Userbot] ALERT: ${type} session revoked — admin must re-authenticate via POST /api/admin/userbot/auth/start`,
  );
}

async function loadSession(type: AccountType): Promise<string> {
  const row = await prisma.userbotSession.findUnique({ where: { accountType: type } });
  return row?.session ?? '';
}

export async function saveSession(type: AccountType, client: TelegramClient) {
  const sessionString = client.session.save() as unknown as string;
  await prisma.userbotSession.update({
    where: { accountType: type },
    data: { session: sessionString, status: 'active' },
  });
  clientReady[type] = true;
}

function createClient(sessionString: string): TelegramClient {
  return new TelegramClient(
    new StringSession(sessionString),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH!,
    { connectionRetries: 5, retryDelay: 3000, autoReconnect: true },
  );
}

async function connectClient(
  client: TelegramClient,
  type: AccountType,
): Promise<ClientStatus> {
  const row = await prisma.userbotSession.findUnique({ where: { accountType: type } });
  if (!row?.session) {
    console.warn(`[Userbot] ${type} has no session — needs re-auth`);
    clientReady[type] = false;
    return 'needs_reauth';
  }

  try {
    await client.connect();
    const me = await client.getMe();
    if (me.username) usernameCache[type] = me.username;
    clientReady[type] = true;
    console.log(`[Userbot] ${type} client connected`);
    return 'active';
  } catch (e: any) {
    clientReady[type] = false;
    if (isAuthError(e)) {
      await markSessionRevoked(type);
      return 'revoked';
    }
    throw e;
  }
}

export async function initClients(): Promise<Record<AccountType, ClientStatus>> {
  const [standardSession, uniqueSession] = await Promise.all([
    loadSession('Standard'),
    loadSession('Unique'),
  ]);

  standardClient = createClient(standardSession);
  uniqueClient = createClient(uniqueSession);

  const [standardStatus, uniqueStatus] = await Promise.all([
    connectClient(standardClient, 'Standard'),
    connectClient(uniqueClient, 'Unique'),
  ]);

  return { Standard: standardStatus, Unique: uniqueStatus };
}

export async function reconnectClient(type: AccountType): Promise<void> {
  const sessionString = await loadSession(type);
  const existing = type === 'Standard' ? standardClient : uniqueClient;

  try {
    if (existing?.connected) {
      await existing.disconnect();
    }
  } catch {
    // ignore disconnect errors
  }

  const client = createClient(sessionString);
  if (type === 'Standard') standardClient = client;
  else uniqueClient = client;

  await connectClient(client, type);
}

export function isClientReady(type: AccountType): boolean {
  return clientReady[type];
}

export function getClient(type: AccountType, options?: { allowAuth?: boolean }): TelegramClient {
  const client = type === 'Standard' ? standardClient : uniqueClient;
  if (!client) {
    throw new Error(`[Userbot] ${type} client is not initialized`);
  }
  if (!options?.allowAuth && !clientReady[type]) {
    throw new Error(`[Userbot] ${type} client is not connected — re-authenticate via admin panel`);
  }
  return client;
}

export function setClient(type: AccountType, client: TelegramClient) {
  if (type === 'Standard') standardClient = client;
  else uniqueClient = client;
}

export async function getUserbotUsername(type: AccountType = 'Standard'): Promise<string | null> {
  if (usernameCache[type]) return usernameCache[type] ?? null;
  if (!isClientReady(type)) return null;
  try {
    const me = await getClient(type).getMe();
    if (me.username) usernameCache[type] = me.username;
    return me.username ?? null;
  } catch {
    return null;
  }
}

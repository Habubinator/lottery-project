import { Api } from 'telegram';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { prisma } from '@database';
import type { AccountType } from './clients';
import {
  getClient,
  setClient,
  saveSession,
  reconnectClient,
} from './clients';
import { setAuthState, getAuthState } from './auth-state';

export { getAuthState };

export async function startAuth(accountType: AccountType): Promise<void> {
  const session = await prisma.userbotSession.findUnique({ where: { accountType } });
  if (!session?.phoneNumber) throw new Error('Phone number not configured for this account');

  const phone = session.phoneNumber;

  const freshClient = new TelegramClient(
    new StringSession(''),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH!,
    { connectionRetries: 5 },
  );
  await freshClient.connect();

  const result = (await freshClient.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: Number(process.env.TELEGRAM_API_ID),
      apiHash: process.env.TELEGRAM_API_HASH!,
      settings: new Api.CodeSettings({}),
    }),
  )) as any;

  setClient(accountType, freshClient);
  await setAuthState(accountType, {
    status: 'waiting_code',
    phone,
    phoneCodeHash: result.phoneCodeHash,
  });
}

export async function confirmCode(accountType: AccountType, code: string): Promise<void> {
  const state = await getAuthState(accountType);
  if (state.status !== 'waiting_code') throw new Error('Not waiting for OTP code');

  const client = getClient(accountType, { allowAuth: true });
  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: state.phone,
        phoneCodeHash: state.phoneCodeHash,
        phoneCode: code,
      }),
    );
    await saveSession(accountType, client);
    await setAuthState(accountType, { status: 'idle' });
    await reconnectClient(accountType);
  } catch (e: any) {
    if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      await setAuthState(accountType, {
        status: 'waiting_password',
        phone: state.phone,
        phoneCodeHash: state.phoneCodeHash,
      });
      throw new Error('2FA_REQUIRED');
    }
    throw e;
  }
}

export async function submit2FA(accountType: AccountType, password: string): Promise<void> {
  const state = await getAuthState(accountType);
  if (state.status !== 'waiting_password') throw new Error('Not waiting for 2FA password');

  const client = getClient(accountType, { allowAuth: true });
  await client.signInWithPassword(
    { apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH! },
    {
      password: async () => password,
      onError: async (err) => {
        throw err;
      },
    },
  );
  await saveSession(accountType, client);
  await setAuthState(accountType, { status: 'idle' });
  await reconnectClient(accountType);
}

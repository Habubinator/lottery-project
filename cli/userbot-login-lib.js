/**
 * Shared MTProto login — writes session to userbot_session (used by src/userbot/main.ts).
 */

const path = require('path');
const readline = require('readline');

const { PrismaClient } = require('@prisma/client');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');

const prisma = new PrismaClient();

const ACCOUNT_ENV = {
  Standard: 'BUSINESS_ACCOUNT_STANDARD_ID',
  Unique: 'BUSINESS_ACCOUNT_UNIQUE_ID',
};

const ACCOUNT_LABEL = {
  Standard: 'Standard gift account',
  Unique: 'Unique gift account',
};

function parsePhoneArg() {
  const args = process.argv.slice(2);
  const phoneIdx = args.indexOf('--phone');
  return phoneIdx >= 0 ? args[phoneIdx + 1] : undefined;
}

function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }
  return value;
}

async function ensureSessionRow(accountType) {
  const envKey = ACCOUNT_ENV[accountType];
  const telegramId = process.env[envKey] ?? '';

  return prisma.userbotSession.upsert({
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
}

async function saveSession(accountType, client) {
  const sessionString = client.session.save();
  await prisma.userbotSession.update({
    where: { accountType },
    data: { session: sessionString, status: 'active' },
  });
}

/**
 * @param {'Standard' | 'Unique'} accountType
 * @param {{ phone?: string }} [options]
 */
async function runUserbotLogin(accountType, options = {}) {
  const log = `[userbot-login-${accountType.toLowerCase()}]`;
  const apiId = Number(requireEnv('TELEGRAM_API_ID'));
  const apiHash = requireEnv('TELEGRAM_API_HASH');

  const row = await ensureSessionRow(accountType);
  console.log(`\n${log} ${ACCOUNT_LABEL[accountType]}`);
  console.log(`${log} DB row: accountType=${accountType}, telegramId=${row.telegramId || 'n/a'}\n`);

  const rl = createRl();
  try {
    let phone = options.phone ?? parsePhoneArg() ?? row.phoneNumber;
    if (!phone) {
      phone = await ask(rl, 'Phone (E.164, e.g. +380991234567): ');
    }
    if (!phone.startsWith('+')) {
      console.warn(`${log} Warning: phone should usually start with + and country code.`);
    }

    await prisma.userbotSession.update({
      where: { accountType },
      data: { phoneNumber: phone },
    });

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
      connectionRetries: 5,
    });

    console.log(`${log} Connecting to Telegram...`);
    await client.connect();

    console.log(`${log} Sending login code...`);
    const sent = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      }),
    );

    const typeName = sent.type?.className ?? 'unknown';
    console.log(`${log} Code requested (delivery: ${typeName}).`);
    console.log('  → Open Telegram on a device logged into this number.');
    console.log('  → Check the chat from "Telegram", not only SMS.\n');

    const code = await ask(rl, 'Enter code from Telegram: ');
    if (!code) {
      throw new Error('Empty code');
    }

    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash: sent.phoneCodeHash,
          phoneCode: code,
        }),
      );
    } catch (e) {
      const msg = e?.errorMessage ?? e?.message ?? String(e);
      if (msg !== 'SESSION_PASSWORD_NEEDED') {
        throw e;
      }

      console.log(`${log} 2FA enabled on this account.`);
      const password = await ask(rl, 'Enter 2FA password: ');
      await client.signInWithPassword(
        { apiId, apiHash },
        {
          password: async () => password,
          onError: async (err) => {
            throw err;
          },
        },
      );
    }

    await saveSession(accountType, client);
    const me = await client.getMe();
    console.log(`\n${log} OK — session saved to userbot_session (${accountType}).`);
    console.log(`  User: ${me.username ? '@' + me.username : me.firstName} (id ${me.id})`);
    console.log('  Reload worker: pm2 reload userbot-worker-dev\n');

    await client.disconnect();
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

function loadEnv() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

module.exports = { runUserbotLogin, loadEnv };

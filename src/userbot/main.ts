import 'dotenv/config';
import { initClients } from './clients';
import { startGiftWorker, startAuthWorker } from './worker';
import { attachStandardListener, attachUniqueListener } from './message-listener';

async function main() {
  console.log('[Userbot Worker] Starting...');

  const statuses = await initClients();

  if (statuses.Standard === 'active') {
    attachStandardListener();
  } else {
    console.warn(`[Userbot Worker] Standard account not active (${statuses.Standard}) — listener skipped`);
  }

  if (statuses.Unique === 'active') {
    attachUniqueListener();
  } else {
    console.warn(`[Userbot Worker] Unique account not active (${statuses.Unique}) — listener skipped`);
  }

  startGiftWorker();
  startAuthWorker();

  console.log('[Userbot Worker] Ready', statuses);
}

main().catch((e) => {
  console.error('[Userbot Worker] Fatal error:', e);
  process.exit(1);
});

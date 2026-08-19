/**
 * Login Standard gift account — saves session for userbot-worker.
 *
 *   node cli/userbot-login-standard.js
 *   node cli/userbot-login-standard.js --phone +380991234567
 */

const { loadEnv, runUserbotLogin } = require('./userbot-login-lib');

loadEnv();

runUserbotLogin('Standard').catch((err) => {
  console.error('[userbot-login-standard] Failed:', err?.errorMessage ?? err?.message ?? err);
  process.exit(1);
});

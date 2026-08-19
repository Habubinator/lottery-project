/**
 * Login Unique gift account — saves session for userbot-worker.
 *
 *   node cli/userbot-login-unique.js
 *   node cli/userbot-login-unique.js --phone +380991234567
 */

const { loadEnv, runUserbotLogin } = require('./userbot-login-lib');

loadEnv();

runUserbotLogin('Unique').catch((err) => {
  console.error('[userbot-login-unique] Failed:', err?.errorMessage ?? err?.message ?? err);
  process.exit(1);
});

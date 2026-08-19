/**
 * Userbot session login is not included in this copy.
 */

const path = require('path');

function loadEnv() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

async function runUserbotLogin() {
  throw new Error('MTProto login is not included in this copy');
}

module.exports = { runUserbotLogin, loadEnv };

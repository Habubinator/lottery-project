/**
 * Manual test scrape of Fragment Stars packages → TON price.
 * Production sync: giveaway-cron uses src/admin/services/fragment-stars-rate.service.ts
 *
 * Usage:
 *   node cli/fragment-stars-price.js
 *
 * Optional env:
 *   FRAGMENT_STARS_URL=https://fragment.com/stars/buy
 */

const cheerio = require('cheerio');

const URL = process.env.FRAGMENT_STARS_URL || 'https://fragment.com/stars/buy';

function parseTonFromValueEl($, el) {
  const $el = $(el);
  const whole = $el
    .contents()
    .filter((_, node) => node.type === 'text')
    .text()
    .trim();
  const frac = $el.find('.mini-frac').first().text().trim();
  const raw = `${whole}${frac}`.replace(/[^\d.]/g, '');
  const ton = Number.parseFloat(raw);
  return Number.isFinite(ton) ? ton : null;
}

function findTonPriceEl($, $item) {
  // New Fragment layout: USD on .tm-value.icon-usd, TON on .tm-radio-desc.icon-ton
  // Return a DOM Element (same contract as fragment-stars-rate.service.ts), not a Cheerio wrap.
  const next = $item.find('.tm-radio-desc.icon-ton').first().get(0);
  if (next) return next;
  const legacy = $item.find('.tm-value.icon-ton').first().get(0);
  if (legacy) return legacy;
  return $item
    .find('.icon-ton')
    .filter((_, el) => $(el).is('div,span'))
    .first()
    .get(0);
}

function parsePackages(html) {
  const $ = cheerio.load(html);
  const packages = [];

  $('.js-stars-options .tm-form-radio-item').each((_, item) => {
    const $item = $(item);
    const starsRaw = $item.find('input[name="stars"]').attr('value');
    const stars = Number.parseInt(starsRaw ?? '', 10);
    const tonEl = findTonPriceEl($, $item);
    const ton = tonEl ? parseTonFromValueEl($, tonEl) : null;
    const usdText = $item.find('.tm-radio-desc').first().text().trim() || null;
    const usdAlt = $item.find('.tm-value.icon-usd').first().text().trim();

    if (!Number.isFinite(stars) || ton == null) {
      return;
    }

    packages.push({
      stars,
      ton,
      usd: usdAlt ? `$${usdAlt}` : usdText,
      tonPerStar: ton / stars,
      starsPerTon: stars / ton,
    });
  });

  return packages;
}

function pickReferencePackage(packages) {
  const ref =
    packages.find((p) => p.stars === 100) ??
    packages.find((p) => p.stars === 50) ??
    packages[0];
  return ref ?? null;
}

async function main() {
  console.log(`Fetching ${URL} ...`);

  const res = await fetch(URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; AppFragmentTest/1.0; +https://fragment.com/stars/buy)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const packages = parsePackages(html);

  if (!packages.length) {
    console.error('No star packages found — page HTML structure may have changed.');
    console.error('Saved snippet length:', html.length);
    process.exit(1);
  }

  const ref = pickReferencePackage(packages);

  console.log('');
  console.log(`Parsed ${packages.length} package(s) from Fragment:`);
  console.log('');

  for (const pkg of packages.slice(0, 8)) {
    console.log(
      `  ${String(pkg.stars).padStart(7)} Stars  →  ${pkg.ton.toFixed(4)} TON` +
        (pkg.usd ? `  (${pkg.usd})` : '') +
        `  |  ${pkg.tonPerStar.toFixed(6)} TON/star`,
    );
  }
  if (packages.length > 8) {
    console.log(`  ... and ${packages.length - 8} more`);
  }

  console.log('');
  console.log('Reference rate (from selected package):');
  console.log(`  Package: ${ref.stars} Stars = ${ref.ton} TON`);
  console.log(`  TON per 1 Star:  ${ref.tonPerStar.toFixed(8)}`);
  console.log(`  Stars per 1 TON: ${ref.starsPerTon.toFixed(4)}`);
  console.log('');
  console.log('OK — cheerio scrape works.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});

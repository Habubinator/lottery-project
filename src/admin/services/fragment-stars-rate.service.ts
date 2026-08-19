import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { exchangeRateService } from './exchange-rate.service';

const DEFAULT_FRAGMENT_STARS_URL = 'https://fragment.com/stars/buy';
const DEFAULT_FRAGMENT_FETCH_TIMEOUT_MS = 15_000;

export type FragmentStarsPackage = {
  stars: number;
  ton: number;
};

function parseTonFromValueEl(
  $: cheerio.CheerioAPI,
  el: Element,
): number | null {
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

/**
 * Fragment used to put TON on `.tm-value.icon-ton`; as of 2026-08 the package
 * list shows USD on `.tm-value.icon-usd` and TON on `.tm-radio-desc.icon-ton`.
 */
function findTonPriceEl(
  $: cheerio.CheerioAPI,
  $item: cheerio.Cheerio<Element>,
): Element | undefined {
  return (
    $item.find('.tm-radio-desc.icon-ton').first().get(0) ??
    $item.find('.tm-value.icon-ton').first().get(0) ??
    $item.find('.icon-ton').filter((_, el) => $(el).is('div,span')).first().get(0)
  );
}

export function parseFragmentStarsPackages(html: string): FragmentStarsPackage[] {
  const $ = cheerio.load(html);
  const packages: FragmentStarsPackage[] = [];

  $('.js-stars-options .tm-form-radio-item').each((_, item) => {
    const $item = $(item);
    const starsRaw = $item.find('input[name="stars"]').attr('value');
    const stars = Number.parseInt(starsRaw ?? '', 10);
    const tonEl = findTonPriceEl($, $item);
    const ton = tonEl ? parseTonFromValueEl($, tonEl) : null;

    if (!Number.isFinite(stars) || ton == null) {
      return;
    }

    packages.push({ stars, ton });
  });

  return packages;
}

export function pickReferenceFragmentPackage(
  packages: FragmentStarsPackage[],
): FragmentStarsPackage | null {
  return (
    packages.find((p) => p.stars === 100) ??
    packages.find((p) => p.stars === 50) ??
    packages[0] ??
    null
  );
}

class FragmentStarsRateService {
  private getUrl(): string {
    return process.env.FRAGMENT_STARS_URL || DEFAULT_FRAGMENT_STARS_URL;
  }

  private getFetchTimeoutMs(): number {
    const raw = process.env.FRAGMENT_FETCH_TIMEOUT_MS;
    if (raw === undefined || raw === '') {
      return DEFAULT_FRAGMENT_FETCH_TIMEOUT_MS;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_FRAGMENT_FETCH_TIMEOUT_MS;
  }

  /**
   * Fetches Fragment Stars buy page and returns the reference package (100⭐ preferred).
   */
  async fetchReferenceRate(): Promise<FragmentStarsPackage> {
    const url = this.getUrl();
    const timeoutMs = this.getFetchTimeoutMs();

    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; AppFragmentRateSync/1.0; +https://fragment.com/stars/buy)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`Fragment fetch timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!res.ok) {
      throw new Error(`Fragment HTTP ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const packages = parseFragmentStarsPackages(html);

    if (!packages.length) {
      throw new Error(
        'No star packages found on Fragment page (HTML structure may have changed)',
      );
    }

    const ref = pickReferenceFragmentPackage(packages);
    if (!ref) {
      throw new Error('No reference star package selected from Fragment data');
    }

    return ref;
  }

  /**
   * Updates admin ExchangeRate (starsInput / tonOutput) from Fragment reference package.
   */
  async syncExchangeRateFromFragment(): Promise<{
    starsInput: number;
    tonOutput: number;
  }> {
    const ref = await this.fetchReferenceRate();

    const updated = await exchangeRateService.updateExchangeRate({
      starsInput: ref.stars,
      tonOutput: ref.ton,
    });

    return {
      starsInput: updated.starsInput.toNumber(),
      tonOutput: updated.tonOutput.toNumber(),
    };
  }
}

export const fragmentStarsRateService = new FragmentStarsRateService();

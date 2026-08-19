export { telegramEntitiesToHtml, stripHtmlTags, normalizeHtml, htmlToEntities } from './telegram-entities-to-html';

import {
  ChatBoostSource,
  ChatBoostSourcePremium,
  ChatBoostSourceGiftCode,
  ChatBoostSourceGiveaway,
  ChatBoost,
} from '../types';

// Helper type guards to check boost source types
export function isPremiumBoost(
  source: ChatBoostSource,
): source is ChatBoostSourcePremium {
  return source.source === 'premium';
}

export function isGiftCodeBoost(
  source: ChatBoostSource,
): source is ChatBoostSourceGiftCode {
  return source.source === 'gift_code';
}

export function isGiveawayBoost(
  source: ChatBoostSource,
): source is ChatBoostSourceGiveaway {
  return source.source === 'giveaway';
}

// Utility function to get boost source description
export function getBoostSourceDescription(boost: ChatBoost): string {
  switch (boost.source.source) {
    case 'premium':
      return `Premium boost from ${boost.source.user.first_name}`;
    case 'gift_code':
      return `Gift code boost from ${boost.source.user.first_name}`;
    case 'giveaway':
      return boost.source.user
        ? `Giveaway boost from ${boost.source.user.first_name}`
        : 'Unclaimed giveaway boost';
    default:
      return 'Unknown boost source';
  }
}

// Utility function to check if boost is still active
export function isBoostActive(boost: ChatBoost): boolean {
  const currentTime = Math.floor(Date.now() / 1000);
  return boost.expiration_date > currentTime;
}

// Utility function to get boost duration in hours
export function getBoostDurationHours(boost: ChatBoost): number {
  return Math.floor((boost.expiration_date - boost.add_date) / 3600);
}

// Utility function to get remaining boost time in hours
export function getRemainingBoostHours(boost: ChatBoost): number {
  const currentTime = Math.floor(Date.now() / 1000);
  const remaining = boost.expiration_date - currentTime;
  return Math.max(0, Math.floor(remaining / 3600));
}

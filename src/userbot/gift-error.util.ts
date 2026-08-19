export type ParsedGiftSendError = {
  errorCode: string;
  needsChat?: boolean;
  giftUnavailable?: boolean;
  balanceTooLow?: boolean;
};

export type ParsedGiftTransferError = {
  errorCode: string;
  paymentRequired?: boolean;
  balanceTooLow?: boolean;
  needsChat?: boolean;
};

const NEEDS_CHAT_CODES = new Set([
  'USER_NOT_MUTUAL_CONTACT',
  'PEER_ID_INVALID',
]);

const GIFT_UNAVAILABLE_CODES = new Set([
  'STARGIFT_USAGE_LIMITED',
  'STARGIFT_NOT_FOUND',
  'GIFT_INVALID',
  'STARGIFT_INVALID',
  'STARGIFT_EXPIRED',
]);

const BALANCE_CODES = new Set(['BALANCE_TOO_LOW', 'STARS_BALANCE_LOW']);

export function parseGiftSendError(raw: string): ParsedGiftSendError {
  const msg = raw.trim();
  const upper = msg.toUpperCase();

  for (const code of NEEDS_CHAT_CODES) {
    if (upper.includes(code)) {
      return { errorCode: code, needsChat: true };
    }
  }

  if (upper.includes('COULD NOT FIND THE INPUT ENTITY')) {
    return { errorCode: msg || 'NEEDS_CHAT', needsChat: true };
  }

  for (const code of GIFT_UNAVAILABLE_CODES) {
    if (upper.includes(code)) {
      return { errorCode: code, giftUnavailable: true };
    }
  }

  if (
    upper.includes('SOLD OUT') ||
    upper.includes('USAGE_LIMITED') ||
    upper.includes('NOT FOUND') ||
    upper.includes('INVALID GIFT')
  ) {
    return { errorCode: msg || 'GIFT_UNAVAILABLE', giftUnavailable: true };
  }

  for (const code of BALANCE_CODES) {
    if (upper.includes(code)) {
      return { errorCode: code, balanceTooLow: true };
    }
  }

  return { errorCode: msg || 'UNKNOWN' };
}

/** MTProto errors from payments.TransferStarGift (NFT withdrawal). */
export function parseGiftTransferError(raw: string): ParsedGiftTransferError {
  const msg = raw.trim();
  const upper = msg.toUpperCase();

  if (upper.includes('PAYMENT_REQUIRED')) {
    return { errorCode: 'PAYMENT_REQUIRED', paymentRequired: true };
  }

  for (const code of BALANCE_CODES) {
    if (upper.includes(code)) {
      return { errorCode: code, balanceTooLow: true };
    }
  }

  for (const code of NEEDS_CHAT_CODES) {
    if (upper.includes(code)) {
      return { errorCode: code, needsChat: true };
    }
  }

  if (upper.includes('COULD NOT FIND THE INPUT ENTITY')) {
    return { errorCode: msg || 'NEEDS_CHAT', needsChat: true };
  }

  return { errorCode: msg || 'UNKNOWN' };
}

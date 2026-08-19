import type { Request } from 'express';

export const getClientIP = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]) ||
    req.socket.remoteAddress ||
    '0.0.0.0';

  return ip.trim();
};

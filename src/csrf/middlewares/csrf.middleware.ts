import { CSRF_TOKEN_COOKIE } from '@common/constants';
import { ErrorCodes } from '@common/enums';
import { doubleCsrf } from 'csrf-csrf';
import type { Request } from 'express';

export const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  getSessionIdentifier: () => '',
  cookieName: CSRF_TOKEN_COOKIE,
  cookieOptions: {
    signed: false,
    path: '/',
    sameSite: 'none',
    secure: true,
  },
  size: 16,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req: Request) => req.headers['x-csrf-token'],
  errorConfig: {
    code: ErrorCodes.Csrf as any,
    statusCode: 403,
    message: 'Invalid CSRF token',
  },
});

import jwt from 'jsonwebtoken';
import { JwtAccessTokenPayload, JwtRefreshTokenPayload } from '../types';

class TokenService {
  generateTokens(userId: number, sessionId: string) {
    const accessPayload: JwtAccessTokenPayload = {
      userId,
    };
    const refreshPayload: JwtRefreshTokenPayload = {
      userId,
      sessionId,
    };

    const accessToken = jwt.sign(accessPayload, process.env.JWT_ACCESS_SECRET, {
      expiresIn: '15m',
      subject: 'auth',
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    });

    const refreshToken = jwt.sign(
      refreshPayload,
      process.env.JWT_REFRESH_SECRET,
      {
        expiresIn: '30d',
        subject: 'refresh',
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      },
    );

    return { accessToken, refreshToken };
  }

  validateAccessToken(token: string) {
    try {
      const claims = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
        ignoreExpiration: false,
        subject: 'auth',
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      }) as JwtAccessTokenPayload;
      return claims;
    } catch {
      return null;
    }
  }

  validateRefreshToken(token: string) {
    try {
      const claims = jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
        ignoreExpiration: false,
        subject: 'refresh',
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      }) as JwtRefreshTokenPayload;
      return claims;
    } catch {
      return null;
    }
  }
}

export const tokenService = new TokenService();

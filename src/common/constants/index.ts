import type { CookieOptions } from 'express';
import type { Options } from 'swagger-jsdoc';

export const PORT = process.env.PORT || 8000;
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const LOCALES = ['ru', 'ua', 'en'];

export const CSRF_TOKEN_COOKIE = '__Host-psifi.x-csrf-token';
export const REFRESH_TOKEN_COOKIE = '__Host-psifi.refresh_token';
export const REFRESH_TOKEN_COOKIE_OPTIONS: CookieOptions = {
  sameSite: 'none',
  secure: true,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
};

export const SWAGGER_OPTIONS: Options = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Template API',
      description: 'Template API Information',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    servers: [
      {
        url: `https://${process.env.DOMAIN}`,
      },
      {
        url: `http://localhost:${PORT}`,
      },
    ],
  },
  apis: [`src/**/routes/*.ts`],
};

import { Request } from 'express';
import { I18n } from 'i18n';
import { join } from 'path';
import { LOCALES } from '@common/constants';

export const i18n = new I18n({
  locales: LOCALES,
  defaultLocale: LOCALES[0],
  objectNotation: true,
  updateFiles: false,
  directory: join(process.cwd(), 'locales'),
  queryParameter: 'lang',
  header: 'x-lang',
});

export function resolveLocale(locale?: string): string {
  const normalized = locale?.trim().toLowerCase();
  if (normalized && LOCALES.includes(normalized)) {
    return normalized;
  }
  return i18n.getLocale();
}

export function getLang(req: Request): string {
  const fromQuery = typeof req.query.lang === 'string' && req.query.lang.trim();
  if (fromQuery) return fromQuery;

  const fromHeader = req.header('x-lang');
  if (fromHeader && fromHeader.trim()) return fromHeader.trim().toLowerCase();

  return 'en';
}

import { cookies, headers } from 'next/headers';

import {
  DEFAULT_LOCALE,
  LUMEN_LOCALE_COOKIE,
  LUMEN_LOCALE_HEADER,
  type Locale,
  getLocaleFromPathname,
  isLocale,
} from './routing';

export async function getRequestLocale(): Promise<Locale> {
  const headerStore = await headers();
  const headerLocale = headerStore.get(LUMEN_LOCALE_HEADER);
  if (isLocale(headerLocale)) return headerLocale;

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LUMEN_LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const pathname = headerStore.get('x-pathname') ?? '';
  return pathname ? getLocaleFromPathname(pathname) : DEFAULT_LOCALE;
}

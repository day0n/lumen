import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  DEFAULT_LOCALE,
  LUMEN_LOCALE_COOKIE,
  LUMEN_LOCALE_HEADER,
  type Locale,
  getLocaleFromPathname,
  isLocale,
  localePath,
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

export async function redirectWithLocale(href: string): Promise<never> {
  // SPA 路径（/app/*）不带 locale 前缀，直接跳就行；非 /app 的 Next.js
  // 页面才需要按当前 locale 加 /zh 前缀。
  if (href.startsWith('/app/') || href === '/app') {
    redirect(href);
  }
  const locale = await getRequestLocale();
  redirect(localePath(href, locale));
}

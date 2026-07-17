import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import {
  LUMEN_LOCALE_COOKIE,
  LUMEN_LOCALE_HEADER,
  getLocaleFromPathname,
  hasEnglishPrefix,
  isLocale,
  localeFromAcceptLanguage,
  localePath,
  stripLocalePrefix,
  withoutEnglishPrefix,
} from '@/i18n/routing';

const PROTECTED_PREFIXES = ['/agent-chat', '/canvas', '/materials'] as const;
const LEGACY_APP_ROUTES = new Map<string, string>([
  ['/dashboard', '/app/home'],
  ['/app/dashboard', '/app/home'],
  ['/materials', '/app/materials'],
  ['/canvas/projects', '/app/projects'],
  ['/canvas/new', '/app/canvas/new'],
]);

export default clerkMiddleware(
  async (auth, request) => {
    const pathname = request.nextUrl.pathname;

    if (hasEnglishPrefix(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = withoutEnglishPrefix(pathname);
      return NextResponse.redirect(url, 308);
    }

    const locale = resolveMiddlewareLocale(request);
    const normalizedPath = stripLocalePrefix(pathname);

    // 1) 历史脏 URL 清理：/app/zh/app/...、/app/en/app/... 这类递归前缀
    //    把它一次性压平回干净的 /app/...，避免用户卡在坏地址。
    const collapsedAppPath = collapseStudioAppPath(pathname);
    if (collapsedAppPath !== pathname) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = collapsedAppPath;
      const redirectResponse = NextResponse.redirect(redirectUrl);
      redirectResponse.cookies.set(LUMEN_LOCALE_COOKIE, locale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
      return redirectResponse;
    }

    // 2) SPA (/app/*) 路径不带 /zh 前缀。如果有人访问 /zh/app/* 或 /en/app/*，
    //    立刻 strip 掉前缀重定向到 /app/*，并用 cookie 记住语言。
    if (
      pathname.startsWith('/zh/app/') ||
      pathname === '/zh/app' ||
      pathname.startsWith('/en/app/') ||
      pathname === '/en/app'
    ) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = pathname.slice(3) || '/app';
      const redirectResponse = NextResponse.redirect(redirectUrl);
      redirectResponse.cookies.set(LUMEN_LOCALE_COOKIE, locale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
      return redirectResponse;
    }

    // 3) 非 SPA 的 Next.js 页面（/home、/canvas/* 等）按 cookie 把语言体现在 URL 里。
    const isStudioAppPath = pathname === '/app' || pathname.startsWith('/app/');
    const isApiPath = pathname.startsWith('/api') || pathname.startsWith('/trpc');
    const localizedPathname = localePath(pathname, locale);
    if (!isStudioAppPath && !isApiPath && localizedPathname !== pathname) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = localizedPathname;
      const redirectResponse = NextResponse.redirect(redirectUrl);
      redirectResponse.cookies.set(LUMEN_LOCALE_COOKIE, locale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
      return redirectResponse;
    }

    const appRedirectPath = getLegacyAppRedirectPath(normalizedPath);
    if (appRedirectPath) {
      const redirectUrl = request.nextUrl.clone();
      // 历史页面路径只指向 SPA（/app/*），不再带 locale 前缀。
      redirectUrl.pathname = appRedirectPath;
      if (normalizedPath === '/agent-chat') {
        redirectUrl.searchParams.set('agent', 'chat');
      }
      const redirectResponse = NextResponse.redirect(redirectUrl);
      redirectResponse.cookies.set(LUMEN_LOCALE_COOKIE, locale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
      return redirectResponse;
    }

    if (isProtectedPath(normalizedPath)) {
      const { userId } = await auth();
      if (!userId) {
        const signUpUrl = new URL(localePath('/sign-up', locale), request.url);
        signUpUrl.searchParams.set(
          'redirect_url',
          `${request.nextUrl.pathname}${request.nextUrl.search}`,
        );
        const redirectResponse = NextResponse.redirect(signUpUrl);
        redirectResponse.cookies.set(LUMEN_LOCALE_COOKIE, locale, {
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
          sameSite: 'lax',
        });
        return redirectResponse;
      }
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(LUMEN_LOCALE_HEADER, locale);
    requestHeaders.set('x-pathname', pathname);

    const rewriteTarget =
      locale === 'zh' && pathname !== normalizedPath
        ? new URL(`${normalizedPath}${request.nextUrl.search}`, request.url)
        : null;
    const response = rewriteTarget
      ? NextResponse.rewrite(rewriteTarget, { request: { headers: requestHeaders } })
      : NextResponse.next({ request: { headers: requestHeaders } });

    response.cookies.set(LUMEN_LOCALE_COOKIE, locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
    return response;
  },
  {
    signInUrl: '/sign-in',
    signUpUrl: '/sign-up',
  },
);

export const config = {
  matcher: [
    '/((?!_next|ws/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/__clerk/(.*)',
    '/(api|trpc)(.*)',
  ],
};

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function getLegacyAppRedirectPath(pathname: string): string | null {
  const exactTarget = LEGACY_APP_ROUTES.get(pathname);
  if (exactTarget) return exactTarget;
  if (pathname === '/agent-chat') return '/app/canvas/new';
  if (pathname.startsWith('/canvas/')) return `/app${pathname}`;
  return null;
}

function resolveMiddlewareLocale(request: Request) {
  const { pathname } = new URL(request.url);
  const pathLocale = getLocaleFromPathname(pathname);
  if (pathLocale === 'zh') return pathLocale;

  const headerLocale = request.headers.get(LUMEN_LOCALE_HEADER);
  if (isLocale(headerLocale)) return headerLocale;

  const cookieLocale = readCookieLocale(request);
  if (isLocale(cookieLocale)) return cookieLocale;

  // 没有显式选择时，按浏览器 Accept-Language 兜底，让中文用户首次访问就拿到中文。
  const acceptLanguageLocale = localeFromAcceptLanguage(request.headers.get('accept-language'));
  if (acceptLanguageLocale) return acceptLanguageLocale;

  return pathLocale;
}

function readCookieLocale(request: Request): string | null {
  const raw = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LUMEN_LOCALE_COOKIE}=`))
    ?.split('=')[1];
  return raw ?? null;
}

/**
 * 把 /app/zh/app/...、/app/en/app/... 这种递归脏前缀压平回 /app/...
 * 该函数与 lumen-app/src/lib/path-map.ts 内的同名函数语义一致，
 * 只用于服务端兜底重定向。
 */
function collapseStudioAppPath(pathname: string): string {
  let next = pathname;
  while (true) {
    const cleaned = next.replace(/^\/app\/(?:zh|en)\/app\//, '/app/');
    if (cleaned === next) return cleaned;
    next = cleaned;
  }
}

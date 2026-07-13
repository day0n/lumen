const FULL_RELEASE_PATTERN = /^[0-9a-f]{40}$/;
const COMPRESSIBLE_ASSET_PATTERN = /\.(?:css|html|js|json|mjs|svg|txt|xml)$/i;

const LEGACY_REDIRECTS = new Map([
  ['/home', '/app/home'],
  ['/hot-videos', '/app/hot-videos'],
  ['/dashboard', '/app/dashboard'],
  ['/materials', '/app/materials'],
  ['/agent-chat', '/app/canvas/new?agent=chat'],
  ['/canvas', '/app/projects'],
  ['/canvas/projects', '/app/projects'],
  ['/canvas/new', '/app/canvas/new'],
]);

export default {
  async fetch(request, env, context) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    const release = env.ACTIVE_FRONTEND_RELEASE?.trim().toLowerCase();
    if (!release || !FULL_RELEASE_PATTERN.test(release)) {
      return new Response('Frontend release is unavailable', {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/' && preferredLocale(request) === 'zh') {
      url.pathname = '/zh';
      return redirectResponse(url, 302, null, true);
    }

    const action = resolveEdgeAction(url.pathname, release);
    if (action.type === 'redirect') {
      url.pathname = action.pathname;
      if (action.search) {
        const redirectParameters = new URLSearchParams(action.search);
        for (const [name, value] of redirectParameters) url.searchParams.set(name, value);
      }
      return redirectResponse(url, 308, action.locale ?? null, false);
    }
    if (action.type === 'not-found') {
      return new Response('Not found', {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      });
    }

    const encoding = selectEncoding(request, action.objectKey);
    const cache = request.method === 'GET' && typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = cache ? createCacheKey(request, action.release, encoding) : null;
    if (cache && cacheKey) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    let object;
    try {
      object = await readObject(env.FRONTEND_BUCKET, action.objectKey, encoding, request.method);
    } catch {
      return new Response('Frontend storage is unavailable', {
        status: 503,
        headers: {
          'cache-control': 'no-store',
          'retry-after': '5',
          'x-lumen-release': action.release,
        },
      });
    }
    if (!object) {
      const missingShell = action.kind === 'html';
      return new Response(missingShell ? 'Frontend release is unavailable' : 'Not found', {
        status: missingShell ? 503 : 404,
        headers: {
          'cache-control': 'no-store',
          ...(missingShell ? { 'retry-after': '5' } : {}),
          'x-lumen-release': action.release,
        },
      });
    }

    const headers = createObjectHeaders(object, action, encoding);
    if (request.headers.get('if-none-match') === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }

    const response = new Response(request.method === 'HEAD' ? null : object.body, {
      status: action.status,
      headers,
    });

    if (cache && cacheKey && action.status === 200) {
      context.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
    }
    return response;
  },
};

export function resolveEdgeAction(pathname, activeRelease) {
  if (!FULL_RELEASE_PATTERN.test(activeRelease)) return { type: 'not-found' };
  if (hasUnsafePath(pathname)) return { type: 'not-found' };

  const dirtyAppMatch = pathname.match(/^\/app\/(?:en|zh)\/app(?:\/(.*))?$/);
  if (dirtyAppMatch) {
    return {
      type: 'redirect',
      pathname: `/app/${dirtyAppMatch[1] ?? ''}`.replace(/\/$/, '') || '/app',
    };
  }

  const localeAppMatch = pathname.match(/^\/(en|zh)\/app(?:\/(.*))?$/);
  if (localeAppMatch) {
    return {
      type: 'redirect',
      pathname: `/app/${localeAppMatch[2] ?? ''}`.replace(/\/$/, '') || '/app',
      locale: localeAppMatch[1],
    };
  }

  const localePrefixMatch = pathname.match(/^\/(en|zh)(?:\/(.*))?$/);
  if (localePrefixMatch) {
    const locale = localePrefixMatch[1];
    const unprefixedPathname = `/${localePrefixMatch[2] ?? ''}`.replace(/\/$/, '') || '/';
    const legacyRedirect = resolveLegacyRedirect(unprefixedPathname);
    if (legacyRedirect) {
      return { ...legacyRedirect, locale };
    }
    if (locale === 'en') {
      return {
        type: 'redirect',
        pathname: unprefixedPathname,
        locale,
      };
    }
    // Chinese shells keep their prefix so localized auth, share and 404 routes
    // can select the correct document below.
  }

  const legacyRedirect = resolveLegacyRedirect(pathname);
  if (legacyRedirect) return legacyRedirect;
  if (pathname === '/app') {
    return { type: 'redirect', pathname: '/app/dashboard' };
  }

  const versionedAsset = pathname.match(/^\/_static\/releases\/([^/]+)\/(.+)$/);
  if (versionedAsset) {
    const release = versionedAsset[1];
    const assetPath = versionedAsset[2];
    if (
      !release ||
      !assetPath ||
      !FULL_RELEASE_PATTERN.test(release) ||
      hasUnsafePath(assetPath) ||
      !isPublishedAssetPath(assetPath)
    ) {
      return { type: 'not-found' };
    }
    return {
      type: 'object',
      kind: 'immutable',
      objectKey: `releases/${release}/${assetPath}`,
      release,
      status: 200,
    };
  }

  if (pathname === '/') return shellAction(activeRelease, 'index.html');
  if (pathname === '/zh') return shellAction(activeRelease, 'zh/index.html');
  if (matchesPathSegment(pathname, '/sign-in')) {
    return shellAction(activeRelease, 'auth/index.html');
  }
  if (matchesPathSegment(pathname, '/sign-up')) {
    return shellAction(activeRelease, 'auth/index.html');
  }
  if (matchesPathSegment(pathname, '/zh/sign-in') || matchesPathSegment(pathname, '/zh/sign-up')) {
    return shellAction(activeRelease, 'auth/index.html');
  }
  if (matchesPathSegment(pathname, '/share') || matchesPathSegment(pathname, '/zh/share')) {
    return shellAction(activeRelease, 'share/index.html');
  }

  const appPublicAssetPath = pathname.startsWith('/app/')
    ? readPublicAssetPath(pathname.slice('/app'.length))
    : null;
  if (appPublicAssetPath) {
    return {
      type: 'object',
      kind: 'public',
      objectKey: `releases/${activeRelease}/${appPublicAssetPath}`,
      release: activeRelease,
      status: 200,
    };
  }

  if (pathname.startsWith('/app/')) {
    const finalSegment = pathname.split('/').at(-1) ?? '';
    if (/\.[a-z0-9]{1,12}$/i.test(finalSegment)) return { type: 'not-found' };
    return shellAction(activeRelease, 'app/index.html');
  }

  const publicAssetPath = readPublicAssetPath(pathname);
  if (publicAssetPath) {
    return {
      type: 'object',
      kind: 'public',
      objectKey: `releases/${activeRelease}/${publicAssetPath}`,
      release: activeRelease,
      status: 200,
    };
  }

  if (pathname.startsWith('/zh/')) {
    return {
      ...shellAction(activeRelease, '404.html'),
      status: 404,
    };
  }

  return { type: 'not-found' };
}

export function preferredLocale(request) {
  const cookieLocale = readCookie(request.headers.get('cookie'), 'lumen_locale');
  if (cookieLocale === 'en' || cookieLocale === 'zh') return cookieLocale;

  const header = request.headers.get('accept-language');
  if (!header) return 'en';
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.find((param) => param.trim().startsWith('q='));
      const parsed = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { locale: tag.toLowerCase().split('-')[0], q: Number.isFinite(parsed) ? parsed : 0 };
    })
    .sort((left, right) => right.q - left.q);
  return candidates.find((candidate) => candidate.locale === 'zh' || candidate.locale === 'en')
    ?.locale === 'zh'
    ? 'zh'
    : 'en';
}

function shellAction(release, filename) {
  return {
    type: 'object',
    kind: 'html',
    objectKey: `releases/${release}/${filename}`,
    release,
    status: 200,
  };
}

function resolveLegacyRedirect(pathname) {
  const legacyTarget = LEGACY_REDIRECTS.get(pathname);
  if (legacyTarget) {
    const target = new URL(legacyTarget, 'https://lumen.local');
    return {
      type: 'redirect',
      pathname: target.pathname,
      ...(target.search ? { search: target.search } : {}),
    };
  }
  if (pathname.startsWith('/canvas/')) {
    return { type: 'redirect', pathname: `/app${pathname}` };
  }
  return null;
}

function readPublicAssetPath(pathname) {
  if (pathname === '/favicon.ico' || pathname === '/icon.svg') return pathname.slice(1);
  for (const prefix of [
    '/fonts/',
    '/home-posters/',
    '/home-templates/',
    '/material-showcase/',
    '/particle-masks/',
  ]) {
    if (pathname.startsWith(prefix)) return pathname.slice(1);
  }
  return null;
}

function isPublishedAssetPath(assetPath) {
  if (assetPath.startsWith('assets/')) return true;
  return readPublicAssetPath(`/${assetPath}`) === assetPath;
}

function matchesPathSegment(pathname, route) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function hasUnsafePath(path) {
  if (!path || /%(?:00|2e|2f|5c)/i.test(path) || path.includes('\\')) return true;
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  const trimmed = decoded.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return false;
  if (trimmed.includes('//') || trimmed.toLowerCase().endsWith('.map')) return true;
  return trimmed
    .split('/')
    .some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.startsWith('.') ||
        part.includes('/') ||
        part.includes('\\') ||
        hasControlCharacter(part),
    );
}

function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function selectEncoding(request, objectKey) {
  if (!COMPRESSIBLE_ASSET_PATTERN.test(objectKey)) return null;
  const accepted = request.headers.get('accept-encoding')?.toLowerCase() ?? '';
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return null;
}

async function readObject(bucket, objectKey, encoding, method) {
  const candidates = encoding
    ? [
        { key: `${objectKey}.${encoding === 'gzip' ? 'gz' : 'br'}`, encoding },
        { key: objectKey, encoding: null },
      ]
    : [{ key: objectKey, encoding: null }];

  for (const candidate of candidates) {
    const object =
      method === 'HEAD' ? await bucket.head(candidate.key) : await bucket.get(candidate.key);
    if (object) {
      return {
        body: object.body,
        httpEtag: object.httpEtag,
        size: object.size,
        selectedEncoding: candidate.encoding,
        writeHttpMetadata: object.writeHttpMetadata?.bind(object),
      };
    }
  }
  return null;
}

function createObjectHeaders(object, action, requestedEncoding) {
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set('content-type', contentTypeFor(action.objectKey, headers.get('content-type')));
  headers.set('etag', object.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-lumen-release', action.release);
  if (object.size !== undefined) headers.set('content-length', String(object.size));

  const encoding = object.selectedEncoding ?? null;
  if (encoding) headers.set('content-encoding', encoding);
  if (requestedEncoding || COMPRESSIBLE_ASSET_PATTERN.test(action.objectKey)) {
    headers.set('vary', 'Accept-Encoding');
  }

  if (action.kind === 'immutable') {
    headers.set('cache-control', 'public, max-age=31536000, immutable');
  } else if (action.kind === 'html') {
    headers.set('cache-control', 'public, max-age=0, must-revalidate');
    headers.set('cdn-cache-control', 'public, max-age=60, stale-while-revalidate=300');
  } else {
    headers.set('cache-control', 'public, max-age=300, stale-while-revalidate=600');
  }
  return headers;
}

function contentTypeFor(objectKey, existing) {
  if (existing && existing !== 'application/octet-stream') return existing;
  const key = objectKey.replace(/\.(?:br|gz)$/i, '');
  if (key.endsWith('.html')) return 'text/html; charset=utf-8';
  if (key.endsWith('.css')) return 'text/css; charset=utf-8';
  if (key.endsWith('.js') || key.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (key.endsWith('.json')) return 'application/json; charset=utf-8';
  if (key.endsWith('.svg')) return 'image/svg+xml';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.woff2')) return 'font/woff2';
  if (key.endsWith('.ico')) return 'image/x-icon';
  return existing || 'application/octet-stream';
}

function createCacheKey(request, release, encoding) {
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('__release', release);
  if (encoding) url.searchParams.set('__encoding', encoding);
  return new Request(url, { method: 'GET' });
}

function redirectResponse(url, status, locale, varyByLanguage) {
  const headers = new Headers({
    location: url.toString(),
    'cache-control': varyByLanguage ? 'no-store' : 'public, max-age=3600',
  });
  if (locale === 'en' || locale === 'zh') {
    headers.append(
      'set-cookie',
      `lumen_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  }
  if (varyByLanguage) headers.set('vary', 'Cookie, Accept-Language');
  return new Response(null, { status, headers });
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

export function readSessionToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  return authorization === null
    ? readSessionCookie(request.headers)
    : readBearerToken(authorization);
}

function readBearerToken(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function readSessionCookie(headers: Headers): string | null {
  const cookieHeader = headers.get('cookie');
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;
    if (rawName !== '__session' && !rawName.startsWith('__session_')) continue;

    const value = rawValue.join('=').trim();
    if (!value) continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

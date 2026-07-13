export type SessionCredential =
  | { source: 'bearer'; token: string }
  | { source: 'cookie'; token: string }
  | { source: 'invalid-authorization'; token: null };

export function readSessionCredential(request: Request): SessionCredential | null {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const token = readBearerToken(authorization);
    return token ? { source: 'bearer', token } : { source: 'invalid-authorization', token: null };
  }

  const token = readSessionCookie(request.headers);
  return token ? { source: 'cookie', token } : null;
}

export function readSessionToken(request: Request): string | null {
  return readSessionCredential(request)?.token ?? null;
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

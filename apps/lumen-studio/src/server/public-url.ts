import { getStudioServerConfig } from './config';

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first || null;
}

function hostnameFromHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (normalized.startsWith('[')) {
    const end = normalized.indexOf(']');
    return end > 0 ? normalized.slice(1, end) : normalized;
  }
  return normalized.split(':')[0] ?? normalized;
}

function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = hostnameFromHost(host);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isWildcardHost(host: string): boolean {
  const hostname = hostnameFromHost(host);
  return hostname === '0.0.0.0' || hostname === '::';
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

function protocolForRequest(request: Request, host: string | null): string {
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  if (forwardedProto) return forwardedProto;

  try {
    const protocol = new URL(request.url).protocol.replace(':', '');
    if (protocol === 'https' || isLocalHost(host)) return protocol;
  } catch {
    // Fall through to the public default.
  }

  return 'https';
}

export function getPublicAppOrigin(request: Request): string {
  const configuredOrigin = normalizeOrigin(getStudioServerConfig().NEXT_PUBLIC_APP_URL);
  if (configuredOrigin) return configuredOrigin;

  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const host = forwardedHost ?? firstHeaderValue(request.headers.get('host'));
  if (host && !isWildcardHost(host)) {
    return `${protocolForRequest(request, host)}://${host}`;
  }

  return new URL(request.url).origin;
}

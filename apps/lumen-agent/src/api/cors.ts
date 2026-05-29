import type { Context, Next } from 'hono';

export function cors(opts: { origins: string[] }) {
  const allowedOrigins = new Set(opts.origins);
  const allowAll = allowedOrigins.has('*');

  return async (c: Context, next: Next) => {
    const origin = c.req.header('origin') ?? '';

    if (c.req.method === 'OPTIONS') {
      const headers: Record<string, string> = {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization, last-event-id',
        'access-control-max-age': '86400',
      };
      if (allowAll) {
        headers['access-control-allow-origin'] = '*';
      } else if (allowedOrigins.has(origin)) {
        headers['access-control-allow-origin'] = origin;
        headers.vary = 'Origin';
      }
      return new Response(null, { status: 204, headers });
    }

    await next();

    if (allowAll) {
      c.header('access-control-allow-origin', '*');
    } else if (allowedOrigins.has(origin)) {
      c.header('access-control-allow-origin', origin);
      c.header('vary', 'Origin');
    }
  };
}

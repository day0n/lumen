import 'server-only';

import * as Sentry from '@sentry/nextjs';

export function traceStudioStep<T>(
  name: string,
  op: string,
  callback: () => T | Promise<T>,
  attributes: Record<string, string | number | boolean> = {},
): Promise<T> {
  return Promise.resolve(
    Sentry.startSpan(
      {
        name,
        op,
        attributes: {
          'lumen.surface': 'studio-server',
          ...attributes,
        },
      },
      callback,
    ),
  );
}

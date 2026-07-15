import { type ServerType, serve } from '@hono/node-server';

import { createApiApp } from './app.js';
import { readApiConfig } from './config.js';
import { createApiRuntime, initializeApiRuntimeWithRetry } from './runtime.js';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';
type ShutdownHandler = (signal: ShutdownSignal) => Promise<void>;

interface ShutdownOptions {
  closeRuntime: () => Promise<void>;
  forceExit?: (code: number) => void;
  logger?: Pick<Console, 'error' | 'info'>;
  server: ServerType;
  setExitCode?: (code: number) => void;
  timeoutMs: number;
}

interface InitializeThenStartOptions<T> {
  closeRuntime: () => Promise<void>;
  initialize: () => Promise<void>;
  start: () => T;
}

class ShutdownDeadlineError extends Error {}

export function createShutdownHandler({
  closeRuntime,
  forceExit = (code) => process.exit(code),
  logger = console,
  server,
  setExitCode = (code) => {
    process.exitCode = code;
  },
  timeoutMs,
}: ShutdownOptions): ShutdownHandler {
  let closing: Promise<void> | null = null;

  return (signal) => {
    closing ??= shutdownOnce({
      closeRuntime,
      forceExit,
      logger,
      server,
      setExitCode,
      signal,
      timeoutMs,
    });
    return closing;
  };
}

export function installShutdownHandlers(
  shutdown: ShutdownHandler,
  signalTarget: Pick<NodeJS.Process, 'off' | 'once'> = process,
) {
  const handleSigint = () => void shutdown('SIGINT');
  const handleSigterm = () => void shutdown('SIGTERM');
  signalTarget.once('SIGINT', handleSigint);
  signalTarget.once('SIGTERM', handleSigterm);

  return () => {
    signalTarget.off('SIGINT', handleSigint);
    signalTarget.off('SIGTERM', handleSigterm);
  };
}

export async function initializeThenStart<T>({
  closeRuntime,
  initialize,
  start,
}: InitializeThenStartOptions<T>): Promise<T> {
  try {
    await initialize();
  } catch (initializationError) {
    try {
      await closeRuntime();
    } catch (closeError) {
      throw new AggregateError(
        [initializationError, closeError],
        'API startup initialization and cleanup failed',
      );
    }
    throw initializationError;
  }

  return start();
}

export async function startApiServer() {
  const config = readApiConfig();
  const runtime = createApiRuntime(config);
  return initializeThenStart({
    closeRuntime: runtime.close,
    initialize: () => initializeApiRuntimeWithRetry(runtime.initialize),
    start: () => {
      const app = createApiApp({
        authenticatedUsers: runtime.authenticatedUsers,
        homeQueries: runtime.homeQueries,
        notifications: runtime.notifications,
        projectDetails: runtime.projectDetails,
        projectQueries: runtime.projectQueries,
        projectShares: runtime.projectShares,
        remakeJobQueries: runtime.remakeJobQueries,
        workflowStatusQueries: runtime.workflowStatusQueries,
        readiness: runtime.readiness,
        readinessTimeoutMs: config.readinessTimeoutMs,
        release: config.release,
        requiredReadinessChecks: ['mongo', 'workflowMongo', 'startup'],
        trustedCookieOrigins: config.identityAuthorizedParties,
      });

      const server = serve({
        fetch: app.fetch,
        hostname: config.host,
        port: config.port,
      });
      const shutdown = createShutdownHandler({
        closeRuntime: runtime.close,
        server,
        timeoutMs: config.shutdownTimeoutMs,
      });
      installShutdownHandlers(shutdown);

      console.info('[lumen-api] listening', {
        host: config.host,
        port: config.port,
        readinessTimeoutMs: config.readinessTimeoutMs,
        release: config.release,
        shutdownTimeoutMs: config.shutdownTimeoutMs,
      });

      return { app, server, shutdown };
    },
  });
}

async function shutdownOnce({
  closeRuntime,
  forceExit,
  logger,
  server,
  setExitCode,
  signal,
  timeoutMs,
}: Required<
  Pick<
    ShutdownOptions,
    'closeRuntime' | 'forceExit' | 'logger' | 'server' | 'setExitCode' | 'timeoutMs'
  >
> & {
  signal: ShutdownSignal;
}) {
  logger.info('[lumen-api] shutting down', { signal, timeoutMs });
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const gracefulShutdown = async () => {
    const shutdownErrors: unknown[] = [];
    try {
      await closeServer(server);
    } catch (error) {
      shutdownErrors.push(error);
    }
    try {
      await closeRuntime();
    } catch (error) {
      shutdownErrors.push(error);
    }
    if (shutdownErrors.length === 1) {
      throw shutdownErrors[0];
    }
    if (shutdownErrors.length > 1) {
      throw new AggregateError(shutdownErrors, 'API shutdown failed');
    }
  };

  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {
      const error = new ShutdownDeadlineError(`shutdown exceeded ${timeoutMs}ms`);
      forceCloseServer(server);
      logger.error('[lumen-api] shutdown deadline exceeded', { signal, timeoutMs });
      forceExit(1);
      reject(error);
    }, timeoutMs);
  });

  try {
    await Promise.race([gracefulShutdown(), deadline]);
  } catch (error) {
    if (!(error instanceof ShutdownDeadlineError)) {
      forceCloseServer(server);
      logger.error('[lumen-api] shutdown failed', { error, signal });
      setExitCode(1);
      forceExit(1);
    }
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

function closeServer(server: ServerType) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function forceCloseServer(server: ServerType) {
  if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
}

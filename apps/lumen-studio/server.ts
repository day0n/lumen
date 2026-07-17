import { AsyncLocalStorage } from 'node:async_hooks';
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parse } from 'node:url';

import { WebSocketServer } from 'ws';

type Runtime = {
  Sentry: typeof import('@sentry/nextjs');
  next: typeof import('next').default;
  warmupRepositories: typeof import('./src/server/db').warmupRepositories;
  logger: typeof import('./src/server/logger').logger;
  initRemakeEventMirror: typeof import('./src/server/remake/eventMirror').initRemakeEventMirror;
  stopRemakeEventMirror: typeof import('./src/server/remake/eventMirror').stopRemakeEventMirror;
  authenticateFlowUpgrade: typeof import('./src/server/ws/auth').authenticateFlowUpgrade;
  rejectUnauthorizedUpgrade: typeof import('./src/server/ws/auth').rejectUnauthorizedUpgrade;
  handleFlowConnection: typeof import('./src/server/ws/flow-gateway').handleFlowConnection;
  initFlowGateway: typeof import('./src/server/ws/flow-gateway').initFlowGateway;
  stopFlowGateway: typeof import('./src/server/ws/flow-gateway').stopFlowGateway;
};

type GlobalWithAsyncLocalStorage = typeof globalThis & {
  AsyncLocalStorage?: typeof AsyncLocalStorage;
};

(globalThis as GlobalWithAsyncLocalStorage).AsyncLocalStorage ??= AsyncLocalStorage;

const dev = process.env.NODE_ENV !== 'production';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';
const appDistDir = resolve(process.cwd(), '../lumen-app/dist');
const indexHtmlPath = resolve(appDistDir, 'index.html');

// Stat the SPA build at startup, not per-request. Each `/app/*` hit used
// to call existsSync(appDistDir) + existsSync(assetPath) + statSync().isFile()
// + existsSync(indexPath) — all SYNC fs syscalls that block the event
// loop. Under load they showed up as P99 latency on otherwise-fast WS
// heartbeats and API routes. Capture once on boot; the dist directory
// does not change while the process is running, and a missing build at
// startup is already the deploy.sh's responsibility.
const studioAppBuildAvailable = existsSync(appDistDir) && existsSync(indexHtmlPath);
if (!studioAppBuildAvailable) {
  // Don't fail-fast here — Next.js can still serve API routes without the
  // SPA bundle (this is also the legitimate state during a partial deploy).
  console.warn(
    `[lumen-studio] SPA build missing at ${appDistDir}; /app/* will return 503 until next deploy.`,
  );
}

let captureException = (_err: unknown) => {};
let logProcessError = (err: unknown, message: string) => {
  console.error(message, err);
};

// 进程级兜底：Redis/ioredis 在连接断开时会把在途命令以 "Connection is closed"
// 拒绝，若该命令是 fire-and-forget 就成为 unhandledRejection。Node 默认会因此
// 退出进程，触发 PM2 重启 + 冷启动延迟尖刺。这里捕获并上报，但保持进程存活——
// 这类错误不破坏进程状态，重启的代价远高于继续运行。
process.on('unhandledRejection', (reason) => {
  captureException(reason);
  logProcessError(reason, 'unhandledRejection (已兜底，进程继续)');
});
process.on('uncaughtException', (err) => {
  captureException(err);
  logProcessError(err, 'uncaughtException (已兜底，进程继续)');
});

async function main() {
  const {
    Sentry,
    next,
    warmupRepositories,
    logger,
    initRemakeEventMirror,
    stopRemakeEventMirror,
    authenticateFlowUpgrade,
    rejectUnauthorizedUpgrade,
    handleFlowConnection,
    initFlowGateway,
    stopFlowGateway,
  } = await loadRuntime();
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const upgradeHandler = app.getUpgradeHandler();
  let isShuttingDown = false;

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true);
    if (serveStudioApp(req.url ?? '/', res)) return;
    handle(req, res, parsedUrl);
  });

  initFlowGateway();
  initRemakeEventMirror();

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('lumen-flow-v1') ? 'lumen-flow-v1' : false),
  });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '');
    if (pathname === '/ws/flow') {
      void authenticateFlowUpgrade(req)
        .then((auth) => {
          if (!auth) {
            rejectUnauthorizedUpgrade(socket);
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            handleFlowConnection(ws, auth);
          });
        })
        .catch((err) => {
          Sentry.captureException(err);
          logger.warn({ err }, 'ws/flow upgrade auth failed');
          rejectUnauthorizedUpgrade(socket);
        });
      return;
    }
    upgradeHandler(req, socket, head);
  });

  server.listen(port, hostname, () => {
    logger.info({ url: `http://${hostname}:${port}` }, 'lumen-studio ready');
    logger.info('ws/flow gateway listening on /ws/flow');

    // 预热 Mongo 连接、索引和启动期数据，把冷启动开销从首个请求挪走。
    // fire-and-forget：失败会被记录但不影响已经开始监听的服务。
    void warmupRepositories()
      .then(() => logger.info('repositories warmed up'))
      .catch((err) => logger.warn({ err }, 'repository warmup failed (non-fatal)'));
  });

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'shutting down');
    await stopFlowGateway();
    await stopRemakeEventMirror();
    wss.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function serveStudioApp(rawUrl: string, res: import('node:http').ServerResponse) {
  const { pathname, search } = parse(rawUrl);
  const appPathname = normalizeStudioAppPath(pathname ?? '');
  if (!appPathname) return false;
  if (appPathname === '/app/dashboard') {
    res.statusCode = 308;
    res.setHeader('location', `/app/home${search ?? ''}`);
    res.setHeader('cache-control', 'public, max-age=3600');
    res.end();
    return true;
  }
  if (!studioAppBuildAvailable) {
    res.statusCode = 503;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Studio app build is not available.');
    return true;
  }

  const isHashedAsset = appPathname.startsWith('/app/assets/');
  const isPublicAsset = appPathname.startsWith('/app/home-posters/');
  if (isHashedAsset || isPublicAsset) {
    const assetPath = resolve(appDistDir, appPathname.slice('/app/'.length));
    if (!isPathInside(assetPath, appDistDir)) {
      res.statusCode = 404;
      res.end('Not found');
      return true;
    }
    // Skip the up-front existsSync/statSync; just open the stream and let
    // the OS tell us if the path is missing or is a directory. Headers are
    // set lazily on first byte so a 404 still gets a clean text/plain
    // response.
    res.setHeader(
      'cache-control',
      isHashedAsset
        ? 'public,max-age=31536000,immutable'
        : 'public,max-age=300,stale-while-revalidate=600',
    );
    res.setHeader('content-type', contentTypeFor(assetPath));
    const stream = createReadStream(assetPath);
    stream.once('error', (err: NodeJS.ErrnoException) => {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      res.removeHeader('cache-control');
      res.removeHeader('content-type');
      if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR') {
        res.statusCode = 404;
        res.end('Not found');
      } else {
        res.statusCode = 500;
        res.end('Internal server error');
      }
    });
    stream.pipe(res);
    return true;
  }

  res.setHeader('cache-control', 'no-cache');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  createReadStream(indexHtmlPath).pipe(res);
  return true;
}

// Defense against prefix-confusion path traversal: a previous version used
// `assetPath.startsWith(appDistDir)`, which would also accept paths inside
// any sibling directory whose name starts with the same prefix (e.g. a
// future `dist-staging/`). Using `path.relative` and rejecting paths that
// escape (`..`) or stay absolute is the canonical "is X strictly inside
// Y?" check on POSIX and Windows alike.
function isPathInside(child: string, parent: string) {
  const rel = relative(parent, child);
  if (!rel || rel === '.') return false; // do not serve the directory itself
  if (rel.startsWith(`..${sep}`) || rel === '..') return false;
  if (isAbsolute(rel)) return false;
  return true;
}

function normalizeStudioAppPath(pathname: string) {
  const appPath =
    pathname === '/app' || pathname.startsWith('/app/')
      ? pathname
      : pathname === '/zh/app' || pathname.startsWith('/zh/app/')
        ? pathname.slice(3) || '/app'
        : pathname === '/en/app' || pathname.startsWith('/en/app/')
          ? pathname.slice(3) || '/app'
          : null;
  if (!appPath) return null;
  // /app/api/* must reach Next.js handlers — serving SPA index.html here breaks JSON clients.
  if (appPath.startsWith('/app/api/')) return null;
  return appPath;
}

function contentTypeFor(filePath: string) {
  switch (extname(filePath)) {
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

main().catch((err) => {
  logProcessError(err, 'fatal: lumen-studio 启动失败');
  process.exit(1);
});

async function loadRuntime(): Promise<Runtime> {
  // 自定义 server 不经 instrumentation.ts register 钩子；先补齐 Next/Sentry
  // 需要的 AsyncLocalStorage runtime，再加载 @sentry/nextjs 和 next。
  await import('./src/sentry.server.config');

  const [
    Sentry,
    nextModule,
    dbModule,
    loggerModule,
    eventMirrorModule,
    wsAuthModule,
    flowGatewayModule,
  ] = await Promise.all([
    import('@sentry/nextjs'),
    import('next'),
    import('./src/server/db'),
    import('./src/server/logger'),
    import('./src/server/remake/eventMirror'),
    import('./src/server/ws/auth'),
    import('./src/server/ws/flow-gateway'),
  ]);

  captureException =
    typeof Sentry.captureException === 'function' ? Sentry.captureException : (_err: unknown) => {};
  logProcessError = (err, message) => loggerModule.logger.error({ err }, message);

  return {
    Sentry,
    next: nextModule.default,
    warmupRepositories: dbModule.warmupRepositories,
    logger: loggerModule.logger,
    initRemakeEventMirror: eventMirrorModule.initRemakeEventMirror,
    stopRemakeEventMirror: eventMirrorModule.stopRemakeEventMirror,
    authenticateFlowUpgrade: wsAuthModule.authenticateFlowUpgrade,
    rejectUnauthorizedUpgrade: wsAuthModule.rejectUnauthorizedUpgrade,
    handleFlowConnection: flowGatewayModule.handleFlowConnection,
    initFlowGateway: flowGatewayModule.initFlowGateway,
    stopFlowGateway: flowGatewayModule.stopFlowGateway,
  };
}

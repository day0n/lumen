import { AsyncLocalStorage } from 'node:async_hooks';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
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

    // 预热 Mongo 连接 + 索引，把冷启动开销从首个用户请求挪到启动期。
    // fire-and-forget：失败不影响服务，懒加载 getter 会按需重试。
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
  const { pathname } = parse(rawUrl);
  const appPathname = normalizeStudioAppPath(pathname ?? '');
  if (!appPathname) return false;
  if (!existsSync(appDistDir)) {
    res.statusCode = 503;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Studio app build is not available.');
    return true;
  }

  if (appPathname.startsWith('/app/assets/')) {
    const assetPath = resolve(appDistDir, appPathname.slice('/app/'.length));
    if (
      !assetPath.startsWith(appDistDir) ||
      !existsSync(assetPath) ||
      !statSync(assetPath).isFile()
    ) {
      res.statusCode = 404;
      res.end('Not found');
      return true;
    }
    res.setHeader('cache-control', 'public,max-age=31536000,immutable');
    res.setHeader('content-type', contentTypeFor(assetPath));
    createReadStream(assetPath).pipe(res);
    return true;
  }

  const indexPath = resolve(appDistDir, 'index.html');
  if (!existsSync(indexPath)) {
    res.statusCode = 503;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Studio app index is not available.');
    return true;
  }
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  createReadStream(indexPath).pipe(res);
  return true;
}

function normalizeStudioAppPath(pathname: string) {
  if (pathname === '/app' || pathname.startsWith('/app/')) return pathname;
  if (pathname === '/zh/app' || pathname.startsWith('/zh/app/')) return pathname.slice(3) || '/app';
  if (pathname === '/en/app' || pathname.startsWith('/en/app/')) return pathname.slice(3) || '/app';
  return null;
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

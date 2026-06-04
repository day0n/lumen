// ⚠ 必须第一行：在 next() / WS gateway 之前 init Sentry（自定义 server 不经
// instrumentation.ts register 钩子，WS gateway 也不在 Next 请求链里）。
import './src/sentry.server.config';

import { createServer } from 'node:http';
import { parse } from 'node:url';

import * as Sentry from '@sentry/nextjs';
import next from 'next';
import { WebSocketServer } from 'ws';

import { warmupRepositories } from './src/server/db';
import { logger } from './src/server/logger';
import { initRemakeEventMirror, stopRemakeEventMirror } from './src/server/remake/eventMirror';
import { authenticateFlowUpgrade, rejectUnauthorizedUpgrade } from './src/server/ws/auth';
import {
  handleFlowConnection,
  initFlowGateway,
  stopFlowGateway,
} from './src/server/ws/flow-gateway';

const dev = process.env.NODE_ENV !== 'production';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';

// 进程级兜底：Redis/ioredis 在连接断开时会把在途命令以 "Connection is closed"
// 拒绝，若该命令是 fire-and-forget 就成为 unhandledRejection。Node 默认会因此
// 退出进程，触发 PM2 重启 + 冷启动延迟尖刺。这里捕获并上报，但保持进程存活——
// 这类错误不破坏进程状态，重启的代价远高于继续运行。
process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason);
  logger.error({ err: reason }, 'unhandledRejection (已兜底，进程继续)');
});
process.on('uncaughtException', (err) => {
  Sentry.captureException(err);
  logger.error({ err }, 'uncaughtException (已兜底，进程继续)');
});

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const upgradeHandler = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true);
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

main().catch((err) => {
  logger.error({ err }, 'fatal: lumen-studio 启动失败');
  process.exit(1);
});

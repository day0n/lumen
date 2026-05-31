// ⚠ 必须第一行：在 next() / WS gateway 之前 init Sentry（自定义 server 不经
// instrumentation.ts register 钩子，WS gateway 也不在 Next 请求链里）。
import './src/sentry.server.config';

import { createServer } from 'node:http';
import { parse } from 'node:url';

import next from 'next';
import { WebSocketServer } from 'ws';

import { warmStudioRepositories } from './src/server/db';
import { logger } from './src/server/logger';
import {
  handleFlowConnection,
  initFlowGateway,
  stopFlowGateway,
} from './src/server/ws/flow-gateway';

const dev = process.env.NODE_ENV !== 'production';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const warmupStartedAt = Date.now();
  await warmStudioRepositories();
  logger.info(
    { durationMs: Date.now() - warmupStartedAt },
    'studio repositories warmed before listen',
  );
  const upgradeHandler = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true);
    handle(req, res, parsedUrl);
  });

  initFlowGateway();

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => handleFlowConnection(ws));

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '');
    if (pathname === '/ws/flow') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }
    upgradeHandler(req, socket, head);
  });

  server.listen(port, hostname, () => {
    logger.info({ url: `http://${hostname}:${port}` }, 'lumen-studio ready');
    logger.info('ws/flow gateway listening on /ws/flow');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await stopFlowGateway();
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

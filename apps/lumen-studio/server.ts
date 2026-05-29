import { createServer } from 'node:http';
import { parse } from 'node:url';

import next from 'next';
import { WebSocketServer } from 'ws';

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
    console.log(`> lumen-studio ready on http://${hostname}:${port}`);
    console.log('> ws/flow gateway listening on /ws/flow');
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    await stopFlowGateway();
    wss.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal: lumen-studio 启动失败', err);
  process.exit(1);
});

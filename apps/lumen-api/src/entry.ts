import { startApiServer } from './main.js';

void startApiServer().catch((error) => {
  console.error('[lumen-api] startup failed', { error });
  process.exitCode = 1;
});

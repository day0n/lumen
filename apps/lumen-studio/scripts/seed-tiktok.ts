/**
 * Batch-ingest TikTok URLs by hitting the running dev server's
 * /api/hot-videos/parse-link endpoint. This way the script reuses the
 * exact same Apify → R2 → Mongo pipeline as the UI, and avoids importing
 * `server-only`-tagged modules from a Node CLI context.
 *
 * Prereq: `pnpm dev` is running on http://localhost:3000.
 *
 * Usage:
 *   cd apps/lumen-studio
 *   # 把传入的链接逐条投递；--reset-mock 会先删掉历史 mock 数据
 *   pnpm seed:tiktok --reset-mock https://www.tiktok.com/@user/video/123 https://...
 *   # 或者放在 scripts/tiktok-urls.txt（每行一条），不传参数也行
 *   pnpm seed:tiktok
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as dotenvConfig } from 'dotenv';

const envFile = resolve(process.cwd(), '.env.local');
if (existsSync(envFile)) {
  dotenvConfig({ path: envFile });
}

const args = process.argv.slice(2);
const resetMock = args.includes('--reset-mock');
const inlineUrls = args.filter((arg) => arg.startsWith('http'));
const baseUrl = process.env.LUMEN_STUDIO_URL?.trim() || 'http://localhost:3000';

const urlFile = resolve(process.cwd(), 'scripts/tiktok-urls.txt');

function loadUrls(): string[] {
  if (inlineUrls.length > 0) return inlineUrls;
  if (!existsSync(urlFile)) return [];
  return readFileSync(urlFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

async function deleteMockSeeds(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB ?? 'lumen_app';
  if (!uri) throw new Error('MONGODB_URI is required');
  const { getMongoDatabase, getRedisClient } = await import('@lumen/db');
  const db = await getMongoDatabase({ uri, dbName, appName: 'lumen-studio-seed' });
  const result = await db.collection('studio_hot_videos').deleteMany({ source_platform: 'manual' });
  console.log(`[seed:tiktok] 删除 ${result.deletedCount} 条 sourcePlatform="manual" 数据`);

  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    const redis = getRedisClient({ url: redisUrl, keyPrefix: 'lumen:studio:' });
    if (redis) {
      const keys = await redis.keys('lumen:studio:hot-videos:list:*');
      if (keys.length > 0) {
        const bare = keys.map((k) => k.replace('lumen:studio:', ''));
        await redis.del(...bare);
        console.log(`[seed:tiktok] 清空 ${bare.length} 个列表缓存键`);
      }
    }
  }
}

async function ingestOne(
  url: string,
): Promise<{ status: 'new' | 'exists' | 'error'; detail: string }> {
  const response = await fetch(`${baseUrl}/api/hot-videos/parse-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  let payload: {
    ok: boolean;
    data?: { id: string; createdAt: string };
    error?: { message?: string };
  };
  try {
    payload = await response.json();
  } catch {
    return { status: 'error', detail: `响应解析失败 (status=${response.status})` };
  }

  if (!response.ok || !payload.ok || !payload.data) {
    return { status: 'error', detail: payload.error?.message ?? `HTTP ${response.status}` };
  }

  const isNew = new Date(payload.data.createdAt).getTime() > Date.now() - 60_000;
  return {
    status: isNew ? 'new' : 'exists',
    detail: payload.data.id,
  };
}

async function main() {
  if (resetMock) {
    await deleteMockSeeds();
  }

  const urls = loadUrls();
  if (urls.length === 0) {
    if (!resetMock) {
      console.error(
        '[seed:tiktok] 没有 URL 输入。请在命令后追加链接，或在 scripts/tiktok-urls.txt 写每行一条。',
      );
      process.exit(1);
    }
    console.log('[seed:tiktok] reset-only run, 没有 URL 要导入');
    return;
  }

  // Ping the dev server first.
  try {
    const ping = await fetch(`${baseUrl}/api/hot-videos?limit=1`);
    if (!ping.ok) {
      throw new Error(`status=${ping.status}`);
    }
  } catch (error) {
    console.error(
      `[seed:tiktok] 无法访问 ${baseUrl}/api/hot-videos. 请先在另一个终端跑 pnpm dev. 错误:`,
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, url] of urls.entries()) {
    const tag = `[${index + 1}/${urls.length}]`;
    console.log(`${tag} ${url}`);
    const result = await ingestOne(url);
    if (result.status === 'new') {
      ok += 1;
      console.log(`${tag}   ✓ 新增 ${result.detail}`);
    } else if (result.status === 'exists') {
      skipped += 1;
      console.log(`${tag}   - 已存在 ${result.detail}`);
    } else {
      failed += 1;
      console.error(`${tag}   ✗ 失败: ${result.detail}`);
    }
  }

  console.log(`[seed:tiktok] done. 新增=${ok} 已存在=${skipped} 失败=${failed}`);
}

main()
  .catch((error) => {
    console.error('[seed:tiktok] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Ensure Mongo / Redis clients opened by deleteMockSeeds() don't keep the
    // process hanging after work is done.
    try {
      const { closeMongoDatabases, closeRedisClients } = await import('@lumen/db');
      await closeMongoDatabases();
      await closeRedisClients();
    } catch {
      // ignore close errors
    }
  });

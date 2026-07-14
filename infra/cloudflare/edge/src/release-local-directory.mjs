import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function ensureSafeDirectoryChain({ baseDirectory, segments, create = false }) {
  if (!path.isAbsolute(baseDirectory) || !Array.isArray(segments)) {
    throw new Error('safe directory chain requires an absolute base and path segments');
  }

  let currentDirectory = baseDirectory;
  await requireDirectory(currentDirectory, 'safe directory base');
  for (const segment of segments) {
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\')
    ) {
      throw new Error(`unsafe directory segment: ${segment}`);
    }
    currentDirectory = path.join(currentDirectory, segment);
    let stats = await lstat(currentDirectory).catch(() => null);
    if (!stats && create) {
      await mkdir(currentDirectory);
      stats = await lstat(currentDirectory).catch(() => null);
    }
    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`release directory chain is missing or unsafe: ${currentDirectory}`);
    }
  }
  return currentDirectory;
}

async function requireDirectory(directory, label) {
  const stats = await lstat(directory).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is missing or unsafe: ${directory}`);
  }
}

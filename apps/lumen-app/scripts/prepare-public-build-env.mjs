import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_KEYS = ['VITE_CLERK_PUBLISHABLE_KEY', 'VITE_SENTRY_DSN'];

export async function preparePublicBuildEnv({ outputPath, sourcePath }) {
  if (!sourcePath || !outputPath) {
    throw new Error('sourcePath and outputPath are required');
  }

  process.loadEnvFile(sourcePath);
  const values = {
    NEXT_PUBLIC_AGENT_URL: process.env.NEXT_PUBLIC_AGENT_URL?.trim() || '',
    VITE_CLERK_PUBLISHABLE_KEY:
      process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
      '',
    VITE_SENTRY_DSN:
      process.env.VITE_SENTRY_DSN?.trim() ||
      process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() ||
      process.env.SENTRY_DSN?.trim() ||
      '',
    VITE_SENTRY_ENVIRONMENT:
      process.env.VITE_SENTRY_ENVIRONMENT?.trim() ||
      process.env.SENTRY_ENVIRONMENT?.trim() ||
      'production',
    VITE_SENTRY_TRACES_SAMPLE_RATE:
      process.env.VITE_SENTRY_TRACES_SAMPLE_RATE?.trim() ||
      process.env.SENTRY_TRACES_SAMPLE_RATE?.trim() ||
      '0.1',
  };
  const missing = REQUIRED_KEYS.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`required frontend build configuration is missing: ${missing.join(', ')}`);
  }

  const contents = `${Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n')}\n`;
  const resolvedOutputPath = path.resolve(outputPath);
  const temporaryPath = `${resolvedOutputPath}.${process.pid}.tmp`;
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, contents, { flag: 'wx', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, resolvedOutputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function readArguments(argv) {
  const argumentsByName = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) {
      throw new Error('usage: prepare-public-build-env --source <path> --output <path>');
    }
    argumentsByName.set(name.slice(2), value);
  }
  return {
    outputPath: argumentsByName.get('output'),
    sourcePath: argumentsByName.get('source'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePublicBuildEnv(readArguments(process.argv.slice(2))).catch((error) => {
    console.error(`[lumen-app] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

import 'server-only';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getR2Settings } from './objectStorage';
import { getStudioProject } from './projects';

const execFileAsync = promisify(execFile);

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
];

export async function isProbeUrlAllowed(url: string, projectId?: string | null): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) return false;

  const normalized = parsed.toString();
  const r2 = getR2Settings();
  if (r2?.publicBaseUrl && normalized.startsWith(r2.publicBaseUrl)) {
    return true;
  }

  if (!projectId) return false;
  const project = await getStudioProject(projectId);
  if (!project?.canvas?.nodes) return false;

  const allowed = new Set<string>();
  for (const node of project.canvas.nodes) {
    const output = node.data?.output;
    if (typeof output === 'string' && output.trim()) {
      allowed.add(output.trim());
    }
    const settings = node.data?.settings;
    if (settings && typeof settings === 'object') {
      for (const value of Object.values(settings)) {
        if (typeof value === 'string' && value.startsWith('http')) {
          allowed.add(value.trim());
        }
      }
    }
  }

  return allowed.has(normalized);
}

export async function probeRemoteMediaDuration(url: string): Promise<number> {
  const ffprobePath = process.env.VIDEO_EDIT_FFPROBE_PATH?.trim() || 'ffprobe';
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      url,
    ],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );

  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('invalid probe duration');
  }
  return duration;
}

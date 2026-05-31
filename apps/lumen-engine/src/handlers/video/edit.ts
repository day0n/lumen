import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import type { VideoClipInput } from '@lumen/shared/domain';
import { config } from '../../config.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { NodeOutput } from '../base.js';

interface PreparedClip {
  index: number;
  inputPath: string;
  sourceUrl: string;
  start: number;
  duration: number;
  volume: number;
  hasAudio: boolean;
}

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface ProbeResult {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
  };
}

const SUPPORTED_ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1', '4:5']);

export async function execute(
  input: ResolvedInput,
  settings: Record<string, unknown>,
): Promise<NodeOutput> {
  const clips = collectClips(input);
  if (clips.length === 0) {
    throw new Error('lumen-video-edit requires at least one input video');
  }
  if (clips.length > config.VIDEO_EDIT_MAX_CLIPS) {
    throw new Error(`lumen-video-edit supports at most ${config.VIDEO_EDIT_MAX_CLIPS} clips`);
  }

  const workdir = await mkdtemp(join(tmpdir(), 'lumen-video-edit-'));
  const prepared: PreparedClip[] = [];

  logger.info({ clipCount: clips.length, workdir }, 'starting lumen video edit');

  for (const [index, clip] of clips.entries()) {
    const inputPath = await downloadClip(clip.url, workdir, index);
    const metadata = await probeClip(inputPath);
    const sourceDuration = readDuration(metadata);
    const start = clampNumber(clip.start ?? 0, 0, Math.max(sourceDuration - 0.1, 0));
    const requestedDuration = clip.duration;
    const duration = clampNumber(
      requestedDuration ?? sourceDuration - start,
      0.1,
      Math.max(sourceDuration - start, 0.1),
    );
    prepared.push({
      index,
      inputPath,
      sourceUrl: clip.url,
      start,
      duration,
      volume: clampNumber(clip.volume ?? 1, 0, 1),
      hasAudio: Boolean(metadata.streams?.some((stream) => stream.codec_type === 'audio')),
    });
  }

  const totalDuration = prepared.reduce((sum, clip) => sum + clip.duration, 0);
  if (totalDuration > config.VIDEO_EDIT_MAX_DURATION_SECONDS) {
    throw new Error(
      `lumen-video-edit output is too long (${totalDuration.toFixed(1)}s > ${config.VIDEO_EDIT_MAX_DURATION_SECONDS}s)`,
    );
  }

  const outputPath = join(workdir, 'final.mp4');
  const dimensions = resolveOutputDimensions(settings);
  const fps = resolveFps(settings);

  await renderConcat({
    clips: prepared,
    outputPath,
    width: dimensions.width,
    height: dimensions.height,
    fps,
  });

  logger.info(
    {
      clipCount: prepared.length,
      totalDuration,
      outputPath,
      width: dimensions.width,
      height: dimensions.height,
      fps,
    },
    'lumen video edit rendered',
  );

  return { type: 'video', value: pathToFileURL(outputPath).toString() };
}

function collectClips(input: ResolvedInput): VideoClipInput[] {
  const byUrl = new Set<string>();
  const result: VideoClipInput[] = [];

  const add = (clip: VideoClipInput) => {
    const url = clip.url.trim();
    if (!url || byUrl.has(url)) return;
    byUrl.add(url);
    result.push({ ...clip, url });
  };

  for (const clip of input.clips) add(clip);
  for (const url of input.videos) add({ url });
  if (input.video) add({ url: input.video });

  return result;
}

async function downloadClip(url: string, workdir: string, index: number): Promise<string> {
  if (url.startsWith('data:video/')) {
    const parsed = parseVideoDataUrl(url);
    const path = join(workdir, `clip-${index}.${parsed.extension}`);
    await writeFile(path, parsed.body);
    return path;
  }

  if (!isHttpUrl(url)) {
    throw new Error(`unsupported video input URL for clip ${index + 1}`);
  }

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      accept: 'video/*,*/*',
    },
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    throw new Error(`failed to download clip ${index + 1}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const maxBytes = config.VIDEO_EDIT_MAX_INPUT_MB * 1024 * 1024;
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `clip ${index + 1} is too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB > ${config.VIDEO_EDIT_MAX_INPUT_MB}MB)`,
    );
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const extension = extensionFor(contentType, url);
  const path = join(workdir, `clip-${index}.${extension}`);
  await writeFile(path, bytes);
  return path;
}

function parseVideoDataUrl(value: string): { body: Buffer; extension: string } {
  const match = /^data:(video\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(value);
  if (!match) throw new Error('invalid video data URL');
  const mimeType = match[1] ?? 'video/mp4';
  const payload = match[2] ?? '';
  return {
    body: Buffer.from(payload.replace(/\s/g, ''), 'base64'),
    extension: extensionFor(mimeType, ''),
  };
}

async function probeClip(path: string): Promise<ProbeResult> {
  const output = await runCommand(config.VIDEO_EDIT_FFPROBE_PATH, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path,
  ]);
  try {
    return JSON.parse(output.stdout) as ProbeResult;
  } catch {
    throw new Error('failed to parse ffprobe output');
  }
}

function readDuration(metadata: ProbeResult): number {
  const videoStream = metadata.streams?.find((stream) => stream.codec_type === 'video');
  const values = [videoStream?.duration, metadata.format?.duration];
  for (const value of values) {
    const parsed = typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  throw new Error('input video duration is unknown');
}

async function renderConcat(input: {
  clips: PreparedClip[];
  outputPath: string;
  width: number;
  height: number;
  fps: number;
}) {
  await mkdir(join(input.outputPath, '..'), { recursive: true }).catch(() => undefined);
  const args = ['-y', '-hide_banner'];
  for (const clip of input.clips) {
    args.push('-i', clip.inputPath);
  }

  args.push(
    '-filter_complex',
    buildFilterComplex(input.clips, input.width, input.height, input.fps),
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    input.outputPath,
  );

  await runCommand(config.VIDEO_EDIT_FFMPEG_PATH, args, 20 * 60 * 1000);
}

function buildFilterComplex(
  clips: PreparedClip[],
  width: number,
  height: number,
  fps: number,
): string {
  const chains: string[] = [];
  for (const clip of clips) {
    const trim = `start=${formatSeconds(clip.start)}:duration=${formatSeconds(clip.duration)}`;
    chains.push(
      `[${clip.index}:v]trim=${trim},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${clip.index}]`,
    );

    if (clip.hasAudio) {
      chains.push(
        `[${clip.index}:a]atrim=${trim},asetpts=PTS-STARTPTS,aresample=48000,volume=${formatVolume(clip.volume)}[a${clip.index}]`,
      );
    } else {
      chains.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatSeconds(clip.duration)},asetpts=PTS-STARTPTS[a${clip.index}]`,
      );
    }
  }

  const concatInputs = clips.map((clip) => `[v${clip.index}][a${clip.index}]`).join('');
  chains.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[v][a]`);
  return chains.join(';');
}

function resolveOutputDimensions(settings: Record<string, unknown>): {
  width: number;
  height: number;
} {
  const aspectRatio = readStringSetting(settings, 'aspectRatio') ?? '9:16';
  const ratio = SUPPORTED_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : '9:16';
  const resolution = readStringSetting(settings, 'resolution') ?? '720p';
  const longEdge = resolution === '1080p' ? 1920 : 1280;

  switch (ratio) {
    case '16:9':
      return { width: longEdge, height: Math.round((longEdge * 9) / 16) };
    case '1:1':
      return { width: longEdge, height: longEdge };
    case '4:5':
      return { width: Math.round((longEdge * 4) / 5), height: longEdge };
    case '9:16':
    default:
      return { width: Math.round((longEdge * 9) / 16), height: longEdge };
  }
}

function resolveFps(settings: Record<string, unknown>): number {
  const raw = settings.fps;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return 30;
  return Math.max(15, Math.min(30, Math.round(value)));
}

function readStringSetting(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extensionFor(contentType: string, url: string): string {
  switch (contentType.toLowerCase()) {
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
  }

  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
    if (ext && ['mp4', 'webm', 'mov'].includes(ext)) return ext;
  } catch {
    // Fall through to mp4.
  }
  return 'mp4';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(value, max));
}

function formatSeconds(value: number): string {
  return Math.max(0, value)
    .toFixed(3)
    .replace(/\.?0+$/, '');
}

function formatVolume(value: number): string {
  return clampNumber(value, 0, 1)
    .toFixed(3)
    .replace(/\.?0+$/, '');
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolve({ stdout: out, stderr: err });
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${err.slice(-2000)}`));
    });
  });
}

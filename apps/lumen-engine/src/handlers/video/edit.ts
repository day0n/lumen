import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { VideoClipInput } from '@lumen/shared/domain';
import { config } from '../../config.js';
import {
  WorkflowCancelledError,
  cancellationReason,
  throwIfCancelled,
} from '../../engine/cancellation.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { ExecutionContext, NodeOutput } from '../base.js';

interface PreparedClip {
  index: number;
  inputPath: string;
  sourceUrl: string;
  start: number;
  duration: number;
  volume: number;
  title?: string;
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
const SUBTITLE_FONT_CANDIDATES = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/STHeiti Light.ttc',
];

export async function execute(
  input: ResolvedInput,
  settings: Record<string, unknown>,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  const { signal } = context;
  throwIfCancelled(signal);
  const clips = collectClips(input);
  if (clips.length === 0) {
    throw new Error('lumen-video-edit requires at least one input video');
  }
  if (clips.length > config.VIDEO_EDIT_MAX_CLIPS) {
    throw new Error(`lumen-video-edit supports at most ${config.VIDEO_EDIT_MAX_CLIPS} clips`);
  }

  const workdir = await mkdtemp(join(tmpdir(), 'lumen-video-edit-'));
  const prepared: PreparedClip[] = [];
  const trimHeadSeconds = readNumberSetting(settings, 'trimHeadSeconds') ?? 0;
  const clipTitles = readStringArraySetting(settings, 'clipTitles');
  // 复刻场景混音节点会用 defaultClipVolume=0 静音 veo 源音，让 TTS 主导。
  // 普通拼接默认 1.0 不影响老画布。
  const defaultClipVolume = readNumberSetting(settings, 'defaultClipVolume') ?? 1;

  logger.info({ clipCount: clips.length, workdir }, 'starting lumen video edit');

  for (const [index, clip] of clips.entries()) {
    throwIfCancelled(signal);
    const inputPath = await downloadClip(clip.url, workdir, index, signal);
    const metadata = await probeClip(inputPath, signal);
    const sourceDuration = readDuration(metadata);
    const start = clampNumber(clip.start ?? trimHeadSeconds, 0, Math.max(sourceDuration - 0.1, 0));
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
      volume: clampNumber(clip.volume ?? defaultClipVolume, 0, 1),
      ...resolveOptionalTitle(clip.title ?? clipTitles[index]),
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
  const bgmPath = await downloadFirstAudio(input, workdir, signal);

  await renderConcat({
    clips: prepared,
    outputPath,
    width: dimensions.width,
    height: dimensions.height,
    fps,
    bgmPath,
    settings,
    signal,
  });

  logger.info(
    {
      clipCount: prepared.length,
      totalDuration,
      outputPath,
      width: dimensions.width,
      height: dimensions.height,
      fps,
      hasBgm: Boolean(bgmPath),
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

async function downloadFirstAudio(
  input: ResolvedInput,
  workdir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const audioUrl = input.audio ?? input.audios[0];
  if (!audioUrl) return null;
  return downloadAudio(audioUrl, workdir, signal);
}

async function downloadClip(
  url: string,
  workdir: string,
  index: number,
  signal?: AbortSignal,
): Promise<string> {
  throwIfCancelled(signal);
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
    signal: timeoutSignal(300_000, signal),
  });
  if (!response.ok) {
    throw new Error(`failed to download clip ${index + 1}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  throwIfCancelled(signal);
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

async function downloadAudio(url: string, workdir: string, signal?: AbortSignal): Promise<string> {
  throwIfCancelled(signal);
  if (url.startsWith('data:audio/')) {
    const parsed = parseAudioDataUrl(url);
    const path = join(workdir, `bgm.${parsed.extension}`);
    await writeFile(path, parsed.body);
    return path;
  }

  if (!isHttpUrl(url)) {
    throw new Error('unsupported audio input URL for background music');
  }

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      accept: 'audio/*,*/*',
    },
    signal: timeoutSignal(300_000, signal),
  });
  if (!response.ok) {
    throw new Error(`failed to download background music: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  throwIfCancelled(signal);
  const maxBytes = config.VIDEO_EDIT_MAX_INPUT_MB * 1024 * 1024;
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `background music is too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB > ${config.VIDEO_EDIT_MAX_INPUT_MB}MB)`,
    );
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const extension = audioExtensionFor(contentType, url);
  const path = join(workdir, `bgm.${extension}`);
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

function parseAudioDataUrl(value: string): { body: Buffer; extension: string } {
  const match = /^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(value);
  if (!match) throw new Error('invalid audio data URL');
  const mimeType = match[1] ?? 'audio/mpeg';
  const payload = match[2] ?? '';
  return {
    body: Buffer.from(payload.replace(/\s/g, ''), 'base64'),
    extension: audioExtensionFor(mimeType, ''),
  };
}

async function probeClip(path: string, signal?: AbortSignal): Promise<ProbeResult> {
  const output = await runCommand(
    config.VIDEO_EDIT_FFPROBE_PATH,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    60_000,
    signal,
  );
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
    const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
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
  bgmPath: string | null;
  settings: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  await mkdir(join(input.outputPath, '..'), { recursive: true }).catch(() => undefined);
  const args = ['-y', '-hide_banner'];
  for (const clip of input.clips) {
    args.push('-i', clip.inputPath);
  }
  const bgmInputIndex = input.bgmPath ? input.clips.length : null;
  if (input.bgmPath) {
    args.push('-i', input.bgmPath);
  }

  args.push(
    '-filter_complex',
    buildFilterComplex({
      clips: input.clips,
      width: input.width,
      height: input.height,
      fps: input.fps,
      bgmInputIndex,
      settings: input.settings,
    }),
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

  await runCommand(config.VIDEO_EDIT_FFMPEG_PATH, args, 20 * 60 * 1000, input.signal);
}

function buildFilterComplex(input: {
  clips: PreparedClip[];
  width: number;
  height: number;
  fps: number;
  bgmInputIndex: number | null;
  settings: Record<string, unknown>;
}): string {
  const chains: string[] = [];
  const renderSubtitles = readBooleanSetting(input.settings, 'renderSubtitles');
  const flashTransition = readBooleanSetting(input.settings, 'flashTransition');
  const bgmVolume = readNumberSetting(input.settings, 'bgmVolume') ?? 0.28;
  const subtitleFontFile = resolveSubtitleFontFile(input.settings);

  for (const clip of input.clips) {
    const trim = `start=${formatSeconds(clip.start)}:duration=${formatSeconds(clip.duration)}`;
    const videoFilters = [
      `trim=${trim}`,
      'setpts=PTS-STARTPTS',
      `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease`,
      `pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2`,
      'setsar=1',
      `fps=${input.fps}`,
    ];

    if (flashTransition) {
      const fadeDuration = Math.min(0.12, Math.max(0.04, clip.duration / 5));
      videoFilters.push(`fade=t=in:st=0:d=${formatSeconds(fadeDuration)}:color=white`);
      if (clip.duration > fadeDuration * 2) {
        videoFilters.push(
          `fade=t=out:st=${formatSeconds(clip.duration - fadeDuration)}:d=${formatSeconds(fadeDuration)}:color=white`,
        );
      }
    }

    if (renderSubtitles && clip.title?.trim()) {
      const fontSize = Math.max(24, Math.round(input.height * 0.032));
      const bottomOffset = Math.max(96, Math.round(input.height * 0.145));
      videoFilters.push(buildSubtitleFilter(clip.title, fontSize, bottomOffset, subtitleFontFile));
    }

    videoFilters.push('format=yuv420p');
    chains.push(`[${clip.index}:v]${videoFilters.join(',')}[v${clip.index}]`);

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

  const concatInputs = input.clips.map((clip) => `[v${clip.index}][a${clip.index}]`).join('');
  if (input.bgmInputIndex === null) {
    chains.push(`${concatInputs}concat=n=${input.clips.length}:v=1:a=1[v][a]`);
    return chains.join(';');
  }

  const totalDuration = input.clips.reduce((sum, clip) => sum + clip.duration, 0);
  chains.push(`${concatInputs}concat=n=${input.clips.length}:v=1:a=1[v][acat]`);
  chains.push(
    `[${input.bgmInputIndex}:a]aresample=48000,volume=${formatVolume(bgmVolume)},atrim=duration=${formatSeconds(totalDuration)},asetpts=PTS-STARTPTS[bgm]`,
  );
  chains.push('[acat][bgm]amix=inputs=2:duration=first:dropout_transition=0[a]');
  return chains.join(';');
}

function buildSubtitleFilter(
  text: string,
  fontSize: number,
  bottomOffset: number,
  fontFile: string | null,
): string {
  const parts: string[] = [];
  if (fontFile) parts.push(`fontfile='${escapeDrawtextText(fontFile)}'`);
  parts.push(
    `text='${escapeDrawtextText(text)}'`,
    'x=(w-text_w)/2',
    `y=h-${bottomOffset}`,
    `fontsize=${fontSize}`,
    'fontcolor=white',
    'box=1',
    'boxcolor=black@0.42',
    'boxborderw=18',
  );
  return `drawtext=${parts.join(':')}`;
}

function resolveSubtitleFontFile(settings: Record<string, unknown>): string | null {
  const configured = readStringSetting(settings, 'fontFile') ?? config.VIDEO_EDIT_FONT_FILE;
  const candidates = [configured, ...SUBTITLE_FONT_CANDIDATES]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
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
    default:
      return { width: Math.round((longEdge * 9) / 16), height: longEdge };
  }
}

function resolveFps(settings: Record<string, unknown>): number {
  const raw = settings.fps;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) return 30;
  return Math.max(15, Math.min(30, Math.round(value)));
}

function readStringSetting(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumberSetting(settings: Record<string, unknown>, key: string): number | null {
  const value = settings[key];
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function readBooleanSetting(settings: Record<string, unknown>, key: string): boolean {
  const value = settings[key];
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  const lowered = value.trim().toLowerCase();
  return lowered === 'true' || lowered === '1' || lowered === 'yes';
}

function readStringArraySetting(settings: Record<string, unknown>, key: string): string[] {
  const value = settings[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function resolveOptionalTitle(
  value: string | undefined,
): Pick<PreparedClip, 'title'> | Record<string, never> {
  const title = value?.trim();
  return title ? { title } : {};
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

function audioExtensionFor(contentType: string, url: string): string {
  switch (contentType.toLowerCase()) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/aac':
      return 'aac';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/flac':
      return 'flac';
  }

  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
    if (ext && ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(ext)) return ext;
  } catch {
    // Fall through to mp3.
  }
  return 'mp3';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
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

function escapeDrawtextText(value: string): string {
  return value
    .slice(0, 120)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, ' ');
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      reject(new WorkflowCancelledError(cancellationReason(signal)));
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
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

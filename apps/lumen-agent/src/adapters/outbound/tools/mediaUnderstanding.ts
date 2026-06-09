/**
 * inspect_media —— 调 Vertex Gemini 多模态分析视频/图像/音频。
 *
 *   - 把 GOOGLE_OC_JSON 解 base64 拿 service account
 *   - 第一阶段简化：只接受公网 URL（用 inline_data fileUri 直接传给 Vertex）；
 *     后续可先把视频上传到 GCS 再用 gs:// 引用。
 *   - 没配 GOOGLE_OC_JSON 时给出明确错误，不静默失败。
 *
 * 注意：Vertex Gemini 直接接受公网 fileUri 仅在 model 支持时有效；
 * 后续要可靠跑视频，需要 GCS 中转，作为第二阶段任务。
 */

import { Buffer } from 'node:buffer';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { type ToolResult, makeToolResult } from '../../../domain/contracts/tools.js';
import { GoogleTokenCache, parseServiceAccount } from '../../../platform/googleAuth.js';
import { logger } from '../../../platform/logger.js';
import { type JsonSchema, Tool } from './base.js';

const MODEL = 'gemini-3.5-flash';
const DEFAULT_PROMPT =
  'Describe this media in detail: who/what is in it, what happens over time, key visual and audio cues, and anything noteworthy a creator should know.';

// Hard ceiling on bytes downloaded. Without this, an LLM-supplied URL to a
// large video can OOM the agent: 1GB Buffer + base64 inflation (~1.4GB
// string) + a single Vertex POST body that contains all of it. 50MB covers
// every realistic creator-asset case (Vertex itself rejects much larger
// inline_data payloads).
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
// Maximum redirect hops to follow manually. Each hop is re-validated
// against the SSRF rules below.
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 60_000;

// 按大类维护扩展名 → MIME，便于一眼看出某后缀归属哪种媒体。
const MIME_BY_KIND: Record<string, Record<string, string>> = {
  video: {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
  },
  audio: {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
  },
  image: {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  },
};

// 摊平成 扩展名 → MIME 的查表，以及受支持的大类前缀集合。
const EXT_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.values(MIME_BY_KIND).flatMap((group) => Object.entries(group)),
);
const MEDIA_KINDS = Object.keys(MIME_BY_KIND); // ['video','audio','image']

function isSupportedMime(mime: string): boolean {
  return MEDIA_KINDS.some((kind) => mime.startsWith(`${kind}/`));
}

/** 优先信任响应头的 content-type，否则回退到 URL 扩展名推断。 */
function resolveMime(url: string, contentType?: string | null): string {
  const header = contentType?.split(';')[0]?.trim().toLowerCase();
  if (header && isSupportedMime(header)) return header;

  const cleanPath = url.split(/[?#]/)[0] ?? '';
  const ext = cleanPath.slice(cleanPath.lastIndexOf('.') + 1).toLowerCase();
  return EXT_LOOKUP[ext] ?? 'application/octet-stream';
}

export class MediaUnderstandingTool extends Tool {
  override readonly name = 'inspect_media';
  override readonly timeoutSeconds = 120;
  override readonly description =
    'Inspect a media file (video, image, or audio) with a Gemini multimodal model and return a ' +
    'text understanding of it. Give a publicly reachable URL plus an optional question to focus on. ' +
    'Handled formats — video: MP4 / MOV / WebM; audio: MP3 / WAV / FLAC / AAC; image: PNG / JPG / ' +
    'GIF / WebP. Reach for this whenever the user needs the contents of a media file described, ' +
    'summarised, or mined for specific details.';

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Publicly accessible URL of the media file (video, image, or audio).',
      },
      prompt: {
        type: 'string',
        description:
          'What to analyze or ask about the media. Defaults to a general description if omitted.',
      },
    },
    required: ['url'],
  };

  private tokenCache: GoogleTokenCache | null = null;

  constructor(
    private readonly opts: {
      googleOcJson?: string;
      vertexProject?: string;
    } = {},
  ) {
    super();
  }

  private getTokenCache(): GoogleTokenCache {
    if (this.tokenCache) return this.tokenCache;
    if (!this.opts.googleOcJson) throw new Error('GOOGLE_OC_JSON is not configured');
    const sa = parseServiceAccount(this.opts.googleOcJson);
    this.tokenCache = new GoogleTokenCache(sa);
    return this.tokenCache;
  }

  override async execute(args: Record<string, unknown>): Promise<string | ToolResult> {
    if (!this.opts.googleOcJson) {
      return 'Error: GOOGLE_OC_JSON is not configured (Vertex Gemini credentials missing).';
    }
    const url = String(args.url);
    const prompt = (args.prompt as string) || DEFAULT_PROMPT;

    let tokenCache: GoogleTokenCache;
    try {
      tokenCache = this.getTokenCache();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: Failed to parse GOOGLE_OC_JSON: ${msg}`;
    }
    const project = this.opts.vertexProject || tokenCache.projectId;
    if (!project) return 'Error: VERTEX_GEMINI_PROJECT is not configured.';

    let fileBytes: Buffer;
    let contentType: string | null;
    try {
      const fetched = await safeFetchMedia(url);
      fileBytes = fetched.body;
      contentType = fetched.contentType;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error downloading media: ${msg}`;
    }
    if (fileBytes.length < 100) {
      return 'Error: the downloaded payload is too small to be a real media file.';
    }

    const mimeType = resolveMime(url, contentType);
    if (!isSupportedMime(mimeType)) {
      return `Error: media type '${mimeType}' is not handled. Accepted kinds: video, image, audio.`;
    }

    logger.info(
      { url: url.slice(0, 80), mime: mimeType, size_kb: Math.round(fileBytes.length / 1024) },
      'inspect_media: 开始解析媒体',
    );

    let token: string;
    try {
      token = await tokenCache.getToken();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: Failed to acquire Vertex access token: ${msg}`;
    }

    const endpoint =
      `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/` +
      `publishers/google/models/${MODEL}:generateContent`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: fileBytes.toString('base64'),
              },
            },
            { text: prompt },
          ],
        },
      ],
      generation_config: {
        temperature: 0.2,
        max_output_tokens: 8192,
      },
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(110_000),
      });
      if (!res.ok) {
        const text = await res.text();
        return `Error: Vertex Gemini returned HTTP ${res.status}: ${text.slice(0, 500)}`;
      }
      type Resp = {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const json = (await res.json()) as Resp;
      const candidate = json.candidates?.[0];
      const text =
        candidate?.content?.parts
          ?.map((p) => p.text ?? '')
          .join('\n')
          .trim() ?? '';
      if (!text) return 'Gemini returned no analysis (likely safety filter or unsupported media).';

      const usage = json.usageMetadata ?? {};
      const inTok = usage.promptTokenCount ?? 0;
      const outTok = usage.candidatesTokenCount ?? 0;
      // Gemini 3.5 Flash 价格按 google 定价取近似（仅作记录）
      const costUsd = (inTok * 0.075 + outTok * 0.3) / 1_000_000;

      return makeToolResult(text, { cost_usd: costUsd > 0 ? costUsd : null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'Vertex Gemini 调用异常');
      return `Error calling Gemini: ${msg}`;
    }
  }
}

/**
 * Fetch the LLM-supplied URL with SSRF + size protection.
 *
 * Risks the LLM can invent without this:
 *   - http://169.254.169.254/...      cloud metadata (AWS / GCP)
 *   - http://localhost:6379/          local Redis / Mongo / private services
 *   - http://10.0.0.1/                RFC1918 LAN
 *   - file:///etc/passwd              local files
 *   - https://attacker/redirect → http://localhost
 *
 * Defence:
 *   1. Protocol whitelist: https only (most production media is on R2/CDN
 *      so we can be strict; relax to http if a use case appears).
 *   2. DNS-resolve the host and reject every loopback / link-local /
 *      private / cloud-metadata / IPv4-mapped IPv6 result. We re-resolve
 *      on every redirect hop because TOCTOU is a real concern with
 *      attacker-controlled redirects.
 *   3. Manual redirect handling (`redirect: 'manual'`) so we can re-apply
 *      step 2 to every Location: header rather than trusting fetch's
 *      auto-follow.
 *   4. Length cap: refuse Content-Length over MAX_MEDIA_BYTES up-front,
 *      and abort the stream as soon as accumulated bytes exceed it.
 */
async function safeFetchMedia(
  rawUrl: string,
): Promise<{ body: Buffer; contentType: string | null }> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error('invalid URL');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (target.protocol !== 'https:') {
      throw new Error(`refusing non-https URL (${target.protocol})`);
    }
    await assertHostNotInternal(target.hostname);

    const res = await fetch(target.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`redirect status ${res.status} without Location header`);
      // Drain so the socket is released before we re-fetch.
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      try {
        target = new URL(location, target);
      } catch {
        throw new Error(`invalid redirect target: ${location}`);
      }
      continue;
    }

    if (!res.ok) {
      throw new Error(`Failed to download media (HTTP ${res.status})`);
    }

    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) {
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      throw new Error(
        `media exceeds ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)}MB limit (declared ${declared} bytes)`,
      );
    }

    if (!res.body) {
      throw new Error('upstream returned no body stream');
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_MEDIA_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw new Error(
          `media exceeds ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)}MB limit (got >${total} bytes)`,
        );
      }
      chunks.push(value);
    }

    return {
      body: Buffer.concat(chunks),
      contentType: res.headers.get('content-type'),
    };
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
}

/**
 * Reject hostnames that resolve to addresses we should never fetch from
 * the agent process. Covers loopback, RFC1918, link-local (incl. AWS/GCP
 * 169.254.169.254 metadata service), CGNAT, and the IPv6 equivalents.
 *
 * If the hostname resolves to multiple addresses, we reject if any one is
 * internal (defence against split-horizon DNS where an attacker arranges
 * the public resolver to return one safe + one private record).
 */
async function assertHostNotInternal(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal')) {
    throw new Error(`refusing internal hostname: ${hostname}`);
  }

  // If the URL is already an IP literal, check it directly without DNS.
  if (isIP(hostname)) {
    if (isInternalAddress(hostname)) {
      throw new Error(`refusing internal address: ${hostname}`);
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DNS lookup failed for ${hostname}: ${msg}`);
  }
  for (const { address } of addresses) {
    if (isInternalAddress(address)) {
      throw new Error(`hostname ${hostname} resolves to internal address ${address}`);
    }
  }
}

function isInternalAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isInternalIPv4(address);
  if (family === 6) return isInternalIPv6(address);
  return true; // unknown format → reject
}

function isInternalIPv4(address: string): boolean {
  const parts = address.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isInternalIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fec0:'))
    return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded IPv4 portion.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped?.[1]) return isInternalIPv4(mapped[1]);
  return false;
}

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

import { type ToolResult, makeToolResult } from '../../../domain/contracts/tools.js';
import { GoogleTokenCache, parseServiceAccount } from '../../../platform/googleAuth.js';
import { logger } from '../../../platform/logger.js';
import { type JsonSchema, Tool } from './base.js';

const MODEL = 'gemini-2.5-flash';
const DEFAULT_PROMPT =
  'Describe this media in detail: who/what is in it, what happens over time, key visual and audio cues, and anything noteworthy a creator should know.';

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
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return `Error: Failed to download media (HTTP ${res.status}).`;
      fileBytes = Buffer.from(await res.arrayBuffer());
      contentType = res.headers.get('content-type');
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
      // Gemini 2.5 Flash 价格按 google 定价取近似（仅作记录）
      const costUsd = (inTok * 0.075 + outTok * 0.3) / 1_000_000;

      return makeToolResult(text, { cost_usd: costUsd > 0 ? costUsd : null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'Vertex Gemini 调用异常');
      return `Error calling Gemini: ${msg}`;
    }
  }
}

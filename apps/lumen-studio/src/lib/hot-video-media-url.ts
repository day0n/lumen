export function toHotVideoMediaUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/')) return url;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return `/api/hot-videos/media?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return undefined;
  }
}

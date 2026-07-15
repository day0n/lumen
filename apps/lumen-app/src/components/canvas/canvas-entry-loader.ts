export const CANVAS_ENTRY_LOADER_PARAM = 'loader';

export function withCanvasEntryLoader(href: string): string {
  const url = new URL(href, 'https://lumen.local');
  url.searchParams.set(CANVAS_ENTRY_LOADER_PARAM, '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function stripCanvasEntryLoaderSearch() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (!url.searchParams.has(CANVAS_ENTRY_LOADER_PARAM)) return;

  url.searchParams.delete(CANVAS_ENTRY_LOADER_PARAM);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

const PUBLIC_ENTRY_PATHS = new Set(['/app/home', '/home', '/app/hot-videos', '/hot-videos']);

export function isPublicEntryPath(pathname: string): boolean {
  return PUBLIC_ENTRY_PATHS.has(pathname);
}

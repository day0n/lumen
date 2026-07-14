const RELEASE_PUBLIC_PREFIXES = [
  '/home-posters/',
  '/home-templates/',
  '/material-showcase/',
  '/particle-masks/',
];

export function resolveReleaseAssetUrl(
  value: string,
  releaseBase = readReleaseBase(),
  siteOrigin = readSiteOrigin(),
) {
  if (!releaseBase) return value;
  const localPath = readLocalPath(value, siteOrigin);
  if (!localPath) return value;
  const pathname = localPath.startsWith('/app/home-posters/')
    ? localPath.slice('/app'.length)
    : localPath;
  if (!RELEASE_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return value;
  const normalizedBase = releaseBase.endsWith('/') ? releaseBase : `${releaseBase}/`;
  return `${normalizedBase}${pathname.slice(1)}`;
}

function readLocalPath(value: string, siteOrigin: string) {
  if (value.startsWith('/')) return value;
  if (!siteOrigin) return null;
  try {
    const url = new URL(value);
    return url.origin === siteOrigin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

function readReleaseBase() {
  return typeof __LUMEN_RELEASE_ASSET_BASE__ === 'string' ? __LUMEN_RELEASE_ASSET_BASE__ : '';
}

function readSiteOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

import { pathToFileURL } from 'node:url';

const API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const WORKER_NAME = 'lumen-frontend-edge-production';
const PRODUCTION_PATTERNS = new Set(['lumenstudio.tech/*', 'www.lumenstudio.tech/*']);
const ZONE_ID_PATTERN = /^[0-9a-f]{32}$/i;

export async function removeProductionRoutes({ apiToken, fetchImpl = fetch, zoneId }) {
  const token = requireToken(apiToken);
  const normalizedZoneId = requireZoneId(zoneId);
  const endpoint = `${API_BASE_URL}/zones/${normalizedZoneId}/workers/routes`;
  const initialRoutes = await listRoutes(fetchImpl, endpoint, token);
  requireExpectedOwnership(initialRoutes);

  const ownedRoutes = initialRoutes.filter(
    (route) => route.script === WORKER_NAME && PRODUCTION_PATTERNS.has(route.pattern),
  );
  for (const route of ownedRoutes) {
    await apiRequest(fetchImpl, `${endpoint}/${route.id}`, token, { method: 'DELETE' });
  }

  const finalRoutes = await listRoutes(fetchImpl, endpoint, token);
  requireExpectedOwnership(finalRoutes);
  const remaining = finalRoutes.filter(
    (route) => route.script === WORKER_NAME && PRODUCTION_PATTERNS.has(route.pattern),
  );
  if (remaining.length > 0) {
    throw new Error('production frontend routes remain after removal');
  }

  return {
    removed: ownedRoutes.map((route) => route.pattern).sort(),
    verified: true,
    worker: WORKER_NAME,
  };
}

async function listRoutes(fetchImpl, endpoint, token) {
  const result = await apiRequest(fetchImpl, endpoint, token);
  if (!Array.isArray(result)) throw new Error('route list response is invalid');
  return result.map((route) => {
    if (
      !route ||
      typeof route !== 'object' ||
      typeof route.id !== 'string' ||
      typeof route.pattern !== 'string' ||
      (route.script != null && typeof route.script !== 'string')
    ) {
      throw new Error('route list contains an invalid route');
    }
    return { id: route.id, pattern: route.pattern, script: route.script ?? null };
  });
}

function requireExpectedOwnership(routes) {
  const unexpectedOwned = routes.filter(
    (route) => route.script === WORKER_NAME && !PRODUCTION_PATTERNS.has(route.pattern),
  );
  if (unexpectedOwned.length > 0) {
    throw new Error('production frontend worker owns an unexpected route');
  }

  const conflicting = routes.filter(
    (route) =>
      PRODUCTION_PATTERNS.has(route.pattern) &&
      route.script !== null &&
      route.script !== WORKER_NAME,
  );
  if (conflicting.length > 0) {
    throw new Error('production frontend route is owned by another worker');
  }
}

async function apiRequest(fetchImpl, url, token, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });

  let envelope;
  try {
    envelope = await response.json();
  } catch (error) {
    throw new Error(`route API returned invalid JSON with status ${response.status}`, {
      cause: error,
    });
  }
  if (!response.ok || envelope?.success !== true) {
    throw new Error(`route API request failed with status ${response.status}`);
  }
  return envelope.result;
}

function requireToken(value) {
  const token = value?.trim();
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required');
  return token;
}

function requireZoneId(value) {
  const zoneId = value?.trim();
  if (!zoneId || !ZONE_ID_PATTERN.test(zoneId)) {
    throw new Error('CLOUDFLARE_ZONE_ID must be a 32-character hexadecimal identifier');
  }
  return zoneId.toLowerCase();
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void removeProductionRoutes({
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    zoneId: process.env.CLOUDFLARE_ZONE_ID,
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

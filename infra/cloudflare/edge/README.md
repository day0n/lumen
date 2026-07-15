# Frontend edge release router

This component serves versioned static releases from the private frontend bucket. It never executes
API, WebSocket, Agent, monitoring, database, or background-task work. When deployed as a route in
front of the existing origin, those origin-owned requests can be forwarded unchanged.

The release scope contains the Vite app, static shared-workflow and authentication entries, and
build-time prerendered English and Chinese landing entries. Release objects use this layout:

```text
releases/<full-git-sha>/app/index.html
releases/<full-git-sha>/share/index.html
releases/<full-git-sha>/index.html
releases/<full-git-sha>/zh/index.html
releases/<full-git-sha>/auth/index.html
releases/<full-git-sha>/auth/zh/index.html
releases/<full-git-sha>/404.html
releases/<full-git-sha>/zh/404.html
releases/<full-git-sha>/assets/*
releases/<full-git-sha>/<approved-public-assets>/*
releases/<full-git-sha>/release-manifest.json
releases/<full-git-sha>/_READY.json
release-claims/<full-git-sha>.json
```

Build and stage an immutable frontend release locally with:

```bash
pnpm package:frontend --release <full-git-sha>
```

This command builds and packages in one process so the source release and effective public build
configuration cannot drift between steps. The packager reads the Vite manifest instead of copying
`dist` wholesale, excludes source maps and unexpected build files, and verifies that every local
shell reference was emitted with the same full release SHA. Runtime URLs for approved public media
are pinned to that release as well. The packager copies only approved public asset directories,
creates Brotli and gzip siblings, and records every payload digest. Build metadata binds the
artifact to the source SHA and the effective public browser configuration. The manifest declares
the exact `scope: ["app", "share", "landing", "auth", "not-found"]` and all eight shell paths;
`_READY.json` binds that manifest to the release SHA. Landing, authentication, and recovery pages
are distinct localized Vite inputs so their language, metadata, static first screen, and entry
assets cannot be mixed across locales. Authentication and recovery shells must keep their
`noindex, nofollow` metadata.

Re-run the strict local inventory check without rebuilding with:

```bash
pnpm verify:frontend --release <full-git-sha>
```

The verifier rejects extra or missing files, unsafe paths and symbolic links, schema drift,
incorrect digests or metadata, and a manifest/READY pair that does not seal the exact directory.

Create the immutable release claim first, upload payload objects next, then
`release-manifest.json`, and `_READY.json` last. Deploy the preview Worker only after every uploaded
object has been verified. The publisher implements those barriers, never overwrites or deletes an
existing key, and audits the complete remote namespace:

```bash
pnpm run-script frontend:upload --release <full-git-sha> --dry-run

FRONTEND_R2_ACCOUNT_ID=... \
FRONTEND_R2_BUCKET=... \
FRONTEND_R2_ACCESS_KEY_ID=... \
FRONTEND_R2_SECRET_ACCESS_KEY=... \
pnpm run-script frontend:upload --release <full-git-sha>
```

Dry runs verify the complete local artifact without reading credentials or initializing a remote
client. A real publish accepts an already-sealed identical release as a no-write success and fails
on any remote key, byte, digest, or HTTP metadata conflict. The permanent claim binds the exact
manifest and READY bytes to the source SHA before new payload objects are written, preventing two
different artifacts from racing into the same release namespace.

Deploy the preview Worker only after the immutable upload succeeds:

```bash
pnpm dlx wrangler@4.107.0 deploy \
  --config infra/cloudflare/edge/wrangler.toml \
  --var ACTIVE_FRONTEND_RELEASE:<full-git-sha>
```

The checked-in `Publish Frontend Preview` workflow performs the same build, immutable upload,
full remote audit, activation, and required response-header checks for app and share. It also GETs
both landing pages and verifies the active release, locale-specific `lang` and title, prerender
marker, and non-empty static first screen. Both authentication locales are checked for their
release, language, title, static loading screen, and noindex metadata. Running it again with an
older sealed SHA is the rollback path. It also verifies that unknown English and Chinese document
paths return localized static recovery pages with an HTTP 404 status. Configure its
`frontend-preview` environment with
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `FRONTEND_R2_ACCESS_KEY_ID`, and
`FRONTEND_R2_SECRET_ACCESS_KEY`. It also requires `VITE_CLERK_PUBLISHABLE_KEY` and
`VITE_SENTRY_DSN` so an activatable release cannot be built without browser authentication and
telemetry configuration. Set `FRONTEND_PREVIEW_URL` as an environment variable for the required
post-deploy check. Restrict that environment to the default branch, require approval, and scope
both credentials to preview-only resources. The preview bucket is fixed to
`lumen-frontend-preview` in both the workflow and Worker binding.

Authentication and bucket upload credentials belong in CI secrets and must not be committed. A
rollback redeploys the edge version with the previous full release SHA; old release objects remain
available for existing browser tabs.

Unknown document paths now return real localized static recovery pages with an HTTP 404 status;
backend, monitoring, WebSocket, internal, and missing asset paths remain outside that HTML fallback.
The root and `/zh` objects are prerendered landing entries; the share shell is a static entry whose
reads and clone mutation use the independent API. Authentication paths use localized static shells
and perform identity work from the browser. A production promotion may route `/`, `/zh`, `/app/*`,
`/share/*`, `/zh/share/*`, `/sign-in/*`, `/sign-up/*`, `/zh/sign-in/*`, `/zh/sign-up/*`, versioned
static assets, approved public assets, and other browser document paths handled by the recovery
shells.

Origin passthrough is explicit and fail-closed. `/api`, `/trpc`, `/v1/agent`, `/ws`, `/monitoring`,
internal runtime paths, and non-release asset requests are forwarded with the original request only
when `ORIGIN_PASSTHROUGH_ENABLED=true`. The preview configuration does not set that value, so it
cannot accidentally reach the production origin. Origin-owned paths also remain available when the
active frontend release is missing or invalid; a frontend configuration error must not take down
backend traffic.

The default configuration only enables the preview address. The dormant
`wrangler.production.toml` configuration has `workers_dev = false` and no routes, so it cannot take
over production traffic. `wrangler.production-active.toml` is the separately named activation
configuration and declares only `lumenstudio.tech/*` and `www.lumenstudio.tech/*` as origin-backed
routes. Merely merging these files does not change production.

The protected `Activate Frontend Production` workflow is the only checked-in activation path. It
requires a full default-branch Git SHA plus the exact confirmation text, rebuilds and audits the
immutable release, uploads to `lumen-frontend-prod`, deploys the active route configuration, and
then verifies every localized shell, recovery status, release header, and unauthenticated API
response. A failed post-activation check automatically removes both routes, returning all traffic
to the existing origin. Reactivating a previous sealed SHA is the normal frontend rollback.

Configure the `frontend-production` environment with required reviewers, default-branch
restrictions, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`,
`FRONTEND_R2_ACCESS_KEY_ID`, `FRONTEND_R2_SECRET_ACCESS_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, and
`VITE_SENTRY_DSN`. Set
`FRONTEND_PRODUCTION_URL=https://lumenstudio.tech` as an environment variable. The token must be
limited to the production Worker, bucket, and the two declared zone routes. The separate
`Bypass Frontend Production Edge` workflow is the emergency origin-only path; it removes and
re-audits only routes owned by `lumen-frontend-edge-production` and refuses unexpected ownership.

The existing Studio process remains part of the backend after this cutover. It continues to serve
API routes that have not moved to the independent API, the flow WebSocket gateway, and background
event mirrors. Its static app copy is retained as the immediate origin fallback and can be removed
only after those backend responsibilities have moved and the production edge has completed a
stable observation window.

# Frontend edge release router

This component only routes versioned static releases from the private frontend bucket. It does not
handle API, WebSocket, Agent, monitoring, database, or background-task traffic.

The first release scope is intentionally limited to the Vite app. Release objects use this layout:

```text
releases/<full-git-sha>/app/index.html
releases/<full-git-sha>/assets/*
releases/<full-git-sha>/<approved-public-assets>/*
releases/<full-git-sha>/release-manifest.json
releases/<full-git-sha>/_READY.json
```

Build and stage an immutable app release locally with:

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
`scope: ["app"]`; `_READY.json` binds that manifest to the release SHA.

Upload payload objects first, `release-manifest.json` next, and `_READY.json` last. Deploy the
preview Worker only after every uploaded object has been verified:

```bash
pnpm dlx wrangler@4 deploy \
  --config infra/cloudflare/edge/wrangler.toml \
  --var ACTIVE_FRONTEND_RELEASE:<full-git-sha>
```

Authentication and bucket upload credentials belong in CI secrets and must not be committed. A
rollback redeploys the edge version with the previous full release SHA; old release objects remain
available for existing browser tabs.

The app-only scope must never create placeholder root, locale, auth, share, or not-found shells.
Those requests remain on the Studio origin until each page has a real static build and its server
work has moved behind an API contract. A production promotion may initially route only `/app/*`,
versioned static assets, and the approved public asset paths.

The checked-in configuration only enables the provider preview address. Production domain routes
are intentionally added in a separate promotion change after the static build and rollback checks
have passed; deploying this scaffold cannot take over production traffic.

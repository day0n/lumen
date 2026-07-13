# Frontend edge release router

This component only routes versioned static releases from the private frontend bucket. It does not
handle API, WebSocket, Agent, monitoring, database, or background-task traffic.

Release objects use this layout:

```text
releases/<full-git-sha>/index.html
releases/<full-git-sha>/zh/index.html
releases/<full-git-sha>/auth/index.html
releases/<full-git-sha>/share/index.html
releases/<full-git-sha>/app/index.html
releases/<full-git-sha>/assets/*
```

Deploy only after all objects for the release have been uploaded and verified:

```bash
pnpm dlx wrangler@4 deploy \
  --config infra/cloudflare/edge/wrangler.toml \
  --var ACTIVE_FRONTEND_RELEASE:<full-git-sha>
```

Authentication and bucket upload credentials belong in CI secrets and must not be committed. A
rollback redeploys the edge version with the previous full release SHA; old release objects remain
available for existing browser tabs.

The checked-in configuration only enables the provider preview address. Production domain routes
are intentionally added in a separate promotion change after the static build and rollback checks
have passed; deploying this scaffold cannot take over production traffic.

#!/bin/bash
set -e

APP_DIR=~/lumen
export FNM_PATH="$HOME/.local/share/fnm"
export PATH="$FNM_PATH:$PATH"
eval "$(fnm env)"
export NODE_BIN="$(readlink -f "$(command -v node)")"
export TSX_BIN="$(dirname "$NODE_BIN")/tsx"

cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull origin main

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Building shared..."
pnpm build:shared

echo "==> Building studio..."
pnpm build:studio

echo "==> Building agent..."
pnpm --filter @lumen/agent build
# Copy non-TS assets (prompt.md etc) to dist
find apps/lumen-agent/src -name '*.md' -exec bash -c 'dest="apps/lumen-agent/dist/${0#apps/lumen-agent/src/}"; mkdir -p $(dirname $dest); cp $0 $dest' {} \;

echo "==> Building engine..."
pnpm --filter @lumen/engine build

echo "==> Restarting services..."
pm2 reload ecosystem.config.cjs --update-env

echo "==> Done!"
pm2 status

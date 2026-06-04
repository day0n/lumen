#!/bin/bash
set -euo pipefail

APP_DIR=~/lumen
LOCK_FILE="${LUMEN_DEPLOY_LOCK:-/tmp/lumen-deploy.lock}"
LOCK_TIMEOUT_SECONDS="${LUMEN_DEPLOY_LOCK_TIMEOUT_SECONDS:-1800}"

exec 9>"$LOCK_FILE"
echo "==> Waiting for deploy lock..."
if ! flock -w "$LOCK_TIMEOUT_SECONDS" 9; then
  echo "Failed to acquire deploy lock after ${LOCK_TIMEOUT_SECONDS}s"
  exit 1
fi

export FNM_PATH="$HOME/.local/share/fnm"
export PATH="$FNM_PATH:$PATH"
eval "$(fnm env)"
export NODE_BIN="$(readlink -f "$(command -v node)")"
export TSX_BIN="$(dirname "$NODE_BIN")/tsx"

cd "$APP_DIR"

echo "==> Pulling latest code..."
# Next.js 每次 build 都会 append 当前 build dir 的 types 路径到 studio tsconfig.json 的
# include，但从不清理旧条目。多次部署后 include 会累积一堆历史 build 路径，旧 types
# 文件又会引用已删除的源（比如已删的 /api/hot-videos/remake），导致 typecheck 报
# "Cannot find module" 整次构建挂掉。git pull 默认会保留这些 dirty 改动，所以这里
# 先硬重置一下，让 git pull 能干净落到远端最新版本。
git checkout -- apps/lumen-studio/tsconfig.json 2>/dev/null || true
git pull origin main

echo "==> Ensuring FFmpeg runtime..."
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg
  else
    echo "FFmpeg/ffprobe missing; install them before running lumen-video-edit."
    exit 1
  fi
fi

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Building shared..."
pnpm build:shared

echo "==> Building studio..."
STUDIO_RELEASE_ID="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
STUDIO_BUILD_DIR=".next-build-${STUDIO_RELEASE_ID}"
rm -rf "apps/lumen-studio/${STUDIO_BUILD_DIR}"
# Next.js 每次 build 都会往 apps/lumen-studio/tsconfig.json 的 include 里
# append 当前 build dir 的 types 路径（".next-build-<sha>-<ts>/types/**/*.ts"），
# 但不会移除旧条目。多次部署后 include 会累积一堆历史 build 路径，旧 types 文件
# 又会引用已删除的源文件（如本次的 /api/hot-videos/remake），导致 typecheck 报
# "Cannot find module" 然后整次构建挂掉。
# 每次 build 前用 git 版本重置 tsconfig.json，让 Next 只追加当前 build 的路径。
git checkout -- apps/lumen-studio/tsconfig.json 2>/dev/null || true
# 同时清掉所有旧 build 目录里的 types/ 子目录，即使 tsconfig include 还残留旧
# 引用（极端情况下），类型检查也找不到旧 types 文件可以扫，进一步堵死回归路径。
find apps/lumen-studio -maxdepth 1 -type d -name '.next-build-*' \
  -not -name "${STUDIO_BUILD_DIR}" \
  -exec rm -rf {}/types \;
NEXT_DIST_DIR="$STUDIO_BUILD_DIR" pnpm build:studio

echo "==> Building agent..."
pnpm --filter @lumen/agent build
# Copy non-TS assets (prompt.md etc) to dist
find apps/lumen-agent/src -name '*.md' -exec bash -c 'dest="apps/lumen-agent/dist/${0#apps/lumen-agent/src/}"; mkdir -p "$(dirname "$dest")"; cp "$0" "$dest"' {} \;

echo "==> Building engine..."
pnpm --filter @lumen/engine build

echo "==> Activating studio build..."
ln -sfn "$STUDIO_BUILD_DIR" apps/lumen-studio/.next-current.tmp
mv -Tf apps/lumen-studio/.next-current.tmp apps/lumen-studio/.next-current

echo "==> Ensuring nginx upload limit..."
NGINX_BODY_SIZE_CONF=/etc/nginx/conf.d/lumen-body-size.conf
if [ "$(id -u)" -eq 0 ] && command -v nginx >/dev/null 2>&1; then
  cat > "$NGINX_BODY_SIZE_CONF" <<'NGINX'
client_max_body_size 128m;
NGINX
  nginx -t
  systemctl reload nginx
else
  echo "Skipping nginx upload limit update; root and nginx are required."
fi

echo "==> Restarting services..."
pm2 reload ecosystem.config.cjs --update-env

echo "==> Cleaning old studio builds..."
find apps/lumen-studio -maxdepth 1 -type d -name '.next-build-*' -printf '%T@ %p\n' \
  | sort -nr \
  | awk 'NR > 3 {print $2}' \
  | xargs -r rm -rf

echo "==> Done!"
pm2 status

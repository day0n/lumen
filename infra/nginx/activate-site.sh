#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 5 ]; then
  echo "Usage: $0 <source> <target> <enabled-link> -- <verification-command...>" >&2
  exit 64
fi

SOURCE_PATH="$1"
TARGET_PATH="$2"
ENABLED_PATH="$3"
shift 3

if [ "${1:-}" != "--" ]; then
  echo "Expected -- before the verification command." >&2
  exit 64
fi
shift

if [ "$#" -eq 0 ]; then
  echo "A verification command is required." >&2
  exit 64
fi

for required_command in install mktemp nginx realpath systemctl; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $required_command" >&2
    exit 69
  fi
done

if [ ! -r "$SOURCE_PATH" ]; then
  echo "Nginx site source is not readable: $SOURCE_PATH" >&2
  exit 66
fi
if [ ! -f "$TARGET_PATH" ]; then
  echo "Nginx site target is not a regular file: $TARGET_PATH" >&2
  exit 66
fi
if [ ! -L "$ENABLED_PATH" ]; then
  echo "Nginx enabled site must be a symbolic link: $ENABLED_PATH" >&2
  exit 66
fi
if [ "$(realpath "$ENABLED_PATH")" != "$(realpath "$TARGET_PATH")" ]; then
  echo "Nginx enabled site does not point to the managed target: $ENABLED_PATH" >&2
  exit 66
fi

BACKUP_PATH="$(mktemp "${TARGET_PATH}.rollback.XXXXXX")"
CANDIDATE_PATH="$(mktemp "${TARGET_PATH}.candidate.XXXXXX")"
ACTIVATED=0

rollback_on_exit() {
  local original_status=$?
  local rollback_status=0

  trap - EXIT HUP INT TERM
  set +e
  rm -f "$CANDIDATE_PATH"

  if [ "$ACTIVATED" -eq 1 ] && [ -f "$BACKUP_PATH" ]; then
    echo "==> Restoring the previous nginx site configuration..." >&2
    if ! mv -f "$BACKUP_PATH" "$TARGET_PATH"; then
      echo "Failed to restore the previous nginx site file." >&2
      rollback_status=70
    elif ! nginx -t; then
      echo "Restored nginx site configuration did not pass validation." >&2
      rollback_status=70
    elif ! systemctl reload nginx; then
      echo "Failed to reload nginx after restoring the previous site configuration." >&2
      rollback_status=70
    else
      echo "==> Previous nginx site configuration restored." >&2
    fi
  else
    rm -f "$BACKUP_PATH"
  fi

  if [ "$rollback_status" -ne 0 ]; then
    exit "$rollback_status"
  fi
  if [ "$original_status" -eq 0 ]; then
    original_status=1
  fi
  exit "$original_status"
}

trap rollback_on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cp -p "$TARGET_PATH" "$BACKUP_PATH"
install -m 0644 "$SOURCE_PATH" "$CANDIDATE_PATH"
ACTIVATED=1
mv -f "$CANDIDATE_PATH" "$TARGET_PATH"

nginx -t
systemctl reload nginx
"$@"

ACTIVATED=0
rm -f "$BACKUP_PATH"
trap - EXIT HUP INT TERM

echo "==> Nginx site configuration activated and verified."

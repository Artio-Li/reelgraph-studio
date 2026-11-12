#!/bin/sh
set -eu

# Reuse the existing muse2api environment without copying its management key.
if [ -z "${MUSE_KEY:-}" ]; then
  MUSE_KEY="${MUSE2API_KEY:-}"
  export MUSE_KEY
fi

if [ -z "${MUSE_KEY:-}" ]; then
  echo "MUSE_KEY or MUSE2API_KEY is required" >&2
  exit 1
fi

exec node src/index.js

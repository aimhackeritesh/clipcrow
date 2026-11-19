#!/usr/bin/env bash
# One-shot setup for macOS and Linux. Installs the Node packages, then builds the Python virtualenv
# that holds yt-dlp (for YouTube links) and faster-whisper (for burned-in captions).
# FFmpeg is not installed here: it belongs to your package manager. Re-running this is safe.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "1/3  Node packages"
npm install

say "2/3  Python virtualenv (.venv)"
PY=""
for candidate in python3.12 python3.11 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then
  echo "No python3 found. Install Python 3.11 or newer, then run this again." >&2
  exit 1
fi
echo "Using $PY ($("$PY" --version))"
[ -d .venv ] || "$PY" -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
# faster-whisper pulls in ctranslate2 and the tokenizers; the model weights download on first use.
./.venv/bin/pip install --quiet 'yt-dlp[default]' faster-whisper

say "3/3  Checking everything"
node scripts/doctor.mjs

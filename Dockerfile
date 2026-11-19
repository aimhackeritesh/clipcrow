# Clipcrow needs real processes and real disk: FFmpeg runs for the length of a stream and the
# buffer is written to a mounted volume. That rules out serverless hosting.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# yt-dlp resolves YouTube; faster-whisper transcribes the captions. Both stay inside the image.
RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir 'yt-dlp[default]' faster-whisper

# Bake the transcription weights in, so the first clip of a fresh machine is not stuck downloading
# 140MB before it can caption anything.
ENV HF_HOME=/opt/huggingface
RUN .venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

COPY . .

ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
EXPOSE 8080

# CLIPCROW_PASSWORD must be set: the server refuses to listen on a public interface without one.
CMD ["node", "server.mjs"]

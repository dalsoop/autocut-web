# autocut-web + Qwen3-ASR (GPU 필수) — Envato 배포용
# nvidia/cuda base로 cuDNN 포함
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/app/models

# 시스템 의존성
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip python3-dev \
      ffmpeg git curl ca-certificates build-essential \
      nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 가상환경 + autocut + Qwen3-ASR
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir \
      torch torchaudio --index-url https://download.pytorch.org/whl/cu124
RUN pip install --no-cache-dir \
      qwen-asr \
      audioop-lts packaging silero-vad "moviepy<2" \
      openai-whisper git+https://github.com/mli/autocut.git

# Node backend 빌드
COPY backend /app/backend
WORKDIR /app/backend
RUN npm install && npx typia patch && npm run build

# Frontend + Qwen3 스크립트
COPY frontend /app/frontend
COPY qwen3-transcribe.py /app/qwen3-transcribe.py

# 환경변수
ENV AUTOCUT_BIN=/opt/venv/bin/autocut
ENV QWEN3_PYTHON=/opt/venv/bin/python
ENV QWEN3_SCRIPT=/app/qwen3-transcribe.py
ENV AUTOCUT_WORKSPACE=/workspace
ENV AUTOCUT_CONFIG=/app/config.json
ENV PORT=8080

EXPOSE 8080
WORKDIR /app/backend
CMD ["node", "dist/main.js"]

# autocut-web + Qwen3-ASR (GPU 필수) — Python 3.13 + CUDA 12.4
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/app/models

# Python 3.13 (deadsnakes PPA) + Node 20 (NodeSource) + 시스템 의존성
RUN apt-get update && apt-get install -y --no-install-recommends software-properties-common curl gnupg ca-certificates \
    && add-apt-repository ppa:deadsnakes/ppa -y \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.13 python3.13-venv python3.13-dev \
        ffmpeg git build-essential \
        nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python venv
RUN python3.13 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# PyTorch cu124 (Python 3.13 wheel)
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# ASR + 컷 의존성 (Python 3.13이면 audioop-lts 필요)
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

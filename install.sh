#!/usr/bin/env bash
# autocut-web 설치 스크립트 (GPU 필수)
set -euo pipefail

echo "=== autocut-web 설치 ==="
echo

# 1. 사전 검사
command -v docker >/dev/null || { echo "❌ Docker가 설치되어 있지 않습니다. https://docs.docker.com/engine/install/"; exit 1; }
command -v nvidia-smi >/dev/null || { echo "❌ NVIDIA GPU 드라이버가 필요합니다."; exit 1; }
docker info 2>/dev/null | grep -q "Runtimes:.*nvidia" || \
  echo "⚠️  nvidia-container-toolkit이 필요할 수 있습니다: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"

# 2. .env 생성
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ .env 생성됨 — WORKSPACE_DIR 설정을 확인하세요"
fi

# 3. workspace 디렉토리
source .env
mkdir -p "${WORKSPACE_DIR:-./workspace}/10_진행중"
echo "✓ 워크스페이스 생성: ${WORKSPACE_DIR:-./workspace}/10_진행중"

# 4. 이미지 빌드
echo
echo "=== Docker 이미지 빌드 (10-20분 소요) ==="
docker compose build

# 5. 시작
echo
echo "=== 컨테이너 시작 ==="
docker compose up -d

echo
echo "✅ 완료! http://localhost:${AUTOCUT_PORT:-8080} 접속"
echo "   첫 실행 시 Qwen3-ASR 모델 ~5GB 다운로드됩니다 (자막 추출 시작 시)"
echo
echo "유용한 명령:"
echo "   docker compose logs -f       # 로그 확인"
echo "   docker compose restart       # 재시작"
echo "   docker compose down          # 중지"

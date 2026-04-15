# Changelog

## [1.0.0] - 2026-04-15 — Envato 초기 릴리스

### 기능
- Qwen3-ASR-1.7B 로컬 GPU 자막 추출 (한국어 특화)
- Whisper 폴백 (tiny ~ large-v3)
- 자막 인라인 편집 (더블클릭, split/merge, ±0.1초 nudge)
- 자막 버전 관리 (재추출 시 자동 archive, 복원 전환)
- 배치 자막 추출 (GPU 직렬 큐)
- WebVTT 자막 비디오 자동 표시
- 컷 프리뷰 (가상 재생)
- 편집본 메타 (엔진/모델/유지비율)
- 컷 결과 라벨링
- 파일 삭제 캐스케이드 (자막/버전/편집본 일괄)
- Job 취소 + 전체 로그 조회
- 설정 UI (엔진/언어/디바이스)
- 파일 검색 (`/` 키)

### 인프라
- Docker Compose 배포 (GPU passthrough)
- 경로 전부 환경변수화
- Envato Purchase Code 검증
- 설치 스크립트 (`install.sh`)

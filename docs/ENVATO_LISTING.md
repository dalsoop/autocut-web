# CodeCanyon 상품 등록 자료

## 상품명
**autocut — AI 영상 자동 컷편집 (Qwen3-ASR + Subtitle-based Cutting)**

## 카테고리
PHP Scripts → Miscellaneous (또는) JavaScript → Miscellaneous

## 태그
ai, video, editor, subtitle, asr, speech-recognition, qwen, whisper, gpu, docker, korean, whisperX, nvidia, cutting, mlops

## 가격 제안
- **Regular License: $59**
- **Extended License: $299**

(CodeCanyon 유사 Whisper 기반 GUI 대비 1.7B SOTA + 자막 버전관리 + TUI 포함 → 중상단 포지셔닝)

## Short Description (1줄)
> Turn hours of Korean lecture/interview footage into polished cuts in minutes. GPU-accelerated Qwen3-ASR subtitle extraction, inline editing, version-managed exports.

## Long Description

### The Problem
Editing long Korean-language videos — lectures, interviews, documentaries — burns hours in Adobe Premiere. You scrub, cut, scrub, cut. Subtitle-based workflow (mli/autocut) speeds this up but still requires terminal, Python setup, and weak Korean ASR.

### The Solution
**autocut-web** brings the subtitle-cut workflow to a polished browser UI + TUI, powered by **Qwen3-ASR-1.7B** — 28% lower WER than Whisper-large-v3 on Korean.

### Workflow
1. Drop videos into a project folder
2. Hit **Extract Subtitles** — Qwen3-ASR runs on your GPU (~realtime speed on RTX 3090)
3. Uncheck sentences you don't want
4. Hit **Cut** — output with proper timestamps, meta-tagged

### Key Features
- **Qwen3-ASR-1.7B** — SOTA open-source ASR for Korean/Japanese/Chinese (Jan 2026 release)
- **Whisper fallback** — tiny ~ large-v3 for 99 languages
- **Inline subtitle editing** — double-click line to edit text, split/merge, ±0.1s nudge
- **Subtitle versioning** — re-extract with different engine/model, switch between versions
- **Batch extraction queue** — process your entire project folder, GPU-safe serial
- **In-video captions** — auto-generated WebVTT displayed in HTML5 video
- **Cut preview** — verify kept sections before rendering
- **Label your exports** — `video_cut_20260415_final.mp4`
- **Full job log viewer** — debug transcription/cut failures
- **Cancel-able jobs** — ESC interrupt running Python processes
- **Cascade delete** — removing source video cleans up SRT/MD/versions/cuts

### Technical
- **Backend**: Node 20 + Express + `typia` (runtime-validated JSON types)
- **Frontend**: Vue 3 CDN + no build step
- **ASR Worker**: Python 3.13 + `qwen-asr` + PyTorch CUDA 12.4 + `openai-whisper`
- **Cutting**: `mli/autocut` + MoviePy
- **Deploy**: Docker Compose with `nvidia-container-toolkit` GPU passthrough
- **License**: Envato Purchase Code validation

### System Requirements
- **GPU**: NVIDIA RTX 3060 (12GB) minimum, RTX 3090/4090 recommended
- **CUDA**: 12.1+
- **RAM**: 8GB min, 16GB recommended
- **Disk**: 20GB (models 5GB + video storage)
- **OS**: Ubuntu 22.04 / Debian 12 (Windows via WSL2)

### What You Get
- Complete source code (Node backend + Vue frontend + Python worker)
- Docker Compose setup (one-command install)
- Optional TUI client ([ai-video-autocut](https://github.com/dalsoop/ai-video-autocut), Rust+Ratatui)
- Documentation: README, architecture diagram, FAQ, troubleshooting
- 6 months free updates

### Demo
Live demo: https://demo-autocut.example.com (read-only project)

### Support
- Email support via Envato portal
- 6 months updates + 6 months support included (extendable)

---

## 스크린샷 (Preview Image 제외 최대 10장)

1. `01-file-list.png` — 프로젝트 파일 리스트 + 자막 상태 배지
2. `02-subtitle-editor.png` — 자막 편집 뷰, 엔진/언어 배지
3. `03-inline-edit.png` — 자막 라인 더블클릭 편집 모드
4. `04-settings.png` — 설정 모달 (엔진/언어/모델/디바이스)
5. `05-versions.png` — 자막 버전 관리 (재추출 아카이브)
6. `06-full-layout.png` — 전체 레이아웃

## Preview 이미지 사양
- **Main Preview**: 590×300 PNG/JPG (앱 로고 + 태그라인)
- **Thumbnail**: 80×80 (CodeCanyon 카탈로그용)
- **Inline**: 890×500 (상세 페이지)

## Required Files for Submission
- [x] `main.zip` — 전체 소스 (Dockerfile, backend/, frontend/, qwen3-transcribe.py, install.sh)
- [x] `README.md` + `CHANGELOG.md`
- [ ] `preview.png` 590×300
- [ ] `thumbnail.png` 80×80
- [ ] 6개 스크린샷 (위 docs/screenshots/)
- [ ] 1분 프리뷰 영상 (YouTube/Vimeo)
- [ ] 데모 사이트 URL

## 저작자 정보
- Envato Author: dalsoop
- Support Email: support@prelik.com
- Website: https://github.com/dalsoop

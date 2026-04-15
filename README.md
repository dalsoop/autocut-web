# autocut-web — AI 영상 자동 컷편집 (Qwen3-ASR 기반)

> **자막 추출 → 체크박스로 유지할 문장 선택 → 클릭 한 번으로 컷편집 완성**

한국어 강의/영화/인터뷰에 특화. Qwen3-ASR-1.7B로 SOTA 한국어 자막 추출 후 문장 단위 편집, 원본에서 즉시 컷.

## 주요 기능

- **Qwen3-ASR-1.7B** — Whisper-large-v3 대비 28% WER 개선 (한국어)
- **자막 인라인 편집** — 더블클릭 수정, split/merge, ±0.1초 nudge
- **자막 버전 관리** — 재추출 시 이전 버전 자동 archive, 복원/비교 가능
- **배치 자막 추출** — 미추출 파일 전부 한 번에 큐 (GPU 직렬)
- **VTT 자막 자동 표시** — 비디오 재생 시 브라우저 기본 자막
- **컷 프리뷰** — 유지 구간만 가상 재생 (렌더 전 확인)
- **편집본 메타** — 엔진/모델/언어/유지비율 추적
- **라벨링** — 컷 결과물 파일명에 의미있는 라벨

## 시스템 요구사항

| 항목 | 최소 | 권장 |
|---|---|---|
| OS | Ubuntu 22.04 / Debian 12 | - |
| RAM | 8GB | 16GB |
| Disk | 20GB (모델 5GB + 영상) | 100GB+ |
| **GPU** | **NVIDIA RTX 3060 12GB** | **RTX 3090 / 4090 / A100** |
| CUDA | 12.1+ | 12.4 |
| Docker | 24+ with `nvidia-container-toolkit` | - |

> ⚠️ **GPU 필수**. Qwen3-ASR 1.7B 로컬 추론 (≈4GB VRAM).

## 설치

```bash
git clone <이 repo>
cd autocut-web
cp .env.example .env       # WORKSPACE_DIR 경로 수정
./install.sh
```

`http://localhost:8080` 접속. 첫 자막 추출 시 모델 ~5GB 자동 다운로드.

## 사용법

1. 호스트의 `WORKSPACE_DIR/10_진행중/<프로젝트명>/` 에 영상 배치
2. 웹 UI에서 프로젝트 선택 → 파일 클릭
3. **자막 추출** (⚙ 설정에서 엔진/언어 변경 가능)
4. 체크박스로 유지 문장 선택, 필요시 라인 편집 (더블클릭)
5. **✂ 컷 편집** → `<원본>_cut_<타임스탬프>_<라벨>.mp4` 생성

## 설정 (⚙ 버튼)

| 항목 | 옵션 |
|---|---|
| 기본 엔진 | `qwen3` / `whisper` |
| 기본 언어 | 한국어 / English / 日本語 / 中文 |
| Whisper 모델 | tiny ~ large-v3 |
| Qwen3 디바이스 | cuda:0 / cuda:1 / cpu |

## 아키텍처

```
autocut-web (Node + Vue 3) :8080
├─ REST API
│  /api/projects, /api/files, /api/config
│  /api/jobs/transcribe,cut,cancel
│  /api/subtitle/* (PATCH — 편집/split/merge/nudge)
│  /api/vtt/*     (WebVTT 다운로드)
│  /api/subtitle-versions/*  (버전 목록/복원)
├─ Qwen3-ASR subprocess (GPU)
└─ MoviePy/autocut subprocess (ffmpeg)

WORKSPACE_DIR/
└── 10_진행중/
    └── <프로젝트>/
        ├── video.mp4
        ├── video.srt              (자막)
        ├── video.md               (편집 마크)
        ├── video.srt.meta.json    (엔진/모델 메타)
        ├── video_subs/            (버전 아카이브)
        └── video_cut_<ts>_<label>.mp4
```

## 환경변수

| 변수 | 기본값 | 용도 |
|---|---|---|
| `AUTOCUT_PORT` | `8080` | HTTP 포트 |
| `WORKSPACE_DIR` | `./workspace` | 호스트 영상 폴더 |
| `AUTOCUT_PROJECTS_SUBDIR` | `10_진행중` | 프로젝트 서브 폴더명 |
| `HF_HOME` | `/app/models` | HuggingFace 캐시 |

## FAQ

**Q. CPU만으로 돌릴 수 있나요?**  
A. Whisper CPU 엔진으로 fallback 가능하지만 실용성 낮음. Qwen3-ASR 권장.

**Q. 첫 실행 모델 다운로드?**  
A. Qwen3-ASR-1.7B (3.4GB) + Forced Aligner (1.2GB). `autocut-models` 볼륨에 캐시.

**Q. 윈도우?**  
A. Docker Desktop + WSL2 + nvidia-docker 조합으로 동작. Linux 권장.

## 관련 프로젝트

- [ai-video-autocut](https://github.com/dalsoop/ai-video-autocut) — 동일 API를 사용하는 Rust TUI 클라이언트 (SSH 터미널 편집용)

## 라이선스

[Envato Regular License](https://codecanyon.net/licenses/terms/regular).

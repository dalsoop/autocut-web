# autocut-web — AI Video Auto-Cutting (Qwen3-ASR powered)

> **Extract subtitles → uncheck what you don't want → one-click cut**

Designed for Korean lectures, films, and interviews. Uses **Qwen3-ASR-1.7B** for SOTA Korean transcription, then lets you edit captions inline and cut the source instantly.

## Features

- **Qwen3-ASR-1.7B** — 28% lower WER than Whisper-large-v3 (Korean)
- **Inline subtitle editing** — double-click to fix typos, split/merge, ±0.1s nudge
- **Subtitle versioning** — re-extract auto-archives previous version, switch back anytime
- **Batch transcription queue** — process the whole project, GPU-safe serial
- **Auto-displayed WebVTT captions** in the HTML5 video element
- **Cut preview** — play kept lines virtually before rendering
- **Output metadata** — engine/model/language/keep ratio attached to every cut
- **Labelled exports** — meaningful filename suffix
- **Project CRUD** — create / rename / archive folders from the UI
- **File tree** — collapsible directory navigation
- **Cancel-able jobs + full log viewer** — debug failures
- **i18n** — Korean / English UI toggle

## Requirements

| Item | Min | Recommended |
|---|---|---|
| OS | Ubuntu 22.04 / Debian 12 | - |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB (5 GB models + footage) | 100 GB+ |
| **GPU** | **NVIDIA RTX 3060 12GB** | **RTX 3090 / 4090 / A100** |
| CUDA | 12.1+ | 12.4 |
| Docker | 24+ with `nvidia-container-toolkit` | - |

> ⚠️ GPU is required. Qwen3-ASR-1.7B local inference (~4 GB VRAM).

## Install

```bash
git clone https://github.com/dalsoop/autocut-web
cd autocut-web
cp .env.example .env       # adjust WORKSPACE_DIR
./install.sh
```

Open `http://localhost:8080`. The first transcription downloads ~5 GB of models.

## Usage

1. Drop videos into `WORKSPACE_DIR/10_진행중/<project>/`
2. Pick the project in the sidebar → click a video
3. **Transcribe** (engine/language switch in ⚙ Settings)
4. Toggle line checkboxes; double-click to edit; split/merge as needed
5. **✂ Cut** → outputs `<source>_cut_<timestamp>_<label>.mp4` in the same folder

## Configuration (⚙ button)

| Field | Options |
|---|---|
| Default engine | `qwen3` / `whisper` |
| Default language | Korean / English / Japanese / Chinese |
| Whisper model | tiny ~ large-v3 |
| Qwen3 device | cuda:0 / cuda:1 / cpu |

## Architecture

```
autocut-web (Node + Vue 3) :8080
├─ REST API
│  /api/projects, /api/files, /api/tree, /api/config
│  /api/jobs/transcribe, cut, cancel
│  /api/subtitle/* (PATCH — edit/split/merge/nudge)
│  /api/vtt/*     (WebVTT download)
│  /api/subtitle-versions/*  (version list/restore)
├─ Qwen3-ASR subprocess (GPU)
└─ MoviePy/autocut subprocess (ffmpeg)

WORKSPACE_DIR/
└── 10_진행중/
    └── <project>/
        ├── video.mp4
        ├── video.srt              (subtitles)
        ├── video.md               (edit marks)
        ├── video.srt.meta.json    (engine/model meta)
        ├── video_subs/            (version archive)
        └── video_cut_<ts>_<label>.mp4
```

## Environment

| Var | Default | Purpose |
|---|---|---|
| `AUTOCUT_PORT` | `8080` | HTTP port |
| `WORKSPACE_DIR` | `./workspace` | Host video folder |
| `AUTOCUT_PROJECTS_SUBDIR` | `10_진행중` | Project subfolder name |
| `AUTOCUT_SKIP_LICENSE` | (unset) | `1` = skip Envato license check (dev) |
| `ENVATO_ITEM_ID` | (unset) | CodeCanyon item id (for Purchase Code verification) |
| `ENVATO_API_TOKEN` | (unset) | Author personal token |
| `HF_HOME` | `/app/models` | HuggingFace cache |

## FAQ

**Q. Can I run on CPU only?**
A. There's a Whisper CPU fallback, but Qwen3-ASR is the recommended path; CPU inference is impractical (30x slower than realtime).

**Q. Model download size?**
A. Qwen3-ASR-1.7B (3.4 GB) + Forced Aligner (1.2 GB) on first transcription. Cached in the `autocut-models` volume.

**Q. Windows?**
A. Works via Docker Desktop + WSL2 + nvidia-docker. Linux preferred.

## Companion projects

- [ai-video-autocut](https://github.com/dalsoop/ai-video-autocut) — Rust TUI client (SSH-friendly editing)

## License

[Envato Regular License](https://codecanyon.net/licenses/standard) — see `LICENSE`.

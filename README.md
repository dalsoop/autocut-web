# autocut-web

AutoCut 웹 UI — 자막 기반 영상 자동 편집.

zcf0508/autocut-client(Electron)를 웹 버전으로 재구성. Node + typia + Vue 3.

## 구조

```
backend/   # Node + Express + typia (API + autocut CLI 래퍼)
frontend/  # Vue 3 CDN (빌드 없이 정적 파일)
```

## 엔드포인트

| Method | Path | 용도 |
|--------|------|------|
| POST | `/api/upload` | 영상 업로드 (multipart) |
| GET | `/api/files` | 입출력 파일 목록 |
| POST | `/api/jobs/transcribe` | 자막 추출 잡 생성 (typia validate) |
| POST | `/api/jobs/cut` | MD 기반 영상 컷 잡 생성 |
| GET | `/api/jobs/:id` | 잡 상태 |
| GET | `/api/input/:name` | 입력 파일 다운로드 (SRT/MD 등) |
| GET | `/api/output/:name` | 결과 영상 다운로드 |

## 워크플로

1. 업로드 → `/opt/autocut/input/`
2. "자막 추출" → Whisper로 SRT/MD 생성
3. "편집" → MD에서 원치 않는 줄 삭제
4. "컷 편집 시작" → autocut이 남은 구간만 이어붙여 `/opt/autocut/output/`
5. 다운로드

## 실행

```bash
cd backend && npm i && npm run build && npm start
# → :8080 에서 전체 서빙
```

LXC 50064 autocut에 설치되어 `autocut-web.service`로 실행됩니다.

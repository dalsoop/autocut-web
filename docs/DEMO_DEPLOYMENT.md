# Public Demo Deployment Guide

Envato 심사용 데모 사이트 배포 가이드. 구매자가 살펴볼 수 있는 read-only 데모를 외부 도메인에 띄웁니다.

## 옵션 A: GPU VPS (RunPod / Vast.ai / Tencent Cloud GN6) — 권장

1. RTX 3060 12GB 이상 인스턴스 임대 (시간당 $0.20~$0.50)
2. Ubuntu 22.04 + Docker + nvidia-container-toolkit 셋업
3. ```bash
   git clone https://github.com/dalsoop/autocut-web
   cd autocut-web
   cp .env.example .env
   ./install.sh
   ```
4. nginx + certbot으로 TLS — `demo-autocut.<your-domain>`
5. **Read-only 모드** 환경변수: `AUTOCUT_DEMO_MODE=1` (cut/transcribe 차단, 미리 만들어둔 결과만 노출)

## 옵션 B: 자체 GPU 서버에 Cloudflare Tunnel

```bash
# 호스트에 cloudflared 설치
cloudflared tunnel create autocut-demo
cloudflared tunnel route dns autocut-demo demo.autocut.<your-domain>
cloudflared tunnel run --url http://localhost:8080 autocut-demo
```

## 옵션 C: ngrok 임시 터널 (심사 기간만)

```bash
ngrok http 8080 --domain=demo-autocut.ngrok.io
```

## 데모 데이터 준비

`workspace/10_진행중/01_demo_korean_lecture/` 에 샘플 영상 + 미리 추출된 SRT/MD/cut 결과 배치:
- 짧은 영상 (1~2분) 한국어 강의 한 개
- 사전 자막 추출 완료
- 1개 컷 결과물 포함

## Envato 심사 시 제출 정보

```
Demo URL: https://demo-autocut.example.com
Demo credentials: (없음 — 공개 read-only)
Note: GPU-required app. Demo runs on RTX 3060 inference.
      All write operations (transcribe/cut/delete) disabled in demo mode.
```

# 투어라이브 마케팅 대시보드 — Project Context

이 파일은 Claude Code가 세션 시작 시 자동으로 읽는 프로젝트 컨텍스트다.
Cowork 세션에서 시작해 이어받은 작업으로, 현재 상태와 미완 작업이 정리되어 있다.

## 프로젝트

GA4 (property `311666548`) + Meta Marketing API (`act_10202125972212509`) 데이터를
정적 HTML 대시보드로 GitHub Pages에 배포. 매일 KST 어제까지 자동 갱신.

- 배포 URL: https://cjkim91.github.io/marketing-dashboard-integration/
- 리포: https://github.com/cjkim91/marketing-dashboard-integration

## 데이터 파이프라인 (현재 구조)

**Incremental, 7-day rolling refresh** — `풀-스냅샷` 방식에서 최근 리팩토링됨.

```
public/data/daily/YYYY-MM-DD.json   ← 일자별 raw (GA4 + Meta 합본), git 관리
public/data/dashboard.json          ← 위 파일들의 머지 뷰, 프론트가 직접 읽음
```

매 빌드에서 `scripts/build_dashboard_data.py`가:

1. `--mode auto`: `daily/` 비었으면 **backfill** (90일), 아니면 **incremental** (최근 7일)
2. 받은 데이터를 일자별로 분리해 `daily/YYYY-MM-DD.json`에 delete-and-insert
3. 모든 daily 파일을 머지해 `dashboard.json` 재생성
4. 워크플로우의 마지막 스텝이 자동으로 commit & push

모드:
- `--mode backfill --lookback-days N` — N일 백필 (7일 청크)
- `--mode incremental` — 최근 7일만 (기본 1회 호출, Meta API 한도 안전)
- `--mode refresh --since X --until Y` — 임의 기간 재수신
- `--mode merge-only` — API 호출 없이 daily/*만 머지

스케줄: `.github/workflows/deploy-pages.yml` 매일 02:30 / 09:30 UTC (= 11:30 / 18:30 KST).

## 인증

### GA4
- 서비스 계정: `investor@modern-spirit-171407.iam.gserviceaccount.com`
- 키: `~/secrets/personal-gcp-sa.json` (개인 계정 소유)
- GitHub Secret: `GOOGLE_APPLICATION_CREDENTIALS_JSON` (JSON 전체 내용)

### Meta
- `scripts/fetch_meta_data.py`가 `~/Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/marketing/260209_meta_daily_report/config.py`를 자동 탐색
- 환경변수 우선: `FACEBOOK_ACCESS_TOKEN`, `AD_ACCOUNT_ID`, `META_API_VERSION`
- GitHub Secret 5개 모두 등록됨

## 프로젝트 규칙 (중요)

`~/Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/.claude/rules/`에
프로젝트별 규칙이 정의되어 있다. **반드시 준수**:

- `google-access.md` — Google 리소스는 `investor@modern-spirit-171407.iam.gserviceaccount.com`
  서비스 계정으로만 접근. `aiden.chan@kakaocorp.com` (회사 계정)으로 인증된 도구
  (예: `mcp__google-drive__*`) 사용 금지. 격리 위반.
- `meta-ads-rules.md` — rate limit, KST 타임존, 토큰 환경변수 관리.

## 미완 작업 (TODO)

작업 중간에 Cowork에서 Claude Code로 이관됨. 다음 항목들이 push 안 된 상태:

### 1. Meta API v21.0 → v25.0 마이그레이션 (2026-06-09 deprecation)

코드 변경분 (로컬에 commit 안 됨 — `git status`에 modified로 떠 있음):

- `scripts/fetch_meta_data.py` — 기본값 v25.0
- `.env.example` — v25.0
- `README.md` — 문서
- `docs/META_REUSE_NOTES.md` — 문서

또한 **GitHub Secret `META_API_VERSION`을 v21.0 → v25.0으로 갱신** 필요.
경로: https://github.com/cjkim91/marketing-dashboard-integration/settings/secrets/actions

### 2. 첫 incremental backfill 실행

`public/data/daily/`가 아직 비어 있다. push 후 워크플로우가 자동으로 `auto → backfill`로
들어가 90일치를 받는다. 소요 2~4분.

### 3. 검증

배포 후 화면 신선도 칩이 "2026-05-12까지 (전일) · 최신"으로 바뀌고,
GA4 퍼널의 상세조회 ≤ 유입 관계가 보장되는지(이전 eventCount 버그 회귀 방지) 확인.

## 최근 커밋 히스토리

```
b46c348 refactor(pipeline): 풀-스냅샷 → incremental 7일 rolling
d58c323 fix(meta): placement breakdown을 14일 청크로 분할 호출
c0dbf30 feat: Pulse v2 — 전면 개편 대시보드 및 D-1 파이프라인
f43eccd feat: dashboard UI 전면 재설계
```

## 주요 파일 위치

```
.github/workflows/deploy-pages.yml   # GHA: cron 2x/day, 자동 commit-back
scripts/build_dashboard_data.py      # 메인 빌더 (auto/backfill/incremental/refresh/merge-only)
scripts/fetch_ga4_data.py            # GA4 API 클라이언트
scripts/fetch_meta_data.py           # Meta API 클라이언트 (config 자동 탐색)
public/index.html                    # Pulse v2 대시보드 (4 페이지)
public/app.js                        # 렌더링 로직
public/styles.css                    # 라이트/다크 토큰
DESIGN.md                            # 디자인 시스템 v2
README.md                            # 파이프라인 문서
```

## 디자인 원칙 (DESIGN.md 발췌)

- Story first → KPI → 추세 → 진단 → 상세 순으로 정보 밀도 증가
- 모든 KPI에 전기간 대비 delta (색 + 텍스트)
- 블렌디드 ROAS·CAC를 오버뷰 1순위 지표
- GA4 ↔ Meta attribution 차이는 채널 분석 페이지에 명시
- 라이트/다크 토큰 분리, 동등한 가독성

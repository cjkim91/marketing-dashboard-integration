# 투어라이브 마케팅 대시보드 — Project Context

이 파일은 Claude Code가 세션 시작 시 자동으로 읽는 프로젝트 컨텍스트다.

## 프로젝트

GA4 (property `311666548`) + Meta Marketing API (`act_10202125972212509`) 데이터를
정적 HTML 대시보드로 **Cloudflare Pages**에 배포. 매일 KST 어제까지 자동 갱신.
사이트는 **Cloudflare Zero Trust Access**로 보호 — 화이트리스트 이메일만 OTP 인증 후 접근 가능.

- 배포 URL: https://tourlive-dashboard.pages.dev (Access 보호, 직접 접속 시 OTP 로그인)
- 리포: https://github.com/cjkim91/marketing-dashboard-integration
- (구) GitHub Pages는 unpublish됨 (2026-05-18). robots.txt + noindex 메타도 유지.

## 배포 흐름 (2026-05-18 이후)

```
GitHub Actions cron
  → scripts/build_dashboard_data.py → public/data/dashboard.json 갱신
  → git commit & push origin main
  → Cloudflare Pages가 push 감지 → 자동 재배포 (~30s)
  → Cloudflare Access 게이트 (OTP) → 직원만 사이트 표시
```

GitHub Pages 배포 스텝은 사용 안 함 (워크플로우 yaml에 남아 있어도 무해 — 더 이상 GitHub Pages가
활성화되어 있지 않으므로 그 스텝은 사실상 no-op이거나 실패하더라도 Cloudflare엔 영향 없음).
정리하고 싶으면 `.github/workflows/deploy-pages.yml`에서 deploy-pages 관련 스텝 제거 가능.

## 데이터 파이프라인

**Incremental, 7-day rolling refresh** — `풀-스냅샷` 방식에서 리팩토링됨.

```
public/data/daily/YYYY-MM-DD.json   ← 일자별 raw (GA4 + Meta 합본), git 관리, indent=2
public/data/dashboard.json          ← 위 파일들의 머지 뷰, 프론트가 직접 읽음, minified (Pages 25MiB 제한 대응)
```

매 빌드에서 `scripts/build_dashboard_data.py`가:

1. `--mode auto`: `daily/` 비었으면 **backfill** (90일), 아니면 **incremental** (최근 7일)
2. 받은 데이터를 일자별로 분리해 `daily/YYYY-MM-DD.json`에 delete-and-insert
3. 모든 daily 파일을 머지해 `dashboard.json` 재생성 (minified)
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
- 환경변수 우선: `FACEBOOK_ACCESS_TOKEN`, `AD_ACCOUNT_ID`, `META_API_VERSION` (v25.0)
- GitHub Secret 5개 모두 등록됨

### 사이트 접근 권한 (Cloudflare Zero Trust)
- 콘솔: https://one.dash.cloudflare.com → 본인 team
- Access → Applications → "투어라이브 대시보드" → Policies → "투어라이브 직원"
- 이메일 화이트리스트 (개별 입력). 추가/제거는 이 정책 편집으로 즉시 반영
- IdP: One-time PIN (이메일 OTP). 추가 IdP(Google SSO 등) 활성화 가능
- 접속 로그: Zero Trust → Logs → Access

## 프로젝트 규칙 (중요)

`~/Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/.claude/rules/`에
프로젝트별 규칙이 정의되어 있다. **반드시 준수**:

- `google-access.md` — Google 리소스는 `investor@modern-spirit-171407.iam.gserviceaccount.com`
  서비스 계정으로만 접근. `aiden.chan@kakaocorp.com` (회사 계정)으로 인증된 도구
  (예: `mcp__google-drive__*`) 사용 금지. 격리 위반.
- `meta-ads-rules.md` — rate limit, KST 타임존, 토큰 환경변수 관리.

## 주요 파일 위치

```
.github/workflows/deploy-pages.yml   # GHA: cron 2x/day, 자동 commit-back
scripts/build_dashboard_data.py      # 메인 빌더 (auto/backfill/incremental/refresh/merge-only)
scripts/fetch_ga4_data.py            # GA4 API 클라이언트
scripts/fetch_meta_data.py           # Meta API 클라이언트 (config 자동 탐색)
public/index.html                    # 대시보드 (4 페이지, noindex meta 포함)
public/app.js                        # 렌더링 로직
public/styles.css                    # 라이트/다크 토큰
public/robots.txt                    # 전체 disallow (이중 보안)
DESIGN.md                            # 디자인 시스템
README.md                            # 파이프라인 문서
```

## 디자인 원칙

- Story first → KPI → 추세 → 진단 → 상세 순으로 정보 밀도 증가
- 모든 KPI에 직전 동일 기간 대비 delta (색 + 텍스트)
- 블렌디드 ROAS·CAC를 오버뷰 효율 지표
- 채널/캠페인/지면 테이블에 inline delta + 총합 행
- 시계열 차트는 토글 가능한 공통 범례, 색상은 그룹 이름 기준 고정 매핑
- GA4 ↔ Meta attribution 차이는 채널 분석 페이지에 명시
- 라이트/다크 토큰 분리, 동등한 가독성

## 현재 오버뷰 페이지 구조 (참고)

1. **KPI 1행** (퍼널 순서): 유입 / 상세조회 / [장바구니] / [결제시작] / 구매 / 매출
2. **KPI 2행** (효율): 광고비 / 블렌디드 ROAS / 블렌디드 CAC
3. **퍼널 스냅샷 + 상위 캠페인 grid**
   - 상위 캠페인 컬럼: 노출 · CPM · 클릭 · CTR · 광고비 · 전환 · 매출 · ROAS + 총합 행 + 단위 대비 inline delta
4. **유입·구매·구매 전환율 추이** (3 차트 가로):
   - 그룹 셀렉터: 채널 / 소스 / Source·Medium / 캠페인
   - 모드 토글: 절대값 / 100% 비중 (구매 전환율은 라인 유지)
   - 토글 가능한 공통 범례
5. **채널별 성과 테이블** (단위 대비 + 총합)
6. **일자별 성과 히트맵** (캠페인 셀렉터 + 메트릭 셀렉터 ROAS/매출/구매 전환율)

비교 기준: KPI 1·2행, 캠페인 테이블, 채널 테이블 모두 **선택 기간 합산 vs 직전 동일 길이 기간** 비교.
시계열·히트맵·전체 표는 선택 기간 전체.

## 현재 Meta 페이지 구조 (참고)

- KPI 7개: 광고비 · 노출 · CPM · 클릭 · 전환 · CPA · ROAS
- 핵심 지표 추이 (4개 미니 차트)
- **광고 지표 추이** (신규): 캠페인/세트/광고 계층 필터 + 분해 셀렉터 + 지표 chip(최대 3개)
- **지면 효율** (확장): 메트릭 셀렉터 + 캠페인/세트/광고 필터 + 전기간 대비 inline delta
- 캠페인 성과 리뷰 테이블: 광고비 · 노출 · CPM · CTR · 전환 · CVR · 매출 · CPA · ROAS (상태 컬럼 제거)

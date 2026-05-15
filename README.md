# Pulse · Marketing Dashboard

GA4와 Meta Marketing API를 연결해 **항상 전일자(D-1, KST)까지** 조회 가능한
정적 HTML 대시보드를 GitHub Pages로 배포한다.

## 데이터 파이프라인 (incremental, 7-day rolling refresh)

```text
        ┌─ GA4 Data API ─────────┐         ┌────────────────────────┐
        │  property 311666548    │         │  Meta Marketing API    │
        │  view_item / cart /    │         │  ad account            │
        │  begin_checkout /      │         │  campaign/adset/ad/    │
        │  purchase              │         │  placement insights    │
        └────────────┬───────────┘         └────────────┬───────────┘
                     │                                  │
                     ▼                                  ▼
        ┌────────────────────────────────────────────────────────────┐
        │ scripts/build_dashboard_data.py                            │
        │                                                            │
        │  매번 최근 7일만 받아 delete-and-insert ─ Meta API 안전    │
        │  GA4 / Meta attribution 보정도 자동 반영                   │
        └─────────┬──────────────────────────────────────────────────┘
                  │
                  ▼ 일자별 분리 저장
        public/data/daily/2026-05-11.json   ← raw, version-controlled
        public/data/daily/2026-05-10.json
        public/data/daily/...
                  │
                  ▼ merge_daily_files()
        public/data/dashboard.json   ← 프론트엔드가 읽는 머지된 뷰
                  │
                  ▼
        GitHub Actions가 자동 commit → push
                  │
                  ▼
        GitHub Pages 정적 배포
```

### 운영 모드

```bash
# 자동 — daily/ 비어 있으면 90일 백필, 아니면 7일 incremental (워크플로우 기본값)
python scripts/build_dashboard_data.py

# 명시적 90일 백필 (1회성)
python scripts/build_dashboard_data.py --mode backfill --lookback-days 90

# 최근 7일만 강제 재수신
python scripts/build_dashboard_data.py --mode incremental

# 임의 기간 재수신 (delete-and-insert)
python scripts/build_dashboard_data.py --mode refresh --since 2026-04-01 --until 2026-04-30

# API 없이 daily/*만 머지
python scripts/build_dashboard_data.py --mode merge-only
```

### 저장 위치

- `public/data/daily/YYYY-MM-DD.json` — 그날 한 번 받은 raw (GA4 + Meta 합본)
- `public/data/dashboard.json` — 위 파일 전부를 합친 머지 뷰
- 두 파일 모두 git에 커밋되어 push마다 GitHub Pages가 자동 갱신

### 스케줄

`.github/workflows/deploy-pages.yml`이 매일 **두 번** 자동 실행한다.

- 02:30 UTC (= 11:30 KST) — 1차. GA4 일집계가 거의 마감된 시점.
- 09:30 UTC (= 18:30 KST) — 2차. 1차 실패/보정에 대한 안전망.

각 실행에서 `auto` 모드로 동작하므로, `daily/`가 비어 있으면 한 번 90일을 백필하고, 그 이후로는 항상 최근 7일만 갱신한다.

생성된 JSON에는 신선도 메타가 포함된다.

```jsonc
{
  "generated_at":      "2026-05-12T02:30:31+00:00",
  "generated_at_kst":  "2026-05-12T11:30:31+09:00",
  "data_through":      "2026-05-11",   // 마지막으로 포함된 KST 일자
  "expected_through":  "2026-05-11",   // 기대 D-1
  "period": { "since": "2026-02-12", "until": "2026-05-11" },
  "ga4":  { ... },
  "meta": { ... }
}
```

프론트는 `data_through`와 `expected_through`의 차이를 계산해
상단 우측 신선도 칩을 "최신 / 1일 지연 / N일 지연"으로 색상 표시한다.

## 인증

### GA4

```text
서비스 계정: investor@modern-spirit-171407.iam.gserviceaccount.com
키 파일:    /Users/aiden/secrets/personal-gcp-sa.json
```

로컬 실행:

```bash
export GA4_PROPERTY_ID=311666548
export GOOGLE_APPLICATION_CREDENTIALS=/Users/aiden/secrets/personal-gcp-sa.json
```

### Meta

```text
/Users/aiden/Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/marketing/260209_meta_daily_report/config.py
```

`scripts/fetch_meta_data.py`는 위 경로를 fallback으로 찾는다.

## 연결 테스트

GA4:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/Users/aiden/secrets/personal-gcp-sa.json \
GA4_PROPERTY_ID=311666548 \
python scripts/fetch_ga4_data.py \
  --since 2026-05-10 --until 2026-05-10 \
  --dimensions date,sessionSource,sessionMedium,sessionCampaignName \
  --metrics sessions,totalUsers,conversions,totalRevenue
```

Meta:

```bash
python scripts/fetch_meta_data.py --action list_campaigns --since 2026-05-10 --until 2026-05-10
```

## 대시보드 페이지 구성

| 페이지       | 내용 |
|-------------|------|
| 오버뷰       | 매출/광고비/블렌디드 ROAS·CAC KPI, 매출·광고비 추세, 퍼널, 채널 믹스, 상위 캠페인, 일자별 ROAS 히트맵 |
| GA4 퍼널     | 유입→상세→장바구니→결제→구매 퍼널, 채널·기기·랜딩페이지, 유입경로 상세 테이블 |
| Meta 광고    | 비용/전환/CPA/ROAS 추이, 주요 변동(전기 대비), 지면 효율 히트맵, 캠페인·광고세트·광고·지면 리뷰 |
| 채널 분석    | GA4 채널과 Meta 광고비를 한 화면에 묶은 블렌디드 효율, 어트리뷰션 차이 안내 |

상단에는 라이트/다크 토글, 기간 프리셋(7·28·90·전체), 사용자 지정 날짜,
집계 단위(일/주/월), 전기간 대비 토글이 있다.

## 디자인 시스템

자세한 토큰·원칙은 [DESIGN.md](DESIGN.md) 참고.

## GitHub Secrets

GitHub Actions에서 매일 데이터를 생성하려면 repo secrets에 아래 값을 등록한다.

```text
GA4_PROPERTY_ID
GOOGLE_APPLICATION_CREDENTIALS_JSON   # 서비스 계정 JSON 파일 내용 전체
FACEBOOK_ACCESS_TOKEN
AD_ACCOUNT_ID
META_API_VERSION                      # 선택, 기본 v25.0 (Meta가 2026-06-09에 v24 미만 deprecate)
```

수동 재빌드는 GitHub Actions UI의 "Run workflow"로 `since`/`until`을 지정하면 된다.

## 문서

- [GA4 Data API 연동 가이드](docs/GA4_DATA_API_GUIDE.md)
- [Meta 재사용 노트](docs/META_REUSE_NOTES.md)
- [데이터 연결 체크리스트](docs/DATA_CONNECTION_CHECKLIST.md)
- [데이터 연동 설계안](DATA_INTEGRATION_PLAN.md)
- [Pulse 디자인 시스템](DESIGN.md)

# Pulse · Marketing Dashboard

GA4와 Meta Marketing API를 연결해 **항상 전일자(D-1, KST)까지** 조회 가능한
정적 HTML 대시보드를 GitHub Pages로 배포한다.

## 데이터 파이프라인

```text
        ┌─ GA4 Data API ─────────┐
        │  property 311666548    │
        │  view_item / cart /    │
        │  begin_checkout /      │
        │  purchase 이벤트       │
        └────────────┬───────────┘
                     │
        ┌────────────▼───────────┐         ┌────────────────────────┐
        │ scripts/               │         │  Meta Marketing API    │
        │ build_dashboard_data.py│ ◄─────  │  ad account            │
        │ (KST 어제까지 90일)    │         │  campaign/adset/ad/    │
        └────────────┬───────────┘         │  placement insights    │
                     │                     └────────────────────────┘
                     ▼
        public/data/dashboard.json
                     │
                     ▼
        public/ → GitHub Pages
```

빌드 스크립트는 인자 없이 호출하면 KST 기준 어제를 종료일,
그 90일 전을 시작일로 자동 사용한다.

```bash
GOOGLE_APPLICATION_CREDENTIALS=/Users/aiden/secrets/personal-gcp-sa.json \
GA4_PROPERTY_ID=311666548 \
python scripts/build_dashboard_data.py --output public/data/dashboard.json
```

GitHub Actions(`.github/workflows/deploy-pages.yml`)는 매일 **두 번** 빌드한다.

- 02:30 UTC (= 11:30 KST) — 1차 빌드. GA4 일집계가 거의 마감된 시점.
- 09:30 UTC (= 18:30 KST) — 2차 빌드. 1차가 실패했거나 일부 일자가 보정된 경우 복구.

두 번 모두 종료일은 KST 어제이므로, 페이지를 열 때 항상 전일까지의 데이터가 보장된다.

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
META_API_VERSION                      # 선택, 기본 v21.0
```

수동 재빌드는 GitHub Actions UI의 "Run workflow"로 `since`/`until`을 지정하면 된다.

## 문서

- [GA4 Data API 연동 가이드](docs/GA4_DATA_API_GUIDE.md)
- [Meta 재사용 노트](docs/META_REUSE_NOTES.md)
- [데이터 연결 체크리스트](docs/DATA_CONNECTION_CHECKLIST.md)
- [데이터 연동 설계안](DATA_INTEGRATION_PLAN.md)
- [Pulse 디자인 시스템](DESIGN.md)

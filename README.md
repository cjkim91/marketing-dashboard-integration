# Marketing Dashboard Integration

GA4와 Meta Marketing API를 연결해 전일자 기준 마케팅 대시보드를 구축하기 위한 프로젝트입니다.

## 현재 연동 상태

| 플랫폼 | 상태 | 기준 |
|---|---|---|
| GA4 | 연결 확인 완료 | property_id `311666548` |
| Meta | 연결 확인 완료 | ad account `act_10202125972212509` |

## 인증 방식

### GA4

기존 서비스 계정을 재사용합니다.

```text
서비스 계정: investor@modern-spirit-171407.iam.gserviceaccount.com
키 파일: /Users/aiden/secrets/personal-gcp-sa.json
```

로컬 실행:

```bash
export GA4_PROPERTY_ID=311666548
export GOOGLE_APPLICATION_CREDENTIALS=/Users/aiden/secrets/personal-gcp-sa.json
```

### Meta

기존 Meta Marketing API config를 재사용합니다.

```text
/Users/aiden/Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/marketing/260209_meta_daily_report/config.py
```

현재 프로젝트의 `scripts/fetch_meta_data.py`는 위 config 경로를 fallback으로 찾도록 되어 있습니다.

## 연결 테스트

GA4:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/Users/aiden/secrets/personal-gcp-sa.json \
GA4_PROPERTY_ID=311666548 \
python scripts/fetch_ga4_data.py \
  --since 2026-05-10 \
  --until 2026-05-10 \
  --dimensions date,sessionSource,sessionMedium,sessionCampaignName \
  --metrics sessions,totalUsers,conversions,totalRevenue
```

Meta:

```bash
python scripts/fetch_meta_data.py \
  --action list_campaigns \
  --since 2026-05-10 \
  --until 2026-05-10
```

## 문서

- [GA4 Data API 연동 가이드](docs/GA4_DATA_API_GUIDE.md)
- [Meta 재사용 노트](docs/META_REUSE_NOTES.md)
- [데이터 연결 체크리스트](docs/DATA_CONNECTION_CHECKLIST.md)
- [데이터 연동 설계안](DATA_INTEGRATION_PLAN.md)

## 다음 단계

1. GitHub Secrets 설정
2. GitHub Actions로 매일 최근 90일 데이터 자동 생성
3. 클라이언트 공유용 지표/필터 추가

## 대시보드 데이터 생성

로컬에서 최근 2주 데이터를 생성하려면:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/Users/aiden/secrets/personal-gcp-sa.json \
GA4_PROPERTY_ID=311666548 \
python scripts/build_dashboard_data.py \
  --since 2026-04-27 \
  --until 2026-05-10 \
  --output public/data/dashboard.json
```

생성되는 `public/data/dashboard.json`은 실제 성과 데이터이므로 Git에 커밋하지 않습니다.

## GitHub Pages 자동 갱신 Secrets

GitHub Actions에서 매일 데이터를 생성하려면 repo secrets에 아래 값을 넣습니다.

```text
GA4_PROPERTY_ID
GOOGLE_APPLICATION_CREDENTIALS_JSON
FACEBOOK_ACCESS_TOKEN
AD_ACCOUNT_ID
META_API_VERSION
```

`GOOGLE_APPLICATION_CREDENTIALS_JSON`에는 서비스 계정 JSON 파일 내용을 통째로 넣습니다.
`META_API_VERSION`은 비워도 되며, 기본값은 스크립트의 `v21.0`입니다.

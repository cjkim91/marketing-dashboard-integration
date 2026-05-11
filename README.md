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

1. 전일자 GA4 JSON 생성
2. 전일자 Meta JSON 생성
3. `dashboard.json` 정규화
4. HTML 대시보드 UI 구현
5. GitHub Actions로 매일 자동 갱신

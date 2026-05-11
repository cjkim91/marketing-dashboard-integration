# GA4 Data API 연동 가이드

작성일: 2026-05-11

## 목표

GA4 전일자 데이터를 매일 자동으로 가져와 HTML 마케팅 대시보드에 보여준다.

기존 프로젝트 히스토리를 확인한 결과, 이미 동작하던 서비스 계정 방식이 있다. 따라서 현재 프로젝트는 우선 이 기존 서비스 계정을 재사용한다.

기존 연결 정보:

```text
서비스 계정: investor@modern-spirit-171407.iam.gserviceaccount.com
SA 키: /Users/aiden/secrets/personal-gcp-sa.json
GCP 프로젝트: modern-spirit-171407
이번 프로젝트 GA4 property_id: 311666548
```

2026-05-11 기준으로 `311666548` 속성에 대해 GA4 Data API `runReport` 호출이 성공했다.

## 결론

가능한 방식은 두 가지다.

| 방식 | 장점 | 단점 | 현재 추천 |
|---|---|---|---|
| 기존 서비스 계정 | 이미 GA4 접근 확인됨, 서버 자동화에 적합 | 기존 개인 SA 키에 의존 | 지금 사용 |
| 새 서비스 계정 | 가장 깔끔하게 분리 가능 | GA4에 새 SA 이메일 추가가 막혀 있음 | 나중에 전환 |
| 사용자 OAuth refresh token | GA4 사용자 추가 문제를 우회 가능, 지속 수집 가능 | 특정 Google 사용자 권한/토큰에 의존 | 예비안 |

## 현재 바로 쓰는 설정

로컬 환경변수:

```bash
export GA4_PROPERTY_ID="311666548"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/aiden/secrets/personal-gcp-sa.json"
```

연결 확인:

```bash
python scripts/fetch_ga4_data.py \
  --since 2026-05-10 \
  --until 2026-05-10 \
  --dimensions date,sessionSource,sessionMedium,sessionCampaignName \
  --metrics sessions,totalUsers,conversions,totalRevenue
```

## 기존 히스토리

이전 프로젝트:

```text
/Users/aiden/Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/marketing/260416_ga_analyzer
```

이전 스킬:

```text
/Users/aiden/.claude-personal/skills/ga-analyzer
```

이전 실행 스크립트:

```text
/Users/aiden/.claude-personal/skills/ga-analyzer/scripts/ga_query.py
```

이전 프로젝트 README에 따르면 `analyticsadmin.googleapis.com`, `analyticsdata.googleapis.com`가 활성화되어 있고, `investor@modern-spirit-171407.iam.gserviceaccount.com` 서비스 계정으로 GA4 Data/Admin API를 호출했다.

참고로 이전 프로젝트의 기본 속성은 `472492988`였지만, 이번 프로젝트는 `311666548`을 사용한다.

## OAuth Client 생성 방법

### 1. Google Cloud Console 접속

아래로 이동한다.

```text
https://console.cloud.google.com/
```

상단 프로젝트 선택에서 기존 프로젝트를 선택한다.

현재 서비스 계정 JSON 기준 프로젝트:

```text
modern-spirit-171407
```

### 2. Google Analytics Data API 활성화

왼쪽 메뉴에서:

```text
APIs & Services > Library
```

검색:

```text
Google Analytics Data API
```

들어가서 **Enable**을 누른다. 이미 활성화되어 있으면 그대로 둔다.

### 3. OAuth 동의 화면 설정

왼쪽 메뉴:

```text
APIs & Services > OAuth consent screen
```

만약 처음 설정한다면 아래처럼 둔다.

```text
User Type: Internal 또는 External
App name: Marketing Dashboard
User support email: 본인 이메일
Developer contact email: 본인 이메일
```

선택 기준:

- 회사 Google Workspace 안에서만 쓸 수 있으면 `Internal`
- 개인 Gmail 또는 외부 계정으로 승인해야 하면 `External`

중요:

- `External` + `Testing` 상태면 refresh token이 7일 후 만료될 수 있다.
- 지속 운영하려면 나중에 앱을 `Production` 상태로 전환해야 한다.
- 내부용이고 Workspace 조직 안에서만 쓰면 `Internal`이 가장 편하다.

### 4. Scope 추가

OAuth consent screen의 scope 단계에서 아래 scope를 추가한다.

```text
https://www.googleapis.com/auth/analytics.readonly
```

이 scope는 GA4 데이터를 읽기만 하는 권한이다.

### 5. OAuth Client ID 만들기

왼쪽 메뉴:

```text
APIs & Services > Credentials
```

상단:

```text
Create Credentials > OAuth client ID
```

Application type은 로컬에서 refresh token을 받기 쉬운 방식으로 아래를 추천한다.

```text
Desktop app
```

이름:

```text
Marketing Dashboard Local OAuth
```

생성하면 아래 두 값이 나온다.

```text
Client ID
Client secret
```

JSON 다운로드도 가능하다. 다운로드한 OAuth client JSON은 Git에 올리지 않는다.

## Refresh Token 받는 방법

이 프로젝트에는 refresh token 발급을 위한 별도 스크립트를 추가해서 사용할 예정이다.

필요한 Python 패키지:

```bash
python -m pip install -r requirements.txt
```

로컬에서 OAuth client JSON을 사용해 최초 1회 인증을 진행한다.

예상 실행 형태:

```bash
python scripts/create_google_oauth_token.py \
  --client-secrets /absolute/path/to/oauth-client.json
```

브라우저가 열리면 GA4 접근 권한이 있는 Google 계정으로 로그인하고 승인한다.

성공하면 아래 값들이 출력된다.

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
```

이 값들은 `.env` 또는 GitHub Actions Secrets에 저장한다. 특히 refresh token은 비밀번호처럼 취급한다.

## 로컬 환경변수

로컬 테스트 시:

```bash
export GA4_PROPERTY_ID="123456789"
export GOOGLE_OAUTH_CLIENT_ID="..."
export GOOGLE_OAUTH_CLIENT_SECRET="..."
export GOOGLE_OAUTH_REFRESH_TOKEN="..."
```

## GitHub Actions Secrets

GitHub repo에서:

```text
Settings > Secrets and variables > Actions > New repository secret
```

아래 값을 등록한다.

```text
GA4_PROPERTY_ID
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
```

## 전일자 데이터 수집 테스트

전일자 예시:

```bash
python scripts/fetch_ga4_data.py \
  --since 2026-05-10 \
  --until 2026-05-10 \
  --dimensions date,sessionSource,sessionMedium,sessionCampaignName \
  --metrics sessions,totalUsers,conversions,totalRevenue
```

정상 응답 조건:

- JSON이 출력된다.
- `source`가 `ga4`다.
- `rows` 배열이 존재한다.
- 권한 오류가 없다.

## 대시보드용 추천 쿼리

### 1. 일자별 요약

Dimensions:

```text
date
```

Metrics:

```text
sessions,totalUsers,newUsers,screenPageViews,conversions,eventCount,totalRevenue
```

### 2. 소스/매체 성과

Dimensions:

```text
date,sessionSource,sessionMedium
```

Metrics:

```text
sessions,totalUsers,conversions,totalRevenue
```

### 3. 캠페인 성과

Dimensions:

```text
date,sessionSource,sessionMedium,sessionCampaignName
```

Metrics:

```text
sessions,totalUsers,conversions,totalRevenue
```

Meta 캠페인 데이터와 맞춰볼 때 가장 중요한 GA4 데이터셋이다. 단, Meta 캠페인명과 GA4 UTM 캠페인명이 완전히 같지 않을 수 있으므로 나중에 `campaign_mapping` 테이블이 필요할 수 있다.

### 4. 랜딩페이지 성과

Dimensions:

```text
date,landingPagePlusQueryString
```

Metrics:

```text
sessions,totalUsers,conversions,totalRevenue
```

## 운영 주기

전일자 데이터만 필요하므로 매일 1회 수집이면 충분하다.

추천:

```text
매일 오전 8시-10시 KST
```

다만 GA4 속성 타임존이 한국이 아니라면, 해당 속성 타임존 기준으로 전일자가 닫힌 뒤 실행하는 게 좋다.

## 주의사항

1. OAuth client JSON, refresh token은 절대 Git에 커밋하지 않는다.
2. `External` 앱이 `Testing` 상태면 refresh token이 7일 후 만료될 수 있다.
3. 사용자가 Google 계정에서 앱 접근을 해제하면 refresh token은 무효화된다.
4. 해당 Google 사용자가 GA4 property 권한을 잃으면 API 호출도 실패한다.
5. 장기적으로는 서비스 계정 문제를 해결해서 서버 간 인증으로 전환하는 것이 더 깔끔하다.

## 공식 문서

- Google Analytics Data API Quickstart: https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart
- Google OAuth 2.0 Web Server Applications: https://developers.google.com/identity/protocols/oauth2/web-server
- Google OAuth token expiration: https://developers.google.com/identity/protocols/oauth2

---
name: "Pulse · Marketing Performance"
version: "2.0"
mode: "light + dark"
tokens:
  family: "Inter, system-ui"
  radius: "10px / 14px"
  palette:
    primary:  "#2563EB"
    positive: "#059669"
    negative: "#DC2626"
    warning:  "#D97706"
    violet:   "#7C3AED"
---

# Pulse — Marketing Performance Dashboard

## Essence

Pulse는 GA4와 Meta 광고 데이터를 한 화면에서 비교하며,
어제까지의 성과를 매일 자동으로 갱신해 보여주는 마케팅 운영용 대시보드다.
운영자가 의사결정에 필요한 데이터를 빠르게 찾고,
계정 평균과의 거리, 전기간 대비 변화, 채널·캠페인별 효율을
직관적으로 읽도록 돕는다.

## Information Architecture

총 4개 페이지로 구성한다.

```text
오버뷰        — 전사 성과 (매출/광고비/블렌디드 ROAS·CAC, 퍼널, 채널 믹스, 히트맵)
GA4 퍼널      — 사이트 측정 기반 전환 흐름과 채널/기기/랜딩 상세
Meta 광고     — 캠페인·광고세트·광고·지면 단위 효율과 변동
채널 분석     — GA4 채널 매출과 Meta 광고비를 묶어 블렌디드 효율로 진단
```

상단 고정 헤더에는 브랜드, 페이지 탭, 데이터 신선도(D-1 표시), 라이트/다크 토글이 있다.
필터 바에는 기간 프리셋(7·28·90·전체), 사용자 지정 기간, 집계 단위(일/주/월),
전기간 대비 토글이 있다.

## Data Freshness Rule

대시보드는 항상 **전일자(D-1, KST)까지** 조회 가능해야 한다.

- GitHub Actions가 매일 02:30 UTC(11:30 KST)와 09:30 UTC(18:30 KST), 두 번 빌드한다.
- 빌드 시점에 KST 기준 "어제"를 종료일로 사용한다.
- 결과 JSON에는 `data_through`, `expected_through` 필드를 포함한다.
- 프론트는 두 필드의 차이를 계산해 신선도 칩(최신/지연/장애)을 표시한다.

## Principles

1. Story first, table later. 매 페이지는 KPI → 추세 → 진단 → 상세 순서로 정보 밀도를 점진적으로 높인다.
2. Comparison is context. 모든 KPI에는 전기간 대비 델타를 곁들이고, 색만이 아닌 숫자도 함께 표시한다.
3. Blended over siloed. 블렌디드 ROAS·CAC를 오버뷰의 1순위 지표로 둔다.
4. Caveat where attribution differs. GA4와 Meta의 측정 모델 차이는 채널 분석 페이지에 명시한다.
5. Color has meaning. 매출·유입은 primary, 광고비·CPA는 warning, ROAS·전환·개선은 positive, 하락은 negative, 효율 지표는 violet.
6. Light or dark, equal quality. 두 테마 모두에서 동일하게 가독성이 유지되도록 토큰을 분리한다.
7. Empty states are intentional. 데이터가 없는 셀/패널은 빈 화면 대신 사유를 적는다.

## Layout Grid

- 페이지 좌우 패딩 28px, 패널 간 간격 18px.
- KPI는 가로 6열, 1400px 이하에서 3열, 720px 이하에서 2열로 접힌다.
- 본문 그리드는 1.35 : 1 비율의 2단을 기본으로 한다 (1100px 이하 1단으로 접힘).
- 카드 라운드 14px, 내부 그래픽 카드 10px.

## Components

### KPI Card
라벨, 큰 숫자, 도움말, 전기간 대비 델타, 우하단 스파크라인을 포함한다.
색은 메트릭 의미에 따라 6가지 변형이 있다.

### Funnel
단계 카드와 사이의 화살표를 분리하고, 화살표에 "X% 전환, −Y% 이탈"을 같이 적는다.
오버뷰의 funnel은 간단형, GA4 페이지의 funnel은 상세형 스타일을 쓴다.

### Trend Mini
96px 높이의 미니 라인 차트를 4열로 배치한다. 축은 숨기고 색·면적으로 시그널을 전한다.

### Heatmap
오버뷰는 7일 × 주 단위의 일자별 ROAS 히트맵을 보여준다.
색은 빨강(낮음)–주황–초록(높음)의 3단계 그라데이션을 쓴다.

### Placement Heatmap (Meta)
Publisher × Position 매트릭스로 ROAS를 색으로 표시한다.
광고비와 전환 수도 함께 작은 글씨로 노출한다.

### Status Badge
"확장 고려 / 모니터링 / 리뷰 필요 / 데이터 없음" 4단계.
계정 평균 ROAS 대비 자동 분류한다 (≥+20% good, −30%~+20% warn, <−30% bad).

## Charts

Chart.js 4.x를 사용한다. 모든 차트는 `palette()`에서 토큰 값을 읽어
라이트/다크 모드 전환 시 색이 자동 갱신되도록 한다.
축, 그리드, 라벨은 최소로 유지하고, tooltip은 어두운 단색 배경을 쓴다.

## Nevers

- KPI만으로 페이지를 끝내지 않는다.
- 색만으로 정보를 전하지 않는다. delta 텍스트와 함께 쓴다.
- 비교 기간 없이 단일 숫자를 강조하지 않는다.
- 어트리뷰션 차이를 무시한 GA4↔Meta 직접 합산을 하지 않는다.
- 데이터 신선도를 숨기지 않는다. D-1 지연 시 칩으로 항상 표시한다.

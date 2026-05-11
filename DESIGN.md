---
name: "Marketing Command Center"
version: "1.0"
mode: "light"
tokens:
  colors:
    background: "#F5F7FA"
    surface: "#FFFFFF"
    surface_subtle: "#F9FBFD"
    ink: "#17202A"
    muted: "#647184"
    border: "#D8E0EA"
    primary: "#1F5F99"
    primary_soft: "#E7F0F9"
    positive: "#177245"
    negative: "#B33A3A"
    warning: "#9B6400"
    neutral_chart: "#9AA8BA"
  typography:
    family: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  radius:
    card: "8px"
    control: "7px"
  spacing:
    base: "8px"
    page_x: "32px"
    panel: "18px"
---

# Marketing Command Center Design System

## Essence

운영자가 매주 광고 성과를 판단하고 예산·소재·Placement 액션을 결정하는 고밀도 마케팅 분석 도구다. 장식보다 판단 속도, 예쁜 카드보다 변화 신호, 긴 설명보다 비교 가능한 숫자를 우선한다.

## Personality

차분한 퍼포먼스 마케터. 숫자를 좋아하지만 과시하지 않고, 클라이언트에게도 설명 가능한 언어와 구조를 쓴다. 화면은 조용하지만 정보 밀도는 높다.

## Principles

1. **Trend before table**: 모든 주요 페이지는 KPI 카드 다음에 시간 흐름 차트를 둔다.
2. **Comparison is context**: 주별 모니터링이 기본이며, 전 기간 대비 증감을 같은 엔티티 기준으로 보여준다.
3. **Funnel first for GA4**: GA4는 유입, 상세페이지 조회, 구매 흐름을 먼저 보여주고, 채널·캠페인 상세는 그 아래에 둔다.
4. **Hierarchy first for Meta**: Meta는 캠페인, 광고세트, 광고, Placement 계층을 명확히 분리한다.
5. **Dense but breathable**: 표는 고밀도지만 패널 간 간격과 제목 계층은 명확하게 유지한다.
6. **Color has meaning**: 상승/개선은 green, 하락/악화는 red, 중립 정보는 blue/gray만 쓴다.
7. **No decorative analytics**: 3D, 과한 그림자, 장식용 그라데이션, 의미 없는 배경 오브젝트를 쓰지 않는다.

## Layout

대시보드는 아래 순서를 유지한다.

```text
Header: 제목, 데이터 freshness, 기간/집계 컨트롤
Primary tabs: GA4 Funnel / Meta Ads
KPI band: 4~6개의 핵심 KPI, 전 기간 대비 delta, 미니 스파크라인
Trend band: 주요 지표의 시간 흐름 차트
Diagnostic band: 퍼널, 채널, Placement 등 원인 진단 차트
Detail band: 정렬 가능한 분석 테이블
```

## Components

### KPI Cards

- 최대 6개만 상단에 둔다.
- 숫자는 크게, delta는 작지만 색상으로 분명히.
- 카드 안에 미니 스파크라인을 포함해 변화 방향을 보여준다.

### Charts

- 선형 지표 변화는 line chart.
- 채널/Placement 비교는 horizontal bar.
- 퍼널은 단계별 bar 또는 compact funnel.
- 축과 라벨은 최소화하되 단위는 명확히 표기한다.

### Tables

- 테이블은 세부 분석용이다.
- sticky header와 가로 스크롤을 허용한다.
- 숫자는 우측 정렬, 엔티티명은 좌측 정렬.
- 긴 광고명은 줄바꿈하지 않고 가로 스크롤로 처리한다.

## Nevers

- 랜딩페이지식 hero section 금지.
- UI 전체를 한 가지 파란색 계열로만 구성하지 않는다.
- KPI 카드만으로 페이지를 끝내지 않는다.
- 색으로만 의미를 전달하지 않는다. delta 텍스트도 함께 표시한다.
- 실제 데이터가 없을 때 조용히 빈 화면을 보여주지 않는다.

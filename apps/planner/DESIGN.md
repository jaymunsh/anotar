---
name: anotar planner
description: anotar 브랜드를 유지한 흰 소개 화면과 한국어·영어 타임박싱 일지의 현재 로컬 시각 체계
colors:
  canvas: '#f6f5f0'
  surface: '#fff'
  forest: '#20322d'
  ink: '#202b29'
  muted: '#586c5c'
  line: '#e0e5dc'
  action: '#315843'
  hover: '#e7ece2'
  lime: '#d8e6b5'
  plan: '#e9eeda'
  actual: '#dfebe3'
  danger: '#a74330'
  focus: '#5f8165'
  journal-boundary: '#a5b5a6'
  missed-surface: '#f3e7df'
  note-grid: rgba(49,88,67,.035)
  planning-range-surface: rgba(49,88,67,.025)
typography:
  display:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: clamp(40px, 5.2vw, 74px)
    fontWeight: 750
    lineHeight: 1.14
    letterSpacing: -0.035em
  headline:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 2.4rem
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.03em
  title:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 1.55rem
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.02em
  section-title:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 1.2rem
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: var(--font-body)
    fontWeight: 400
    lineHeight: 1.8
  label:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: var(--font-body)
    fontWeight: 600
  support:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 12px
    fontWeight: 400
  detail:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 11px
    fontWeight: 400
  table:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
  journal-heading:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.025em
  planning-title:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 14px
    fontWeight: 650
    lineHeight: 1.5
  planning-month:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.3
  planning-meta:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 10px
    fontWeight: 400
  planning-dialog-heading:
    fontFamily: DM Sans, Pretendard, sans-serif
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.3
rounded:
  short-block: 3px
  control: 8px
  brand: 9px
  panel: 12px
  feature: 14px
  example: 16px
  note-field: 5px
spacing:
  tight: 8px
  compact: 12px
  regular: 16px
  row: 20px
  section: 24px
components:
  button-primary:
    backgroundColor: '{colors.action}'
    textColor: '{colors.surface}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: 12px 18px
  button-primary-hover:
    backgroundColor: '{colors.forest}'
    textColor: '{colors.surface}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: 12px 18px
  button-text:
    backgroundColor: transparent
    textColor: '{colors.action}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: 8px
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '{spacing.compact}'
    width: 100%
  app-nav-link:
    textColor: '{colors.muted}'
    typography: '{typography.label}'
    padding: 0 4px
  app-nav-link-active:
    textColor: '{colors.action}'
  segmented:
    backgroundColor: '{colors.hover}'
    rounded: '{rounded.control}'
    padding: 3px
  segmented-selected:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.action}'
    rounded: '{rounded.control}'
    padding: 6px 12px
  feature-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    rounded: '{rounded.feature}'
  language-control:
    backgroundColor: transparent
    textColor: '{colors.muted}'
    rounded: '{rounded.control}'
    padding: 8px 4px
  policy-table:
    textColor: '{colors.ink}'
    typography: '{typography.table}'
    width: 100%
  activity-editor:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: '{spacing.section}'
  notice:
    backgroundColor: '{colors.hover}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 16px 20px
  journal-preview:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    rounded: '{rounded.feature}'
    width: 100%
  journal-preview-bar:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.muted}'
    typography: '{typography.support}'
    padding: 12px 24px
  journal-period-tab:
    textColor: '{colors.muted}'
    padding: 12px 14px
  journal-period-tab-active:
    textColor: '{colors.ink}'
  journal-mobile-tab-active:
    backgroundColor: '{colors.hover}'
    textColor: '{colors.action}'
    padding: 10px 14px
  journal-hour:
    height: clamp(26px, calc((100dvh - 260px)/24), 40px)
  journal-plan:
    backgroundColor: '{colors.plan}'
    textColor: '{colors.ink}'
    typography: '{typography.detail}'
    rounded: '{rounded.short-block}'
    padding: 1px 6px
  journal-plan-missed:
    backgroundColor: '{colors.missed-surface}'
    textColor: '{colors.danger}'
  journal-priority:
    textColor: '{colors.ink}'
    padding: 8px 0
  journal-note:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '{rounded.note-field}'
    padding: 10px 12px
  journal-activity:
    textColor: '{colors.ink}'
    padding: 14px 8px
    width: 100%
  journal-period-row:
    textColor: '{colors.ink}'
    padding: 18px 12px
    width: 100%
  annual-plan-heading:
    backgroundColor: '{colors.hover}'
    textColor: '{colors.ink}'
    typography: '{typography.planning-title}'
    height: 64px
  annual-quarter-cell:
    textColor: '{colors.ink}'
    padding: 12px
  annual-quarter-cell-in-scope:
    backgroundColor: '{colors.planning-range-surface}'
    textColor: '{colors.ink}'
  quarterly-month-heading:
    textColor: '{colors.ink}'
    typography: '{typography.planning-month}'
    padding: 4px
  planning-step:
    textColor: '{colors.ink}'
    typography: '{typography.planning-title}'
    padding: 20px 0
  planning-dialog:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: '{spacing.section}'
    width: min(520px, calc(100vw - 32px))
  planning-context:
    textColor: '{colors.muted}'
    typography: '{typography.support}'
    padding: 8px 0
---

# Design System: anotar planner

## Overview

**Creative North Star: "조용한 작업대"**

넓은 흰 소개 화면과 따뜻한 종이색 개인 작업 영역을 구분하고, 짙은 숲색의 작은 동작과 단단한 산세리프 글자를 기존 anotar에서 이어받는다. 승인된 빠른 필기 느낌의 소문자 a가 브랜드의 표정이다. 소개에서는 큰 중앙 제목과 실제 조작하는 일지 예시가 사용법을 보여주고, 개인 화면에서는 우선순위·하루 전체 시간표·회고·저장 상태가 중심이다.

밝은 바탕 위에서 본문, 보조 글자, 얇은 경계의 순서로 정보를 구분한다. 일지는 왼쪽의 오늘 꼭 할 일과 생각·아이디어·하루 돌아보기, 오른쪽의 24시간 시간표로 구성된다. 좁은 화면에서는 같은 자료를 시간표·하루 메모 탭으로 읽고 편집한다. 한국어·영어는 같은 글꼴과 구성 안에서 사용하며 작성한 내용과 편집 초안은 언어 전환 때 보존한다.

이 문서는 `src/style.css`, `src/landing.css`, `src/Landing.tsx`, `src/main.tsx`, `src/planner.tsx`, `src/journal/Journal.tsx`, `src/journal/journal.css`, `src/journal/PlanningBoard.tsx`, `src/journal/planning.css`, `src/i18n.tsx`, `src/translations.ts`, `src/legal.tsx`와 승인된 `public/brand/anotar.png`에서 추출했다. 소개의 흰 여백과 중앙 구성은 사용자가 지정한 Notion 참고를, 일지의 기능·배치는 기존 개인 서비스의 /journal 참고 화면을 따른다. 브랜드 언어는 기존 anotar에서 이어받는다. 프런트매터가 토큰의 기준이며 사이드카는 반응형 기준과 독립 렌더 예시를 보완한다. 이번 소개·KO/EN·Journal 변경은 운영 반영 전 로컬 확인용이며 초기 운영 버전과 별개다.

**Key Characteristics:**

- 넓은 흰 소개 바탕과 따뜻한 종이색 개인 작업면.
- 승인된 손글씨 a와 조밀한 산세리프 타이포그래피.
- 오늘 우선순위, 생각·아이디어·회고와 하루 전체 시간표.
- 한 시간의 가로 여섯 칸과 분 단위 길이를 보존하는 계획 표시.
- 같은 자료를 편집하는 모바일 시간표·하루 메모와 대체 활동 목록.
- 가까운 입력, 보이는 저장 상태, 작성 중인 활동의 이동 확인.
- 연간 목표×네 분기와 분기 목표·세 달 실행 계획, 같은 할 일의 일간 배치.
- 한국어·영어 화면 문구와 보존되는 사용자 기록·편집 초안.

## Colors

기존 anotar의 따뜻한 종이와 숲색을 유지하며, 일반 일정은 옅은 연두 면으로 통일하며 미이행·미룸에만 별도 상태 색을 사용한다. 이름과 값은 프런트매터의 현재 CSS 토큰을 따른다.

### Primary

- **동작 숲색 (`action`):** 주요 버튼, 링크, 수행 확인, 입력 커서에 쓴다.
- **짙은 숲색 (`forest`):** 주요 버튼의 호버 글자 대비와 브랜드의 짙은 색조를 잇는다.
- **초점 녹색 (`focus`):** 키보드 초점 외곽선에 쓴다.

### Secondary

- **작은 라임 강조 (`lime`):** 텍스트 선택과 시간 블록 호버를 표시한다.

### Tertiary

- **오류 글자 (`danger`):** 실패 문장과 삭제 동작을 표시한다. 오류는 문장과 동작 이름을 함께 제공한다.

### Neutral

- **따뜻한 종이 (`canvas`):** 개인 작업 영역, 소개의 공유 일지 예시, 모바일 예시와 소개 마지막 구역에 쓴다.
- **흰 입력 표면 (`surface`):** 공개 페이지 바탕과 헤더, 입력, 보조 버튼, 선택된 분할 버튼, 활동 작성 면에 쓴다.
- **본문 잉크 (`ink`):** 제목, 활동 이름, 기본 글자에 쓴다.
- **차분한 보조 잉크 (`muted`):** 날짜, 시간, 안내와 비선택 메뉴의 글자다. 현재 옅은 호버 면에서 확인된 대비는 (4.71:1)이다.
- **옅은 경계 (`line`):** 시간 경계, 목록 행, 페이지 구역을 나눈다.
- **옅은 보조 면 (`hover`):** 호버, 분할 선택기 바탕, 안내와 체험 표시를 받친다.
- **계획 면 (`plan`):** 일반 일정에 사용하며 done·partial 값만으로 완료 색이나 체크 아이콘을 표시하지 않는다. 이전 `actual` 토큰은 선택 날짜 등의 보조 면에 남아 있지만 일정의 실제 기록·완료를 뜻하지 않는다. 미이행·미룸과 전체 시간은 접근성 이름에도 남긴다.
- **시간 구획 (`journal-boundary`):** 시간표 머리와 여섯 시간마다의 경계를 보강한다.
- **미이행 면 (`missed-surface`):** 직접 미이행으로 표시한 계획의 옅은 면이다. `danger` 글자와 미이행 이름을 함께 제공한다.
- **계획 기간 면 (`planning-range-surface`):** 연간 목표 기간과 겹치는 분기 칸의 미세한 숲색 면이다. 완료나 성과를 나타내지 않는다.
- **메모 격자 (`note-grid`):** 투명한 메모 필드의 미세한 종이 격자다.

**The Quiet Accent Rule.** 숲색은 동작과 현재 위치에 집중하고, 공개 영역은 흰 면, 개인 작업 영역은 종이색과 옅은 표면으로 유지한다.

사이드카의 8단계 색 띠는 현재 색에서 만든 미리보기용 OKLCH 파생값이다. 실제 앱에 새 팔레트 토큰이나 화면 모드를 추가한 것으로 취급하지 않는다. 현재 플래너는 밝은 화면만 구현되어 있다.

## Typography

**Display Font:** DM Sans, Pretendard, sans-serif.
**Body Font:** DM Sans, Pretendard, sans-serif.

두 가변 글꼴은 프로젝트의 WOFF2 파일에서 불러오며 표시 방식은 `swap`이다. 영문은 DM Sans, 한국어는 Pretendard가 이어받는다. 제목은 짧고 단단하게, 설명은 여유 있는 행간으로 읽힌다. 크기는 역할별로 정해져 있으며 하나의 등비 척도를 강제하지 않는다.

### Hierarchy

- **Display:** 프런트매터의 `display`는 소개 첫 제목이다. (640px) 이하에서는 `clamp(34px, 8.7vw, 48px)`·(1.2 행간), (360px) 이하에서는 (32px)로 바뀐다. 제품 예시 아래의 소개 구역 제목은 `clamp(28px, 3vw, 40px)`·(1.3 행간)이며 모바일은 (29px)다.
- **Headline / Title / Section title:** 일반 제목은 해당 토큰을 따른다. 일간·주간·월간·분기·연간·되짚어보기의 비미리보기 제목은 `journal-heading`을 따른다. PC에서 모든 보기의 제목 비율을 통일하고 모바일도 (24px)를 유지한다. 우선순위 제목은 (16px), 시간표 제목은 PC (18px)·모바일 (16px), 활동 폼 제목은 (18px)다. 소개의 공유 일지 날짜 제목은 PC (20px)·모바일 (18px)다.
- **Body:** 기본 루트 글자는 작게 (14px), 보통 (16px), 크게 (18px)다. 일반 문단은 `body`의 행간을 쓰며 소개 첫 설명은 PC (19px·1.7), 모바일 (16px·1.8)다. 정책 본문은 PC (16px·1.85), 모바일 (15px)다.
- **Label:** 폼 라벨과 주요 동작은 (600 굵기)다. 강조 내용은 (650 굵기), 일반 제목은 (700 굵기)다.
- **Support / Detail:** 시간과 보조 문구는 각 토큰을 따른다. 일지 블록은 (11px) 한 줄 제목이며 시간 눈금은 PC (11px)·소개 예시 (10px)다. 날짜와 시간에는 고정폭 숫자(`tabular-nums`)를 쓴다.
- **Planning roles:** 목표와 분기 세부 계획 제목은 `planning-title`, 월 제목은 `planning-month`, 계획 기간·할 일 상태는 `planning-meta`, 계획 모달 제목은 `planning-dialog-heading`을 따른다. 연간 칸 안의 세부 계획 제목은 (12px·1.5 행간), 분기 헤더는 (14px·650 굵기)다. (10px) 메타데이터는 기존 조밀한 일지의 보조 정보 관례이며 결과 제목과 조작을 대신하지 않는다.
- **Table:** 정책 표는 PC에서 프런트매터의 `table`을 따르고 모바일에서도 (14px)·(1.75 행간)을 유지한다. 좁은 화면에서 읽기 글자를 더 줄이지 않는다.

모바일의 로그인·설정·할 일 추가·활동 작성·계획 모달 입력과 일지 우선순위·하루 메모는 (16px)다. 날짜 입력도 모바일에서 (16px)이며 이전·날짜·다음을 첫 줄에, 오늘·달력을 둘째 줄에 놓는다. 소개 예시의 우선순위·메모는 모바일에서 각각 (13px)·(14px)다. 제목에는 `balance`, 한국어 설명에는 `keep-all`과 긴 토큰의 줄바꿈을 적용한다. 안내는 최대 (80ch), 페이지 소개는 (65ch)이며 긴 활동 이름은 줄바꿈한다.

**The Readable Detail Rule.** 작은 시간과 상태는 본문을 보조하고, 활동의 전체 이름과 시간은 접근성 이름 또는 활동 목록에서 읽을 수 있게 남긴다.

## Layout

페이지는 가운데 정렬한 작업 영역이다. 소개 첫 구역과 공개 헤더 기준 폭은 (1280px), 제품 예시는 (1140px), 공통 푸터는 (1200px), 오늘 일지는 (1280px), 할 일·설정은 (880px), 정책은 (860px), 로그인은 (440px)다. 일지 여백은 PC (16px 32px 48px), (1050px) 이하 좌우 (24px), 모바일 (24px 18px 48px)다. 일간의 기본 Fit 보기 아래 여백은 (20px)다. 일지와 앱 헤더는 `--workspace-max-width: 1280px`와 `--workspace-gutter`를 공유한다. 최대 폭은 바깥 여백을 포함하며 내용 폭은 최대 (1216px)다. 여백은 PC (32px), (1050px) 이하 (24px), (640px) 이하 (18px)다. 체험 헤더·배너도 같은 일지 정렬을 따른다. 소개 속 작은 제품 미리보기의 폭·여백은 유지한다. 할 일·설정은 기존 공통 작업 영역을 따른다. 기본 간격은 프런트매터의 `spacing`을 따른다.

공개 푸터의 PC 오른쪽은 정보 링크 네 개와 언어 선택을 한 줄의 중앙선에 맞춘다. 링크의 최소 높이는 (44px), 링크 간격은 (22px)다. (900px) 이하에서는 브랜드를 별도 행으로 두고, (640px) 이하에서는 브랜드와 언어 선택 다음에 링크와 운영 정보를 줄바꿈한다.

공통 헤더는 PC (76px), 모바일 (66px)다. 개인 화면은 로고, 오늘·할 일, 데스크톱 언어 선택, 계정 설정·로그아웃 순서다. 개인 화면의 모바일 헤더에서는 브랜드 이름과 언어 선택을 숨기며 언어는 설정에서 고른다. (360px) 이하에서는 계정 이름도 숨기지만 설정과 로그아웃 동작은 유지한다. 공개 헤더와 푸터에는 언어 선택을 유지하고, 공개 메뉴는 모바일에서 헤더 아래의 흰 면으로 펼친다.

소개 첫 구역은 중앙 제목, 설명, 시작·체험, 넓은 제품 예시가 세로로 이어진다. PC 여백은 위 (70px)·좌우 (32px), 동작 위 간격은 (28px), 제품 예시 위 간격은 (54px)다. (900px) 이하에서는 위 여백이 (55px), (640px) 이하에서는 (42px 20px 0)와 예시 위 (36px), (360px) 이하에서는 좌우 (18px)다. 이 소개 구성은 해당 표면의 규칙이며 새 개인 화면의 공통 틀로 강제하지 않는다.

소개 제품 화면은 개인 화면과 같은 `Journal`을 체험 모드로 렌더한다. 예시 본문의 여백은 PC (20px 22px 24px)·모바일 (18px 12px 20px), PC 두 열은 `minmax(220px, .4fr) minmax(0, 1fr)`와 간격 (24px)다. 예시 시간 눈금 열은 (44px), 시간 행은 (24px)이며 모바일에서는 (28px)다. 공통 상단의 `사용 예시 / Example day` 표시는 모든 선택 화면과 폭에 남는다.

PC 일지는 `minmax(240px, .38fr) minmax(0, 1fr)` 두 열과 간격 (36px)다. 왼쪽 우선순위 아래 생각·아이디어·하루 돌아보기를 이어 붙이고, 오른쪽은 하루 전체 시간표다. (1050px) 이하에서는 왼쪽 최소 폭 (230px)·비율 (.42fr), 열 간격 (24px)로 조정한다. 생각 필드는 다른 메모보다 더 많은 세로 공간을 받는다.

시간표는 (00:00–24:00)의 24개 행이며 각 행의 가로 여섯 칸이 (10분)을 나타낸다. 시간 눈금 열은 PC (58px)·모바일 (44px), 행 높이는 PC `clamp(26px, calc((100dvh - 260px)/24), 40px)`·모바일 (28px)다. 계획은 해당 시간 행과 겹치는 부분만 그리고, 왼쪽 위치는 `(시작 분 − 해당 시각) / 60`, 가로 길이는 `해당 행과 겹치는 기간 / 60`에 비례한다. 여러 시간에 걸친 계획은 각 행에 이어서 표시하고 실제 겹치는 계획만 행 안의 높이를 나눈다.

(640px) 이하에서는 한 열로 바꾸고 시간표·하루 메모 탭을 제공한다. 두 보기 모두 오늘 꼭 할 일을 유지하며 시간표 보기는 시간표를, 하루 메모 보기는 세 메모를 보여준다. 자료를 복제하거나 탭 전환 때 초기화하지 않는다. 하루·목록 선택은 PC와 모바일 모두 제공한다. 목록 행은 최소 (52px)이며 작은 도표 셀 대신 전체 이름·시간을 읽고 수정할 수 있다.

월간은 현재 달을 제목으로 표시하고 직접 선택하는 `month` 입력, 이전 달·다음 달·이번 달 버튼을 제공한다. 이동은 월 단위이며 연도 경계와 윤년을 처리한다. 일간의 날짜 입력은 유지한다. 월간에서 중복 달력 버튼은 표시하지 않는다. 모바일 월간의 이번 달 버튼은 날짜 입력 아래 전체 열의 중앙에 둔다.

날짜 조작은 모바일에서 (36px)·유연한 날짜 입력·(36px) 세 열과 간격 (4px)인 두 줄 격자다. 첫 줄의 이전·날짜·다음 아래에 오늘과 달력을 배치해 좁은 영문 화면에도 동작을 유지한다. 일간·주간·월간·분기·연간·되짚어보기 탭은 최소 높이 (44px)를 유지하며 모바일에서 같은 폭의 세 열·두 줄로 배치한다.

**The True Time Rule.** 한 시간 행 안에서 계획의 가로 길이는 실제 분 단위 기간을 보존한다. 작은 계획의 전체 정보와 수정은 접근성 이름과 활동 목록에서 보완한다.



정책 표는 (640px) 이하에서 한 기록 안의 필드를 세로로 쌓는다. 행마다 위아래 (18px)와 얇은 경계를 두고, 다음 필드는 (14px) 간격으로 이어진다. 각 셀 위에 번역된 필드 이름을 표시하며 긴 영문은 일반 단어 단위로 읽는다. 기존 열 제목은 보조 기술에 남기고 셀의 `headers` 관계를 유지한다.

**Daily spacing choice.** Desktop adds a single Roomier / Fit day action beside timetable controls. Fit remains the default 24-hour overview. Roomier uses 32px hour rows and natural page scrolling, with notes at least 110px tall and resizable. It does not introduce an inner timetable scrollbar. Mobile and landing previews retain their existing density.

**Viewport overview.** On desktop (641px and above), the daily grid, including while an activity dialog is open measures the space below its controls and reserves a 20px bottom inset. Timetable and notes share that remaining height; the 24 hour rows flex equally. The workspace has a 420px minimum, so very short windows scroll. Notes retain at least 40px input height, and long priority lists scroll within a maximum 45% sidebar section. Activity dialogs scroll within the viewport; list, period, and mobile views retain natural scrolling. The mobile app header separates account controls and three navigation links across two rows. Schedule contains Day/Week/Month; Plans contains Quarter/Year; Review has its own top navigation entry.

Private header uses 56px on desktop and two 44px mobile rows (88px), with no added top padding. All non-preview desktop Journal views share the 24px date/period title, 16px top inset, 4px summary gap, and 6px/8px period-tab margins. Daily viewport fitting accounts for these shared compact controls; period boards use natural page scrolling.

Activity editing now uses a native modal dialog (max width 480px, viewport inset 16px), keeping the measured daily overview intact. Basic fields are title/start/end; more options holds status. Native focus, Escape and draft confirmation are preserved. Week/month share a period diary overview with planned/occupied time, checked priorities and explicit status filters. Aggregate data is fetched by authenticated date range, up to 366 days. Deferred is a current status count, not a rescheduling-history count.

Period diaries display scheduled plans and saved daily reflections. Week uses seven date columns, a single plan track and a 24-hour ruler. Its date heading is 64px high. Only overlapping plans share width. Done or partial state alone does not change the block color; explicit unfinished and deferred states do. The two headline totals are planned time and checked daily priorities. Month shows daily priorities, up to two plans and explicit flags. Separate actual entries do not appear in totals, legends, metadata or colors. Legacy entries remain stored and exportable. Dates open daily journals. Status details and calculation notes remain collapsed. At 640px and below all seven month weekday columns fit and week scrolls horizontally.

**Planning board layout.** Quarter and year now default to stored planning boards. Annual uses `minmax(160px, .8fr) repeat(4, minmax(0, 1fr))`: one goal column and four quarter columns, a 64px header, 132px minimum cells, 12px cell padding, and thin boundaries. At 900px and below, the goal minimum is 128px and cell padding is 8px. At 640px and below, the header disappears; each goal spans the row above a 2×2 quarter grid, with 116px minimum cells and 10px padding. Quarter leads with focus goals and then three equal month columns, 28px apart (20px at 900px and below); mobile stacks the months with 28px gaps. Titles wrap, and add/edit/task actions retain 44px minimum height. Quarter/year use native year/quarter selectors and previous/next/current-period actions. The URL retains the selected date and view across refreshes.

The previous three-calendar quarter and twelve-record-map year renderers remain legacy code, alongside preserved user diary data. They are not the current quarter/year defaults. Their layout values in the sidecar are explicitly scoped as legacy rather than planning-board instructions.

## Elevation & Depth

공개 화면과 개인 작업 화면은 평평한 흰 면·종이 면과 얇은 경계를 기본으로 한다. 입력 면과 선택 상태가 깊이를 구분한다. 소개 제품 예시에도 부유 그림자를 두지 않으며, 프레임과 내부 경계로 나눈다.

### Shadow Vocabulary

- **보조 버튼의 안쪽 경계** (`inset 0 0 0 1px var(--line)`): 두꺼운 외곽 테두리 없이 흰 보조 동작을 구분한다.
- **계획 모달** (`0 20px 60px rgba(32,50,45,.2)`): 네이티브 모달에만 쓰며 `rgba(32,50,45,.35)` 배경 막으로 편집 중인 표면을 구분한다. 계획표 행과 칸은 평평한 경계를 유지한다.

현재 공유 일지 예시는 별도 등장 애니메이션을 사용하지 않는다. 활동 폼으로 이동할 때 즉시 해당 면을 보이고, 버튼 상태 변화에는 별도의 전환 시간을 선언하지 않는다.

**The Flat Work Rule.** 소개 제품 예시, 개인 시간표와 활동 목록은 경계와 옅은 면으로 구분한다.

## Shapes

입력과 버튼은 부드러운 `control` 모서리, 활동 작성 면은 `panel`, 소개 제품 프레임은 `feature`를 쓴다. 제품 프레임은 모바일에서 (12px)로 줄고 별도 모바일 설명 예시는 `example`을 쓴다. 헤더의 승인된 브랜드 이미지는 PC (28px) 정사각형·(7px) 모서리이며 글자 (22px)·간격 (8px)다. 모바일은 이미지 (26px)·글자 (21px)다. 푸터의 기존 브랜드 크기는 유지한다. 이미지 자체의 손글씨 a와 짙은 녹색 바탕을 보존한다.

일지 계획은 작은 `short-block` 모서리이며 하루 메모는 `note-field` 모서리다. 시간 셀·우선순위·활동 목록·기간 탭은 직선 경계로 이어진다. 활동 목록·할 일은 카드로 감싸지 않고 아래 경계로 이어 붙인다. 선택된 개인 탐색 항목은 아래 (2px) 선을 쓰며, 기본 키보드 초점은 녹색 외곽선 (2px)·바깥 간격 (3px)이다. 선 아이콘은 Lucide의 기존 모양과 (1.8) 선 굵기를 사용한다.

## Components

### Buttons

짧고 분명한 이름과 선 아이콘을 같은 줄에 둔다. 주요·보조·텍스트 동작의 색과 여백은 프런트매터의 해당 토큰을 따른다. 주요 버튼은 호버에서 짙은 숲색으로, 보조·텍스트 버튼은 옅은 보조 면으로 바뀐다. 공통 조작 높이는 최소 (44px), 내부 간격은 (8px)다. 조밀한 주요 동작은 (8px 14px), 소개 첫 동작은 PC (12px 24px·15px 글자), 모바일 (12px 18px·14px 글자)다.

키보드 초점은 공통 외곽선이다. 비활성 상태는 (0.65) 불투명도와 기본 커서로 표시하며, 주요 버튼은 주요 색을 유지한다. 삭제는 `danger` 글자와 명시적인 삭제 이름을 쓴다.

### Inputs / Fields

흰 면, 옅은 (1px) 경계, `control` 모서리의 필드다. 최소 높이는 (44px), 커서는 동작 숲색, 자리표시자는 보조 잉크다. 라벨은 (600 굵기)이고 필드와 (8px) 떨어진다. 두 시간·상태 필드는 같은 폭 두 열이며 간격은 PC (16px), 모바일 (12px)다.

텍스트 영역은 최소 (96px)·(1.65 행간)이며 세로로 늘릴 수 있다. 하루 메모는 투명한 바탕으로 종이 면을 유지한다. 실패는 가까운 오류 문장과 `role="alert"`, 저장과 조회 상태는 `role="status"` 또는 명시된 안내로 표시한다.

### Navigation

개인 탐색은 조밀한 두 항목과 아래 선택 선이다. 기본 글자는 보조 잉크, 현재 항목은 동작 숲색·(600 굵기)와 (2px) 선이다. PC 항목 간격은 (30px), 모바일은 (14px), (360px) 이하에서는 (12px)다. 계정 설정과 로그아웃은 모바일에도 각각 (44px) 조작을 유지한다. 이전 `/app/history` 주소는 `/app?view=month`로 이동하며 저장된 기록은 일지의 기간 보기에서 탐색한다.

### Segmented Selector

일지의 하루 시간표·목록을 고르는 작은 분할 선택기다. 옅은 보조 면 안에 (3px) 여백을 두고, 선택된 버튼은 흰 면·동작 숲색·(600 굵기)로 표시한다. 버튼은 최소 (34px), 여백 (6px 12px), 글자 (12px)다. 선택 여부는 `aria-pressed`로도 제공한다. 일간·주간·월간·되짚어보기는 별도의 평평한 탭이며 현재 항목에 아래 (2px) 동작색 선과 (650 굵기)를 쓴다.

### Cards / Containers

소개 제품 프레임은 종이색 바탕·`feature` 모서리·(1px) 경계를 쓴다. 상단 예시 표시는 흰 면과 PC (12px 24px)·모바일 (10px 12px) 여백이다. 안내 면은 `notice`, 작성 면은 `activity-editor`를 따른다. 일지에서 활동 폼은 공통 최대 폭 제한 없이 작업면 폭을 사용한다.

### Shared Journal Preview

소개의 제품 화면, 별도 체험, 개인 일지는 같은 `Journal` 구성과 조작을 사용한다. 소개에서는 작은 글자와 행 높이를 쓰고 모바일 날짜 조작을 숨긴다. 가상 우선순위·계획·메모는 체험 자료임을 공통 상단 또는 체험 배너에 명시한다. 체험은 메모리 안에서 편집하며 서버 사용자 기록을 만들지 않는다. 일간·주간·월간·되짚어보기, 시간표·하루 메모, 하루·목록을 실제로 전환한다.

### Priorities / Notes

오늘 꼭 할 일은 처음 세 빈 행이며 추가는 최대 (20개), 각 제목 입력은 최대 (300자)다. 체크박스·두 자리 번호·투명한 입력·시간 잡기·삭제 순서로 이어지고 아래 경계로 나눈다. 완료 체크는 이 우선순위의 상태이며 연결 계획의 수행 상태와 별개다. 기존 일일 자료에 우선순위가 없어도 빈 기본 행으로 읽는다.

내용 있는 우선순위는 시간표로 끌어 놓거나 시간 잡기로 계획 폼을 연다. 끌어 놓은 시각은 가로 위치에 맞춘 (10분) 칸, 기본 기간은 (30분)이며 폼 저장 후 계획이 된다. 시간 잡기 버튼은 같은 동작의 대체 경로다. 계획 블록 자체의 이동·기간 늘리기는 현재 구현되어 있지 않다. 우선순위를 삭제하면 계획과의 연결만 제거하고 계획은 남긴다.

생각·아이디어·하루 돌아보기는 투명한 필드와 옅은 (16px) 격자, (1.75 행간)을 쓴다. PC는 (13px), 모바일은 (16px)이며 세로로 늘릴 수 있다. 각 메모는 최대 (20,000자)다. 모바일 하루 메모 탭도 같은 저장 자료를 편집한다.



### Language / Content State

가입 동의 항목은 체크박스 (18px) 열과 문구 열을 공유한다. 각 행은 첫 줄 중심에 맞추고 위아래 (12px) 여백, 행 사이 (4px) 간격, 안내 문구 아래 (20px) 여백을 쓴다. 최소 행 높이는 (44px)이며 모바일의 텍스트 입력 크기 규칙을 체크박스에 적용하지 않는다.

공개 헤더·푸터, 개인 데스크톱 헤더와 설정에서 네이티브 한국어·English 선택을 제공한다. 선택기는 최소 (44px), PC (13px)·공개 모바일 (12px) 글자, 투명한 면과 공통 초점을 쓴다. 언어 선택은 같은 페이지에서 표시 문구·HTML 언어·문서 제목·메타 설명·날짜와 시간 길이를 갱신하고 브라우저 선호와 URL의 `lang`에 남긴다.

알려진 시스템 오류는 원래의 메시지를 상태에 보관하고 표시할 때 번역한다. 이미 떠 있는 로그인·초기 연결·일일 저장/조회·할 일·설정 오류도 언어를 바꿀 때 다시 표시하며 입력과 오류 자체를 지우지 않는다. 라벨, 접근성 이름, 상태와 확인 문구도 같은 언어를 따른다.

실제 사용자 제목·메모·할 일과 작성 중인 폼은 번역하지 않는다. 별도 체험 화면은 원본 자료에서 표시용 사본을 만들고, 알려진 예시 ID와 원래 예시 제목이 일치하는 항목만 번역한다. 수정한 체험 제목과 메모, 확인한 수행 상태는 유지한다. 예시 폼을 저장할 때 표시 제목을 바꾸지 않았다면 원래 예시 제목을 유지하며, 언어 변경을 이유로 체험 문서를 다시 불러오거나 폼을 초기화하지 않는다.

**The Content Boundary Rule.** 화면 문구와 그대로 남은 예시 제목만 번역하고, 사용자 기록과 편집 중 입력은 보존한다.

### Public / Private Loading

공개 소개·정보·인증·체험은 사이트 정보 조회와 별도로 렌더한다. 사이트 정보 요청이 실패해도 공개 콘텐츠와 제품 예시를 전체 연결 오류 화면으로 바꾸지 않는다. 사이트 정보는 성공한 응답으로만 갱신하며 로그인 세션은 개인 경로에서 조회한다.

개인 경로의 세션 조회 중에는 로그인 확인 상태를, 연결 실패에는 번역된 오류·다시 연결·체험 이동을 표시한다. 이 연결 오류 화면은 개인 경로에 한정한다. 인증 폼과 일일 기록의 제출·저장 오류는 각 입력과 가까운 위치에서 표시한다.

### Policy Table

PC는 옅은 헤더 면과 (14px) 안쪽 여백의 세 열 표다. 모바일은 각 기록의 필드를 세로로 쌓고 번역된 `data-label`을 셀 위 (650 굵기) 이름으로 표시한다. 열 제목은 `scope="col"`과 고유 ID를 갖고 각 셀은 `headers`로 연결한다. 모바일에서 시각적으로 숨긴 `thead`도 이 관계에 남긴다. 언어 선택은 필드 이름과 내용을 함께 갱신하며 (14px) 읽기 글자·자연스러운 영문 단어 줄바꿈을 유지한다.

### Journal Timetable / Activity List

24개 시간 행과 여섯 10분 칸으로 하루 전체를 보여준다. 빈 칸을 클릭하면 해당 시각의 계획 폼을 연다. 키보드는 첫 칸에서 진입하고 방향키로 (144개) 칸 사이를 이동한다. 계획은 (11px) 한 줄 제목을 잘라 표시하고 전체 제목·시작·종료·상태를 `aria-label`과 `title`에 유지한다. 수행 완료는 `actual` 면과 체크, 미이행은 옅은 미이행 면과 오류색 글자, 호버는 라임 면이다. 취소 계획은 도표에서 제외하지만 목록에는 남긴다.

하루·목록 선택에서 목록은 같은 일정의 전체 제목·시간을 읽고 편집하는 대체 경로다. 전체 행 버튼은 최소 (52px), PC 여백 (14px 8px), 모바일에서는 시간·상태를 줄바꿈한다. 목록과 일정 수정 모달은 별도의 실제 활동 기록 동작을 제공하지 않는다. 이전 entries 자료는 저장·내보내기에서 보존한다.

### Week / Month / Review

주간은 월요일~일요일의 일곱 날짜 열, (00:00–24:00) 눈금과 저장된 회고를 보여준다. 날짜 헤더와 시간 헤더는 (64px)다. 하루마다 일정 트랙 하나를 쓰고 겹친 일정 그룹 안에서만 폭을 나눈다. 시간 기록 있음·실제 기록 지표와 색은 사용하지 않는다. 일반 일정은 계획 면이며 미이행·미룸만 명시적 상태 색을 쓴다. 월간은 우선순위·최대 두 일정·미이행·미룸을 표시한다. 현재 분기·연간은 아래의 계획표를 사용한다. 완료 합계를 달력 푸터에 표시하지 않는다. 월 제목에서 월간, 날짜와 활동에서 일간으로 이동한다. 상태 목록과 집계 기준은 접힌 보조 구역이다.

되짚어보기에는 사용자가 직접 미이행으로 표시한 계획만 모은다. 시간이 지났다고 자동 판단하지 않는다. 원래 날짜로 돌아가거나 오늘 다시 계획으로 같은 제목·시간의 새 예정 계획 폼을 연다. 원래 미이행 계획은 남긴다. 새 계획은 폼 저장이 필요한 초안이며 자동 이월을 약속하지 않는다.

Weekly compact labels: activities of 50–99 minutes show one title line without status text. Activities under 50 minutes retain time-position markers with readable title/time/status annotations below the daily reflection. The annotation provides the accessible keyboard alternative for short markers, with a 44px minimum control height. Activity height remains proportional to duration.

### Annual / Quarterly Planning Boards

연간 목표 행은 네 분기 칸에 같은 ID의 세부 계획을 기간에 따라 보여준다. 목표 기간과 겹치는 칸은 `annual-quarter-cell-in-scope`의 옅은 면과 세부 계획 추가 동작을 제공한다. 분기 제목은 해당 분기로 이동하고 모바일은 목표별 2×2 칸 위에 분기 이름을 다시 표시한다. 목표를 삭제하면 세부 계획은 독립 행으로 남는다.

분기는 집중할 목표 다음에 세 달의 실행 계획을 놓는다. 월 제목에서 월간 일지로 이동하고, 기간에 걸친 계획은 해당하는 모든 달에 같은 ID로 표시한다. 목표·계획 제목은 편집 동작이다. 독립 할 일 및 연결은 종료했으며 개별 계획의 일정 배치는 후속 설계 범위다. 자동 완료, 성과율 계산은 제공하지 않는다.

### Planning Dialog / Focus Context

목표·세부 계획 작성은 `planning-dialog`의 네이티브 모달이다. 본체는 520px 최대 폭·16px 뷰포트 여백·`panel` 모서리이고 내부 폼 여백은 PC 24px, 모바일 22px 18px다. 뷰포트 안에서 세로로 스크롤한다. 결과 제목과 시작·마칠 월이 기본 필드이며 세부 계획의 상위 목표는 선택, 메모는 접힌 추가 설정이다. 모바일 입력은 모두 16px다. 접근성 제목, 처음 제목 필드 초점, 닫은 뒤 초점 복원, 저장 중 비활성 상태, 가까운 오류·최신 계획 불러오기를 유지한다. 변경된 입력은 닫기·Escape·이동·새로고침에서 확인하며 충돌 때 입력을 보존한다.

일간·주간·월간의 `planning-context`는 해당 월 범위와 겹치는 실제 저장 목표·계획이 있을 때만 나타나는 접힌 참고 요약이다. 44px 최소 높이의 요약에 최대 두 제목과 추가 수를 보여주고 펼치면 전체 제목·기간과 분기 계획표 이동을 제공한다. 빈 자료에는 구역을 만들지 않는다. 조회 중 상태와 실패·재조회 동작은 계획표 안에서 표시한다. 목표·계획은 사용자별 ID·저장 버전과 선택적 parentId/taskIds를 갖는 별도 planning 자료다. 기존 일지 자료와 할 일을 보존하고 계정 내보내기에 포함한다.

### Activity Editor / Draft State

일지와 같은 페이지에서 여는 흰 작성 면이다. 공통 여백은 PC (24px)·모바일 (20px 16px), 일지 안에서는 최대 폭 제한이 없다. 제목·활동 이름·시작/종료·계획 상태와 연결 할 일·저장/취소 순서이며 입력 오류는 폼 안에 남긴다. 새 계획은 저장 전 삭제 동작을 보이지 않는다. 칸에서 시작하는 시각은 10분 단위지만 기존 기록의 분 단위 시각은 보존한다.

작성 중인 활동의 필드는 일일 기록의 저장 상태와 별도로 변경 여부를 추적한다. 날짜·기간 보기 변경, 다른 활동 선택, 폼 취소, 페이지 이동·로그아웃, 새로고침·닫기에서는 미저장 입력을 확인한다. 확인을 거절하면 현재 입력을 유지하며 다른 작성 화면으로 바꾸는 데 동의하면 새 폼과 새 변경 기준으로 시작한다. 아직 저장하지 않은 활동 폼을 기기에 자동 복구한다고 표현하지 않는다.

저장한 일일 기록의 변경은 저장 대기·저장 중·실패·충돌을 같은 요약 위치에서 표시한다. 실패한 일일 기록은 기기 초안으로 남고 이어쓰기·내보내기·최신 기록 확인을 제공한다. 활동 폼의 이동 확인과 이 일일 기록의 기기 초안을 하나의 상태로 합치지 않는다.



## Do's and Don'ts

### Do:

- **Do** 승인된 손글씨 a, 흰 소개 바탕과 따뜻한 종이·숲색 작업면을 유지한다.
- **Do** 새 화면에서는 이 프로젝트의 실제 토큰과 현재 글꼴을 기준으로 삼는다.
- **Do** 한 시간의 여섯 가로 칸과 계획의 분 단위 길이를 유지하고 작은 활동의 전체 정보와 수정은 목록에서 제공한다.
- **Do** 계획 상태와 실제 기록을 구분하고 목록의 독립 실제 기록 추가·계획 연결 기록 동작을 유지한다.
- **Do** 모바일 조작과 키보드 초점, 저장 상태, 미저장 활동의 이동 확인을 유지한다.
- **Do** 실패와 충돌에서 현재 입력·기기 초안을 보존하고 다음 동작을 가까이 둔다.
- **Do** 공유 일지 예시의 모든 선택 화면과 폭에서 번역된 사용 예시 문구를 보인다.
- **Do** 알려진 시스템 오류를 표시할 때 번역하고 사용자 자료와 편집 초안은 보존한다.
- **Do** 모바일 정책 표는 필드 이름과 연결된 열 제목을 유지하며 읽기 크기로 세로 배치한다.
- **Do** 공개 소개와 제품 체험은 사이트 정보 조회가 실패해도 읽고 조작할 수 있게 유지한다.

### Don't:

- **Don't** 현재 우선순위 끌어 놓기를 계획 블록 이동·기간 늘리기나 자동 저장으로 설명하지 않는다.

- **Don't** 승인된 anotar 로고를 새 아이콘이나 다른 브랜드 스타일로 바꾸지 않는다.
- **Don't** 짧은 시간 블록을 크게 늘려 시간 길이를 왜곡하거나 이어진 활동을 가리지 않는다.
- **Don't** 시간 경과만으로 미이행·실제 기록·할 일 전체 완료를 표시하지 않는다.
- **Don't** 활동 종류별 새 색이나 부유하는 카드 그림자를 개인 시간표에 덧붙이지 않는다.
- **Don't** 모바일에서 활동 목록, 설정·로그아웃, 날짜의 오늘·달력 동작을 숨기거나 문구를 쪼개지 않는다.
- **Don't** 미저장 활동 폼의 이동 확인을 일일 기록 저장 상태로 대신하거나, 구현되지 않은 폼 자동 복구를 약속하지 않는다.
- **Don't** 파생 색 띠와 기존 서비스의 어두운 팔레트를 현재 플래너의 구현 토큰으로 취급하지 않는다.
- **Don't** 언어 전환 때문에 사용자 글을 번역하거나 체험 문서·편집 폼을 다시 초기화하지 않는다.
- **Don't** 예시의 가상 활동을 사용자 기록으로 표현하거나 언어 변경 전 오류 문구를 고정하지 않는다.
- **Don't** 좁은 정책 표의 글자를 더 작게 줄이거나 일반 영문 단어를 열 폭에 맞춰 쪼개지 않는다.



### Navigation groups — 2026-10-13 local refinement

The private header uses Schedule / Plans / Review, with `aria-current=page` on the current group. Schedule uses `/app`, Plans `/app/plans`, and Review `/app/review`. Legacy `?view=quarter|year|review` links still resolve and normalize to their current route. Group changes preserve the selected date, and internal planning-to-month/day links update the header selection. No data is migrated.

At 1200px and above, the Journal heading uses three columns: period title/summary, centered period controls, date movement. Its rule and 12px bottom spacing group this row without adding another full-width tab row. At 641–1199px the title and date remain on the first row with centered period controls below. On mobile the title, date controls and centered period controls stack; the three app links share a 44px second header row with 8px gaps. Review has no period controls or date picker. Landing preview keeps its existing period-control placement. Existing native dialogs and leave/draft protection remain.


### Independent tasks retired — 2026-10-13

The Tasks page and its links, task picker/search, task-linked scheduling action and Task ID properties are removed. The three top groups are Schedule / Plans / Review. Planning dialogs keep title/month range, optional parent goal and note; activity dialogs keep title/time and status. Daily priorities are separate and remain. The local maintenance operation removes only legacy task contents and links after backup, preserving diary/planning contents and incrementing affected versions. Plans retain stable owner-scoped IDs and parent relationships; later direct activity/reflection links are a proposal, not a shipped placeholder. This section supersedes earlier Task-linking descriptions.

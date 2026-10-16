# 새 플래너와 소개

대상: src/main.tsx, src/Landing.tsx, src/landing.css, src/style.css, src/i18n.tsx, src/journal/Journal.tsx, src/journal/journal.css. 소개는 Persuade, 앱은 Operate, 정책은 Read.

## Direction contract
THESIS: 소개에서 시간표·할 일·하루 메모를 직접 보여주고, 로그인 뒤 오늘 시간표로 이어진다.
OWN-WORLD: Anotar의 승인된 a 로고, 짙은 녹색, 아이보리 작업면과 자체 서체를 유지한다. 소개는 넓은 흰 바탕, 중앙 제목, 간결한 내비게이션으로 구성한다.
STORY: 오늘 우선순위를 시간에 배치하고 회고하며 체험하거나 가입한다. 한국어/영어 선택은 소개·가입·플래너·정책에 적용하며 작성한 자료와 편집 초안은 번역하거나 초기화하지 않는다.
FIRST VIEWPORT: 가운데 큰 두 줄 제목, 짧은 설명, 시작/체험 버튼, 그 아래 넓은 제품 화면. 실제 Journal 컴포넌트로 24시간 × 10분 시간표와 우선순위·메모를 체험한다. 모바일은 시간표/하루 메모 탭으로 같은 자료를 편집한다.
FORM: 사용자 지정 Notion 한국어/영어 공식 소개 페이지를 직접 확인한 코드 구성. 흰 여백과 제품을 보여주는 구조를 참고하며 사실·서체·로고·색은 Anotar에서 온다. 사용자 지정 방향이라 별도 무작위 선택은 없다.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

확정: 개인 운영자 문성혁, support@leneu.store, 아이디+비밀번호, Osaka 운영 배포, 2026-10-12 정책 게시. 업체 계약의 법적 적합성·사용자 수·가격·수신 테스트 완료를 임의로 주장하지 않는다. 참고 화면은 .omo/evidence/notion-reference.png, 기존 화면은 incumbent-landing.png에 있다.

사용자가 지정한 기능·배치 기준: 기존 일지 스크린샷 /var/folders/5y/nx4gbxnj3tx8ggmtgldzbwg80000gn/T/orca-paste-1791736258904-8cc4c02a-e192-4ebf-a47f-107f6e285729.png. 왼쪽 할 일/생각/아이디어/회고, 오른쪽 하루 전체 시간표. 버전 충돌과 기기 초안 보호 유지. 현재 로컬 검토만, 운영 미반영.

2026-10-13 layout refinement: header and journal share a fluid 1280px maximum outer width with 32/24/18px gutters. 1440px is a QA viewport, not a required device width. Keep landing preview spacing independent. Verified day/week in KO/EN at 320, 390, 768, 1024, 1280, 1366, 1440 and 1920px, including long username truncation.

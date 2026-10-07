# anotar 브랜드

2026-10-04. 사용자가 승인한 시안은 [anotar-concept.png](anotar-concept.png)이다. 빠르게 적는 손글씨 소문자 a와 단정한 anotar 이름을 결합했다.

- [아이콘 원본](anotar-icon-source.png): imagegen 내장 도구로 승인 시안에서 앱 아이콘만 추출·재생성했다.
- 최종 프롬프트 요지: 승인된 기울어진 타원형 a·짧은 내려쓰기·둥근 오른쪽 획을 유지하고, 짙은 녹색 정사각형 배경과 아이보리 심볼만 남긴다. 글자나 외부 여백 없이 중앙에 배치한다.
- sips로 같은 원본에서 favicon 64px, PWA 192/512px를 변환했다. PWA는 maskable 안전 여백을 둔다.
- 적용: 사이드바, 로그인, 웹 제목, PWA 표시 이름/아이콘, 공유/오프라인 문서 이름, 설치 안내, 신규 Authenticator 등록 안내.
- 저장소 폴더·패키지명·도메인·기존 DB·localStorage/IndexedDB·PWA id·쿠키·암호화 AAD는 호환을 위해 유지한다. 서비스 표시 이름 변경을 데이터 이관으로 취급하지 않는다.
- GitHub/Vercel 외부 게시와 도메인 변경은 이 작업에 포함되지 않는다.

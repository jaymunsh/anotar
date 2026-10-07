# 이름 기반 공유 댓글

사용자가 이름만 입력하는 공유 댓글과 댓글 패널 개선을 승인했다. 로컬에서 끝까지 구현하며 실제 DNS/Tunnel 연결·배포·커밋은 이번 범위에 없다.

## 계약

- 개인 주소와 공개 주소는 다른 프로세스/네트워크다. `PUBLIC_SHARE_ORIGIN`은 공개 링크 기준 주소이며 도메인 이름 자체는 권한 검사가 아니다.
- 공유 링크별 `commentsEnabled`는 기본 false. 개인 공유 설정에서 기존 링크를 켜고 끄거나 발급 시 선택한다. 매 읽기/쓰기에 활성 링크·만료·페이지 활성·댓글 허용을 재검사한다.
- 개인 댓글을 공개로 전환하지 않는다. 공유 댓글은 별도 테이블에 페이지/블록별로 저장하고 새 공유 링크에서도 같은 페이지의 공유 대화를 이어간다. 폐기된 링크는 댓글도 조회/등록할 수 없다.
- 방문자는 이름 1~30자와 본문 1~2,000자만 제출한다. 이름은 인증되지 않은 표시 이름이다. 브라우저에는 최근 이름만 기억한다. 방문자는 create/reply만 가능하며 상태/삭제/작성자 배지는 개인 경로가 관리한다.
- UUID 영수증·독립 대화 버전·없는 블록의 인용 보존·페이지/대화 최대 개수는 기존 개인 댓글 계약을 따른다. 댓글은 문서 버전/수정일을 바꾸지 않는다.
- 개인 SQLite가 공유 댓글과 영수증을 저장하므로 기존 백업에 포함한다. 공개 프로세스의 DB/첨부는 계속 읽기 전용이다. 개인 서버 안의 Unix socket 댓글 전용 broker만 공개 요청을 받아 저장한다. broker 역시 토큰/동작/입력 한도 검사를 수행하고 개인 API를 노출하지 않는다.
- 공개 POST는 JSON·8KiB 한도·동일 Origin·제한된 속도를 적용한다. CSP는 같은 출처 connect만 추가하고 외부 지도 SDK/타일/개인 파일은 추가하지 않는다.

## 인터페이스

- `GET/POST /s/:token/comments`: 공개 공유 대화. GET `{items}`; POST `{requestId,action,blockId?,threadId?,expectedVersion?,name,text}` → `{items,replayed}`. visitor create/reply only.
- `GET/POST /api/pages/:id/shared-comments`: 개인 관리. 기존 댓글과 같은 action, name은 서버에서 `나`, `isOwner:true`로 고정. `?view=summary` 지원.
- `POST /api/pages/:id/shares`는 `commentsEnabled` 추가. `PATCH /api/pages/:id/shares/:shareId`는 bool 정책 수정. 목록/발급/lookup 결과에 bool 포함.
- shared comment DTO는 기존 thread/message 필드에 `name:string,isOwner:boolean`만 추가한다. 개인 DTO 필드는 유지한다.

## UI

- 개인 패널에 개인/공유 탭. 공유 댓글 작성자는 프로필+작성자 표시, 방문자는 첫 글자 아바타·실제 이름을 표시한다.
- 고정 헤더/진행·해결 필터, 두 줄 인용+본문 위치, 대화 스크롤, 고정 하단 입력. 인용/안내가 대화 영역을 과하게 차지하지 않도록 간격을 줄인다.
- PC 340px 측면 패널, 좁은 화면 접고 펼칠 수 있는 하단 패널. 공유 본문은 그대로 읽을 수 있고 말풍선은 렌더링된 공개 블록 ID에만 연결한다. 숨은 captureRef/하위 비공개 페이지에는 댓글을 만들지 않는다.
- 공개 UI는 작은 정적 JS/CSS를 사용한다. BlockNote/React/Mermaid/Google SDK를 공유 댓글에 로드하지 않는다. 모든 이름/텍스트는 textContent로 렌더링한다.
- 초안/UUID 재시도 보존, 한글 조합 중 전송 금지, 실패 안내/다시 읽기, 중복 제출 차단, 새로고침 보존. 모바일 이름/입력 16px·조작 44px.

## 확인

임시 DB의 공개 API에서 이름 저장·재전송·충돌·권한·토큰 폐기/만료/꺼짐·블록 범위·XSS·한도·원본 보존을 확인한다. 실제 브라우저에서 개인/공유 패널, 댓글/답글/해결, PC·모바일·두 테마, 새로고침을 확인한다. 사용자 샘플 페이지의 기존 개인 댓글은 보존하고 요청한 공개 예시만 추가한다. 실제 DNS/Tailscale/N100·휴대폰 키보드는 완료라고 주장하지 않는다.

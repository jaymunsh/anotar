# Anotar MCP 구현 방향 — Notion MCP 참고

2026-10-07 작성. **조사와 제안이며 MCP 서버·인증·도구가 구현됐다는 뜻은 아니다.**

## 목적과 첫 사용 시나리오

연결한 에이전트가 Anotar 자료를 검색하고, 작성 가이드를 읽고, 기존 목차·표·코드·Mermaid·콜아웃을 활용한 문서를 지정한 상위 페이지 아래에 작성한다. 기존 내용을 수정할 때에는 버전·블록 ID·잠금·수정 이력을 보존한다. 모델 호출은 연결한 에이전트가 맡는다. MCP 도구 호출만으로 Anotar AI 작업을 자동 제출하지 않는다.

첫 검증 과제: “저장한 자료를 찾아 Shared Pages 아래에 목차·표·코드·다이어그램이 포함된 학습 문서를 작성하고, 한 문단을 수정해줘.” 검색부터 생성·부분 수정과 브라우저 표시까지 실제 MCP 클라이언트에서 검증한다.

## 공식 Notion 구성에서 참고할 부분

| 공식 구성 | Anotar 적용 제안 |
|---|---|
| Notion이 호스팅하는 원격 MCP가 Notion API를 사용하고 OAuth로 사용자 접근 권한을 연결 | Oracle의 원격 MCP가 기존 개인 서비스의 저장 경로를 재사용. MCP 인증 경계와 브라우저 로그인 세션을 분리 |
| 검색 → fetch → create-pages/update-page로 문서 작업 | 소수의 문서 작업 도구와 지원 기능 조회부터 구현 |
| 조회 결과에 경로·수정 시각을 포함하며 큰 문서에는 잘린 부분을 명시 | UUID·상위 경로·version·locked·본문·직접 하위 목록을 반환. 부분 조회와 명시적 pagination/truncated 계약 제공 |
| create-pages의 content는 Markdown 입력, update_content는 일치 여부를 검증한 배치 교체 | Markdown과 블록 작업을 제공하되 Anotar 고유 블록·참조를 보존. 일반 Markdown으로 되돌리며 전체 문서를 덮지 않음 |
| 도구 접근 가능 여부 조회 | 연결별 읽기/쓰기와 페이지 범위·지원 블록·제한을 조회 가능하게 제공 |

조사 출처:

- [Notion MCP overview](https://developers.notion.com/guides/mcp/overview)
- [Supported tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)
- [Connect to Notion MCP](https://developers.notion.com/guides/mcp/get-started-with-mcp)
- [MCP TypeScript SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## 처음 제공할 인터페이스

| 제안 도구 | 계약 |
|---|---|
| `anotar-get-capabilities` | 연결 범위·권한·입력 제한·지원 블록과 작성 가이드 위치. 비밀정보는 반환하지 않음 |
| `anotar-search` | 기존 FTS 사용. 제목·발췌·UUID·타입·경로·cursor 반환. 검색 결과와 수량에 접근 범위를 먼저 적용 |
| `anotar-fetch` | UUID 또는 검증된 Anotar 페이지 주소로 조회. Markdown과 보존용 블록 데이터·version·locked·직접 하위 목록 제공 |
| `anotar-create-page` | 지정한 parentId·제목·아이콘과 Markdown 또는 block JSON. 작업 UUID 재전송, 입력 전체 검증 후 생성 |
| `anotar-update-page` | expectedVersion 필수. 명시한 블록만 추가/교체/삭제하거나 검증된 내용 교체. 잠금·충돌 시 원본 유지 |

작성 가이드와 예시는 MCP resources로 제공하고, resources를 자동으로 읽지 않는 클라이언트를 위해 fetch에서도 조회할 수 있게 한다. 첫 버전의 가져오기는 페이지·작성 가이드에 한정하고 첨부 바이트·외부 URL 수집은 별도 범위로 다룬다.

## 재사용할 기존 코드와 필요한 준비

- `server/search.mjs`: 검색·페이지네이션. MCP 접근 범위를 SQL/조회 계약에 적용해야 한다. 전체 검색 후 결과만 숨기면 개수·발췌가 노출될 수 있다.
- `server/store.mjs`, `server/sync/operations.mjs`: 저장 검증·버전 비교·작업 UUID·동기화 feed. 클라이언트가 제출한 device/workspace/epoch를 신뢰해 권한을 결정하지 않는다.
- `server/pageTools.mjs`: 도구 작업 UUID·수정 이력·블록 선택 작업. 연결별 범위 검증을 작업 대상과 참조 대상에 모두 적용한다.
- `shared/pageMarkdown.ts`, `src/pages/parseMarkdown.ts`: Markdown 출력/입력의 기존 규격. 입력 파서는 현재 브라우저 편집기 의존성이 있으므로 서버에서 실행 가능한 변환 경계를 확인한 뒤 재사용한다. 단순 Node import가 된다고 가정하지 않는다.
- `shared/childPageLinks.ts`: 상하위 관계와 본문 링크 일관성. 페이지 링크 블록은 다른 문서 참조도 가능하므로 링크만 보고 parentId를 바꾸지 않는다.

## 연결과 권한

원격 연결은 Streamable HTTP를 사용한다. 정식 범용 클라이언트 연결에는 MCP OAuth 규격을 적용하고, 사전 등록된 CLI의 제한된 검증에는 별도 만료·폐기 가능한 자격증명을 사용하되 범용 OAuth 호환으로 설명하지 않는다. DB 저장된 TOTP 비밀·브라우저 로그인 쿠키를 에이전트에 제공하지 않는다.

설정에서는 연결 이름·허용 페이지와 하위 범위·읽기/생성/수정 권한·만료·폐기·최근 사용을 관리한다. 권한은 서버에서 매 호출 검증하고 도구 설명/annotations만으로 강제됐다고 간주하지 않는다. 문서에 적힌 지시문은 데이터이며 권한 변경이나 외부 전송의 승인으로 취급하지 않는다.

공개 공유 서버와 HTML 호스팅 서버에는 개인 MCP를 추가하지 않는다. 첫 문서 도구 범위에는 삭제·공유 링크 발급·호스팅 공개·AI 요청 제출을 넣지 않는다. 이 작업들은 별도 권한과 실제 사용 수요를 확인한 뒤 확장한다.

## 구현 순서와 완료 기준

1. 원격 연결·인증 경계·읽기 범위를 구성하고 검색/조회/작성 규격 조회를 실제 클라이언트에서 검증.
2. 단일 문서 생성과 부분 수정을 추가. 동시 브라우저 수정은 충돌로 거부하고 작업 UUID 재시도는 중복 없이 성공.
3. 설정 UI와 감사 기록을 연결. 사용자 문서 가이드 기반 예제를 실제 Anotar 블록으로 작성.
4. 필요할 때 이동·댓글·첨부 도구를 추가. 처음부터 Notion의 전체 도구 목록을 복제하지 않는다.

필수 검증: 접근 범위 밖 검색/조회/쓰기 거부, 잠긴 페이지 쓰기 거부, stale version 변경 없음, 작업 재시도 중복 없음, 원본 블록·첨부 참조 보존, 하위 링크 누락 없음, Markdown 지원 표현/거부 표현 명시, 로컬과 Oracle 구성 분리. 운영 배포·실제 클라이언트 인증은 fixture SDK 테스트와 구분해서 기록한다.

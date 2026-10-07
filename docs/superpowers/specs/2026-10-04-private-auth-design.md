# 개인 인증과 오프라인 보존

사용자 승인: 개인 계정 하나, 비밀번호+Google Authenticator, 신뢰 브라우저 최대30일, Vercel 화면/Oracle 데이터 서버, 공유 공개는 후속. 이번 범위는 인증 구현과 로컬 검증이며 실제 배포·사용자 비밀번호 설정은 별도다. 기존 feature branch의 미커밋 작업을 보존한다.

## 계약

- 단일 소유자. 공개 가입 없음. 로컬 대화형 `auth:setup`으로만 비밀번호/TOTP 등록·확인, 복구 코드10개 출력. 비밀번호·코드는 argv/로그/env에 넣지 않는다. 계정 초기화는 기존 계정을 덮지 않는다.
- SQLite additive auth 테이블, async scrypt(N=131072,r=8,p=1), AES-256-GCM TOTP 암호화(32바이트 AUTH_SECRET_KEY, DB 밖). RFC6238 SHA1/6자리/30초±1구간, 성공 코드 재사용 방지. 복구 코드 hash·일회용.
- 쿠키 Secure/HttpOnly/SameSite=Strict/Path=/, host-only. 개발 localhost만 Secure=false를 명시할 수 있다. 세션12시간, 신뢰 기기는 절대30일·7일 비활동 만료. 세션 만료 시 유효 기기 쿠키로 자동 갱신. 로그인/재인증 시 토큰 교체; DB에는 토큰 hash만.
- 기기 신뢰는 브라우저/PWA 단위이며 물리 기기 지문을 추측하지 않는다. 최대20개 로그인 기록. 로그인 시 비밀번호 필수; 신뢰 쿠키는 기존 세션 갱신에 사용. 복구 코드 로그인은 신뢰 기기 발급 안 함.
- 기기 목록/개별 폐기/전체 로그아웃. 다른 기기 폐기는5분 이내 재인증 필요. 현재 로그아웃은 신뢰 쿠키도 폐기. 복원 sync epoch와 다른 세션/신뢰 기록은 무효.
- 인증 필수 모드에서는 모든 개인 /api 경로(첨부·sync·AI·백업 포함)를 guard 앞단에서 검사. health와 auth/status/login만 예외. 정적 앱 셸은 로그인 없이 다운로드할 수 있으나 개인 서버 데이터는 노출하지 않는다. HTTP 원본/Host guard는 유지하고 forwarded/IP headers를 신뢰하지 않는다. 배포는 우선 같은 origin API 프록시, CORS 직접 연결은 이번 범위 밖.
- NODE_ENV=production/외부 HOST 기본 required; loopback 개발은 disabled. 명시 disabled는 로컬/격리 QA 호환용이고 공개 금지. required인데 키/계정 없음은 API fail-closed, status는 준비 상태만.
- 로그인 최대5실패/15분 계정 전체+소켓 IP, 해시 계산 동시1, 요청4KiB·시간 제한. 응답 오류는 일반 메시지로 제한. 인증 정보·secret은 sync/검색/public HTML에 포함하지 않는다.
- 기존 기기 원문·첨부·outbox·작업 UUID는401/로그아웃 때 삭제하지 않음. 기존 문서 편집기를 로그인 패널 때문에 unmount하지 않음. 재로그인 성공 후 같은 큐를 재개. 처음 접속한 브라우저는 로그인해야 workspace를 준비.
- 원격 로그아웃은 서버 접근만 폐기, 이미 내려받은 로컬 문서를 원격 삭제하지 않음. 공유 서버에 개인 인증/계정 API 없음.

## 확인

RFC 벡터, 비밀번호/암호화, TOTP 재사용, 복구 코드, 만료/회전/폐기/복원epoch, CSRF/전체API401, 무인증 업로드 파일 생성 없음, 비밀 DTO 누출 없음. 실제 Chrome 1440/390px·양테마·키보드·로그인·기기관리·401 초안/큐 보존·재로그인 동기화. 실제 Authenticator/휴대폰과 Oracle/Vercel 배포는 별도 검증으로 표시.

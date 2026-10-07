# 정적 호스팅 실행 계획

1. server/hosting/store.mjs: 허용 경로/MIME/제한, immutable bundle+atomic registry, lock/CAS. test/hosting.test.mjs에서 상대경로/심볼릭링크/제한/재시도/충돌 검증.
2. server/hosting/http.mjs 및 server/sites.mjs: 공개 GET/HEAD·ETag·경로/manifest 경계. private routes.mjs에서 폴더multipart 등록/목록/상태수정; server/index.mjs 인증 뒤 연결.
3. scripts/host-site.mjs: 소스 디렉터리 allowlist import, PDF 제외, 기본 중지·명시 공개. 운영 환경도 동일 저장 코드.
4. src/hosting/HostingWorkspace.tsx/css: 목록·폴더등록·공개중지·주소복사·열기. main 라우트 및 설정 작업공간 진입 연결. 기존 공통 테마/44px 모바일 조작.
5. dev/Compose/Docker 운영 지원, 샘플 local 등록(원본 보존), 브라우저 HTML/CSS/JS·장 이동·테마 동작과 목록 모바일/다크 확인. build/관련테스트 및 문서 업데이트.

실패조건: 대형 multipart 중단/총합 초과에서 임시파일 정리, hidden/encoded traversal과 symlink는 노출 금지, 중지 사이트는 즉시404, stale version은409, 폴더 중복slug는 기존 내용 보존.

# 개인 정적 사이트 호스팅

사용자 목적: Oracle 개인 서버에서 독립 HTML/CSS/JS 사이트들을 제공하고 anotar에서 등록된 사이트를 관리한다. 샘플은 mathematics 폴더이며 PDF·개발 문서·도구는 제외한다. 실제 외부 도메인 배포는 로컬 검증과 구분한다.

- 개인 `/hosting`과 인증된 `/api/hosting`은 목록/폴더 등록/이름·공개상태 수정을 제공한다. 브라우저는 서버의 임의 절대 경로를 읽을 수 없다. 서버 운영용 CLI도 같은 검증/저장 코드를 사용한다.
- 파일 저장 루트 `HOSTED_SITES_DIR` 기본 `hosted-sites/`. `registry.json`에 ID/slug/name/entry/file manifest/bytes/version/enabled를 기록하고 bundles/UUID 아래 불변 파일을 둔다. 개인 DB를 공개 서버에 마운트하지 않는다.
- 별도 서버 8792는 공개 상태 사이트의 `/<slug>/` 경로와 manifest에 포함된 파일만 GET/HEAD로 제공한다. 폴더 경로 보존, index.html 기본, 목록 노출 없음, MIME/nosniff/ETag/조건부요청 제공. 404를 앱 HTML로 바꾸지 않는다.
- 허용 정적 파일은 HTML/CSS/JS/MJS/JSON/이미지/폰트/텍스트만. 숨김 경로/심볼릭링크/경로 탈출/PDF/실행형 서버 파일 제외 또는 거부. 서버 파일을 실행하지 않는다. 폴더 가져오기는 허용 확장자만 선택적으로 복사한다.
- 사이트당 50MiB/1000파일, 전체500MiB/100사이트. 신규 폴더 등록은 기본 중지 상태이며 명시 공개한다. 기존 slug를 덮어쓰지 않는다. filesystem lock+atomic registry rename, 상태 수정 CAS version. 임시 파일은 실패시 정리한다.
- PUBLIC_SITES_ORIGIN 기본 http://127.0.0.1:8792. 운영은 host.leneu.store 독립 origin. 앱은 외부탭으로 열며 HTML을 개인앱 DOM에 주입하지 않는다.
- 목록은 기존 테마와 공통 Toolbar를 따르며 모바일 줄바꿈, 로딩/실패/빈목록/등록중/버전충돌을 제공한다. 정교한 디자인 변경은 후속.
- 사이트 파일은 기존 SQLite 백업에 포함되지 않는다. 별도 디렉터리 백업 경로를 운영 문서에 명시한다.

## 주소 결정 (2026-10-05)

문서 공유는 share.leneu.store, 독립 HTML 호스팅은 host.leneu.store로 분리한다. 주소를 생략하면 서버가 이름의 영문 부분(없으면 site)과 고유값으로 경로를 생성한다. 등록 후 이름 수정은 주소를 바꾸지 않으며 기존 slug도 유지한다. 직접 주소 지정은 선택 사항이다. 실제 DNS/TLS 연결은 원격 배포 후 검증한다.

# 정적 웹 호스팅

anotar 페이지 공유와 독립된 HTML/CSS/JS 호스팅이다. 개인 앱은 관리 목록만 제공하고 사이트 자체는 별도 프로세스/출처에서 열린다. Node/PHP 실행, 서버 API, 빌드 자동화는 제공하지 않는다.

## 로컬 사용

`npm run dev`는 개인 API(8787)·Vite(5173)·정적 서버(8792)를 함께 시작한다. 정적 서버만 시작하려면 `npm run start:sites`.

- 관리 목록: `http://127.0.0.1:5173/hosting`
- 진입: 설정 → 작업 공간 → 웹 호스팅
- 사이트 주소: `http://127.0.0.1:8792/<slug>/`

폴더 등록에서 사이트 폴더·이름·시작 HTML을 선택한다. 주소 경로는 비워두면 서버가 자동 생성한다. 영문 이름은 `my-site-<고유값>`, 한글 이름은 `site-<고유값>` 형태이며 같은 이름으로 다시 등록해도 서로 다른 주소를 받는다. 등록 후 이름을 바꿔도 주소는 유지한다. 원하는 영문 경로가 있을 때만 직접 입력한다. 기존 `mathematics` 주소도 유지한다.

하위 폴더를 유지하고 HTML/CSS/JS/JSON/이미지/폰트/텍스트만 등록한다. PDF·숨김 파일·지원하지 않는 파일은 제외한다. 서버는 임의 로컬 절대 경로를 웹 요청으로 읽지 않는다. 새 등록은 중지 상태이며 공개를 누르면 로그인 없이 열 수 있다. 공개 중지는 기존 방문자가 새로 요청하는 파일에도 적용된다. 이미 내려받은 파일/화면을 회수하는 기능은 아니다.

동일 slug 등록은 기존 파일을 덮어쓰지 않는다. 현재 목록에서는 이름 수정·주소 복사·열기·공개/중지를 지원한다. 새 파일로 기존 사이트를 갱신하는 버전 배포 UI와 삭제/용량 회수는 후속이다. 업데이트 샘플은 다른 slug로 등록한다.

## 로컬 폴더 CLI

```sh
npm run sites:import -- /path/to/site --name '내 사이트'
node scripts/host-site.mjs list
```

기본은 중지. 출력의 `slug`가 생성된 주소 경로다. `--slug mathematics`로 주소를 직접 지정할 수도 있다. 바로 공개할 때만 `--publish`를 추가한다. `--entry book.html`로 시작 파일을 선택한다. `--dir /srv/leneu/sites`로 저장 위치를 지정할 수 있다. 원본 폴더를 수정하지 않고 허용 파일의 사본을 만든다. PDF나 개발 문서/도구는 포함되지 않는다.

서버에도 폴더를 수동으로 넣을 수 있다. 먼저 원본을 `/srv/leneu/inbox/my-site` 같은 임시 업로드 위치에 복사한 뒤 위 CLI로 등록한다. Docker 운영 중이라면 앱의 `compose.yaml`이 있는 디렉터리에서 다음처럼 실행한다. `/srv/leneu/inbox`는 먼저 만들어 둔다.

```sh
sudo docker compose run --rm --no-deps \
  -v /srv/leneu/inbox:/import:ro \
  storage node scripts/host-site.mjs import /import/my-site --name '내 사이트' --dir /sites
```

등록 결과는 관리 목록에 나타난다. `hosted-sites/` 또는 `/srv/leneu/sites` 안에 폴더만 넣어서는 등록되지 않는다. CLI가 파일 검증과 목록 갱신을 함께 수행하므로 `registry.json`이나 `bundles/`를 직접 편집하지 않는다.

이번 샘플은 `/path/to/mathematics`에서 가져온 HTML 47개와 CSS·JS 3개, 약 2.3 MB다. 수식용 KaTeX는 원본에서 사용하는 jsDelivr CDN을 유지하므로 해당 수식 자산은 인터넷 연결이 필요하다. 상대 파일 링크는 그대로 동작한다. `/assets/...`처럼 사이트 루트에 고정된 링크를 사용하는 빌드 결과는 `/<slug>/` base로 빌드하거나 상대경로로 바꿔야 한다.

## 저장과 제한

- `HOSTED_SITES_DIR` 기본 `hosted-sites/`.
- `registry.json`: 목록/공개 상태/수정 버전/파일 크기·SHA256.
- `bundles/<UUID>/`: 가져온 정적 파일. 공개 서버는 manifest 파일만 GET/HEAD 제공.
- 사이트당 1,000개 파일·50 MiB, 개별 파일 25 MiB, 전체 100개 사이트·500 MiB. 저장 한도이며 Oracle 무료 한도나 서버 트래픽 제한과는 별개다.
- `hosted-sites/`는 Git·Docker 빌드 문맥에서 제외한다. 실제 콘텐츠는 별도 볼륨으로 배포한다.
- 기존 SQLite/첨부 자동 백업에는 포함되지 않는다. 별도 디렉터리 백업이 필요하다. 모든 import/공개상태 변경을 멈춘 뒤 디렉터리 전체를 복사하면 registry와 bundle을 함께 보존할 수 있다. 복원은 새 디렉터리에 하고 검증 뒤 mount를 바꾼다.
- 저장 시 filesystem `.lock`과 registry 원자 교체를 사용한다. 같은 호스트의 종료된 owner PID는 자동으로 회수한다. 다른 호스트/컨테이너 또는 회수 자체가 중단된 lock은 등록 프로세스가 모두 종료됐는지 확인한 뒤 해당 lock만 제거한다. registry/bundles를 임의로 수정하지 않는다.

## Oracle/Docker

Compose에 `sites` 서비스를 추가했다. `/sites` 정적 볼륨만 읽기 전용으로 마운트하며 개인 DB·API·키를 전달하지 않는다. 개인 `storage`는 같은 정적 볼륨에 등록/상태 쓰기 권한을 갖는다.

```sh
# 운영 .env의 추가 값
LENEU_SITES_DIR=/srv/leneu/sites
PUBLIC_SITES_ORIGIN=https://host.leneu.store
PUBLIC_SHARE_ORIGIN=https://share.leneu.store

# 실행
mkdir -p /srv/leneu/sites
docker compose up -d --build storage share sites
```

공개 주소는 용도별로 나눈다. 문서 공유의 토큰은 기존 공유 기능에서 발급하며, 정적 사이트 경로는 등록 시 자동 생성한다.

| 용도                    | 주소                                      | 서버 내부        |
| ----------------------- | ----------------------------------------- | ---------------- |
| anotar 문서 공유        | `https://share.leneu.store/s/<토큰>`      | `127.0.0.1:8790` |
| 독립 HTML/CSS/JS 사이트 | `https://host.leneu.store/<생성된 경로>/` | `127.0.0.1:8792` |

`share`와 `host` DNS를 Oracle 공인 IP에 연결한 뒤 **호스트 OS에서 실행하는 Caddy**에 [deploy/Caddyfile.public](../deploy/Caddyfile.public)의 설정을 추가한다.

```caddyfile
share.leneu.store {
    reverse_proxy 127.0.0.1:8790
}

host.leneu.store {
    reverse_proxy 127.0.0.1:8792
}
```

서버 8790/8792는 호스트 loopback만 바인딩하고 외부 80/443은 프록시가 받는다. 이 템플릿의 localhost는 Caddy를 별도 컨테이너에서 실행할 때 사용할 수 없으므로 그 경우 서비스 네트워크 설정을 따로 맞춘다. 개인 앱과 다른 origin을 유지한다. 생성된 경로는 비밀번호가 아니며 공개한 사이트는 누구나 접근할 수 있다.

현재는 로컬 구현/샘플 검증과 배포 템플릿 준비까지이며 실제 DNS·TLS·Oracle 배포는 별도 실행해야 한다. 다음 순서는 같은 주소로 파일 갱신·이전 버전 복구·삭제, 정적 디렉터리 백업/복원 검증, Oracle ARM64 배포, DNS/TLS 연결이다.

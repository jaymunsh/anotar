# anotar 메타데이터와 검색 노출

2026-10-04. 현재 앱은 개인 작업 공간이며 공개 소개 사이트가 아니다.

## 적용

- 한국어 제목/설명, application-name, iOS 설치 이름.
- Open Graph 서비스명/제목/설명/로고/언어와 Twitter summary 카드.
- 개인 앱은 HTML robots `noindex, nofollow`. 공유 문서도 기존 noindex를 유지한다. 접근 보호는 별도 로그인/공유 토큰의 책임이다.
- 공유 미리보기에는 공유된 제목과 일반 설명만 넣고 본문·댓글·첨부 내용·개인 데이터에서 설명을 추출하지 않는다. 제목은 기존 HTML escaping을 적용한다.
- 검색 대상 문서가 없으므로 sitemap과 Search Console 등록은 지금 추가하지 않는다. robots.txt의 전체 Disallow로 noindex 읽기를 막는 구성을 추가하지 않는다.

## 배포 때 확정

실제 서비스 origin 확정 후 개인 앱의 og:image/twitter:image를 같은 origin의 절대 HTTPS URL로 설정한다. 현재 상대 경로는 로컬 확인용이며 실제 메신저 미리보기 검증은 배포 이후다. 소개용 사이트를 따로 만들 때 그 주소에만 canonical/og:url/sitemap/index 설정을 추가한다. 공유 토큰 URL을 canonical·sitemap·외부 분석 서비스에 자동 등록하지 않는다.

참고: [Google noindex 안내](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

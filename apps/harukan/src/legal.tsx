import {t,pair} from './i18n';
import type { Site } from './api';

export function Legal({kind,site}:{kind:string;site:Site}) {
  const l=site.legal,operator=l.operator||t("운영자 정보 확인 중");
  const titles:Record<string,string>={privacy:t("개인정보처리방침"),terms:t("이용약관"),about:t("운영자와 서비스 안내"),contact:t("문의하기")};
  return <article className="legal-page"><a href="/">{t("서비스 소개로")}</a><h1>{titles[kind]||titles.about}</h1>
    {!site.legalReady&&<p className="notice">{t("공개 전 검토 중인 문서입니다. 운영 환경과 시행일을 확인한 뒤 최종 게시합니다.")}</p>}
    <p className="legal-date">{l.publishedAt?`${pair("시행일","Effective date")} ${l.publishedAt}`:t("시행일: 공개 전 확정 예정")}</p>
    {kind==='privacy'?<>
      <p>{pair(`${operator}은(는) harukan 플래너를 운영하며 다음과 같이 개인정보를 처리합니다.`, `${operator} operates the harukan planner and processes personal information as described below.`)}</p>
      <h2>{t("처리하는 정보와 목적")}</h2><table className="policy-table"><thead><tr><th scope="col" id="policy-0-0">{t("정보")}</th><th scope="col" id="policy-0-1">{t("목적")}</th><th scope="col" id="policy-0-2">{t("보유 기간")}</th></tr></thead><tbody>
      <tr><td headers="policy-0-0" data-label={t("정보")}>{t("아이디, 비밀번호 해시, 복구코드 해시, 가입 시각, 약관 확인 버전")}</td><td headers="policy-0-1" data-label={t("목적")}>{t("회원 식별·로그인·계정 복구")}</td><td headers="policy-0-2" data-label={t("보유 기간")}>{t("회원 탈퇴까지")}</td></tr>
      <tr><td headers="policy-0-0" data-label={t("정보")}>{t("일정·실제 활동·할 일·메모·날짜·시간대·변경 버전")}</td><td headers="policy-0-1" data-label={t("목적")}>{t("개인 플래너 저장과 조회")}</td><td headers="policy-0-2" data-label={t("보유 기간")}>{t("삭제 또는 회원 탈퇴까지")}</td></tr>
      <tr><td headers="policy-0-0" data-label={t("정보")}>{t("로그인 세션 식별자와 요청 확인 값")}</td><td headers="policy-0-1" data-label={t("목적")}>{t("로그인 유지·요청 검증")}</td><td headers="policy-0-2" data-label={t("보유 기간")}>{t("로그아웃 또는 최대 7일")}</td></tr>
      <tr><td headers="policy-0-0" data-label={t("정보")}>{t("IP 주소와 아이디에서 만든 시도 제한용 해시")}</td><td headers="policy-0-1" data-label={t("목적")}>{t("로그인·가입·복구 남용 방지")}</td><td headers="policy-0-2" data-label={t("보유 기간")}>{t("최대 24시간 뒤 만료, 이후 1시간 이내 정리")}</td></tr>
      <tr><td headers="policy-0-0" data-label={t("정보")}>{t("탈퇴한 계정의 무작위 식별자와 탈퇴 시각")}</td><td headers="policy-0-1" data-label={t("목적")}>{t("장애 복구 시 탈퇴 계정의 재생성 방지")}</td><td headers="policy-0-2" data-label={t("보유 기간")}>{t("8일 뒤 만료, 이후 1시간 이내 정리")}</td></tr>
      <tr><td headers="policy-0-0" data-label={t("정보")}>{t("문의 이메일과 이용자가 보낸 내용")}</td><td headers="policy-0-1" data-label={t("목적")}>{t("문의 처리")}</td><td headers="policy-0-2" data-label={t("보유 기간")}>{t("처리 완료 후 1년. 삭제 요청 시 별도 법적 보존 사유를 확인해 처리")}</td></tr>
      </tbody></table>
      <p>{t("비밀번호와 복구코드는 원문으로 저장하지 않습니다. 회원가입에는 이메일·전화번호·주소·실명을 요구하지 않습니다. 입력한 메모 자체에 개인정보가 포함될 수 있습니다.")}</p>
      <h2>{t("파기와 백업")}</h2><p>{t("회원 탈퇴 시 계정·세션·일정·할 일을 운영 데이터베이스에서 삭제합니다. 장애 복구용 백업은 같은 서버에 매일 만들고 7일이 지난 사본은 다음 백업 실행 때 제거합니다. 탈퇴 이전 백업에 남은 자료도 이 주기에 따라 제거하며, 백업 복구 시 별도 탈퇴 기록을 적용하고 모든 로그인 세션을 폐기합니다. 이용자가 내보낸 사본은 이용자가 관리합니다. 문의 메일은 처리 완료 후 1년이 지나면 운영자가 삭제합니다.")}</p>
      <h2>{t("처리 위탁과 국외 이전")}</h2><p>{pair("온라인 저장과 안전한 접속에 필요한 처리 위탁·보관을 위해 아래 제공자를 이용합니다. 서버 저장 지역은", "We use the following providers for the processing and storage needed for online records and secure access. Server storage location:")}{' '}{l.hostingRegion?(l.hostingRegion.includes("ap-osaka-1")?pair(l.hostingRegion,"Osaka, Japan (ap-osaka-1)"):l.hostingRegion):pair("배포 전 확인 예정","To be confirmed before deployment")}{pair("입니다. 서버 저장, 접속 처리 및 문의 전달은 이용자가 가입·저장·접속·문의할 때 네트워크를 통해 이루어집니다.",". Server storage, connection processing, and inquiry forwarding take place over the network when you register, save, connect, or contact us.")}</p>
      <table className="policy-table"><thead><tr><th scope="col" id="policy-1-0">{t("제공자·처리 위치")}</th><th scope="col" id="policy-1-1">{t("항목·목적")}</th><th scope="col" id="policy-1-2">{t("기간·연락처")}</th></tr></thead><tbody>
        <tr><td headers="policy-1-0" data-label={t("제공자·처리 위치")}>{t("Oracle Corporation · 일본 오사카")}</td><td headers="policy-1-1" data-label={t("항목·목적")}>{t("계정 해시·플래너 자료·백업의 서버 보관")}</td><td headers="policy-1-2" data-label={t("기간·연락처")}>{t("위 보유·백업 기간 적용.")}{' '}<a href="https://www.oracle.com/legal/privacy/services-privacy-policy/">{t("Oracle 개인정보 안내·문의")}</a></td></tr>
        <tr><td headers="policy-1-0" data-label={t("제공자·처리 위치")}>{t("Cloudflare, Inc. · 미국 및 글로벌 네트워크")}</td><td headers="policy-1-1" data-label={t("항목·목적")}>{t("접속 IP·요청·전송 내용의 보안 연결과 전달, 문의 이메일 라우팅")}</td><td headers="policy-1-2" data-label={t("기간·연락처")}>{t("접속·전달 수행 및 제공자의 보안 로그 정책에 따른 기간.")}{' '}<a href="https://www.cloudflare.com/privacypolicy/">{t("Cloudflare 개인정보 안내·문의")}</a></td></tr>
        <tr><td headers="policy-1-0" data-label={t("제공자·처리 위치")}>{t("Google LLC · 미국 및 글로벌 서버")}</td><td headers="policy-1-1" data-label={t("항목·목적")}>{t("이용자가 보낸 이메일 주소·문의 내용의 Gmail 전달 수신·보관")}</td><td headers="policy-1-2" data-label={t("기간·연락처")}>{t("문의 처리 완료 후 1년.")}{' '}<a href="https://policies.google.com/privacy?hl=ko">{t("Google 개인정보 안내·문의")}</a></td></tr>
      </tbody></table>
      <p>{t("Cloudflare와 Google의 네트워크 처리 위치는 요청 경로와 제공자 운영에 따라 달라지며 국내에만 한정되지 않습니다. 서버 자료를 별도 외부 저장소에 복제하는 기능은 현재 사용하지 않습니다. 운영 앱은 요청 본문·비밀번호 원문을 로그로 남기지 않습니다. 제공자의 처리 범위는 각 개인정보 안내에서 확인할 수 있습니다.")}</p>
      <p>{pair("국외 보관·처리를 원하지 않으면 가입·저장 전에 이용을 중단하거나 설정에서 자료를 내보내고 탈퇴할 수 있습니다. 개인정보 처리에 관한 문의·중단 요청은","If you do not want international storage or processing, you can stop before registering or saving, or export your data and delete your account in Settings. Send privacy inquiries and requests to stop processing to")}{' '}<a href={`mailto:${l.contact}`}>{l.contact}</a>{pair("로 받습니다. 온라인 저장에 필요한 처리를 중단하면 서비스 이용이 제한될 수 있습니다.",". Stopping processing required for online storage may limit your use of the service.")}</p>
      <p>{t("광고·행동 분석 SDK·외부 AI 실행 기능은 이 플래너에 포함하지 않습니다. 사용자 일정과 메모를 다른 방문자에게 공개하는 기능도 제공하지 않습니다.")}</p>
      <h2>{t("기기 저장과 쿠키")}</h2><p>{t("로그인 유지를 위한 필수 세션 쿠키를 사용합니다. 선택한 글자 크기·언어와 저장 실패 시 초안은 현재 브라우저에 남을 수 있습니다. 초안은 계정·날짜별로 구분하고 로그인한 해당 계정에서 복구합니다. 공용 기기에서는 로그아웃과 브라우저 자료 관리를 이용해 주세요.")}</p>
      <h2>{t("이용자의 권리와 문의")}</h2><p>{t("설정에서 자료 내보내기와 회원 탈퇴를 이용할 수 있습니다. 개인정보 열람·정정·삭제·처리정지 요청은 아래 이메일로 받습니다. 본인 확인에 필요한 최소한의 절차를 안내합니다.")}</p>
      <p>{t("개인정보 담당:")}{' '}{l.privacyContact||operator}<br/>{t("문의:")}{' '}<a href={`mailto:${l.contact}`}>{l.contact}</a></p>
      <h2>{t("보호 조치와 아동 이용")}</h2><p>{t("비밀번호 해시, HTTPS 운영 연결, 계정별 조회·쓰기 범위, 세션 쿠키, 요청 검증과 로그인 시도 제한을 적용합니다. 만 14세 미만 가입은 현재 제공하지 않습니다.")}</p>
      <h2>{t("변경 안내")}</h2><p>{t("내용이 바뀌면 시행일과 변경 사항을 이 페이지에 게시합니다. 권리에 중요한 영향을 주는 변경은 서비스 안내를 통해 별도로 알립니다.")}</p>
    </>:kind==='terms'?<>
      <p>{pair(`이 약관은 ${operator}이(가) 제공하는 harukan 플래너의 이용에 적용됩니다.`, `These terms apply to use of the harukan planner provided by ${operator}.`)}</p>
      <h2>{t("서비스와 회원가입")}</h2><p>{t("서비스는 하루 계획·실제 활동 기록·할 일·메모의 저장과 조회를 제공합니다. 만 14세 이상 이용자가 아이디와 비밀번호를 정하고 약관을 확인해 가입합니다. 타인의 아이디·자료를 무단 사용하거나 서비스 운영을 방해하는 행위는 허용하지 않습니다.")}</p>
      <h2>{t("계정과 복구")}</h2><p>{t("비밀번호와 가입 때 받은 복구코드를 보관해 주세요. 이메일을 수집하지 않는 초기 계정은 복구코드로 비밀번호를 재설정합니다. 운영자는 비밀번호 원문을 알 수 없으며, 복구코드도 잃은 경우 계정 소유를 확인할 별도 근거가 없으면 복구가 어려울 수 있습니다.")}</p>
      <h2>{t("이용자가 작성한 내용")}</h2><p>{t("작성한 일정·메모의 권리는 이용자에게 있습니다. 운영자는 서비스 제공·보관·백업·문제 해결에 필요한 범위에서 처리합니다. 기록을 광고나 모델 학습용 자료로 제공하는 기능은 없습니다. 이용자는 설정에서 자료를 내보낼 수 있습니다.")}</p>
      <h2>{t("운영과 변경")}</h2><p>{t("점검·장애·서비스 변경으로 일부 기능이 일시 중단될 수 있습니다. 주요 변경과 종료 계획은 서비스에서 안내하며 자료 내보내기 방법을 제공합니다. 유료 기능이나 결제를 시작하는 경우 조건과 요금을 먼저 안내합니다.")}</p>
      <h2>{t("탈퇴와 이용 제한")}</h2><p>{t("설정에서 본인 비밀번호로 탈퇴할 수 있습니다. 악의적 접근·자동화된 남용 등으로 이용을 제한할 경우 가능한 범위에서 사유와 문의 방법을 안내합니다. 법령이 정한 권리와 운영자의 책임을 일괄 배제하지 않습니다.")}</p>
      <h2>{t("문의와 분쟁")}</h2><p>{pair("문의는","Send inquiries to")}{' '}<a href={`mailto:${l.contact}`}>{l.contact}</a>{pair("로 받습니다. 분쟁은 관련 대한민국 법령에 따라 해결하며 이용자의 법정 권리를 제한하지 않습니다.",". Disputes are resolved under applicable laws of the Republic of Korea without limiting your statutory rights.")}</p>
    </>:kind==='contact'?<><p>{t("계정·기록·서비스 이용에 관한 문의를 이메일로 보내 주세요.")}</p><a className="contact-address" href={`mailto:${l.contact}`}>{l.contact}</a><p>{t("아이디와 문제가 발생한 화면을 알려주시면 확인에 도움이 됩니다. 비밀번호·복구코드는 보내지 마세요.")}</p><p>{t("운영자:")}{' '}{operator} · {t(l.representative||"개인 운영")}</p></>:<>
      <p>{t("harukan은 하루를 시간으로 계획하고 실제로 한 일을 남기는 개인 플래너입니다. 할 일을 여러 날에 나눠 배치하고, 날짜별 기록을 돌아볼 수 있습니다.")}</p>
      <h2>{t("운영 정보")}</h2><dl><dt>{t("운영 형태")}</dt><dd>{t("개인 운영")}</dd><dt>{t("운영자")}</dt><dd>{operator}</dd><dt>{t("문의")}</dt><dd><a href={`mailto:${l.contact}`}>{l.contact}</a></dd>{l.businessNumber&&<><dt>{t("사업자등록번호")}</dt><dd>{l.businessNumber}</dd></>}{l.address&&<><dt>{t("사업장 주소")}</dt><dd>{l.address}</dd></>}</dl>
      <h2>{t("기존 개인 작업 공간")}</h2><p>{t("기존 개인 Anotar는")}{' '}<a href="https://personal.leneu.store">personal.leneu.store</a>{t("에서 이용할 수 있습니다. 새 플래너의 계정과 자료는 기존 개인 서비스와 별도로 관리합니다.")}</p>
    </>}
  </article>;
}

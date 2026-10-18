import {t,pair,LanguageSelect,useLanguage} from './i18n';
import React,{useCallback,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight,CircleHelp,Menu} from 'lucide-react';
import {request,Site,User} from './api';
import {Legal} from './legal'
import {Guide} from './Guide';
import {SettingsPage} from './planner';
import './style.css';
import './landing.css';
import {Landing} from './Landing';
import {Journal} from './journal/Journal';
import {journalPath,journalSection,journalView} from './journal/navigation';
try{document.documentElement.dataset.font=localStorage.getItem('anotar-planner:font')||'small';document.documentElement.dataset.theme=localStorage.getItem('anotar-planner:theme')||'system';}catch{}

const initialSite:Site={legal:{operator:'문성혁',representative:'개인 운영',businessNumber:'',address:'',contact:'support@leneu.store',privacyContact:'문성혁',publishedAt:'',hostingRegion:''},legalReady:false,registration:false,termsVersion:'2026-10-11-v1'};
function Brand({href="/"}:{href?:string}){return <a className="brand" href={href} aria-label={t("Harukan 서비스 소개")}><img src="/brand/harukan.svg" alt=""/><span>Harukan</span></a>;}
function Footer({site}:{site:Site}) {return <footer className="site-footer"><Brand/><nav aria-label={t("서비스 정보")}><a href="/guide">{pair("사용 안내","Guide")}</a><a href="/about">{t("서비스·운영자")}</a><a href="/privacy">{t("개인정보처리방침")}</a><a href="/terms">{t("이용약관")}</a><a href="/contact">{t("문의")}</a></nav><LanguageSelect/><p>{t("개인 운영 ·")}{' '}{site.legal.operator||t("운영자 정보 확인 중")}<br/><a href={`mailto:${site.legal.contact}`}>{site.legal.contact}</a></p></footer>;}

function Auth({kind,site}:{kind:string;site:Site}) {
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[recovery,setRecovery]=useState(''),[agree,setAgree]=useState(false),[age,setAge]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[code,setCode]=useState(''),[copied,setCopied]=useState(false),[kept,setKept]=useState(false);
  const signup=kind==='signup',recover=kind==='recover';
  async function submit(event:React.FormEvent) {event.preventDefault();setError('');setBusy(true);try {
    const result=await request<{recoveryCode?:string}>(`/api/auth/${signup?'register':recover?'recover':'login'}`,'POST',{username,password,...(recover?{recoveryCode:recovery}:{}),...(signup?{termsVersion:agree?site.termsVersion:'',ageConfirmed:age}:{})});
    if(result.recoveryCode) setCode(result.recoveryCode);else window.location.assign('/app');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="auth-page"><h1>{code?t("복구코드를 보관해 주세요"):signup?t("하루 기록 시작하기"):recover?t("비밀번호 재설정"):t("다시 만나 반가워요.")}</h1>
    {code?<><p>{t("이 코드로 비밀번호를 재설정할 수 있어요. 다른 사람에게 보내지 말고 따로 보관해 주세요. 다시 표시하지 않습니다.")}</p><code className="recovery-code">{code}</code><div className="recovery-actions"><button className="secondary" onClick={()=>void navigator.clipboard.writeText(code).then(()=>setCopied(true))}>{copied?t("복사됨"):t("복구코드 복사")}</button><button className="secondary" onClick={()=>{const blob=new Blob([`${pair("Harukan 복구코드","Harukan recovery code")}\n${t("아이디")}: ${username}\n${t("복구코드")}: ${code}\n`],{type:'text/plain'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='harukan-recovery.txt';a.click();URL.revokeObjectURL(url);}}>{t("복구코드 내려받기")}</button></div><label className="checkbox recovery-kept"><input type="checkbox" checked={kept} onChange={e=>setKept(e.target.checked)}/>{t("복구코드를 잃어버리면 비밀번호를 찾을 수 없다는 걸 알고, 따로 보관했어요.")}</label><button className="primary" disabled={!kept} onClick={()=>window.location.assign('/app')}>{t("보관했어요 · 시간표로 이동")}<ArrowRight size={16}/></button></>:<>
    <p>{signup?t("아이디와 비밀번호로 내 시간표를 만들어요."):recover?t("가입 때 보관한 복구코드가 필요해요."):t("내 계획과 기록을 이어서 확인하세요.")}</p>
    {signup&&!site.registration&&<p className="notice">{t("가입 준비 중이에요.")}{' '}<a href="/demo">{t("먼저 시간표를 체험해 보세요.")}</a></p>}
    <form onSubmit={submit}><label htmlFor="username">{t("아이디")}</label><input id="username" value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{2,31}" placeholder={t("영문·숫자 3–32자")}/>
    {recover&&<><label htmlFor="recovery">{t("복구코드")}</label><input id="recovery" value={recovery} onChange={e=>setRecovery(e.target.value)} autoComplete="off" required/></>}
    <label htmlFor="password">{recover?t("새 비밀번호"):t("비밀번호")}</label><input id="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={signup||recover?'new-password':'current-password'} required minLength={12} maxLength={128}/><small>{t("12–128자. 다른 서비스와 다른 비밀번호를 사용해 주세요.")}</small>
    {signup&&<div className="auth-consents"><label className="checkbox"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} required/><span>{pair("","I agree to the ")}<a href="/terms" target="_blank" rel="noreferrer">{t("이용약관")}</a>{pair("에 동의하고"," and have read the ")}{' '}<a href="/privacy" target="_blank" rel="noreferrer">{t("개인정보처리방침")}</a>{pair("을 확인했어요.",".")}</span></label><label className="checkbox"><input type="checkbox" checked={age} onChange={e=>setAge(e.target.checked)} required/><span>{t("만 14세 이상이에요.")}</span></label></div>}
    {error&&<p className="error" role="alert">{t(error)}</p>}<button className="primary" disabled={busy||(signup&&!site.registration)}>{busy?t("확인 중…"):signup?t("가입하고 시작하기"):recover?t("비밀번호 재설정"):t("로그인")}<ArrowRight size={16}/></button></form>
    <div className="auth-links">{!signup&&<a href="/signup">{t("처음이라면 가입하기")}</a>}{signup&&<a href="/login">{t("이미 계정이 있어요")}</a>}{!recover&&<a href="/recover">{t("복구코드로 비밀번호 재설정")}</a>}</div></>}
  </main>;
}
function App() {
  useLanguage();
  const [site,setSite]=useState(initialSite),[session,setSession]=useState<{user:User|null;csrf?:string}|null>(null),[initError,setInitError]=useState(''),[mobileMenu,setMobileMenu]=useState(false);
  const path=window.location.pathname,privatePage=path.startsWith('/app'),demo=path==='/demo';
  useEffect(()=>{if(path==='/app/tasks'){const query=new URLSearchParams(location.search);query.delete('task');query.set('view','year');location.replace('/app/plans?'+query);}if(path==='/app/history'){const query=new URLSearchParams(location.search);query.set('view','month');location.replace('/app?'+query);}},[path]);
  useEffect(()=>{
    // Public content renders immediately; unavailable metadata must not replace it.
    request<Site>('/api/site').then(setSite).catch(()=>{});
    // The server redirects these when signed in; this covers the dev server.
    if(['/','/login','/signup'].includes(path))request<{user:User|null}>('/api/auth/session').then(r=>{if(r.user)location.replace('/app');}).catch(()=>{});
    if(privatePage)request<{user:User|null;csrf?:string}>('/api/auth/session').then(setSession).catch(()=>setInitError("서버 연결을 확인하지 못했어요. 다시 시도해 주세요."));
  },[privatePage]);
  useEffect(()=>{if(privatePage&&session&&!session.user) window.location.replace('/login');},[privatePage,session]);
  const user=session?.user,csrf=session?.csrf||'';
  const [journalLocation,setJournalLocation]=useState(()=>({view:journalView(path,new URLSearchParams(location.search)),date:new URLSearchParams(location.search).get('date')||''}));
  const onJournalView=useCallback((view:string,date:string)=>setJournalLocation(old=>old.view===view&&old.date===date?old:{view,date}),[]);
  const activeSection=path==='/app/settings'?null:journalSection(journalLocation.view);
  function sectionHref(section:string){const view=section==='plans'?(activeSection==='plans'?journalLocation.view:'year'):section==='review'?'review':activeSection==='schedule'?journalLocation.view:'day';const query=new URLSearchParams();if(journalLocation.date)query.set('date',journalLocation.date);query.set('view',view);return journalPath(view)+(query.size?'?'+query:'');}
  async function logout(){if(!window.dispatchEvent(new Event('anotar-before-leave',{cancelable:true})))return;try{await request('/api/auth/logout','POST',{},csrf);window.location.assign('/login');}catch(e){setInitError((e as Error).message);}}
  return <><header className={`site-header ${privatePage?'app-header':'public-header'}`}><Brand href={privatePage&&user?'/app':'/'}/>{privatePage&&user?<><nav className="app-nav" aria-label={t("플래너 메뉴")}>{[["schedule","일정","Schedule"],["plans","계획","Plans"],["review","회고","Review"]].map(([section,ko,en])=><a key={section} className={activeSection===section?"active":""} aria-current={activeSection===section?"page":undefined} href={sectionHref(section)}>{pair(ko,en)}</a>)}</nav><span id="save-status" className="header-save"/><div className="account-actions"><a href="/guide" aria-label={pair("사용 안내","Guide")} title={pair("사용 안내","Guide")}><CircleHelp size={17}/></a><a className="account-link" href="/app/settings" aria-label={t("계정 설정")} title={pair("설정","Settings")}><i className="account-avatar" aria-hidden="true">{user.username.slice(0,1).toUpperCase()}</i><span>{user.username}</span></a></div></>:<><LanguageSelect/><button className="mobile-menu" onClick={()=>setMobileMenu(!mobileMenu)} aria-label={t("메뉴 열기")} aria-expanded={mobileMenu}><Menu size={22}/></button><nav className={mobileMenu?'public-nav open':'public-nav'} aria-label={t("소개 메뉴")}><a href="/#features">{pair("기능","Features")}</a><a href="/demo">{t("시간표 체험")}</a><a href="/guide">{pair("사용 안내","Guide")}</a><a href="/about">{t("서비스 소개")}</a><a href="/login">{t("로그인")}</a><a className="primary compact" href="/signup">{t("시작하기")}</a></nav></>}</header>
    {initError&&privatePage?<main className="auth-page"><p role="alert">{t(initError)}</p><button className="primary" onClick={()=>window.location.reload()}>{t("다시 연결")}</button><a href="/demo">{t("시간표 체험")}</a></main>:privatePage?(!session||!user?<main className="auth-page" aria-live="polite">{t("로그인 확인 중…")}</main>:<>{path==='/app/settings'?<SettingsPage user={user} csrf={csrf} onLogout={logout}/>:<Journal user={user} csrf={csrf} onViewChange={onJournalView}/>}</>):demo?<><div className="demo-label">{t("체험용 예시 · 이 화면의 입력은 계정에 저장되지 않아요.")}<a href="/signup">{t("내 시간표 만들기")}<ArrowRight size={15}/></a></div><Journal demo/></>:['/login','/signup','/recover'].includes(path)?<Auth kind={path.slice(1)} site={site}/>:['/privacy','/terms','/about','/contact'].includes(path)?<Legal kind={path.slice(1)} site={site}/>:path==='/guide'?<Guide/>:path==='/'?<Landing/>:<main className="auth-page"><h1>{t("페이지를 찾을 수 없어요.")}</h1><a href="/">{t("서비스 소개로 이동")}</a></main>}
    {!privatePage&&<Footer site={site}/>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);

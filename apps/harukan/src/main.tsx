import {t,pair,LanguageSelect,useLanguage} from './i18n';
import React,{useCallback,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight,Menu,Settings} from 'lucide-react';
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

const initialSite:Site={legal:{operator:'문성혁',representative:'개인 운영',businessNumber:'',address:'',contact:'support@leneu.store',privacyContact:'문성혁',publishedAt:'',hostingRegion:''},legalReady:false,registration:false,termsVersion:'2026-10-18'};
// 오늘 시간표로: a small timetable (header row, time column, two blocks) with a tiny ↗ in the corner, lucide line style.
function TodayIcon(){return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8"/><path d="M3 9h11"/><path d="M8 9v12"/><rect x="10.5" y="11.5" width="6.5" height="2.6" rx=".8" fill="currentColor" stroke="none"/><rect x="10.5" y="16" width="4" height="2.6" rx=".8" fill="currentColor" stroke="none" opacity=".45"/><path d="M17 3h4v4"/><path d="M21 3l-3.5 3.5"/></svg>;}
function Brand({href="/"}:{href?:string}){return <a className="brand" href={href} aria-label={t("harukan 서비스 소개")}><img src="/brand/harukan.svg" alt=""/><span>harukan</span></a>;}
function Footer({site}:{site:Site}) {return <footer className="site-footer"><Brand/><nav aria-label={t("서비스 정보")}><a href="/guide">{pair("사용 안내","Guide")}</a><a href="/about">{t("서비스·운영자")}</a><a href="/privacy">{t("개인정보처리방침")}</a><a href="/terms">{t("이용약관")}</a><a href="/contact">{t("문의")}</a></nav><LanguageSelect/><p>{t("개인 운영 ·")}{' '}{site.legal.operator||t("운영자 정보 확인 중")}<br/><a href={`mailto:${site.legal.contact}`}>{site.legal.contact}</a></p></footer>;}

// Sign-in pages: email and password; a forgotten password is reset through a link sent to that email.
function Auth({kind,site}:{kind:string;site:Site}) {
  const [email,setEmail]=useState(''),[nickname,setNickname]=useState(''),[login,setLogin]=useState(''),[password,setPassword]=useState(''),[agree,setAgree]=useState(false),[age,setAge]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState('');
  const signup=kind==='signup',forgot=kind==='forgot',reset=kind==='reset',verify=kind==='verify';
  const linkToken=new URLSearchParams(location.search).get('token')||'';
  async function run(fn:()=>Promise<void>){setError('');setBusy(true);try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  // A check link works signed in or not; it runs once when the page opens.
  useEffect(()=>{if(verify)void run(async()=>{const r=await request<{email:string}>('/api/auth/verify','POST',{token:linkToken});setDone(r.email);});},[]);
  function submit(event:React.FormEvent){event.preventDefault();void run(async()=>{
    if(signup)await request('/api/auth/register','POST',{email,nickname,password,termsVersion:agree?site.termsVersion:'',ageConfirmed:age,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
    else if(forgot){await request('/api/auth/forgot','POST',{email});setDone(email);return;}
    else if(reset)await request('/api/auth/reset','POST',{token:linkToken,password});
    else await request('/api/auth/login','POST',{login,password});
    window.location.assign('/app');
  });}
  const title=signup?t("하루 기록 시작하기"):forgot||reset?t("비밀번호 재설정"):verify?t("이메일 확인"):t("다시 만나 반가워요.");
  if(verify)return <main className="auth-page"><h1>{title}</h1>{busy?<p role="status">{t("확인 중…")}</p>:done?<><p>{pair(`${done} 주소를 확인했어요.`,`${done} is confirmed.`)}</p><a className="primary" href="/app">{t("시간표로 이동")}<ArrowRight size={16}/></a></>:<p className="error" role="alert">{t(error)}</p>}</main>;
  if(forgot&&done)return <main className="auth-page"><h1>{title}</h1><p>{pair(`${done}(으)로 가입한 계정이 있으면 재설정 링크를 보냈어요. 30분 안에 메일의 링크를 열어 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.`,`If an account uses ${done}, a reset link is on its way. Open it within 30 minutes, and check spam if it doesn’t show up.`)}</p><div className="auth-links"><a href="/login">{t("로그인으로")}</a></div></main>;
  return <main className="auth-page"><h1>{title}</h1>
    <p>{signup?t("이메일로 가입하고, 화면에는 닉네임이 보여요."):forgot?t("가입한 이메일로 재설정 링크를 보내요."):reset?t("새 비밀번호를 정해 주세요."):t("내 계획과 기록을 이어서 확인하세요.")}</p>
    {signup&&!site.registration&&<p className="notice">{t("가입 준비 중이에요.")}{' '}<a href="/demo">{t("먼저 시간표를 체험해 보세요.")}</a></p>}
    {reset&&!linkToken&&<p className="error" role="alert">{t("링크가 올바르지 않아요. 비밀번호 재설정을 다시 요청해 주세요.")}</p>}
    <form onSubmit={submit}>
    {(signup||forgot)&&<><label htmlFor="email">{t("이메일")}</label><input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required maxLength={254} placeholder="name@example.com"/></>}
    {signup&&<><label htmlFor="nickname">{t("닉네임")}</label><input id="nickname" value={nickname} onChange={e=>setNickname(e.target.value)} autoComplete="nickname" required minLength={2} maxLength={20} placeholder={t("2–20자, 화면에 보이는 이름")}/></>}
    {kind==='login'&&<><label htmlFor="login">{t("이메일")}</label><input id="login" value={login} onChange={e=>setLogin(e.target.value)} autoComplete="username" required maxLength={254} placeholder="name@example.com"/></>}
    {!forgot&&<><label htmlFor="password">{reset?t("새 비밀번호"):t("비밀번호")}</label><input id="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={kind==='login'?'current-password':'new-password'} required minLength={12} maxLength={128}/>{kind!=='login'&&<small>{t("12–128자. 다른 서비스와 다른 비밀번호를 사용해 주세요.")}</small>}</>}
    {signup&&<div className="auth-consents"><label className="checkbox"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} required/><span>{pair("","I agree to the ")}<a href="/terms" target="_blank" rel="noreferrer">{t("이용약관")}</a>{pair("에 동의하고"," and have read the ")}{' '}<a href="/privacy" target="_blank" rel="noreferrer">{t("개인정보처리방침")}</a>{pair("을 확인했어요.",".")}</span></label><label className="checkbox"><input type="checkbox" checked={age} onChange={e=>setAge(e.target.checked)} required/><span>{t("만 14세 이상이에요.")}</span></label></div>}
    {error&&<p className="error" role="alert">{t(error)}</p>}<button className="primary" disabled={busy||(signup&&!site.registration)||(reset&&!linkToken)}>{busy?t("확인 중…"):signup?t("가입하고 시작하기"):forgot?t("재설정 링크 보내기"):reset?t("비밀번호 재설정"):t("로그인")}<ArrowRight size={16}/></button></form>
    <div className="auth-links">{kind==='login'&&<><a href="/signup">{t("처음이라면 가입하기")}</a><a href="/forgot">{t("비밀번호를 잊었어요")}</a></>}{signup&&<a href="/login">{t("이미 계정이 있어요")}</a>}{forgot&&<><a href="/login">{t("로그인으로")}</a></>}{reset&&<a href="/login">{t("로그인으로")}</a>}</div>
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
  return <><header className={`site-header ${privatePage?'app-header':'public-header'}`}><Brand href={privatePage&&user?'/app':'/'}/>{privatePage&&user?<><a className="now-jump" href="/app?now=1" aria-label={pair("오늘 시간표로","Today’s timetable")} title={pair("오늘 시간표로","Today’s timetable")} onClick={e=>{e.currentTarget.blur();if(!window.dispatchEvent(new Event('harukan-now',{cancelable:true})))e.preventDefault();}}><TodayIcon/></a><nav className="app-nav" aria-label={t("플래너 메뉴")}>{[["schedule","일정","Schedule"],["plans","계획","Plans"],["review","회고","Review"]].map(([section,ko,en])=><a key={section} className={activeSection===section?"active":""} aria-current={activeSection===section?"page":undefined} href={sectionHref(section)}>{pair(ko,en)}</a>)}</nav><span id="save-status" className="header-save"/><div className="account-actions"><a className="account-link" href="/app/settings" aria-label={t("계정 설정")} title={pair("설정","Settings")}><span>{user.nickname}</span><Settings size={17} aria-hidden="true"/></a></div></>:<><LanguageSelect/><button className="mobile-menu" onClick={()=>setMobileMenu(!mobileMenu)} aria-label={t("메뉴 열기")} aria-expanded={mobileMenu}><Menu size={22}/></button><nav className={mobileMenu?'public-nav open':'public-nav'} aria-label={t("소개 메뉴")}><a href="/#features">{pair("기능","Features")}</a><a href="/demo">{t("시간표 체험")}</a><a href="/guide">{pair("사용 안내","Guide")}</a><a href="/login">{t("로그인")}</a><a className="primary compact" href="/signup">{t("시작하기")}</a></nav></>}</header>
    {initError&&privatePage?<main className="auth-page"><p role="alert">{t(initError)}</p><button className="primary" onClick={()=>window.location.reload()}>{t("다시 연결")}</button><a href="/demo">{t("시간표 체험")}</a></main>:privatePage?(!session||!user?<main className="auth-page" aria-live="polite">{t("로그인 확인 중…")}</main>:<>{path==='/app/settings'?<SettingsPage user={user} csrf={csrf} onLogout={logout}/>:<Journal user={user} csrf={csrf} onViewChange={onJournalView}/>}</>):demo?<><div className="demo-label">{t("체험용 예시 · 이 화면의 입력은 계정에 저장되지 않아요.")}<a href="/signup">{t("내 시간표 만들기")}<ArrowRight size={15}/></a></div><Journal demo/></>:['/login','/signup','/forgot','/reset','/verify'].includes(path)?<Auth kind={path.slice(1)} site={site}/>:['/privacy','/terms','/about','/contact'].includes(path)?<Legal kind={path.slice(1)} site={site}/>:path==='/guide'?<Guide/>:path==='/'?<Landing/>:<main className="auth-page"><h1>{t("페이지를 찾을 수 없어요.")}</h1><a href="/">{t("서비스 소개로 이동")}</a></main>}
    {!privatePage&&<Footer site={site}/>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);

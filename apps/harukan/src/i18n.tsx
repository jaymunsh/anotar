import {useSyncExternalStore} from 'react';
import {Globe} from 'lucide-react';
import {english} from './translations';

export type Language='ko'|'en';
const key='anotar-planner:language';
let language:Language='ko';
try {
  const query=new URLSearchParams(location.search).get('lang');
  const selected=query||localStorage.getItem(key);
  if(selected==='en')language='en';
  if(query==='en'||query==='ko')localStorage.setItem(key,query);
} catch {}
const listeners=new Set<()=>void>();
export function getLanguage(){return language;}
export function t(korean:string){return language==='en'?(english[korean]??korean):korean;}
export function pair(korean:string,englishText:string){return language==='en'?englishText:korean;}
function applyLanguage(){
  document.documentElement.lang=language;
  document.title=pair('harukan · 10분 단위 하루 플래너','harukan · Plan your day in 10-minute blocks');
  document.querySelector('meta[name=description]')?.setAttribute('content',pair('하루를 10분 단위로 계획하고, 쓴 시간을 목표별로 돌아보는 플래너.','Plan your day and see how you spent your time. A personal planner for your schedule, tasks, and daily notes.'));
}
export function setLanguage(next:Language){
  language=next;
  try{localStorage.setItem(key,next);}catch{}
  const url=new URL(location.href);url.searchParams.set('lang',next);
  history.replaceState(null,'',url);
  applyLanguage();listeners.forEach(fn=>fn());
}
export function useLanguage(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},getLanguage);}
export function LanguageSelect({className=''}:{className?:string}){
  const language=useLanguage();
  return <label className={`language-select ${className}`}><Globe size={16} aria-hidden="true"/><span className="sr-only">{pair('언어','Language')}</span><select aria-label={pair('언어','Language')} value={language} onChange={e=>setLanguage(e.target.value as Language)}><option value="ko">한국어</option><option value="en">English</option></select></label>;
}
// Header: two languages, so one button switches to the other.
export function LanguageToggle(){
  const language=useLanguage(),next=language==='ko'?'en':'ko',label=next==='en'?'English':'한국어';
  return <button type="button" className="icon-toggle" onClick={()=>setLanguage(next)} aria-label={label} title={label}><Globe size={18} aria-hidden="true"/></button>;
}
applyLanguage();

import {t,pair,getLanguage,LanguageSelect} from './i18n';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {X,ArrowRight,Check,ChevronLeft,ChevronRight,Plus,Trash2,Download,Settings,Save,LogOut,CircleHelp} from 'lucide-react';
import {ApiError,Day,Entry,Plan,PlanningItem,User,clock,download,duration,emptyDay,recorded,request,sync,today} from './api';

const copy=<T,>(value:T):T=>structuredClone(value);
const recentKey='anotar-planner:recent-planning';
const recentIds=():string[]=>{try{const v=JSON.parse(localStorage.getItem(recentKey)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}};
const rememberPlanning=(id:string)=>{try{localStorage.setItem(recentKey,JSON.stringify([id,...recentIds().filter(x=>x!==id)].slice(0,3)));}catch{}};
const uuid=()=>crypto.randomUUID();
const demoDay=():Day=>({plans:[{id:'reading',title:"독서",start:540,end:600,status:'done'},{id:'proposal',title:"제안서 초안 작성",start:600,end:690,status:'partial'},{id:'lecture',title:"강의 듣기",start:780,end:840,status:'pending'},{id:'walk',title:"산책과 휴식",start:960,end:1020,status:'pending'}],entries:[{id:'actual_reading',title:"독서",start:560,end:590,planId:'reading'},{id:'actual_proposal',title:"제안서 초안 작성",start:610,end:700,planId:'proposal'}],notes:{thoughts:'',ideas:'',review:''},priorities:[{id:'demo-reading',text:'독서',done:true},{id:'demo-proposal',text:'제안서 초안 작성',done:false},{id:'demo-lecture',text:'강의 듣기',done:false}]});
const demoTitles:Record<string,string>={reading:'독서',proposal:'제안서 초안 작성',lecture:'강의 듣기',walk:'산책과 휴식'};
function demoItem<T extends Plan|Entry>(item:T):T{const seed=demoTitles[(item as Entry).planId||item.id];return seed&&item.title===seed?{...item,title:t(seed)}:item;}
function demoPresentation(doc:Day):Day{return {...doc,plans:doc.plans.map(demoItem),entries:doc.entries.map(demoItem)};}
function draftKey(user:User,date:string){return `anotar-planner:draft:${user.id}:${date}`;}
function shiftDate(date:string,amount:number){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
function dayLabel(date:string){return new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}

// One write at a time. A failed or conflicting snapshot stays in the UI and device draft.
export function useDay(date:string,user:User|undefined,csrf:string,demo:boolean){
  const [document,setDocument]=useState<Day>(emptyDay),[loading,setLoading]=useState(true),[state,setState]=useState('saved'),[error,setError]=useState(''),[pendingDraft,setPendingDraft]=useState<{version:number;document:Day}|null>(null);
  const latest=useRef(document),version=useRef(0),dirty=useRef(false),busy=useRef(false),blocked=useRef(false),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),saveRef=useRef<()=>void>(()=>{});
  function stash(value:Day){if(user&&!demo){try{localStorage.setItem(draftKey(user,date),JSON.stringify({version:version.current,document:value}));}catch{setError("기기 초안을 보관할 공간이 없어요. 연결을 확인하고 저장하거나 내보내 주세요.");}}}
  useEffect(()=>{
    const epoch=++generation.current;setLoading(true);setError('');setPendingDraft(null);blocked.current=false;dirty.current=false;version.current=0;
    function loaded(value:Day,v:number){if(epoch!==generation.current)return;latest.current=value;setDocument(value);version.current=v;setLoading(false);setState(demo?'demo':'saved');
      if(user&&!demo){try{const raw=localStorage.getItem(draftKey(user,date));if(raw){const draft=JSON.parse(raw);if(Array.isArray(draft.document?.plans)&&Array.isArray(draft.document?.entries)&&draft.document?.notes){if(JSON.stringify(draft.document)===JSON.stringify(value))localStorage.removeItem(draftKey(user,date));
          // Same version = nothing changed on the server since the draft (e.g. a save failed while offline): just carry on saving it. Only a real conflict asks.
          else if(draft.version===v){latest.current=draft.document;setDocument(draft.document);dirty.current=true;setState('pending');timer.current=setTimeout(()=>saveRef.current(),900);}
          else setPendingDraft(draft);}}}catch{setError("기기 초안을 읽지 못했어요. 저장된 기록은 정상적으로 불러왔어요.");}}
    }
    if(demo)loaded(demoDay(),0);else request<{document:Day;version:number}>(`/api/days/${date}`).then(r=>loaded(r.document,r.version)).catch(e=>{if(epoch===generation.current){setError(e.message);setLoading(false);setState('load-error');}});
    return()=>{clearTimeout(timer.current);generation.current++;};
  },[date,user?.id,demo]);
  function change(value:Day){if(loading||state==='load-error'||pendingDraft)return;latest.current=value;setDocument(value);if(demo){setState('demo');return;}dirty.current=true;stash(value);if(state==='error')blocked.current=false;if(!blocked.current)setState('pending');clearTimeout(timer.current);if(!blocked.current)timer.current=setTimeout(()=>saveRef.current(),900);}
  async function save(){
    if(demo||busy.current||!dirty.current||loading)return;
    busy.current=true;setState('saving');setError('');const snapshot=copy(latest.current),v=version.current,epoch=generation.current;
    try{const r=await request<{version:number}>(`/api/days/${date}`,'PUT',{document:snapshot,version:v},csrf);if(epoch!==generation.current)return;version.current=r.version;blocked.current=false;sync?.postMessage({day:date});
      if(JSON.stringify(latest.current)===JSON.stringify(snapshot)){dirty.current=false;setState('saved');if(user)localStorage.removeItem(draftKey(user,date));}
      else{stash(latest.current);setState('pending');timer.current=setTimeout(()=>saveRef.current(),900);}
    }catch(e){if(epoch!==generation.current)return;blocked.current=true;setState(e instanceof ApiError&&e.status===409?'conflict':'error');setError((e as Error).message);stash(latest.current);}
    finally{busy.current=false;}
  }
  saveRef.current=save;
  // Another tab or device may have saved since this one loaded: picked up on coming back to the tab, on a save in another tab, and every 30 s while shown — unless there are edits here (those go through the version check).
  useEffect(()=>{
    if(demo||!user)return;
    function refresh(){
      if(window.document.visibilityState!=='visible'||dirty.current||busy.current||blocked.current)return;
      const epoch=generation.current;
      request<{document:Day;version:number}>(`/api/days/${date}`).then(r=>{if(epoch!==generation.current||dirty.current||busy.current||r.version===version.current)return;latest.current=r.document;version.current=r.version;setDocument(r.document);}).catch(()=>{});
    }
    const heard=(e:MessageEvent)=>{if(e.data?.day===date)refresh();},every=setInterval(refresh,30000);
    window.addEventListener('focus',refresh);window.document.addEventListener('visibilitychange',refresh);sync?.addEventListener('message',heard);
    return()=>{clearInterval(every);window.removeEventListener('focus',refresh);window.document.removeEventListener('visibilitychange',refresh);sync?.removeEventListener('message',heard);};
  },[date,user?.id,demo]);
  // A failed save (offline, server restart) tries again by itself: when the browser is back online and every 20 s. A conflict (409) waits for the person.
  useEffect(()=>{
    if(state!=='error')return;
    const retry=()=>{if(navigator.onLine){blocked.current=false;void saveRef.current();}};
    const every=setInterval(retry,20000);window.addEventListener('online',retry);
    return()=>{clearInterval(every);window.removeEventListener('online',retry);};
  },[state]);
  useEffect(()=>{
    function unload(e:BeforeUnloadEvent){if(dirty.current||busy.current){e.preventDefault();e.returnValue='';}}
    function leave(e:Event){if(busy.current||(dirty.current&&!window.confirm(t("아직 서버에 저장되지 않은 내용이 있어요. 기기 초안을 남기고 이동할까요?"))))e.preventDefault();}
    window.addEventListener('beforeunload',unload);window.addEventListener('anotar-before-leave',leave);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('anotar-before-leave',leave);};
  },[]);
  function restore(){if(!pendingDraft)return;if(pendingDraft.version!==version.current){latest.current=copy(pendingDraft.document);setDocument(latest.current);dirty.current=true;blocked.current=true;setState('conflict');setError("저장된 기록과 초안 버전이 달라요. 초안을 내보낸 뒤 최신 기록을 확인해 주세요.");setPendingDraft(null);return;}const value=pendingDraft.document;setPendingDraft(null);latest.current=value;setDocument(value);dirty.current=true;stash(value);setState('pending');timer.current=setTimeout(()=>saveRef.current(),900);}
  function discard(){if(user)localStorage.removeItem(draftKey(user,date));setPendingDraft(null);}
  function canLeave(){return !busy.current&&(!dirty.current||window.confirm(t("저장되지 않은 기기 초안을 남기고 날짜를 바꿀까요?")));}
  return{document,change,loading,state,error,pendingDraft,restore,discard,save,canLeave};
}

// Minutes ↔ the form's time strings: '-23:00' is 23:00 the day before, '25:00' is 01:00 the day after, '24:00' is midnight at the end of the day.
export const toMinutes=(v:string):number=>v.startsWith('-')?toMinutes(v.slice(1))-1440:Number(v.slice(0,2))*60+Number(v.slice(3));
export const fromMinutes=(m:number)=>m<0?'-'+clock(m+1440):clock(m);
/** A time as one small 시 : 분 box (10-minute steps). Hours before 0 read 전날, after 24 read 다음 날, so no separate day field. min/max are minutes from this day's 00:00. */
export function TimePick({label,value,onChange,min,max}:{label:[string,string];value:number;onChange:(minutes:number)=>void;min:number;max:number}){
  const hour=Math.floor(value/60),minute=value-hour*60,steps=[0,10,20,30,40,50];
  const fits=(m:number)=>m>=min&&m<=max;
  const hours=Array.from({length:37},(_,i)=>i-6).filter(h=>steps.some(m=>fits(h*60+m)));
  const minutes=steps.concat(minute%10?[minute]:[]).sort((a,b)=>a-b).filter(m=>m===minute||fits(hour*60+m));
  const hourName=(h:number)=>h<0?pair(`전날 ${String(h+24).padStart(2,'0')}`,`Prev ${String(h+24).padStart(2,'0')}`):h>24?pair(`다음 날 ${String(h-24).padStart(2,'0')}`,`Next ${String(h-24).padStart(2,'0')}`):String(h).padStart(2,'0');
  // A new hour keeps the minute when it fits there, otherwise the nearest allowed time.
  const go=(h:number,m:number)=>onChange(Math.min(max,Math.max(min,h*60+m)));
  const [ko,en]=label;
  return <span className="time-pick" role="group" aria-label={pair(ko,en)}>
    <select aria-label={pair(`${ko} 시`,`${en} hour`)} value={hour} onChange={e=>go(Number(e.target.value),minute)}>{hours.map(h=><option key={h} value={h}>{hourName(h)}</option>)}</select>
    <span aria-hidden="true">:</span>
    <select aria-label={pair(`${ko} 분`,`${en} minute`)} value={minute} onChange={e=>go(hour,Number(e.target.value))}>{minutes.map(m=><option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}</select>
  </span>;
}
// Activities after `from` that [start,end) would overlap, moved later just enough to clear it (chain-wise); null if any would pass 24:00.
export function ripple(others:Plan[],from:number,start:number,end:number):Plan[]|null{
  const moved:Plan[]=[];let cursor=end;
  for(const p of others.filter(p=>p.status!=='cancelled'&&p.start>=from&&p.end>start).sort((a,b)=>a.start-b.start)){if(p.start>=cursor)break;const next=p.end+cursor-p.start;if(next>1440)return null;moved.push({...p,start:cursor,end:next});cursor=next;}
  return moved;
}
// Dropping [start,end) on a day: if it lands inside an earlier activity it slides to that one's end (same length), then later ones it overlaps move along. null if anything would pass 24:00.
export function place(others:Plan[],start:number,end:number):{start:number;end:number;moved:Plan[]}|null{
  const live=others.filter(p=>p.status!=='cancelled'),inside=live.filter(p=>p.start<start&&p.end>start).reduce((m,p)=>Math.max(m,p.end),start),a=inside,b=end+inside-start;
  if(b>1440)return null;const moved=ripple(live,a,a,b);return moved&&{start:a,end:b,moved};
}
// The part of an activity on the neighbouring day (day:1 = runs past midnight, day:-1 = began the evening before); saved there as its own activity.
export type Overflow={title:string;start:number;end:number;day:1|-1;planningId?:string};
export type Editor={newItem?:boolean;kind:'plan'|'entry';item?:Plan|Entry;plan?:Plan;draftId?:string;originalTitle?:string};
export function ItemForm({editor,planning=[],others=[],onSave,onCancel,onDelete,onDirty,headingId}:{editor:Editor;planning?:PlanningItem[];others?:Plan[];onSave:(item:Plan|Entry,moved?:Plan[],overflow?:Overflow)=>void;onCancel:()=>void;onDelete:()=>void;onDirty:(dirty:boolean)=>void;headingId?:string}){
  const item=editor.item,plan=editor.plan;
  const [title,setTitle]=useState(item?.title||plan?.title||''),[start,setStart]=useState(clock(item?.start??plan?.start??540)),[end,setEnd]=useState(clock(item?.end??plan?.end??600)),[status,setStatus]=useState<Plan['status']>((item as Plan)?.status||'pending'),[planningId,setPlanningId]=useState((item as Plan)?.planningId||''),[error,setError]=useState(''),[pushed,setPushed]=useState(false);
  const recent=recentIds().map(id=>planning.find(p=>p.id===id)).filter((p):p is PlanningItem=>Boolean(p)),rest=planning.filter(p=>!recent.includes(p));
  const initial=useRef(JSON.stringify([title,start,end,status,planningId]));
  useEffect(()=>{onDirty(JSON.stringify([title,start,end,status,planningId])!==initial.current);},[title,start,end,status,planningId,onDirty]);
  // 미루기 keeps the length; later activities it would now overlap move just enough (never past 24:00, never into tomorrow).
  // '-23:00' is 23:00 the day before; '25:00' is 01:00 the day after.
  const shifted=(n:number):[number,number]|null=>{const a=toMinutes(start)+n,b=toMinutes(end)+n;return a>=n&&b<=1440&&ripple(others,item?.start??a,a,b)?[a,b]:null;};
  const moved=pushed?ripple(others,item?.start??toMinutes(start),toMinutes(start),toMinutes(end)):null;
  function submit(e?:React.FormEvent,nextStatus=status){e?.preventDefault();const a=toMinutes(start),b=toMinutes(end);
    if(!title.trim()||!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b>(editor.kind==='plan'?1800:1440)||a<(editor.kind==='plan'?-360:0)||(a<0&&b>1440)){setError("제목을 적고 종료 시간을 시작 시간 뒤로 맞춰 주세요.");return;}
    const overflow:Overflow|undefined=b>1440?{title:title.trim(),start:0,end:b-1440,day:1,...(planningId?{planningId}:{})}:a<0?{title:title.trim(),start:a+1440,end:1440,day:-1,...(planningId?{planningId}:{})}:undefined;
    const value={id:item?.id||uuid(),title:title.trim(),start:Math.max(a,0),end:Math.min(b,1440),...((item as Plan)?.priorityId?{priorityId:(item as Plan).priorityId}:{})};if(editor.kind==='plan'&&planningId)rememberPlanning(planningId);if(editor.kind==='plan'&&pushed&&!moved){setError('뒤 일정을 밀면 24:00을 넘어요. 시간을 다시 골라 주세요.');return;}onSave(editor.kind==='plan'?{...value,status:nextStatus,...(planningId?{planningId}:{})}:{...value,...((item as Entry)?.planId||plan?.id?{planId:(item as Entry)?.planId||plan?.id}:{})},moved||undefined,overflow);
  }
  return <form className="item-form" onSubmit={submit}><h2 id={headingId}>{item&&!editor.newItem?t("항목 수정"):editor.kind==='plan'?t("계획 추가"):t("실제로 한 일 기록")}</h2><label htmlFor="item-title">{t("활동")}</label><input id="item-title" autoFocus required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder={t("무엇을 할까요?")}/>
    {(()=>{const a=toMinutes(start),b=toMinutes(end),len=b-a,plan=editor.kind==='plan',minStart=plan?-360:0,maxEnd=plan?1800:1440;
      // Moving the start keeps the length when it fits, so a block slides instead of stretching.
      const setA=(m:number)=>{setStart(fromMinutes(m));const keep=m+len;if(len>0&&keep<=maxEnd)setEnd(fromMinutes(Math.max(10,keep)));else if(b<=m)setEnd(fromMinutes(Math.min(maxEnd,Math.max(10,m+10))));};
      return <div className="time-panel">
        <div className="time-panel-head"><span>{pair('시간','Time')}</span>{len>0&&<b>{duration(len)}</b>}</div>
        <div className="time-panel-range">
          <div><small>{t("시작")}</small><TimePick label={['시작','Start']} value={a} min={minStart} max={1430} onChange={setA}/></div>
          <span className="time-panel-arrow" aria-hidden="true">→</span>
          <div><small>{t("종료")}</small><TimePick label={['종료','End']} value={b} min={Math.max(10,a+10)} max={maxEnd} onChange={m=>setEnd(fromMinutes(m))}/></div>
        </div>
        <div className="time-panel-lengths" role="group" aria-label={pair('길이 고르기','Pick a length')}>{[30,60,90,120].map(n=><button type="button" key={n} aria-pressed={len===n} className={len===n?'selected':''} disabled={a+n>maxEnd} onClick={()=>setEnd(fromMinutes(a+n))}>{duration(n)}</button>)}</div>
      </div>;})()}
    {editor.kind==='plan'&&<div className="form-shift" role="group" aria-label={pair('이 일정 미루기','Push this back')}><span>{pair('미루기','Push back')}</span>{[10,30,60].map(n=>{const next=shifted(n);return <button type="button" key={n} disabled={!next} title={next?undefined:pair('24:00을 넘겨 미룰 수 없어요','Can’t go past midnight')} onClick={()=>{if(!next)return;setStart(clock(next[0]));setEnd(clock(next[1]));setPushed(true);}}>+{duration(n)}</button>;})}{pushed&&moved&&moved.length>0&&<small>{pair(`뒤 일정 ${moved.length}개도 함께 밀려요`,`${moved.length} later ${moved.length>1?'activities move':'activity moves'} too`)}</small>}</div>}
    {editor.kind==='plan'&&planning.length>0&&<label className="planning-pick">{pair('계획','Plan')}<select aria-label={pair('연결할 계획','Related plan')} value={planningId} onChange={e=>setPlanningId(e.target.value)}><option value="">{pair('연결 안 함','No plan')}</option>{recent.length>0&&<optgroup label={pair('최근 선택','Recent')}>{recent.map(p=><option value={p.id} key={'r'+p.id}>{p.title}</option>)}</optgroup>}<optgroup label={pair('이번 달 계획','This month')}>{rest.map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</optgroup></select></label>}
    
    {plan&&<p className="muted">{pair(`‘${plan.title}’ 계획에 연결해요. 실제 시간은 수정할 수 있어요.`, `Linked to “${plan.title}”. You can adjust the actual times.`)}</p>}{error&&<p role="alert" className="error">{t(error)}</p>}
    <div className="form-actions">{item&&!editor.newItem&&<button type="button" className="danger text-button" onClick={onDelete}><Trash2 size={16}/>{t("항목 삭제")}</button>}{editor.kind==='plan'&&<button type="button" className="secondary missed-toggle" aria-pressed={status==='missed'} onClick={()=>submit(undefined,status==='missed'?'pending':'missed')}><X size={16}/>{pair('미이행','Unfinished')}</button>}<button type="button" onClick={onCancel} className="secondary">{t("취소")}</button><button className="primary"><Check size={16}/>{t("저장")}</button></div></form>;
}

export function SettingsPage({user,csrf,onLogout}:{user:User;csrf:string;onLogout:()=>void}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[font,setFont]=useState(()=>localStorage.getItem('anotar-planner:font')||'small'),[theme,setTheme]=useState(()=>document.documentElement.dataset.theme||'system'),[password,setPassword]=useState(''),[nextPassword,setNextPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[nickname,setNickname]=useState(user.nickname),[newEmail,setNewEmail]=useState(''),[sent,setSent]=useState('');
  // Every zone this browser knows, the account's own first if it is missing (older runtimes).
  const [zone,setZone]=useState(user.timezone),zones=useMemo(()=>{const all:string[]=(Intl as unknown as {supportedValuesOf?:(k:string)=>string[]}).supportedValuesOf?.('timeZone')??[];return all.includes(user.timezone)?all:[user.timezone,...all];},[user.timezone]);
  async function act(fn:()=>Promise<void>){setError('');setBusy(true);try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="settings-page"><div className="settings-account"><h1>{t("설정")}</h1><button className="secondary" onClick={onLogout}><LogOut size={16}/>{t("로그아웃")}</button></div>{error&&<p className="error" role="alert">{t(error)}</p>}
    <section><h2>{pair("계정","Account")}</h2><div className="account-rows">
      <div className="account-row"><span className="account-key">{t("닉네임")}</span><div><form onSubmit={e=>{e.preventDefault();act(async()=>{await request('/api/account/profile','POST',{nickname},csrf);location.reload();});}}><input aria-label={t("닉네임")} value={nickname} onChange={e=>setNickname(e.target.value)} required minLength={2} maxLength={20} autoComplete="nickname"/><button className="secondary" disabled={busy||nickname.trim()===user.nickname}>{t("저장")}</button></form><p className="helper">{t("화면 오른쪽 위에 보이는 이름이에요.")}</p></div></div>
      <div className="account-row"><span className="account-key">{t("이메일")}</span><div>
        <p className="account-value">{user.email?<>{user.email}<span className={user.emailVerified?'badge verified':'badge unverified'}>{user.emailVerified?t("확인됨"):t("확인 전")}</span>{!user.emailVerified&&<button className="text-link" disabled={busy} onClick={()=>act(async()=>{await request('/api/account/email','POST',{},csrf);setSent(user.email!);})}>{t("확인 메일 다시 보내기")}</button>}</>:<><span className="badge unverified">{t("등록 안 됨")}</span></>}</p>
        {!user.email&&<p className="helper">{t("이메일을 등록하면 이메일로 로그인하고, 비밀번호를 잊었을 때 메일로 재설정할 수 있어요.")}</p>}
        <form onSubmit={e=>{e.preventDefault();act(async()=>{const r=await request<{email:string}>('/api/account/email','POST',{email:newEmail},csrf);setSent(r.email);setNewEmail('');});}}><input type="email" aria-label={user.email?t("새 이메일"):t("이메일")} placeholder={user.email?t("새 이메일 주소"):t("이메일 주소")} value={newEmail} onChange={e=>setNewEmail(e.target.value)} required maxLength={254} autoComplete="email"/><button className="secondary" disabled={busy||!newEmail.trim()}>{user.email?t("바꾸기"):t("확인 메일 보내기")}</button></form>
        {sent?<p className="helper sent" role="status">{pair(`${sent}(으)로 확인 메일을 보냈어요. 메일의 링크를 열면 등록이 끝나요. 안 보이면 스팸함도 확인해 주세요.`,`A confirmation link went to ${sent}. Opening it finishes the change. Check spam if it does not show up.`)}</p>:<p className="helper">{t("확인 메일의 링크를 열어야 등록돼요.")}</p>}
      </div></div>
      <div className="account-row"><span className="account-key">{t("시간대")}</span><div><form onSubmit={e=>{e.preventDefault();if(!confirm(pair(`지금부터 ‘오늘’과 현재 시각이 ${zone} 기준이 돼요. 이미 적은 기록의 날짜와 시각은 그대로예요.`,`From now on, “today” and the current time follow ${zone}. Dates and times you already wrote stay as they are.`)))return;act(async()=>{await request('/api/account/timezone','POST',{timezone:zone},csrf);location.reload();});}}><select aria-label={t("시간대")} value={zone} onChange={e=>setZone(e.target.value)}>{zones.map(z=><option key={z} value={z}>{z.replaceAll('_',' ')}</option>)}</select><button className="secondary" disabled={busy||zone===user.timezone}>{pair("바꾸기","Change")}</button></form><p className="helper">{pair("‘오늘’이 어느 날인지와 현재 시각 선에만 쓰여요. 여행 가는 날은 출발지 시간으로 적고, 다음 날부터 바꾸면 깔끔해요.","Only decides which day is “today” and where the now-line sits. On a travel day keep the old zone, and switch from the next day.")}</p></div></div>
    </div></section>
    <section><h2>{pair("언어","Language")}</h2><LanguageSelect/><p className="helper">{pair("소개와 플래너에 함께 적용돼요. 작성한 기록은 그대로 유지돼요.","Applies to the website and planner. Your written records stay unchanged.")}</p></section><section><h2>{pair('화면 테마','Theme')}</h2><div className="form-actions">{[['system',pair('시스템 따라가기','Match system')],['light',pair('라이트','Light')],['dark',pair('다크','Dark')]].map(([v,label])=><button key={v} className={theme===v?'primary':'secondary'} aria-pressed={theme===v} onClick={()=>{setTheme(v);try{localStorage.setItem('anotar-planner:theme',v);}catch{}document.documentElement.dataset.theme=v;}}>{label}</button>)}</div><p className="helper">{pair('이 기기에만 적용돼요.','Applies to this device only.')}</p></section><section><h2>{t("화면 글자 크기")}</h2><div className="form-actions">{[['small',t("작게")],['normal',t("보통")],['large',t("크게")]].map(([v,label])=><button key={v} className={font===v?'primary':'secondary'} aria-pressed={font===v} onClick={()=>{setFont(v);localStorage.setItem('anotar-planner:font',v);document.documentElement.dataset.font=v;}}>{t(label)}</button>)}<button className="text-button" onClick={()=>{setFont('small');localStorage.removeItem('anotar-planner:font');document.documentElement.dataset.font='small';}}>{t("기본값으로 설정")}</button></div><p className="helper">{t("이 브라우저에 적용돼요. 기본값은 작게예요.")}</p></section>
    <section><h2>{pair("도움말","Help")}</h2><p>{pair("화면별 쓰는 법은 사용 안내에, 그 밖의 궁금한 점은 문의로 보내 주세요.","How each screen works is in the guide; anything else, send us a message.")}</p><div className="settings-links"><a className="secondary" href="/guide"><CircleHelp size={16}/>{pair("사용 안내","Guide")}</a><a className="text-button" href="/contact">{pair("문의하기","Contact")}</a></div></section>
    <section><h2>{t("내 기록 내보내기")}</h2><p>{t("일정·메모·계획을 JSON 파일로 보관해요.")}</p><button className="secondary" disabled={busy} onClick={()=>act(async()=>download(`harukan-${new Date().toISOString().slice(0,10)}.json`,await request('/api/export')))}><Download size={16}/>{t("자료 내보내기")}</button></section>
    <section><h2>{t("비밀번호 변경")}</h2><form className="settings-form" onSubmit={e=>{e.preventDefault();act(async()=>{await request('/api/account/password','POST',{currentPassword:password,password:nextPassword},csrf);location.assign('/app/settings');});}}><label>{t("현재 비밀번호")}<input type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><label>{t("새 비밀번호")}<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={nextPassword} onChange={e=>setNextPassword(e.target.value)}/></label><p className="helper">{t("12–128자. 다른 기기의 로그인은 종료돼요.")}</p><button className="secondary" disabled={busy}><Settings size={16}/>{t("비밀번호 변경")}</button></form></section>
    <section><details><summary>{t("계정과 기록 삭제")}</summary><p>{t("탈퇴하면 서버의 계정·일정·메모·할 일을 삭제해요. 먼저 필요한 자료를 내보내 주세요. 되돌릴 수 없어요.")}</p><form className="settings-form" onSubmit={e=>{e.preventDefault();if(!confirm(t("계정과 기록을 영구 삭제할까요?")))return;act(async()=>{await request('/api/account','DELETE',{confirmation,password},csrf);for(const key of Object.keys(localStorage))if(key.startsWith(`anotar-planner:draft:${user.id}:`))localStorage.removeItem(key);location.assign('/');});}}><label>{t("이메일을 다시 입력")}<input type="email" autoComplete="off" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><label>{t("비밀번호")}<input type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="danger secondary" disabled={busy||confirmation.trim().toLowerCase()!==(user.email||'')}><Trash2 size={16}/>{t("탈퇴하고 기록 삭제")}</button></form></details></section>
  </main>;
}

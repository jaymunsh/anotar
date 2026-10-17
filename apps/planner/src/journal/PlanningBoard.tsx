import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Plus,X,ArrowRight,Pencil} from 'lucide-react';
import {ApiError,PlanningItem,Routine,duration,request} from '../api';
import {RoutineList} from './Routines';
import {getLanguage,pair,t} from '../i18n';
import {periodRange} from './period';
import './planning.css';

// Stable color per planning item: the stripe on linked timetable blocks and the dot on the plan bar.
export const tagColor=(id:string)=>{let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))%360;return `hsl(${h} 38% 42%)`;};
export const monthName=(month:string)=>new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'ko-KR',{year:'numeric',month:'short',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'));
const overlaps=(item:PlanningItem,from:string,to:string)=>item.startMonth<=to&&item.endMonth>=from;
export function usePlanning(demo:boolean,csrf:string){
 // Goals/steps and routines share /api/planning; screens get them apart.
 const [all,setItems]=useState<(PlanningItem|Routine)[]>([]),items=all.filter((item):item is PlanningItem=>item.kind!=='routine'),routines=all.filter((item):item is Routine=>item.kind==='routine'),[loading,setLoading]=useState(!demo),[error,setError]=useState('');
 const reload=useCallback(async()=>{
  if(demo)return items;
  setLoading(true);setError('');
  try{const result=await request<{items:(PlanningItem|Routine)[]}>('/api/planning');setItems(result.items);return result.items.filter((item):item is PlanningItem=>item.kind!=='routine');}
  catch(e){setError((e as Error).message);throw e;}finally{setLoading(false);}
 },[demo,items]);
 useEffect(()=>{if(demo)return;let alive=true;request<{items:(PlanningItem|Routine)[]}>('/api/planning').then(result=>{if(alive)setItems(result.items);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[demo]);
 async function save<T extends PlanningItem|Routine>(item:T){
  const result=demo?{...item,version:item.version+1}:await request<T>('/api/planning/'+item.id,'PUT',item,csrf);
  setItems(old=>old.some(value=>value.id===result.id)?old.map(value=>value.id===result.id?result:value):[...old,result]);return result;
 }
 async function remove(item:PlanningItem|Routine){
  if(demo){setItems(old=>old.filter(value=>value.id!==item.id).map(value=>value.kind!=='routine'&&value.parentId===item.id?{...value,parentId:null,version:value.version+1}:value));return;}
  await request('/api/planning/'+item.id,'DELETE',{version:item.version},csrf);await reload();
 }
 return {items,routines,loading,error,reload,save,remove};
}
export type PlanningState=ReturnType<typeof usePlanning>;

function PlanningDialog({initial,items,state,onClose,onReplace}:{initial:PlanningItem;items:PlanningItem[];state:PlanningState;onClose:()=>void;onReplace:(item:PlanningItem)=>void}){
 const [draft,setDraft]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 const ref=useRef<HTMLDialogElement>(null),heading=useId(),dirty=useRef(false);
 dirty.current=JSON.stringify(draft)!==JSON.stringify(initial);
 const close=useCallback(()=>{if(!busy&&(!dirty.current||confirm(pair('저장하지 않은 계획을 닫을까요?','Discard this unsaved plan?'))))onClose();},[busy,onClose]);
 useEffect(()=>{const element=ref.current!,previous=document.activeElement as HTMLElement|null;element.showModal();element.querySelector<HTMLInputElement>('#planning-title')?.focus();return()=>{element.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 useEffect(()=>{const leave=(event:Event)=>{if(dirty.current&&!confirm(pair('작성 중인 계획을 닫을까요?','Discard this unsaved plan?')))event.preventDefault();};const unload=(event:BeforeUnloadEvent)=>{if(dirty.current){event.preventDefault();event.returnValue='';}};window.addEventListener('anotar-before-leave',leave);window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('anotar-before-leave',leave);window.removeEventListener('beforeunload',unload);};},[]);
 async function submit(event:React.FormEvent){event.preventDefault();setError('');setBusy(true);try{await state.save(draft);dirty.current=false;onClose();}catch(e){setError((e as Error).message);setConflict(e instanceof ApiError&&e.status===409);}finally{setBusy(false);}}
 async function remove(){if(!confirm(initial.kind==='goal'?pair('목표를 삭제할까요? 세부 계획은 남아요.','Delete this goal? Its steps will remain.'):pair('세부 계획을 삭제할까요?','Delete this step?')))return;setBusy(true);setError('');try{await state.remove(initial);dirty.current=false;onClose();}catch(e){setError((e as Error).message);setConflict(e instanceof ApiError&&e.status===409);}finally{setBusy(false);}}
 async function refresh(){if(dirty.current&&!confirm(pair('작성한 입력을 버리고 최신 계획을 불러올까요?','Discard your input and load the latest plan?')))return;setBusy(true);try{const latest=(await state.reload()).find(item=>item.id===initial.id);dirty.current=false;if(latest)onReplace(latest);else onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const change=(value:Partial<PlanningItem>)=>setDraft(old=>({...old,...value}));
 return createPortal(<dialog className="planning-dialog" ref={ref} aria-labelledby={heading} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target!==e.currentTarget)return;const bounds=e.currentTarget.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)close();}}>
  <button className="planning-close" aria-label={pair('닫기','Close')} onClick={close} disabled={busy}><X size={20}/></button>
  <form onSubmit={submit}><h2 id={heading}>{draft.kind==='goal'?pair('집중할 목표','Focus goal'):pair('세부 계획','Planning step')}</h2><fieldset disabled={busy}>
   <label htmlFor="planning-title">{pair('만들고 싶은 결과','Result to work toward')}</label><input id="planning-title" required maxLength={200} value={draft.title} onChange={e=>change({title:e.target.value})} placeholder={pair('예: 첫 사용자에게 서비스 공개','e.g. Release to the first users')}/>
   <div className="form-pair"><label>{pair('시작 월','Start month')}<input aria-label={pair('시작 월','Start month')} type="month" min="2000-01" max="2099-12" required value={draft.startMonth} onChange={e=>change({startMonth:e.target.value})}/></label><label>{pair('마칠 월','End month')}<input aria-label={pair('마칠 월','End month')} type="month" min={draft.startMonth||'2000-01'} max="2099-12" required value={draft.endMonth} onChange={e=>change({endMonth:e.target.value})}/></label></div>
   {draft.kind==='step'&&<label className="planning-parent">{pair('연결할 목표','Related goal')}<select aria-label={pair('연결할 목표','Related goal')} value={draft.parentId||''} onChange={e=>change({parentId:e.target.value||null})}><option value="">{pair('목표 없이 계획','Independent plan')}</option>{items.filter(item=>item.kind==='goal').map(item=><option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}
   <details className="planning-options"><summary>{pair('메모','Note')}</summary><label>{pair('메모','Note')}<textarea maxLength={2000} value={draft.note} onChange={e=>change({note:e.target.value})}/></label></details>
   {error&&<p className="error" role="alert">{t(error)}</p>}{conflict&&<button type="button" className="secondary" onClick={refresh}>{pair('최신 계획 불러오기','Load latest plan')}</button>}
   <div className="form-actions"><button className="primary" disabled={busy}>{busy?pair('저장 중…','Saving…'):pair('계획 저장','Save plan')}</button><button type="button" className="secondary" onClick={close}>{pair('취소','Cancel')}</button>{initial.version>0&&<button type="button" className="text-button danger" onClick={remove}>{pair('삭제','Delete')}</button>}</div>
  </fieldset></form>
 </dialog>,document.body);
}

const shortMonth=(month:string)=>new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'ko-KR',{month:'short',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'));
type Minutes=(ids:string[],from:string,to:string)=>number;
const monthEnd=(month:string)=>`${month}-${String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0')}`;
// Time on the timetable linked to a plan; 0 shows too, so a neglected goal is visible.
function Spent({value}:{value?:number}){return value===undefined?null:<span className={`planning-spent${value?'':' none'}`}>{duration(value)}</span>;}
function Step({item,minutes,onEdit}:{item:PlanningItem;minutes?:number;onEdit:(item:PlanningItem)=>void;}){
 return <button className="planning-step" onClick={()=>onEdit(item)}><span className="planning-step-title"><strong>{item.title}</strong><Spent value={minutes}/></span>{item.startMonth!==item.endMonth&&<small>{monthName(item.startMonth)} — {monthName(item.endMonth)}</small>}{item.note&&<p>{item.note}</p>}</button>;
}
export function PlanningBoard({date,period,state,minutes,onMonth,onQuarter}:{date:string;period:'quarter'|'year';state:PlanningState;minutes?:Minutes;onMonth:(date:string)=>void;onQuarter:(date:string)=>void;}){
 const [editing,setEditing]=useState<PlanningItem|null>(null);
 const range=periodRange(date,period),from=range.start.slice(0,7),to=range.end.slice(0,7),year=date.slice(0,4);
 const visible=state.items.filter(item=>overlaps(item,from,to)),steps=visible.filter(item=>item.kind==='step'),goals=visible.filter(item=>item.kind==='goal');
 const months=Array.from({length:3},(_,i)=>`${year}-${String(Number(from.slice(5))+i).padStart(2,'0')}`);
 function add(kind:'goal'|'step',month=from,parentId:string|null=null){const parent=state.items.find(item=>item.id===parentId);setEditing({id:crypto.randomUUID(),kind,title:'',startMonth:kind==='goal'?from:month,endMonth:kind==='goal'?to:month,note:'',parentId:parent?.id||null,version:0});}
 const stepIds=(goalId:string)=>[goalId,...state.items.filter(item=>item.parentId===goalId).map(item=>item.id)];
 const spent=(ids:string[],fromMonth:string,toMonth:string)=>minutes?.(ids,fromMonth+'-01',monthEnd(toMonth));
 const addGoal=<button className="text-button planning-add-goal" onClick={()=>add('goal')} disabled={state.loading||Boolean(state.error)}><Plus size={15}/>{pair('목표 추가','Add goal')}</button>;
 const groups=[...goals,...(steps.some(item=>!goals.some(goal=>goal.id===item.parentId))?[null]:[])];
 return <section className="planning-board" aria-label={period==='year'?pair('연간 계획표','Annual planning board'):pair('분기 계획표','Quarter planning board')}>
  
  {state.loading?<p role="status">{pair('계획표를 불러오는 중…','Loading your planning board…')}</p>:state.error?<div className="notice" role="alert"><p>{t(state.error)}</p><button className="secondary" onClick={()=>state.reload().catch(()=>{})}>{pair('다시 불러오기','Retry')}</button></div>:<>
   {period==='quarter'?<><div className="planning-focus"><div className="planning-focus-head"><h2>{pair('이번 분기 집중할 목표','Focus this quarter')}</h2>{addGoal}</div>{!goals.length?<p>{pair('목표를 정하거나 아래에 세부 계획부터 넣어보세요.','Choose a goal or start with a step below.')}</p>:<div>{goals.map(goal=><div className="planning-focus-goal" key={goal.id}><button onClick={()=>setEditing(goal)}><strong><i className="planning-context-dot" style={{background:tagColor(goal.id)}}/>{goal.title}</strong><small>{monthName(goal.startMonth)} — {monthName(goal.endMonth)}{minutes&&<> · {pair('이번 분기','This quarter')} <Spent value={spent(stepIds(goal.id),from,to)}/></>}</small></button></div>)}</div>}</div><div className="quarter-plan-columns">{months.map(month=><section className="quarter-plan-month" key={month} aria-label={monthName(month)}><header><button onClick={()=>onMonth(month+'-01')}><h3>{monthName(month)}</h3><small>{pair('월간에서 시간 배치','Open monthly schedule')}</small></button><button aria-label={pair(`${month} 세부 계획 추가`,`Add step for ${month}`)} onClick={()=>add('step',month)}><Plus size={18}/></button></header>{(monthSteps=>[...goals.map(goal=>({goal,list:monthSteps.filter(step=>step.parentId===goal.id)})),{goal:null,list:monthSteps.filter(step=>!goals.some(goal=>goal.id===step.parentId))}].filter(group=>group.list.length).map(({goal,list})=><div className="quarter-goal-group" key={goal?.id||'independent'}><p className="quarter-goal-name">{goal?<><i className="planning-context-dot" style={{background:tagColor(goal.id)}}/>{goal.title}</>:pair('목표 없이 세운 계획','Independent plans')}</p>{list.map(step=><Step key={step.id} item={step} minutes={spent([step.id],month,month)} onEdit={setEditing}/>)}</div>))(steps.filter(step=>overlaps(step,month,month)))}{!steps.some(step=>overlaps(step,month,month))&&<button className="planning-empty-month" onClick={()=>add('step',month)}><Plus size={15}/>{pair('이 달의 결과 정하기','Plan a result for this month')}</button>}</section>)}</div></>:<>
    <div className="annual-plan-head"><span>{pair('집중할 목표','Focus goals')}{addGoal}</span>{[1,2,3,4].map(quarter=><button key={quarter} onClick={()=>onQuarter(`${year}-${String(quarter*3-2).padStart(2,'0')}-01`)}>{pair(`${quarter}분기`,`Q${quarter}`)}<small>{quarter*3-2}–{quarter*3}{pair('월','')}</small></button>)}</div>
    {groups.map(goal=><section className="annual-plan-row" key={goal?.id||'independent'}><div className="annual-goal-name">{goal?<button onClick={()=>setEditing(goal)}><strong><i className="planning-context-dot" style={{background:tagColor(goal.id)}}/>{goal.title}</strong><small>{monthName(goal.startMonth)} — {monthName(goal.endMonth)}</small>{minutes&&<small>{pair('올해','This year')} <Spent value={spent(stepIds(goal.id),`${year}-01`,`${year}-12`)}/></small>}{goal.note&&<p>{goal.note}</p>}</button>:<strong>{pair('목표 없이 세운 계획','Independent plans')}</strong>}</div>{[1,2,3,4].map(quarter=>{const start=`${year}-${String(quarter*3-2).padStart(2,'0')}`,end=`${year}-${String(quarter*3).padStart(2,'0')}`,active=!goal||overlaps(goal,start,end),related=steps.filter(step=>(goal?step.parentId===goal.id:!goals.some(value=>value.id===step.parentId))&&overlaps(step,start,end));return <div className={`annual-quarter-cell${active?' in-scope':''}`} key={quarter}><button className="annual-quarter-label" onClick={()=>onQuarter(start+'-01')}>{pair(`${quarter}분기`,`Q${quarter}`)}</button>{(value=>goal&&active&&value?<p className="annual-quarter-spent"><Spent value={value}/></p>:null)(goal?spent(stepIds(goal.id),start,end):undefined)}{related.map(step=><button className="annual-plan-step" key={step.id} onClick={()=>setEditing(step)}><strong>{step.title}</strong><small>{shortMonth(step.startMonth)}{step.startMonth!==step.endMonth?' — '+shortMonth(step.endMonth):''}</small></button>)}{active&&<button className="annual-add-step" aria-label={pair(`${quarter}분기 ${goal?.title||'독립 계획'} 세부 계획 추가`,`Add step in Q${quarter} for ${goal?.title||'independent plans'}`)} onClick={()=>add('step',goal&&goal.startMonth>start?goal.startMonth:start,goal?.id||null)}><Plus size={14}/>{pair('세부 계획','Add step')}</button>}</div>;})}</section>)}
    {!groups.length&&<div className="annual-plan-empty"><p>{pair('올해 집중하고 싶은 목표를 하나 정해보세요. 각 분기에 세부 계획을 넣을 수 있어요.','Choose one goal for the year, then add steps to each quarter.')}</p><button className="secondary" onClick={()=>add('goal')}><Plus size={16}/>{pair('첫 목표 정하기','Set your first goal')}</button></div>}
   </>}
  </>}
  <RoutineList state={state}/>
  {editing&&<PlanningDialog key={editing.id+'-'+editing.version} initial={editing} items={state.items} state={state} onClose={()=>setEditing(null)} onReplace={setEditing}/>}
 </section>;
}
// One line above the day: what this period is for, and routines one tap away (day view only).
// A plan chip opens a small card: where it sits in the plan, time scheduled for it this week, and a way to put it on today.
export function PlanningContext({date,period,items,onOpen,routines,onRoutine,minutes,onPlace}:{date:string;period:'day'|'week'|'month';items:PlanningItem[];onOpen:()=>void;routines?:Routine[];onRoutine?:(title:string)=>void;minutes?:(ids:string[])=>number;onPlace?:(item:PlanningItem)=>void}){
 const range=period==='day'?{start:date,end:date}:periodRange(date,period),related=items.filter(item=>overlaps(item,range.start.slice(0,7),range.end.slice(0,7))).sort((a,b)=>(a.kind==='step'?0:1)-(b.kind==='step'?0:1));
 const [card,setCard]=useState<{id:string;left:number}|null>(null),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!card)return;const close=(e:Event)=>{if(e instanceof KeyboardEvent?e.key==='Escape':!root.current?.querySelector('.planning-card')?.contains(e.target as Node)&&!(e.target as Element).closest?.('.planning-context-item'))setCard(null);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};},[card]);
 if(!related.length&&!routines)return null;
 const shown=card&&items.find(item=>item.id===card.id),parent=shown?.parentId?items.find(item=>item.id===shown.parentId):undefined,children=shown?.kind==='goal'?items.filter(item=>item.parentId===shown.id&&overlaps(item,range.start.slice(0,7),range.end.slice(0,7))):[];
 function toggle(e:React.MouseEvent<HTMLButtonElement>,id:string){if(card?.id===id){setCard(null);return;}const box=root.current!.getBoundingClientRect(),chip=e.currentTarget.getBoundingClientRect();setCard({id,left:Math.max(0,Math.min(chip.left-box.left,box.width-320))});}
 return <div className="planning-context" ref={root}>{related.length>0&&<div className="planning-context-plans" aria-label={pair('이번 기간 계획','Focus for this period')} role="group"><span className="planning-context-label">{pair('이번 기간','This period')}</span>{related.slice(0,3).map(item=><button key={item.id} className={`planning-context-item ${item.kind}`} aria-expanded={card?.id===item.id} title={`${item.title} · ${monthName(item.startMonth)} — ${monthName(item.endMonth)}`} onClick={e=>toggle(e,item.id)}><i className="planning-context-dot" style={{background:tagColor(item.id)}}/>{item.title}</button>)}<button className="planning-context-more" aria-label={pair('분기 계획표 열기','Open quarter plan')} title={pair('분기 계획표 열기','Open quarter plan')} onClick={onOpen}>{related.length>3&&`+${related.length-3}`}<ArrowRight size={14}/></button></div>}
 {routines&&<div className="journal-routines" role="group" aria-label={pair('루틴','Routines')}><span className="planning-context-label">{pair('루틴','Routines')}</span>{routines.length>0&&<div className="journal-routine-chips">{routines.map(r=><button key={r.id} draggable onDragStart={e=>e.dataTransfer.setData('application/anotar-routine',r.title)} onClick={()=>onRoutine?.(r.title)}><Plus size={13}/>{r.title}</button>)}</div>}<a className="journal-routines-manage" href="/app/plans?view=quarter#routines">{routines.length?pair('관리','Manage'):pair('만들기','Create')}</a></div>}
 {shown&&card&&<div className="planning-card" role="dialog" aria-label={shown.title} style={{left:card.left}}><p className="planning-card-kind"><i className="planning-context-dot" style={{background:tagColor(shown.id)}}/>{shown.kind==='step'?pair(`${monthName(shown.startMonth)} 세부 계획`,`${monthName(shown.startMonth)} step`):pair(`목표 · ${monthName(shown.startMonth)} — ${monthName(shown.endMonth)}`,`Goal · ${monthName(shown.startMonth)} — ${monthName(shown.endMonth)}`)}<button className="planning-card-close" aria-label={pair('닫기','Close')} onClick={()=>setCard(null)}><X size={14}/></button></p><strong>{shown.title}</strong>{parent&&<p className="planning-card-parent">{pair('목표','Goal')} · {parent.title}</p>}{children.length>0&&<ul>{children.map(child=><li key={child.id}>{monthName(child.startMonth)} · {child.title}</li>)}</ul>}{shown.note&&<p className="planning-card-note">{shown.note}</p>}{minutes&&<p className="planning-card-time">{pair('이번 주 시간표에 잡은 시간','Scheduled this week')}<b>{duration(minutes([shown.id,...children.map(child=>child.id)]))}</b></p>}<div className="planning-card-actions">{onPlace&&<button className="primary" onClick={()=>{onPlace(shown);setCard(null);}}><Plus size={14}/>{pair('시간표에 넣기','Add to schedule')}</button>}<button className="text-button" onClick={onOpen}>{pair('계획표에서 보기','View in plan')}<ArrowRight size={14}/></button></div></div>}</div>;
}

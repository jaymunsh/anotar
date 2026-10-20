import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Plus,X,ArrowRight,Ellipsis,Pencil,Pin} from 'lucide-react';
import {ApiError,DayTemplate,PlanningItem,Routine,duration,request} from '../api';
import {getLanguage,pair,t} from '../i18n';
import './planning.css';

// Sixteen goal colours: the first eight calm, the rest brighter so many goals stay apart. A step, and any timetable block linked to it, wears its goal's colour; no goal means grey.
export const goalColors=['#5b8a6b','#4f7aa3','#b0704a','#8a5fa0','#b5545c','#4f9a9a','#a68a3c','#2a9fd0','#d9822b','#c2577f','#7f9b2f','#2f6fd6','#e0b02a','#5e4bb5','#8c6650','#e5604a'];
const noGoal='#a7b0aa';
// ponytail: module-level map refreshed by usePlanning so tagColor(id) keeps its one-argument callers; fine while one planning state is mounted.
let colorOf=new Map<string,string>();
export const tagColor=(id:string)=>colorOf.get(id)||noGoal;
/** Each goal's colour, and each step's (its goal's), from the items themselves. */
export function colorsFor(items:PlanningItem[]){const next=new Map<string,string>();items.filter(i=>i.kind==='goal').forEach((goal,i)=>next.set(goal.id,goalColors[goal.color??i%8]));for(const step of items)if(step.kind==='step')next.set(step.id,(step.parentId&&next.get(step.parentId))||noGoal);return next;}
function paint(items:PlanningItem[]){colorOf=colorsFor(items);}
export const monthName=(month:string)=>new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'ko-KR',{year:'numeric',month:'short',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'));
const overlaps=(item:PlanningItem,from:string,to:string)=>item.startMonth<=to&&item.endMonth>=from;
type Stored=PlanningItem|Routine|DayTemplate;
const isPlan=(item:Stored):item is PlanningItem=>item.kind==='goal'||item.kind==='step';
export function usePlanning(demo:boolean,csrf:string){
 // Goals/steps and routines share /api/planning; screens get them apart.
 const [all,setItems]=useState<Stored[]>([]),items=all.filter(isPlan),routines=all.filter((item):item is Routine=>item.kind==='routine'),templates=all.filter((item):item is DayTemplate=>item.kind==='template'),[loading,setLoading]=useState(!demo),[error,setError]=useState('');
 paint(items);
 const reload=useCallback(async()=>{
  if(demo)return items;
  setLoading(true);setError('');
  try{const result=await request<{items:Stored[]}>('/api/planning');setItems(result.items);return result.items.filter(isPlan);}
  catch(e){setError((e as Error).message);throw e;}finally{setLoading(false);}
 },[demo,items]);
 useEffect(()=>{if(demo)return;let alive=true;request<{items:Stored[]}>('/api/planning').then(result=>{if(alive)setItems(result.items);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[demo]);
 // Changes from another tab or device show up when this tab comes back into view.
 useEffect(()=>{
  if(demo)return;
  const refresh=()=>{if(document.visibilityState==='visible')request<{items:Stored[]}>('/api/planning').then(result=>setItems(result.items)).catch(()=>{});};
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[demo]);
 async function save<T extends Stored>(item:T){
  // Show an edit to an existing item at once; the server's answer (new version) replaces it, a failure reloads.
  setItems(old=>old.map(value=>value.id===item.id?item:value));
  let result:T;try{result=demo?{...item,version:item.version+1}:await request<T>('/api/planning/'+item.id,'PUT',item,csrf);}catch(e){if(!demo)request<{items:Stored[]}>('/api/planning').then(r=>setItems(r.items)).catch(()=>{});throw e;}
  setItems(old=>old.some(value=>value.id===result.id)?old.map(value=>value.id===result.id?result:value):[...old,result]);return result;
 }
 async function remove(item:Stored){
  if(demo){setItems(old=>old.filter(value=>value.id!==item.id).map(value=>isPlan(value)&&value.parentId===item.id?{...value,parentId:null,version:value.version+1}:value));return;}
  await request('/api/planning/'+item.id,'DELETE',{version:item.version},csrf);await reload();
 }
 return {items,routines,templates,loading,error,reload,save,remove};
}
export type PlanningState=ReturnType<typeof usePlanning>;

const monthEnd=(month:string)=>`${month}-${String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0')}`;
type Minutes=(ids:string[],from:string,to:string)=>number;
// 계획 > 목표: a card per goal for the year — about the plan, not time spent (that lives in 회고). 집중 (pinned) goals come first.
export function PlanningBoard({date,state}:{date:string;state:PlanningState}){
 const year=date.slice(0,4),from=`${year}-01`,to=`${year}-12`;
 const [error,setError]=useState(''),[palette,setPalette]=useState<string|null>(null),[focusId,setFocusId]=useState<string|null>(null);
 const goals=state.items.filter(item=>item.kind==='goal'&&overlaps(item,from,to)).sort((a,b)=>Number(Boolean(b.focus))-Number(Boolean(a.focus)));
 const steps=state.items.filter(item=>item.kind==='step');
 const orphans=steps.filter(step=>(!step.parentId||!state.items.some(goal=>goal.id===step.parentId))&&overlaps(step,from,to));
 useEffect(()=>{if(focusId){const el=document.querySelector<HTMLInputElement>(`[data-plan="${focusId}"]`);if(el){el.focus();el.select();setFocusId(null);}}},[focusId,state.items]);
 async function run(action:()=>Promise<unknown>){setError('');try{await action();}catch(e){setError((e as Error).message);}}
 const save=(item:PlanningItem)=>run(()=>state.save(item));
 function addGoal(){const used=new Set(goals.map((goal,i)=>goal.color??i%8)),free=goalColors.findIndex((_,i)=>!used.has(i)),id=crypto.randomUUID();void run(async()=>{await state.save({id,kind:'goal',title:pair('새 목표','New goal'),startMonth:from,endMonth:to,note:'',parentId:null,color:free<0?goals.length%goalColors.length:free,version:0});setFocusId(id);});}
 // A step has no date of its own any more: it spans its goal (the server keeps steps inside the goal's months).
 function addStep(goal:PlanningItem|null,title:string){return run(()=>state.save({id:crypto.randomUUID(),kind:'step',title,startMonth:goal?.startMonth||from,endMonth:goal?.endMonth||to,note:'',parentId:goal?.id||null,done:false,version:0}));}
 function rename(item:PlanningItem,title:string){title=title.trim();if(title===item.title)return;if(!title){if(item.kind==='step')void run(()=>state.remove(item));return;}void save({...item,title});}
 function removeGoal(goal:PlanningItem){if(confirm(pair('목표를 지울까요? 세부 계획은 ‘목표 없음’으로 옮겨져요.','Delete this goal? Its steps move to “No goal”.')))void run(()=>state.remove(goal));}
 const blurOnEnter=(e:React.KeyboardEvent<HTMLElement>)=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.blur();}};
 const stepRows=(list:PlanningItem[])=>list.map(step=><li key={step.id} className={`goal-step${step.done?' done':''}`}>
  <input type="checkbox" checked={Boolean(step.done)} aria-label={pair(`${step.title} 완료`,`Complete ${step.title}`)} onChange={e=>void save({...step,done:e.target.checked})}/>
  <input key={step.version} data-plan={step.id} className="goal-step-title" defaultValue={step.title} maxLength={200} aria-label={pair('세부 계획','Step')} onBlur={e=>rename(step,e.target.value)} onKeyDown={blurOnEnter}/>
  <button className="goal-remove" aria-label={pair(`${step.title} 지우기`,`Delete ${step.title}`)} title={pair('지우기','Delete')} onClick={()=>void run(()=>state.remove(step))}><X size={14}/></button>
 </li>);
 const addRow=(goal:PlanningItem|null)=><li className="goal-step-new"><Plus size={14} aria-hidden="true"/><input placeholder={pair('세부 계획 추가','Add a step')} maxLength={200} aria-label={pair(`${goal?.title||'목표 없음'} 세부 계획 추가`,`Add a step to ${goal?.title||'No goal'}`)} onKeyDown={e=>{if(e.key!=='Enter'||e.nativeEvent.isComposing)return;e.preventDefault();const input=e.currentTarget,title=input.value.trim();if(!title)return;void addStep(goal,title).then(()=>{input.value='';input.focus();});}}/></li>;
 const card=(goal:PlanningItem)=>{const own=steps.filter(step=>step.parentId===goal.id),done=own.filter(step=>step.done).length,color=tagColor(goal.id);
  return <article className={`goal-card${goal.focus?' focus':''}`} key={goal.id} style={{'--goal':color} as React.CSSProperties}>
   <header>
    <button className="goal-dot" aria-label={pair('목표 색 바꾸기','Change goal colour')} aria-expanded={palette===goal.id} onClick={()=>setPalette(palette===goal.id?null:goal.id)}/>
    <input key={goal.version} data-plan={goal.id} className="goal-title" defaultValue={goal.title} maxLength={200} aria-label={pair('목표','Goal')} onBlur={e=>rename(goal,e.target.value)} onKeyDown={blurOnEnter}/>
    <span className="goal-progress">{own.length?`${done}/${own.length}`:''}</span>
    <button className="goal-pin" aria-pressed={Boolean(goal.focus)} aria-label={pair(`${goal.title} 집중`,`Focus on ${goal.title}`)} title={goal.focus?pair('집중 해제','Stop focusing'):pair('집중','Focus')} onClick={()=>void save({...goal,focus:!goal.focus})}><Pin size={15}/></button>
    <button className="goal-remove" aria-label={pair(`${goal.title} 지우기`,`Delete ${goal.title}`)} title={pair('목표 지우기','Delete goal')} onClick={()=>removeGoal(goal)}><X size={15}/></button>
   </header>
   <textarea key={goal.version} className="goal-note" rows={1} defaultValue={goal.note} maxLength={2000} placeholder={pair('끝났을 때 모습','What done looks like')} aria-label={pair(`${goal.title} 끝났을 때 모습`,`${goal.title}: what done looks like`)} onBlur={e=>{const note=e.target.value.trim();if(note!==goal.note)void save({...goal,note});}} onKeyDown={blurOnEnter}/>
   {palette===goal.id&&<div className="goal-palette" role="group" aria-label={pair('목표 색','Goal colour')}>{goalColors.map((c,i)=><button key={c} style={{background:c}} aria-label={pair(`색 ${i+1}`,`Colour ${i+1}`)} aria-pressed={color===c} onClick={()=>{setPalette(null);void save({...goal,color:i});}}/>)}</div>}
   {own.length>0&&<div className="goal-bar" aria-hidden="true"><i style={{width:`${done/own.length*100}%`}}/></div>}
   <ul>{stepRows(own)}{addRow(goal)}</ul>
  </article>;};
 return <section className="planning-board goal-board" aria-label={pair(`${year}년 목표`,`${year} goals`)}>
  {state.loading?<p role="status">{pair('목표를 불러오는 중…','Loading goals…')}</p>:state.error?<div className="notice" role="alert"><p>{t(state.error)}</p><button className="secondary" onClick={()=>state.reload().catch(()=>{})}>{pair('다시 불러오기','Retry')}</button></div>:<>
   <div className="goal-board-head"><p>{goals.length?pair(`목표 ${goals.length}개 · 세부 계획 ${steps.filter(s=>goals.some(g=>g.id===s.parentId)).filter(s=>s.done).length}/${steps.filter(s=>goals.some(g=>g.id===s.parentId)).length} 완료`,`${goals.length} goals · ${steps.filter(s=>goals.some(g=>g.id===s.parentId)&&s.done).length}/${steps.filter(s=>goals.some(g=>g.id===s.parentId)).length} steps done`):pair('올해 이루고 싶은 것을 목표로 적고, 끝내야 할 일을 세부 계획으로 나눠요.','Write what you want this year as goals, then split them into steps.')}</p><button className="secondary" onClick={addGoal}><Plus size={15}/>{pair('목표 추가','Add goal')}</button></div>
   {error&&<p className="error" role="alert">{t(error)}</p>}
   <div className="goal-cards">{goals.map(card)}{orphans.length>0&&noGoal()}</div>
   {!goals.length&&!orphans.length&&<div className="goal-empty"><button className="primary" onClick={addGoal}><Plus size={16}/>{pair('첫 목표 정하기','Set your first goal')}</button></div>}
  </>}
 </section>;
 function noGoal(){return <article className="goal-card no-goal"><header><i className="goal-dot"/><strong className="goal-title">{pair('목표 없음','No goal')}</strong></header><ul>{stepRows(orphans)}{addRow(null)}</ul></article>;}
}
// 회고 > 올해 흐름: goal rows × 12 months, shaded by time the timetable gave each goal (its steps included). Nothing to fill in.
export function GoalFlow({year,items,minutes}:{year:string;items:PlanningItem[];minutes:Minutes}){
 const colors=colorsFor(items),now=new Date().toISOString().slice(0,7),months=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
 const goals=items.filter(item=>item.kind==='goal'&&overlaps(item,`${year}-01`,`${year}-12`));
 const flow=goals.map(goal=>{const ids=[goal.id,...items.filter(step=>step.parentId===goal.id).map(step=>step.id)];return {goal,cells:months.map(m=>minutes(ids,m+'-01',monthEnd(m)))};}),peak=Math.max(0,...flow.flatMap(row=>row.cells));
 if(!goals.length)return null;
 return <>
  <h2>{pair(`${year}년 흐름`,`${year} at a glance`)}</h2>
  {!peak&&<p className="goal-flow-hint">{pair('시간표 일정을 열어 ‘관련 계획’에 목표나 세부 계획을 고르면, 여기에 달마다 그 목표에 쓴 시간이 색으로 쌓여요.','Link a timetable plan to a goal or step (“Related plan”) and this spot fills with the time each goal got per month.')}</p>}
{peak>0&&<div className="goal-flow" role="table" aria-label={pair('달마다 시간표에 쓴 시간','Time on the timetable by month')}>
    <div className="goal-flow-row goal-flow-head" role="row"><span role="columnheader" className="goal-flow-caption">{pair('달마다 시간표에 쓴 시간','Timetable time by month')}</span>{months.map(m=><span role="columnheader" key={m} className={m===now?'now':undefined}>{Number(m.slice(5))}</span>)}</div>
    {flow.map(({goal,cells})=><div className={`goal-flow-row${goal.focus?' focus':''}`} role="row" key={goal.id} style={{'--goal':colors.get(goal.id)} as React.CSSProperties}><span role="rowheader" className="goal-flow-name"><i/><span>{goal.title}</span></span>{cells.map((value,i)=>{const label=value?`${monthName(months[i])} · ${duration(value)}`:monthName(months[i]);return <span role="cell" key={months[i]} className={months[i]===now?'now':undefined} title={label} aria-label={label}>{value>0&&<i style={{opacity:.15+.5*value/peak}}/>}</span>;})}</div>)}
   </div>}
 </>;
}
// One line above the day: the 집중 goals, each with its next step, and routines one tap away (day view only).
// A goal chip opens a small card: what done looks like, its open steps (each can go on today), and time scheduled this week.
export function PlanningContext({items,onOpen,routines,onRoutine,minutes,onPlace}:{items:PlanningItem[];onOpen:()=>void;routines?:Routine[];onRoutine?:(title:string)=>void;minutes?:(ids:string[])=>number;onPlace?:(item:PlanningItem)=>void}){
 const goals=items.filter(item=>item.kind==='goal'&&item.focus),open=(goal:PlanningItem)=>items.filter(item=>item.kind==='step'&&item.parentId===goal.id&&!item.done);
 const [card,setCard]=useState<{id:string;left:number}|null>(null),root=useRef<HTMLDivElement>(null);

 useEffect(()=>{if(!card)return;const close=(e:Event)=>{if(e instanceof KeyboardEvent?e.key==='Escape':!root.current?.querySelector('.planning-card')?.contains(e.target as Node)&&!(e.target as Element).closest?.('.planning-context-item,[data-card-toggle]'))setCard(null);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};},[card]);
 const shown=card&&goals.find(goal=>goal.id===card.id),steps=shown?open(shown):[];
 function toggle(e:React.MouseEvent<HTMLButtonElement>,id:string){if(card?.id===id){setCard(null);return;}const box=root.current!.getBoundingClientRect(),chip=e.currentTarget.getBoundingClientRect();setCard({id,left:Math.max(0,Math.min(chip.left-box.left,box.width-320))});}
 return <div className="planning-context" ref={root}><div className="planning-context-plans" aria-label={pair('집중 목표','Focus goals')} role="group"><span className="planning-context-label">{pair('집중','Focus')}</span>
  {goals.length?goals.map(goal=>{const next=open(goal)[0];return <button key={goal.id} className="planning-context-item" aria-expanded={card?.id===goal.id} title={next?`${goal.title} → ${next.title}`:goal.title} onClick={e=>toggle(e,goal.id)}><i className="planning-context-dot" style={{background:tagColor(goal.id)}}/><b>{goal.title}</b>{next&&<span className="planning-context-next">{next.title}</span>}</button>;}):<button className="planning-context-more" onClick={onOpen}>{pair('목표에서 집중할 목표를 골라 보세요','Pick a goal to focus on')}<ArrowRight size={14}/></button>}
  {goals.length>0&&<button className="planning-context-more" aria-label={pair('목표 열기','Open goals')} title={pair('목표 열기','Open goals')} onClick={onOpen}><ArrowRight size={14}/></button>}</div>
 {routines&&<div className="journal-routines" role="group" aria-label={pair('루틴','Routines')}><span className="planning-context-label">{pair('루틴','Routines')}</span>{routines.length>0&&<div className="journal-routine-chips">{routines.map(r=><button key={r.id} draggable onDragStart={e=>e.dataTransfer.setData('application/anotar-routine',r.title)} onClick={()=>onRoutine?.(r.title)}><Plus size={13}/><span>{r.title}</span></button>)}</div>}
  {routines.length?<button className="planning-context-more" data-card-toggle aria-expanded={card?.id==='routines'} aria-label={pair('루틴 전체 보기','All routines')} title={pair('루틴 전체 보기','All routines')} onClick={e=>toggle(e,'routines')}><Ellipsis size={16}/></button>:<a className="journal-routines-manage" href="/app/plans?view=routines">{pair('만들기','Create')}</a>}</div>}
 {routines&&card?.id==='routines'&&<div className="planning-card" role="dialog" aria-label={pair('루틴','Routines')} style={{left:card.left}}><p className="planning-card-kind">{pair('루틴 · 누르면 시간표에 넣어요','Routines · tap to add to the timetable')}<button className="planning-card-close" aria-label={pair('닫기','Close')} onClick={()=>setCard(null)}><X size={14}/></button></p>
  <ul className="planning-card-steps">{routines.map(r=><li key={r.id}><button aria-label={pair(`${r.title} 시간표에 넣기`,`Add ${r.title} to schedule`)} onClick={()=>{onRoutine?.(r.title);setCard(null);}}><span>{r.title}</span><Plus size={14}/></button></li>)}</ul>
  <div className="planning-card-actions"><a className="text-button" href="/app/plans?view=routines">{pair('루틴 관리','Manage routines')}<ArrowRight size={14}/></a></div></div>}
 {shown&&card&&<div className="planning-card" role="dialog" aria-label={shown.title} style={{left:card.left}}><p className="planning-card-kind"><i className="planning-context-dot" style={{background:tagColor(shown.id)}}/>{pair('집중 목표','Focus goal')}<button className="planning-card-close" aria-label={pair('닫기','Close')} onClick={()=>setCard(null)}><X size={14}/></button></p><strong>{shown.title}</strong>{shown.note&&<p className="planning-card-note">{shown.note}</p>}
  {steps.length>0?<ul className="planning-card-steps">{steps.map(step=><li key={step.id}>{onPlace?<button aria-label={pair(`${step.title} 시간표에 넣기`,`Add ${step.title} to schedule`)} onClick={()=>{onPlace(step);setCard(null);}}><span>{step.title}</span><Plus size={14}/></button>:<span>{step.title}</span>}</li>)}</ul>:<p className="planning-card-note">{pair('남은 세부 계획이 없어요.','No steps left.')}</p>}
  {minutes&&<p className="planning-card-time">{pair('이번 주 시간표에 잡은 시간','Scheduled this week')}<b>{duration(minutes([shown.id,...items.filter(item=>item.parentId===shown.id).map(item=>item.id)]))}</b></p>}<div className="planning-card-actions"><button className="text-button" onClick={onOpen}>{pair('목표에서 보기','View in goals')}<ArrowRight size={14}/></button></div></div>}</div>;
}

import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Plus,X,ArrowRight,Pencil,ChevronRight} from 'lucide-react';
import {ApiError,PlanningItem,Routine,request} from '../api';
import {RoutineList} from './Routines';
import {getLanguage,pair,t} from '../i18n';
import {periodRange} from './period';
import './planning.css';

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

function Step({item,items,onEdit}:{item:PlanningItem;items:PlanningItem[];onEdit:(item:PlanningItem)=>void;}){
 const parent=items.find(value=>value.id===item.parentId);
 return <article className="planning-step"><button className="planning-step-title" onClick={()=>onEdit(item)}><strong>{item.title}</strong><Pencil size={13}/></button>{parent&&<small className="planning-step-goal">{parent.title}</small>}<small>{monthName(item.startMonth)}{item.startMonth!==item.endMonth?' — '+monthName(item.endMonth):''}</small>{item.note&&<p>{item.note}</p>}
  
 </article>;
}
export function PlanningBoard({date,period,state,onMonth,onQuarter}:{date:string;period:'quarter'|'year';state:PlanningState;onMonth:(date:string)=>void;onQuarter:(date:string)=>void;}){
 const [editing,setEditing]=useState<PlanningItem|null>(null);
 const range=periodRange(date,period),from=range.start.slice(0,7),to=range.end.slice(0,7),year=date.slice(0,4);
 const visible=state.items.filter(item=>overlaps(item,from,to)),steps=visible.filter(item=>item.kind==='step'),goals=visible.filter(item=>item.kind==='goal');
 const months=Array.from({length:3},(_,i)=>`${year}-${String(Number(from.slice(5))+i).padStart(2,'0')}`);
 function add(kind:'goal'|'step',month=from,parentId:string|null=null){const parent=state.items.find(item=>item.id===parentId);setEditing({id:crypto.randomUUID(),kind,title:'',startMonth:kind==='goal'?from:month,endMonth:kind==='goal'?to:month,note:'',parentId:parent?.id||null,version:0});}
 const groups=[...goals,...(steps.some(item=>!goals.some(goal=>goal.id===item.parentId))?[null]:[])];
 return <section className="planning-board" aria-label={period==='year'?pair('연간 계획표','Annual planning board'):pair('분기 계획표','Quarter planning board')}>
  <div className="planning-toolbar"><p>{period==='year'?pair('목표를 네 분기의 흐름으로 펼쳐요.','Map your goals across four quarters.'):pair('이번 세 달에 만들 결과와 세부 계획을 배치해요.','Plan the results and steps for the next three months.')}</p><button className="text-button" onClick={()=>add('goal')} disabled={state.loading||Boolean(state.error)}><Plus size={16}/>{pair('목표 추가','Add goal')}</button></div>
  {state.loading?<p role="status">{pair('계획표를 불러오는 중…','Loading your planning board…')}</p>:state.error?<div className="notice" role="alert"><p>{t(state.error)}</p><button className="secondary" onClick={()=>state.reload().catch(()=>{})}>{pair('다시 불러오기','Retry')}</button></div>:<>
   {period==='quarter'?<><div className="planning-focus"><h2>{pair('이번 분기 집중할 목표','Focus this quarter')}</h2>{!goals.length?<p>{pair('목표를 정하거나 아래에 세부 계획부터 넣어보세요.','Choose a goal or start with a step below.')}</p>:<div>{goals.map(goal=><div className="planning-focus-goal" key={goal.id}><button onClick={()=>setEditing(goal)}><strong>{goal.title}</strong><small>{monthName(goal.startMonth)} — {monthName(goal.endMonth)}</small></button></div>)}</div>}</div><div className="quarter-plan-columns">{months.map(month=><section className="quarter-plan-month" key={month} aria-label={monthName(month)}><header><button onClick={()=>onMonth(month+'-01')}><h3>{monthName(month)}</h3><small>{pair('월간에서 시간 배치','Open monthly schedule')}</small></button><button aria-label={pair(`${month} 세부 계획 추가`,`Add step for ${month}`)} onClick={()=>add('step',month)}><Plus size={18}/></button></header>{steps.filter(step=>overlaps(step,month,month)).map(step=><Step key={step.id} item={step} items={state.items} onEdit={setEditing}/>)}{!steps.some(step=>overlaps(step,month,month))&&<button className="planning-empty-month" onClick={()=>add('step',month)}><Plus size={15}/>{pair('이 달의 결과 정하기','Plan a result for this month')}</button>}</section>)}</div></>:<>
    <div className="annual-plan-head"><span>{pair('집중할 목표','Focus goals')}</span>{[1,2,3,4].map(quarter=><button key={quarter} onClick={()=>onQuarter(`${year}-${String(quarter*3-2).padStart(2,'0')}-01`)}>{pair(`${quarter}분기`,`Q${quarter}`)}<small>{quarter*3-2}–{quarter*3}{pair('월','')}</small></button>)}</div>
    {groups.map(goal=><section className="annual-plan-row" key={goal?.id||'independent'}><div className="annual-goal-name">{goal?<button onClick={()=>setEditing(goal)}><strong>{goal.title}</strong><small>{monthName(goal.startMonth)} — {monthName(goal.endMonth)}</small>{goal.note&&<p>{goal.note}</p>}</button>:<strong>{pair('목표 없이 세운 계획','Independent plans')}</strong>}</div>{[1,2,3,4].map(quarter=>{const start=`${year}-${String(quarter*3-2).padStart(2,'0')}`,end=`${year}-${String(quarter*3).padStart(2,'0')}`,active=!goal||overlaps(goal,start,end),related=steps.filter(step=>(goal?step.parentId===goal.id:!goals.some(value=>value.id===step.parentId))&&overlaps(step,start,end));return <div className={`annual-quarter-cell${active?' in-scope':''}`} key={quarter}><button className="annual-quarter-label" onClick={()=>onQuarter(start+'-01')}>{pair(`${quarter}분기`,`Q${quarter}`)}</button>{related.map(step=><button className="annual-plan-step" key={step.id} onClick={()=>setEditing(step)}><strong>{step.title}</strong><small>{monthName(step.startMonth)}{step.startMonth!==step.endMonth?' — '+monthName(step.endMonth):''}</small></button>)}{active&&<button className="annual-add-step" aria-label={pair(`${quarter}분기 ${goal?.title||'독립 계획'} 세부 계획 추가`,`Add step in Q${quarter} for ${goal?.title||'independent plans'}`)} onClick={()=>add('step',goal&&goal.startMonth>start?goal.startMonth:start,goal?.id||null)}><Plus size={14}/>{pair('세부 계획','Add step')}</button>}</div>;})}</section>)}
    {!groups.length&&<div className="annual-plan-empty"><p>{pair('올해 집중하고 싶은 목표를 하나 정해보세요. 각 분기에 세부 계획을 넣을 수 있어요.','Choose one goal for the year, then add steps to each quarter.')}</p><button className="secondary" onClick={()=>add('goal')}><Plus size={16}/>{pair('첫 목표 정하기','Set your first goal')}</button></div>}
   </>}
  </>}
  <RoutineList state={state}/>
  {editing&&<PlanningDialog key={editing.id+'-'+editing.version} initial={editing} items={state.items} state={state} onClose={()=>setEditing(null)} onReplace={setEditing}/>}
 </section>;
}
export function PlanningContext({date,period,items,onOpen}:{date:string;period:'day'|'week'|'month';items:PlanningItem[];onOpen:()=>void}){
 const range=period==='day'?{start:date,end:date}:periodRange(date,period),related=items.filter(item=>overlaps(item,range.start.slice(0,7),range.end.slice(0,7)));
 if(!related.length)return null;
 return <details className="planning-context"><summary><ChevronRight size={14}/>{pair('이번 기간 계획','Focus for this period')}<span>{related.slice(0,2).map(item=>item.title).join(' · ')}{related.length>2?` +${related.length-2}`:''}</span></summary><div>{related.map(item=><button key={item.id} onClick={onOpen}><strong>{item.title}</strong><small>{monthName(item.startMonth)} — {monthName(item.endMonth)}</small></button>)}<button className="text-button" onClick={onOpen}>{pair('분기 계획표 열기','Open quarter plan')}<ArrowRight size={14}/></button></div></details>;
}

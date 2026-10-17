// Routines: saved names (운동, 독서…) that the day view drops onto the timetable with one tap.
// No rules, times or targets — what lands on a day is an ordinary activity for that day only.
import {useState} from 'react';
import {Plus,X} from 'lucide-react';
import {clock,type DayTemplate,type Routine,type TemplateBlock} from '../api';
import {times} from '../planner';
import {pair} from '../i18n';
import type {PlanningState} from './PlanningBoard';

export function RoutineList({state,seed}:{state:PlanningState;seed?:{date:string;blocks:TemplateBlock[]}}){
 const [name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function add(){const title=name.trim();if(!title)return;void run(async()=>{await state.save<Routine>({id:crypto.randomUUID(),kind:'routine',title,version:0});setName('');});}
 function rename(item:Routine,title:string){title=title.trim();if(title&&title!==item.title)void run(()=>state.save<Routine>({...item,title}));}
 // Its own tab under 계획 (view=routines). Rows look like 오늘 꼭 할 일: a dot, the name, a quiet ×; the last row adds.
 return <div className="tool-cards"><section className="tool-card routine-list" id="routines" aria-labelledby="routines-title">
  <header><h2 id="routines-title">{pair('루틴','Routines')}</h2><span className="routine-count">{state.routines.length}<span> / 50</span></span></header>
  <p className="tool-card-lead">{pair('자주 하는 일을 저장해 두면 일정 화면 위 칩으로 한 번에 넣어요. 누르면 다음 빈 시간에 30분으로 들어가요.','Saved here, they show as chips on the schedule; a tap adds 30 minutes at the next free slot.')}</p>
  <ul>{state.routines.map(item=><li key={item.id}>
   <i className="routine-dot" aria-hidden="true"/>
   <input defaultValue={item.title} maxLength={100} aria-label={pair(`루틴 이름: ${item.title}`,`Routine name: ${item.title}`)} disabled={busy} onBlur={e=>rename(item,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
   <button className="routine-remove" aria-label={pair(`${item.title} 삭제`,`Delete ${item.title}`)} title={pair('지우기','Delete')} disabled={busy} onClick={()=>{if(confirm(pair(`'${item.title}' 루틴을 지울까요? 이미 넣은 일정은 그대로 남아요.`,`Delete '${item.title}'? Activities already added stay.`)))void run(()=>state.remove(item));}}><X size={15}/></button>
  </li>)}
  {state.routines.length<50&&<li className="routine-new"><Plus size={14} aria-hidden="true"/>
   <form onSubmit={e=>{e.preventDefault();add();}}><input value={name} maxLength={100} placeholder={state.routines.length?pair('루틴 추가','Add a routine'):pair('예: 운동, 독서, 영어 공부','e.g. Workout, Reading')} aria-label={pair('새 루틴 이름','New routine name')} disabled={busy} onChange={e=>setName(e.target.value)}/>{name.trim()&&<button className="text-button" disabled={busy}>{pair('추가','Add')}</button>}</form>
  </li>}</ul>
  {error&&<p className="error" role="alert">{error}</p>}
  {state.routines.length>0&&<div className="routine-preview"><p>{pair('일정 화면에서는','On the schedule')}</p><div className="journal-routine-chips" aria-hidden="true">{state.routines.map(item=><span key={item.id} className="routine-chip"><Plus size={12}/>{item.title}</span>)}</div></div>}
 </section><TemplateList state={state} seed={seed}/></div>;
}

// 하루 틀: a named day of timed blocks. On an empty day the schedule offers to lay it down in one tap; after that the blocks are ordinary activities.
const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
function TemplateList({state,seed}:{state:PlanningState;seed?:{date:string;blocks:TemplateBlock[]}}){
 const [error,setError]=useState('');
 async function run(action:()=>Promise<unknown>){setError('');try{await action();}catch(e){setError((e as Error).message);}}
 const save=(item:DayTemplate)=>run(()=>state.save<DayTemplate>(item));
 const setBlock=(item:DayTemplate,index:number,change:Partial<TemplateBlock>)=>{const blocks=item.blocks.map((b,i)=>{if(i!==index)return b;const next={...b,...change};if(next.end<=next.start)next.end=Math.min(1440,next.start+30);return next;});return save({...item,blocks});};
 function create(blocks:TemplateBlock[]){void save({id:crypto.randomUUID(),kind:'template',title:pair(`틀 ${state.templates.length+1}`,`Template ${state.templates.length+1}`),blocks,version:0});}
 return <section className="tool-card template-list" aria-labelledby="templates-title">
  <header><h2 id="templates-title">{pair('하루 틀','Day templates')}</h2><span className="routine-count">{state.templates.length}<span> / 10</span></span></header>
  <p className="tool-card-lead">{pair('자주 쓰는 하루 시간표를 틀로 저장해 두면, 일정이 빈 날에 한 번에 깔 수 있어요. 깔린 일정은 그날만의 보통 일정이에요.','Save a usual day as a template; an empty day can lay it down in one tap. What lands is ordinary activities for that day.')}</p>
  {state.templates.map(item=><div className="template" key={item.id}>
   <div className="template-head"><input key={item.version} defaultValue={item.title} maxLength={100} aria-label={pair('틀 이름','Template name')} onBlur={e=>{const title=e.target.value.trim();if(title&&title!==item.title)void save({...item,title});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
    <button className="routine-remove" aria-label={pair(`${item.title} 틀 지우기`,`Delete template ${item.title}`)} title={pair('지우기','Delete')} onClick={()=>{if(confirm(pair(`'${item.title}' 틀을 지울까요? 이미 깐 일정은 그대로 남아요.`,`Delete '${item.title}'? Days already filled stay.`)))void run(()=>state.remove(item));}}><X size={15}/></button></div>
   <ul>{item.blocks.map((block,i)=><li key={`${item.version}-${i}`}>
    <select aria-label={pair('시작','Start')} value={clock(block.start)} onChange={e=>void setBlock(item,i,{start:minutes(e.target.value)})}>{times(0,1430,clock(block.start)).map(t=><option key={t}>{t}</option>)}</select>
    <select aria-label={pair('종료','End')} value={clock(block.end)} onChange={e=>void setBlock(item,i,{end:minutes(e.target.value)})}>{times(10,1440,clock(block.end)).map(t=><option key={t}>{t}</option>)}</select>
    <input defaultValue={block.title} maxLength={200} aria-label={pair('일정','Activity')} onBlur={e=>{const title=e.target.value.trim();if(!title)void save({...item,blocks:item.blocks.filter((_,j)=>j!==i)});else if(title!==block.title)void setBlock(item,i,{title});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
    <button className="routine-remove" aria-label={pair(`${block.title} 빼기`,`Remove ${block.title}`)} onClick={()=>void save({...item,blocks:item.blocks.filter((_,j)=>j!==i)})}><X size={14}/></button>
   </li>)}
   {item.blocks.length<50&&<li className="routine-new"><Plus size={14} aria-hidden="true"/><input placeholder={pair('일정 추가 (Enter)','Add an activity (Enter)')} maxLength={200} aria-label={pair(`${item.title}에 일정 추가`,`Add an activity to ${item.title}`)} onKeyDown={e=>{if(e.key!=='Enter'||e.nativeEvent.isComposing)return;const title=e.currentTarget.value.trim();if(!title)return;const input=e.currentTarget,start=Math.min(1380,item.blocks.at(-1)?.end??540);void save({...item,blocks:[...item.blocks,{title,start,end:Math.min(1440,start+60)}]}).then(()=>{input.value='';});}}/></li>}</ul>
  </div>)}
  {state.templates.length<10&&<div className="template-actions">{seed&&<button className="secondary" onClick={()=>create(seed.blocks)}><Plus size={14}/>{pair(`${seed.date.slice(5).replace('-','/')} 시간표로 새 틀`,`New from ${seed.date.slice(5).replace('-','/')}`)}</button>}<button className="text-button" onClick={()=>create([])}><Plus size={14}/>{pair('빈 틀','Empty template')}</button></div>}
  {error&&<p className="error" role="alert">{error}</p>}
 </section>;
}

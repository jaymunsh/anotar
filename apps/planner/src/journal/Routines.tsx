// Routines: saved names (운동, 독서…) that the day view drops onto the timetable with one tap.
// No rules, times or targets — what lands on a day is an ordinary activity for that day only.
import {useState} from 'react';
import {Plus,X} from 'lucide-react';
import type {Routine} from '../api';
import {pair} from '../i18n';
import type {PlanningState} from './PlanningBoard';

export function RoutineList({state}:{state:PlanningState}){
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
 </section></div>;
}

// Routines: saved names (운동, 독서…) that the day view drops onto the timetable with one tap.
// No rules, times or targets — what lands on a day is an ordinary activity for that day only.
import {useState} from 'react';
import {Plus,Trash2} from 'lucide-react';
import type {Routine} from '../api';
import {pair} from '../i18n';
import type {PlanningState} from './PlanningBoard';

export function RoutineList({state}:{state:PlanningState}){
 const [name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function add(){const title=name.trim();if(!title)return;void run(async()=>{await state.save<Routine>({id:crypto.randomUUID(),kind:'routine',title,version:0});setName('');});}
 function rename(item:Routine,title:string){title=title.trim();if(title&&title!==item.title)void run(()=>state.save<Routine>({...item,title}));}
 // Its own tab under 계획 (view=routines).
 return <section className="routine-list" id="routines" aria-label={pair('루틴','Routines')}>
  <ul>{state.routines.map(item=><li key={item.id}>
   <input defaultValue={item.title} maxLength={100} aria-label={pair(`루틴 이름: ${item.title}`,`Routine name: ${item.title}`)} disabled={busy} onBlur={e=>rename(item,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
   <button aria-label={pair(`${item.title} 삭제`,`Delete ${item.title}`)} disabled={busy} onClick={()=>{if(confirm(pair(`'${item.title}' 루틴을 지울까요? 이미 넣은 일정은 그대로 남아요.`,`Delete '${item.title}'? Activities already added stay.`)))void run(()=>state.remove(item));}}><Trash2 size={15}/></button>
  </li>)}</ul>
  <form onSubmit={e=>{e.preventDefault();add();}}>
   <input value={name} maxLength={100} placeholder={pair('예: 운동, 독서, 영어 공부','e.g. Workout, Reading')} aria-label={pair('새 루틴 이름','New routine name')} onChange={e=>setName(e.target.value)}/>
   <button className="secondary" disabled={busy||!name.trim()||state.routines.length>=50}><Plus size={15}/>{pair('루틴 추가','Add routine')}</button>
  </form>
  {error&&<p className="error" role="alert">{error}</p>}
 </section>;
}

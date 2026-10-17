import {ChevronLeft,ChevronRight} from 'lucide-react';
import {Day,PlanningItem,duration} from '../api';
import {getLanguage,pair} from '../i18n';
import {tagColor} from './PlanningBoard';

const shift=(date:string,amount:number)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);};
const label=(date:string,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'ko-KR',{...options,timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));

// One week gathered from what was already written: time planned, priorities done, time per goal, the daily reviews.
// Nothing new to fill in.
export function WeeklyReview({date,days,items,today,onDate}:{date:string;days:Record<string,Day>;items:PlanningItem[];today:string;onDate:(date:string,view:'review'|'day')=>void}){
 const monday=shift(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7)),dates=Array.from({length:7},(_,i)=>shift(monday,i));
 const docs=dates.map(d=>[d,days[d]] as const).filter((entry):entry is readonly [string,Day]=>Boolean(entry[1]));
 const plans=docs.flatMap(([,doc])=>doc.plans.filter(p=>p.status!=='cancelled'));
 const planned=plans.reduce((sum,p)=>sum+p.end-p.start,0),missed=plans.filter(p=>p.status==='missed').length;
 const priorities=docs.flatMap(([,doc])=>(doc.priorities||[]).filter(p=>p.text.trim())),done=priorities.filter(p=>p.done).length;
 // Steps count toward their goal; plans not linked to anything are one line of their own.
 const goalOf=(id:string)=>{const item=items.find(i=>i.id===id);return item?.kind==='step'&&item.parentId&&items.some(i=>i.id===item.parentId)?item.parentId:item?.id;};
 const perGoal=new Map<string,number>();let unlinked=0;
 for(const p of plans){const goal=p.planningId&&goalOf(p.planningId);if(goal)perGoal.set(goal,(perGoal.get(goal)||0)+p.end-p.start);else unlinked+=p.end-p.start;}
 const rows=[...perGoal].map(([id,minutes])=>({id,title:items.find(i=>i.id===id)?.title||'',minutes})).sort((a,b)=>b.minutes-a.minutes);
 const largest=Math.max(1,unlinked,...rows.map(r=>r.minutes));
 const reviews=docs.filter(([,doc])=>doc.notes.review.trim());
 const thisWeek=dates.includes(today);
 return <section className="weekly-review" aria-label={pair('주간 돌아보기','Weekly review')}>
  <header><h2>{label(dates[0],{month:'long',day:'numeric'})} – {label(dates[6],{month:dates[0].slice(5,7)===dates[6].slice(5,7)?undefined:'long',day:'numeric'})}</h2>
   <nav><button aria-label={pair('지난주','Previous week')} onClick={()=>onDate(shift(monday,-7),'review')}><ChevronLeft size={18}/></button><button className="text-button" disabled={thisWeek} onClick={()=>onDate(today,'review')}>{pair('이번 주','This week')}</button><button aria-label={pair('다음 주','Next week')} onClick={()=>onDate(shift(monday,7),'review')}><ChevronRight size={18}/></button></nav></header>
  <dl className="weekly-stats"><div><dt>{pair('계획한 시간','Planned')}</dt><dd>{duration(planned)}</dd></div><div><dt>{pair('꼭 할 일 완료','Priorities done')}</dt><dd>{done}<small> / {priorities.length}</small></dd></div><div><dt>{pair('미이행','Unfinished')}</dt><dd>{missed}</dd></div></dl>
  <h3>{pair('목표별 시간','Time per goal')}</h3>
  {rows.length||unlinked?<ul className="weekly-goals">{rows.map(r=><li key={r.id}><span><i className="planning-context-dot" style={{background:tagColor(r.id)}}/>{r.title}</span><b>{duration(r.minutes)}</b><i className="weekly-bar" style={{width:`${r.minutes/largest*100}%`,background:tagColor(r.id)}}/></li>)}{unlinked>0&&<li className="unlinked"><span>{pair('계획에 연결하지 않은 일정','Not linked to a plan')}</span><b>{duration(unlinked)}</b><i className="weekly-bar" style={{width:`${unlinked/largest*100}%`}}/></li>}</ul>:<p className="journal-hint">{pair('이 주에는 시간표에 잡은 일정이 없어요.','Nothing on the timetable this week.')}</p>}
  <h3>{pair('하루 돌아보기','Daily reviews')}</h3>
  {reviews.length?<ul className="weekly-notes">{reviews.map(([d,doc])=><li key={d}><button onClick={()=>onDate(d,'day')}>{label(d,{month:'numeric',day:'numeric',weekday:'short'})}</button><p>{doc.notes.review}</p></li>)}</ul>:<p className="journal-hint">{pair('이 주에 쓴 하루 돌아보기가 없어요. 일간 화면 ‘하루 돌아보기’에 쓰면 여기에 모여요.','No daily reviews this week. What you write in the day view’s Daily review collects here.')}</p>}
 </section>;
}

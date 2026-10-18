import React,{useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,Clock,Target,CircleCheck,CircleAlert,TrendingDown,TrendingUp} from 'lucide-react';
import {Day,Plan,PlanningItem,clock,duration} from '../api';
import {getLanguage,pair} from '../i18n';
import {periodRange} from './period';
import {GoalFlow,colorsFor} from './PlanningBoard';
import './review.css';

type Span='week'|'month'|'year';
type Dated={date:string;plan:Plan};
const shift=(date:string,amount:number)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);};
const shiftMonths=(date:string,amount:number)=>{const d=new Date(date.slice(0,7)+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+amount);return d.toISOString().slice(0,10);};
const step=(date:string,span:Span,direction:number)=>span==='week'?shift(date,direction*7):shiftMonths(date,direction*(span==='year'?12:1));
const label=(date:string,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'ko-KR',{...options,timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
const datesBetween=(start:string,end:string)=>{const out:string[]=[];for(let d=start;d<=end;d=shift(d,1))out.push(d);return out;};
const weekdays=()=>getLanguage()==='en'?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['월','화','수','목','금','토','일'];
const weekday=(date:string)=>(new Date(date+'T12:00:00Z').getUTCDay()+6)%7;
const minutes=(plans:Dated[])=>plans.reduce((sum,{plan})=>sum+plan.end-plan.start,0);
const percent=(part:number,whole:number)=>whole?Math.round(part/whole*100):0;

function heading(span:Span,start:string,end:string){
 if(span==='year')return pair(`${start.slice(0,4)}년`,start.slice(0,4));
 if(span==='month')return label(start,{year:'numeric',month:'long'});
 return `${label(start,{month:'long',day:'numeric'})} – ${label(end,{month:start.slice(5,7)===end.slice(5,7)?undefined:'long',day:'numeric'})}`;
}

// 회고: a week, month or year gathered from what was already written — time planned, goals, rhythm, unfinished plans, daily reviews.
// Nothing new to fill in. Every number comes from the timetable (planned time), the 오늘 꼭 할 일 checks and the goal steps.
// ponytail: reads the days already loaded (the latest 400), so a year further back reads low; fetch the range if that matters.
export function Review({date,days,items,today,demo,onDate,onReplan}:{date:string;days:Record<string,Day>;items:PlanningItem[];today:string;demo?:boolean;onDate:(date:string,view:'review'|'day')=>void;onReplan:(plan:Plan)=>void}){
 const [span,setSpan]=useState<Span>('week');
 // Colours come from the items passed in, not the shared tagColor map, so this view never shows a goal grey.
 const colors=colorsFor(items),tagColor=(id:string)=>colors.get(id)||'var(--line-strong)';
 const {start,end}=periodRange(date,span),previous=periodRange(step(date,span,-1),span);
 const within=(from:string,to:string)=>Object.entries(days).filter(([d])=>d>=from&&d<=to).sort(([a],[b])=>a.localeCompare(b));
 const plansOf=(rows:[string,Day][])=>rows.flatMap(([d,doc])=>doc.plans.filter(p=>p.status!=='cancelled').map(plan=>({date:d,plan})));
 const rows=within(start,end),plans=plansOf(rows),before=plansOf(within(previous.start,previous.end));
 // Steps count toward their goal; plans not linked to anything stay unlinked.
 const goalOf=(id?:string)=>{if(!id)return undefined;const item=items.find(i=>i.id===id);return item?.kind==='step'&&item.parentId&&items.some(i=>i.id===item.parentId)?item.parentId:item?.id;};
 const goals=items.filter(i=>i.kind==='goal');
 const planned=minutes(plans),linked=minutes(plans.filter(p=>goalOf(p.plan.planningId))),missed=plans.filter(p=>p.plan.status==='missed');
 const priorities=rows.flatMap(([,doc])=>(doc.priorities||[]).filter(p=>p.text.trim())),done=priorities.filter(p=>p.done).length;
 const beforePriorities=within(previous.start,previous.end).flatMap(([,doc])=>(doc.priorities||[]).filter(p=>p.text.trim()));
 const activeDays=new Set(plans.map(p=>p.date)).size,allDays=datesBetween(start,end).length;
 const thisPeriod=today>=start&&today<=end,unit=span==='week'?pair('지난주','last week'):span==='month'?pair('지난달','last month'):pair('작년','last year');

 // Time per goal, largest first; the order also fixes each goal's place in the stacked bars.
 const perGoal=new Map<string,number>();for(const p of plans){const g=goalOf(p.plan.planningId);if(g)perGoal.set(g,(perGoal.get(g)||0)+p.plan.end-p.plan.start);}
 const goalRows=[...perGoal].map(([id,value])=>({id,title:goals.find(g=>g.id===id)?.title||'',value})).sort((a,b)=>b.value-a.value),unlinked=planned-linked;

 // Rhythm: one bar per day (week, month) or per month (year), stacked by goal.
 const buckets=span==='year'?Array.from({length:12},(_,i)=>{const m=`${start.slice(0,4)}-${String(i+1).padStart(2,'0')}`;return {key:m+'-01',from:m+'-01',to:m+'-31',name:pair(`${i+1}월`,label(m+'-01',{month:'short'})),full:label(m+'-01',{year:'numeric',month:'long'})};}):datesBetween(start,end).map(d=>({key:d,from:d,to:d,name:span==='week'?weekdays()[weekday(d)]:String(Number(d.slice(8))),full:label(d,{month:'long',day:'numeric',weekday:'short'})}));
 const rhythm=buckets.map(b=>{const inside=plans.filter(p=>p.date>=b.from&&p.date<=b.to),parts=[...goalRows.map(g=>({id:g.id,value:minutes(inside.filter(p=>goalOf(p.plan.planningId)===g.id))})),{id:'',value:minutes(inside.filter(p=>!goalOf(p.plan.planningId)))}].filter(x=>x.value>0);return {...b,parts,total:parts.reduce((s,x)=>s+x.value,0)};}),rhythmPeak=Math.max(1,...rhythm.map(b=>b.total));

 // When in the day: weekday × hour, how much was planned there over the period.
 const grid=Array.from({length:7},()=>Array(24).fill(0) as number[]);
 for(const {date:d,plan} of plans)for(let h=Math.floor(plan.start/60);h*60<plan.end&&h<24;h++)grid[weekday(d)][h]+=Math.min(plan.end,(h+1)*60)-Math.max(plan.start,h*60);
 const gridPeak=Math.max(0,...grid.flat());

 // Goals the period touches, 집중 first: time here (and against the period before) and steps done, in the goal's own colour.
 const beforeGoal=new Map<string,number>();for(const p of before){const g=goalOf(p.plan.planningId);if(g)beforeGoal.set(g,(beforeGoal.get(g)||0)+p.plan.end-p.plan.start);}
 const month=(d:string)=>d.slice(0,7),progress=goals.filter(g=>perGoal.has(g.id)||g.startMonth<=month(end)&&g.endMonth>=month(start)).map(g=>{const steps=items.filter(i=>i.kind==='step'&&i.parentId===g.id);return {goal:g,done:steps.filter(s=>s.done).length,total:steps.length,value:perGoal.get(g.id)||0,before:beforeGoal.get(g.id)||0};}).sort((a,b)=>Number(!!b.goal.focus)-Number(!!a.goal.focus)||b.value-a.value),goalPeak=Math.max(1,...progress.map(p=>p.value));

 const reviews=rows.filter(([,doc])=>doc.notes.review.trim()).reverse();
 const missedRows=[...missed].reverse();

 const hadBefore=within(previous.start,previous.end).length>0;
 const delta=(now:number,then:number,format:(n:number)=>string)=>{if(!hadBefore)return <small className="review-delta">{pair(`${unit} 기록 없음`,`nothing from ${unit}`)}</small>;if(now===then)return <small className="review-delta">{pair(`${unit}와 같아요`,`same as ${unit}`)}</small>;const up=now>then;return <small className="review-delta">{up?<TrendingUp size={13}/>:<TrendingDown size={13}/>}{pair(`${unit}보다 ${format(Math.abs(now-then))} ${up?'더':'덜'}`,`${format(Math.abs(now-then))} ${up?'more':'less'} than ${unit}`)}</small>;};
 // One sentence on top: where the time went and which goal moved most.
 const grew=hadBefore?[...progress].sort((a,b)=>(b.value-b.before)-(a.value-a.before))[0]:undefined;
 const headline=!planned?pair('이 기간에는 시간표에 잡은 일정이 없어요.','Nothing on the timetable in this period.'):<>{pair(`계획한 ${duration(planned)} 중 `,`Of ${duration(planned)} planned, `)}<b>{percent(linked,planned)}%</b>{pair('가 목표에 갔어요.',' went to goals.')}{goalRows[0]&&<> {pair('가장 많이 쓴 목표는 ','Most went to ')}<b style={{'--goal':tagColor(goalRows[0].id)} as React.CSSProperties}>{goalRows[0].title}</b>{pair(`(${duration(goalRows[0].value)})예요.`,` (${duration(goalRows[0].value)}).`)}</>}{grew&&grew.value>grew.before&&grew.goal.id!==goalRows[0]?.id&&<> <b style={{'--goal':tagColor(grew.goal.id)} as React.CSSProperties}>{grew.goal.title}</b>{pair(`은 ${unit}보다 ${duration(grew.value-grew.before)} 늘었어요.`,` grew by ${duration(grew.value-grew.before)} on ${unit}.`)}</>}</>;
 const more=<T,>(list:T[],limit:number,render:(item:T)=>React.ReactNode)=>list.length>limit?<>{list.slice(0,limit).map(render)}<details className="review-more"><summary>{pair(`${list.length-limit}개 더 보기`,`${list.length-limit} more`)}</summary>{list.slice(limit).map(render)}</details></>:list.map(render);

 return <section className="journal-review review" aria-label={pair('회고','Review')}>
  <header className="review-head">
   <div className="segmented review-span" role="group" aria-label={pair('회고 기간','Review period')}>{([['week','주','Week'],['month','달','Month'],['year','연','Year']] as const).map(([value,ko,en])=><button key={value} aria-pressed={span===value} className={span===value?'selected':''} onClick={()=>setSpan(value)}>{pair(ko,en)}</button>)}</div>
   <h2>{heading(span,start,end)}</h2>
   <nav><button aria-label={pair('이전','Previous')} onClick={()=>onDate(step(date,span,-1),'review')}><ChevronLeft size={18}/></button><button className="text-button" disabled={thisPeriod} onClick={()=>onDate(today,'review')}>{span==='week'?pair('이번 주','This week'):span==='month'?pair('이번 달','This month'):pair('올해','This year')}</button><button aria-label={pair('다음','Next')} onClick={()=>onDate(step(date,span,1),'review')}><ChevronRight size={18}/></button></nav>
  </header>

  <p className="review-headline">{headline}</p>

  <dl className="review-kpis">
   <div className="kpi-planned"><dt><i><Clock size={14}/></i>{pair('계획한 시간','Planned')}</dt><dd>{duration(planned)}</dd>{delta(planned,minutes(before),duration)}</div>
   <div className="kpi-goals"><dt><i><Target size={14}/></i>{pair('목표에 쓴 시간','On goals')}</dt><dd>{percent(linked,planned)}<small>%</small></dd>{delta(percent(linked,planned),percent(minutes(before.filter(p=>goalOf(p.plan.planningId))),minutes(before)),n=>n+'%p')}</div>
   <div className="kpi-done"><dt><i><CircleCheck size={14}/></i>{pair('꼭 할 일 완료','Priorities done')}</dt><dd>{done}<small> / {priorities.length}</small></dd>{delta(percent(done,priorities.length),percent(beforePriorities.filter(p=>p.done).length,beforePriorities.length),n=>n+'%p')}</div>
   <div className="kpi-missed"><dt><i><CircleAlert size={14}/></i>{pair('미이행','Unfinished')}</dt><dd>{missed.length}</dd>{delta(missed.length,before.filter(p=>p.plan.status==='missed').length,n=>pair(`${n}개`,String(n)))}</div>
  </dl>

  <div className="review-grid">
   <article className="review-card full">
    <h3>{pair('목표','Goals')}<small>{pair(`계획한 날 ${activeDays}/${allDays}일 · 목표 없음 ${duration(unlinked)}`,`${activeDays}/${allDays} days planned · ${duration(unlinked)} without a goal`)}</small></h3>
    {progress.length?<ul className="review-goals"><li className="review-goals-head" aria-hidden="true"><span/><span>{pair('이 기간 시간 · 비율','Time here · share')}</span><span>{pair('세부 계획 완료','Steps done')}</span><span>{hadBefore?pair(`${unit} 대비`,`vs ${unit}`):''}</span></li>{progress.map(({goal,done,total,value,before:then})=><li key={goal.id} style={{'--goal':tagColor(goal.id)} as React.CSSProperties}>
     <span className="review-goal-name"><i/>{goal.title}</span>
     <span className="review-goal-time"><span className="review-track"><i style={{width:`${value/goalPeak*100}%`}}/></span><b>{duration(value)}</b><small>{percent(value,planned)}%</small></span>
     <span className="review-goal-steps"><span className="review-track"><i style={{width:`${percent(done,total)}%`}}/></span><b>{done}/{total}</b><small>{pair('세부','steps')}</small></span>
     <small className="review-goal-delta">{hadBefore?value===then?'–':`${value>then?'+':'−'}${duration(Math.abs(value-then))}`:''}</small>
    </li>)}</ul>:<p className="journal-hint">{pair('이 기간에 걸친 목표가 없어요.','No goals cover this period.')}</p>}
   </article>

   <article className="review-card full">
    <h3>{span==='year'?pair('달마다 계획한 시간','Planned per month'):pair('날마다 계획한 시간','Planned per day')}</h3>
    <div className={`review-bars ${span}`} role="list">{rhythm.map(b=>{const text=`${b.full} · ${b.total?duration(b.total):pair('일정 없음','nothing planned')}`;return <button key={b.key} role="listitem" className={b.from<=today&&today<=b.to?'today':undefined} title={text} aria-label={text} onClick={()=>span==='year'?(setSpan('month'),onDate(b.from,'review')):onDate(b.from,'day')}><span className="review-bar" style={{height:`${b.total/rhythmPeak*100}%`}}>{b.parts.map(x=><i key={x.id||'none'} className={x.id?undefined:'unlinked'} style={{flexGrow:x.value,...(x.id?{background:tagColor(x.id)}:{})}}/>)}</span><small>{b.name}</small></button>;})}</div>
    {gridPeak>0&&<details className="review-heat-wrap"><summary>{pair('요일·시간대별로 보기','By weekday and hour')}</summary><div className="review-heat" role="table" aria-label={pair('요일과 시간대별 계획한 시간','Planned time by weekday and hour')}>
     <div role="row" className="review-heat-hours"><span/>{Array.from({length:24},(_,h)=><span role="columnheader" key={h}>{h%6===0?h:''}</span>)}</div>
     {grid.map((hours,w)=><div role="row" key={w}><span role="rowheader">{weekdays()[w]}</span>{hours.map((value,h)=>{const text=`${weekdays()[w]} ${clock(h*60)} · ${value?duration(value):pair('없음','none')}`;return <span role="cell" key={h} title={text} aria-label={text}>{value>0&&<i style={{opacity:.12+.6*value/gridPeak}}/>}</span>;})}</div>)}
    </div></details>}
   </article>

   <article className="review-card">
    <h3>{pair('다시 계획할 것','Plan again')}<small>{missed.length||''}</small></h3>
    {missedRows.length?<div className="review-missed">{more(missedRows,5,({date:d,plan})=><div className="journal-review-row" key={d+plan.id} style={goalOf(plan.planningId)?{'--goal':tagColor(goalOf(plan.planningId)!)} as React.CSSProperties:undefined}><button onClick={()=>onDate(d,'day')}><time>{label(d,{month:'numeric',day:'numeric',weekday:'short'})} · {clock(plan.start)}–{clock(plan.end)}</time><strong>{plan.title}</strong></button><button className="text-link" onClick={()=>onReplan(plan)}>{pair('오늘 다시 계획','Plan again today')}<ArrowRight size={14}/></button></div>)}</div>:<p className="journal-hint">{pair('미이행으로 표시한 계획이 없어요. 시간이 지났다고 자동으로 미이행 처리하지 않아요.','No plans marked unfinished. Nothing is marked unfinished automatically.')}</p>}
   </article>

   <article className="review-card">
    <h3>{pair('하루 돌아보기','Daily reviews')}<small>{reviews.length||''}</small></h3>
    {reviews.length?<ul className="review-notes">{more(reviews,5,([d,doc])=><li key={d}><button onClick={()=>onDate(d,'day')}>{label(d,{month:'numeric',day:'numeric',weekday:'short'})}</button><p>{doc.notes.review}</p></li>)}</ul>:<p className="journal-hint">{pair('이 기간에 쓴 하루 돌아보기가 없어요. 일간 화면 ‘하루 돌아보기’에 쓰면 여기에 모여요.','No daily reviews in this period. What you write in the day view’s Daily review collects here.')}</p>}
   </article>

   {span==='year'&&!demo&&<article className="review-card full"><GoalFlow year={start.slice(0,4)} items={items} minutes={(ids,from,to)=>minutes(plansOf(within(from,to)).filter(p=>p.plan.planningId&&ids.includes(p.plan.planningId)))}/></article>}
  </div>
 </section>;
}

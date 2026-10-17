import {useEffect,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {Day,Plan,clock,duration} from '../api';
import {getLanguage,pair} from '../i18n';
const short=(key:string)=>new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'ko-KR',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
import {Period,periodRange,summarize} from './period';
import {PeriodDiary} from './PeriodDiary';
const labels:Record<Plan['status'],[string,string]>={pending:['수행 확인 전','Not confirmed'],done:['완료','Done'],partial:['일부 수행','Partly done'],missed:['미이행','Unfinished'],deferred:['미룸 표시','Marked deferred'],cancelled:['취소','Cancelled']};
export function PeriodOverview({date,period,days,loading,error,onDate,onRetry,onMonth}:{date:string;period:Period;days:Record<string,Day>;loading:boolean;error:string;onDate:(date:string)=>void;onRetry:()=>void;onMonth:(key:string)=>void}){
 const range=periodRange(date,period),data=summarize(days,range.start,range.end),[filter,setFilter]=useState<Plan['status']|'all'>('all'),[limit,setLimit]=useState(30);
 useEffect(()=>{setFilter('all');setLimit(30);},[date,period]);
 const filtered=data.plans.filter(row=>filter==='all'||row.plan.status===filter);
 return <section className="period-overview" aria-label={pair('기간 종합 보기','Period overview')}>
 {loading?<p role="status">{pair('기간 기록을 불러오는 중…','Loading period records…')}</p>:error?<div className="notice" role="alert"><p>{pair('기간 기록을 불러오지 못했어요. 합계를 표시하기 전에 다시 확인해 주세요.','Couldn’t load this period. Retry before viewing totals.')}</p><button className="secondary" onClick={onRetry}>{pair('다시 불러오기','Retry')}</button></div>:<>
 <div className="period-head">{period==='week'?<h2>{short(range.start)} – {short(range.end)}</h2>:<span/>}<dl className="period-totals"><div><dt>{pair('계획 합계','Planned total')}</dt><dd>{duration(data.planned)}</dd></div><div><dt>{pair('체크한 오늘 할 일','Daily priorities checked')}</dt><dd>{data.prioritiesDone} / {data.priorities}</dd></div></dl></div>
 <PeriodDiary date={date} period={period} days={days} onDate={onDate} onMonth={onMonth}/>
 <details className="period-status-details"><summary>{pair('상태별 항목 보기','View items by status')} · {pair('미이행','Unfinished')} {data.counts.missed} · {pair('미룸','Deferred')} {data.counts.deferred}</summary>
 <nav className="period-filters" aria-label={pair('수행 상태 필터','Filter by status')}><button aria-pressed={filter==='all'} onClick={()=>{setFilter('all');setLimit(30);}}>{pair('전체','All')} <strong>{data.plans.length}</strong></button>{(['done','partial','missed','deferred','pending','cancelled'] as const).map(status=><button key={status} className={status} aria-pressed={filter===status} onClick={()=>{setFilter(status);setLimit(30);}}>{status==='done'?pair('수행 표시','Marked performed'):pair(...labels[status])} <strong>{data.counts[status]}</strong></button>)}</nav>
 <p className="journal-hint">{pair('미이행·미룸은 직접 표시한 상태예요. 미룸 횟수나 이동 이력은 아직 기록하지 않아요. 예정·미확인 항목을 자동으로 실패 처리하지 않아요.','Unfinished and deferred are manually marked states. Deferral counts and move history are not yet tracked. Unconfirmed plans are never automatically marked failed.')}</p>
 <div className="period-plan-list">{!filtered.length&&<p className="empty-state">{pair('해당 상태로 표시한 항목이 없어요.','No items with this status.')}</p>}{filtered.slice(0,limit).map(({date:key,plan})=><button key={key+plan.id} onClick={()=>onDate(key)}><time>{key} · {clock(plan.start)}–{clock(plan.end)}</time><strong>{plan.title}</strong><small>{plan.status==='done'?pair('수행 표시','Marked performed'):pair(...labels[plan.status])}</small><ChevronRight size={16}/></button>)}{filtered.length>limit&&<button className="text-link" onClick={()=>setLimit(limit+30)}>{pair('30개 더 보기','Show 30 more')}</button>}</div>
 </details>
 
 {!data.recordedDays&&<p className="empty-state">{pair('이 기간에 저장한 기록이 없어요. 날짜를 눌러 계획을 시작해 보세요.','No saved records for this period. Choose a date to start planning.')}</p>}
 </>}
 </section>;
}

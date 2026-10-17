import {Day,duration} from '../api';
import {getLanguage,pair} from '../i18n';
const short=(key:string)=>new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'ko-KR',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
import {Period,periodRange,summarize} from './period';
import {PeriodDiary} from './PeriodDiary';
export function PeriodOverview({date,period,days,loading,error,onDate,onRetry,onMonth}:{date:string;period:Period;days:Record<string,Day>;loading:boolean;error:string;onDate:(date:string)=>void;onRetry:()=>void;onMonth:(key:string)=>void}){
 const range=periodRange(date,period),data=summarize(days,range.start,range.end);
 return <section className="period-overview" aria-label={pair('기간 종합 보기','Period overview')}>
 {loading?<p role="status">{pair('기간 기록을 불러오는 중…','Loading period records…')}</p>:error?<div className="notice" role="alert"><p>{pair('기간 기록을 불러오지 못했어요. 합계를 표시하기 전에 다시 확인해 주세요.','Couldn’t load this period. Retry before viewing totals.')}</p><button className="secondary" onClick={onRetry}>{pair('다시 불러오기','Retry')}</button></div>:<>
 <div className="period-head">{period==='week'?<h2>{short(range.start)} – {short(range.end)}</h2>:<span/>}<dl className="period-totals"><div><dt>{pair('계획 합계','Planned total')}</dt><dd>{duration(data.planned)}</dd></div><div><dt>{pair('체크한 오늘 할 일','Daily priorities checked')}</dt><dd>{data.prioritiesDone} / {data.priorities}</dd></div></dl></div>
 <PeriodDiary date={date} period={period} days={days} onDate={onDate} onMonth={onMonth}/>
 
 {!data.recordedDays&&<p className="empty-state">{pair('이 기간에 저장한 기록이 없어요. 날짜를 눌러 계획을 시작해 보세요.','No saved records for this period. Choose a date to start planning.')}</p>}
 </>}
 </section>;
}

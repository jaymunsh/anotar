import {pair} from './i18n';

// Public how-to. Keep it in step with the app: when a feature changes, change its paragraph here.
export function Guide(){
 const keys:[string,string,string][]=[['← / →','이전 · 다음 날 (주간·월간은 이전 · 다음 주·달)','Previous / next day (week or month in those views)'],['T','오늘로 이동','Go to today'],['N','새 일정 (오늘이면 지금 이후 첫 빈 30분)','New plan (today: the next free 30 minutes)'],['Enter','할 일 칸에서 다음 줄로','Next row in today’s priorities']];
 return <article className="legal-page guide-page">
  <a href="/">{pair('서비스 소개로','Back to home')}</a>
  <h1>{pair('사용 안내','How anotar works')}</h1>
  <p>{pair('anotar는 하루를 시간으로 계획하는 플래너예요. 생각을 비우고, 꼭 할 일을 고르고, 그 일을 시간표에 놓는 순서로 써요.','anotar is a planner for laying out your day in time. Empty your head, pick what must get done, and give it a place on the timetable.')}</p>
  <figure><img src="/guide/day.png" alt={pair('일간 화면: 왼쪽에 오늘 꼭 할 일과 메모, 오른쪽에 하루 시간표','Day view: priorities and notes on the left, timetable on the right')} width="1280" height="820" loading="lazy"/><figcaption>{pair('일간 화면 (체험용 예시)','Day view (demo data)')}</figcaption></figure>

  <h2>{pair('하루 쓰는 순서','A day, step by step')}</h2>
  <ol>
   <li><strong>{pair('머릿속 생각','Thoughts')}</strong> — {pair('해야 할 일, 걱정, 떠오른 것을 정리하지 말고 전부 적어요.','Write down everything on your mind without sorting it.')}</li>
   <li><strong>{pair('오늘 꼭 할 일','Today’s priorities')}</strong> — {pair('그중 오늘 꼭 끝낼 3가지를 골라요. 더 있으면 4번부터 작게 이어 적어요.','Pick the three things that must get done today. Anything else goes from row 4, smaller.')}</li>
   <li><strong>{pair('하루 시간표','Timetable')}</strong> — {pair('할 일을 시간표로 끌어 놓거나 ‘시간 잡기’를 눌러 시간을 정해요. 시간이 잡힌 할 일 옆에는 시작 시각이 보여요.','Drag a task onto the timetable or choose Set time. A task with a time shows its start time.')}</li>
   <li><strong>{pair('하루 돌아보기','Daily review')}</strong> — {pair('하루 끝에 잘된 점, 계획이 달라진 이유, 내일 바꿀 것을 적어요.','At the end of the day, note what went well, why plans changed, and what to change tomorrow.')}</li>
  </ol>

  <h2>{pair('오늘 꼭 할 일','Today’s priorities')}</h2>
  <ul>
   <li>{pair('체크하면 끝난 일이 되고, 그 일에 연결된 시간표 블록도 흐려져요.','Checking a task marks it done and fades its blocks on the timetable.')}</li>
   <li>{pair('줄 끝의 ×로 할 일도 세부 할 일도 지워요. 내용을 지워도 할 일이 지워지고, 1–3번 자리는 빈 칸으로 남아요.','The × at a row’s end deletes a task or step. Clearing the text also removes a task; slots 1–3 stay as blanks.')}</li>
   <li>{pair('긴 제목은 한 줄로 줄여 보여요. 제목 옆 ‘펼치기’를 누르면 모든 할 일의 제목과 세부 할 일이 한 번에 펼쳐져요.','Long titles are cut to one line. Expand, next to the heading, shows every title in full and opens all steps.')}</li>
   <li>{pair('할 일 줄 끝의 목록 아이콘을 누르면 아래에 세부 할 일을 적을 수 있어요. 평소엔 접혀 있고 ‘1/3’처럼 개수만 보여요. 세부 할 일을 다 해도 할 일은 직접 체크해요.','The list icon at the end of a task opens steps under it. They stay folded, showing a count like “1/3”. Finishing every step doesn’t check the task for you.')}</li>
   <li>{pair('하나의 할 일을 여러 번에 나눠 해도 돼요. 시간을 여러 번 잡으면 ‘09:00 +1’처럼 보여요.','A task can be split across several blocks; it then shows like “09:00 +1”.')}</li>
   <li>{pair('어제 못 한 일이 있으면 제목 바로 옆 ‘어제 N개’를 눌러 가져와요. 일정이 빈 날에는 최근 날의 일정을 가져올 수 있어요.','Unfinished tasks from yesterday come over with the “N from yesterday” button. An empty day can copy the most recent day’s schedule.')}</li>
  </ul>

  <h2>{pair('하루 시간표','Timetable')}</h2>
  <ul>
   <li>{pair('한 줄이 한 시간, 한 칸이 10분이에요. 빈 칸을 누르면 그 시각에 새 일정이 생기고, 블록을 누르면 고칠 수 있어요.','Each row is an hour and each cell 10 minutes. Click an empty cell for a new plan; click a block to edit it.')}</li>
   <li>{pair('마우스로 블록을 끌어 옮기고, 블록 오른쪽 끝을 끌어 길이를 바꿔요. 10분 단위로 맞춰지고, 뒤 일정과 겹치면 그 일정이 밀려요. 자정을 넘는 일은 일정 창의 종료에서 ‘다음 날 01:00’(또는 다음 날 화면에서 시작을 ‘전날 23:00’)처럼 고르면 두 날짜에 나뉘어 들어가고, 이어지는 쪽 끝에 ‹ › 표시가 붙어요.','Drag a block to move it, drag its right edge to change its length, in 10-minute steps. Overlapped later activities move along. For something past midnight, pick an end like “Next day 01:00”: (or a start like “Day before 23:00”): it is saved on both days, with ‹ › at the joined ends.')}</li>
   <li>{pair('오늘을 볼 때는 빨간 선이 지금 시각이에요. 지금 하고 있어야 할 일정은 노란색으로 강조돼요. 계획이 밀렸으면 일정 창의 ‘미루기 +10분·+30분·+1시간’을 눌러요. 겹치게 되는 뒤 일정만 함께 밀리고, 24:00을 넘기지는 않아요.','When viewing today, the red line is now, and the block in progress is outlined. The block under way is highlighted; running late? In its dialog, Push back +10/+30/+1 hr moves it, and only the later activities it would overlap, never past midnight.')}</li>
   <li>{pair('‘하루’와 ‘목록’ 보기를 바꿀 수 있어요. 폰은 목록으로 시작해요.','Switch between Day and List. Phones start with the list.')}</li>
   <li>{pair('블록마다 완료를 표시할 필요는 없어요. 끝난 건 할 일 체크로 충분하고, 못 한 일정만 블록에 마우스를 올려 ×를 누르거나 일정 창에서 ‘미이행’ 버튼을 눌러요. 취소선으로 표시돼요.','You don’t need to mark each block. Checking tasks is enough; for a plan you skipped, hover it and press × or press Unfinished in its window. It gets a strike-through.')}</li>
  </ul>

  <h2>{pair('계획과 루틴','Plans and routines')}</h2>
  <ul>
   <li>{pair('‘계획 > 목표’에서 그해 목표를 카드로 만들고, 제목 아래에 끝났을 때 모습을 한 줄 적은 뒤 끝내야 할 세부 계획을 체크리스트로 적어요. 핀을 눌러 지금 집중하는 목표를 정하면 맨 앞에 놓여요. 목표 색(16가지)은 점을 눌러 고르고, 연결한 시간표 블록도 같은 색이에요.','Under Plans > Goals, each goal for the year is a card: a line on what done looks like, then the steps that finish it. Pin the goals you are focusing on; they come first. Tap the dot to pick one of 16 colours; linked timetable blocks share it.')}</li>
   <li>{pair('일간 화면 위 ‘집중’에 핀을 꽂은 목표와 그 목표의 다음 할 일이 보여요. 누르면 끝났을 때 모습, 남은 세부 계획(+를 누르면 시간표에 넣기), 이번 주 시간표에 잡은 시간이 나와요. 넣은 일정에는 그 목표의 색 띠가 붙어요.','“Focus” above the day view shows your pinned goals, each with its next step. Open one to see what done looks like, its open steps (+ puts one on the timetable) and time scheduled this week; linked blocks get the goal’s colour.')}</li>
   <li>{pair('루틴은 자주 하는 일의 이름이에요. 계획 메뉴의 ‘편의’ 탭 루틴 카드에서 만들고, 일정 화면 위 루틴을 누르면 바로 시간표에 들어가요. 같은 탭의 ‘하루 틀’에는 시간까지 정한 하루 시간표를 저장해 두고, ‘하루 시간표’ 옆 틀 아이콘으로 한 번에 깔거나(빈 날엔 시간표 위 버튼도 있어요), 그날 시간표를 틀로 저장해요.','Routines are names of things you do often. Create them on the Tools tab under Plans; tap one above the schedule to add it. Day templates in the same tab save a whole timed day; an empty day lays one down in one tap.')}</li>
  </ul>

  <h2>{pair('주간 · 월간 · 회고','Week, month and review')}</h2>
  <ul>
   <li>{pair('주간·월간은 그 기간의 기록을 한눈에 보여 줘요. 날짜를 누르면 그날로 가요. 월간 칸에는 계획한 시간, 꼭 할 일 완료(✓ 2/3), 일정 3개까지가 보여요. 계획에 연결된 일정에는 그 계획 색 띠가 붙어요.','Week and Month show the period at a glance; click a date to open that day. A month cell shows time planned, priorities done (✓ 2/3) and up to three plans; plans linked to a goal carry its color.')}</li>
   <li>{pair('회고는 한 주를 모아 보여 줘요: 계획한 시간, 꼭 할 일 완료, 목표별 시간, 그 주에 쓴 하루 돌아보기, 그리고 올해 달마다 목표별로 쓴 시간(올해 흐름). 따로 적을 건 없어요. 아래에는 미이행으로 표시한 계획이 있고 바로 다시 계획할 수 있어요.','Review gathers a week: time planned, priorities done, time per goal, that week’s daily reviews and the year’s time per goal by month, with nothing extra to fill in. Below are plans you marked unfinished, ready to plan again.')}</li>
  </ul>

  <h2>{pair('단축키','Keyboard shortcuts')}</h2>
  <p>{pair('입력 칸 밖에서 눌러요.','Use them outside text fields.')}</p>
  <table><tbody>{keys.map(([key,ko,en])=><tr key={key}><td><kbd>{key}</kbd></td><td>{pair(ko,en)}</td></tr>)}</tbody></table>

  <h2>{pair('기록 보관','Your records')}</h2>
  <p>{pair('설정에서 모든 기록을 파일로 내보낼 수 있어요.','You can export all your records as a file from Settings.')}</p>
  <p><a href="/demo">{pair('시간표 체험해 보기','Try the timetable')}</a> · <a href="/signup">{pair('시작하기','Get started')}</a></p>
 </article>;
}

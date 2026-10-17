import {pair} from './i18n';

// Public how-to. Keep it in step with the app: when a feature changes, change its paragraph here.
export function Guide(){
 const keys:[string,string,string][]=[['← / →','이전 · 다음 날 (주간·월간은 이전 · 다음 주·달)','Previous / next day (week or month in those views)'],['T','오늘로 이동','Go to today'],['N','새 일정 (오늘이면 지금 이후 첫 빈 30분)','New plan (today: the next free 30 minutes)'],['Enter','할 일 칸에서 다음 줄로','Next row in today’s priorities']];
 return <article className="legal-page guide-page">
  <a href="/">{pair('서비스 소개로','Back to home')}</a>
  <h1>{pair('사용 안내','How anotar works')}</h1>
  <p>{pair('anotar는 하루를 시간으로 계획하는 플래너예요. 생각을 비우고, 꼭 할 일을 고르고, 그 일을 시간표에 놓는 순서로 써요.','anotar is a planner for laying out your day in time. Empty your head, pick what must get done, and give it a place on the timetable.')}</p>
  <figure><img src="/guide/day.png" alt={pair('일간 화면: 왼쪽 오늘 꼭 할 일, 가운데 머릿속 생각, 오른쪽 하루 시간표','Day view: priorities on the left, thoughts in the middle, timetable on the right')} width="1280" height="820" loading="lazy"/><figcaption>{pair('일간 화면 (체험용 예시)','Day view (demo data)')}</figcaption></figure>

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
   <li>{pair('내용을 지우면 할 일도 지워져요. 1–3번은 빈 칸으로 남아요.','Clearing a task removes it. Rows 1–3 stay as blank slots.')}</li>
   <li>{pair('하나의 할 일을 여러 번에 나눠 해도 돼요. 시간을 여러 번 잡으면 ‘09:00 +1’처럼 보여요.','A task can be split across several blocks; it then shows like “09:00 +1”.')}</li>
   <li>{pair('어제 못 한 일이 있으면 제목 옆 ‘어제 N개’를 눌러 가져와요. 일정이 빈 날에는 최근 날의 일정을 가져올 수 있어요.','Unfinished tasks from yesterday come over with the “N from yesterday” button. An empty day can copy the most recent day’s schedule.')}</li>
  </ul>

  <h2>{pair('하루 시간표','Timetable')}</h2>
  <ul>
   <li>{pair('한 줄이 한 시간, 한 칸이 10분이에요. 빈 칸을 누르면 그 시각에 새 일정이 생기고, 블록을 누르면 고칠 수 있어요.','Each row is an hour and each cell 10 minutes. Click an empty cell for a new plan; click a block to edit it.')}</li>
   <li>{pair('마우스로 블록을 끌어 옮기고, 블록 오른쪽 끝을 끌어 길이를 바꿔요. 10분 단위로 맞춰져요.','Drag a block to move it, drag its right edge to change its length, in 10-minute steps.')}</li>
   <li>{pair('오늘을 볼 때는 빨간 선이 지금 시각이에요. 지금 하고 있어야 할 일정은 테두리로 강조돼요.','When viewing today, the red line is now, and the block in progress is outlined.')}</li>
   <li>{pair('‘하루’와 ‘목록’ 보기를 바꿀 수 있어요. 폰은 목록으로 시작해요.','Switch between Day and List. Phones start with the list.')}</li>
   <li>{pair('블록마다 완료를 표시할 필요는 없어요. 끝난 건 할 일 체크로 충분하고, 못 한 일정만 블록에 마우스를 올려 ×를 누르거나 일정 창에서 ‘미이행’을 체크해요. 취소선으로 표시돼요.','You don’t need to mark each block. Checking tasks is enough; for a plan you skipped, hover it and press × or tick Unfinished in its window. It gets a strike-through.')}</li>
  </ul>

  <h2>{pair('계획과 루틴','Plans and routines')}</h2>
  <ul>
   <li>{pair('‘계획’ 메뉴에서 분기·연간 목표와 달마다의 세부 계획을 적어요. 달마다 목표별로 묶여 보이고, 각 계획 옆에는 그 계획에 연결해 시간표에 잡은 시간이 보여요. 0분이면 아직 시간을 쓰지 않은 계획이에요.','Under Plans, write quarterly or yearly goals and monthly steps. Each month groups steps by goal and shows the time scheduled for each; 0 min means nothing yet.')}</li>
   <li>{pair('일정 화면 위 ‘이번 기간’에 지금 기간의 계획이 보여요. 누르면 상위 목표, 이번 주 시간표에 잡은 시간, ‘시간표에 넣기’가 나와요. 넣은 일정에는 그 계획의 색 띠가 붙어요.','“This period” above the schedule lists current plans. Open one to see its goal, time scheduled this week, and Add to schedule; linked blocks get the plan’s color.')}</li>
   <li>{pair('루틴은 자주 하는 일의 이름이에요. 계획 메뉴의 ‘루틴’ 탭에서 만들고, 일정 화면 위 루틴을 누르면 바로 시간표에 들어가요.','Routines are names of things you do often. Create them at the bottom of Plans; tap one above the schedule to add it.')}</li>
  </ul>

  <h2>{pair('주간 · 월간 · 되짚어보기','Week, month and review')}</h2>
  <ul>
   <li>{pair('주간·월간은 그 기간의 기록을 한눈에 보여 줘요. 날짜를 누르면 그날로 가요. 월간 칸에는 계획한 시간, 꼭 할 일 완료(✓ 2/3), 일정 3개까지가 보여요. 계획에 연결된 일정에는 그 계획 색 띠가 붙어요.','Week and Month show the period at a glance; click a date to open that day. A month cell shows time planned, priorities done (✓ 2/3) and up to three plans; plans linked to a goal carry its color.')}</li>
   <li>{pair('되짚어보기는 한 주를 모아 보여 줘요: 계획한 시간, 꼭 할 일 완료, 목표별 시간, 그 주에 쓴 하루 돌아보기. 따로 적을 건 없어요. 아래에는 미이행으로 표시한 계획이 있고 바로 다시 계획할 수 있어요.','Review gathers a week: time planned, priorities done, time per goal and that week’s daily reviews, with nothing extra to fill in. Below are plans you marked unfinished, ready to plan again.')}</li>
  </ul>

  <h2>{pair('단축키','Keyboard shortcuts')}</h2>
  <p>{pair('입력 칸 밖에서 눌러요.','Use them outside text fields.')}</p>
  <table><tbody>{keys.map(([key,ko,en])=><tr key={key}><td><kbd>{key}</kbd></td><td>{pair(ko,en)}</td></tr>)}</tbody></table>

  <h2>{pair('기록 보관','Your records')}</h2>
  <p>{pair('설정에서 모든 기록을 파일로 내보낼 수 있어요.','You can export all your records as a file from Settings.')}</p>
  <p><a href="/demo">{pair('시간표 체험해 보기','Try the timetable')}</a> · <a href="/signup">{pair('시작하기','Get started')}</a></p>
 </article>;
}

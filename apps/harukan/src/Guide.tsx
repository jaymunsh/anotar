import {pair} from './i18n';

// Public how-to, set out as a first day to follow: five steps, each with a picture of the real screen.
// The landing page (/) says what harukan is for; this page shows how to use it. Details live in the folded groups below.
// Pictures: scripts/guide-shots.mjs (sample season, rerun when a screen changes). Keep each paragraph in step with the app.
type Shot={src:string;w:number;h:number;ko:string;en:string};
const steps:{id:string;where:[string,string];title:[string,string];lede:[string,string];shot?:Shot;extra?:Shot;todo:[string,string][];tip?:[string,string]}[]=[
 {id:'goals',where:['계획 › 목표','Plans › Goals'],title:['올해 목표를 세워요','Set this year’s goals'],
  lede:['목표는 몇 달 걸리는 큰 일이에요. 끝났을 때 모습을 한 줄로 적고, 끝내려면 할 일을 세부 계획으로 나눠요.','A goal is something that takes months. Write one line on what done looks like, then split it into steps.'],
  shot:{src:'/guide/step-plans.png',w:2336,h:778,ko:'목표 카드 두 장: 제목, 끝났을 때 모습, 진행 막대, 세부 계획 체크리스트',en:'Two goal cards: title, what done looks like, a progress bar and a checklist of steps'},
  todo:[['‘목표 추가’를 누르고 제목과 끝났을 때 모습을 적어요.','Press Add goal, then write a title and what done looks like.'],['‘세부 계획 추가’로 끝내야 할 일을 적어요. 끝나면 체크해요.','Add the steps that finish it with Add a step, and check them off as you go.'],['카드 왼쪽 점을 눌러 색을 고르고, 핀을 눌러 지금 집중할 목표를 정해요.','Tap the dot to pick a colour; pin the goals you are focusing on now.']],
  tip:['목표 없이 바로 2단계부터 써도 돼요. 나중에 만들어도 지난 일정을 목표에 연결할 수 있어요.','You can skip this and start at step 2; past activities can be linked to a goal later.']},
 {id:'today',where:['일정 › 일간 · 왼쪽','Schedule › Day · left side'],title:['오늘 꼭 할 일을 골라요','Pick today’s priorities'],
  lede:['머릿속에 있는 걸 먼저 다 꺼내 놓고, 그중 오늘 꼭 끝낼 것만 위로 올려요.','Empty your head first, then lift out only what must get done today.'],
  shot:{src:'/guide/step-today.png',w:840,h:1240,ko:'일간 화면 왼쪽: 오늘 꼭 할 일 세 줄과 시작 시각, 아래에 머릿속 생각·아이디어·하루 돌아보기 칸',en:'Left side of the day view: three priorities with start times, then the thoughts, ideas and daily review boxes'},
  todo:[['‘머릿속 생각’에 해야 할 일, 걱정, 떠오른 것을 정리하지 말고 적어요.','Write everything on your mind into On my mind, without sorting it.'],['그중 오늘 꼭 끝낼 3가지를 ‘오늘 꼭 할 일’ 1–3번에 적어요. 더 있으면 4번부터 작게 이어져요.','Put the three that must get done today in rows 1–3 of Today’s priorities; more go from row 4, smaller.'],['어제 못 한 일이 있으면 제목 옆 ‘어제 N개’를 눌러 그대로 가져와요.','Left something yesterday? The “N from yesterday” button brings it over.']]},
 {id:'timetable',where:['일정 › 일간 · 오른쪽','Schedule › Day · right side'],title:['할 일을 시간표에 놓아요','Give each task a time'],
  lede:['한 줄이 한 시간, 한 칸이 10분이에요. 꼭 할 일에 시간을 주면 하루가 실제로 들어가는지 보여요.','Each row is an hour and each cell 10 minutes. Giving priorities a time shows whether the day really fits.'],
  shot:{src:'/guide/step-timetable.png',w:1480,h:852,ko:'하루 시간표 05시–24시: 블록마다 제목과 시간, 목표에 연결된 블록은 왼쪽에 목표 색 막대',en:'Timetable 05:00–24:00: each block shows its title and time; blocks linked to a goal carry the goal colour at the left'},
  extra:{src:'/guide/step-focus.png',w:2288,h:84,ko:'시간표 위 줄: 집중 목표 두 개와 다음 세부 계획, 오른쪽에 루틴 버튼',en:'The row above the timetable: two focus goals with their next step, routines on the right'},
  todo:[['할 일을 시간표로 끌어 놓거나, 빈 칸을 눌러 새 일정을 만들어요. 블록은 끌어서 옮기고 오른쪽 끝을 끌어 늘려요.','Drag a task onto the timetable or click an empty cell. Drag a block to move it, its right edge to resize it.'],['일정 창의 ‘연결할 계획’에서 목표나 세부 계획을 고르면 블록에 목표 색이 붙고, 회고에 그 목표의 시간으로 쌓여요.','Choose a goal or step under Related plan in the dialog: the block takes the goal’s colour and its time counts toward that goal in Review.'],['위 줄의 ‘집중’에서 목표의 남은 세부 계획을 바로 넣고, ‘루틴’으로 자주 하는 일을 한 번에 넣어요.','Use Focus in the row above to schedule a goal’s next steps, and Routines for things you do often.']],
  tip:['매일 비슷한 하루라면 시간표 옆 틀 아이콘으로 ‘하루 틀’을 저장해 두고, 빈 날에 한 번에 깔아요.','If your days look alike, save one as a day template from the icon beside the timetable and lay it down on an empty day.']},
 {id:'evening',where:['일정 › 일간','Schedule › Day'],title:['하루 끝에 체크하고 돌아봐요','Check off and look back at night'],
  lede:['완료를 블록마다 표시할 필요는 없어요. 할 일 목록 체크로 충분하고, 못 한 일정만 따로 표시해요.','No need to mark every block. Checking priorities is enough; mark only what didn’t happen.'],
  todo:[['끝낸 꼭 할 일을 체크해요.','Check the priorities you finished.'],['못 한 일정은 블록에 마우스를 올려 ×를 누르거나 일정 창의 ‘미이행’을 눌러요. 회고의 ‘다시 계획할 것’에 모여요.','For a plan that didn’t happen, hover the block and press ×, or press Unfinished in its dialog. It shows up under “Plan again” in Review.'],['‘하루 돌아보기’에 잘된 점, 계획이 달라진 이유, 내일 바꿀 것을 한두 줄 적어요.','Write a line or two in Day in review: what went well, why plans changed, what to change tomorrow.']]},
 {id:'review',where:['회고','Review'],title:['주말에 한 주를 돌아봐요','Look back at the week'],
  lede:['따로 적을 건 없어요. 시간표와 체크가 모여 어느 목표에 시간을 썼는지 보여 줘요.','Nothing extra to fill in: your timetable and checks add up to where the time went.'],
  shot:{src:'/guide/step-review.png',w:2336,h:756,ko:'주간 회고: 한 문장 요약, 계획한 시간·목표에 쓴 비율·꼭 할 일 완료·미이행, 목표마다 시간과 세부 계획 진행',en:'Weekly review: a one-line summary, planned time, share on goals, priorities done and unfinished, then each goal’s time and step progress'},
  todo:[['위의 주 · 달 · 연을 바꿔 가며 지난 기간과 비교해요.','Switch between week, month and year to compare with the period before.'],['‘다시 계획할 것’에서 못 한 일을 골라 다른 날에 다시 놓아요.','Pick items from Plan again and put them on another day.'],['‘기록’ 탭에서 그 기간의 꼭 할 일·생각·하루 돌아보기를 날짜별로 다시 읽어요.','The Records tab gathers that period’s priorities, thoughts and daily reviews by date.']]},
];
const picture=(shot:Shot)=><img src={shot.src} alt={pair(shot.ko,shot.en)} width={shot.w/2} height={shot.h/2} loading="lazy"/>;

export function Guide(){
 const keys:[string,string,string][]=[['← / →','이전 · 다음 날 (주간·월간은 이전 · 다음 주·달)','Previous / next day (week or month in those views)'],['T','오늘로 이동','Go to today'],['N','새 일정 (오늘이면 지금 이후 첫 빈 30분)','New plan (today: the next free 30 minutes)'],['Enter','할 일 칸에서 다음 줄로','Next row in today’s priorities']];
 return <article className="legal-page guide-page">
  <a href="/">{pair('서비스 소개로','Back to home')}</a>
  <h1>{pair('사용 안내','How to use harukan')}</h1>
  <p className="guide-lede">{pair('처음 쓰는 날, 아래 다섯 단계를 차례로 따라 해 보세요. harukan이 무엇인지는 첫 화면에서, 여기서는 실제로 어떻게 쓰는지를 화면과 함께 보여 줘요.','Follow these five steps on your first day. The home page says what harukan is for; this page shows, screen by screen, how to use it.')}</p>
  <figure className="guide-hero">{picture({src:'/guide/day.png',w:2512,h:1536,ko:'일간 화면 전체: 위에 날짜와 집중 목표, 왼쪽에 오늘 꼭 할 일과 메모, 오른쪽에 하루 24시간 시간표',en:'The whole day view: date and focus goals on top, priorities and notes on the left, the 24-hour timetable on the right'})}<figcaption>{pair('매일 쓰는 일간 화면 (예시 데이터)','The day view you use every day (sample data)')}</figcaption></figure>
  <nav className="guide-steps-nav" aria-label={pair('단계','Steps')}><ol>{steps.map((step,i)=><li key={step.id}><a href={'#'+step.id}><span>{i+1}</span>{pair(...step.title)}</a></li>)}</ol></nav>

  {steps.map((step,i)=><section className="guide-step" id={step.id} key={step.id} aria-labelledby={step.id+'-title'}>
   <header><span className="guide-step-number" aria-hidden="true">{i+1}</span><div><small>{pair(...step.where)}</small><h2 id={step.id+'-title'}>{pair(...step.title)}</h2></div></header>
   <p>{pair(...step.lede)}</p>
   {step.extra&&<figure className="guide-strip">{picture(step.extra)}</figure>}
   {step.shot&&<figure className={step.shot.w<step.shot.h?'guide-tall':undefined}>{picture(step.shot)}</figure>}
   <ol className="guide-todo">{step.todo.map(([ko,en])=><li key={ko}>{pair(ko,en)}</li>)}</ol>
   {step.tip&&<p className="guide-tip">{pair(...step.tip)}</p>}
  </section>)}

  <h2 className="guide-more-title">{pair('더 알아 두면 좋은 것','Good to know')}</h2>
  <details className="guide-more"><summary>{pair('오늘 꼭 할 일','Today’s priorities')}</summary>
  <ul>
   <li>{pair('끝낸 일은 체크해요. 완료는 할 일 목록에만 표시되고, 시간표 블록은 그대로예요.','Check a task when it’s done. Done shows in the list only; its timetable blocks stay as they are.')}</li>
   <li>{pair('줄 끝의 ×로 할 일도 세부 할 일도 지워요. 내용을 지워도 할 일이 지워지고, 1–3번 자리는 빈 칸으로 남아요.','The × at a row’s end deletes a task or step. Clearing the text also removes a task; slots 1–3 stay as blanks.')}</li>
   <li>{pair('긴 제목은 한 줄로 줄여 보여요. 제목 옆 ‘펼치기’를 누르면 모든 할 일의 제목과 세부 할 일이 한 번에 펼쳐져요.','Long titles are cut to one line. Expand, next to the heading, shows every title in full and opens all steps.')}</li>
   <li>{pair('할 일 줄 끝의 목록 아이콘을 누르면 아래에 세부 할 일을 적을 수 있어요. 평소엔 접혀 있고 ‘1/3’처럼 개수만 보여요. 세부 할 일을 다 해도 할 일은 직접 체크해요.','The list icon at the end of a task opens steps under it. They stay folded, showing a count like “1/3”. Finishing every step doesn’t check the task for you.')}</li>
   <li>{pair('하나의 할 일을 여러 번에 나눠 해도 돼요. 시간을 여러 번 잡으면 ‘09:00 +1’처럼 보여요.','A task can be split across several blocks; it then shows like “09:00 +1”.')}</li>
   <li>{pair('못 끝낸 일이 있으면 제목 옆 ‘어제 N개’(어제 쓰지 않았으면 마지막으로 쓴 날짜)를 눌러 가져와요. 일정이 빈 날에는 시간표 위 버튼으로 최근 날의 일정을 가져오거나 하루 틀을 깔 수 있어요.','Unfinished tasks come over with the “N from yesterday” button next to the heading (it names the last day you wrote, if not yesterday). On an empty day, buttons above the timetable copy the most recent day’s schedule or lay down a day template.')}</li>
  </ul>
  </details>
  <details className="guide-more"><summary>{pair('하루 시간표','Timetable')}</summary>
  <ul>
   <li>{pair('한 줄이 한 시간, 한 칸이 10분이에요. 빈 칸을 누르면 그 시각에 새 일정이 생기고, 블록을 누르면 고칠 수 있어요.','Each row is an hour and each cell 10 minutes. Click an empty cell for a new plan; click a block to edit it.')}</li>
   <li>{pair('마우스로 블록을 끌어 옮기고, 블록 오른쪽 끝을 끌어 길이를 바꿔요. 10분 단위로 맞춰지고, 뒤 일정과 겹치면 그 일정이 밀려요. 자정을 넘는 일은 일정 창의 종료에서 ‘다음 날 01:00’(또는 다음 날 화면에서 시작을 ‘전날 23:00’)처럼 고르면 두 날짜에 나뉘어 들어가고, 이어지는 쪽 끝에 ‹ › 표시가 붙어요.','Drag a block to move it, drag its right edge to change its length, in 10-minute steps. Later activities it would overlap move along. For something past midnight, pick an end like “Next day 01:00” in the dialog (or, on the next day, a start like “Day before 23:00”); it is saved on both days, with ‹ › at the joined ends.')}</li>
   <li>{pair('오늘을 볼 때는 빨간 선이 지금 시각이에요. 지금 하고 있어야 할 일정은 노란색으로 강조돼요. 계획이 밀렸으면 일정 창의 ‘미루기 +10분·+30분·+1시간’을 눌러요. 겹치게 되는 뒤 일정만 함께 밀리고, 24:00을 넘기지는 않아요.','When viewing today, the red line is now and the block that should be under way is highlighted in yellow. Running late? Push back +10 min, +30 min or +1 hr in its dialog. Only the later activities it would overlap move with it, and nothing goes past 24:00.')}</li>
   <li>{pair('‘하루’와 ‘목록’ 보기를 바꿀 수 있어요. 폰은 목록으로 시작해요.','Switch between Day and List. Phones start with the list.')}</li>
   <li>{pair('블록마다 완료를 표시할 필요는 없어요. 끝난 건 할 일 체크로 충분하고, 못 한 일정만 블록에 마우스를 올려 ×를 누르거나 일정 창에서 ‘미이행’ 버튼을 눌러요. 취소선으로 표시돼요.','You don’t need to mark each block. Checking tasks is enough; for a plan you skipped, hover it and press × or press Unfinished in its window. It gets a strike-through.')}</li>
  </ul>
  </details>
  <details className="guide-more"><summary>{pair('계획과 루틴','Plans and routines')}</summary>
  <ul>
   <li>{pair('‘계획 > 목표’에서 그해 목표를 카드로 만들고, 제목 아래에 끝났을 때 모습을 한 줄 적은 뒤 끝내야 할 세부 계획을 체크리스트로 적어요. 핀을 눌러 지금 집중하는 목표를 정하면 맨 앞에 놓여요. 목표 색(16가지)은 점을 눌러 고르고, 연결한 시간표 블록도 같은 색이에요.','Under Plans > Goals, each goal for the year is a card: a line on what done looks like, then the steps that finish it. Pin the goals you are focusing on; they come first. Tap the dot to pick one of 16 colours; linked timetable blocks share it.')}</li>
   <li>{pair('일간 화면 위 ‘집중’에 핀을 꽂은 목표와 그 목표의 다음 할 일이 보여요. 누르면 끝났을 때 모습, 남은 세부 계획(+를 누르면 시간표에 넣기), 이번 주 시간표에 잡은 시간이 나와요. 넣은 일정에는 그 목표의 색 띠가 붙어요.','“Focus” above the day view shows your pinned goals, each with its next step. Open one to see what done looks like, its open steps (+ puts one on the timetable) and time scheduled this week; linked blocks get the goal’s colour.')}</li>
   <li>{pair('루틴은 자주 하는 일의 이름이에요. 계획 메뉴의 ‘편의’ 탭 루틴 카드에서 만들고, 일정 화면 위 루틴을 누르면 바로 시간표에 들어가요. 같은 탭의 ‘하루 틀’에는 시간까지 정한 하루 시간표를 저장해 두고, ‘하루 시간표’ 옆 틀 아이콘으로 한 번에 깔거나(빈 날엔 시간표 위 버튼도 있어요), 그날 시간표를 틀로 저장해요.','Routines are names of things you do often. Create them on the Routines card of the Tools tab under Plans, then tap one above the schedule to put it on the timetable. Day templates, in the same tab, keep a whole timed day: lay one down from the template icon next to the Timetable heading (an empty day also has a button above the timetable), or save the day you’re looking at as a template.')}</li>
  </ul>
  </details>
  <details className="guide-more"><summary>{pair('주간 · 월간 · 회고','Week, month and review')}</summary>
  <ul>
   <li>{pair('주간·월간은 그 기간의 기록을 한눈에 보여 줘요. 날짜를 누르면 그날로 가요. 월간 칸에는 계획한 시간, 꼭 할 일 완료(✓ 2/3), 일정 3개까지가 보여요. 계획에 연결된 일정에는 그 계획 색 띠가 붙어요.','Week and Month show the period at a glance; click a date to open that day. A month cell shows time planned, priorities done (✓ 2/3) and up to three plans; plans linked to a goal carry its color.')}</li>
   <li>{pair('회고는 주·달·연 단위로 모아 보여 줘요: 맨 위 한 문장 요약과 계획한 시간·목표에 쓴 비율·꼭 할 일 완료·미이행(지난 기간과 비교), 아래에 목표마다 시간·세부 계획 완료(목표 색), 하루하루 언제 무엇을 했는지 한 줄 타임라인(연은 달마다 막대), 다시 계획할 것, 하루 돌아보기. 연에는 올해 흐름도 있어요. ‘기록’ 탭에서는 그 기간의 꼭 할 일·머릿속 생각·아이디어·하루 돌아보기를 날짜별로 모아 보고, 종류를 골라 보거나 단어로 찾을 수 있어요. 따로 적을 건 없어요.','Review gathers a week, month or year: a one-line summary, planned time, share on goals, priorities done and unfinished (compared with the period before), then each goal’s time and steps done in its colour, each day as a 0–24 strip showing what sat when (month bars for a year), what to plan again and daily reviews. The year adds the year flow. The Records tab gathers that period’s priorities, thoughts, ideas and daily reviews by day, with a kind filter and search. Nothing extra to fill in.')}</li>
  </ul>
  </details>
  <details className="guide-more"><summary>{pair('계정','Your account')}</summary>
  <ul>
   <li>{pair('이메일과 비밀번호로 로그인해요. 화면에는 가입할 때 정한 닉네임이 보여요. 닉네임과 이메일은 설정 › 계정에서 바꿔요.','Sign in with your email and password. Screens show the nickname you chose at sign-up; change it or your email under Settings › Account.')}</li>
   <li>{pair('가입하면 확인 메일이 가요. 링크를 열면 ‘확인됨’이 되고, 안 보이면 스팸함을 확인하거나 설정에서 다시 보내요. 새 이메일로 바꿀 때도 새 주소로 간 링크를 열어야 바뀌어요.','After sign-up we send a confirmation email. Open its link to see Confirmed; if it isn’t there, check spam or resend it from Settings. A new address takes effect only after you open the link sent to it.')}</li>
   <li>{pair('비밀번호를 잊으면 로그인 화면의 ‘비밀번호를 잊었어요’에서 재설정 링크를 받아요. 링크는 30분 동안 한 번만 쓸 수 있고, 바꾸면 다른 기기의 로그인은 끝나요.','Forgot your password? Choose “Forgot password” on the sign-in screen for a reset link. It works once, for 30 minutes, and other devices are signed out after the change.')}</li>
   <li>{pair('이메일 없이 가입한 예전 계정은 아이디로 로그인하고, 비밀번호는 가입 때 받은 복구코드로 재설정해요. 설정에서 이메일을 등록하면 이메일로도 로그인하고 재설정할 수 있어요.','Older accounts made without an email sign in with their username and reset the password with the recovery code from sign-up. Add an email in Settings to sign in and reset with it too.')}</li>
  </ul>
  </details>
  <details className="guide-more"><summary>{pair('단축키','Keyboard shortcuts')}</summary>
  <p>{pair('입력 칸 밖에서 눌러요.','Use them outside text fields.')}</p>
  <table><tbody>{keys.map(([key,ko,en])=><tr key={key}><td><kbd>{key}</kbd></td><td>{pair(ko,en)}</td></tr>)}</tbody></table>
  </details>
  <details className="guide-more"><summary>{pair('기록 보관','Your records')}</summary>
  <p>{pair('설정에서 일정·메모·계획을 JSON 파일로 내보낼 수 있어요. 계정과 기록 삭제도 설정에서 해요.','Export your schedule, notes and plans as a JSON file from Settings. You can also delete your account and records there.')}</p>
  </details>
  <div className="guide-close"><a className="primary" href="/signup">{pair('시작하기','Get started')}</a><a className="secondary" href="/demo">{pair('먼저 체험하기','Try it first')}</a></div>
 </article>;
}

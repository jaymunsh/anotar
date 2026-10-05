import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const blobDir = join(dataDir, 'blobs');
const store = openStore(dataDir);
await mkdir(blobDir, { recursive: true });
const added = [];
async function sample(key, input, attachment) {
  const files = [];
  if (attachment) {
    const name = attachment.name;
    const source = join(root, 'examples', attachment.source);
    const storageKey = randomUUID();
    await copyFile(source, join(blobDir, storageKey));
    files.push({ key: storageKey, name, mime: attachment.mime, size: (await stat(source)).size });
  }
  try {
    const item = store.createCapture({ ...input, files, sampleKey: 'memo.v1.' + key });
    for (const file of files)
      if (!item.files.some((stored) => stored.key === file.key))
        await unlink(join(blobDir, file.key));
    added.push({ id: item.id, kind: item.aiRequest ? 'ai' : item.kind });
  } catch (error) {
    await Promise.all(files.map((file) => unlink(join(blobDir, file.key)).catch(() => {})));
    throw error;
  }
}
const text = (value, styles = {}) => ({ type: 'text', text: value, styles });
const block = (type, content, props = {}) => ({
  id: randomUUID(),
  type,
  props,
  content: typeof content === 'string' ? [text(content)] : content,
  children: [],
});
const doc = (blocks) => ({ schemaVersion: 1, blocks });
try {
  await sample('travel-note', {
    kind: 'note',
    text: '교토 여행 준비\n숙소 예약 번호와 체크인 시간을 확인하기. 하루에 중요한 일정은 하나만 넣고, 나머지는 동네를 천천히 걷고 싶다.',
  });
  await sample('reference-link', {
    kind: 'link',
    url: 'https://developer.mozilla.org/ko/docs/Web/CSS/CSS_grid_layout',
    text: 'CSS Grid 문서 — 다음 화면의 목록 배치를 만들 때 다시 읽어보기.',
  });
  await sample(
    'travel-image',
    {
      kind: 'image',
      text: '여행 중 하고 싶은 것을 이미지로 남겼다. 일정 페이지를 만들 때 참고하기.',
    },
    { source: 'kyoto-note.png', name: '교토-여행-메모.png', mime: 'image/png' },
  );
  await sample(
    'checklist-file',
    { kind: 'file', text: '주말 여행 준비 체크리스트. 출발 전에 한 번 더 확인하기.' },
    { source: 'weekend-checklist.md', name: '주말-여행-준비.md', mime: 'text/markdown' },
  );
  const templates = store.listPromptTemplates().items;
  const research = templates.find((item) => item.kind === 'research' && !item.archived);
  const travel =
    templates.find((item) => item.id === 'travel-outline' && !item.archived) ||
    templates.find((item) => item.kind === 'free' && !item.archived);
  await sample('research-request', {
    kind: 'link',
    url: 'https://www.sqlite.org/wal.html',
    text: '미니PC에서 메모와 페이지를 보관할 때 SQLite WAL이 어떤 역할을 하는지 알아보기.',
    aiRequest: {
      template: research ?? null,
      additional: '핵심 3줄과 운영할 때 확인할 점을 나눠주세요.',
    },
  });
  await sample('travel-request', {
    kind: 'note',
    text: '교토에서 2박 3일을 보내려고 한다. 아침 산책과 카페 시간을 남기고, 하루에 중요한 일정은 하나만 넣고 싶다. 숙소와 이동 시간은 아직 확인하지 않았다.',
    aiRequest: {
      template: travel ?? null,
      additional: '확인되지 않은 예약이나 운영 시간은 정하지 말고 질문으로 남겨주세요.',
    },
  });
  const parent = store.ensureSamplePage({
    key: 'travel.v1',
    title: '교토 여행 준비 · 예시',
    icon: '🗺️',
    document: doc([
      block(
        'paragraph',
        '메모에 모아둔 여행 자료를 정리하면 이런 문서가 됩니다. 사용 흐름을 보여주기 위해 직접 작성한 예시예요.',
      ),
      block('heading', '이번 여행에서 중요하게 생각하는 것', { level: 2 }),
      block('bulletListItem', '하루에 중요한 일정은 하나만 넣기'),
      block('bulletListItem', '걷다가 마음에 드는 카페가 보이면 쉬어가기'),
      block('bulletListItem', '이동 시간과 예약 정보는 출발 전에 다시 확인하기'),
      block('heading', '2박 3일의 느슨한 흐름', { level: 2 }),
      block('table', {
        type: 'tableContent',
        columnWidths: [110, 240, 260],
        headerRows: 1,
        rows: [
          { cells: [[text('날')], [text('중심 일정')], [text('남겨둘 여유')]] },
          { cells: [[text('첫날')], [text('도착과 숙소 확인')], [text('동네 산책, 저녁 식사')]] },
          {
            cells: [
              [text('둘째 날')],
              [text('가장 가고 싶은 곳 하나')],
              [text('카페와 사진 찍기')],
            ],
          },
          {
            cells: [
              [text('마지막 날')],
              [text('체크아웃과 귀가 준비')],
              [text('짐 정리, 이동 시간')],
            ],
          },
        ],
      }),
      block('heading', '출발 전에 확인할 것', { level: 2 }),
      block('checkListItem', '숙소 예약 번호와 체크인 시간', { checked: false }),
      block('checkListItem', '교통편과 당일 날씨', { checked: false }),
      block('quote', '계획은 길을 잃지 않도록 돕는 지도. 빈 시간도 여행의 일부다.'),
    ]),
  });
  const child = store.ensureSamplePage({
    key: 'travel-check.v1',
    title: '교통·예약 체크 · 예시',
    icon: '🎫',
    parentId: parent.id,
    document: doc([
      block('paragraph', '여행 준비 중 확인할 내용을 따로 모아둔 하위 페이지입니다.'),
      block('heading', '교통', { level: 2 }),
      block('checkListItem', '숙소에서 첫 일정까지 이동 시간 확인', { checked: false }),
      block('checkListItem', '귀가하는 날 마지막 교통편 확인', { checked: false }),
      block('heading', '예약', { level: 2 }),
      block('checkListItem', '예약 번호를 오프라인에서도 확인할 수 있게 저장', { checked: false }),
      block(
        'paragraph',
        'AI 요청 탭의 여행 계획 예시는 실행 전 요청문입니다. 이 문서는 직접 작성한 예시이며 AI가 생성한 결과가 아닙니다.',
      ),
      block('diagram', 'flowchart LR\n  A[여행 메모] --> B[확인할 정보]\n  B --> C[여행 페이지]'),
    ]),
  });
  const tasks = [
    store.createTask({
      title: '숙소 예약 번호와 체크인 시간 확인 · 예시',
      requestId: 'be3c0d3a-9702-472a-b71f-0965b0f593e1',
    }),
    store.createTask({
      title: '교통·예약 체크 페이지에 준비물 정리 · 예시',
      requestId: 'be3c0d3a-9702-472a-b71f-0965b0f593e2',
    }),
  ];
  console.log(
    JSON.stringify({
      memo: added.filter((item) => item.kind !== 'ai').length,
      ai: added.filter((item) => item.kind === 'ai').length,
      pages: [parent.id, child.id],
      tasks: tasks.map((task) => task.id),
      dataDir,
    }),
  );
} finally {
  store.close();
}

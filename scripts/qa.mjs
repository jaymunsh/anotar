import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTaskQa } from './qa-tasks.mjs';
import { runPromptQa } from './qa-prompts.mjs';
import { runServerPromptQa } from './qa-server-prompts.mjs';
import { runPromptRecoveryQa } from './qa-prompt-recovery.mjs';
import { runDraftQa } from './qa-drafts.mjs';
import { runCompactPageQa, selectAppTheme } from './qa-compact-pages.mjs';
import { runCommentPreviewQa } from './qa-page-comment-preview.mjs';
import { runMemoLibraryQa } from './qa-memo-library.mjs';
import { runShellRecoveryQa } from './qa-shell-recovery.mjs';
import { runPageConnectionQa } from './qa-page-connections.mjs';
import { runTrashQa } from './qa-trash.mjs';
import { runSearchQa } from './qa-search.mjs';
import { runAiQa } from './qa-ai.mjs';
import { clickPageTool } from './qa-page-tools.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'leneu-qa-'));
const baseUrl = 'http://127.0.0.1:8789';
async function waitForPageBlock(id, type) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { item } = await (await fetch(`${baseUrl}/api/pages/${id}`)).json();
    if (item.document.blocks.some((block) => block.type === type)) return item;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${type} 블록이 저장되지 않았습니다.`);
}
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    AI_RUNNER_KIND: 'disabled',
    AI_RUNNER_URL: '',
    DATA_DIR: dataDir,
    PORT: '8789',
    HOST: '127.0.0.1',
  },
  stdio: 'pipe',
});
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    if ((await fetch(`${baseUrl}/api/health`)).ok) break;
  } catch {
    /* Waiting for the server. */
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if ((await page.title()) !== 'leneu. — 생각을 놓아두는 곳')
    throw new Error('서비스 이름이 브라우저 제목에 표시되어야 합니다.');
  const favicon = page.locator('link[rel="icon"]');
  const faviconHref = (await favicon.count()) ? await favicon.getAttribute('href') : null;
  if (!faviconHref || !(await fetch(new URL(faviconHref, baseUrl))).ok)
    throw new Error('네 칸 브랜드 로고가 브라우저 favicon으로 제공되어야 합니다.');
  const systemTheme = await page.evaluate(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  if ((await page.locator('html').getAttribute('data-theme')) !== systemTheme)
    throw new Error('화면 모드는 기본적으로 시스템 설정을 따라야 합니다.');
  await selectAppTheme(page, 'dark');
  if ((await page.locator('html').getAttribute('data-theme')) !== 'dark')
    throw new Error('설정의 화면 모드 전환이 앱 전체에 적용되어야 합니다.');
  await page.reload({ waitUntil: 'networkidle' });
  if ((await page.locator('html').getAttribute('data-theme')) !== 'dark')
    throw new Error('선택한 화면 모드는 새로고침 뒤에도 유지되어야 합니다.');
  await page.evaluate(() => localStorage.removeItem('leneu:theme'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  const avatars = page.locator('.sidebar-profile');
  if (
    (await avatars.count()) !== 1 ||
    !(await avatars.evaluateAll((images) =>
      images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
    ))
  )
    throw new Error('제공된 프로필 이미지가 사이드바 작업 공간에 보여야 합니다.');

  await page
    .getByRole('textbox', { name: '메모 내용' })
    .fill('교토 여행 항공권 확인\n가격 비교하기');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('기기에 저장했어요. 연결되면 동기화해요.', { exact: true }).waitFor();
  if ((await page.getByRole('textbox', { name: '메모 내용' }).inputValue()) !== '')
    throw new Error('기기 저장 성공 뒤 입력을 비워야 합니다.');
  await page.waitForFunction(() => document.querySelector('.sync-status')?.textContent.includes('동기화 완료'));
  const savedNotes = (await (await fetch(baseUrl + '/api/captures')).json()).items;
  if (savedNotes.filter((item) => item.text === '교토 여행 항공권 확인\n가격 비교하기').length !== 1)
    throw new Error('기기 저장한 메모는 서버에 한 번만 동기화되어야 합니다.');
  const firstPreview = page.locator('.capture-card').first().locator('.capture-preview');
  if (
    (await firstPreview.count()) !== 1 ||
    (await firstPreview.textContent())?.replace(/\r\n/g, '\n') !==
      '교토 여행 항공권 확인\n가격 비교하기'
  )
    throw new Error('메모 목록은 원문을 한 번만 보여줘야 합니다.');
  const firstCard = page.locator('.capture-card').first();
  const firstBadge = firstCard.locator('.capture-new');
  await firstBadge.waitFor();
  const compactPreview = await firstPreview.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis';
  });
  if (!compactPreview) throw new Error('목록 메모는 한 줄에서 말줄임표로 끝나야 합니다.');
  const badgeBounds = await firstBadge.boundingBox();
  const arrowBounds = await firstCard.locator('.capture-arrow').boundingBox();
  if (
    !badgeBounds ||
    !arrowBounds ||
    (badgeBounds.x < arrowBounds.x + arrowBounds.width &&
      badgeBounds.x + badgeBounds.width > arrowBounds.x &&
      badgeBounds.y < arrowBounds.y + arrowBounds.height &&
      badgeBounds.y + badgeBounds.height > arrowBounds.y)
  )
    throw new Error('PC 목록의 NEW와 화살표가 겹치면 안 됩니다.');
  const savedTime = page.locator('.capture-card').first().locator('time');
  if (
    (await savedTime.count()) !== 1 ||
    !/^오늘 (오전|오후) \d{1,2}:\d{2}$/.test((await savedTime.textContent()) || '')
  )
    throw new Error('오늘 저장한 항목은 오늘 오전/오후 시각으로 표시해야 합니다.');
  const timeBounds = await savedTime.boundingBox();
  const cardBounds = await firstCard.boundingBox();
  if (
    !timeBounds ||
    !badgeBounds ||
    !cardBounds ||
    cardBounds.x + cardBounds.width - badgeBounds.x - badgeBounds.width < 10 ||
    cardBounds.x + cardBounds.width - badgeBounds.x - badgeBounds.width > 24 ||
    Math.abs(badgeBounds.y + badgeBounds.height / 2 - (timeBounds.y + timeBounds.height / 2)) > 3
  )
    throw new Error('PC 목록의 NEW는 생성 시각 줄 오른쪽 끝에 같은 높이로 있어야 합니다.');

  await page.locator('.composer-tabs').getByRole('tab', { name: '링크' }).click();
  await page.getByRole('textbox', { name: '링크 주소' }).fill('https://example.com/research');
  await page.getByRole('textbox', { name: '메모 내용' }).fill('나중에 읽을 리서치');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('example.com', { exact: true }).waitFor();

  await page.locator('.composer-tabs').getByRole('tab', { name: '이미지' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'screenshot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('textbox', { name: '메모 내용' }).fill('테스트 스크린샷');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('테스트 스크린샷', { exact: true }).waitFor();

  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '메모', exact: true })
    .click();
  await page.getByRole('textbox', { name: '보관함 검색' }).click();
  await page.getByRole('textbox', { name: '보관함 검색' }).pressSequentially('항공권');
  await page.waitForFunction(() => document.querySelectorAll('.capture-card').length === 1);
  await page.locator('.capture-card').click();
  await page.getByRole('dialog').getByText('가격 비교하기').waitFor();
  if (await page.getByRole('dialog').locator('h2').count())
    throw new Error('제목이 없는 메모에 가짜 제목을 만들면 안 됩니다.');
  if (
    (await page.getByRole('dialog').locator('.detail-text').textContent())?.replace(
      /\r\n/g,
      '\n',
    ) !== '교토 여행 항공권 확인\n가격 비교하기'
  )
    throw new Error('상세 화면은 메모 원문을 한 번만 보여줘야 합니다.');
  const detailTime = page.getByRole('dialog').locator('time');
  if (
    (await detailTime.count()) !== 2 ||
    !(await detailTime.allTextContents()).every((value) =>
      /^오늘 (오전|오후) \d{1,2}:\d{2}$/.test(value),
    )
  )
    throw new Error('상세 날짜도 오늘 오전/오후 시각으로 표시해야 합니다.');
  const originalTime = await detailTime.first().getAttribute('datetime');
  await page.getByRole('button', { name: '항목 수정' }).click();
  await page.screenshot({ path: '/tmp/leneu-capture-edit-light.png' });
  await page
    .getByRole('textbox', { name: '보관한 내용' })
    .fill('교토 여행 항공권 확인\n날짜도 다시 보기');
  await page.getByRole('button', { name: '변경 저장' }).click();
  await page.getByRole('button', { name: '항목 수정' }).waitFor();
  await page.getByRole('dialog').getByText('날짜도 다시 보기').waitFor();
  const editedTime = await page
    .getByRole('dialog')
    .locator('time')
    .first()
    .getAttribute('datetime');
  const editedFlag = await page
    .getByRole('dialog')
    .getByText('최종 수정일', { exact: true })
    .count();
  const editedNew = await page.locator('.capture-card').first().locator('.capture-new').count();
  if (editedTime !== originalTime || !editedFlag || !editedNew)
    throw new Error('수정 후에도 생성 시각과 NEW를 유지하고 수정 상태를 보여야 합니다.');
  const { items: matchingNotes } = await (await fetch(`${baseUrl}/api/captures?q=항공권`)).json();
  if ((await detailTime.last().getAttribute('datetime')) !== matchingNotes[0].updatedAt)
    throw new Error('최종 수정일은 실제 저장된 메모 수정 시각이어야 합니다.');
  await page.getByRole('button', { name: '항목 수정' }).click();
  const draft = page.getByRole('textbox', { name: '보관한 내용' });
  await draft.fill('교토 여행 항공권 확인\n내 초안');
  const concurrentResponse = await fetch(`${baseUrl}/api/captures/${matchingNotes[0].id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '교토 여행 항공권 확인\n다른 탭의 수정', expectedVersion: 2 }),
  });
  if (!concurrentResponse.ok) throw new Error('충돌 시나리오용 외부 수정에 실패했습니다.');
  await page.getByRole('button', { name: '변경 저장' }).click();
  await page.getByRole('alert').getByText('다른 곳에서 먼저 수정한 항목입니다.').waitFor();
  if ((await draft.inputValue()) !== '교토 여행 항공권 확인\n내 초안')
    throw new Error('충돌 후에도 작성 중인 수정 초안은 남아야 합니다.');
  await page.getByRole('button', { name: '최신 내용 불러오기' }).click();
  if ((await draft.inputValue()) !== '교토 여행 항공권 확인\n다른 탭의 수정')
    throw new Error('요청한 경우에만 최신 항목을 편집기에 불러와야 합니다.');
  await page.getByRole('button', { name: '수정 취소' }).click();
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('textbox', { name: '보관함 검색' }).fill('');
  await page.waitForFunction(() => document.querySelectorAll('.capture-card').length === 3);
  await page.getByText('나중에 읽을 리서치', { exact: true }).click();
  await page.getByRole('button', { name: '항목 수정' }).click();
  await page.getByRole('textbox', { name: '보관한 링크 주소' }).fill('https://example.org/updated');
  await page.getByRole('textbox', { name: '보관한 내용' }).fill('수정한 리서치 링크');
  await page.getByRole('button', { name: '변경 저장' }).click();
  if (
    (await page.getByRole('dialog').locator('.detail-link').getAttribute('href')) !==
    'https://example.org/updated'
  )
    throw new Error('저장된 링크 주소도 수정되어야 합니다.');
  await page.getByRole('button', { name: '닫기' }).click();
  await page.screenshot({ path: '/tmp/leneu-populated-desktop.png', fullPage: true });
  await page.getByRole('link', { name: '입력함', exact: true }).click();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
  await mobile
    .getByRole('region', { name: '새 항목 저장' })
    .getByRole('textbox', { name: '메모 내용' })
    .waitFor();
  const quickCapture = mobile.getByRole('button', { name: '전체 화면으로 쓰기' });
  await mobile.getByRole('button', { name: '메뉴 열기' }).click();
  await mobile.getByRole('button', { name: '메뉴 닫기' }).waitFor();
  await mobile
    .getByRole('button', { name: '메뉴 닫기' })
    .click({ position: { x: mobile.viewportSize().width - 10, y: 80 } });
  if (!(await quickCapture.isVisible()))
    throw new Error('모바일 메뉴를 닫으면 입력창을 펼칠 수 있어야 합니다.');
  await quickCapture.click();
  const mobileEditor = mobile.getByRole('dialog', { name: '빠른 기록' });
  await mobileEditor.waitFor();
  await mobile.screenshot({ path: '/tmp/leneu-mobile-editor.png', fullPage: true });
  if (
    !(await mobileEditor
      .getByRole('textbox', { name: '메모 내용' })
      .evaluate((element) => element === document.activeElement))
  )
    throw new Error('모바일 입력을 열었을 때 커서가 메모에 있어야 합니다.');
  await mobile.setViewportSize({ width: 390, height: 500 });
  await mobile.waitForFunction(() => {
    const button = document.querySelector('.composer.mobile-open .save-button');
    return button && button.getBoundingClientRect().bottom <= 500;
  });
  const saveBounds = await mobileEditor
    .getByRole('button', { name: '저장', exact: true })
    .boundingBox();
  if (!saveBounds || saveBounds.y + saveBounds.height > 500)
    throw new Error('화면 높이가 줄어도 저장 버튼이 화면 안에 있어야 합니다.');
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobileEditor.getByRole('textbox', { name: '메모 내용' }).fill('이동 중 떠오른 생각');
  await mobileEditor.getByRole('button', { name: '입력 닫기' }).click();
  await quickCapture.click();
  if (
    (await mobileEditor.getByRole('textbox', { name: '메모 내용' }).inputValue()) !==
    '이동 중 떠오른 생각'
  )
    throw new Error('입력을 닫았다 다시 열어도 초안이 남아야 합니다.');
  await mobileEditor.getByRole('button', { name: '저장', exact: true }).click();
  await mobileEditor.waitFor({ state: 'hidden' });
  await mobile.getByText('이동 중 떠오른 생각', { exact: true }).waitFor();
  await mobile.getByText('이동 중 떠오른 생각', { exact: true }).click();
  await mobile.getByRole('button', { name: '항목 수정' }).click();
  await mobile.screenshot({ path: '/tmp/leneu-capture-edit-mobile.png' });
  await mobile.keyboard.press('Escape');
  await mobile.getByRole('button', { name: '항목 수정' }).waitFor();
  await mobile.getByRole('button', { name: '항목 수정' }).click();
  await mobile.setViewportSize({ width: 320, height: 640 });
  const editOverflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (editOverflow) throw new Error('320px 모바일 항목 수정 화면에 가로 스크롤이 생겼습니다.');
  await mobile.screenshot({ path: '/tmp/leneu-capture-edit-320.png' });
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.getByRole('textbox', { name: '보관한 내용' }).fill('이동 중 정리한 생각');
  await mobile.getByRole('button', { name: '변경 저장' }).click();
  await mobile.getByRole('button', { name: '항목 수정' }).waitFor();
  await mobile.getByRole('dialog').getByText('이동 중 정리한 생각').waitFor();
  await mobile.getByRole('button', { name: '닫기' }).click();
  const quickBounds = await quickCapture.boundingBox();
  if (!quickBounds || quickBounds.y + quickBounds.height > 844)
    throw new Error('저장 후 모바일 입력창을 펼치는 버튼이 화면에 보여야 합니다.');
  await mobile.screenshot({ path: '/tmp/leneu-populated-mobile.png' });
  await quickCapture.click();
  await mobileEditor.getByRole('textbox', { name: '메모 내용' }).evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'https://example.org/article');
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }),
    );
  });
  if (
    (await mobileEditor.getByRole('textbox', { name: '링크 주소' }).inputValue()) !==
    'https://example.org/article'
  )
    throw new Error('메모에 URL만 붙여넣으면 링크 입력으로 바뀌어야 합니다.');
  await mobileEditor.getByRole('button', { name: '입력 닫기' }).click();
  const chooserPromise = mobile.waitForEvent('filechooser');
  await mobile
    .getByRole('region', { name: '새 항목 저장' })
    .getByRole('button', { name: '첨부하기' })
    .click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'mobile-shot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await mobileEditor.waitFor();
  if (
    (await mobileEditor.getByRole('tab', { name: '링크' }).getAttribute('aria-selected')) !==
      'true' ||
    (await mobileEditor.getByRole('textbox', { name: '링크 주소' }).inputValue()) !==
      'https://example.org/article'
  )
    throw new Error('모바일 이미지 첨부가 기존 링크 종류와 주소를 보존해야 합니다.');
  await mobileEditor.getByText('mobile-shot.png').waitFor();
  await mobileEditor.getByRole('button', { name: '입력 닫기' }).click();
  await mobile.setViewportSize({ width: 320, height: 640 });
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('모바일에서 가로 스크롤이 생겼습니다.');
  await quickCapture.click();
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('좁은 모바일 입력 시트에서 가로 스크롤이 생겼습니다.');
  await mobileEditor.getByRole('button', { name: '입력 닫기' }).click();
  await page.getByRole('textbox', { name: '메모 내용' }).fill('전환 중 남겨둘 초안');
  await page.evaluate(() => {
    window.__workspaceMarker = 'same-app';
  });
  await page.getByRole('button', { name: '새 페이지', exact: true }).click();
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  const previousPagePath = new URL(page.url()).pathname;
  if (
    !/^\/pages\/[a-f0-9-]+$/.test(new URL(page.url()).pathname) ||
    (await page.evaluate(() => window.__workspaceMarker)) !== 'same-app' ||
    (await page.locator('.sidebar').count()) !== 1 ||
    (await page.locator('.pages-sidebar').count()) !== 0
  )
    throw new Error('입력함과 페이지는 같은 앱 셸에서 전환돼야 합니다.');
  await page.getByRole('link', { name: '입력함', exact: true }).click();
  if (
    (await page.getByRole('textbox', { name: '메모 내용' }).inputValue()) !== '전환 중 남겨둘 초안'
  )
    throw new Error('페이지를 다녀와도 빠른 입력 초안은 남아 있어야 합니다.');
  await page.getByRole('textbox', { name: '메모 내용' }).fill('');
  await page.locator('.sidebar-page-item[href="' + previousPagePath + '"]').click();
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  const stagingPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: '새 페이지', exact: true }).click();
  await page.waitForURL(
    (url) => url.pathname !== stagingPath && /^\/pages\/[a-f0-9-]+$/.test(url.pathname),
  );
  await page.waitForFunction(() => document.querySelector('.page-title-input')?.value === '');
  const pageTitle = '교토의 3일, 많이 보기보다 오래 머무르기';
  await page.getByRole('textbox', { name: '페이지 제목' }).fill(pageTitle);
  await page.getByText('저장됨', { exact: true }).waitFor();
  const inboxWithPages = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await inboxWithPages.goto(baseUrl, { waitUntil: 'networkidle' });
  const inboxPageLink = inboxWithPages
    .getByRole('navigation', { name: '페이지 목록' })
    .getByRole('link', { name: pageTitle });
  await inboxPageLink.waitFor({ timeout: 5000 });
  await inboxPageLink.click();
  if (new URL(inboxWithPages.url()).pathname === '/')
    throw new Error('입력함에서도 사이드바 페이지를 바로 열 수 있어야 합니다.');
  await inboxWithPages.close();
  await page.goBack();
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  if (new URL(page.url()).pathname !== stagingPath)
    throw new Error('뒤로 가기는 같은 앱의 이전 문서를 열어야 합니다.');
  await page.goForward();
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  if ((await page.getByRole('textbox', { name: '페이지 제목' }).inputValue()) !== pageTitle)
    throw new Error('페이지 제목은 새로 열어도 남아야 합니다.');
  await page.getByRole('textbox', { name: '페이지 제목' }).press('Enter');
  await page.keyboard.type('제목 다음에 바로 쓰는 본문');
  await waitForPageBlock(new URL(page.url()).pathname.split('/').pop(), 'paragraph');
  if (!(await page.locator('.bn-editor').innerText()).includes('제목 다음에 바로 쓰는 본문'))
    throw new Error('제목에서 Enter를 누르면 본문에 바로 이어서 쓸 수 있어야 합니다.');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('Enter');
  await page.keyboard.type('# 직접 입력');
  await page.keyboard.press('Enter');
  await page.evaluate(() =>
    navigator.clipboard.writeText(
      '## 붙여넣은 제목\n\n- 첫 일정\n\n- [ ] 예약 확인\n\n| 문법 | 결과 |\n| --- | --- |\n| 굵게 | **텍스트** |\n\n```mermaid\ngraph TD\nA-->B\n```',
    ),
  );
  await page.keyboard.press('ControlOrMeta+V');
  const pageId = new URL(page.url()).pathname.split('/').pop();
  const savedPage = await waitForPageBlock(pageId, 'checkListItem');
  if (
    !savedPage.document.blocks.some(
      (block) => block.type === 'heading' && block.props.level === 1,
    ) ||
    !savedPage.document.blocks.some(
      (block) => block.type === 'heading' && block.props.level === 2,
    ) ||
    !savedPage.document.blocks.some((block) => block.type === 'bulletListItem')
  )
    throw new Error('Markdown 입력과 붙여넣기는 제목·목록 블록으로 남아야 합니다.');
  if (!savedPage.document.blocks.some((block) => block.type === 'diagram'))
    throw new Error('붙여넣은 Mermaid 코드 울타리는 다이어그램 블록이 되어야 합니다.');
  const withTable = await waitForPageBlock(pageId, 'table');
  if (!withTable.document.blocks.some((block) => block.content?.rows?.length === 2))
    throw new Error('Markdown 표는 셀 구조를 유지한 블록으로 저장돼야 합니다.');
  await page.locator('.bn-editor p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const slashMenu = page.locator('.bn-suggestion-menu');
  await slashMenu.waitFor();
  for (const label of ['접을 수 있는 목록', '접을 수 있는 제목1', '이모지'])
    if ((await slashMenu.getByText(label, { exact: true }).count()) !== 1)
      throw new Error(`/ 메뉴에 ${label} 항목이 보여야 합니다.`);
  await slashMenu.getByText('목차', { exact: true }).click();
  await page.locator('.page-toc').waitFor();
  await waitForPageBlock(pageId, 'tableOfContents');
  if (!(await page.locator('.page-toc').innerText()).includes('붙여넣은 제목'))
    throw new Error('목차는 페이지의 제목 블록을 보여줘야 합니다.');
  await page.locator('.page-toc-item').first().click();
  await page.locator('.bn-editor p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(':');
  await page.locator('.bn-grid-suggestion-menu').waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.keyboard.type('바깥');
  await page.keyboard.press('Enter');
  await page.keyboard.type('안쪽');
  await page.keyboard.press('Tab');
  for (let attempt = 0; attempt < 60; attempt++) {
    const { item } = await (await fetch(`${baseUrl}/api/pages/${pageId}`)).json();
    const hasNested = (blocks) =>
      blocks.some(
        (block) =>
          (Array.isArray(block.content) &&
            block.content.some((chunk) => chunk.text === '바깥') &&
            block.children.length > 0) ||
          hasNested(block.children || []),
      );
    if (hasNested(item.document.blocks)) break;
    if (attempt === 59) throw new Error('Tab으로 블록을 다른 블록 안에 넣을 수 있어야 합니다.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.locator('.bn-block', { hasText: '안쪽' }).last().hover();
  await page.locator('[data-test="dragHandle"]').click();
  const dragMenu = page.locator('.bn-menu-dropdown');
  await dragMenu.getByText('내어쓰기', { exact: true }).waitFor();
  if ((await dragMenu.getByText('들여쓰기', { exact: true }).count()) !== 0)
    throw new Error('첫 자식 블록에는 들여쓰기 항목이 보이면 안 됩니다.');
  // 강조는 140ms 배경 전이를 동반하므로 목표값까지 폴링한다.
  let highlight = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    highlight = await page
      .locator('.bn-block', { hasText: '안쪽' })
      .last()
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    if (highlight === 'rgba(120, 145, 125, 0.15)') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (highlight !== 'rgba(120, 145, 125, 0.15)')
    throw new Error('손잡이 메뉴가 열린 블록은 영역 전체가 옅게 강조되어야 합니다.');
  await page.keyboard.press('Escape');
  await dragMenu.waitFor({ state: 'hidden' });
  await page.waitForSelector('style[data-page-block-menu-highlight]', { state: 'detached' });
  // 강조 해제는 140ms 배경 전이를 동반하므로 사라질 때까지 기다린다.
  let unhighlight = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    unhighlight = await page
      .locator('.bn-block', { hasText: '안쪽' })
      .last()
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    if (unhighlight === 'rgba(0, 0, 0, 0)' || unhighlight === 'transparent') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (unhighlight !== 'rgba(0, 0, 0, 0)' && unhighlight !== 'transparent')
    throw new Error('손잡이 메뉴가 닫히면 블록 강조가 해제되어야 합니다.');
  await page
    .locator('.bn-block', { hasText: '바깥' })
    .first()
    .hover({ position: { x: 8, y: 4 } });
  await page.locator('[data-test="dragHandle"]').click();
  await dragMenu.getByText('들여쓰기', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const tocBackground = await page
    .locator('.page-toc')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  if (tocBackground === 'rgba(0, 0, 0, 0)' || tocBackground === 'transparent')
    throw new Error('목차는 연한 배경 영역 위에 보여야 합니다.');
  // 드래그 메뉴를 닫은 뒤 사이드 메뉴가 커서를 붙들고 있어서,
  // 첫 클릭은 해제용으로 한 번 더 누른다.
  const clickTopParagraph = async () => {
    await page.locator('.bn-editor p').first().click();
    await page.locator('.bn-editor p').first().click();
  };
  await clickTopParagraph();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> 접는 목록');
  await waitForPageBlock(pageId, 'toggleListItem');
  await clickTopParagraph();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('" 남긴 인용');
  await waitForPageBlock(pageId, 'quote');
  await clickTopParagraph();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/페이지');
  await slashMenu.waitFor();
  await page.keyboard.press('Enter');
  await page.locator('.page-link-block').waitFor();
  await waitForPageBlock(pageId, 'page');
  await page.locator('.page-link-block').first().click();
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  const childId = new URL(page.url()).pathname.split('/').pop();
  if (!/^[a-f0-9-]+$/.test(childId) || childId === pageId)
    throw new Error('페이지 블록은 연결된 하위 페이지를 열어야 합니다.');
  // 하위 페이지 상단 경로에는 상위 제목이 보이고 누르면 상위 페이지로 이동해야 합니다
  const crumbNav = page.getByLabel('페이지 경로');
  const crumbLink = crumbNav.getByRole('link').first();
  await crumbLink.waitFor();
  if (!(await crumbNav.innerText()).includes('교토의 3일'))
    throw new Error('하위 페이지 상단 경로에 상위 페이지 제목이 보여야 합니다.');
  await crumbLink.click();
  await page.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  if (new URL(page.url()).pathname.split('/').pop() !== pageId)
    throw new Error('상단 경로의 상위 항목은 상위 페이지를 열어야 합니다.');
  await page.locator('.page-link-block').waitFor();
  // 하위 페이지는 사이드바에서 상위 아래에 들여져 보여야 합니다
  const childRow = page.locator(
    `.sidebar-page-row:has(.sidebar-page-item[href="/pages/${childId}"])`,
  );
  await childRow.waitFor();
  const childIndent = await childRow.evaluate(
    (element) => parseInt(element.style.paddingLeft || '0', 10) || 0,
  );
  if (childIndent < 20)
    throw new Error('하위 페이지는 사이드바에서 상위 페이지 아래에 들여져 보여야 합니다.');
  // 상위 행의 접기 화살표로 하위 페이지를 숨기고 다시 펼칠 수 있어야 합니다
  const parentRow = page.locator(
    `.sidebar-page-row:has(.sidebar-page-item[href="/pages/${pageId}"])`,
  );
  await parentRow.getByRole('button', { name: '하위 페이지 접기' }).click();
  if (await childRow.isVisible().catch(() => false))
    throw new Error('접기 화살표는 하위 페이지를 숨겨야 합니다.');
  await parentRow.getByRole('button', { name: '하위 페이지 펼치기' }).click();
  await childRow.waitFor();
  // 행을 드래그해 최상위로 빼고 다시 하위로 넣을 수 있어야 합니다
  await childRow.dragTo(page.locator('.sidebar-pages-dropzone'));
  await page.waitForTimeout(400);
  const movedOut = (await (await fetch(`${baseUrl}/api/pages/${childId}`)).json()).item;
  if (movedOut.parentId !== null)
    throw new Error('드래그로 하위 페이지를 최상위로 옮길 수 있어야 합니다.');
  await childRow.dragTo(parentRow);
  await page.waitForTimeout(400);
  const movedBack = (await (await fetch(`${baseUrl}/api/pages/${childId}`)).json()).item;
  if (movedBack.parentId !== pageId)
    throw new Error('드래그로 페이지를 다른 페이지 안에 넣을 수 있어야 합니다.');
  // 통합검색의 페이지 필터에서 제목을 찾아 키보드로 이동해야 합니다
  await page.locator('.nav-search').click();
  await page.locator('.page-search-panel').waitFor();
  await page.getByRole('tab', { name: '페이지', exact: true }).click();
  await page.locator('.page-search-input input').fill('교토의 3일');
  await page.locator('.page-search-result').first().waitFor();
  if (
    !(await page.locator('.page-search-result-title').allInnerTexts()).some((hit) =>
      hit.includes('교토의 3일'),
    )
  )
    throw new Error('검색 팔레트는 제목이 맞는 페이지를 결과로 보여야 합니다.');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  if (new URL(page.url()).pathname.split('/').pop() !== pageId)
    throw new Error('검색 결과에서 Enter를 누르면 그 페이지를 열어야 합니다.');
  await page.locator('.bn-editor p').first().waitFor();
  // 대표 이모지를 설정하면 헤더와 사이드바 목록에 보여야 합니다
  await page.locator('.page-icon-area').hover();
  await page.getByRole('button', { name: '페이지 아이콘 추가' }).click();
  await page.locator('.page-icon-popover').waitFor();
  await page.locator('.page-icon-grid button').first().waitFor();
  await page.locator('.page-icon-search input').fill('bulb');
  await page.locator('.page-icon-grid button').first().click();
  await page.locator('.page-icon-button').waitFor();
  if ((await page.locator('.page-icon-button').innerText()).trim() !== '💡')
    throw new Error('선택한 이모지가 페이지 아이콘으로 보여야 합니다.');
  await page.locator('.page-save-state').getByText('저장됨', { exact: true }).waitFor();
  if (!(await page.locator('.sidebar-page-row.active').innerText()).includes('💡'))
    throw new Error('사이드바 페이지 목록에도 설정한 이모지가 보여야 합니다.');
  // 하위 페이지에 이모지를 달면 링크 블록과 사이드바에 보여야 합니다
  const childRecord = (await (await fetch(`${baseUrl}/api/pages/${childId}`)).json()).item;
  const iconResponse = await fetch(`${baseUrl}/api/pages/${childId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: childRecord.title,
      icon: '🧭',
      document: childRecord.document,
      expectedVersion: childRecord.version,
    }),
  });
  if (!iconResponse.ok) throw new Error('하위 페이지 아이콘을 저장하지 못했습니다.');
  await page.reload();
  await page.locator('.page-link-block').waitFor();
  if ((await page.locator('.page-icon-button').innerText()).trim() !== '💡')
    throw new Error('페이지 아이콘은 다시 열어도 남아 있어야 합니다.');
  if ((await page.locator('.page-link-block .page-link-icon').first().innerText()).trim() !== '🧭')
    throw new Error('페이지 링크는 연결된 페이지의 이모지를 보여야 합니다.');
  if (
    (
      await page
        .locator(
          `.sidebar-page-row:has(.sidebar-page-item[href="/pages/${childId}"]) .sidebar-page-icon`,
        )
        .innerText()
    ).trim() !== '🧭'
  )
    throw new Error('사이드바 하위 페이지에도 이모지가 보여야 합니다.');
  await page.locator('.bn-editor p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 되돌릴단어');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  if ((await page.locator('.bn-editor p').first().innerText()).includes('되돌릴단어'))
    throw new Error('⌘Z 되돌리기는 마지막 입력을 되돌려야 합니다.');
  await clickPageTool(page, '다시 실행');
  await page.waitForTimeout(250);
  if (!(await page.locator('.bn-editor p').first().innerText()).includes('되돌릴단어'))
    throw new Error('다시 실행은 되돌린 입력을 복원해야 합니다.');
  await clickPageTool(page, '되돌리기');
  await page.waitForTimeout(250);
  if ((await page.locator('.bn-editor p').first().innerText()).includes('되돌릴단어'))
    throw new Error('되돌리기 버튼도 마지막 입력을 되돌려야 합니다.');
  await page.locator('.bn-editor p').first().click();
  await clickPageTool(page, 'Mermaid');
  for (let attempt = 0; attempt < 60; attempt++) {
    const { item } = await (await fetch(`${baseUrl}/api/pages/${pageId}`)).json();
    if (item.document.blocks.filter((block) => block.type === 'diagram').length >= 2) break;
    if (attempt === 59) throw new Error('Mermaid 버튼으로 새 다이어그램이 저장되지 않았습니다.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await clickPageTool(page, 'Markdown 복사');
  const markdown = await page.evaluate(() => navigator.clipboard.readText());
  if (!markdown.includes('```mermaid') || !markdown.includes('예약 확인'))
    throw new Error('Markdown 복사는 Mermaid와 체크리스트를 포함해야 합니다.');
  await page.locator('.page-save-state').getByText('저장됨', { exact: true }).waitFor();
  const versionBeforeViewing = (await (await fetch(`${baseUrl}/api/pages/${pageId}`)).json()).item
    .version;
  await clickPageTool(page, 'Markdown 보기');
  const source = page.getByRole('textbox', { name: 'Markdown 원문' });
  await source.waitFor();
  const sourceText = await source.inputValue();
  if (!/\| 문법\s+\| 결과/.test(sourceText) || !sourceText.includes('```mermaid'))
    throw new Error('Markdown 보기에서 표와 Mermaid 원문을 확인할 수 있어야 합니다.');
  await clickPageTool(page, 'Markdown 복사');
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== sourceText)
    throw new Error('Markdown 보기에서 복사한 내용은 화면의 원문과 같아야 합니다.');
  await clickPageTool(page, '편집기로 돌아가기');
  if ((await page.locator('.bn-editor').getAttribute('contenteditable')) !== 'true')
    throw new Error('페이지로 돌아오면 본문을 바로 편집할 수 있어야 합니다.');
  if (await page.getByRole('button', { name: '읽기 미리보기' }).count())
    throw new Error('페이지 작성 화면에 별도 읽기 모드가 끼어들면 안 됩니다.');
  await page.waitForTimeout(1050);
  const versionAfterViewing = (await (await fetch(`${baseUrl}/api/pages/${pageId}`)).json()).item
    .version;
  if (versionAfterViewing !== versionBeforeViewing)
    throw new Error('Markdown 보기만으로 저장 버전이 바뀌면 안 됩니다.');
  await page.screenshot({ path: '/tmp/leneu-page-desktop.png', fullPage: true });
  const darkPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  await darkPage.goto(page.url(), { waitUntil: 'networkidle' });
  const darkCanvas = await darkPage
    .locator('html')
    .evaluate((element) =>
      getComputedStyle(element).backgroundColor.match(/\d+/g).slice(0, 3).map(Number),
    );
  if (
    (await darkPage.locator('html').getAttribute('data-theme')) !== 'dark' ||
    Math.max(...darkCanvas) > 75
  )
    throw new Error('시스템 다크 모드는 페이지 바탕까지 어둡게 표시해야 합니다.');
  const darkModeContrast = await darkPage
    .locator('.bn-block-content')
    .first()
    .evaluate((block) => {
      const luminance = (color) => {
        const channels = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map((value) => Number(value) / 255);
        const linear = channels.map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(block).color);
      const background = luminance(getComputedStyle(document.documentElement).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
  if (darkModeContrast < 4.5)
    throw new Error('다크 모드 페이지의 본문 글자가 충분히 읽혀야 합니다.');
  const diagramColors = await darkPage
    .locator('svg[id^="mermaid-preview-"]')
    .first()
    .evaluate((svg) => {
      const node = svg.querySelector('.node rect');
      const edge = svg.querySelector('.flowchart-link');
      return {
        node: node ? getComputedStyle(node).fill.match(/\d+/g)?.slice(0, 3).map(Number) : null,
        edge: edge ? getComputedStyle(edge).stroke.match(/\d+/g)?.slice(0, 3).map(Number) : null,
        label: svg.querySelector('.node .label text')
          ? getComputedStyle(svg.querySelector('.node .label text'))
              .fill.match(/\d+/g)
              ?.slice(0, 3)
              .map(Number)
          : null,
      };
    });
  if (
    !diagramColors.node ||
    Math.max(...diagramColors.node) > 160 ||
    !diagramColors.edge ||
    Math.max(...diagramColors.edge) < 130 ||
    !diagramColors.label ||
    Math.min(...diagramColors.label) < 200
  )
    throw new Error(
      `다크 모드 Mermaid 도형과 연결선 대비가 부족합니다: ${JSON.stringify(diagramColors)}`,
    );
  await darkPage.screenshot({ path: '/tmp/leneu-page-dark.png', fullPage: true });
  await darkPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await darkPage.screenshot({ path: '/tmp/leneu-inbox-dark.png', fullPage: true });
  await darkPage.locator('.capture-card').first().click();
  await darkPage.getByRole('button', { name: '항목 수정' }).click();
  await darkPage.screenshot({ path: '/tmp/leneu-capture-edit-dark.png' });
  await darkPage.close();
  const darkMobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    colorScheme: 'dark',
  });
  await darkMobile.goto(baseUrl, { waitUntil: 'networkidle' });
  await darkMobile.screenshot({ path: '/tmp/leneu-mobile-dark.png' });
  await darkMobile.getByRole('button', { name: '메뉴 열기' }).click();
  await darkMobile
    .getByRole('navigation', { name: '페이지 목록' })
    .getByRole('link', { name: pageTitle })
    .waitFor();
  await darkMobile.waitForFunction(() => {
    const sidebar = document.querySelector('.sidebar');
    return sidebar && sidebar.getBoundingClientRect().left >= -1;
  });
  await darkMobile.screenshot({ path: '/tmp/leneu-mobile-dark-menu.png' });
  await darkMobile.setViewportSize({ width: 320, height: 640 });
  if (await darkMobile.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('320px 다크 모드 메뉴에서 가로 스크롤이 생겼습니다.');
  await darkMobile.close();
  await mobile.goto(page.url(), { waitUntil: 'networkidle' });
  await mobile.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  await mobile.setViewportSize({ width: 320, height: 640 });
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('모바일 페이지 편집기에서 가로 스크롤이 생겼습니다.');
  const titleClipped = await mobile
    .getByRole('textbox', { name: '페이지 제목' })
    .evaluate(
      (field) =>
        field.scrollWidth > field.clientWidth || field.scrollHeight > field.clientHeight + 1,
    );
  if (titleClipped) throw new Error('모바일에서도 긴 페이지 제목이 잘리지 않아야 합니다.');
  if ((await mobile.getByRole('button', { name: /^(바로|이어서) 기록하기$/ }).count()) !== 1)
    throw new Error('모바일 페이지에서도 빠른 입력 버튼이 보여야 합니다.');
  await mobile.getByRole('button', { name: '메뉴 열기' }).click();
  if (
    (await mobile
      .getByRole('navigation', { name: '페이지 목록' })
      .getByRole('link', { name: pageTitle })
      .count()) !== 1
  )
    throw new Error('모바일 메뉴에서 현재 페이지 목록을 볼 수 있어야 합니다.');
  await mobile
    .getByRole('button', { name: '메뉴 닫기' })
    .click({ position: { x: mobile.viewportSize().width - 10, y: 80 } });
  await mobile.screenshot({ path: '/tmp/leneu-page-mobile.png', fullPage: true });
  await mobile.getByRole('button', { name: /^(바로|이어서) 기록하기$/ }).click();
  await mobile.getByRole('dialog', { name: '빠른 기록' }).waitFor();
  if (new URL(mobile.url()).pathname !== '/')
    throw new Error('페이지에서 바로 기록하기를 누르면 같은 앱의 입력함을 열어야 합니다.');
  await page.locator('.page-save-state').getByText('저장됨', { exact: true }).waitFor();
  const stale = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const fresh = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await Promise.all([
    stale.goto(page.url(), { waitUntil: 'networkidle' }),
    fresh.goto(page.url(), { waitUntil: 'networkidle' }),
  ]);
  await stale.getByRole('textbox', { name: '페이지 제목' }).waitFor();
  await fresh.getByRole('textbox', { name: '페이지 제목' }).fill('최신 수정');
  for (let attempt = 0; attempt < 60; attempt++) {
    const { item } = await (await fetch(`${baseUrl}/api/pages/${pageId}`)).json();
    if (item.title === '최신 수정') break;
    if (attempt === 59) throw new Error('첫 번째 탭 수정이 저장되지 않았습니다.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stale.getByRole('textbox', { name: '페이지 제목' }).fill('늦은 수정');
  await stale
    .getByRole('alert')
    .getByText('다른 곳에서 먼저 수정했어요', { exact: false })
    .waitFor();
  const afterConflict = await (await fetch(`${baseUrl}/api/pages/${pageId}`)).json();
  if (afterConflict.item.title !== '최신 수정')
    throw new Error('늦은 탭의 저장이 최신 페이지를 덮었습니다.');
  await stale.reload({ waitUntil: 'networkidle' });
  await stale.getByText('다른 기기에서 수정된 뒤 남은 초안이 있어요.').waitFor();
  if (await stale.getByRole('textbox', { name: '페이지 제목' }).isEditable())
    throw new Error('미저장 초안을 선택하기 전에는 새 입력이 초안을 덮지 않아야 합니다.');
  if (errors.length) throw new Error(errors.join('\n'));
  await runTaskQa(browser, baseUrl);
  await runPromptQa(browser, baseUrl);
  await runDraftQa(browser, baseUrl);
  await runServerPromptQa(browser, baseUrl);
  await runPromptRecoveryQa(browser, baseUrl);
  await runCompactPageQa(browser, baseUrl);
  await runCommentPreviewQa(browser, baseUrl);
  await runMemoLibraryQa(browser, baseUrl, dataDir);
  await runShellRecoveryQa(browser, baseUrl);
  await runPageConnectionQa(browser, baseUrl);
  await runTrashQa(browser, baseUrl);
  await runSearchQa(browser, baseUrl);
  await runAiQa(browser, baseUrl);
  console.log(
    'QA passed: capture, direct page editing, Markdown paste, Mermaid, autosave, mobile, conflict recovery',
  );
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
  await rm(dataDir, { recursive: true, force: true });
}

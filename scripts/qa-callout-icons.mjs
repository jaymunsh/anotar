import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { offlineApp, settleSync } from './fixtures/offline-app.mjs';
import { renderSharedPage } from '../server/publicPage.mjs';

const evidence = resolve('.omo/evidence/callout-icons');
await mkdir(evidence, { recursive: true });
const app = await offlineApp();
const checks = [], errors = [];
const text = value => [{type:'text', text:value, styles:{}}];
const paragraph = (id, value) => ({id, type:'paragraph', props:{backgroundColor:'default',textColor:'default',textAlignment:'left'}, content:text(value), children:[]});
const get = async id => (await (await fetch(app.base + '/api/pages/' + id)).json()).item;
const saved = async (page, id, icon) => {
  for (let i=0;i<200;i++) {
    const item = await get(id);
    if (item.document.blocks[0].props.icon === icon && await page.evaluate(id => !localStorage.getItem('leneu:page-draft:' + id), id)) return item;
    await new Promise(r => setTimeout(r,100));
  }
  throw Error('Icon did not persist: ' + icon);
};
try {
  const {item:created} = await app.request('/api/pages', {title:'콜아웃 아이콘 확인'});
  const {item:seeded} = await app.request('/api/pages/' + created.id, {title:created.title, expectedVersion:created.version,
    document:{schemaVersion:1,blocks:[{id:'icon-box',type:'callout',props:{icon:'info',border:true,backgroundColor:'gray',textColor:'default',textAlignment:'left'},content:text('이 안내의 아이콘을 숨기거나 다시 표시해요.'),children:[paragraph('child-note','하위 내용은 그대로 보존돼요.')]},
      {id:'nested-root',type:'bulletListItem',props:{},content:text('상위 목록'),children:[{id:'nested-child',type:'bulletListItem',props:{},content:text('하위 목록'),children:[]}]},paragraph('last','')]}}, 'PUT');
  const page = await app.browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.base + '/pages/' + seeded.id);
  const box = page.locator('.bn-block-outer[data-id="icon-box"]');
  await box.locator('.callout-content').waitFor();
  async function choose(label) {
    await box.locator('.callout-content').hover();
    await page.locator('[data-test="dragHandle"]').click();
    const trigger = page.getByRole('menuitem', {name:'콜아웃 아이콘',exact:true});
    await trigger.hover();
    await page.getByRole('menuitem', {name:label,exact:true}).click();
  }
  const originalGap = await box.locator('.page-callout').evaluate(el => el.querySelector('.callout-content').getBoundingClientRect().left-el.getBoundingClientRect().left);
  assert.ok(originalGap >= 32);
  await choose('아이콘 없음');
  const hidden = await saved(page,seeded.id,'none');
  assert.deepEqual(hidden.document.blocks[0], {...seeded.document.blocks[0], props:{...seeded.document.blocks[0].props,icon:'none'}});
  assert.equal(await box.locator('.callout-marker').isVisible(),false);
  assert.equal(await box.locator('.page-callout').evaluate(el => el.querySelector('.callout-content').getBoundingClientRect().left-el.getBoundingClientRect().left),0);
  await page.screenshot({path:join(evidence,'desktop-no-icon.png')});
  await page.reload(); await box.locator('.callout-content').waitFor();
  assert.equal(await box.locator('.page-callout').getAttribute('data-icon'),'none');
  checks.push('Dot menu hides icon and gutter; content, style and children survive save/reload');
  await choose('주의');
  await settleSync(page);
  await saved(page,seeded.id,'warning');
  assert.equal(await box.locator('.callout-marker').isVisible(),true);
  await page.reload(); await box.locator('.callout-content').waitFor();
  assert.equal(await box.locator('.page-callout').getAttribute('data-icon'),'warning');
  checks.push('Same menu restores a chosen icon and persists it');
  await box.getByRole('button',{name:'콜아웃 모양',exact:true}).click();
  await box.locator('.callout-appearance:popover-open').getByRole('button',{name:'아이콘 없음',exact:true}).click();
  await settleSync(page);
  await saved(page,seeded.id,'none');
  assert.equal(await page.locator('.callout-appearance:popover-open').count(),0);
  checks.push('Existing appearance picker also collapses icon gutter and closes safely');
  const guide = await page.locator('.bn-block-outer[data-id="nested-child"]').evaluate(el => {
    const s=getComputedStyle(el,'::before'); return {content:s.content,border:s.borderLeft,background:s.backgroundColor};
  });
  const mobile = await app.browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'dark'});
  mobile.on('pageerror',error => errors.push(error.message));
  await mobile.goto(app.base + '/pages/' + seeded.id);
  await mobile.locator('.page-callout').waitFor();
  assert.equal(await mobile.locator('.page-callout').evaluate(el => el.querySelector('.callout-content').getBoundingClientRect().left-el.getBoundingClientRect().left),0);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
  await mobile.screenshot({path:join(evidence,'mobile-dark-no-icon.png')});
  checks.push('390px dark mobile: no hidden gutter or horizontal overflow');
  const reader = await app.browser.newPage({viewport:{width:1000,height:800}});
  const final = await get(seeded.id);
  await reader.setContent(renderSharedPage(final,'temporary-token'));
  await reader.addStyleTag({path:resolve('public/document.css')});
  await reader.addStyleTag({path:resolve('public/callout.css')});
  assert.equal(await reader.locator('.callout-marker').count(),0);
  assert.equal(await reader.locator('.callout-children').evaluate(el => getComputedStyle(el).marginLeft),'0px');
  await reader.screenshot({path:join(evidence,'shared-no-icon.png')});
  checks.push('Shared reader: no icon, nested content aligns without an empty icon gutter');
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,'result.json'),JSON.stringify({checks,guide,errors},null,2));
  console.log(JSON.stringify({checks,guide,errors},null,2));
} finally { await app.close(); }

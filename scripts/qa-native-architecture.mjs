import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openStore } from '../server/store.mjs';
import { ensureArchitecturePage } from './seed-architecture.mjs';
import { offlineApp } from './fixtures/offline-app.mjs';

const evidence = resolve('.omo/evidence/native-architecture');
await mkdir(evidence, { recursive: true });
const app = await offlineApp();
const store = openStore(app.dir), errors = [], checks = [];
let publicServer;
try {
  const document = await ensureArchitecturePage(store);
  const { token } = store.createPageShare(document.id);
  const holder = createServer(); await new Promise(r => holder.listen(0, '127.0.0.1', r));
  const port = holder.address().port; await new Promise(r => holder.close(r));
  const publicBase = `http://127.0.0.1:${port}`;
  publicServer = spawn(process.execPath, ['server/public.mjs'], { env: { ...process.env, DATA_DIR: app.dir, PUBLIC_PORT: String(port), PUBLIC_HOST: '127.0.0.1' }, stdio: 'ignore' });
  for (let i=0;i<100;i++) { try { if ((await fetch(publicBase+'/health')).ok) break; } catch {} await new Promise(r=>setTimeout(r,50)); }
  for (const [name, width, theme] of [['desktop',1440,'light'],['desktop-dark',1440,'dark'],['mobile',390,'light'],['mobile-dark',320,'dark']]) {
    const context = await app.browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(app.base + '/pages/' + document.id);
    await page.locator('.bn-editor').waitFor();
    await page.locator('.page-icon-button').click();
    const search = page.locator('.page-icon-search input'); await search.fill('s');
    await page.locator('.page-icon-grid button').first().waitFor();
    await page.locator('.page-icon-scroll').evaluate(el => { el.scrollTop = 2200; });
    const geometry = await page.locator('.page-icon-scroll').evaluate(el => {
      const rect=el.getBoundingClientRect();
      return { width:el.clientWidth,scrollWidth:el.scrollWidth,thin:getComputedStyle(el).scrollbarWidth,
        clipped:[...el.querySelectorAll('.page-icon-grid button')].some(b => b.getBoundingClientRect().right > rect.left + el.clientWidth + .5),
        minimumHeight:Math.min(...[...el.querySelectorAll('.page-icon-grid button')].map(b=>b.getBoundingClientRect().height)),
        panelRight:el.closest('.page-icon-popover').getBoundingClientRect().right };
    });
    assert.equal(geometry.clipped,false, name+' icons stay inside the scrollable content');
    assert.equal(geometry.scrollWidth,geometry.width, name+' no concealed horizontal overflow');
    assert.equal(geometry.thin,'thin'); assert.ok(geometry.panelRight<=width+.5);
    if(width<400)assert.ok(geometry.minimumHeight>=44);
    await page.screenshot({ path:join(evidence,name+'-icons.png') });
    await page.keyboard.press('Escape');
    if(width<400)await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
    await page.getByRole('button',{name:'설정 열기',exact:true}).click();
    await page.getByRole('button',{name:'서비스 정보',exact:true}).click();
    const settings=page.locator('.workspace-settings');
    const link=settings.getByRole('link',{name:/기술 아키텍처/});
    await settings.locator('a[href="/pages/'+document.id+'"]').waitFor();
    assert.equal(await link.getAttribute('href'),'/pages/'+document.id);
    await page.screenshot({path:join(evidence,name+'-settings.png')});
    await page.getByRole('button',{name:'설정 닫기',exact:true}).click();
    await page.screenshot({path:join(evidence,name+'-document.png')});
    await page.goto(publicBase+'/s/'+token);
    await page.getByRole('heading',{name:'1. 현재 운영 구조',exact:true}).waitFor();
    assert.ok(await page.getByRole('navigation',{name:'목차',exact:true}).isVisible());
    assert.ok(await page.locator('body').innerText().then(s=>s.includes('server/index.mjs')));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:join(evidence,name+'-share.png')});
    checks.push({name,width,theme,geometry}); await context.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,'result.json'),JSON.stringify({checks,errors},null,2));
  console.log('PASS: icon clipping, subtle scrollbars, mobile targets, native settings link, ordinary public page; 1440/390/320 light/dark');
} finally {
  if (publicServer) { publicServer.kill(); if(publicServer.exitCode===null)await new Promise(r=>publicServer.once('exit',r)); }
  store.close(); await app.close();
}

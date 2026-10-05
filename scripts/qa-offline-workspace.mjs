import assert from 'node:assert/strict';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';
const app=await offlineApp();
try{
 const {item}=await app.request('/api/pages',{title:'서울 여행 한글 검색'});
 const context=await app.browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();await page.goto(app.base+'/pages/'+item.id);await page.getByLabel('페이지 제목',{exact:true}).waitFor();await prepareShell(page);await context.setOffline(true);
 await page.keyboard.press('Meta+k');await page.getByLabel('통합 검색어',{exact:true}).fill('서울 여행');await page.getByText('이 기기에 보관한 항목',{exact:true}).waitFor({timeout:5000});await page.getByRole('option').filter({hasText:'서울 여행 한글 검색'}).waitFor();await page.keyboard.press('Escape');
 const share=page.getByRole('button',{name:'페이지 공유',exact:true});assert.equal(await share.isDisabled(),true);assert.match(await share.getAttribute('title'),/연결/);
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.getByLabel('페이지 제목',{exact:true}).fill('오프라인 긴 제목 한글과 URL https://example.com/trip');await page.getByText('기기에 저장됨',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 console.log('PASS offline workspace: local search scope/Korean result, online-only share reason, local title editing at 390/320 without horizontal overflow');
}finally{await app.close();}

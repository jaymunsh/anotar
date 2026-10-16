import assert from 'node:assert/strict';
import { offlineApp, prepareShell } from './fixtures/offline-app.mjs';
const app=await offlineApp();
try {
 const {item:created}=await app.request('/api/pages',{title:'오프라인 여행 안내'});
 await app.request('/api/pages/'+created.id,{title:created.title,icon:'',expectedVersion:created.version,document:{schemaVersion:1,blocks:[{id:'reading',type:'paragraph',props:{},content:[{type:'text',text:'기기에 보관한 여행 본문',styles:{}}],children:[]}]}},'PUT');
 const {item:uncached}=await app.request('/api/pages',{title:'아직 보관 안 한 페이지'});
 const context=await app.browser.newContext(),page=await context.newPage();await page.goto(app.base+'/pages/'+created.id);await page.getByText('기기에 보관한 여행 본문',{exact:true}).waitFor();await prepareShell(page);
 await page.getByLabel('페이지 정보',{exact:true}).click();await page.getByRole('button',{name:'이 페이지 오프라인 보관',exact:true}).click();await page.getByText('문서·직접 첨부 오프라인 사용 가능',{exact:true}).waitFor();
 await context.setOffline(true);await page.reload();await page.getByText('기기에 보관한 여행 본문',{exact:true}).waitFor();
 await page.goto(app.base+'/pages/'+uncached.id);await page.getByRole('alert').filter({hasText:'이 기기에 보관하지 않은 페이지예요.'}).waitFor({timeout:5000}).catch(async error=>{console.log(await page.locator('body').innerText());throw error;});
 assert.equal(await page.locator('.bn-editor').count(),0);
 console.log('PASS page UI: menu pin, offline reload readable, uncached explicit state without empty editor');
}finally{await app.close();}

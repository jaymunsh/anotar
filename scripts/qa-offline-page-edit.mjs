import assert from 'node:assert/strict';
import { offlineApp, prepareShell, settleSync } from './fixtures/offline-app.mjs';
const app=await offlineApp();
try{
 const {item}=await app.request('/api/pages',{title:'원본 문서'});
 const a=await app.browser.newContext(),b=await app.browser.newContext(),pa=await a.newPage(),pb=await b.newPage();
 for(const page of [pa,pb]){await page.goto(app.base+'/pages/'+item.id);await page.getByLabel('페이지 제목',{exact:true}).waitFor();await prepareShell(page);}
 await a.setOffline(true);await b.setOffline(true);
 await pa.getByLabel('페이지 제목',{exact:true}).fill('첫 번째 기기 수정');await pb.getByLabel('페이지 제목',{exact:true}).fill('두 번째 기기 수정');
 for(const page of [pa,pb])await page.getByText('기기에 저장됨',{exact:true}).waitFor({timeout:5000});
 await pb.reload();assert.equal(await pb.getByLabel('페이지 제목',{exact:true}).inputValue(),'두 번째 기기 수정');
 await a.setOffline(false);await settleSync(pa);assert.equal((await(await fetch(app.base+'/api/pages/'+item.id)).json()).item.title,'첫 번째 기기 수정');
 await b.setOffline(false);await pb.getByRole('button',{name:'동기화 상태',exact:true}).click();await pb.getByRole('button',{name:'지금 동기화',exact:true}).click();await pb.getByRole('button',{name:'동기화 상태 닫기'}).click();
 await pb.getByText('다른 기기에서 수정했어요',{exact:true}).waitFor();
 assert.equal(await pb.getByLabel('페이지 제목',{exact:true}).inputValue(),'두 번째 기기 수정');
 await pb.getByRole('button',{name:'서버 내용 보기',exact:true}).click();await pb.getByText('첫 번째 기기 수정',{exact:true}).last().waitFor();
 await pb.getByRole('button',{name:'새 페이지로 보관',exact:true}).click();
 await pb.waitForURL(/\/pages\/(?!undefined)[a-f0-9-]+$/);await pb.getByLabel('페이지 제목',{exact:true}).waitFor();
 await settleSync(pb);
 const pages=(await(await fetch(app.base+'/api/pages')).json()).items;assert.equal(pages.length,2);assert.ok(pages.some(p=>p.title.includes('두 번째 기기 수정')));
 console.log('PASS offline page edit: two profiles local/reload, version conflict retains editor, server preview, fork creates separate page');
}finally{await app.close();}

import test from 'node:test';
import assert from 'node:assert/strict';
import {documentTitle,defaultDocumentTitle} from '../shared/documentTitle.ts';
import {renderSharedPage} from '../server/publicPage.mjs';
test('document titles use branded fallback or trimmed page title',()=>{
 for(const title of [undefined,null,'','  ','제목 없음']) assert.equal(documentTitle(title),defaultDocumentTitle);
 assert.equal(documentTitle('  구조 안내  '),'구조 안내 | anotar');
 const html=renderSharedPage({title:'<구조 & 안내>',updatedAt:'2026-10-06',document:{schemaVersion:1,blocks:[]}},'test');
 assert.match(html,/<title>&lt;구조 &amp; 안내&gt; \| anotar<\/title>/);
});

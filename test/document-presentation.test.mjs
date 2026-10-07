import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSharedPage} from '../server/publicPage.mjs';
const text=value=>[{type:'text',text:value,styles:{}}];
const block=(type,content=[],props={},children=[])=>({id:type+'-id',type,content,props,children});
const render=blocks=>renderSharedPage({title:'구조 문서',icon:'🧭',updatedAt:'2026-10-06T00:00:00Z',document:{schemaVersion:1,blocks}},'fixture');
test('shared diagrams preserve escaped source and load a same-origin reader only when visible',()=>{
 const html=render([block('diagram',text('flowchart LR\n A["</code><script>alert(1)</script>"] --> B'))]);
 assert.match(html,/class="document-diagram"/);
 assert.match(html,/class="diagram-source"/);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>alert/);
 assert.match(html,/type="module" src="\/share-viewer\/entry.js"/);
 assert.doesNotMatch(render([block('paragraph',text('문서'))]),/share-viewer\/entry.js/);
 assert.doesNotMatch(render([block('page',[],{},[block('diagram',text('private graph'))])]),/private graph|share-viewer\/entry.js/);
});
test('shared documents retain authored heading level, alignment, icon and table header choices',()=>{
 const html=render([block('heading',text('제목'),{level:2,textAlignment:'center'}),block('codeBlock',text('npm run dev')),block('table',{type:'tableContent',rows:[{cells:[text('first')]}]})]);
 assert.match(html,/class="shared-document"/);
 assert.match(html,/class="shared-document-icon"[^>]*>🧭/);
 assert.match(html,/data-heading-level="2"/);
 assert.match(html,/data-text-alignment="center"/);
 assert.match(html,/<pre data-document-code/);
 assert.match(html,/<td[^>]*>first<\/td>/);
 assert.doesNotMatch(html,/<th[^>]*>first/);
 assert.match(render([block('table',{type:'tableContent',headerRows:1,rows:[{cells:[text('head')]}]})]),/<th scope="col">head<\/th>/);
});
test('numbered lists show numbers and restart after another block',()=>{
 const html=render([block('numberedListItem',text('one')),block('numberedListItem',text('two')),block('paragraph',text('break')),block('numberedListItem',text('again'))]);
 const markers=[...html.matchAll(/<span aria-hidden="true">(\d+\.)<\/span>/g)].map(m=>m[1]);
 assert.deepEqual(markers,['1.','2.','1.']);
});

test('authored list start and row header scope survive sharing',()=>{
 const html=render([block('numberedListItem',text('five'),{start:5}),block('numberedListItem',text('six'))]);
 assert.deepEqual([...html.matchAll(/<span aria-hidden="true">(\d+\.)<\/span>/g)].map(m=>m[1]),['5.','6.']);
 assert.match(render([block('table',{type:'tableContent',headerCols:1,rows:[{cells:[text('head')]}]})]),/<th scope="row">head<\/th>/);
});
test('code language is escaped and shared highlighting loads only for visible code',()=>{
 const html=render([block('codeBlock',text('const n = "<script>";'),{language:'javascript'})]);
 assert.match(html,/data-language="javascript"/);
 assert.match(html,/share-viewer\/entry.js/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/aria-label="문서 글꼴"/);
 assert.doesNotMatch(render([block('page',[],{},[block('codeBlock',text('secret'))])]),/secret|share-viewer\/entry.js/);
 const hostile=render([block('codeBlock',text('safe'),{language:'"><img src=x>'})]);
 assert.doesNotMatch(hostile,/<img src=x>/);
});

test('shared pages render the authored table of contents without adding an automatic outline',()=>{
 const blocks=Array.from({length:6},(_,i)=>({id:'heading-'+i,type:'heading',props:{level:i%2+1},content:[{type:'text',text:'제목 <'+i+'>',styles:{}}],children:[]}));
 const page={title:'안내',updatedAt:'2026-10-06',document:{schemaVersion:1,blocks}};
 const html=renderSharedPage(page,'fixture');
 assert.ok(!html.includes('data-reading-outline'));
 assert.ok(!html.includes('aria-label="목차"'));
 assert.ok(html.includes('제목 &lt;0&gt;'));
 const authored=renderSharedPage({...page,document:{...page.document,blocks:[{id:'toc',type:'tableOfContents',props:{},children:[]},...blocks]}},'fixture');
 assert.equal((authored.match(/aria-label="목차"/g)||[]).length,1);
 assert.ok(authored.includes('href="#block-heading-0"'));
 assert.ok(!authored.includes('data-reading-outline'));
});

test('TOC depth only filters navigation, preserving lower-level headings in the document',()=>{
 const headings=[1,2,3].map(level=>({...block('heading',text(`절 ${level}`),{level}),id:`h${level}`}));
 const html=render([block('tableOfContents',[],{maxLevel:1}),...headings]);
 assert.match(html,/href="#block-h1"/);
 assert.doesNotMatch(html,/href="#block-h[23]"/);
 assert.match(html,/data-heading-level="3"/);
 const full=render([block('tableOfContents'),...headings]);
 assert.equal((full.match(/class="page-toc-item"/g)||[]).length,3);
});
test('legacy compact TOCs use the same single-column navigation as default TOCs',()=>{
 const heading={...block('heading',text('절 1'),{level:1}),id:'h1'};
 const normal=render([block('tableOfContents',[],{maxLevel:1}),heading]);
 const legacy=render([block('tableOfContents',[],{compact:true,maxLevel:1}),heading]);
 assert.equal(legacy,normal);
 assert.match(legacy,/data-layout="list"/);
 assert.match(legacy,/href="#block-h1"/);
});
test('shared tables retain fitted column proportions without fixed desktop pixel widths',()=>{
 const html=render([block('table',{type:'tableContent',columnWidths:[200,400],rows:[{cells:[text('이름'),text('설명')]}]})]);
 assert.match(html,/<col style="width:33.333%">/);
 assert.match(html,/<col style="width:66.667%">/);
 assert.match(html,/width:100%;table-layout:fixed/);
 const legacy=render([block('table',{type:'tableContent',columnWidths:[null,null],rows:[{cells:[text('이름'),text('설명')]}]})]);
 assert.doesNotMatch(legacy,/<colgroup>/);
});

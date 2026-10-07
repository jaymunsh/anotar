import { putPendingShare, MAX_TOTAL_BYTES } from './capture-store.js';

const APP_VERSION = '__LENEU_OFFLINE_VERSION__';
const CACHE_NAME = 'leneu-shell-v1-' + APP_VERSION;
const READY_URL = new URL('/__leneu_shell_ready__', self.location.origin).href;
const APP_ROUTES = /^(?:\/(?:capture|captures|memo|tasks|ai|comments|prompts|backups|trash|pages|journal|hosting)(?:\/[^?#]*)?|\/)$/;
const ASSET_ROUTES = /^(?:\/assets\/[^?#]+|\/fonts\/[A-Za-z0-9_-]+\.(?:woff2|txt)|\/document-fonts\.css|\/index\.html|\/architecture\.html|\/favicon\.png|\/profile\.png|\/capture\.webmanifest|\/capture-store\.js|\/capture-icons\/icon-(?:192|512)\.png)$/;
async function installShell(){
  const response=await fetch('/offline-manifest.json',{cache:'no-store'});
  if(!response.ok)throw Error('Offline manifest unavailable');
  const manifest=await response.json();
  if(manifest.appVersion!==APP_VERSION||!Array.isArray(manifest.assets)||!manifest.assets.length)throw Error('Offline build mismatch');
  const cache=await caches.open(CACHE_NAME);
  if(await cache.match(READY_URL))return;
  try {
    for(const asset of manifest.assets){
      if(!ASSET_ROUTES.test(asset.url)||!/^[a-f0-9]{64}$/.test(asset.hash))throw Error('Invalid offline asset');
      const file=await fetch(asset.url,{cache:'no-store'});if(!file.ok)throw Error('Offline asset missing');
      const bytes=await file.clone().arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(digest!==asset.hash)throw Error('Offline asset hash mismatch');await cache.put(asset.url,file);
    }
    await cache.put(READY_URL,new Response(JSON.stringify({appVersion:APP_VERSION}),{headers:{'Content-Type':'application/json'}}));
  }catch(error){await caches.delete(CACHE_NAME);throw error;}
}
self.addEventListener('install',event=>event.waitUntil(installShell()));
// First install activates naturally. Later versions wait for explicit activation; old caches remain available to old tabs.
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE_SHELL')event.waitUntil(self.skipWaiting());
  if(event.data?.type==='SHELL_STATUS')event.waitUntil((async()=>{const cache=await caches.open(CACHE_NAME);event.ports[0]?.postMessage({ready:Boolean(await cache.match(READY_URL)),appVersion:APP_VERSION});})());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname==='/capture/share'&&event.request.method==='POST'){event.respondWith(receiveShare(event.request));return;}
  if(event.request.method!=='GET'||url.pathname.startsWith('/api/')||url.pathname.startsWith('/s/'))return;
  if(ASSET_ROUTES.test(url.pathname))event.respondWith((async()=>{const cache=await caches.open(CACHE_NAME);return await cache.match(event.request,{ignoreSearch:true})||fetch(event.request);})());
  else if(event.request.mode==='navigate'&&APP_ROUTES.test(url.pathname))event.respondWith((async()=>{
    try{const response=await fetch(event.request);if(response.ok)return response;}catch{/* prepared navigation fallback only */}
    const cache=await caches.open(CACHE_NAME);if(await cache.match(READY_URL)){const index=await cache.match('/index.html');if(index)return index;}
    return new Response('아직 오프라인 준비를 마치지 못했어요. 연결 후 다시 열어 주세요.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
});

async function receiveShare(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!/^multipart\/form-data;/i.test(contentType) || !request.body) throw new Error('공유 형식을 확인해 주세요. 원본 앱에서 다시 공유해 주세요.');
    // Enforce the body limit before parsing, including chunked bodies without Content-Length.
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_TOTAL_BYTES + 128 * 1024) {
        await reader.cancel();
        throw new Error('공유 파일 전체는 100MB까지 가져올 수 있어요.');
      }
      chunks.push(value);
    }
    const form = await new Response(new Blob(chunks), { headers: { 'Content-Type': contentType } }).formData();
    const field = (key) => {
      const values = form.getAll(key);
      if (values.length > 1 || values.some((value) => typeof value !== 'string')) throw new Error('공유 내용 형식을 확인해 주세요.');
      return values[0] || '';
    };
    const id = await putPendingShare({ title: field('title'), text: field('text'), url: field('url'), files: form.getAll('files') });
    return Response.redirect(new URL(`/capture?share=${encodeURIComponent(id)}`, self.location.origin).href, 303);
  } catch (error) {
    // Incoming content never becomes HTML and no failed import is reported as saved.
    return Response.redirect(new URL(`/capture?shareError=${encodeURIComponent(error.message || '공유 내용을 가져오지 못했어요. 다시 공유하거나 붙여넣어 주세요.')}`, self.location.origin).href, 303);
  }
}

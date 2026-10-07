export type AppFont = 'default' | 'pretendard' | 'ridibatang';
export function savedAppFont(): AppFont {
  try {
    const saved=localStorage.getItem('leneu:app-font');
    if(saved==='default'||saved==='pretendard'||saved==='ridibatang')return saved;
    const old=JSON.parse(localStorage.getItem('leneu:page-view')||'{}').font;
    if(old==='pretendard'||old==='ridibatang')return old;
  } catch {}
  return 'default';
}
export function applyAppFont(font:AppFont){
 document.documentElement.dataset.appFont=font;
 try{localStorage.setItem('leneu:app-font',font);}catch{}
}
applyAppFont(savedAppFont());
window.addEventListener('storage',event=>{if(event.key==='leneu:app-font')document.documentElement.dataset.appFont=savedAppFont();});

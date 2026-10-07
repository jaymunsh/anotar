export const defaultDocumentTitle = 'anotar | 나만의 워크스페이스';
export function documentTitle(title?:string|null):string {
 const value=title?.trim();
 return !value || value==='제목 없음' ? defaultDocumentTitle : `${value} | anotar`;
}

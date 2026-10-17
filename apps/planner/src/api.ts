import {getLanguage} from './i18n';
export type Site = {legal:{operator:string;representative:string;businessNumber:string;address:string;contact:string;privacyContact:string;publishedAt:string;hostingRegion:string};legalReady:boolean;registration:boolean;termsVersion:string};
export type User = {id:string;username:string;timezone:string};
export type Plan = {id:string;title:string;start:number;end:number;status:'pending'|'partial'|'done'|'deferred'|'cancelled'|'missed';priorityId?:string;planningId?:string};
export type Entry = {id:string;title:string;start:number;end:number;planId?:string};
export type Day = {plans:Plan[];entries:Entry[];notes:{thoughts:string;ideas:string;review:string};priorities?:{id:string;text:string;done:boolean}[]};
export type Routine={id:string;kind:'routine';title:string;version:number};
export type PlanningItem={id:string;kind:'goal'|'step';title:string;startMonth:string;endMonth:string;note:string;parentId:string|null;version:number};
export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function request<T>(path:string,method='GET',data?:unknown,csrf?:string):Promise<T> {
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const value=await response.json();if(!response.ok) throw new ApiError(response.status,value.message||'요청하지 못했어요. 다시 시도해 주세요.');return value;
}
export const emptyDay=():Day=>({plans:[],entries:[],notes:{thoughts:'',ideas:'',review:''}});
export const clock=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
export const duration=(minutes:number)=>getLanguage()==='en'?`${Math.floor(minutes/60)?`${Math.floor(minutes/60)} hr `:''}${minutes%60?`${minutes%60} min`:''}`.trim()||'0 min':`${Math.floor(minutes/60)?`${Math.floor(minutes/60)}시간 `:''}${minutes%60?`${minutes%60}분`:''}`.trim()||'0분';
export function recorded(entries:Entry[]) {let total=0,end=-1;for(const e of [...entries].sort((a,b)=>a.start-b.start)){total+=Math.max(0,e.end-Math.max(end,e.start));end=Math.max(end,e.end);}return total;}
export const today=(timezone='Asia/Seoul')=>new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(new Date());
export function download(name:string,value:unknown) {const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

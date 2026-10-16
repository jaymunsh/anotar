import {useEffect,useId,useRef} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {pair} from '../i18n';
import {Entry,Plan,PlanningItem} from '../api';
import {Editor,ItemForm} from '../planner';

export function ActivityDialog({editor,planning,disabled,onClose,onSave,onDelete,onDirty}:{editor:Editor;planning:PlanningItem[];disabled:boolean;onClose:()=>void;onSave:(value:Plan|Entry)=>void;onDelete:()=>void;onDirty:(dirty:boolean)=>void}){
 const ref=useRef<HTMLDialogElement>(null),titleId=useId();
 useEffect(()=>{const dialog=ref.current!,previous=document.activeElement as HTMLElement|null;dialog.showModal();dialog.querySelector<HTMLInputElement>('#item-title')?.focus();return()=>{dialog.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 return createPortal(<dialog ref={ref} className="activity-dialog" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}>
  <button className="activity-close" type="button" aria-label={pair('닫기','Close')} onClick={onClose}><X size={20}/></button>
  <fieldset disabled={disabled}><ItemForm headingId={titleId} editor={editor} planning={planning} onSave={onSave} onDelete={onDelete} onCancel={onClose} onDirty={onDirty}/></fieldset>
 </dialog>,document.body);
}

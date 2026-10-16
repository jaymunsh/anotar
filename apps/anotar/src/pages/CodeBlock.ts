import {createCodeBlockSpec, plainContentToString} from '@blocknote/core';
import type {ViewMutationRecord} from '@tiptap/pm/view';
import {codeLanguages} from '../code/languages';
import {createCodeCopyButton} from '../code/copy';
const supportedLanguages={...codeLanguages};
export function createDocumentCodeBlockSpec(){
 const spec=createCodeBlockSpec({supportedLanguages});
 const render=spec.implementation.render;
 spec.implementation.render=function(block,editor){
  // Legacy/custom language IDs stay readable and editable; never rewrite stored props.
  const result=block.props.language in supportedLanguages
   ? render.call(this,block,editor)
   : createCodeBlockSpec({supportedLanguages:{...supportedLanguages,[block.props.language]:{name:block.props.language || '일반 텍스트'}}}).implementation.render.call(this,block,editor);
  const select=result.dom.querySelector('select');
  select?.setAttribute('aria-label','코드 언어');
  if(select) select.disabled=!editor.isEditable;
  const toolbar=select?.parentElement;
  const copy=createCodeCopyButton(() => {
   const current=editor.getBlock(block.id);
   return current ? plainContentToString(current.content) : '';
  });
  toolbar?.append(copy.dom);
  const destroy=result.destroy;
  return {...result,
   // Toolbar status belongs to this node view, not the editable document.
   // Keep content/selection mutations visible to ProseMirror (including IME).
   ignoreMutation:(mutation:ViewMutationRecord)=>mutation.type !== 'selection' && copy.dom.contains(mutation.target),
   destroy:()=>{copy.destroy();destroy?.();},
  };
 };
 return spec;
}

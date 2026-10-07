import { observeDiagramTheme, renderDiagram } from './render';
import { openDiagramViewer } from './viewer';

for (const figure of document.querySelectorAll<HTMLElement>('figure.document-diagram')) {
  const source = figure.querySelector('pre.diagram-source > code')?.textContent || '';
  const preview = figure.querySelector<HTMLElement>('.diagram-preview');
  if (!preview || !source.trim()) continue;
  const toolbar = document.createElement('div');
  toolbar.className = 'diagram-toolbar';
  const label = document.createElement('span');
  label.textContent = 'Mermaid';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '확대 보기';
  button.disabled = true;
  toolbar.append(label, button);
  preview.before(toolbar);
  let svg = '',
    generation = 0;
  button.addEventListener('click', () => {
    if (svg) openDiagramViewer(svg, button);
  });
  const render = async () => {
    const current = ++generation;
    preview.setAttribute('aria-busy', 'true');
    try {
      const result = await renderDiagram(source);
      if (current !== generation) return;
      svg = result;
      preview.innerHTML = svg;
      button.disabled = false;
      figure.dataset.diagramState = 'ready';
    } catch {
      if (current !== generation) return;
      svg = '';
      button.disabled = true;
      preview.textContent = '다이어그램을 표시할 수 없습니다. 아래 원문을 확인해 주세요.';
      figure.dataset.diagramState = 'error';
    } finally {
      if (current === generation) preview.removeAttribute('aria-busy');
    }
  };
  observeDiagramTheme(() => {
    void render();
  });
  void render();
}

// Code highlighting is lazy and never evaluates the source being displayed.
if (document.querySelector('pre[data-document-code][data-language]')) {
 void import('../code/highlighter').then(async ({documentHighlighter}) => {
  const {codeLanguage}=await import('../code/languages');
  const highlighter=await documentHighlighter();
  for(const pre of document.querySelectorAll<HTMLElement>('pre[data-document-code]')) {
   const code=pre.querySelector('code');if(!code)continue;
   const source=code.textContent || '';if(source.length>50000)continue;
   try {
    const {tokens}=highlighter.codeToTokens(source,{lang:codeLanguage(pre.dataset.language || 'text'),themes:{light:'github-light',dark:'github-dark'},defaultColor:false});
    const fragment=document.createDocumentFragment();
    tokens.forEach((line,i)=>{if(i)fragment.append('\n');for(const token of line){const span=document.createElement('span');span.textContent=token.content;if(token.htmlStyle)for(const [key,value] of Object.entries(token.htmlStyle))span.style.setProperty(key,String(value));fragment.append(span);}});
    code.replaceChildren(fragment);pre.dataset.highlighted='true';
   }catch { /* Unknown or malformed grammars retain escaped, selectable source. */ }
  }
 }).catch(()=>{});
}

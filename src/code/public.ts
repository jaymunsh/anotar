import { createCodeCopyButton } from './copy';

// A classic script keeps this small control usable in downloaded file:// HTML.
for (const pre of document.querySelectorAll<HTMLElement>('pre[data-document-code]')) {
  const code = pre.querySelector('code');
  if (!code) continue;
  const toolbar = document.createElement('div');
  toolbar.className = 'document-code-toolbar';
  const language = pre.querySelector('.shared-code-language');
  if (language) toolbar.append(language);
  toolbar.append(createCodeCopyButton(() => code.textContent || '').dom);
  pre.prepend(toolbar);
}

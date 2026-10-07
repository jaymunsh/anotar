import DOMPurify from 'dompurify';

export const MAX_DIAGRAM_LENGTH = 20000;
let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();

export function diagramTheme(): 'dark' | 'light' {
  const explicit = document.documentElement.dataset.theme;
  return explicit === 'dark' || (!explicit && matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark'
    : 'light';
}

export function validateDiagramSource(source: string): void {
  if (source.length > MAX_DIAGRAM_LENGTH)
    throw new Error('다이어그램은 20,000자까지 미리 볼 수 있습니다.');
  if (/%%\s*\{|^\s*---/m.test(source))
    throw new Error('설정 지시문 없이 다이어그램 본문만 작성해 주세요.');
  // Mermaid inserts SVG into the DOM while measuring. Block CSS escapes/comments
  // before that stage; post-render sanitization cannot undo a resource request.
  if (/[\\@]|\/\*/.test(source) || /\b(?:classDef|linkStyle|style)\b/i.test(source))
    throw new Error('사용자 지정 스타일과 이스케이프 없이 작성해 주세요. 줄바꿈은 <br/>를 사용할 수 있습니다.');
  if (
    /(?:https?:|data:|javascript:|file:|@import|url\s*\(|\bimg\s*:)/i.test(source) ||
    /<\/?[a-z!]/i.test(source.replace(/<br\s*\/?\s*>/gi, ''))
  ) {
    throw new Error('외부 리소스와 HTML을 포함한 다이어그램은 미리 볼 수 없습니다.');
  }
}

/** A second boundary after Mermaid strict mode: only local, inert SVG survives. */
export function sanitizeDiagramSVG(raw: string): string {
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'foreignObject',
      'image',
      'script',
      'animate',
      'animateMotion',
      'animateTransform',
      'set',
    ],
    FORBID_ATTR: ['target'],
  });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.localName !== 'svg' || doc.querySelector('parsererror'))
    throw new Error('다이어그램을 표시할 수 없습니다.');
  const id = svg.id;
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    if (element.localName === 'a') {
      element.replaceWith(...element.childNodes);
      continue;
    }
    if (element.localName === 'style') {
      const sheet = new CSSStyleSheet();
      try {
        sheet.replaceSync(element.textContent || '');
        element.textContent = Array.from(sheet.cssRules)
          .filter((rule) => {
            if (!(rule instanceof CSSStyleRule)) return false;
            return (
              Boolean(id) &&
              !/[+~]/.test(rule.selectorText) &&
              rule.selectorText
                .split(',')
                .every(
                  (selector) =>
                    selector.trim() === `#${id}` ||
                    selector.trim().startsWith(`#${id} `) ||
                    selector.trim().startsWith(`#${id}:`),
                ) &&
              !/url\s*\(|@|\\/i.test(rule.style.cssText)
            );
          })
          .map((rule) => rule.cssText)
          .join('\n');
      } catch {
        element.remove();
      }
    }
    for (const attr of Array.from(element.attributes)) {
      const value = attr.value;
      const externalURL = Array.from(value.matchAll(/url\s*\(([^)]*)\)/gi)).some(
        (match) => !/^#[\w-]+$/.test(match[1].trim().replace(/^['"]|['"]$/g, '')),
      );
      if (
        externalURL ||
        /^on/i.test(attr.name) ||
        ((attr.localName === 'href' || attr.name === 'src') && !/^#[\w-]+$/.test(value)) ||
        /(?:@import|javascript:|data:|\\)/i.test(value)
      )
        element.removeAttribute(attr.name);
    }
  }
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '다이어그램');
  svg.removeAttribute('height');
  return new XMLSerializer().serializeToString(svg);
}

export function renderDiagram(source: string, theme = diagramTheme()): Promise<string> {
  try {
    validateDiagramSource(source);
  } catch (error) {
    return Promise.reject(error);
  }
  const job = queue
    .catch(() => {})
    .then(async () => {
      const { default: mermaid } = await import('mermaid');
      await document.fonts.ready;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        maxTextSize: MAX_DIAGRAM_LENGTH,
        maxEdges: 300,
        theme: 'base',
        htmlLabels: false,
        fontFamily: '"DM Sans", "Noto Sans KR", system-ui, sans-serif',
        themeVariables:
          theme === 'dark'
            ? {
                darkMode: true,
                background: '#202320',
                primaryColor: '#303c35',
                primaryTextColor: '#e3e8df',
                primaryBorderColor: '#768c7a',
                lineColor: '#a2b7a3',
                secondaryColor: '#343832',
                tertiaryColor: '#292e29',
                clusterBkg: '#292e29',
                clusterBorder: '#647467',
                edgeLabelBackground: '#202320',
              }
            : {
                background: '#fafbf8',
                primaryColor: '#eef3e8',
                primaryTextColor: '#293628',
                primaryBorderColor: '#819376',
                lineColor: '#687d61',
                secondaryColor: '#f3f0e6',
                tertiaryColor: '#f6f7f2',
                clusterBkg: '#f6f7f2',
                clusterBorder: '#a7b59c',
                edgeLabelBackground: '#fafbf8',
              },
        flowchart: { htmlLabels: false, useMaxWidth: true, curve: 'basis' },
        class: { htmlLabels: false },
      });
      const container = document.createElement('div');
      container.className = 'diagram-render-staging';
      container.setAttribute('aria-hidden', 'true');
      document.body.append(container);
      try {
        const result = await mermaid.render(`anotar-diagram-${++sequence}`, source, container);
        return sanitizeDiagramSVG(result.svg);
      } finally {
        container.remove();
      }
    });
  queue = job;
  return job;
}

export function observeDiagramTheme(callback: () => void): () => void {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  media.addEventListener('change', callback);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', callback);
  };
}

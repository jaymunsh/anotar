import { plainContentToString } from '@blocknote/core';
import {
  createDiagramBlockConfig,
  parseDiagramCodeContent,
  parseDiagramCodeElement,
  type DiagramBlockConfig,
} from '@blocknote/diagram-block';
import {
  createReactBlockSpec,
  SourceWithPreview,
  useSourceBlockPreviewPopup,
  useEditorState,
  type ReactCustomBlockRenderProps,
} from '@blocknote/react';
import { useEffect, useState, useRef } from 'react';
import { observeDiagramTheme, renderDiagram } from '../diagrams/render';
import { openDiagramViewer } from '../diagrams/viewer';
import '../../public/diagram.css';

function DiagramBlock(props: ReactCustomBlockRenderProps<DiagramBlockConfig>) {
  const editable = useEditorState({ editor: props.editor, on: 'change', selector: ({ editor }) => editor.isEditable });
  const source = plainContentToString(props.block.content);
  const popup = useSourceBlockPreviewPopup(props);
  useEffect(() => { if (!editable && popup.isOpen) popup.close(); }, [editable, popup.isOpen]);
  const [svg, setSVG] = useState('');
  const [error, setError] = useState<string>();
  const [themeRevision, setThemeRevision] = useState(0);
  const closeViewer = useRef<(() => void) | undefined>(undefined);
  useEffect(() => observeDiagramTheme(() => setThemeRevision((value) => value + 1)), []);
  useEffect(() => () => closeViewer.current?.(), []);
  useEffect(() => {
    let cancelled = false;
    // Debounce source edits without interfering with BlockNote's contentRef or IME.
    const timer = setTimeout(() => {
      if (!source.trim()) {
        setSVG('');
        setError(undefined);
        return;
      }
      void renderDiagram(source)
        .then((result) => {
          if (!cancelled) {
            setSVG(result);
            setError(undefined);
          }
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setSVG('');
            setError(
              reason instanceof Error && !/Parse error|Syntax error/i.test(reason.message)
                ? reason.message.slice(0, 180)
                : '문법을 확인해 주세요. 원문은 그대로 보존됩니다.',
            );
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, themeRevision]);
  return (
    <div
      className="document-diagram diagram-editor"
      style={popup.isOpen ? { overflow: 'visible' } : undefined}
    >
      <div className="diagram-toolbar" contentEditable={false}>
        <span>Mermaid</span>
        {editable && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              // The toolbar button lives inside the editor. Focusing the editor
              // blurs this button, and BlockNote closes source popups on that blur.
              // Complete that focus transition before opening the source popup.
              props.editor.focus();
              popup.open();
            }}
          >
            소스 수정
          </button>
        )}
        <button
          type="button"
          disabled={!svg || Boolean(error)}
          onClick={(event) => {
            event.stopPropagation();
            closeViewer.current = openDiagramViewer(svg, event.currentTarget);
          }}
        >
          확대 보기
        </button>
      </div>
      <SourceWithPreview
        editor={props.editor}
        popup={popup}
        contentRef={props.contentRef}
        source={source}
        enterSubmits={false}
        preview={
          svg ? (
            <div className="diagram-preview" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="diagram-preview">다이어그램을 준비하고 있습니다…</div>
          )
        }
        error={error}
        errorPreview={
          <div className="diagram-preview diagram-error">
            다이어그램을 표시할 수 없습니다. 소스를 확인해 주세요.
          </div>
        }
        emptySourcePlaceholder="Mermaid 소스 작성"
        sourcePlaceholder="Mermaid 소스"
      />
    </div>
  );
}

export const createDocumentDiagramBlockSpec = createReactBlockSpec(createDiagramBlockConfig, {
  meta: {
    code: true,
    defining: true,
    isolating: false,
    highlight: () => 'mermaid',
    hasPreview: true,
    hardBreakShortcut: 'enter',
  },
  parse: parseDiagramCodeElement,
  parseContent: parseDiagramCodeContent,
  runsBefore: ['codeBlock'],
  render: DiagramBlock,
  toExternalHTML: (props) => (
    <pre>
      <code className="language-mermaid" data-language="mermaid" ref={props.contentRef} />
    </pre>
  ),
});

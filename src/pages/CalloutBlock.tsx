import { useEffect, useRef, useState } from 'react';
import { defaultProps, type BlockNoteEditor } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { createReactBlockSpec, useEditorState } from '@blocknote/react';
import { Check, CircleCheck, Info, Lightbulb, Palette, TriangleAlert } from 'lucide-react';
import { calloutColors, calloutColorLabels, calloutIcons, calloutIconLabels, type CalloutIcon } from '../../shared/callout';
import '../../public/callout.css';
import './calloutEditor.css';

type AnyEditor = BlockNoteEditor<any, any, any>;
type CalloutProps = { backgroundColor: string; textColor: string; textAlignment: string; icon: CalloutIcon; border: boolean };
const icons = { lightbulb: Lightbulb, info: Info, warning: TriangleAlert, check: CircleCheck, none: Palette };

function CalloutView({ block, editor, contentRef }: { block: { id: string; props: CalloutProps }; editor: AnyEditor; contentRef: (element: HTMLElement | null) => void }) {
  const editable = useEditorState({ editor, on: 'change', selector: ({ editor }) => editor.isEditable });
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!editable) menu.current?.hidePopover(); }, [editable]);
  const Icon = icons[block.props.icon] || Lightbulb;
  const update = (props: Partial<CalloutProps>) => {
    if (props.icon === 'none') menu.current?.hidePopover();
    if (editor.isEditable) editor.updateBlock(block.id, { props });
  };
  useEffect(() => {
    if (block.props.icon === 'none') menu.current?.hidePopover();
  }, [block.props.icon]);
  function positionAppearance() {
    const panel = menu.current, button = trigger.current;
    if (!panel || !button || !panel.matches(':popover-open')) return;
    const anchor = button.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(anchor.bottom + 6, (visualViewport?.height ?? innerHeight) - bounds.height - 8)) + 'px';
  }
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', positionAppearance);
    window.addEventListener('scroll', positionAppearance, { capture: true, passive: true });
    visualViewport?.addEventListener('resize', positionAppearance);
    return () => {
      window.removeEventListener('resize', positionAppearance);
      window.removeEventListener('scroll', positionAppearance, true);
      visualViewport?.removeEventListener('resize', positionAppearance);
    };
  }, [open]);
  function toggleAppearance() {
    const panel = menu.current, button = trigger.current;
    if (!panel || !button) return;
    if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
    panel.showPopover();
    positionAppearance();
  }
  return (
    <div className="page-callout" data-icon={block.props.icon}>
      <div className="callout-marker" contentEditable={false}>
        {editable ? (
          <button ref={trigger} type="button" className={'callout-icon-button' + (block.props.icon === 'none' ? ' is-empty' : '')} aria-label="콜아웃 모양" title="아이콘·배경색·테두리" aria-expanded={open} aria-controls={'callout-menu-' + block.id} onClick={toggleAppearance}>
            <Icon size={20} aria-hidden="true" />
          </button>
        ) : block.props.icon !== 'none' ? <Icon size={20} aria-hidden="true" /> : null}
        <div ref={menu} id={'callout-menu-' + block.id} className="callout-appearance" popover="auto" aria-label="콜아웃 모양 설정" onToggle={event => setOpen(event.newState === 'open')}
          onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); menu.current?.hidePopover(); trigger.current?.focus(); } }}>
          <strong>콜아웃 모양</strong>
          <fieldset><legend>아이콘</legend><div className="callout-icon-options">
            {calloutIcons.map(icon => { const Option = icons[icon]; return <button key={icon} type="button" aria-label={calloutIconLabels[icon]} title={calloutIconLabels[icon]} aria-pressed={block.props.icon === icon} onClick={() => update({ icon })}><Option size={18} aria-hidden="true" /></button>; })}
          </div></fieldset>
          <fieldset><legend>배경색</legend><div className="callout-color-options">
            {calloutColors.map(color => <button key={color} type="button" data-background-color={color} aria-label={calloutColorLabels[color]} title={calloutColorLabels[color]} aria-pressed={block.props.backgroundColor === color} onClick={() => update({ backgroundColor: color })}>{block.props.backgroundColor === color && <Check size={14} aria-hidden="true" />}</button>)}
          </div></fieldset>
          <label className="callout-border-option"><span>테두리 표시</span><input type="checkbox" checked={block.props.border} onChange={event => update({ border: event.target.checked })} /></label>
        </div>
      </div>
      <div className="callout-content" ref={contentRef} />
    </div>
  );
}

export const createCalloutBlockSpec = createReactBlockSpec(
  { type: 'callout', propSchema: { ...defaultProps, icon: { default: 'lightbulb' as const, values: calloutIcons }, border: { default: true } }, content: 'inline' },
  {
    render: ({ block, editor, contentRef }) => <CalloutView block={block as any} editor={editor} contentRef={contentRef} />,
    toExternalHTML: ({ block, contentRef }) => {
      const Icon = icons[block.props.icon] || Lightbulb;
      return <aside className="callout-box" data-callout="true" data-icon={block.props.icon} data-background-color={block.props.backgroundColor} data-border={block.props.border} style={{ border: block.props.border ? '1px solid #cdd5ce' : 'none', borderRadius: '8px', padding: '14px 16px' }}>
        <div className="callout-grid">{block.props.icon !== 'none' && <span className="callout-marker"><Icon size={20} /></span>}<div ref={contentRef} /></div>
      </aside>;
    },
  },
);

export function getCalloutSlashMenuItems(editor: AnyEditor) {
  return [{ title: '콜아웃', subtext: '테두리와 배경색으로 강조하는 박스', aliases: ['callout', '박스', '안내', '강조', '주의'], group: '기본 블록', icon: <Lightbulb size={18} />, onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' } as any) }];
}

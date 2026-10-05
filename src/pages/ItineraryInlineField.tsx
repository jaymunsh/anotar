import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** A single property editor. Validation runs before leaving the field. */
export default function ItineraryInlineField({
  value,
  label,
  field,
  children,
  editable,
  multiline = false,
  type = 'text',
  maxLength = 160,
  options,
  autoEdit = false,
  onDraft,
  onCommit,
  onCancel,
  onEditing,
}: {
  value: string;
  label: string;
  field: string;
  children?: ReactNode;
  editable: boolean;
  multiline?: boolean;
  type?: 'text' | 'time' | 'date' | 'url';
  maxLength?: number;
  options?: Record<string, string>;
  autoEdit?: boolean;
  onDraft: (value: string) => void;
  onCommit: () => string | undefined;
  onCancel: () => void;
  onEditing: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(autoEdit && editable);
  const [text, setText] = useState(value);
  const [error, setError] = useState('');
  const [readingHeight, setReadingHeight] = useState(0);
  const active = useRef(editing);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const root = useRef<HTMLElement>(null);
  const errorId = useId();
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  useEffect(() => {
    onEditing(editing);
    if (editing) {
      input.current?.focus({ preventScroll: true });
      if (autoEdit && input.current instanceof HTMLTextAreaElement) input.current.select();
    }
    return () => onEditing(false);
  }, [editing]);
  function grow() {
    const element = input.current;
    if (element instanceof HTMLTextAreaElement) {
      element.style.height = 'auto';
      element.style.height = `${Math.max(readingHeight, element.scrollHeight + 2)}px`;
    }
  }
  useEffect(grow, [text, editing]);
  function open() {
    if (!editable) return;
    setReadingHeight(root.current?.getBoundingClientRect().height || 0);
    setText(value);
    setError('');
    active.current = true;
    setEditing(true);
  }
  function focusField() {
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>('[role="button"]')?.focus({ preventScroll: true }),
    );
  }
  function finish(returnFocus = false) {
    if (!active.current || composing.current) return false;
    const problem = onCommit();
    if (problem) {
      setError(problem);
      return false;
    }
    active.current = false;
    setEditing(false);
    setError('');
    if (returnFocus) focusField();
    return true;
  }
  function cancel() {
    active.current = false;
    composing.current = false;
    onCancel();
    setText(value);
    setEditing(false);
    setError('');
    focusField();
  }
  const Tag = multiline ? 'div' : 'span';
  if (!editable && !editing) return <>{children ?? value}</>;
  const attributes = {
    'aria-label': label,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? errorId : undefined,
    value: text,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) => {
      const next = !multiline ? event.target.value.replace(/[\r\n]+/g, ' ') : event.target.value;
      setText(next);
      onDraft(next);
      setError('');
    },
    onBlur: () => finish(),
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
      if (event.key === 'Tab') {
        // Stay within the visible editor scope, skipping closed property menus.
        const scope = root.current?.closest('.itinerary-property-menu') || root.current?.closest('.itinerary-block');
        const fields = Array.from(scope?.querySelectorAll<HTMLElement>('.itinerary-inline-field') || [])
          .filter(element => element.getClientRects().length > 0 && !element.closest('details:not([open])'));
        const index = fields.indexOf(root.current as HTMLElement);
        const next = fields[index + (event.shiftKey ? -1 : 1)];
        const committed = finish();
        if (!committed || next) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (committed && next) requestAnimationFrame(() => {
          const trigger = next.querySelector<HTMLElement>('[role="button"]');
          trigger?.focus({ preventScroll: true });
          trigger?.click();
        });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      } else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    },
  };
  return (
    <Tag
      ref={(node) => {
        root.current = node;
      }}
      className={`itinerary-inline-field${editing ? ' is-editing' : ''}${multiline ? ' is-multiline' : ''}`}
      data-field={field}
    >
      {editing ? (
        <>
          {options ? (
            <select
              {...attributes}
              ref={(node) => {
                input.current = node;
              }}
            >
              <option value="">선택 안 함</option>
              {Object.entries(options).map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
            </select>
          ) : type === 'date' || type === 'time' || type === 'url' ? (
            <input
              {...attributes}
              ref={(node) => {
                input.current = node;
              }}
              type={type === 'time' ? 'text' : type}
              inputMode={type === 'time' ? 'numeric' : undefined}
              maxLength={type === 'time' ? 5 : maxLength}
              placeholder={type === 'time' ? 'HH:mm' : undefined}
            />
          ) : (
            <textarea
              {...attributes}
              ref={(node) => {
                input.current = node;
              }}
              rows={1}
              maxLength={maxLength}
            />
          )}
          {error && (
            <span id={errorId} className="itinerary-inline-error" role="alert">
              {error}
            </span>
          )}
        </>
      ) : (
        <Tag
          role="button"
          tabIndex={0}
          aria-label={`${label} 수정`}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              open();
            }
          }}
        >
          {children ??
            (value || <span className="itinerary-inline-placeholder">{label} 추가</span>)}
        </Tag>
      )}
    </Tag>
  );
}

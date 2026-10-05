import { useEffect, useId, useRef, useState } from 'react';
import { X, Search, NotebookPen, Wrench } from 'lucide-react';
import { buildDocumentBlueprint, documentBlueprints } from '../../shared/documentBlueprints';
import type { DocumentBlueprintPayload } from '../../shared/documentBlueprints';
import './documentBlueprintPicker.css';

const icons = { research: Search, meeting: NotebookPen, development: Wrench };
export function DocumentBlueprintPicker({
  onSelect,
  onClose,
  disabled = false,
  error: creationError,
}: {
  onSelect: (payload: DocumentBlueprintPayload) => void;
  onClose: () => void;
  disabled?: boolean;
  error?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [selected, setSelected] = useState<string>('research');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const blueprint = documentBlueprints.find((item) => item.id === selected)!;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="document-blueprint-picker"
      aria-labelledby={headingId}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
          ),
        ).filter((element) => element.getClientRects().length);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="blueprint-heading">
        <h2 id={headingId}>문서 템플릿</h2>
        <button type="button" aria-label="문서 템플릿 닫기" onClick={() => dialog.current?.close()}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) return;
          try {
            const payload = buildDocumentBlueprint(selected, {
              title,
            });
            setError('');
            onSelect(payload);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : '템플릿 입력을 확인해 주세요.');
          }
        }}
      >
        <div className="blueprint-body">
          <p className="blueprint-intro">
            작성할 문서에 맞는 틀을 골라 주세요. 내용은 자유롭게 고칠 수 있어요.
          </p>
          <div className="blueprint-options" role="group" aria-label="문서 종류">
            {documentBlueprints.map((item) => {
              const Icon = icons[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected === item.id}
                  disabled={disabled}
                  onClick={() => {
                    setSelected(item.id);
                    setError('');
                  }}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <label className="blueprint-field">
            문서 제목 <span className="blueprint-optional">선택</span>
            <input
              disabled={disabled}
              value={title}
              maxLength={160}
              placeholder={blueprint.title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {(error || creationError) && (
            <p role="alert" className="blueprint-error">
              {error || creationError}
            </p>
          )}
        </div>
        <footer className="blueprint-footer">
          <button type="button" onClick={() => dialog.current?.close()}>
            취소
          </button>
          <button className="blueprint-submit" type="submit" disabled={disabled}>
            이 템플릿 사용
          </button>
        </footer>
      </form>
    </dialog>
  );
}
export default DocumentBlueprintPicker;

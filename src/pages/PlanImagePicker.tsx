import { useEffect, useMemo, useState } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';

type Image = { id: string; name: string };
export default function PlanImagePicker({
  editor,
  value,
  onChange,
}: {
  editor: BlockNoteEditor<any, any, any>;
  value: string;
  onChange: (value: string) => void;
}) {
  const ids = useMemo(() => {
    const result = new Set<string>(value ? [value] : []);
    const visit = (blocks: any[]) =>
      blocks.forEach((b) => {
        if (['asset', 'map', 'itinerary'].includes(b.type) && b.props.assetId)
          result.add(b.props.assetId);
        visit(b.children || []);
      });
    visit(editor.document);
    return [...result];
  }, [editor, value]);
  const [images, setImages] = useState<Image[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setStatus('loading');
    Promise.allSettled(
      ids.map(async (id) => {
        const response = await fetch(`/api/assets/${id}/info`, { signal: abort.signal });
        if (!response.ok) throw new Error('image lookup failed');
        const body = await response.json();
        if (!body.item || body.item.id !== id) throw new Error('image metadata missing');
        return body.item;
      }),
    )
      .then((items) => {
        if (abort.signal.aborted) return;
        setImages(
          items.flatMap((result) =>
            result.status === 'fulfilled' &&
            /^image\/(png|jpeg|webp|gif|avif)$/.test(result.value.mime)
              ? [result.value]
              : [],
          ),
        );
        setStatus(items.some((result) => result.status === 'rejected') ? 'error' : 'ready');
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus('error');
      });
    return () => abort.abort();
  }, [ids, attempt]);
  return (
    <div className="itinerary-image-picker">
      <label>
        공유용 지도 이미지
        <select
          aria-label="공유용 지도 이미지"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">자동 방문 순서 이미지</option>
          {value && !images.some((item) => item.id === value) && (
            <option value={value}>선택된 이미지</option>
          )}
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.name}
            </option>
          ))}
        </select>
      </label>
      <small>
        페이지 더보기의 파일 첨부에서 이미지를 올린 뒤 선택하세요. 등록한 이미지는 직접 교체할 수
        있어요.
      </small>
      {status === 'loading' && <small role="status">첨부 이미지 확인 중…</small>}
      {status === 'error' && (
        <p role="status">
          이미지 목록을 불러오지 못했어요. 선택은 유지돼요.{' '}
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            다시 불러오기
          </button>
        </p>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseAssetCrop, type AssetCrop } from '../../shared/assetPresentation.mjs';
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export default function AssetCropDialog({
  src,
  name,
  initial,
  onApply,
  onClose,
}: {
  src: string;
  name: string;
  initial: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState<AssetCrop>(
    () =>
      parseAssetCrop(initial) || { x: 0, y: 0, width: 1, height: 1, imageWidth: 1, imageHeight: 1 },
  );
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; crop: AssetCrop; mode: string } | null>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => prior?.focus({ preventScroll: true });
  }, []);
  function start(e: React.PointerEvent, mode: string) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, crop, mode };
  }
  function move(e: React.PointerEvent) {
    const a = drag.current,
      b = stage.current?.getBoundingClientRect();
    if (!a || !b) return;
    const dx = (e.clientX - a.x) / b.width,
      dy = (e.clientY - a.y) / b.height,
      c = a.crop;
    if (a.mode === 'move')
      setCrop({ ...c, x: clamp(c.x + dx, 0, 1 - c.width), y: clamp(c.y + dy, 0, 1 - c.height) });
    else {
      const l = a.mode.includes('w') ? clamp(c.x + dx, 0, c.x + c.width - 0.05) : c.x,
        t = a.mode.includes('n') ? clamp(c.y + dy, 0, c.y + c.height - 0.05) : c.y,
        r = a.mode.includes('e') ? clamp(c.x + c.width + dx, c.x + 0.05, 1) : c.x + c.width,
        bottom = a.mode.includes('s') ? clamp(c.y + c.height + dy, c.y + 0.05, 1) : c.y + c.height;
      setCrop({ ...c, x: l, y: t, width: r - l, height: bottom - t });
    }
  }
  const max = (key: 'x' | 'y' | 'width' | 'height', current = crop) =>
    key === 'x'
      ? 1 - current.width
      : key === 'y'
        ? 1 - current.height
        : key === 'width'
          ? 1 - current.x
          : 1 - current.y;
  const sliders = [
    ['x', '가로 위치'],
    ['y', '세로 위치'],
    ['width', '영역 너비'],
    ['height', '영역 높이'],
  ] as const;
  return createPortal(
    <dialog
      ref={dialog}
      className="asset-crop-dialog"
      aria-labelledby="asset-crop-title"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const normalized = Object.fromEntries(
            Object.entries(crop).map(([key, value]) => [
              key,
              Math.round(value * 1000000) / 1000000,
            ]),
          );
          onApply(
            crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1
              ? ''
              : JSON.stringify(normalized),
          );
        }}
      >
        <h2 id="asset-crop-title">이미지 자르기</h2>
        <p>영역을 끌어 이동하고 모서리로 크기를 바꾸세요. 원본 파일은 그대로 보관돼요.</p>
        <div className="asset-crop-stage" ref={stage}>
          <img
            src={src}
            alt={name}
            draggable={false}
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const { naturalWidth: imageWidth, naturalHeight: imageHeight } = e.currentTarget;
              setCrop((c) => ({ ...c, imageWidth, imageHeight }));
              setLoaded(true);
            }}
          />
          {loaded && (
            <div
              className="asset-crop-selection"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
              }}
              onPointerDown={(e) => start(e, 'move')}
              onPointerMove={move}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            >
              {['nw', 'ne', 'sw', 'se'].map((corner) => (
                <span
                  key={corner}
                  className={`asset-crop-handle asset-crop-handle-${corner}`}
                  onPointerDown={(e) => start(e, corner)}
                />
              ))}
            </div>
          )}
        </div>
        {failed && <p role="alert">이미지를 열지 못했어요. 취소 후 다시 시도해 주세요.</p>}
        <div className="asset-crop-adjustments">
          {sliders.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type="range"
                aria-label={label}
                min={key === 'width' || key === 'height' ? 0.05 : 0}
                max={max(key)}
                step="0.001"
                value={crop[key]}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setCrop((current) => ({
                    ...current,
                    [key]: clamp(
                      value,
                      key === 'width' || key === 'height' ? 0.05 : 0,
                      max(key, current),
                    ),
                  }));
                }}
              />
              <output>{Math.round(crop[key] * 100)}%</output>
            </label>
          ))}
        </div>
        <div className="asset-crop-actions">
          <button
            type="button"
            onClick={() => setCrop((c) => ({ ...c, x: 0, y: 0, width: 1, height: 1 }))}
          >
            원본 영역으로 초기화
          </button>
          <span />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" disabled={!loaded || failed}>
            적용
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

import { createContext, useContext, useEffect, useState } from 'react';
import { ImagePlus, RefreshCw, Settings2, ChevronDown } from 'lucide-react';
import { staticMapStyles, defaultStaticMapStyle, type StaticMapStyle } from '../../shared/staticMap';

export const MapImageContext = createContext<{
  disabled: boolean;
  reason?: string;
  busy: boolean;
  generate: (blockId: string, style: StaticMapStyle) => void;
} | null>(null);

export default function MapImageControls({ blockId, hasImage, stale, missing, places }: {
  blockId: string; hasImage: boolean; stale: boolean; missing: number; places: number;
}) {
  const context = useContext(MapImageContext);
  const [style, setStyle] = useState<StaticMapStyle>(defaultStaticMapStyle);
  const [config, setConfig] = useState<'loading' | 'enabled' | 'disabled' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(!hasImage || stale);
  useEffect(() => { if (!hasImage || stale || context?.busy) setExpanded(true); }, [hasImage, stale, context?.busy]);
  useEffect(() => {
    if (!context) return;
    const abort = new AbortController();
    setConfig('loading');
    fetch('/api/maps/config', { signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (!abort.signal.aborted) setConfig(body.geoapifyEnabled === true ? 'enabled' : 'disabled');
    }).catch(() => { if (!abort.signal.aborted) setConfig('error'); });
    return () => abort.abort();
  }, [Boolean(context), attempt]);
  if (!context) return null;
  return <div className="itinerary-map-image-controls">
    <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><Settings2 size={14} aria-hidden />지도 설정<ChevronDown size={12} aria-hidden /></summary>
    <div className="itinerary-map-settings-body">
      <label>
        <span>지도 스타일</span>
        <select aria-label="지도 이미지 스타일" value={style} disabled={context.busy} onChange={(event) => setStyle(event.target.value as StaticMapStyle)}>
          {Object.entries(staticMapStyles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button type="button" title={context.reason || undefined} disabled={context.disabled || config !== 'enabled' || !places} onMouseDown={(event) => event.preventDefault()} onClick={() => context.generate(blockId, style)}>
        {hasImage ? <RefreshCw size={14} aria-hidden /> : <ImagePlus size={14} aria-hidden />}
        {context.busy ? '지도 만드는 중…' : hasImage ? '지도 이미지 갱신' : '지도 이미지 만들기'}
      </button>
    </div>
    </details>
    {(!hasImage || stale || missing > 0 || context.busy || expanded || config !== 'enabled') && <small role="status">
      {context.reason ? context.reason : config === 'loading' ? '지도 연결 확인 중…' : config === 'disabled' ? 'Geoapify 키를 .env에 넣고 서버를 다시 시작해 주세요.' : config === 'error' ? <><span>지도 연결을 확인하지 못했어요.</span> <button type="button" onClick={() => setAttempt((value) => value + 1)}>다시 확인</button></> : context.busy ? '저장된 일정으로 이미지를 만들고 있어요. 기존 이미지는 유지돼요.' : stale ? '장소나 방문 순서가 바뀌었어요. 지도 이미지를 갱신해 주세요.' : missing ? `좌표 없는 장소 ${missing}곳은 지도에서 제외돼요. 각 일정의 ··· 메뉴에서 좌표를 입력할 수 있어요.` : '버튼을 누를 때만 생성해요. 저장한 이미지는 공유·오프라인에서도 보여요.'}
    </small>}
  </div>;
}

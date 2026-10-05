import { useEffect, useRef, useState } from 'react';
import { Maximize2, RefreshCw } from 'lucide-react';
import type { ItineraryEntry } from '../../shared/itinerary';
import {
  cleanGoogleMapsKey,
  createGoogleItinerary,
  loadGoogleMaps,
} from '../../shared/googleItinerary.mjs';
import type { GoogleItineraryController } from '../../shared/googleItinerary.mjs';
import '../../public/google-itinerary.css';
const keyStorage = 'leneu:google-maps-demo-key:v1';
function savedKey() {
  try {
    return cleanGoogleMapsKey(sessionStorage.getItem(keyStorage));
  } catch {
    return '';
  }
}

function GoogleMap({
  entries,
  selectedId,
  onSelect,
  apiKey,
}: {
  entries: ItineraryEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  apiKey: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<GoogleItineraryController | null>(null);
  const callback = useRef(onSelect);
  const selected = useRef(selectedId);
  callback.current = onSelect;
  selected.current = selectedId;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    loadGoogleMaps(apiKey)
      .then((sdk) => {
        if (cancelled || !container.current) return;
        controller.current = createGoogleItinerary(
          container.current,
          entries,
          sdk,
          (id) => callback.current(id),
          (message) => {
            if (!cancelled) {
              setError(message);
              setStatus('error');
            }
          },
        );
        controller.current.select(selected.current);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setError(
          'Google 지도를 연결하지 못했어요. 데모 키·허용 주소·인터넷 연결을 확인해 주세요. 키를 바꿨다면 새로고침해 주세요.',
        );
        setStatus('error');
      });
    return () => {
      cancelled = true;
      controller.current?.destroy();
      controller.current = null;
    };
  }, [apiKey, entries, attempt]);
  useEffect(() => {
    controller.current?.select(selectedId);
  }, [selectedId]);
  return (
    <div className="itinerary-map-wrap">
      <div className="itinerary-google-toolbar">
        <span>
          Google Maps ·{' '}
          {entries.filter((e) => e.category !== 'travel' && e.latitude !== undefined).length}곳
        </span>
        <button
          type="button"
          disabled={status !== 'ready'}
          onClick={() => controller.current?.fitAll()}
        >
          <Maximize2 size={13} /> 전체 일정 보기
        </button>
      </div>
      <div
        ref={container}
        className="itinerary-map itinerary-google-map"
        aria-label="Google 지도와 방문 순서"
        aria-busy={status === 'loading'}
      />
      {status === 'loading' && (
        <p className="itinerary-map-error" role="status">
          Google 지도를 불러오는 중…
        </p>
      )}
      {status === 'error' && (
        <div className="itinerary-google-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            <RefreshCw size={13} /> 다시 연결
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      )}
      <small>
        화살표는 방문 순서예요. 실제 도보·차량 이동 경로와 소요 시간은 장소 링크에서 확인하세요.
      </small>
    </div>
  );
}

export default function ItineraryMap(props: {
  entries: ItineraryEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [key, setKey] = useState(savedKey);
  const [input, setInput] = useState(savedKey);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/maps/config', { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const config = await response.json();
        const configuredKey = cleanGoogleMapsKey(config.googleMapsKey);
        if (configuredKey && !savedKey()) {
          setKey(configuredKey);
          setInput(configuredKey);
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  function connect(event: React.FormEvent) {
    event.preventDefault();
    const next = cleanGoogleMapsKey(input);
    if (!next) {
      setError('발급받은 Google Maps 데모 키를 입력해 주세요.');
      return;
    }
    try {
      sessionStorage.setItem(keyStorage, next);
    } catch {}
    setKey(next);
    setSettings(false);
    setError('');
  }
  return (
    <div className="itinerary-map-provider">
      <div className="itinerary-provider-controls" aria-label="Google 지도 설정">
        {key && (
          <button
            type="button"
            className="itinerary-key-toggle"
            aria-expanded={settings}
            onClick={() => setSettings((v) => !v)}
          >
            키 설정
          </button>
        )}
      </div>
      {(!key || settings) && (
        <form className="itinerary-key-form" onSubmit={connect}>
          <strong>Google 지도로 일정 보기</strong>
          <p>데모 키를 연결하면 번호 핀과 방향 화살표가 표시돼요.</p>
          <label>
            Google Maps 데모 키
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="발급받은 데모 키 붙여넣기"
            />
          </label>
          <div>
            <a
              href="https://developers.google.com/maps/documentation/javascript/demo-key"
              target="_blank"
              rel="noopener noreferrer"
            >
              데모 키 발급 안내
            </a>
            <button type="submit">지도 연결</button>
          </div>
          <small>
            입력한 키는 이 탭에 보관하고 페이지 본문에는 저장하지 않아요. 공유페이지는 이미지와 장소
            링크만 보여줘요.
          </small>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      {key && <GoogleMap {...props} apiKey={key} />}
    </div>
  );
}

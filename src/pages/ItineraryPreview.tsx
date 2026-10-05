import { useAssetUrl } from '../offline/useAssetUrl';
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ItineraryEntry } from '../../shared/itinerary';
import { itineraryRoutes } from '../../shared/itinerary';
import { itineraryPreviewDataUrl } from '../../shared/itineraryPreview';
import { staticMapStops } from '../../shared/staticMap';

export default function ItineraryPreview({
  entries,
  assetId = '',
  imageSource = '',
}: {
  entries: ItineraryEntry[];
  assetId?: string;
  imageSource?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const automatic = useMemo(() => itineraryPreviewDataUrl(entries), [entries]);
  const routes = useMemo(() => itineraryRoutes(entries), [entries]);
  const stops = useMemo(() => staticMapStops(entries), [entries]);
  const localPath = useAssetUrl(assetId);
  const path = assetId ? localPath : automatic;
  useEffect(() => {
    setFailed(false);
  }, [path]);
  return (
    <figure className="itinerary-preview">
      {failed ? (
        <p role="status">
          이미지를 불러오지 못했어요. 일정과 장소 링크는 사용할 수 있어요.{' '}
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((v) => v + 1);
            }}
          >
            다시 불러오기
          </button>
        </p>
      ) : (
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          download={assetId ? undefined : '방문순서.svg'}
          aria-label={assetId ? '지도 이미지 크게 보기' : '방문 순서 이미지 크게 보기'}
        >
          <img
            key={attempt}
            src={path}
            alt={
              assetId
                ? '저장된 지도 이미지'
                : '방문 위치와 순서. 실제 도로 지도는 장소 링크에서 확인하세요.'
            }
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </a>
      )}
      <figcaption>
        <span>방문 순서 · 실제 길찾기는 Google Maps에서</span>
        <a href={path} target="_blank" rel="noopener noreferrer">크게 보기 <ExternalLink size={12} aria-hidden /></a>
      </figcaption>
      {stops.length > 0 && <ol className="itinerary-map-stops" aria-label="지도 방문 장소">
        {stops.map((stop) => <li key={stop.id}><a href={stop.url} target="_blank" rel="noopener noreferrer">
          <span className="itinerary-map-stop-number">{stop.number}</span>
          <span><strong>{stop.name}</strong><small>{stop.start} · 장소 보기</small></span>
          <ExternalLink size={12} aria-hidden />
        </a></li>)}
      </ol>}
      {assetId && imageSource === 'geoapify' && <details className="itinerary-map-credit">
        <summary>지도 출처</summary><p>
        Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a>
        {' · '}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>
        {' · '}<a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a>
      </p></details>}
      {routes.length > 0 && (
        <nav className="itinerary-route-links" aria-label="날짜별 지도 경로">
          {routes.map((route) => (
            <a
              key={`${route.date}-${route.numbers[0]}`}
              href={route.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {route.date} · {route.numbers.join(' → ')} <ExternalLink size={12} aria-hidden />
            </a>
          ))}
        </nav>
      )}
    </figure>
  );
}

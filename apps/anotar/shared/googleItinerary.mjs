// Personal editor only. Public shares use static images and external links.
export function cleanGoogleMapsKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  return /^[A-Za-z0-9_-]{10,200}$/.test(key) ? key : '';
}

export function itineraryMapPoints(entries) {
  let number = 0;
  return entries.flatMap((entry) => {
    if (
      entry.category === 'travel' ||
      (entry.category && !entry.place && entry.latitude === undefined)
    )
      return [];
    number++;
    return Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude)
      ? [{ ...entry, number, position: { lat: entry.latitude, lng: entry.longitude } }]
      : [];
  });
}

let loading;
let loadedKey = '';
const authListeners = new Set();
const authError = () =>
  new Error(
    'Google 지도 키를 사용할 수 없어요. 데모 키와 허용 주소를 확인한 뒤 새로고침해 주세요.',
  );

export async function loadGoogleMaps(input) {
  const key = cleanGoogleMapsKey(input);
  if (!key) throw new Error('Google Maps 데모 키를 입력해 주세요.');
  if (loadedKey && loadedKey !== key)
    throw new Error('다른 지도 키로 연결하려면 키를 적용한 뒤 페이지를 새로고침해 주세요.');
  if (!loading) {
    loadedKey = key;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const callback = '__leneuGoogleMapsReady';
      const previousAuthFailure = window.gm_authFailure;
      window.gm_authFailure = () => {
        cleanup();
        reject(authError());
        for (const listener of authListeners) listener(authError());
        previousAuthFailure?.();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        delete window[callback];
        script.onerror = null;
      };
      const fail = () => {
        cleanup();
        script.remove();
        loadedKey = '';
        loading = undefined;
        window.gm_authFailure = previousAuthFailure;
        reject(new Error('Google 지도를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.'));
      };
      const timeout = setTimeout(fail, 20000);
      window[callback] = async () => {
        try {
          const [core, maps, marker] = await Promise.all([
            window.google.maps.importLibrary('core'),
            window.google.maps.importLibrary('maps'),
            window.google.maps.importLibrary('marker'),
          ]);
          cleanup();
          resolve({
            ...core,
            ...maps,
            ...marker,
            event: window.google.maps.event,
            SymbolPath: window.google.maps.SymbolPath,
          });
        } catch {
          fail();
        }
      };
      const query = new URLSearchParams({
        key,
        v: 'weekly',
        loading: 'async',
        callback,
        language: 'ko',
      });
      script.src = 'https://maps.googleapis.com/maps/api/js?' + query;
      script.async = true;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.onerror = fail;
      document.head.append(script);
    });
  }
  return loading;
}

export function createGoogleItinerary(container, entries, sdk, onSelect, onError) {
  const points = itineraryMapPoints(entries);
  if (!points.length) throw new Error('지도에 표시할 장소 좌표가 없어요.');
  const map = new sdk.Map(container, {
    center: points[0].position,
    zoom: 15,
    mapId: 'DEMO_MAP_ID',
    gestureHandling: 'cooperative',
    keyboardShortcuts: false,
    mapTypeControl: false,
    streetViewControl: false,
    clickableIcons: false,
  });
  const markers = new Map();
  const paths = [];
  const listeners = [];
  const bounds = new sdk.LatLngBounds();
  const reportAuth = (error) => onError?.(error.message);
  authListeners.add(reportAuth);
  for (const point of points) {
    bounds.extend(point.position);
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'itinerary-google-pin';
    // Google owns the marker's tab/arrow navigation; the visual button is not a second tab stop.
    pin.tabIndex = -1;
    pin.setAttribute('aria-label', `${point.number}. ${point.place || point.title}`);
    pin.setAttribute('aria-pressed', 'false');
    const number = document.createElement('span');
    number.className = 'itinerary-google-pin-number';
    number.textContent = String(point.number);
    const label = document.createElement('span');
    label.className = 'itinerary-google-pin-label';
    label.textContent = point.place || point.title;
    pin.append(number, label);
    pin.addEventListener('click', (event) => {
      event.stopPropagation();
      onSelect(point.id);
    });
    // BlockNote owns Enter; consume it before the editor sees this embedded button.
    const activateWithKeyboard = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(point.id);
    };
    pin.addEventListener('keydown', activateWithKeyboard);
    const marker = new sdk.AdvancedMarkerElement({
      map,
      position: point.position,
      content: pin,
      title: `${point.number}. ${point.place || point.title}`,
      gmpClickable: true,
    });
    const activateMarker = () => onSelect(point.id);
    marker.addEventListener('gmp-click', activateMarker);
    marker.addEventListener('keydown', activateWithKeyboard);
    listeners.push({
      remove() {
        marker.removeEventListener('gmp-click', activateMarker);
        marker.removeEventListener('keydown', activateWithKeyboard);
      },
    });
    markers.set(point.id, { marker, pin, position: point.position });
  }
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1],
      to = points[i];
    // Don't imply a path through a missing coordinate or across separate days.
    if (to.number !== from.number + 1 || to.date !== from.date) continue;
    const path = [from.position, to.position];
    const underlay = new sdk.Polyline({
      map,
      path,
      strokeColor: '#ffffff',
      strokeWeight: 8,
      strokeOpacity: 0.9,
      clickable: false,
      zIndex: 1,
    });
    const line = new sdk.Polyline({
      map,
      path,
      strokeColor: '#315843',
      strokeWeight: 4,
      strokeOpacity: 0.9,
      clickable: false,
      zIndex: 2,
      icons: [
        {
          icon: {
            path: sdk.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 3,
            fillColor: '#315843',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 1,
          },
          offset: '36px',
          repeat: '90px',
        },
        {
          icon: {
            path: sdk.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 4,
            fillColor: '#315843',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 1,
          },
          offset: '75%',
        },
      ],
    });
    paths.push({ id: to.id, line, underlay });
  }
  const fitAll = () => {
    if (points.length === 1) {
      map.setCenter(points[0].position);
      map.setZoom(15);
    } else {
      map.fitBounds(bounds, 55);
      listeners.push(
        sdk.event.addListenerOnce(map, 'idle', () => {
          if (map.getZoom() > 16) map.setZoom(16);
        }),
      );
    }
  };
  fitAll();
  return {
    fitAll,
    select(id) {
      for (const [entryId, { marker, pin, position }] of markers) {
        const active = entryId === id;
        pin.classList.toggle('is-selected', active);
        pin.setAttribute('aria-pressed', String(active));
        marker.setAttribute('aria-pressed', String(active));
        marker.zIndex = active ? 1000 : 10;
        if (active) map.panTo(position);
      }
      for (const path of paths)
        path.line.setOptions({
          strokeWeight: path.id === id ? 6 : 4,
          zIndex: path.id === id ? 3 : 2,
        });
    },
    destroy() {
      authListeners.delete(reportAuth);
      for (const listener of listeners) listener.remove();
      for (const { marker } of markers.values()) marker.map = null;
      for (const { line, underlay } of paths) {
        line.setMap(null);
        underlay.setMap(null);
      }
      sdk.event.clearInstanceListeners(map);
      container.replaceChildren();
    },
  };
}

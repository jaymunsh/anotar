import { randomUUID, createHash } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanItinerary } from '../shared/itinerary.ts';
import { staticMapPoints, staticMapInput, staticMapStyles } from '../shared/staticMap.ts';
import { PageConflictError, PageValidationError } from './pages.mjs';

export class MapImageError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'MapImageError'; this.status = status; }
}
const width = 900, height = 560, worldPixels = 512, maxBytes = 8 * 1024 * 1024;
const project = (latitude) => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * 180 / Math.PI;
const unproject = (y) => (2 * Math.atan(Math.exp(y * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
export function geoapifyMapPayload(raw, style) {
  if (!Object.hasOwn(staticMapStyles, style)) throw new PageValidationError('지도 스타일을 확인해 주세요.');
  const plan = cleanItinerary(raw), points = staticMapPoints(plan.entries);
  if (!points.length) throw new PageValidationError('일정 수정에서 장소의 위도와 경도를 먼저 입력해 주세요.');
  if (points.some((p) => Math.abs(p.latitude) > 85)) throw new PageValidationError('지도 이미지의 위도는 -85~85 범위로 입력해 주세요.');
  const xs = points.map((p) => p.longitude), ys = points.map((p) => project(p.latitude));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (maxX - minX > 180) throw new PageValidationError('날짜 변경선을 건너는 일정은 지도를 나눠 주세요.');
  // GL zooms use 512 logical pixels at zoom zero; output density does not change the viewport.
  const fitZoom = Math.min(17, Math.log2(Math.min((width - 140) * 360 / (worldPixels * Math.max(maxX - minX, 0.001)), (height - 140) * 360 / (worldPixels * Math.max(maxY - minY, 0.001)))));
  // Leave neighboring streets/areas in view instead of filling the image with buildings.
  const zoom = Math.max(0, fitZoom - (['klokantech-basic', 'osm-bright-smooth'].includes(style) ? 0.8 : 0));
  // The static API supports layer color/size, not arbitrary font/layout fields.
  // Basic's neighborhood labels use Noto Sans Regular and natural spacing;
  // Bright's place-other uses Noto Sans Bold with 0.1em tracking.
  const styleCustomization = style === 'klokantech-basic' ? [
    { layer: 'background', color: '#faf8f3' }, { layer: 'landuse-residential', color: '#f2f0eb' },
    { layer: 'building', color: '#e9ebe7' }, { layer: 'housenumber', color: 'none' },
    { layer: 'place_label_other', color: '#4d555a', size: 16 }, { layer: 'place_label_city', color: '#39454b', size: 18 },
    { layer: 'road_major_label', color: '#626c72', size: 13 }, { layer: 'poi_label', color: '#52685d', size: 12 },
    { layer: 'water', color: '#bcdcf1' }, { layer: 'waterway', color: '#bcdcf1' },
    { layer: 'landcover_wood', color: '#c8dfbe' }, { layer: 'park', color: '#d7e7c8' },
    { layer: 'park_outline', color: '#bdcfad' }, { layer: 'landcover_grass', color: '#dfecd2' },
    { layer: 'road_trunk_primary', color: '#f6dfa7' }, { layer: 'road_secondary_tertiary', color: '#f6ebcf' },
    { layer: 'road_major_motorway', color: '#f4d596' },
  ] : style === 'osm-bright-smooth' ? [
    { layer: 'background', color: '#faf8f3' }, { layer: 'landuse-residential', color: '#f2f0eb' },
    { layer: 'building', color: '#e9ebe7' }, { layer: 'building-top', color: 'none' },
    { layer: 'place-other', color: '#485563', size: 17 }, { layer: 'place-village', color: '#394955', size: 19 },
    { layer: 'highway-name-major', color: '#596575', size: 14 }, { layer: 'highway-name-minor', color: '#65717c', size: 13 },
    // Spatial colors: parks in green, water in blue, major roads in soft amber.
    { layer: 'water', color: '#bcdcf1' }, { layer: 'landcover-wood', color: '#c8dfbe' },
    { layer: 'park', color: '#d7e7c8' }, { layer: 'park-outline', color: '#bdcfad' },
    { layer: 'landcover-grass', color: '#dfecd2' }, { layer: 'landcover-grass-park', color: '#d7e7c8' },
    { layer: 'highway-primary', color: '#f6dfa7' }, { layer: 'highway-primary-casing', color: '#decead' },
    { layer: 'highway-secondary-tertiary', color: '#f6ebcf' }, { layer: 'highway-secondary-tertiary-casing', color: '#ddd2bb' },
    { layer: 'highway-motorway', color: '#f4d596' }, { layer: 'highway-motorway-casing', color: '#d9bd8f' },
    { layer: 'poi-level-1', color: '#55675d', size: 13 },
  ] : undefined;
  const color = style === 'dark-matter' ? '#d8e6b5' : '#315843';
  const geometries = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.date !== b.date || b.number !== a.number + 1) continue;
    const ax = a.longitude, ay = project(a.latitude), dx = b.longitude - ax, dy = project(b.latitude) - ay;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-9) continue;
    const value = [{ lon: ax, lat: a.latitude }, { lon: b.longitude, lat: b.latitude }];
    geometries.push({ type: 'polyline', value, linecolor: style === 'dark-matter' ? '#20322d' : '#ffffff', linewidth: 7, lineopacity: 0.9 });
    geometries.push({ type: 'polyline', value, linecolor: color, linewidth: 3, lineopacity: 1, linestyle: 'dashed' });
    const size = Math.min(distance / 6, 13 * 360 / (worldPixels * 2 ** zoom)), ux = dx / distance, uy = dy / distance;
    const tipX = ax + dx * 0.62, tipY = ay + dy * 0.62;
    const triangle = [[tipX, tipY], [tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5], [tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5], [tipX, tipY]];
    geometries.push({ type: 'polygon', value: triangle.map(([lon, y]) => ({ lon, lat: unproject(y) })), linecolor: style === 'dark-matter' ? '#20322d' : '#ffffff', linewidth: 1, fillcolor: color, fillopacity: 1 });
  }
  return { style, width, height, scaleFactor: 2, format: 'png', lang: 'ko', attribution: 'default',
    ...(styleCustomization ? { styleCustomization } : {}),
    center: { lon: (minX + maxX) / 2, lat: unproject((minY + maxY) / 2) }, zoom,
    markers: points.map((p) => ({ lon: p.longitude, lat: p.latitude, type: 'material', color, contentcolor: style === 'dark-matter' ? '#20322d' : '#ffffff', size: 'large', text: String(p.number), textsize: 'medium', whitecircle: 'no', shadow: 'no', strokecolor: '#ffffff' })), geometries };
}
async function imageBytes(response) {
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (mime !== 'image/png' || Number(response.headers.get('content-length')) > maxBytes || !response.body)
    throw new MapImageError('지도 이미지 응답이 올바르지 않아요. 다시 생성해 주세요.');
  const chunks = []; let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new MapImageError('지도 이미지가 너무 커요. 일정을 나눠 주세요.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20) || bytes.readUInt32BE(16) > 2048 || bytes.readUInt32BE(20) > 2048)
    throw new MapImageError('지도 이미지 형식을 확인하지 못했어요. 다시 생성해 주세요.');
  return bytes;
}
export function createGeoapifyMapService({ store, blobDir, apiKey = process.env.GEOAPIFY_API_KEY || '', fetchImpl = fetch, dailyLimit = 20 } = {}) {
  const key = /^[a-zA-Z0-9_-]{10,200}$/.test(apiKey.trim()) ? apiKey.trim() : '';
  const inflight = new Map();
  async function render(input) {
    const prepared = store.preparePageMapImage(input);
    if (prepared.receipt) return prepared.receipt;
    if (!key) throw new MapImageError('서버 .env의 GEOAPIFY_API_KEY를 설정하고 서버를 다시 시작해 주세요.', 409);
    const plan = cleanItinerary(prepared.block.props.data);
    const payload = geoapifyMapPayload(plan, prepared.input.style);
    store.reserveMapImageRequest(dailyLimit);
    let path;
    try {
      const url = new URL('https://maps.geoapify.com/v1/staticmap');
      url.searchParams.set('apiKey', key);
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'image/png' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429) throw new MapImageError('Geoapify 사용 한도에 도달했어요. 기존 이미지는 유지돼요.', 429);
        if ([401, 403].includes(response.status)) throw new MapImageError('Geoapify 키와 프로젝트 접근 제한을 확인한 뒤 서버를 다시 시작해 주세요.', 409);
        throw new MapImageError('지도 이미지를 생성하지 못했어요. 잠시 후 같은 요청으로 다시 확인해 주세요.');
      }
      const bytes = await imageBytes(response), storageKey = randomUUID() + '.png';
      path = join(blobDir, storageKey);
      await writeFile(path, bytes, { flag: 'wx' });
      const result = store.attachPageMapImage({ input: prepared.input, file: { key: storageKey, name: '일정 지도.png', mime: 'image/png', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, imageInput: staticMapInput(plan.entries) });
      if (result.replayed) await unlink(path).catch(() => {});
      return result;
    } catch (error) {
      if (path) await unlink(path).catch(() => {});
      if (error instanceof MapImageError || error instanceof PageConflictError || error instanceof PageValidationError) throw error;
      // Never forward upstream bodies, request URLs, or fetch exception text containing the key.
      throw new MapImageError('지도 서비스에 연결하지 못했어요. 인터넷 연결을 확인하고 같은 요청으로 다시 확인해 주세요.');
    }
  }
  return { enabled: Boolean(key), async generate(input) {
    const serialized = JSON.stringify(input), id = input.operationId;
    const old = inflight.get(id);
    if (old) {
      if (old.serialized !== serialized) throw new PageConflictError('이미 제출한 지도 요청의 내용이 달라요. 이전 요청으로 확인해 주세요.');
      return old.promise;
    }
    const promise = render(input);
    inflight.set(id, { serialized, promise });
    try { return await promise; } finally { inflight.delete(id); }
  } };
}

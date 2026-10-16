import { createReadStream, existsSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSharedPage, referencedAssetIds } from './publicPage.mjs';
import { PageConflictError, PageValidationError } from './pages.mjs';
import { PageToolsNotFoundError } from './pageTools.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const token = 'offline';
export function preparePageExport({ store, pageId, expectedVersion, dataDir }) {
  const page = store.getPage(pageId);
  if (!page) throw new PageToolsNotFoundError('페이지를 찾을 수 없어요.');
  if (!Number.isSafeInteger(expectedVersion) || page.version !== expectedVersion)
    throw new PageConflictError('페이지가 변경됐어요. 저장 상태를 확인하고 다시 내려받아 주세요.');
  const refs = referencedAssetIds(page.document);
  if (refs.size > 500)
    throw new PageValidationError('첨부가 너무 많아요. 페이지를 나눠 내려받아 주세요.');
  const files = [],
    assets = new Map();
  let total = 0;
  for (const id of refs) {
    const asset = store.getAsset(id);
    if (!asset)
      throw new PageValidationError('첨부 파일을 찾을 수 없어요. 페이지의 첨부를 확인해 주세요.');
    const base = realpathSync(join(dataDir, 'blobs'));
    let path;
    try {
      path = realpathSync(resolve(base, asset.key));
    } catch {
      throw new PageValidationError('첨부 파일 원본이 없어요. 백업에서 복원해 주세요.');
    }
    if (!path.startsWith(base + '/'))
      throw new PageValidationError('첨부 파일 경로를 확인해 주세요.');
    const size = statSync(path);
    if (!size.isFile()) throw new PageValidationError('첨부 파일 원본을 확인해 주세요.');
    total += size.size;
    if (total > 200 * 1024 * 1024)
      throw new PageValidationError('한 번에 200MB까지 내보낼 수 있어요. 페이지를 나눠 주세요.');
    const ext = extname(asset.name);
    const name = `files/${id}${/^\.[a-z0-9]{1,10}$/i.test(ext) ? ext : '.bin'}`;
    files.push({ name, path });
    assets.set(id, asset);
  }
  let html = renderSharedPage(page, token, assets, {
    planTasks: store.getPublicPlanTasks?.(page.id) || [],
  }).replaceAll('/share-assets/', 'assets/');
  // file:// cannot reliably import ES modules. Preserve the diagram source as the
  // offline fallback; interactive rendering belongs to the same-origin shared reader.
  html = html.replace('<script type="module" src="/share-viewer/entry.js"></script>', '')
    .replaceAll('<details class="diagram-source-details">', '<details class="diagram-source-details" open>');
  for (const file of files) {
    const id = file.name.slice(6).split('.')[0];
    html = html.replaceAll(`/s/${token}/assets/${id}`, file.name);
  }
  for (const [id, asset] of assets)
    if (!asset.mime.startsWith('image/')) {
      const file = files.find((f) => f.name.startsWith(`files/${id}.`));
      html = html.replaceAll(`<a href="${file.name}">`, `<a href="${file.name}" download>`);
    }
  html = html
    .replace('읽기 전용 공유 ·', '오프라인 사본 ·')
    .replace(
      '이 링크는 이 페이지만 보여줍니다. 연결된 비공개 문서는 열리지 않습니다.',
      '저장한 사본입니다. 외부 장소 링크는 인터넷 연결이 필요합니다.',
    );
  const entries = [{ name: 'index.html', data: Buffer.from(html) }, ...files];
  // Server-only checkouts may not have built browser controls yet. Keep those
  // exports readable without referencing an absent script.
  const copyScript = join(root, 'dist', 'share-code.js');
  if (existsSync(copyScript)) entries.push({ name: 'assets/share-code.js', data: readFileSync(copyScript) });
  else entries[0].data = Buffer.from(html.replace('<script src="assets/share-code.js" defer></script>', ''));
  for (const name of [
    'favicon.png',
    'share-plan.css',
    'share-plan.js',
    'share-theme.css',
    'share-theme.js',
    'itinerary-timetable.css',
    'callout.css',
    'document.css',
    'document-fonts.css',
    'diagram.css',
  ]) {
    const data = readFileSync(join(root, existsSync(join(root, 'dist', name)) ? 'dist' : 'public', name));
    entries.push({
      name: 'assets/' + name,
      data: name === 'document-fonts.css' ? Buffer.from(data.toString('utf8').replaceAll("'/fonts/", "'../fonts/")) : data,
    });
  }
  for (const family of ['dm-sans', 'noto-sans-kr', 'pretendard', 'ridibatang'])
    for (const suffix of ['.woff2', '-OFL.txt'])
      entries.push({ name: `fonts/${family}${suffix}`, data: readFileSync(join(root, existsSync(join(root, 'public', 'fonts')) ? 'public' : 'dist', 'fonts', family + suffix)) });
  entries.push({
    name: 'README.txt',
    data: Buffer.from(
      'index.html을 브라우저로 여세요. 첨부는 files 폴더에 있습니다.\n외부 지도/웹 링크는 온라인 연결이 필요합니다. 이 사본은 공유 링크 폐기 후에도 남습니다.\n다이어그램은 Mermaid 원문으로 포함됩니다. 그림과 확대 보기는 앱 또는 온라인 공유 페이지에서 이용하세요.\n개인 댓글·AI 내부 정보·하위 페이지는 포함하지 않습니다.\n',
    ),
  });
  return entries;
}
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(buffer, crc = 0xffffffff) {
  for (const byte of buffer) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}
// ZIP32 STORE, data descriptors, backpressure via the async iterator; attachments never buffered in full.
export async function* zipEntries(entries) {
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x808, 6);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0x21, 12);
    const start = offset;
    yield header;
    yield name;
    offset += header.length + name.length;
    let crc = 0xffffffff,
      size = 0;
    const source = entry.data ? [entry.data] : createReadStream(entry.path);
    for await (const chunk of source) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      offset += chunk.length;
      yield chunk;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    yield descriptor;
    offset += 16;
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x808, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(start, 42);
    central.writeUInt16LE(0x21, 14);
    directory.push(Buffer.concat([central, name]));
  }
  const directoryOffset = offset;
  for (const chunk of directory) {
    yield chunk;
    offset += chunk.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - directoryOffset, 12);
  end.writeUInt32LE(directoryOffset, 16);
  yield end;
}

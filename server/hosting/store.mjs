import { hostname } from 'node:os';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { lstat, readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const limits = {
  sites: 100,
  files: 1000,
  fileBytes: 25 * 1024 * 1024,
  siteBytes: 50 * 1024 * 1024,
  totalBytes: 500 * 1024 * 1024,
};
export const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webmanifest': 'application/manifest+json',
};
export class HostingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function safeFilePath(value) {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    value.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    return false;
  const segments = value.split('/');
  return (
    segments.length <= 16 &&
    segments.every((p) => p && !p.startsWith('.') && !p.includes(':')) &&
    Object.hasOwn(mimeTypes, extname(value).toLowerCase())
  );
}
function slugValue(slug) {
  if (
    typeof slug !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ||
    ['health', 'api'].includes(slug)
  )
    throw new HostingError(422, '주소는 영문 소문자·숫자·하이픈으로 1–64자 입력해 주세요.');
  return slug;
}
function nameValue(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120)
    throw new HostingError(422, '사이트 이름을 120자 이내로 입력해 주세요.');
  return name.trim();
}
function automaticSlug(name, sites) {
  const prefix =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'site';
  let slug;
  do {
    slug = `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  } while (sites.some((site) => site.slug === slug));
  return slug;
}
const uuid = /^[a-f0-9-]{36}$/;
function publicItem(site) {
  const { files, bundle, ...item } = site;
  return {
    ...item,
    fileCount: Object.keys(files).length,
    htmlCount: Object.keys(files).filter((p) => /\.html?$/i.test(p)).length,
  };
}
export function createHostingStore(directory) {
  const root = resolve(directory),
    registry = join(root, 'registry.json');
  function readRegistry() {
    if (!existsSync(registry)) return { version: 1, sites: [] };
    let data;
    try {
      data = JSON.parse(readFileSync(registry, 'utf8'));
    } catch {
      throw new HostingError(503, '사이트 목록을 읽지 못했어요. 등록 자료를 확인해 주세요.');
    }
    if (data.version !== 1 || !Array.isArray(data.sites) || data.sites.length > limits.sites)
      throw new HostingError(503, '사이트 목록 형식을 확인해 주세요.');
    for (const s of data.sites) {
      if (
        !s ||
        !uuid.test(s.bundle) ||
        !safeFilePath(s.entry) ||
        !s.files ||
        !Object.hasOwn(s.files, s.entry) ||
        !Number.isSafeInteger(s.version) ||
        s.version < 1 ||
        typeof s.enabled !== 'boolean' ||
        !Number.isSafeInteger(s.bytes) ||
        s.bytes < 0
      )
        throw new HostingError(503, '사이트 목록 형식을 확인해 주세요.');
      slugValue(s.slug);
      nameValue(s.name);
      for (const [path, f] of Object.entries(s.files))
        if (
          !safeFilePath(path) ||
          !f ||
          !Number.isSafeInteger(f.bytes) ||
          f.bytes < 0 ||
          !/^[a-f0-9]{64}$/.test(f.sha256)
        )
          throw new HostingError(503, '사이트 파일 목록을 확인해 주세요.');
    }
    return data;
  }
  function lock() {
    mkdirSync(root, { recursive: true });
    const path = join(root, '.lock'),
      token = randomUUID(),
      ownerPath = join(path, 'owner.json');
    try {
      mkdirSync(path);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner;
      try {
        owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
      } catch {}
      let stopped = false;
      if (owner?.host === hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          stopped = error.code === 'ESRCH';
        }
      } else if (!owner) stopped = Date.now() - statSync(path).mtimeMs > 300_000;
      if (!stopped)
        throw new HostingError(
          409,
          '다른 사이트 저장이 진행 중이에요. 잠시 뒤 다시 시도해 주세요.',
        );
      const claim = join(path, 'reclaim.json');
      try {
        writeFileSync(claim, JSON.stringify({ token, pid: process.pid, host: hostname() }), {
          flag: 'wx',
        });
      } catch {
        throw new HostingError(
          409,
          '다른 사이트 저장이 진행 중이에요. 잠시 뒤 다시 시도해 주세요.',
        );
      }
      let currentOwner;
      try {
        currentOwner = JSON.parse(readFileSync(ownerPath, 'utf8'));
      } catch {}
      if (currentOwner?.token !== owner?.token) {
        try {
          if (JSON.parse(readFileSync(claim, 'utf8')).token === token) rmSync(claim);
        } catch {}
        throw new HostingError(
          409,
          '다른 사이트 저장이 진행 중이에요. 잠시 뒤 다시 시도해 주세요.',
        );
      }
      // Move the stale lock aside; never recursively remove a replacement writer's lock.
      const stale = join(root, '.stale-lock-' + token);
      try {
        renameSync(path, stale);
        mkdirSync(path);
      } catch {
        throw new HostingError(
          409,
          '다른 사이트 저장이 진행 중이에요. 잠시 뒤 다시 시도해 주세요.',
        );
      } finally {
        rmSync(stale, { recursive: true, force: true });
      }
    }
    writeFileSync(ownerPath, JSON.stringify({ token, pid: process.pid, host: hostname() }), {
      flag: 'wx',
      mode: 0o600,
    });
    return () => {
      try {
        if (JSON.parse(readFileSync(ownerPath, 'utf8')).token === token)
          rmSync(path, { recursive: true, force: true });
      } catch {}
    };
  }
  function save(data) {
    const temp = join(root, '.registry-' + randomUUID());
    try {
      writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      renameSync(temp, registry);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  async function importFiles({
    slug,
    name,
    entry = 'index.html',
    enabled = false,
    files,
    skipped = 0,
  }) {
    const automatic = slug === undefined || slug === '';
    if (!automatic) slugValue(slug);
    name = nameValue(name);
    if (!safeFilePath(entry) || !/\.html?$/i.test(entry))
      throw new HostingError(422, '시작 페이지는 폴더 안의 HTML 파일이어야 해요.');
    const release = lock(),
      bundle = randomUUID(),
      staging = join(root, '.import-' + bundle),
      destination = join(root, 'bundles', bundle);
    let completed = false;
    try {
      const data = readRegistry();
      if (automatic) slug = automaticSlug(name, data.sites);
      if (data.sites.some((s) => s.slug === slug))
        throw new HostingError(409, '같은 주소의 사이트가 있어요. 다른 주소를 입력해 주세요.');
      if (data.sites.length >= limits.sites)
        throw new HostingError(413, '사이트는 100개까지 등록할 수 있어요.');
      await mkdir(staging, { recursive: true });
      const manifest = Object.create(null);
      let bytes = 0,
        count = 0;
      for await (const file of files) {
        if (!safeFilePath(file.path) || Object.hasOwn(manifest, file.path))
          throw new HostingError(422, '중복되거나 올바르지 않은 파일 경로가 있어요.');
        const content = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
        bytes += content.length;
        count++;
        if (count > limits.files || content.length > limits.fileBytes || bytes > limits.siteBytes)
          throw new HostingError(
            413,
            '사이트는 1,000개 파일·총 50MB, 개별 파일은 25MB까지 등록할 수 있어요.',
          );
        if (bytes + data.sites.reduce((n, s) => n + s.bytes, 0) > limits.totalBytes)
          throw new HostingError(413, '전체 사이트 용량은 500MB까지 등록할 수 있어요.');
        const target = join(staging, file.path);
        await mkdir(resolve(target, '..'), { recursive: true });
        await writeFile(target, content, { flag: 'wx' });
        manifest[file.path] = {
          bytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
        };
      }
      if (!Object.hasOwn(manifest, entry))
        throw new HostingError(422, `시작 페이지 ${entry}를 찾을 수 없어요.`);
      const now = new Date().toISOString();
      const site = {
        id: bundle,
        bundle,
        slug,
        name: nameValue(name),
        entry,
        enabled: enabled === true,
        files: manifest,
        bytes,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await mkdir(join(root, 'bundles'), { recursive: true });
      renameSync(staging, destination);
      data.sites.push(site);
      save(data);
      completed = true;
      return { ...publicItem(site), skipped };
    } finally {
      await rm(staging, { recursive: true, force: true });
      if (!completed) await rm(destination, { recursive: true, force: true });
      release();
    }
  }
  async function importDirectory({ source, ...options }) {
    const sourceRoot = resolve(source);
    if (!(await lstat(sourceRoot)).isDirectory())
      throw new HostingError(422, '일반 폴더를 선택해 주세요.');
    const paths = [];
    let skipped = 0;
    async function walk(dir, prefix = '') {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = prefix + entry.name,
          full = join(dir, entry.name);
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) {
          skipped++;
          continue;
        }
        if (entry.isDirectory()) {
          if (path.split('/').length >= 16) {
            skipped++;
            continue;
          }
          await walk(full, path + '/');
        } else if (entry.isFile() && safeFilePath(path)) {
          paths.push({ path, full });
          if (paths.length > limits.files)
            throw new HostingError(413, '파일은 1,000개까지 등록할 수 있어요.');
        } else skipped++;
      }
    }
    await walk(sourceRoot);
    async function* fileData() {
      for (const file of paths) {
        const s = await lstat(file.full);
        if (!s.isFile() || s.isSymbolicLink())
          throw new HostingError(422, '가져오는 중 파일이 변경됐어요. 다시 시도해 주세요.');
        if (s.size > limits.fileBytes)
          throw new HostingError(413, '개별 파일은 25MB까지 등록할 수 있어요.');
        yield { path: file.path, data: await readFile(file.full) };
      }
    }
    return importFiles({ ...options, files: fileData(), skipped });
  }
  return {
    root,
    importFiles,
    importDirectory,
    list() {
      const data = readRegistry();
      return {
        items: data.sites.map(publicItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        limits,
        totalBytes: data.sites.reduce((n, s) => n + s.bytes, 0),
      };
    },
    read(slug) {
      return readRegistry().sites.find((s) => s.slug === slug) || null;
    },
    update(slug, { name, enabled, expectedVersion }) {
      const release = lock();
      try {
        const data = readRegistry(),
          site = data.sites.find((s) => s.slug === slug);
        if (!site) throw new HostingError(404, '사이트를 찾을 수 없어요.');
        if (site.version !== expectedVersion)
          throw new HostingError(409, '사이트 상태가 변경됐어요. 목록을 새로 불러와 주세요.');
        if (enabled !== undefined && typeof enabled !== 'boolean')
          throw new HostingError(422, '공개 상태를 확인해 주세요.');
        if (name !== undefined) site.name = nameValue(name);
        if (enabled !== undefined) site.enabled = enabled;
        site.version++;
        site.updatedAt = new Date().toISOString();
        save(data);
        return publicItem(site);
      } finally {
        release();
      }
    },
  };
}

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { createBackup, verifyBackup } from './backups.mjs';

const DEFAULTS = { enabled: false, hour: 4, minute: 0, retention: 7 };
const STATE_FILE = 'automatic-backups.json';
const MARKER_FILE = 'automatic-backup.json';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME = /^automatic-\d{8}T\d{6}-[a-f0-9-]{36}$/;
const DAY = 86_400_000;
const KST = 9 * 60 * 60 * 1000;

function containsPath(parent, child) {
  return parent === child || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function problem(message, status = 500) {
  return Object.assign(new Error(message), { status });
}

function validateSettings(input, current = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length)
    throw problem('백업 설정을 입력해 주세요.', 400);
  if (Object.keys(input).some((key) => !Object.hasOwn(DEFAULTS, key)))
    throw problem('지원하지 않는 백업 설정입니다.', 400);
  const value = { ...current, ...input };
  if (typeof value.enabled !== 'boolean') throw problem('자동 백업 여부를 확인해 주세요.', 400);
  for (const [key, max, min] of [
    ['hour', 23, 0],
    ['minute', 59, 0],
    ['retention', 60, 1],
  ]) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)
      throw problem('실행 시각은 00:00–23:59, 보관 개수는 1–60개로 입력해 주세요.', 400);
  }
  return value;
}

async function optionalInfo(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function directory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw problem('백업 경로에 연결된 디렉터리나 일반 파일을 사용할 수 없습니다.');
}

async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw problem('백업 설정과 목록은 일반 파일이어야 합니다.');
  return info;
}

// Validate every existing component before mkdir: resolving a symlink first would hide it.
async function safeAncestors(path) {
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await optionalInfo(current);
    if (!info) continue;
    if (!info.isDirectory() || info.isSymbolicLink())
      throw problem('백업 경로에는 심볼릭 링크를 사용할 수 없습니다.');
  }
}

function schedule(settings, now = Date.now()) {
  const localDay = Math.floor((now + KST) / DAY);
  const today = localDay * DAY - KST + settings.hour * 3_600_000 + settings.minute * 60_000;
  const due = now >= today ? today : today - DAY;
  return {
    dueDate: new Date(due + KST).toISOString().slice(0, 10),
    nextRunAt: new Date(now < today ? today : today + DAY).toISOString(),
  };
}

export function createAutomaticBackups({ dataDir, backupDir }) {
  if (!dataDir || !backupDir) throw problem('데이터 경로와 백업 경로가 필요합니다.');
  const data = resolve(dataDir);
  const destination = resolve(backupDir);
  const metadata = join(destination, STATE_FILE);
  let settings = { ...DEFAULTS };
  let history = [];
  let lastScheduledDate = null;
  let failure = null;
  let ready = null;
  let timer = null;
  let pending = null;
  let running = false;
  let configuring = false;
  let acceptingSchedule = false;
  let lifecycleGeneration = 0;
  let writes = Promise.resolve();
  const accepting = new Set();

  async function safePaths() {
    await directory(data);
    const source = await realpath(data);
    if (
      containsPath(data, destination) ||
      containsPath(destination, data) ||
      containsPath(source, destination) ||
      containsPath(destination, source)
    )
      throw problem('데이터 경로와 백업 경로는 서로 포함하지 않는 별도 디렉터리여야 합니다.');
    await safeAncestors(destination);
    let parent = destination;
    while (!(await optionalInfo(parent))) parent = dirname(parent);
    const canonical = await realpath(parent);
    const actual = canonical + destination.slice(parent.length);
    if (containsPath(source, actual) || containsPath(actual, source))
      throw problem('데이터 경로와 백업 경로는 서로 포함하지 않는 별도 디렉터리여야 합니다.');
  }

  function view() {
    const items = history.map((entry) => ({ ...entry, path: join(destination, entry.name) }));
    return {
      settings: { ...settings, timeZone: 'Asia/Seoul' },
      running,
      nextRunAt: settings.enabled ? schedule(settings).nextRunAt : null,
      lastGood: items.find((entry) => entry.status === 'succeeded' && entry.available) ?? null,
      history: items,
      error: failure,
      backupDir: destination,
    };
  }

  function persist() {
    const content =
      JSON.stringify(
        { schemaVersion: 1, settings, history, lastScheduledDate, error: failure },
        null,
        2,
      ) + '\n';
    const write = async () => {
      await safePaths();
      if (await optionalInfo(metadata)) await regular(metadata);
      const temporary = join(destination, `${STATE_FILE}.partial-${randomUUID()}`);
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(content);
        await handle.sync();
        await handle.close();
        handle = null;
        await safePaths();
        if (await optionalInfo(metadata)) await regular(metadata);
        await rename(temporary, metadata);
      } finally {
        await handle?.close();
        await rm(temporary, { force: true });
      }
    };
    const result = writes.then(write);
    writes = result.catch(() => {});
    return result;
  }

  async function verified(entry) {
    try {
      await safePaths();
      const path = join(destination, entry.name);
      await directory(path);
      await directory(join(path, 'blobs'));
      await regular(join(path, 'manifest.json'));
      const markerPath = join(path, MARKER_FILE);
      if ((await regular(markerPath)).size > 1024) return false;
      const marker = JSON.parse(await readFile(markerPath, 'utf8'));
      if (marker.schemaVersion !== 1 || marker.id !== entry.id || marker.name !== entry.name)
        return false;
      await verifyBackup(path);
      return true;
    } catch {
      return false;
    }
  }

  async function initialize() {
    await safePaths();
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await safePaths();
    const info = await optionalInfo(metadata);
    if (!info) return;
    if ((await regular(metadata)).size > 1_000_000) throw problem('백업 설정 파일이 너무 큽니다.');
    const saved = JSON.parse(await readFile(metadata, 'utf8'));
    if (
      saved?.schemaVersion !== 1 ||
      !Array.isArray(saved.history) ||
      saved.history.length > 100 ||
      !(saved.lastScheduledDate === null || /^\d{4}-\d{2}-\d{2}$/.test(saved.lastScheduledDate)) ||
      !(saved.error === null || typeof saved.error === 'string')
    )
      throw problem('저장된 백업 설정 형식을 확인해 주세요.');
    settings = validateSettings(saved.settings);
    for (const entry of saved.history) {
      if (
        !UUID.test(entry?.id) ||
        !NAME.test(entry?.name) ||
        !entry.name.endsWith(entry.id) ||
        !['manual', 'scheduled'].includes(entry.trigger) ||
        !['running', 'succeeded', 'failed'].includes(entry.status) ||
        !Number.isFinite(Date.parse(entry.startedAt)) ||
        !(entry.finishedAt === null || Number.isFinite(Date.parse(entry.finishedAt))) ||
        typeof entry.available !== 'boolean' ||
        !(entry.error === null || typeof entry.error === 'string')
      )
        throw problem('저장된 백업 실행 목록 형식을 확인해 주세요.');
    }
    history = saved.history.map(
      ({ id, name, trigger, startedAt, finishedAt, status, error, available }) => ({
        id,
        name,
        trigger,
        startedAt,
        finishedAt,
        status,
        error,
        available,
      }),
    );
    lastScheduledDate = saved.lastScheduledDate;
    failure = saved.error;
    let changed = false;
    for (const entry of history) {
      if (entry.status === 'running') {
        entry.status = 'failed';
        entry.finishedAt = new Date().toISOString();
        entry.error = '서버가 재시작되어 이전 백업이 완료되지 않았습니다. 다시 실행해 주세요.';
        entry.available = false;
        failure = entry.error;
        changed = true;
      } else if (entry.status === 'succeeded' && entry.available && !(await verified(entry))) {
        entry.available = false;
        changed = true;
      }
    }
    if (changed) await persist();
  }

  function ensureReady() {
    ready ??= initialize();
    return ready;
  }

  async function prune() {
    let retained = 0;
    for (const entry of history) {
      if (entry.status !== 'succeeded' || !entry.available) continue;
      if (!(await verified(entry))) {
        entry.available = false;
        continue;
      }
      retained += 1;
      if (retained <= settings.retention) continue;
      // Re-check after verification before removal, including the root and ownership marker.
      if (!(await verified(entry))) {
        entry.available = false;
        continue;
      }
      await rm(join(destination, entry.name), { recursive: true });
      entry.available = false;
    }
  }

  async function execute(entry) {
    try {
      await safePaths();
      const path = join(destination, entry.name);
      await createBackup(data, path);
      await directory(path);
      const marker = await open(join(path, MARKER_FILE), 'wx', 0o600);
      try {
        await marker.writeFile(
          JSON.stringify({ schemaVersion: 1, id: entry.id, name: entry.name }) + '\n',
        );
        await marker.sync();
      } finally {
        await marker.close();
      }
      if (!(await verified(entry)))
        throw problem('생성한 백업의 무결성을 확인하지 못했습니다. 다시 실행해 주세요.');
      entry.status = 'succeeded';
      entry.available = true;
      entry.finishedAt = new Date().toISOString();
      failure = null;
      await persist();
      await prune();
    } catch (error) {
      if (entry.status !== 'succeeded') {
        entry.status = 'failed';
        entry.available = false;
        entry.error =
          error instanceof Error ? error.message : '백업에 실패했습니다. 다시 실행해 주세요.';
      }
      failure = error instanceof Error ? error.message : '백업에 실패했습니다. 다시 실행해 주세요.';
      entry.finishedAt = new Date().toISOString();
    } finally {
      running = false;
      try {
        await persist();
      } catch (error) {
        failure = `백업 실행 상태를 저장하지 못했습니다: ${error.message}`;
      }
    }
  }

  async function launch(trigger, dueDate = null) {
    await ensureReady();
    if (running) throw problem('백업이 이미 실행 중입니다. 완료 후 다시 실행해 주세요.', 409);
    if (configuring) throw problem('백업 설정을 저장 중입니다. 잠시 후 다시 실행해 주세요.', 409);
    running = true;
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const name = `automatic-${startedAt.replace(/[-:]/g, '').slice(0, 15)}-${id}`;
    const entry = {
      id,
      name,
      trigger,
      startedAt,
      finishedAt: null,
      status: 'running',
      error: null,
      available: false,
    };
    history.unshift(entry);
    const goodCount = history.filter(
      (item) => item.status === 'succeeded' && item.available,
    ).length;
    let otherSlots = 100 - goodCount;
    history = history.filter(
      (item) => (item.status === 'succeeded' && item.available) || otherSlots-- > 0,
    );
    if (dueDate) lastScheduledDate = dueDate;
    try {
      await persist();
    } catch (error) {
      running = false;
      entry.status = 'failed';
      entry.finishedAt = new Date().toISOString();
      entry.error = error.message;
      failure = error.message;
      throw error;
    }
    const accepted = view();
    // Keep the HTTP acceptance independent from online snapshot/checksum work.
    pending = new Promise((resolveJob) => setImmediate(resolveJob)).then(() => execute(entry));
    pending.catch(() => {});
    return accepted;
  }

  async function tick() {
    if (!acceptingSchedule || !settings.enabled || running || configuring) return;
    const { dueDate } = schedule(settings);
    if (lastScheduledDate && lastScheduledDate >= dueDate) return;
    try {
      await accept('scheduled', dueDate);
    } catch (error) {
      failure = error.message;
    }
  }

  function accept(trigger, dueDate = null) {
    const job = launch(trigger, dueDate);
    accepting.add(job);
    job.finally(() => accepting.delete(job)).catch(() => {});
    return job;
  }

  return {
    async status() {
      await ensureReady();
      return view();
    },
    async configure(input) {
      await ensureReady();
      if (running) throw problem('백업이 실행 중입니다. 완료 후 설정을 변경해 주세요.', 409);
      if (configuring) throw problem('백업 설정을 저장 중입니다. 잠시 후 다시 변경해 주세요.', 409);
      const next = validateSettings(input, settings);
      const previous = settings;
      const previousDate = lastScheduledDate;
      configuring = true;
      // First activation before today's time starts with today's upcoming schedule.
      if (!settings.enabled && next.enabled && lastScheduledDate === null)
        lastScheduledDate = schedule(next).dueDate;
      settings = next;
      try {
        await persist();
        return view();
      } catch (error) {
        settings = previous;
        lastScheduledDate = previousDate;
        throw error;
      } finally {
        configuring = false;
      }
    },
    async runNow() {
      return accept('manual');
    },
    async start() {
      const generation = lifecycleGeneration;
      await ensureReady();
      if (generation !== lifecycleGeneration) return view();
      if (timer) return view();
      acceptingSchedule = true;
      timer = setInterval(() => {
        void tick();
      }, 60_000);
      timer.unref?.();
      await tick();
      return view();
    },
    async stop() {
      ++lifecycleGeneration;
      acceptingSchedule = false;
      if (timer) clearInterval(timer);
      timer = null;
      await Promise.allSettled([...accepting]);
      await pending;
      await writes;
    },
  };
}

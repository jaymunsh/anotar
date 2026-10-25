import { randomUUID, createHash } from 'node:crypto';
import { defaultTemplates, validateDraft } from '../shared/prompts.ts';

export class PromptValidationError extends Error {}
export class PromptConflictError extends Error {
  constructor(message, current) {
    super(message);
    this.current = current;
  }
}
const validId = (id) =>
  typeof id === 'string' &&
  /^[a-z0-9-]{1,80}$/.test(id) &&
  !['new', 'import', 'constructor'].includes(id);
const fields = (value) => ({
  name: value.name.trim(),
  description: value.description.trim(),
  kind: value.kind,
  body: value.body,
  archived: value.archived,
});
// The keyword preset before it absorbed URL research (research-merged-v1).
const LEGACY_KEYWORD = {
  name: '키워드 리서치',
  description: '주제·키워드로 자료를 찾아 핵심 3줄과 출처 정리',
  kind: 'research',
  body: `다음 주제의 관련 자료를 조사하고 한국어로 정리해 주세요.

주제와 조건: {{content}}

## 핵심 요약
가장 중요한 내용을 3줄로 정리해 주세요.

## 근거와 출처
확인한 자료만 사용하고 주요 주장에 출처 링크를 붙여 주세요.
공식·1차 자료를 우선하고 서로 다른 관점이 있으면 구분해 주세요.

## 더 확인할 점
추가 조사할 질문과 자료의 한계를 적어 주세요.
확인하지 못한 사실은 추측해서 채우지 말고 ‘미확인’으로 표시해 주세요.`,
  archived: false,
};
const same = (a, b) => JSON.stringify(fields(a)) === JSON.stringify(fields(b));
function clean(input) {
  try {
    validateDraft(input);
  } catch (error) {
    throw new PromptValidationError(error.message);
  }
  if (!validId(input.id)) throw new PromptValidationError('템플릿 ID가 올바르지 않아요.');
  return { ...fields(input), id: input.id };
}

export function createPromptStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('research','free')), body TEXT NOT NULL,
      archived INTEGER NOT NULL CHECK(archived IN (0,1)), version INTEGER NOT NULL,
      revision_id TEXT NOT NULL, create_payload TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompt_revisions (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES prompt_templates(id),
      version INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
      kind TEXT NOT NULL, body TEXT NOT NULL, archived INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(template_id, version)
    );
    CREATE TABLE IF NOT EXISTS prompt_imports (
      source_id TEXT NOT NULL, content_hash TEXT NOT NULL,
      target_id TEXT NOT NULL REFERENCES prompt_templates(id),
      target_version INTEGER NOT NULL, target_revision_id TEXT NOT NULL,
      PRIMARY KEY(source_id,content_hash)
    );
  `);
  // Preserve databases opened while the import mapping was being introduced.
  const importColumns = db
    .prepare('PRAGMA table_info(prompt_imports)')
    .all()
    .map((column) => column.name);
  if (!importColumns.includes('target_version')) {
    db.exec(
      'ALTER TABLE prompt_imports ADD COLUMN target_version INTEGER; ALTER TABLE prompt_imports ADD COLUMN target_revision_id TEXT;',
    );
    db.exec(`UPDATE prompt_imports SET
      target_version=(SELECT version FROM prompt_templates WHERE id=target_id),
      target_revision_id=(SELECT revision_id FROM prompt_templates WHERE id=target_id)`);
  }
  const select = db.prepare(
    `SELECT id,name,description,kind,body,archived,version,revision_id AS revisionId,created_at AS createdAt,updated_at AS updatedAt FROM prompt_templates WHERE id=?`,
  );
  const hydrate = (row) => (row ? { ...row, archived: !!row.archived } : null);
  const get = (id) => hydrate(select.get(id));
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  function revision(item) {
    db.prepare('INSERT INTO prompt_revisions VALUES (?,?,?,?,?,?,?,?,?)').run(
      item.revisionId,
      item.id,
      item.version,
      item.name,
      item.description,
      item.kind,
      item.body,
      Number(item.archived),
      item.updatedAt,
    );
  }
  function insert(input) {
    const value = clean(input);
    const current = get(value.id);
    if (current) {
      const payload = db
        .prepare('SELECT create_payload FROM prompt_templates WHERE id=?')
        .get(value.id).create_payload;
      if (payload !== JSON.stringify(value))
        throw new PromptConflictError(
          '이미 다른 내용으로 생성된 템플릿이에요. 최신 내용을 확인해 주세요.',
          current,
        );
      const saved = db
        .prepare(
          'SELECT name,description,kind,body,archived,version,id AS revisionId,created_at AS updatedAt FROM prompt_revisions WHERE template_id=? AND version=1',
        )
        .get(value.id);
      return hydrate({ ...current, ...saved });
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM prompt_templates').get().count >= 200)
      throw new PromptValidationError('템플릿은 최대 200개까지 저장할 수 있어요.');
    const now = new Date().toISOString();
    const item = { ...value, version: 1, revisionId: randomUUID(), createdAt: now, updatedAt: now };
    db.prepare('INSERT INTO prompt_templates VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      item.id,
      item.name,
      item.description,
      item.kind,
      item.body,
      Number(item.archived),
      item.version,
      item.revisionId,
      JSON.stringify(value),
      now,
      now,
    );
    revision(item);
    return get(item.id);
  }
  function update(input) {
    const value = clean(input);
    const current = get(value.id);
    if (!current) return null;
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !validId(input.expectedRevisionId)
    )
      throw new PromptValidationError(
        '수정 버전이 올바르지 않아요. 브라우저 초안은 먼저 가져오거나 복제해 주세요.',
      );
    if (
      input.expectedVersion !== current.version ||
      input.expectedRevisionId !== current.revisionId
    )
      throw new PromptConflictError(
        '다른 탭에서 먼저 수정한 템플릿이에요. 최신 내용을 확인해 주세요. 초안은 그대로 남아 있어요.',
        current,
      );
    const item = {
      ...current,
      ...value,
      version: current.version + 1,
      revisionId: randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    db.prepare(
      'UPDATE prompt_templates SET name=?,description=?,kind=?,body=?,archived=?,version=?,revision_id=?,updated_at=? WHERE id=?',
    ).run(
      item.name,
      item.description,
      item.kind,
      item.body,
      Number(item.archived),
      item.version,
      item.revisionId,
      item.updatedAt,
      item.id,
    );
    revision(item);
    return get(item.id);
  }
  transaction(() => {
    if (!db.prepare("SELECT value FROM prompt_meta WHERE key='library_id'").get()) {
      db.prepare("INSERT INTO prompt_meta VALUES ('library_id',?)").run(randomUUID());
      for (const item of defaultTemplates()) insert(item);
    }
    // Retire only the unchanged built-in travel preset. User edits and copies stay intact.
    if (!db.prepare("SELECT value FROM prompt_meta WHERE key='travel-preset-retired-v1'").get()) {
      const current = get('travel-outline');
      const preset = defaultTemplates().find(item => item.id === 'travel-outline');
      if (current && !current.archived && same(current, { ...preset, archived: false }))
        update({ ...current, archived: true, expectedVersion: current.version, expectedRevisionId: current.revisionId });
      db.prepare("INSERT INTO prompt_meta VALUES ('travel-preset-retired-v1','1')").run();
    }
    // Add this new preset to older libraries; never rewrite an existing revision/archive.
    if (
      !get('research-keyword') &&
      db.prepare('SELECT COUNT(*) AS count FROM prompt_templates').get().count < 200
    ) {
      insert(defaultTemplates().find((item) => item.id === 'research-keyword'));
    }
    // One 리서치 preset handles both URL and keyword: update/retire only unchanged built-ins.
    if (!db.prepare("SELECT value FROM prompt_meta WHERE key='research-merged-v1'").get()) {
      const seeds = defaultTemplates();
      const keyword = get('research-keyword'),
        brief = get('research-brief');
      if (keyword && same(keyword, LEGACY_KEYWORD))
        update({ ...keyword, ...fields(seeds.find((item) => item.id === 'research-keyword')), expectedVersion: keyword.version, expectedRevisionId: keyword.revisionId });
      if (brief && same(brief, { ...seeds.find((item) => item.id === 'research-brief'), archived: false }))
        update({ ...brief, archived: true, expectedVersion: brief.version, expectedRevisionId: brief.revisionId });
      db.prepare("INSERT INTO prompt_meta VALUES ('research-merged-v1','1')").run();
    }
  });
  const libraryId = db.prepare("SELECT value FROM prompt_meta WHERE key='library_id'").get().value;
  return {
    listPromptTemplates() {
      return {
        libraryId,
        items: db
          .prepare(`SELECT id FROM prompt_templates ORDER BY rowid`)
          .all()
          .map(({ id }) => get(id)),
      };
    },
    getPromptTemplate: get,
    listPromptRevisions(templateId) {
      if(!get(templateId))return null;
      return db.prepare('SELECT id,template_id AS templateId,version,name,description,kind,body,archived,created_at AS createdAt FROM prompt_revisions WHERE template_id=? ORDER BY version DESC LIMIT 100').all(templateId).map(hydrate);
    },
    getPromptRevision(id) {
      return hydrate(
        db
          .prepare(
            'SELECT id,template_id AS templateId,version,name,description,kind,body,archived,created_at AS createdAt FROM prompt_revisions WHERE id=?',
          )
          .get(id),
      );
    },
    createPromptTemplate(input) {
      return transaction(() => insert(input));
    },
    updatePromptTemplate(input) {
      return transaction(() => update(input));
    },
    importPromptTemplates(items) {
      if (!Array.isArray(items) || items.length > 200)
        throw new PromptValidationError('가져올 템플릿은 최대 200개예요.');
      const ids = new Set();
      const values = items.map((item) => {
        const value = clean(item);
        if (ids.has(value.id) || !Number.isSafeInteger(item.version) || item.version < 1)
          throw new PromptValidationError('가져올 템플릿 ID·버전이 올바르지 않아요.');
        ids.add(value.id);
        return { ...value, sourceVersion: item.version };
      });
      return transaction(() => {
        const mappings = [];
        let created = 0,
          updated = 0,
          unchanged = 0;
        for (const source of values) {
          const hash = createHash('sha256')
            .update(JSON.stringify(fields(source)))
            .digest('hex');
          const imported = db
            .prepare(
              'SELECT target_id,target_version,target_revision_id FROM prompt_imports WHERE source_id=? AND content_hash=?',
            )
            .get(source.id, hash);
          let target = imported ? get(imported.target_id) : get(source.id);
          if (imported || (target && same(source, target))) unchanged++;
          else if (
            target &&
            target.version === 1 &&
            defaultTemplates().some((seed) => seed.id === target.id && same(seed, target))
          ) {
            target = update({
              ...source,
              expectedVersion: target.version,
              expectedRevisionId: target.revisionId,
            });
            updated++;
          } else {
            target = insert({
              ...source,
              id: target ? randomUUID() : source.id,
              name: target ? `${source.name.slice(0, 72)} (가져옴)` : source.name,
            });
            created++;
          }
          db.prepare(
            'INSERT OR IGNORE INTO prompt_imports (source_id,content_hash,target_id,target_version,target_revision_id) VALUES (?,?,?,?,?)',
          ).run(source.id, hash, target.id, target.version, target.revisionId);
          mappings.push({
            sourceId: source.id,
            sourceVersion: source.sourceVersion,
            targetId: target.id,
            targetVersion: imported?.target_version ?? target.version,
            targetRevisionId: imported?.target_revision_id ?? target.revisionId,
          });
        }
        return { ...this.listPromptTemplates(), created, updated, unchanged, mappings };
      });
    },
  };
}

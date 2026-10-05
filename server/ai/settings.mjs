import { AiValidationError, AiConflictError } from './contracts.mjs';
import { pageTransaction } from '../pageConnections.mjs';
export function createAiSettingsStore(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, version INTEGER NOT NULL)',
  );
  return {
    getAiSettings() {
      const row = db.prepare('SELECT body,version FROM ai_settings WHERE id=1').get();
      return row ? { ...JSON.parse(row.body), version: row.version } : null;
    },
    saveAiSettings(value, expectedVersion) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
        throw new AiValidationError('설정 버전이 올바르지 않아요.');
      return pageTransaction(db, () => {
        const current = db.prepare('SELECT version FROM ai_settings WHERE id=1').get();
        if ((current?.version ?? 0) !== expectedVersion)
          throw new AiConflictError('AI 설정이 변경됐어요. 최신 설정을 다시 불러와 주세요.');
        db.prepare(
          'INSERT INTO ai_settings VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,version=excluded.version',
        ).run(JSON.stringify(value), expectedVersion + 1);
        return { ...value, version: expectedVersion + 1 };
      });
    },
  };
}

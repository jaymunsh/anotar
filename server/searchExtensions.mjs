const fields = 'target_kind,target_id,category,title,body,url,icon,kind,created_at,updated_at';
const upsert = `ON CONFLICT(target_kind,target_id) DO UPDATE SET category=excluded.category,title=excluded.title,body=excluded.body,url=excluded.url,icon=excluded.icon,kind=excluded.kind,created_at=excluded.created_at,updated_at=excluded.updated_at`;
const resultVisible =
  "j.status='result_ready' AND ((c.id IS NOT NULL AND c.deleted_at IS NULL) OR (p.id IS NOT NULL AND p.deleted_at IS NULL))";
const resultSelect = `SELECT 'ai_job',j.id,'result',CASE WHEN json_extract(j.request_json,'$.kind')='research' THEN '리서치 결과' ELSE 'AI 결과' END,COALESCE(json_extract(j.result_json,'$.markdown'),''),'','','',j.created_at,j.updated_at FROM ai_jobs j LEFT JOIN captures c ON c.id=j.capture_id LEFT JOIN pages p ON p.id=j.page_id WHERE ${resultVisible}`;
const ocrVisible = `j.status='result_ready' AND ((c.id IS NOT NULL AND c.deleted_at IS NULL AND c.organized_at IS NULL) OR EXISTS (SELECT 1 FROM page_references r JOIN pages p ON p.id=r.page_id WHERE r.target_type='asset' AND r.target_id=a.id AND p.deleted_at IS NULL))`;
const ocrSelect = `SELECT 'ocr',j.id,'ocr',a.name,j.text,'','',a.mime,j.created_at,j.updated_at FROM ocr_jobs j JOIN assets a ON a.id=j.asset_id LEFT JOIN captures c ON c.id=a.capture_id WHERE ${ocrVisible}`;
const taskSelect =
  "SELECT 'task',t.id,'task',t.title,COALESCE(t.due_date,''),'','',t.status,t.created_at,t.updated_at FROM tasks t WHERE 1";
function sync(select, kind, condition, allRows, visible = '1') {
  return `INSERT INTO search_documents (${fields}) ${select} AND (${condition}) ${upsert}; DELETE FROM search_documents WHERE target_kind='${kind}' AND target_id IN (${allRows} WHERE (${condition}) AND NOT (${visible}));`;
}
const syncResult = (c) =>
  sync(
    resultSelect,
    'ai_job',
    c,
    'SELECT j.id FROM ai_jobs j LEFT JOIN captures c ON c.id=j.capture_id LEFT JOIN pages p ON p.id=j.page_id',
    resultVisible,
  );
const syncOcr = (c) =>
  sync(
    ocrSelect,
    'ocr',
    c,
    'SELECT j.id FROM ocr_jobs j JOIN assets a ON a.id=j.asset_id LEFT JOIN captures c ON c.id=a.capture_id',
    ocrVisible,
  );
export function initializeExtendedSearch(db) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
  if (!['tasks', 'ai_jobs', 'ocr_jobs'].every((t) => tables.has(t))) return () => {};
  db.exec(`
 CREATE TRIGGER IF NOT EXISTS search_extra_task_insert AFTER INSERT ON tasks BEGIN INSERT INTO search_documents (${fields}) ${taskSelect} AND t.id=NEW.id ${upsert}; END;
 CREATE TRIGGER IF NOT EXISTS search_extra_task_update AFTER UPDATE ON tasks BEGIN INSERT INTO search_documents (${fields}) ${taskSelect} AND t.id=NEW.id ${upsert}; END;
 CREATE TRIGGER IF NOT EXISTS search_extra_task_delete AFTER DELETE ON tasks BEGIN DELETE FROM search_documents WHERE target_kind='task' AND target_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS search_extra_result_insert AFTER INSERT ON ai_jobs BEGIN ${syncResult('j.id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_extra_result_update AFTER UPDATE OF status,result_json ON ai_jobs BEGIN ${syncResult('j.id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_extra_result_delete AFTER DELETE ON ai_jobs BEGIN DELETE FROM search_documents WHERE target_kind='ai_job' AND target_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS search_extra_ocr_insert AFTER INSERT ON ocr_jobs BEGIN ${syncOcr('j.id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_extra_ocr_update AFTER UPDATE OF status,text ON ocr_jobs BEGIN ${syncOcr('j.id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_extra_ocr_delete AFTER DELETE ON ocr_jobs BEGIN DELETE FROM search_documents WHERE target_kind='ocr' AND target_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS search_extra_capture_update AFTER UPDATE OF deleted_at,organized_at ON captures BEGIN ${syncResult('j.capture_id=NEW.id')} ${syncOcr('a.capture_id=NEW.id')} END;
 CREATE TRIGGER IF NOT EXISTS search_extra_page_update AFTER UPDATE OF deleted_at ON pages BEGIN ${syncResult('j.page_id=NEW.id')} ${syncOcr("a.page_id=NEW.id OR a.id IN (SELECT target_id FROM page_references WHERE page_id=NEW.id AND target_type='asset')")} END;
 CREATE TRIGGER IF NOT EXISTS search_extra_reference_insert AFTER INSERT ON page_references WHEN NEW.target_type='asset' BEGIN ${syncOcr('a.id=NEW.target_id')} END;
 CREATE TRIGGER IF NOT EXISTS search_extra_reference_delete AFTER DELETE ON page_references WHEN OLD.target_type='asset' BEGIN ${syncOcr('a.id=OLD.target_id')} END;
 CREATE TRIGGER IF NOT EXISTS search_extra_asset_update AFTER UPDATE ON assets BEGIN ${syncOcr('a.id=NEW.id')} END;
 `);
  const rebuild = () =>
    db.exec(
      `INSERT INTO search_documents (${fields}) ${taskSelect} ${upsert};INSERT INTO search_documents (${fields}) ${resultSelect} ${upsert};INSERT INTO search_documents (${fields}) ${ocrSelect} ${upsert};`,
    );
  if (
    !db.prepare("SELECT 1 FROM search_schema_migrations WHERE name='results-tasks-ocr-v1'").get()
  ) {
    db.exec('SAVEPOINT extended_search');
    try {
      rebuild();
      db.exec(
        "INSERT INTO search_schema_migrations VALUES('results-tasks-ocr-v1');RELEASE extended_search",
      );
    } catch (e) {
      db.exec('ROLLBACK TO extended_search;RELEASE extended_search');
      throw e;
    }
  }
  return rebuild;
}

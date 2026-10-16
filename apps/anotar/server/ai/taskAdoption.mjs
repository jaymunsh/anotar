import { randomUUID } from 'node:crypto';
import { pageTransaction } from '../pageConnections.mjs';
import {
  AiConflictError,
  AiNotFoundError,
  AiValidationError,
  cleanRequestId,
} from './contracts.mjs';
export function createAiTaskAdoption(db, owner) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS ai_task_adoptions(request_id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES ai_jobs(id),payload TEXT NOT NULL,task_ids TEXT NOT NULL)',
  );
  return {
    adoptAiTasks({ jobId, requestId, tasks }) {
      requestId = cleanRequestId(requestId);
      const job = owner().getAiJob(jobId);
      if (!job) throw new AiNotFoundError('AI 결과를 찾을 수 없어요.');
      if (job.status !== 'result_ready')
        throw new AiConflictError('완료된 결과에서 할 일을 등록해 주세요.');
      if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 50)
        throw new AiValidationError('할 일은 1~50개를 선택해 주세요.');
      const clean = tasks.map((t) => ({ title: t?.title, dueDate: t?.dueDate || null }));
      const payload = JSON.stringify([jobId, clean]);
      return pageTransaction(db, () => {
        const prior = db
          .prepare('SELECT * FROM ai_task_adoptions WHERE request_id=?')
          .get(requestId);
        if (prior) {
          if (prior.payload !== payload)
            throw new AiConflictError('같은 요청으로 다른 할 일을 등록할 수 없어요.');
          return {
            items: JSON.parse(prior.task_ids).map((id) => owner().getTask(id)),
            replayed: true,
          };
        }
        const items = clean.map((t) => owner().createTask({ ...t, requestId: randomUUID() }));
        db.prepare('INSERT INTO ai_task_adoptions VALUES(?,?,?,?)').run(
          requestId,
          jobId,
          payload,
          JSON.stringify(items.map((t) => t.id)),
        );
        return { items, replayed: false };
      });
    },
  };
}

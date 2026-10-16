import { AI_OUTPUT_LIMIT, AiExecutionError } from './contracts.mjs';
import { createHiveRunner } from './hive.mjs';
import { createDevinRunner } from './devin.mjs';

export function createAiRunner(env = process.env) {
  if (env.AI_RUNNER_KIND === 'hive') return createHiveRunner(env);
  if (env.AI_RUNNER_KIND === 'devin') return createDevinRunner(env);
  if (env.AI_RUNNER_KIND && env.AI_RUNNER_KIND !== 'http') return { enabled: false, info: null };
  return createHttpRunner(env);
}

// A trusted gateway translates this small contract into the selected provider/agent.
// No shell commands, provider credentials, or filesystem paths come from captures.
export function createHttpRunner(env = process.env) {
  let endpoint;
  try {
    const url = new URL(env.AI_RUNNER_URL || '');
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    )
      throw new Error();
    endpoint = url.href;
  } catch {
    return { enabled: false, info: null };
  }
  const info = {
    label: (env.AI_RUNNER_LABEL || '연결된 API').slice(0, 80),
    mode: env.AI_RUNNER_MODE === 'test' ? 'test' : 'live',
  };
  return {
    enabled: true,
    info,
    async run({ job, materials }, signal) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            'Content-Type': 'application/json',
            ...(env.AI_RUNNER_TOKEN ? { Authorization: `Bearer ${env.AI_RUNNER_TOKEN}` } : {}),
          },
          body: JSON.stringify({
            schemaVersion: 1,
            jobId: job.id,
            kind: job.request.kind,
            prompt: job.request.prompt,
            input: job.request.input,
            materials,
            policy: {
              tools: false,
              maxOutputTokens: 4096,
              treatMaterialsAsData: true,
              output: 'markdown-sources-usage',
            },
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new AiExecutionError('runner_failed');
        }
        if (
          !/^application\/json\b/i.test(response.headers.get('content-type') || '') ||
          Number(response.headers.get('content-length')) > AI_OUTPUT_LIMIT
        ) {
          await response.body?.cancel();
          throw new AiExecutionError('invalid_result');
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > AI_OUTPUT_LIMIT) {
            await response.body.cancel().catch(() => {});
            throw new AiExecutionError('invalid_result');
          }
          chunks.push(chunk);
        }
        try {
          return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new AiExecutionError('invalid_result');
        }
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        throw error instanceof AiExecutionError ? error : new AiExecutionError('runner_failed');
      }
    },
  };
}

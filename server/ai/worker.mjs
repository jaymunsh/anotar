import { AiExecutionError, validateAiResult } from './contracts.mjs';
import { collectResearch } from './research.mjs';
import { collectKeywordResearch } from './discovery.mjs';

export function createAiWorker({ store, runner, notifier, collect = collectResearch, timeoutMs = 120_000 }) {
  let started = false,
    stopped = false,
    pumping = null,
    controller = null;
  function notify(event, job, code) {
    try { Promise.resolve(notifier?.notify(event, job, code)).catch(() => {}); } catch {}
  }
  async function execute(job) {
    let activeRunner = runner;
    controller = new AbortController();
    const signal = controller.signal;
    let abortListener;
    const aborted = new Promise((_, reject) => {
      abortListener = () => reject(signal.reason);
      signal.addEventListener('abort', abortListener, { once: true });
    });
    const timer = setTimeout(() => controller?.abort(new AiExecutionError('timeout')), timeoutMs);
    try {
      notify('started', job);
      activeRunner = runner.forJob?.(job) ?? runner;
      const run = async () => {
        if (!activeRunner.enabled) throw new AiExecutionError('runner_unavailable');
        if (!job.request.input.content.trim() && !job.request.input.url)
          throw new AiExecutionError('unsupported_input');
        let materials = [],
          research;
        if (job.request.kind === 'research') {
          if (job.request.input.url) materials = [await collect(job.request.input.url, signal)];
          else {
            if (typeof activeRunner.discover !== 'function')
              throw new AiExecutionError('research_search_unavailable');
            const candidates = await activeRunner.discover({ job }, signal);
            const collected = await collectKeywordResearch(candidates, signal, collect);
            materials = collected.materials;
            research = {
              mode: 'keyword',
              candidateCount: collected.candidateCount,
              collectedCount: materials.length,
            };
          }
        }
        signal.throwIfAborted();
        const output = await activeRunner.run(
          { job, materials, ...(research ? { research } : {}) },
          signal,
        );
        signal.throwIfAborted();
        if (
          research &&
          research.candidateCount > materials.length &&
          typeof output?.markdown === 'string'
        ) {
          output.markdown = `> 수집 안내: 검색 후보 ${research.candidateCount}개 중 본문을 확인한 ${materials.length}개 출처만 사용했어요.\n\n${output.markdown}`;
        }
        return validateAiResult(output, { materials, kind: job.request.kind });
      };
      const result = await Promise.race([run(), aborted]);
      store.completeAiJob(job.id, job.runToken, result);
    } catch (error) {
      // Native execution must release its process capacity before terminal state/next claim.
      if (signal.aborted) await activeRunner.drain?.(signal);
      const code = error?.code || 'runner_failed';
      if (store.failAiJob(job.id, job.runToken, code)) notify('failed', job, code);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abortListener);
      controller = null;
    }
  }
  function wake() {
    if (!started || stopped || pumping) return;
    pumping = new Promise((resolve) => setImmediate(resolve))
      .then(async () => {
        while (!stopped) {
          const job = store.claimAiJob(runner.metadataFor || runner.info);
          if (!job) break;
          await execute(job);
        }
      })
      .finally(() => {
        pumping = null;
      });
  }
  return {
    start() {
      if (started || stopped) return;
      store.interruptAiJobs();
      started = true;
      wake();
    },
    wake,
    async stop() {
      if (stopped) return pumping;
      stopped = true;
      controller?.abort(new AiExecutionError('interrupted'));
      await pumping;
    },
  };
}

import { AiExecutionError } from './contracts.mjs';
import { cleanResearchUrl, normalizeResearchCandidates } from './discovery.mjs';

function parseJson(stdout) {
  let output = stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
  if (output.startsWith('Welcome to Devin CLI!'))
    output = output.slice('Welcome to Devin CLI!'.length).trim();
  output = output.replace(/^```(?:json)?\s*|\s*```$/g, '');
  return JSON.parse(output);
}
export function parseDevinOutput(stdout) {
  const parsed = parseJson(stdout);
  if (!parsed || typeof parsed.markdown !== 'string' || !parsed.markdown.trim())
    throw new Error('invalid_result');
  return parsed;
}

export function parseDevinSearch(stdout, transcript) {
  try {
    if (!Array.isArray(transcript?.steps) || transcript.steps.length > 20) throw new Error();
    const calls = transcript.steps.flatMap((step) => step.tool_calls || []);
    const call = calls[0];
    if (
      calls.length !== 1 ||
      call?.function_name !== 'web_search' ||
      typeof call.tool_call_id !== 'string' ||
      !call.tool_call_id ||
      typeof call.arguments?.query !== 'string' ||
      !call.arguments.query.trim() ||
      call.arguments.query.length > 240 ||
      !Number.isInteger(call.arguments.num_results) ||
      call.arguments.num_results < 1 ||
      call.arguments.num_results > 5
    )
      throw new Error();
    const observed = new Set();
    let linkedObservation = false;
    for (const step of transcript.steps) {
      for (const result of step.observation?.results || []) {
        if (result.source_call_id !== call.tool_call_id || typeof result.content !== 'string')
          continue;
        linkedObservation = true;
        for (const match of result.content.matchAll(/^URL:\s*(https?:\/\/\S+)\s*$/gm)) {
          try {
            observed.add(cleanResearchUrl(match[1]));
          } catch {
            /* Ignore malformed search rows. */
          }
        }
      }
    }
    if (!linkedObservation) throw new Error();
    const candidates = normalizeResearchCandidates(parseJson(stdout)?.sources);
    if (candidates.some((item) => !observed.has(item.url))) throw new Error();
    if (!candidates.length) throw new AiExecutionError('research_no_sources');
    return candidates;
  } catch (error) {
    if (error instanceof AiExecutionError) throw error;
    throw new AiExecutionError('invalid_result');
  }
}

import { AiExecutionError, AI_OUTPUT_LIMIT } from './contracts.mjs';
import { normalizeResearchCandidates } from './discovery.mjs';

// OpenCode 1.18.34's pinned Exa websearch output uses Title/URL result headers.
// Model-generated text is deliberately ignored: only completed tool observations
// supply candidates, and collectKeywordResearch still verifies public bodies.
export function parseOpenCodeSearch(output) {
  if (Buffer.byteLength(output) > AI_OUTPUT_LIMIT) throw new AiExecutionError('invalid_result');
  let observation,
    finished = false,
    toolSteps = 0;
  try {
    for (const line of output.split(/\r?\n/).filter((s) => s.trim())) {
      const event = JSON.parse(line);
      if (finished || event.type === 'error') throw Error();
      if (event.type === 'tool_use') {
        const part = event.part,
          state = part?.state,
          input = state?.input;
        if (
          observation !== undefined ||
          part?.tool !== 'websearch' ||
          typeof part.callID !== 'string' ||
          !part.callID ||
          state?.status !== 'completed' ||
          typeof state.output !== 'string' ||
          state.metadata?.provider !== 'exa' ||
          state.metadata?.truncated === true ||
          typeof input?.query !== 'string' ||
          !input.query.trim() ||
          input.query.length > 240 ||
          !Number.isInteger(input.numResults) ||
          input.numResults < 1 ||
          input.numResults > 5 ||
          input.type !== 'fast' ||
          !Number.isInteger(input.contextMaxCharacters) ||
          input.contextMaxCharacters < 1 ||
          input.contextMaxCharacters > 10000
        )
          throw Error();
        observation = state.output;
      }
      if (event.type === 'step_finish') {
        if (event.part?.reason === 'tool-calls' && observation !== undefined && toolSteps === 0)
          toolSteps++;
        else if (event.part?.reason === 'stop' && toolSteps === 1) finished = true;
        else throw Error();
      }
    }
    if (!finished || observation === undefined) throw Error();
    const sources = [];
    for (const match of observation.matchAll(
      /^Title:\s*([^\r\n]*)\r?\nURL:\s*(https?:\/\/\S+)\s*$/gm,
    )) {
      sources.push({ title: match[1].trim().slice(0, 200), url: match[2] });
      if (sources.length === 5) break;
    }
    return normalizeResearchCandidates(sources);
  } catch {
    throw new AiExecutionError('invalid_result');
  }
}

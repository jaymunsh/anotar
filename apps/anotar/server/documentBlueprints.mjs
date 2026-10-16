import { documentBlueprints, legacyDocumentBlueprints, buildDocumentBlueprint } from '../shared/documentBlueprints.ts';

// Register only in the private server. Reads never persist a document.
export function handleDocumentBlueprintRoute(request, response, url) {
  const match = url.pathname.match(/^\/api\/document-blueprints(?:\/([^/]+))?$/);
  if (!match) return false;
  const send = (status, payload) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(status === 405 ? { Allow: 'GET' } : {}),
    });
    response.end(JSON.stringify(payload));
  };
  if (request.method !== 'GET') {
    send(405, { error: '문서 템플릿은 조회만 할 수 있어요.' });
    return true;
  }
  if (!match[1]) {
    send(200, { items: documentBlueprints });
    return true;
  }
  const blueprint = [...documentBlueprints, ...legacyDocumentBlueprints].find((item) => item.id === match[1]);
  if (!blueprint) {
    send(404, { error: '문서 템플릿을 찾을 수 없어요.' });
    return true;
  }
  try {
    const inputs = {};
    for (const name of ['title', 'startDate', 'days']) {
      if (url.searchParams.has(name))
        inputs[name] =
          name === 'days' ? Number(url.searchParams.get(name)) : url.searchParams.get(name);
    }
    send(200, { item: blueprint, payload: buildDocumentBlueprint(blueprint.id, inputs) });
  } catch (error) {
    send(400, { error: error.message });
  }
  return true;
}

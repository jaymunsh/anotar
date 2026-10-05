function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const limit = 4096;
  if (Number(req.headers['content-length']) > limit)
    throw Object.assign(new Error('백업 설정 요청이 너무 큽니다.'), { status: 400 });
  const raw = await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        if (!tooLarge)
          reject(Object.assign(new Error('백업 설정 요청이 너무 큽니다.'), { status: 400 }));
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
    req.on('aborted', () =>
      reject(Object.assign(new Error('백업 설정 요청이 중단되었습니다.'), { status: 400 })),
    );
  });
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('백업 설정 JSON을 확인해 주세요.'), { status: 400 });
  }
}

export async function handleBackupRoute(req, res, url, manager) {
  if (!['/api/backups', '/api/backups/run'].includes(url.pathname)) return false;
  try {
    if (url.pathname === '/api/backups' && req.method === 'GET')
      send(res, 200, await manager.status());
    else if (url.pathname === '/api/backups' && req.method === 'PUT')
      send(res, 200, await manager.configure(await readJson(req)));
    else if (url.pathname === '/api/backups/run' && req.method === 'POST')
      send(res, 202, await manager.runNow());
    else
      send(
        res,
        405,
        { error: '지원하지 않는 백업 요청입니다.' },
        { Allow: url.pathname.endsWith('/run') ? 'POST' : 'GET, PUT' },
      );
  } catch (error) {
    send(res, [400, 409].includes(error.status) ? error.status : 500, {
      error:
        error instanceof Error
          ? error.message
          : '백업 상태를 확인하지 못했습니다. 다시 시도해 주세요.',
    });
  }
  return true;
}

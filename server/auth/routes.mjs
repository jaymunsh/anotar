import { createAuthenticator, authError } from './service.mjs';
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw authError(415, 'json_required', 'JSON 요청이 필요해요.');
  if (Number(req.headers['content-length']) > 4096) {
    req.resume();
    throw authError(413, 'auth_body_limit', '로그인 요청이 너무 커요.');
  }
  req.setTimeout(10000, () => req.destroy());
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw authError(413, 'auth_body_limit', '로그인 요청이 너무 커요.');
    chunks.push(chunk);
  }
  req.setTimeout(0);
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {
    throw authError(400, 'invalid_auth_body', '입력 내용을 확인해 주세요.');
  }
}
function readCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key in cookies) return {};
    cookies[key] = value.join('=');
  }
  return cookies;
}
export function createAuthHttp({ store, env = process.env, clock = Date.now }) {
  const host = env.HOST || '127.0.0.1',
    local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const mode = env.AUTH_MODE || (env.NODE_ENV === 'production' || !local ? 'required' : 'disabled');
  if (!['required', 'disabled'].includes(mode))
    throw Error('AUTH_MODE must be required or disabled');
  const secure = env.AUTH_COOKIE_SECURE !== 'false';
  if (!secure && (!local || env.NODE_ENV === 'production'))
    throw Error('Insecure auth cookies are only supported on local development');
  let auth;
  if (mode === 'required' && /^[a-f0-9]{64}$/i.test(env.AUTH_SECRET_KEY ?? ''))
    auth = createAuthenticator({ store, key: env.AUTH_SECRET_KEY, clock, secure });
  const prefix = secure ? '__Host-' : '';
  const names = { session: prefix + 'leneu_session', device: prefix + 'leneu_device' };
  function cookie(name, value, expires) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${Math.max(0, Math.floor((expires - clock()) / 1000))}`;
  }
  const clears = () => [cookie(names.session, '', 0), cookie(names.device, '', 0)];
  function issue(res, result, clearTrust = false) {
    const cookies = [cookie(names.session, result.sessionToken, result.sessionExpires)];
    if (result.deviceToken)
      cookies.push(cookie(names.device, result.deviceToken, result.deviceExpires));
    else if (clearTrust) cookies.push(cookie(names.device, '', 0));
    res.setHeader('Set-Cookie', cookies);
  }
  return {
    enabled: mode === 'required',
    async handle(req, res, url) {
      if (mode === 'disabled') {
        if (url.pathname === '/api/auth/status') {
          send(res, 200, { enabled: false, configured: false, authenticated: false });
          return true;
        }
        if (url.pathname.startsWith('/api/auth/')) {
          req.resume();
          send(res, 404, { error: '로컬 개발에서는 인증을 사용하지 않아요.' });
          return true;
        }
        return false;
      }
      if (!url.pathname.startsWith('/api/') || url.pathname === '/api/health') return false;
      // Cookies never authorize writes without a browser Origin. Headerless CLI needs an explicit Origin too.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers.origin) {
        req.resume();
        send(res, 403, { code: 'origin_required', error: '개인 앱에서 다시 요청해 주세요.' });
        return true;
      }
      const configured = Boolean(auth?.configured()),
        cookies = readCookies(req.headers.cookie);
      const access = configured
        ? auth.authenticate({
            sessionToken: cookies[names.session],
            deviceToken: cookies[names.device],
          })
        : null;
      if (access?.sessionToken) issue(res, access);
      if (url.pathname === '/api/auth/status' && req.method === 'GET') {
        send(res, 200, { enabled: true, configured, authenticated: Boolean(access) });
        return true;
      }
      try {
        if (!configured) throw authError(503, 'auth_unconfigured', '개인 계정 설정이 필요해요.');
        if (url.pathname === '/api/auth/login' && req.method === 'POST') {
          const result = await auth.login(
            await readBody(req),
            req.socket.remoteAddress ?? 'unknown',
          );
          if (access) auth.logout(access.session);
          issue(res, result, true);
          send(res, 200, { authenticated: true });
          return true;
        }
        if (!access)
          throw authError(
            401,
            'authentication_required',
            '다시 로그인해 주세요. 기기에 저장한 글은 유지돼요.',
          );
        if (url.pathname === '/api/auth/devices' && req.method === 'GET') {
          send(res, 200, {
            items: auth.devices(access.session),
            recoveryCodesRemaining: auth.recoveryCount(),
          });
          return true;
        }
        if (url.pathname === '/api/auth/reauth' && req.method === 'POST') {
          const body = await readBody(req),
            result = auth.reauthenticate(access.session, body.code);
          issue(res, result);
          send(res, 200, { authenticated: true });
          return true;
        }
        if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
          await readBody(req);
          auth.logout(access.session);
          res.setHeader('Set-Cookie', clears());
          send(res, 200, { authenticated: false });
          return true;
        }
        if (url.pathname === '/api/auth/revoke' && req.method === 'POST') {
          const body = await readBody(req);
          if (
            body.id !== 'all' &&
            (typeof body.id !== 'string' || !/^[-a-f0-9]{36}$/.test(body.id))
          )
            throw authError(400, 'invalid_device', '기기를 다시 선택해 주세요.');
          auth.revoke(access.session, body.id);
          const loggedOut = body.id === 'all' || body.id === access.session.device_id;
          if (loggedOut) res.setHeader('Set-Cookie', clears());
          send(res, 200, { authenticated: !loggedOut });
          return true;
        }
        if (url.pathname.startsWith('/api/auth/')) {
          send(res, 404, { error: '인증 경로를 찾을 수 없어요.' });
          return true;
        }
        return false;
      } catch (error) {
        req.resume();
        send(
          res,
          [400, 401, 403, 409, 413, 415, 429, 503].includes(error.status) ? error.status : 503,
          {
            code: error.code ?? 'auth_unavailable',
            error: error.status
              ? error.message
              : '인증을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
          },
          error.status === 429 ? { 'Retry-After': '900' } : {},
        );
        return true;
      }
    },
  };
}

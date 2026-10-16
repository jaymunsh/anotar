import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { matchTotp } from './crypto.mjs';
import { createAuthenticator } from './service.mjs';
// Only the interactive local CLI calls this; it has no HTTP route.
export async function prepareAuthEnvironment({ path, env, ownerExists = false }) {
  let content = '';
  try {
    content = await readFile(path, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  // The Node --env-file loader supplies existing values. Do not regenerate a missing key for an existing owner.
  let key = env.AUTH_SECRET_KEY || undefined;
  if (!key && ownerExists)
    throw Error('기존 계정의 AUTH_SECRET_KEY가 필요해요. 별도 보관한 키를 복원해 주세요.');
  if (key && !/^[a-f0-9]{64}$/i.test(key))
    throw Error('AUTH_SECRET_KEY는 32바이트 hex 값이어야 해요.');
  const storedKey = parseEnv(content).AUTH_SECRET_KEY;
  if (storedKey && key !== storedKey)
    throw Error('먼저 .env를 읽어 기존 AUTH_SECRET_KEY를 적용해 주세요.');
  key ??= randomBytes(32).toString('hex');
  const local =
    ['127.0.0.1', 'localhost', '::1'].includes(env.HOST || '127.0.0.1') &&
    env.NODE_ENV !== 'production';
  for (const [name, value] of Object.entries({
    AUTH_SECRET_KEY: key,
    AUTH_MODE: 'required',
    AUTH_COOKIE_SECURE: local ? 'false' : 'true',
  })) {
    const pattern = new RegExp(String.raw`^(?:export[ \t]+)?${name}[ \t]*=.*$`, 'gm');
    content = pattern.test(content)
      ? content.replace(pattern, `${name}=${value}`)
      : content.replace(/\n?$/, `\n${name}=${value}\n`);
  }
  const temp = path + '.auth-' + randomBytes(8).toString('hex');
  try {
    await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  return key;
}
export async function provisionConfirmedOwner({
  store,
  key,
  password,
  secret,
  code,
  clock = Date.now,
}) {
  if (store.auth.owner())
    throw Error('이미 개인 계정이 설정되어 있어요. 기존 계정은 덮어쓰지 않아요.');
  if (matchTotp(secret, code, clock(), -1) === null)
    throw Error('Authenticator 코드를 확인해 주세요. 계정은 아직 저장하지 않았어요.');
  const auth = createAuthenticator({ store, key, clock });
  const result = await auth.provision({ password, secret });
  // The setup code is consumed too: the same code cannot immediately log in.
  store.auth.consumeStep(matchTotp(secret, code, clock(), -1));
  return result;
}

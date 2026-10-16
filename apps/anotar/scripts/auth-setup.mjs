import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { openStore } from '../server/store.mjs';
import { newSecret } from '../server/auth/crypto.mjs';
import { prepareAuthEnvironment, provisionConfirmedOwner } from '../server/auth/setup.mjs';
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    '계정 설정은 로컬 대화형 터미널에서 실행해 주세요. 비밀번호를 인수나 환경변수로 전달하지 않아요.',
  );
  process.exit(1);
}
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
output.isTTY = true;
output.columns = process.stdout.columns;
const rl = createInterface({ input: process.stdin, output, terminal: true });
async function ask(prompt, secret = false) {
  return await new Promise((resolveAnswer, reject) => {
    const abort = () => {
      muted = false;
      reject(Error('설정을 취소했어요.'));
    };
    rl.once('SIGINT', abort);
    rl.once('close', abort);
    rl.question(prompt, (answer) => {
      muted = false;
      rl.off('SIGINT', abort);
      rl.off('close', abort);
      if (secret) process.stdout.write('\n');
      resolveAnswer(answer);
    });
    muted = secret;
  });
}
const store = openStore(resolve(process.env.DATA_DIR || 'data'));
try {
  if (store.auth.owner())
    throw Error('이미 개인 계정이 설정되어 있어요. 기존 계정을 덮어쓰지 않아요.');
  console.log(
    'anotar 개인 계정 설정\n비밀번호 + Google Authenticator. 기존 글과 첨부는 유지돼요.\n',
  );
  const password = await ask('비밀번호 (8자 이상): ', true),
    confirmation = await ask('비밀번호 다시 입력: ', true);
  if (password !== confirmation)
    throw Error('비밀번호가 일치하지 않아요. 계정은 저장하지 않았어요.');
  if (password.length < 8 || Buffer.byteLength(password) > 1024)
    throw Error('비밀번호는 8자 이상, 1024바이트 이하여야 해요.');
  const secret = newSecret();
  console.log(
    '\nGoogle Authenticator → + → 설정 키 입력\n계정 이름: anotar\n키 유형: 시간 기반\n설정 키: ' +
      secret +
      '\n(이 키는 공유하거나 로그에 보관하지 마세요.)\n',
  );
  const code = (await ask('앱의 6자리 인증 코드: ', true)).trim();
  // Verify before writing the environment or any owner credentials.
  const { matchTotp } = await import('../server/auth/crypto.mjs');
  if (matchTotp(secret, code, Date.now(), -1) === null)
    throw Error('인증 코드가 맞지 않아요. 계정은 저장하지 않았어요.');
  const key = await prepareAuthEnvironment({
    path: resolve('.env'),
    env: process.env,
    ownerExists: false,
  });
  const result = await provisionConfirmedOwner({ store, key, password, secret, code });
  console.log('\n계정을 설정했어요. 아래 일회용 복구 코드 10개를 안전한 곳에 따로 보관하세요.');
  for (const value of result.recoveryCodes) console.log(value);
  console.log(
    '\n.env의 AUTH_SECRET_KEY도 DB 백업과 별도로 안전하게 보관하세요.\n서버를 재시작한 뒤 다음 인증 코드로 로그인하세요.',
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  muted = false;
  rl.close();
  store.close();
}

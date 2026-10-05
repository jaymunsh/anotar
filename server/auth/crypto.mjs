import {
  createHmac,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() {
  const bytes = randomBytes(20);
  let bits = 0,
    value = 0,
    out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  return out;
}
function decode(secret) {
  if (typeof secret !== 'string' || !/^[A-Z2-7]{32}$/.test(secret))
    throw Error('Invalid TOTP secret');
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
export function totp(secret, now = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const hmac = createHmac('sha1', decode(secret)).update(counter).digest();
  const offset = hmac.at(-1) & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
export function equal(a, b) {
  const left = Buffer.from(String(a)),
    right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
export function matchTotp(secret, code, now, lastStep = -1) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1])
    if (candidate > lastStep && candidate >= 0 && equal(totp(secret, candidate * 30000), code))
      return candidate;
  return null;
}
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 1024)
    throw Object.assign(Error('비밀번호는 8자 이상, 1KB 이하로 입력해 주세요.'), { status: 400 });
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$131072$8$1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 1024) return false;
  const fields = String(stored).split('$');
  if (
    fields.length !== 6 ||
    fields.slice(0, 4).join('$') !== 'scrypt$131072$8$1' ||
    !/^[a-f0-9]{32}$/.test(fields[4]) ||
    !/^[a-f0-9]{64}$/.test(fields[5])
  )
    return false;
  const hash = await derive(password, fields[4], 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  return equal(hash.toString('hex'), fields[5]);
}
function keyBytes(key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/i.test(key))
    throw Error('AUTH_SECRET_KEY must contain 32 random bytes as hex');
  return Buffer.from(key, 'hex');
}
export function encryptSecret(secret, key) {
  decode(secret);
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from('leneu:totp:v1'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64')).join('.');
}
export function decryptSecret(stored, key) {
  const [iv, tag, value] = String(stored)
    .split('.')
    .map((b) => Buffer.from(b, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from('leneu:totp:v1'));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(value), cipher.final()]).toString('utf8');
}
export const token = () => randomBytes(32).toString('hex');
export const digest = (value) => createHash('sha256').update(String(value)).digest('hex');

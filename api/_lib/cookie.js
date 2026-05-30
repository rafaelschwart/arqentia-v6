// api/_lib/cookie.js
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = () => {
  const s = process.env.ARQ_COOKIE_SECRET;
  if (!s) throw new Error('Missing ARQ_COOKIE_SECRET');
  return s;
};

const MAX_AGE_SEC = 60 * 60 * 24 * 90; // 90 days

export function signCookie(value) {
  const mac = createHmac('sha256', SECRET()).update(value).digest('hex');
  return `${value}.${mac}`;
}

export function verifyCookie(signed) {
  if (!signed || typeof signed !== 'string') return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const mac   = signed.slice(idx + 1);
  const expected = createHmac('sha256', SECRET()).update(value).digest('hex');
  if (mac.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  return value;
}

export function serializeCookie(name, value, opts = {}) {
  const parts = [
    `${name}=${value}`,
    `Path=/`,
    `Max-Age=${opts.maxAge ?? MAX_AGE_SEC}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ];
  return parts.join('; ');
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

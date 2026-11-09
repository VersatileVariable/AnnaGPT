import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const COOKIE = 'annagpt_admin';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const sessions = new Map(); // token -> expiry
const attempts = new Map(); // ip -> timestamps

const digest = (s) => createHash('sha256').update(s).digest();

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAdminRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const expiry = token && sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function login(ip, password, adminPassword) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) return { error: 'rate_limited' };
  recent.push(now);
  attempts.set(ip, recent);

  if (typeof password !== 'string' || !timingSafeEqual(digest(password), digest(adminPassword))) {
    return { error: 'invalid' };
  }
  const token = randomBytes(32).toString('hex');
  sessions.set(token, now + SESSION_MS);
  return { token };
}

export function logout(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) sessions.delete(token);
}

export function sessionCookie(token, secure) {
  const maxAge = token ? SESSION_MS / 1000 : 0;
  return `${COOKIE}=${token ?? ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

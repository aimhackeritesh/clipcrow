// Password gate for a Clipcrow that is reachable from somewhere other than this computer.
// It protects a connected YouTube account as much as the footage: whoever reaches the desk can
// spend the upload quota and publish to the channel.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DAY = 86400000;
export const COOKIE = 'clipcrow_session';

/** A per-install signing secret, kept beside the captures rather than in the image. */
export async function sessionSecret(dir) {
 const file = path.join(dir, 'session-secret');
 try { const existing = await fs.readFile(file, 'utf8'); if (existing.trim().length >= 32) return existing.trim(); } catch {}
 const secret = crypto.randomBytes(32).toString('hex');
 await fs.mkdir(dir, {recursive: true});
 await fs.writeFile(file, secret, {mode: 0o600});
 return secret;
}

export const signToken = (secret, expires) => `${expires}.${crypto.createHmac('sha256', secret).update(String(expires)).digest('hex')}`;

/** True only for a token this install signed that has not expired. */
export function verifyToken(secret, token, now = Date.now()) {
 const [expires, signature] = String(token || '').split('.');
 if (!/^\d{1,15}$/.test(expires || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
 const expected = crypto.createHmac('sha256', secret).update(expires).digest('hex');
 if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return false;
 return Number(expires) > now;
}

export const issue = (secret, days = 30) => signToken(secret, Date.now() + days * DAY);

export function readCookie(header, name) {
 for (const part of String(header || '').split(';')) {
  const at = part.indexOf('=');
  if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
 }
 return '';
}

export const cookieHeader = (token, secure, days = 30) =>
 `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(days * DAY / 1000)}${secure ? '; Secure' : ''}`;

/** Constant-time password check, so a wrong guess tells an attacker nothing about length. */
export function passwordMatches(expected, given) {
 const a = crypto.createHash('sha256').update(String(expected ?? '')).digest();
 const b = crypto.createHash('sha256').update(String(given ?? '')).digest();
 return crypto.timingSafeEqual(a, b);
}

/**
 * Whether a request may be served without signing in.
 * Everything else, the captures and the OAuth hand-off included, needs a session.
 */
export const isOpenPath = pathname => pathname === '/login' || pathname === '/api/login';

// A deliberately coarse brake on guessing. One process, one desk: a counter is enough.
const attempts = new Map();
export function tooManyAttempts(key, now = Date.now(), limit = 10, window = 10 * 60000) {
 const recent = (attempts.get(key) || []).filter(at => now - at < window);
 attempts.set(key, recent);
 return recent.length >= limit;
}
export function recordAttempt(key, now = Date.now()) {
 attempts.set(key, [...(attempts.get(key) || []), now]);
}
export const clearAttempts = key => attempts.delete(key);

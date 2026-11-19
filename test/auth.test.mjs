import test from 'node:test';
import assert from 'node:assert/strict';
import {signToken, verifyToken, issue, readCookie, cookieHeader, passwordMatches, isOpenPath, tooManyAttempts, recordAttempt, clearAttempts, COOKIE} from '../auth.mjs';

const secret = 'a'.repeat(64);

test('a token signed here verifies here, and nowhere else', () => {
 const token = issue(secret, 1);
 assert.equal(verifyToken(secret, token), true);
 assert.equal(verifyToken('b'.repeat(64), token), false, 'another install cannot mint sessions for this one');
});

test('expired and tampered tokens are refused', () => {
 const past = signToken(secret, Date.now() - 1000);
 assert.equal(verifyToken(secret, past), false);
 const token = issue(secret, 1), [expires, signature] = token.split('.');
 assert.equal(verifyToken(secret, `${Number(expires) + 10 * 86400000}.${signature}`), false, 'the expiry is signed, not just carried');
 assert.equal(verifyToken(secret, `${expires}.${'0'.repeat(64)}`), false);
});

test('malformed tokens are refused without throwing', () => {
 for (const bad of ['', null, undefined, 'x', 'abc.def', '12.', '.abc', '1e9.' + '0'.repeat(64), '12.' + 'z'.repeat(64), 'a'.repeat(400)])
  assert.equal(verifyToken(secret, bad), false, String(bad));
});

test('the session cookie is read out of a crowded header', () => {
 assert.equal(readCookie(`other=1; ${COOKIE}=abc.def; third=2`, COOKIE), 'abc.def');
 assert.equal(readCookie('', COOKIE), '');
 assert.equal(readCookie('clipcrow_session_other=no', COOKIE), '', 'a lookalike name does not match');
});

test('the cookie is locked down, and only marked Secure over https', () => {
 const header = cookieHeader('t', true);
 for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/']) assert.ok(header.includes(flag), flag);
 assert.ok(!cookieHeader('t', false).includes('Secure'), 'a plain-http desk still works locally');
});

test('passwords compare without throwing on odd input', () => {
 assert.equal(passwordMatches('hunter2', 'hunter2'), true);
 assert.equal(passwordMatches('hunter2', 'hunter3'), false);
 assert.equal(passwordMatches('hunter2', 'a much longer wrong guess'), false, 'unequal lengths must not throw');
 assert.equal(passwordMatches('', undefined), true, 'only reachable when no password is set, where the gate is off anyway');
});

test('only the sign-in itself is reachable without a session', () => {
 for (const open of ['/login', '/api/login']) assert.equal(isOpenPath(open), true, open);
 for (const closed of ['/', '/api/state', '/api/clip', '/oauth/callback', '/data/x/clip.mp4', '/app.js'])
  assert.equal(isOpenPath(closed), false, closed);
});

test('guessing is throttled per client and cleared on success', () => {
 const who = 'test-client', now = Date.now();
 clearAttempts(who);
 for (let i = 0; i < 9; i++) recordAttempt(who, now);
 assert.equal(tooManyAttempts(who, now), false);
 recordAttempt(who, now);
 assert.equal(tooManyAttempts(who, now), true);
 assert.equal(tooManyAttempts(who, now + 11 * 60000), false, 'the window rolls forward');
 clearAttempts(who);
 assert.equal(tooManyAttempts(who, now), false);
});

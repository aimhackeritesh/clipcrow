// YouTube Studio connection and clip upload.
// Credentials stay on this computer: the refresh token lives in data/, never in the page.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const data = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const store = path.join(data, 'youtube-auth.json');
const config = path.join(data, 'publish.json');
export const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
// Gaming and Entertainment cover almost every clip; anything unmapped lands in Entertainment.
const CATEGORIES = {'Gaming': '20', 'Music': '10', 'Sports': '17', 'News & Politics': '25', 'Comedy': '23', 'Entertainment': '24', 'People & Blogs': '22'};

const readJSON = async file => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } };
const writeJSON = async (file, value) => { await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, JSON.stringify(value, null, 2)); };

/** OAuth client details, from the environment or a credentials file you downloaded from Google. */
export async function credentials() {
 if (process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET) return {id: process.env.YT_CLIENT_ID, secret: process.env.YT_CLIENT_SECRET};
 const file = await readJSON(path.join(root, 'youtube-credentials.json'));
 const block = file && (file.installed || file.web || file);
 if (block && block.client_id && block.client_secret) return {id: block.client_id, secret: block.client_secret};
 return null;
}

export const publishConfig = async () => (await readJSON(config)) || {auto: false, privacy: 'private'};
export async function setPublishConfig(body = {}) {
 const current = await publishConfig();
 const privacy = ['private', 'unlisted', 'public'].includes(body.privacy) ? body.privacy : current.privacy;
 const next = {auto: body.auto === undefined ? current.auto : body.auto === true, privacy};
 await writeJSON(config, next);
 return next;
}

let pending = null;
export async function authUrl(redirect) {
 const client = await credentials();
 if (!client) throw new Error('No OAuth client yet. Add youtube-credentials.json, or set YT_CLIENT_ID and YT_CLIENT_SECRET. See README.md.');
 pending = randomUUID();
 const query = new URLSearchParams({client_id: client.id, redirect_uri: redirect, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: pending});
 return 'https://accounts.google.com/o/oauth2/v2/auth?' + query;
}

async function token(form) {
 const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(form)});
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error('Google rejected the sign-in: ' + (data.error_description || data.error || response.status));
 return data;
}

/** Finish the browser hand-off. The state check keeps another page on this machine from completing it. */
export async function completeAuth(code, state, redirect) {
 if (!pending || state !== pending) throw new Error('This sign-in did not start here. Press Connect YouTube Studio again.');
 pending = null;
 const client = await credentials();
 const granted = await token({code, client_id: client.id, client_secret: client.secret, redirect_uri: redirect, grant_type: 'authorization_code'});
 if (!granted.refresh_token) throw new Error('Google did not return a refresh token. Remove Clipcrow at myaccount.google.com/permissions and connect again.');
 const saved = {refresh_token: granted.refresh_token, access_token: granted.access_token, expires: Date.now() + (granted.expires_in || 3600) * 1000, scope: granted.scope || SCOPES};
 saved.channel = await channelName(granted.access_token).catch(() => '');
 await writeJSON(store, saved);
 return saved;
}

async function accessToken() {
 const saved = await readJSON(store);
 if (!saved?.refresh_token) throw new Error('Connect YouTube Studio first');
 if (saved.access_token && saved.expires > Date.now() + 60000) return saved.access_token;
 const client = await credentials();
 if (!client) throw new Error('The OAuth client is missing. Restore youtube-credentials.json.');
 const refreshed = await token({refresh_token: saved.refresh_token, client_id: client.id, client_secret: client.secret, grant_type: 'refresh_token'});
 saved.access_token = refreshed.access_token;
 saved.expires = Date.now() + (refreshed.expires_in || 3600) * 1000;
 await writeJSON(store, saved);
 return saved.access_token;
}

async function channelName(access) {
 const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {headers: {Authorization: 'Bearer ' + access}});
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(data.error?.message || 'Could not read the channel');
 return data.items?.[0]?.snippet?.title || '';
}

export async function status() {
 const saved = await readJSON(store);
 return {configured: !!(await credentials()), connected: !!saved?.refresh_token, channel: saved?.channel || '', ...(await publishConfig())};
}

export async function disconnect() { await fs.rm(store, {force: true}); }

export const categoryId = categories => {
 for (const name of categories || []) if (CATEGORIES[name]) return CATEGORIES[name];
 return '24';
};

/**
 * Upload one finished clip with the resumable endpoint.
 * Clips are short, so the file goes up in a single PUT rather than in chunks.
 */
export async function uploadClip({file, title, description, tags = [], privacy = 'private', categories = []}) {
 const access = await accessToken();
 const bytes = await fs.readFile(file);
 const body = {snippet: {title: String(title || 'Clip').slice(0, 100), description: String(description || '').slice(0, 4900), tags, categoryId: categoryId(categories)}, status: {privacyStatus: privacy, selfDeclaredMadeForKids: false}};
 const begin = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus', {
  method: 'POST',
  headers: {Authorization: 'Bearer ' + access, 'Content-Type': 'application/json', 'X-Upload-Content-Length': String(bytes.length), 'X-Upload-Content-Type': 'video/mp4'},
  body: JSON.stringify(body),
 });
 if (!begin.ok) {
  const failure = await begin.json().catch(() => ({}));
  const message = failure.error?.message || begin.statusText;
  if (begin.status === 403 && /quota/i.test(message)) throw new Error('YouTube upload quota is spent for today. The default API quota allows roughly six uploads per day.');
  throw new Error('YouTube refused the upload: ' + message);
 }
 const location = begin.headers.get('location');
 if (!location) throw new Error('YouTube did not return an upload URL');
 const sent = await fetch(location, {method: 'PUT', headers: {'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length)}, body: bytes});
 const result = await sent.json().catch(() => ({}));
 if (!sent.ok) throw new Error('The upload failed: ' + (result.error?.message || sent.statusText));
 if (!result.id) throw new Error('YouTube accepted the file but returned no video id');
 return {id: result.id, url: 'https://youtu.be/' + result.id, privacy: result.status?.privacyStatus || privacy};
}

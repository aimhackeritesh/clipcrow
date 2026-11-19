// Checks the four separate toolchains Clipcrow needs before you waste a stream finding out one is
// missing. Prints what is wrong and how to fix it; exits non-zero if anything is required and absent.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const venvPython = process.env.PYTHON_PATH || path.join(root, '.venv/bin/python');
const venvYtdlp = process.env.YTDLP_PATH || path.join(root, '.venv/bin/yt-dlp');
const port = Number(process.env.PORT || 4317);

const mac = process.platform === 'darwin';
const brew = command => mac ? `brew install ${command}` : `sudo apt install ${command}`;

/** Run a command and resolve its first line of output, or null if it cannot run at all. */
const ask = (bin, args) => new Promise(resolve => {
 const child = spawn(bin, args);
 let out = '';
 child.stdout.on('data', d => out += d);
 child.stderr.on('data', d => out += d);
 child.on('error', () => resolve(null));
 child.on('close', code => resolve(code === 0 ? out.trim().split('\n')[0] : null));
});

const portFree = () => new Promise(resolve => {
 const probe = net.createServer();
 probe.once('error', () => resolve(false));
 probe.once('listening', () => probe.close(() => resolve(true)));
 probe.listen(port, '127.0.0.1');
});

const checks = [];
const check = (name, ok, detail, fix) => checks.push({name, ok, detail, fix});

// Node
const major = Number(process.versions.node.split('.')[0]);
check('Node.js 22+', major >= 22, process.version,
 'Install Node 22 or newer from nodejs.org, or `nvm install 22`.');

// npm dependencies
let deps = false;
try { await fs.access(path.join(root, 'node_modules/sharp')); deps = true; } catch {}
check('npm dependencies', deps, deps ? 'installed' : 'node_modules is missing or incomplete', 'npm install');

// FFmpeg
const ffmpeg = await ask('ffmpeg', ['-version']);
check('FFmpeg', !!ffmpeg, ffmpeg ? ffmpeg.replace(/ Copyright.*$/, '') : 'not on PATH', brew('ffmpeg'));
const ffprobe = await ask('ffprobe', ['-version']);
check('ffprobe', !!ffprobe, ffprobe ? 'found' : 'not on PATH', brew('ffmpeg'));

// yt-dlp — only needed to open YouTube links
const ytdlp = await ask(venvYtdlp, ['--version']);
check('yt-dlp', !!ytdlp, ytdlp ? `${ytdlp} at ${venvYtdlp}` : `not found at ${venvYtdlp}`,
 './setup.sh, or set YTDLP_PATH to an existing install');

// faster-whisper — only needed for burned-in captions
const whisper = await ask(venvPython, ['-c', 'import faster_whisper;print(faster_whisper.__version__)']);
check('faster-whisper', !!whisper, whisper ? `${whisper} at ${venvPython}` : `not importable from ${venvPython}`,
 './setup.sh, or set PYTHON_PATH to a Python that has faster-whisper');

// The port
const free = await portFree();
check(`Port ${port}`, free, free ? 'free' : 'already in use',
 `Something is already listening. Stop it, or start with PORT=4318 npm start.`);

// OAuth client — genuinely optional
let oauth = !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET);
if (!oauth) { try { await fs.access(path.join(root, 'youtube-credentials.json')); oauth = true; } catch {} }

const pad = Math.max(...checks.map(c => c.name.length));
console.log('\nClipcrow setup check\n');
for (const c of checks) {
 console.log(`  ${c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${c.name.padEnd(pad)}  ${c.detail}`);
 if (!c.ok) console.log(`    ${' '.repeat(pad)}→ ${c.fix}`);
}

const required = checks.filter(c => !['yt-dlp', 'faster-whisper'].includes(c.name));
const optional = checks.filter(c => ['yt-dlp', 'faster-whisper'].includes(c.name));
const blocked = required.filter(c => !c.ok);

console.log('');
for (const c of optional.filter(c => !c.ok)) {
 console.log(c.name === 'yt-dlp'
  ? '  Note: without yt-dlp you can still use direct HLS/RTMP/SRT URLs and local files, but not YouTube links.'
  : '  Note: without faster-whisper everything works except burned-in speech captions. Untick "Speech captions".');
}
console.log(oauth
 ? '  YouTube uploads: an OAuth client is configured.'
 : '  YouTube uploads: no OAuth client. The Chrome extension in extension/ needs none — see README.md.');

if (blocked.length) {
 console.log(`\n\x1b[31m${blocked.length === 1 ? 'One thing' : blocked.length + ' things'} must be fixed before Clipcrow will run.\x1b[0m\n`);
 process.exit(1);
}
console.log('\n\x1b[32mReady.\x1b[0m Run `npm start` and open http://127.0.0.1:' + port + '\n');

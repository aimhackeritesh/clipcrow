// Build Shorts metadata from the stream's own YouTube listing plus the clip's transcript.
// Everything here is pure: the same stream and clip always produce the same caption.

const STOP = new Set(('the a an and or of to in on for with at by from is are was were be been being it its this that these those i you your we our us they them their he she his her as but if then than so just got not no yes very really all out up down over into about after before who what when where why how do does did done go goes going get gets will would can could should'
 + ' live stream streaming streamed watch watching new full video videos today now official channel subscribe like comment share part ep episode').split(' '));

const EMOJI = [
 [/\b(laugh|laughing|funny|lol|lmao|joke|hilarious|comedy)\b/i, '\u{1F602}'],
 [/\b(scream|shock|shocked|omg|wtf|unbelievable|insane|crazy)\b/i, '\u{1F631}'],
 [/\b(win|won|wins|clutch|victory|champion|first place)\b/i, '\u{1F3C6}'],
 [/\b(fail|failed|dead|died|dies|death|lost|lose|rip)\b/i, '\u{1F480}'],
 [/\b(gta|game|gaming|gameplay|play|player|spawn|respawn|loot)\b/i, '\u{1F3AE}'],
 [/\b(fish|fishing|caught|catch|boat|ocean|sea)\b/i, '\u{1F3A3}'],
 [/\b(car|cars|drive|driving|race|racing|speed|crash)\b/i, '\u{1F3CE}️'],
 [/\b(money|cash|rich|million|billion|price|paid)\b/i, '\u{1F4B0}'],
 [/\b(fight|fighting|shoot|shooting|gun|cops|police|chase)\b/i, '\u{1F525}'],
 [/\b(food|eat|eating|hungry|cook|cooking)\b/i, '\u{1F354}'],
 [/\b(music|song|beat|sing|singing|dance)\b/i, '\u{1F3B5}'],
 [/\b(news|breaking|report|update|announced)\b/i, '\u{1F4F0}'],
 [/\b(launch|launched|release|released|drop|dropped|out now)\b/i, '\u{1F680}'],
 [/\b(react|reaction|reacting|first time)\b/i, '\u{1F440}'],
];
const FALLBACK = ['\u{1F525}', '\u{1F602}'];

// Transcripts carry whatever was said. Titles and descriptions are public, so soften the worst of it
// rather than publishing it verbatim; the burned-in captions are left exactly as spoken.
const PROFANITY = /\b(fuck(?:ing|ed|er|ers|s)?|motherfuck(?:er|ers|ing)?|shit(?:ty|s|e)?|bullshit|bitch(?:es|ing)?|cunt|asshole|arsehole|bastard|dick(?:head)?|prick|pussy|whore|slut|twat|wank(?:er)?|nigg(?:a|er)s?|retard(?:ed)?|faggot)\b/gi;
export const soften = text => String(text == null ? '' : text).replace(PROFANITY, word => word[0] + '*'.repeat(Math.max(1, word.length - 1)));

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// YouTube rejects angle brackets in snippet text outright.
const safe = s => clean(s).replace(/[<>]/g, '');
// Same guarantees as safe(), but line breaks survive so the blurb picker can see paragraphs.
const safeLines = s => String(s == null ? '' : s).replace(/[<>]/g, '').split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const cut = (s, n) => s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';

// Streamers habitually stamp the date and start time into a title. Shortening one mid-stamp leaves
// a stray "2026" in the clip's title, so drop the whole stamp before anything is cut.
const DATE_TAIL = /[\s|–—·,-]*(?:\d{1,4}[-\/.]\d{1,2}(?:[-\/.]\d{1,4})?(?:[\s,]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)?|\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*$/i;
export const stripTrailingDate = title => { const out = clean(title).replace(DATE_TAIL, '').replace(/[\s|–—·,-]+$/, '').trim(); return out || clean(title); };

// Boilerplate a broadcaster is obliged to carry says nothing about the clip, and repeating someone
// else's sponsor line on your own upload is worse than saying nothing.
const BOILERPLATE = /sponsor|disclaimer|do not necessarily reflect|views expressed|paid promotion|affiliat|all rights reserved|copyright|i do not own|fair use|business (?:enquir|inquir)|dmca|terms of service|privacy policy|opinions are my own|my own opinions|not responsible|intended for (?:entertainment|mature)|viewer discretion|contains? (?:mature|strong) (?:content|language)/i;
// A usable line is prose about the stream: not a section header, a link dump, a handle list or a
// legal notice. Testing the shape of the line beats chasing every phrase a broadcaster might use.
const describesTheStream = line =>
 line.length >= 20 && line.split(' ').length >= 4 && !line.endsWith(':')
 && !/https?:\/\/|www\.|@\w|\u25ba|\u25b6|\u2192/.test(line)
 && (line.replace(/[^A-Za-z ]/g, '').length / line.length) > .6
 && !BOILERPLATE.test(line);
/** The first line of a stream description that actually describes the stream. */
export function blurbFrom(description, fallback = '') {
 for (const line of String(description == null ? '' : description).split(/\n|(?<=[.!?])\s+/).map(clean)) {
  if (describesTheStream(line)) return line;
 }
 return clean(fallback);
}

/** Normalise a yt-dlp info object down to the listing fields a caption needs. */
export function streamMeta(info = {}) {
 const tags = Array.isArray(info.tags) ? info.tags.map(clean).filter(Boolean).slice(0, 40) : [];
 return {
  title: safe(info.title).slice(0, 300),
  description: safeLines(info.description).slice(0, 4000),
  channel: safe(info.channel || info.uploader).slice(0, 120),
  url: /^https?:\/\//.test(info.webpage_url || '') ? info.webpage_url : '',
  categories: Array.isArray(info.categories) ? info.categories.map(clean).filter(Boolean).slice(0, 5) : [],
  tags,
 };
}

/** The caption phrases in the order they are spoken, with the per-word repeats collapsed. */
export function spokenLine(phrases = []) {
 const out = [];
 for (const p of phrases) { const t = clean(p && p.text); if (t && t !== out.at(-1)) out.push(t); }
 return out.join(' ');
}

/** Words worth keeping, most frequent first, stopwords and noise removed. */
export function keywords(text, limit = 8) {
 const counts = new Map();
 for (const raw of clean(text).toLowerCase().split(/[^a-z0-9']+/)) {
  const word = raw.replace(/^'+|'+$/g, '');
  if (word.length < 3 || STOP.has(word) || !/^[a-z]+$/.test(word)) continue;
  counts.set(word, (counts.get(word) || 0) + 1);
 }
 return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(e => e[0]);
}

/** Up to `limit` emoji, chosen by what the clip and stream are actually about. */
export function emojiFor(text, limit = 2) {
 const picked = [];
 for (const [pattern, emoji] of EMOJI) { if (picked.length >= limit) break; if (pattern.test(text) && !picked.includes(emoji)) picked.push(emoji); }
 for (const emoji of FALLBACK) { if (picked.length >= limit) break; if (!picked.includes(emoji)) picked.push(emoji); }
 return picked.slice(0, limit);
}

const tagToHashtag = tag => {
 const parts = clean(tag).split(/[^A-Za-z0-9]+/).filter(Boolean);
 if (!parts.length) return '';
 const joined = parts.map(p => /^[A-Z0-9]+$/.test(p) ? p : p[0].toUpperCase() + p.slice(1)).join('');
 return /^\d/.test(joined) || joined.length < 2 || joined.length > 30 ? '' : '#' + joined;
};

/**
 * Hashtags from the stream's own tags, ranked by what this clip is about.
 * Capped at 12: YouTube ignores every hashtag on a video that carries more than 15.
 */
export function hashtags(stream = {}, spoken = '', limit = 12) {
 const haystack = (spoken + ' ' + (stream.title || '')).toLowerCase();
 const scored = [];
 const seen = new Set();
 for (const tag of stream.tags || []) {
  const hash = tagToHashtag(tag);
  if (!hash || seen.has(hash.toLowerCase())) continue;
  seen.add(hash.toLowerCase());
  const words = clean(tag).toLowerCase().split(' ').filter(w => !STOP.has(w));
  const hits = words.filter(w => haystack.includes(w)).length;
  scored.push({ hash, score: hits * 10 + (words.length <= 3 ? 2 : 0), length: hash.length });
 }
 scored.sort((a, b) => b.score - a.score || a.length - b.length || a.hash.localeCompare(b.hash));
 const out = [];
 for (const tag of ['#Shorts', ...scored.map(s => s.hash)]) {
  if (out.length >= limit) break;
  if (!out.some(h => h.toLowerCase() === tag.toLowerCase())) out.push(tag);
 }
 return out;
}

/** Plain tags for the video's own tag field, kept under YouTube's 500-character budget. */
export function videoTags(stream = {}, spoken = '', limit = 480) {
 const covered = (stream.tags || []).join(' ').toLowerCase();
 const mined = keywords(spoken + ' ' + (stream.title || ''), 10).filter(w => w.length >= 4 && !covered.includes(w));
 const candidates = [...(stream.tags || []), ...mined.slice(0, 5)];
 const out = [];
 let budget = 0;
 for (const raw of candidates) {
  const tag = clean(raw).slice(0, 60);
  if (!tag || out.some(t => t.toLowerCase() === tag.toLowerCase())) continue;
  const cost = tag.length + (tag.includes(' ') ? 2 : 0) + 1;
  if (budget + cost > limit) continue;
  budget += cost; out.push(tag);
 }
 return out;
}

/**
 * The upload caption for one clip.
 * The hook comes from what is actually said (or the burned-in hook text), the body follows the
 * captions in spoken order, and the credit always points back at the source stream.
 */
export function buildCaption({ stream = {}, clip = {}, phrases = [], words = [] } = {}) {
 const spoken = soften(spokenLine(phrases));
 const plain = soften(clean(words.map(w => w && w.text).filter(Boolean).join(' ')));
 const subject = (spoken + ' ' + (stream.title || '') + ' ' + (stream.categories || []).join(' ')).trim();
 const emoji = emojiFor(subject);
 const hookSource = safe(clip.hook) || cut(clean(plain.split(/(?<=[.!?])\s/)[0] || plain), 60) || stripTrailingDate(safe(stream.title));
 const hook = cut(clean(hookSource), 60);
 const streamTitle = cut(stripTrailingDate(safe(stream.title).split(/\s*[|\u2014\u2013]\s*/)[0] || stream.title), 50);
 const tail = ' ' + emoji.join('') + ' #Shorts';
 const title = cut(clean([hook, streamTitle].filter(Boolean).join(' • ')), 100 - tail.length) + tail;

 const tags = hashtags(stream, spoken);
 const blurb = cut(safe(blurbFrom(stream.description, stripTrailingDate(safe(stream.title)))), 180);
 const body = [
  blurb,
  '',
  spoken ? `${emoji[0] || '\u{1F3A4}'} In this moment: ${cut(spoken.toLowerCase(), 300)}` : '',
  '',
  stream.url ? `▶ Full stream${stream.channel ? ' — ' + stream.channel : ''}: ${stream.url}` : '',
  clip.style ? `✂ ${clip.style === 'reaction' ? 'Reaction stack' : 'Cinematic cut'} clipped live with Clipcrow.` : '',
  '',
  tags.join(' '),
 ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n').trim();

 return { title: title.slice(0, 100), description: body.slice(0, 4900), tags: videoTags(stream, spoken), hashtags: tags, spoken: spoken.toLowerCase() };
}

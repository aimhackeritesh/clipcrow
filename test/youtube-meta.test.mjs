import test from 'node:test';
import assert from 'node:assert/strict';
import {streamMeta, spokenLine, keywords, emojiFor, hashtags, videoTags, buildCaption, soften, stripTrailingDate, blurbFrom} from '../youtube-meta.mjs';

// Exactly what the server stores on a clip: a yt-dlp listing put through streamMeta.
const stream = streamMeta({
 title: 'GTA 6 India Launch LIVE | Grand Theft Auto VI Launched In India',
 description: 'GTA 6 launch celebrations and first reactions.\nSecond line.',
 channel: 'NDTV Profit',
 webpage_url: 'https://www.youtube.com/watch?v=gHYx_XYl0Tg',
 categories: ['Gaming'],
 tags: ['GTA 6 launch live', 'GTA 6 India launch live', 'Rockstar Games', 'GTA 6 PS5'],
});
// captions.json repeats a phrase once per highlighted word.
const phrases = [
 {text: 'JUST UP', active: 0}, {text: 'JUST UP', active: 1},
 {text: 'AHEAD JAKE', active: 0}, {text: 'AHEAD JAKE', active: 1},
];
const words = [{text: 'Just', start: 0, end: .2}, {text: 'up', start: .2, end: .4}, {text: 'ahead', start: .4, end: .6}, {text: 'Jake', start: .6, end: .9}];

test('stream listing is reduced to safe caption fields', () => {
 const meta = streamMeta({...stream, title: 'A <script> title', webpage_url: 'javascript:alert(1)'});
 assert.equal(meta.title, 'A script title');
 assert.equal(meta.url, '', 'only http(s) stream links survive');
 assert.deepEqual(meta.categories, ['Gaming']);
});

test('captions collapse to one line in spoken order', () => {
 assert.equal(spokenLine(phrases), 'JUST UP AHEAD JAKE');
 assert.equal(spokenLine([]), '');
});

test('keywords drop stopwords, digits and short noise', () => {
 assert.deepEqual(keywords('the live stream is about a Rockstar rockstar 2026 car'), ['rockstar', 'car']);
});

test('emoji are chosen from the subject and never repeat', () => {
 assert.deepEqual(emojiFor('hilarious gameplay moment'), ['\u{1F602}', '\u{1F3AE}']);
 const fallback = emojiFor('');
 assert.equal(fallback.length, 2);
 assert.notEqual(fallback[0], fallback[1]);
});

test('hashtags come from the stream tags, lead with #Shorts and stay under the limit', () => {
 const tags = hashtags(stream, 'GTA launch in India');
 assert.equal(tags[0], '#Shorts');
 assert.ok(tags.includes('#RockstarGames'));
 assert.ok(tags.every(t => /^#[A-Za-z][A-Za-z0-9]*$/.test(t)), 'hashtags carry no spaces or punctuation');
 assert.ok(hashtags({tags: Array.from({length: 40}, (_, i) => 'tag number ' + i)}, '').length <= 12);
});

test('relevant tags outrank the rest', () => {
 const ranked = hashtags({tags: ['Totally Unrelated Thing', 'Rockstar Games']}, 'rockstar clutch');
 assert.ok(ranked.indexOf('#RockstarGames') < ranked.indexOf('#TotallyUnrelatedThing'));
});

test('video tags stay inside the 500 character budget', () => {
 const big = videoTags({tags: Array.from({length: 60}, (_, i) => 'a fairly long youtube tag number ' + i)}, '');
 assert.ok(big.join(',').length <= 500, 'joined tags fit YouTube\'s budget');
});

test('caption uses the spoken hook, the stream and the hashtags', () => {
 const caption = buildCaption({stream, clip: {style: 'reaction'}, phrases, words});
 assert.ok(caption.title.length <= 100);
 assert.ok(caption.title.startsWith('Just up ahead Jake'), caption.title);
 assert.ok(caption.title.endsWith('#Shorts'));
 assert.match(caption.description, /JUST UP AHEAD JAKE/i);
 assert.match(caption.description, /youtube\.com\/watch\?v=gHYx_XYl0Tg/);
 assert.match(caption.description, /NDTV Profit/);
 assert.match(caption.description, /#Shorts/);
 assert.ok(caption.tags.includes('Rockstar Games'));
});

test('a burned-in hook wins over the transcript', () => {
 const caption = buildCaption({stream, clip: {hook: 'Wait for the reaction'}, phrases, words});
 assert.ok(caption.title.startsWith('Wait for the reaction'), caption.title);
});

test('a silent clip with no listing still produces a usable caption', () => {
 const caption = buildCaption({});
 assert.ok(caption.title.length > 0 && caption.title.length <= 100);
 assert.ok(caption.description.includes('#Shorts'));
 assert.deepEqual(caption.tags, []);
});

test('angle brackets never reach the snippet', () => {
 const caption = buildCaption({stream: streamMeta({title: '<b>hi</b>', tags: []}), clip: {hook: '<script>'}, phrases: [], words: []});
 assert.ok(!caption.title.includes('<') && !caption.description.includes('<'));
});

test('profanity is softened in the caption but never invented', () => {
 assert.equal(soften('what the fuck Jake'), 'what the f*** Jake');
 assert.equal(soften('classic shitty luck'), 'classic s***** luck');
 assert.equal(soften('scunthorpe assistant class'), 'scunthorpe assistant class', 'only whole words are masked');
 const caption = buildCaption({stream, clip: {}, phrases: [{text: 'FUCKING PLACES', active: 0}], words: [{text: 'fucking'}, {text: 'places'}]});
 assert.ok(!/fucking/i.test(caption.title + caption.description), caption.title);
});

test('mined tags skip noise and anything the stream tags already cover', () => {
 const tags = videoTags({tags: ['Grand Theft Auto VI']}, "i'm ready auto yeah brilliant");
 assert.ok(!tags.includes("i'm"), 'contractions are not tags');
 assert.ok(!tags.includes('auto'), 'already inside an existing tag');
 assert.ok(tags.includes('brilliant'));
});

test('a trailing date or time stamp is dropped before the title is shortened', () => {
 assert.equal(stripTrailingDate('\u{1F7E1} CORE GTA 6 MARATHON \u{1F7E1} 2026-11-19 01:36'), '\u{1F7E1} CORE GTA 6 MARATHON \u{1F7E1}');
 assert.equal(stripTrailingDate('Sunday grind 11/19/2026'), 'Sunday grind');
 assert.equal(stripTrailingDate('Late night 01:36'), 'Late night');
 assert.equal(stripTrailingDate('GTA 6 India Launch LIVE'), 'GTA 6 India Launch LIVE', 'titles without a stamp are untouched');
 assert.equal(stripTrailingDate('2026-11-19'), '2026-11-19', 'a title that is only a date survives rather than emptying');
});

test('the description skips the broadcaster’s boilerplate', () => {
 const blurb = blurbFrom('This livestream is sponsored by YouTube and does not necessarily reflect our views.\nJason plays the GTA 6 marathon all night long.', 'fallback');
 assert.equal(blurb, 'Jason plays the GTA 6 marathon all night long.');
 assert.equal(blurbFrom('Sponsored by someone.', 'Stream title'), 'Stream title', 'falls back when every line is boilerplate');
 assert.equal(blurbFrom('Too short.\nA properly descriptive line about the stream.'), 'A properly descriptive line about the stream.');
});

test('a dated title and a sponsored description produce a clean caption', () => {
 const dated = streamMeta({title: 'CORE GTA 6 MARATHON 2026-11-19 01:36', description: 'This video is sponsored by a brand.\nChasing cops across Vice City.', tags: ['GTA 6'], webpage_url: 'https://youtu.be/x'});
 const caption = buildCaption({stream: dated, clip: {hook: 'Watch this'}, phrases: [], words: []});
 assert.ok(!/2026|01:36/.test(caption.title), caption.title);
 assert.ok(caption.description.startsWith('Chasing cops across Vice City.'), caption.description.slice(0, 60));
});

test('self-disclaimers are boilerplate too', () => {
 assert.equal(blurbFrom('My commentary and opinions are my own.\nTonight we finish the heist.', 'T'), 'Tonight we finish the heist.');
 assert.equal(blurbFrom('Viewer discretion is advised here.', 'Stream title'), 'Stream title');
});

test('headers, link dumps and handle lists are not blurbs', () => {
 assert.equal(blurbFrom('► Follow My Socials:\nTonight we finish the heist together.', 'T'), 'Tonight we finish the heist together.');
 assert.equal(blurbFrom('Follow My Socials:\nhttps://twitter.com/someone is my account here\n@someone @another @third place', 'Stream title'), 'Stream title');
 assert.equal(blurbFrom('Short one\nWe are running the whole GTA 6 marathon tonight.'), 'We are running the whole GTA 6 marathon tonight.');
});

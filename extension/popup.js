// Lists finished clips and stages the ticked ones as an ordered queue.
// Staging uploads nothing: it only records which clips you chose, and in what order.
const API = 'http://127.0.0.1:4317';
const $ = id => document.getElementById(id);
const picked = new Set();
let clips = [];

const text = (tag, cls, value) => {
 const node = document.createElement(tag);
 if (cls) node.className = cls;
 if (value !== undefined) node.textContent = value;
 return node;
};

function refreshButton() {
 const count = picked.size;
 $('stage').disabled = count === 0;
 $('stage').textContent = count === 1 ? 'Stage 1 clip' : `Stage ${count} clips`;
}

async function load() {
 let state;
 try {
  const response = await fetch(API + '/api/state', {cache: 'no-store'});
  if (!response.ok) throw new Error('status ' + response.status);
  state = await response.json();
 } catch {
  $('state').innerHTML = 'Clipcrow is not answering on <b>127.0.0.1:4317</b>. Start it with <b>npm start</b>, then reopen this.';
  return;
 }

 clips = state.clips.filter(clip => clip.status === 'ready' && clip.url);
 $('count').textContent = clips.length + ' READY';
 if (!clips.length) { $('state').textContent = 'No finished clips yet. Mark a moment in Clipcrow first.'; return; }
 $('state').textContent = 'Tick the clips to upload. They are queued in the order shown.';

 const list = $('list');
 list.replaceChildren();
 for (const clip of clips) {
  const row = text('label', 'clip');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.onchange = () => {
   box.checked ? picked.add(clip.id) : picked.delete(clip.id);
   row.classList.toggle('on', box.checked);
   refreshButton();
  };

  const body = text('div');
  const title = text('div', 'title');
  title.append(text('span', 'no', '#' + (clip.number ?? '—')), document.createTextNode(clip.caption?.title || clip.title));
  body.append(title, text('div', 'meta', `${clip.style} · ${clip.duration ? clip.duration.toFixed(1) + 's' : ''} · ${clip.reason}`));
  if (clip.caption?.spoken) body.append(text('div', 'spoken', '“' + clip.caption.spoken + '”'));

  row.append(box, body);
  list.append(row);
 }
}

$('stage').onclick = async () => {
 // Newest first is how the list reads, but a queue should run oldest first so numbers climb.
 const queue = clips
  .filter(clip => picked.has(clip.id))
  .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  .map(clip => ({
   id: clip.id,
   number: clip.number ?? null,
   url: clip.url,
   captionFile: clip.captionFile || null,
   caption: clip.caption || null,
   title: clip.title,
  }));
 await chrome.storage.local.set({staged: {queue, index: 0}});
 $('note').innerHTML = `<b>${queue.length} queued.</b> Open <b>studio.youtube.com</b>, press Create → Upload videos, then Fill from Clipcrow. After each Publish, press Next on the bar.`;
};

refreshButton();
load();

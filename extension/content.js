// Runs on studio.youtube.com. It never clicks Publish and never acts on its own: it waits for the
// Fill button in its own bar, then attaches the current clip and types its caption into the form.
// A queue is walked one clip at a time, because each one has to be published by a person.
const API = 'http://127.0.0.1:4317';

/* ---------- finding things inside Studio's shadow roots ---------- */

function deepAll(selector, root = document, found = []) {
 try { for (const node of root.querySelectorAll(selector)) found.push(node); } catch { return found; }
 for (const node of root.querySelectorAll('*')) if (node.shadowRoot) deepAll(selector, node.shadowRoot, found);
 return found;
}
const deepOne = selector => deepAll(selector)[0] || null;

/** First selector that matches something, polled until it appears. */
async function waitForAny(selectors, {timeout = 25000, label = 'element'} = {}) {
 const deadline = Date.now() + timeout;
 for (;;) {
  for (const selector of selectors) { const node = deepOne(selector); if (node) return {node, selector}; }
  if (Date.now() > deadline) throw new Error(`Could not find the ${label} on this page. YouTube may have changed its layout.`);
  await new Promise(resolve => setTimeout(resolve, 300));
 }
}

/* ---------- writing into Studio's fields ---------- */

// The title and description are contenteditable inside a Polymer component. Assigning textContent
// leaves the component's own model untouched, so type through the editing commands instead.
function typeInto(node, value) {
 node.focus();
 document.execCommand('selectAll', false, null);
 document.execCommand('insertText', false, value);
 node.dispatchEvent(new Event('input', {bubbles: true}));
 node.dispatchEvent(new Event('change', {bubbles: true}));
 return node.textContent.trim().length > 0;
}

function attachFile(input, file) {
 const transfer = new DataTransfer();
 transfer.items.add(file);
 input.files = transfer.files;
 input.dispatchEvent(new Event('change', {bubbles: true}));
 return input.files.length === 1;
}

/* ---------- the caption file ---------- */

/** Split a caption.txt back into its title and description. */
function parseCaption(raw) {
 const [head, afterTitle = ''] = String(raw).split('--- DESCRIPTION ---');
 const [description = ''] = afterTitle.split('--- TAGS ---');
 return {title: head.trim().split('\n')[0].trim(), description: description.trim()};
}

async function captionFor(clip) {
 if (clip.captionFile) {
  const response = await fetch(API + clip.captionFile, {cache: 'no-store'});
  if (response.ok) return parseCaption(await response.text());
 }
 if (clip.caption) return {title: clip.caption.title || clip.title, description: clip.caption.description || ''};
 return {title: clip.title, description: ''};
}

/* ---------- the bar ---------- */

let status, nextButton;

function say(message, tone = '') {
 if (!status) return;
 status.textContent = message;
 status.className = 'cc-status ' + tone;
}

function makeBar(clip, position, total) {
 document.getElementById('clipcrow-bar')?.remove();
 const bar = document.createElement('div');
 bar.id = 'clipcrow-bar';

 const counter = document.createElement('div');
 counter.className = 'cc-count';
 counter.textContent = `${position} / ${total}`;

 const label = document.createElement('div');
 label.className = 'cc-label';
 const number = document.createElement('b');
 number.textContent = '#' + (clip.number ?? '—');
 label.append(number, document.createTextNode(' ' + (clip.caption?.title || clip.title || 'Staged clip')));

 status = document.createElement('div');
 status.className = 'cc-status';
 status.textContent = 'Press Fill: it opens the upload dialog, attaches the clip and types its caption.';

 const fill = document.createElement('button');
 fill.className = 'cc-fill';
 fill.textContent = 'Fill from Clipcrow';
 fill.onclick = () => { fill.disabled = true; run(clip).finally(() => { fill.disabled = false; }); };

 nextButton = document.createElement('button');
 nextButton.className = 'cc-next';
 nextButton.textContent = total > 1 ? 'Next ▸' : 'Done';
 nextButton.hidden = true;
 nextButton.onclick = advance;

 const dismiss = document.createElement('button');
 dismiss.className = 'cc-dismiss';
 dismiss.title = 'Drop the whole queue';
 dismiss.textContent = '×';
 dismiss.onclick = async () => { await chrome.storage.local.remove('staged'); document.getElementById('clipcrow-bar')?.remove(); };

 bar.append(counter, label, status, fill, nextButton, dismiss);
 document.documentElement.append(bar);
}

/** Move to the next clip once this one has been published, or finish the queue. */
async function advance() {
 const {staged} = await chrome.storage.local.get('staged');
 if (!staged) return;
 const index = staged.index + 1;
 if (index >= staged.queue.length) { await chrome.storage.local.remove('staged'); return; }
 await chrome.storage.local.set({staged: {queue: staged.queue, index}});
}

/* ---------- opening the upload dialog ---------- */

/**
 * Walk Create -> Upload videos so a queue does not need a click between every clip.
 * The menu item carries test-id="upload", which survives relabelling better than its position.
 */
async function openUploadDialog() {
 if (deepOne('input[type=file]') || deepOne('ytcp-uploads-dialog')) return true;

 const create = deepOne('ytcp-button.ytcpAppHeaderCreateIcon')
  || deepAll('ytcp-button, button').find(button => /^\s*create\s*$/i.test(button.textContent || ''));
 if (!create) return false;
 create.click();

 const menuDeadline = Date.now() + 6000;
 let item = null;
 while (Date.now() < menuDeadline) {
  item = deepOne('tp-yt-paper-item[test-id="upload"]')
   || deepAll('tp-yt-paper-item').find(node => /upload/i.test(node.textContent || ''));
  if (item) break;
  await new Promise(resolve => setTimeout(resolve, 200));
 }
 if (!item) return false;
 item.click();

 try { await waitForAny(['input[type=file]'], {timeout: 15000, label: 'file picker'}); return true; }
 catch { return false; }
}

/* ---------- the one action ---------- */

async function run(clip) {
 try {
  if (!deepOne('input[type=file]') && !deepOne('ytcp-uploads-dialog')) {
   say('Opening Create → Upload videos…');
   if (!await openUploadDialog()) {
    say('Could not open the upload dialog. Open Create → Upload videos yourself, then press Fill again.', 'warn');
    return;
   }
  }

  say('Fetching the clip from Clipcrow…');
  const [videoResponse, caption] = await Promise.all([
   fetch(API + clip.url, {cache: 'no-store'}),
   captionFor(clip),
  ]);
  if (!videoResponse.ok) throw new Error('Clipcrow would not serve the video (' + videoResponse.status + ')');
  const blob = await videoResponse.blob();
  const name = `clipcrow-${String(clip.number ?? 0).padStart(3, '0')}.mp4`;
  const file = new File([blob], name, {type: 'video/mp4'});

  say('Attaching ' + name + '…');
  const {node: input} = await waitForAny(['input[type=file]'], {label: 'file picker', timeout: 30000});
  if (!attachFile(input, file)) throw new Error('The file picker refused the clip');

  say('Waiting for the details form…');
  const {node: titleBox} = await waitForAny(
   ['#title-textarea #textbox', 'ytcp-social-suggestions-textbox#title-textarea #textbox', '#title #textbox'],
   {label: 'title field', timeout: 60000});

  if (!typeInto(titleBox, caption.title)) throw new Error('The title did not take');
  say('Title set. Filling the description…');

  let descriptionNote = '';
  try {
   const {node: descriptionBox} = await waitForAny(
    ['#description-textarea #textbox', 'ytcp-social-suggestions-textbox#description-textarea #textbox', '#description-container #textbox'],
    {label: 'description field', timeout: 15000});
   typeInto(descriptionBox, caption.description);
  } catch { descriptionNote = ' The description field was not found — paste it yourself.'; }

  const kids = deepOne('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]')
   || deepOne('[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
  if (kids) kids.click();
  const kidsNote = kids ? 'Audience set to not made for kids.' : 'Set the audience yourself: the option was not found.';

  if (nextButton) nextButton.hidden = false;
  say(`Filled #${clip.number}. ${kidsNote}${descriptionNote} Choose visibility and press Publish, then Next.`,
   kids && !descriptionNote ? 'ok' : 'warn');
 } catch (error) {
  say(error.message, 'warn');
 }
}

/* ---------- the queue ---------- */

async function sync() {
 const {staged} = await chrome.storage.local.get('staged');
 const queue = staged?.queue;
 if (!queue?.length || staged.index >= queue.length) { document.getElementById('clipcrow-bar')?.remove(); return; }
 makeBar(queue[staged.index], staged.index + 1, queue.length);
}

chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.staged) sync(); });
sync();

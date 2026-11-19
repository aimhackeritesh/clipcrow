const $=s=>document.querySelector(s);let style='reaction',current=null,clipKey='',hls=null,mediaSession=null,busy=false;
const toast=message=>{ $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);};
const settings=()=>({style,captions:$('#captions').checked,pre:Number($('#pre').value),post:Number($('#post').value),hook:$('#hook').value,split:$('#split').checked,auto:$('#auto').checked,threshold:Number($('#threshold').value),...Object.fromEntries(['faceX','faceY','faceW','faceH'].map(k=>[k,Number($('#'+k).value)]))});
async function post(endpoint,body={}){const r=await fetch('/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
async function action(fn){if(busy)return;busy=true;try{await fn();await refresh();}catch(e){toast(e.message);}finally{busy=false;}}
$('#connect').onclick=()=>action(async()=>{const btn=$('#connect');btn.disabled=true;btn.textContent='Connecting…';try{await post('start',{source:$('#source').value,...settings()});}finally{btn.disabled=false;btn.textContent='Connect stream ↗';}});
$('#stop').onclick=()=>action(()=>post('stop'));
$('#clip').onclick=()=>action(async()=>{await post('settings',settings());await post('clip');toast('Moment marked. Collecting the ending, then exporting.');});
$('#apply').onclick=()=>action(async()=>{await post('settings',settings());toast('Recipe applied to new clips.');});
for(const button of document.querySelectorAll('[data-demo]'))button.onclick=()=>action(async()=>{style=button.dataset.demo;$('#split').checked=false;document.querySelectorAll('[data-style]').forEach(b=>b.classList.toggle('selected',b.dataset.style===style));await post('start',{reference:button.dataset.demo,...settings()});toast('Playing the reference into the live buffer in real time.');});
for(const button of document.querySelectorAll('[data-style]'))button.onclick=()=>{style=button.dataset.style;if(style==='reaction')$('#split').checked=true;document.querySelectorAll('[data-style]').forEach(b=>b.classList.toggle('selected',b===button));};
$('#threshold').oninput=()=>$('#thresholdLabel').textContent=$('#threshold').value+' dB';
const time=sec=>`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function drawClips(clips){const key=JSON.stringify(clips);if(key===clipKey)return;clipKey=key;$('#clipCount').textContent=clips.length;$('#navCount').textContent=clips.length;if(!clips.length)return;$('#clips').replaceChildren();for(const c of clips){const card=el('article','clip-card');if(window.awaitingClip===c.id){card.classList.add('awaiting');if(!window.awaitingShown){window.awaitingShown=true;setTimeout(()=>card.scrollIntoView({block:'center',behavior:'smooth'}),80);}}if(c.status==='ready'){const v=el('video');v.src=c.url;v.poster=c.poster;v.controls=true;v.preload='none';card.append(v);}else card.append(el('div','waiting',c.stage||c.status.toUpperCase()));const info=el('div','clip-info');
 const head=el('h3','');head.append(el('span','clip-no','#'+(c.number??'\u2014')),document.createTextNode(' '+(c.caption?.title||c.title)));
 info.append(head,el('p','',`${c.style} · ${c.duration?c.duration.toFixed(1)+'s':time(c.start)+' → '+time(c.end)} · ${c.reason}`));
 if(c.caption?.spoken)info.append(el('p','cap-spoken','\u201c'+c.caption.spoken+'\u201d'));
 if(c.caption?.hashtags?.length)info.append(el('p','cap-tags',c.caption.hashtags.slice(0,6).join(' ')));if(c.url){const a=el('a','','Download MP4 ↗');a.href=c.url;a.download=`${clipBasename(c)}.mp4`;info.append(a);}if(c.caption){info.append(captionDownload(c));const cap=el('details','caption');cap.append(el('summary','','Caption, description and tags'),el('p','cap-title',c.caption.title),el('pre','cap-body',c.caption.description),el('pre','cap-body','Tags: '+(c.caption.tags||[]).join(', ')));info.append(cap);}if(c.status==='ready'){const u=c.upload;if(u?.status==='done'){const a=el('a','up-done',`\u25b6 On YouTube \u00b7 ${u.privacy} \u2197`);a.href=u.url;a.target='_blank';a.rel='noopener noreferrer';info.append(a);}else if(u?.status==='uploading')info.append(el('p','up-busy','Uploading to YouTube\u2026'));else{if(u?.status==='failed')info.append(el('p','up-fail',u.error));const b=el('button','up-btn','\u2191 Upload to YouTube');b.onclick=()=>uploadClip(c.id);info.append(b);}}if(c.error){const d=el('details');d.append(el('summary','','Export details'),el('p','',c.error));info.append(d);}card.append(info);$('#clips').append(card);}}
async function refresh(){try{const r=await fetch('/api/state');if(!r.ok)throw new Error('Could not read capture state');const state=await r.json();current=state;const s=state.session,active=s&&['connecting','live'].includes(s.status);$('#status').textContent='● '+(s?.status||'offline').toUpperCase();$('#status').classList.toggle('live',s?.status==='live');$('#connect').hidden=!!active;$('#stop').hidden=!active;$('#clip').disabled=!s||s.elapsed<2;$('#sourceName').textContent=s?.stream?.title||s?.sourceName||'NO SOURCE CONNECTED';$('#timecode').textContent=time(s?.elapsed||0);$('#buffer').textContent=Math.round(s?.buffer||0)+'s';$('#db').textContent=s?.elapsed?`${s.db.toFixed(1)} dB`:'— dB';$('#screenTag').textContent=s?.elapsed?(active?'BUFFERED LIVE PREVIEW':'CAPTURE ENDED'):'AWAITING SIGNAL';$('#captureNote').textContent=s?.error?'Capture needs attention':active?(s.settings.auto?'Watching for audio peaks':'Capturing · manual marks enabled'):'Ready when you are';$('#pulse').style.background=active?'var(--accent)':'#7e8774';$('#wave').replaceChildren(...Array.from({length:45},(_,i)=>{const b=el('i');const level=s?.levels?.slice(-45)[i];b.style.height=(level?Math.max(3,Math.min(36,(level.db+60)/60*36)):3)+'px';return b;}));if(s?.error&&window.lastError!==s.error){window.lastError=s.error;toast(s.error);}if(s?.elapsed){$('#empty').hidden=true;if(mediaSession!==s.id){hls?.destroy();mediaSession=s.id;const v=$('#live');if(window.Hls?.isSupported()){hls=new Hls({liveSyncDurationCount:2,maxBufferLength:12});hls.loadSource(s.playlist);hls.attachMedia(v);hls.on(Hls.Events.ERROR,(_,d)=>{if(d.fatal){v.hidden=true;$('#preview').hidden=false;}});v.hidden=false;}else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=s.playlist;v.hidden=false;}else $('#preview').hidden=false;}$('#preview').src=s.preview+'?t='+s.elapsed;}drawPublish(state.youtube);drawClips(state.clips);$('#events').replaceChildren(...state.events.map(e=>el('li','',new Date(e.at).toLocaleTimeString()+' · '+e.message)));$('#lastEvent').textContent=state.events[0]?.message||'No activity yet';}catch(e){$('#status').textContent='● SERVER OFFLINE';}}
await refresh();if(current?.session){const c=current.session.settings;style=c.style;for(const key of ['pre','post','threshold','hook','faceX','faceY','faceW','faceH'])if(c[key]!==undefined)$('#'+key).value=c[key];$('#auto').checked=c.auto;$('#split').checked=c.split;$('#captions').checked=c.captions!==false;$('#threshold').oninput();document.querySelectorAll('[data-style]').forEach(b=>b.classList.toggle('selected',b.dataset.style===style));}setInterval(refresh,1500);

const frame=new Image();let frameURL='';
function drawLayout(){const c=$('#layoutPreview'),ctx=c.getContext('2d');if(!frame.naturalWidth)return;const s=settings(),w=frame.naturalWidth,h=frame.naturalHeight;ctx.fillStyle='#080a07';ctx.fillRect(0,0,270,480);
 const draw=(sx,sy,sw,sh,dy,dh)=>{const ratio=270/dh;if(sw/sh>ratio){const nw=sh*ratio;sx+=(sw-nw)/2;sw=nw;}else{const nh=sw/ratio;sy+=(sh-nh)/2;sh=nh;}ctx.drawImage(frame,sx,sy,sw,sh,0,dy,270,dh);};
 if(s.split&&s.style==='reaction'){const x=w*s.faceX/100,y=h*s.faceY/100;draw(x,y,Math.min(w*s.faceW/100,w-x),Math.min(h*s.faceH/100,h-y),0,200);draw(0,0,w,h,200,280);}else draw(0,0,w,h,0,480);
}
frame.onload=drawLayout;document.querySelectorAll('.settings input').forEach(e=>e.addEventListener('input',drawLayout));document.querySelectorAll('[data-style]').forEach(e=>e.addEventListener('click',drawLayout));setInterval(()=>{const s=current?.session;if(s?.elapsed){const url=s.preview+'?t='+s.elapsed;if(url!==frameURL){frameURL=url;frame.src=url;}}},1500);

/* Manual facecam crop: drag the region straight onto the stream monitor. */
const screenEl=document.querySelector('.screen'),overlay=$('#cropOverlay'),cropBox=$('#cropBox'),cropPick=$('#cropPick');
const clampRect=r=>{const w=Math.min(100,Math.max(5,r.w)),h=Math.min(100,Math.max(5,r.h));const x=Math.min(95,Math.max(0,Math.min(r.x,100-w))),y=Math.min(95,Math.max(0,Math.min(r.y,100-h)));return{x,y,w:Math.min(w,100-x),h:Math.min(h,100-y)};};
const readRect=()=>({x:Number($('#faceX').value)||0,y:Number($('#faceY').value)||0,w:Number($('#faceW').value)||5,h:Number($('#faceH').value)||5});
function mediaRect(){const r=screenEl.getBoundingClientRect(),v=$('#live'),p=$('#preview');let sw=0,sh=0;
 if(!v.hidden&&v.videoWidth){sw=v.videoWidth;sh=v.videoHeight;}else if(!p.hidden&&p.naturalWidth){sw=p.naturalWidth;sh=p.naturalHeight;}else if(frame.naturalWidth){sw=frame.naturalWidth;sh=frame.naturalHeight;}
 if(!sw||!sh)return{left:0,top:0,width:r.width,height:r.height,known:false};
 const scale=Math.min(r.width/sw,r.height/sh),w=sw*scale,h=sh*scale;return{left:(r.width-w)/2,top:(r.height-h)/2,width:w,height:h,known:true};}
const pointPct=(e,m)=>{const r=screenEl.getBoundingClientRect();return{x:(e.clientX-r.left-m.left)/m.width*100,y:(e.clientY-r.top-m.top)/m.height*100};};
function paintBox(){if(overlay.hidden)return;const m=mediaRect(),r=clampRect(readRect());cropBox.style.left=(m.left+m.width*r.x/100)+'px';cropBox.style.top=(m.top+m.height*r.y/100)+'px';cropBox.style.width=(m.width*r.w/100)+'px';cropBox.style.height=(m.height*r.h/100)+'px';
 $('#cropNums').textContent=`FACECAM  ${Math.round(r.x)},${Math.round(r.y)}  ${Math.round(r.w)}×${Math.round(r.h)} %`;}
function writeRect(r){$('#cropState').textContent='';const c=clampRect(r);$('#faceX').value=Math.round(c.x);$('#faceY').value=Math.round(c.y);$('#faceW').value=Math.round(c.w);$('#faceH').value=Math.round(c.h);drawLayout();paintBox();}
let drag=null;
overlay.addEventListener('pointerdown',e=>{const m=mediaRect();if(!m.known)return toast('Connect a stream or play a reference first — the crop needs a frame to sit on.');
 if(e.button)return;e.preventDefault();cropSession=streamId();const handle=e.target.dataset.h,origin=pointPct(e,m);
 drag={m,origin,start:readRect(),mode:handle?'resize':e.target===cropBox?'move':'draw',handle};
 overlay.setPointerCapture(e.pointerId);cropBox.focus();if(drag.mode==='draw')writeRect({x:origin.x,y:origin.y,w:5,h:5});});
overlay.addEventListener('pointermove',e=>{if(!drag)return;const p=pointPct(e,drag.m),s=drag.start,o=drag.origin;
 if(drag.mode==='move')return writeRect({x:s.x+p.x-o.x,y:s.y+p.y-o.y,w:s.w,h:s.h});
 let l,t,rt,b;
 if(drag.mode==='draw'){l=Math.min(o.x,p.x);rt=Math.max(o.x,p.x);t=Math.min(o.y,p.y);b=Math.max(o.y,p.y);}
 else{l=s.x;t=s.y;rt=s.x+s.w;b=s.y+s.h;const h=drag.handle;
  if(h.includes('w'))l=p.x;if(h.includes('e'))rt=p.x;if(h.includes('n'))t=p.y;if(h.includes('s'))b=p.y;
  if(l>rt)[l,rt]=[rt,l];if(t>b)[t,b]=[b,t];}
 writeRect({x:l,y:t,w:rt-l,h:b-t});});
for(const type of ['pointerup','pointercancel'])overlay.addEventListener(type,e=>{if(!drag)return;drag=null;overlay.releasePointerCapture?.(e.pointerId);autoApplyCrop();});
cropBox.addEventListener('keydown',e=>{const step=e.altKey?1:5,d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;e.preventDefault();const r=readRect();
 if(e.shiftKey)writeRect({...r,w:r.w+d[0]*step,h:r.h+d[1]*step});else writeRect({...r,x:r.x+d[0]*step,y:r.y+d[1]*step});autoApplyCrop();});
cropPick.onclick=()=>{const on=overlay.hidden;overlay.hidden=!on;cropPick.setAttribute('aria-pressed',String(on));cropPick.classList.toggle('selected',on);
 cropPick.innerHTML=on?'✓ &nbsp; Done — crop set':'⬚ &nbsp; Drag the crop on the monitor';
 $('#live').controls=!on;
 if(!on)return;cropSession=streamId();paintBox();cropBox.focus();
 if(!$('#split').checked||style!=='reaction')toast('Stacking is off, so this crop will not be used. Turn on “Stack facecam over gameplay”.');};
addEventListener('resize',paintBox);
frame.addEventListener('load',paintBox);
$('#live').addEventListener('loadedmetadata',paintBox);
document.querySelectorAll('.face-controls input').forEach(e=>e.addEventListener('input',paintBox));


/* Auto-apply the crop, but only while the capture is still the stream it was drawn on. */
let cropSession=null,cropTimer=0,cropBusy=false;
const streamId=()=>{const s=current?.session;return s&&['connecting','live'].includes(s.status)?s.id:null;};
function autoApplyCrop(){clearTimeout(cropTimer);cropTimer=setTimeout(async()=>{const now=streamId();
 if(!cropSession||!now||cropBusy)return;
 if(now!==cropSession){cropSession=now;$('#cropState').textContent='\u00b7 NOT APPLIED';return toast('The capture changed since you drew this crop, so it was not applied. Press Apply recipe to use it on this stream.');}
 cropBusy=true;
 try{await post('settings',settings());$('#cropState').textContent='\u2713 APPLIED';}
 catch(e){$('#cropState').textContent='\u00b7 NOT APPLIED';toast(e.message);}
 finally{cropBusy=false;}},400);}

/* YouTube Studio: connection, visibility and auto-upload. */
function drawPublish(y){
 if(!y)return;const wasConnected=window.ytConnected;window.ytConnected=y.connected;
 if(y.connected&&!wasConnected){const pending=recall('pendingUpload');
  if(pending){remember('pendingUpload',null);window.awaitingClip=pending;window.awaitingShown=false;clipKey='';
   toast('Channel connected. Press Upload on the clip below to publish it.');}}
 $('#ytState').textContent=y.connected?(y.channel||'Connected'):y.configured?'Not connected':'No OAuth client yet';
 $('#ytHint').textContent=y.connected?'Clips upload to this channel.':y.configured?'Sign in to the channel that should receive clips.':'Add youtube-credentials.json to the app folder, then reload.';
 $('#ytDot').classList.toggle('on',y.connected);
 $('#ytConnect').textContent=y.connected?'Disconnect':'Connect YouTube Studio \u2197';
 $('#ytConnect').disabled=!y.configured;
 if(document.activeElement!==$('#ytPrivacy'))$('#ytPrivacy').value=y.privacy;
 if(document.activeElement!==$('#ytAuto'))$('#ytAuto').checked=y.auto;
}
const remember=(key,value)=>{try{value===null?sessionStorage.removeItem(key):sessionStorage.setItem(key,value);}catch{}};
const recall=key=>{try{return sessionStorage.getItem(key);}catch{return null;}};
async function startConnect(){const {url}=await post('youtube/connect');toast('Finish the Google sign-in in the tab that just opened.');window.open(url,'_blank','noopener,noreferrer');}
/** Upload, or send an unconnected viewer to Google first and remember what they were uploading. */
const uploadClip=id=>action(async()=>{
 if(!window.ytConnected){await startConnect();remember('pendingUpload',id);return;}
 await post('youtube/upload',{id});toast('Uploading to YouTube\u2026');
});
$('#ytConnect').onclick=()=>action(async()=>{
 if(window.ytConnected){await post('youtube/disconnect');toast('YouTube Studio disconnected.');return;}
 await startConnect();
});
const savePublish=()=>action(()=>post('youtube/config',{privacy:$('#ytPrivacy').value,auto:$('#ytAuto').checked}));
$('#ytPrivacy').onchange=savePublish;
$('#ytAuto').onchange=()=>{if($('#ytAuto').checked&&!window.ytConnected){$('#ytAuto').checked=false;return toast('Connect YouTube Studio before switching auto-upload on.');}savePublish();};

/** The caption as a text file, so a clip downloaded for manual upload carries its wording too. */
function captionText(c){
 const cap=c.caption||{};
 return [cap.title||c.title,'','--- DESCRIPTION ---','',cap.description||'','','--- TAGS ---','',(cap.tags||[]).join(', '),''].join('\n');
}
function captionDownload(c){
 const link=el('a','cap-dl','\u2193 Caption & description (.txt)');
 link.download=`${clipBasename(c)}-caption.txt`;
 // Written beside the clip at export; clips captioned before that are built here instead.
 if(c.captionFile){link.href=c.captionFile;return link;}
 link.href='#';
 link.onclick=event=>{
  event.preventDefault();
  // Built on click and revoked straight after, so a redrawing queue does not leak blob URLs.
  const url=URL.createObjectURL(new Blob([captionText(c)],{type:'text/plain;charset=utf-8'}));
  const download=document.createElement('a');
  download.href=url;download.download=`${clipBasename(c)}-caption.txt`;
  document.body.append(download);download.click();download.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
 };
 return link;
}

/** A readable, unique filename: the clip's number plus a slug of whatever it is called. */
function clipBasename(c){
 const slug=String(c.caption?.title||c.title||'clip').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,44).replace(/-+$/,'');
 return `clipcrow-${String(c.number??0).padStart(3,'0')}${slug?'-'+slug:''}`;
}

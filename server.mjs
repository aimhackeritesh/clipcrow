import {addCaptions} from './captions.mjs';
import {youtubeFormat,youtubeInputs,captureInputs} from './youtube.mjs';
import {streamMeta,buildCaption} from './youtube-meta.mjs';
import * as publish from './publish.mjs';
import {COOKIE,sessionSecret,verifyToken,issue,readCookie,cookieHeader,passwordMatches,isOpenPath,tooManyAttempts,recordAttempt,clearAttempts} from './auth.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {validateSettings,selectSegments,shouldTrigger,escapeXML,videoFilter} from './engine.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)), data=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
const host=process.env.HOST||'127.0.0.1', password=process.env.CLIPCROW_PASSWORD||'';
const localOnly=['127.0.0.1','::1','localhost'].includes(host);
// Reachable from elsewhere without a password would hand the connected YouTube channel to anyone
// who finds the address, so refuse to start rather than come up unprotected.
if(!localOnly&&!password){console.error(`Refusing to listen on ${host} without CLIPCROW_PASSWORD. Set it, or bind to 127.0.0.1.`);process.exit(1);}
await fs.mkdir(data,{recursive:true});
const secret=await sessionSecret(data);
// The two reference replay buttons play a local file into the buffer so the desk can be tried
// without a live stream. No video ships with this repo: point these at your own files if you want
// those buttons, or just paste a stream URL.
const refs={reaction:process.env.CLIPCROW_DEMO_REACTION||'',cinematic:process.env.CLIPCROW_DEMO_CINEMATIC||''};
let session=null, clips=[], events=[], queue=Promise.resolve(), starting=false;
try { clips=JSON.parse(await fs.readFile(path.join(data,'clips.json'),'utf8')); for(const c of clips) if(['queued','rendering','collecting'].includes(c.status)) {c.status='failed';c.error='App restarted before export completed';} } catch {}
// Clips are told apart by a number that never changes, not by a title they often share.
{
 const numbered=clips.filter(c=>Number.isInteger(c.number));
 let next=numbered.length?Math.max(...numbered.map(c=>c.number))+1:1;
 const missing=clips.filter(c=>!Number.isInteger(c.number)).sort((a,b)=>(a.created||0)-(b.created||0));
 for(const c of missing)c.number=next++;
 if(missing.length)await fs.writeFile(path.join(data,'clips.json'),JSON.stringify(clips,null,2)).catch(()=>{});
}
for(const c of clips){
 if(!c.caption||c.captionFile)continue;
 try{await fs.writeFile(path.join(data,c.id,'caption.txt'),captionFileText(c.caption));c.captionFile=`/data/${c.id}/caption.txt`;}catch{}
}
const log=(message)=>{events.unshift({at:Date.now(),message});events=events.slice(0,25);};
const save=()=>fs.writeFile(path.join(data,'clips.json'),JSON.stringify(clips,null,2));
function run(args) {return new Promise((resolve,reject)=>{const p=spawn('ffmpeg',args);let err='';p.stderr.on('data',d=>err=(err+d).slice(-6000));p.on('error',reject);p.on('close',c=>c===0?resolve(err):reject(new Error(err.slice(-1500))));});}
async function resolveYouTube(url) {
 const executable=process.env.YTDLP_PATH||path.join(root,'.venv/bin/yt-dlp');
 return new Promise((resolve,reject)=>{
 const p=spawn(executable,['--no-playlist','--no-warnings','--js-runtimes','node','-f',youtubeFormat,'--dump-single-json',url]);let output='',error='';
 const timer=setTimeout(()=>{p.kill('SIGTERM');reject(new Error('YouTube resolution timed out. Try again or use a direct HLS URL.'));},45000);
 p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>error=(error+d).slice(-2500));
 p.on('error',()=>{clearTimeout(timer);reject(new Error('YouTube resolver missing. Run the yt-dlp setup in README.md.'));});
 p.on('close',code=>{clearTimeout(timer);if(code===0){try{const info=JSON.parse(output);resolve({...youtubeInputs(info),meta:streamMeta(info)});}catch(e){reject(new Error('YouTube media selection failed: '+e.message));}}else reject(new Error('YouTube could not be opened. '+error.slice(-900)));});
 });
}
async function start(body) {
 if(session?.proc) throw new Error('Stop the current stream first');
 const settings=validateSettings(body); let source=body.reference?refs[body.reference]:String(body.source||'').trim();
 if(body.reference&&!source) throw new Error(`No reference video is configured for "${body.reference}". Set CLIPCROW_DEMO_${String(body.reference).toUpperCase()} to an absolute path, or paste a stream URL instead.`);
 if(!source) throw new Error('Enter a direct stream URL or local video path');
 const remote=/^(https?|rtmp|rtmps|srt):\/\//.test(source);
 if(!remote) {if(!path.isAbsolute(source)) throw new Error('Use an absolute file path or direct stream URL');await fs.access(source);}
 let youtube=false,audioSource=null;
 if(remote){const host=new URL(source).hostname;youtube=['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host);if(host==='twitch.tv'||host==='www.twitch.tv')throw new Error('Use a direct media URL for Twitch. YouTube watch links are supported.');}
 let meta=null;
 if(youtube){log('Resolving YouTube stream…');const media=await resolveYouTube(source);source=media.video;audioSource=media.audio;meta=media.meta;log(meta.title?`Stream listing: ${meta.title.slice(0,70)}`:'Stream listing unavailable');}
 const id=randomUUID(), dir=path.join(data,id);await fs.mkdir(dir);
 const s={id,dir,settings,meta,segments:[],seen:new Set(),elapsed:0,db:-60,levels:[],lastTrigger:-30,started:Date.now(),status:'connecting',sourceName:body.reference?`${body.reference} reference · real-time replay`:youtube?'YouTube Live':remote?'Live stream':path.basename(source),pending:[],error:null};session=s;
 const args=['-hide_banner','-loglevel','warning','-y',...captureInputs(source,audioSource,remote),'-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-preset','ultrafast','-crf','16','-pix_fmt','yuv420p','-g','60','-keyint_min','60','-sc_threshold','0','-c:a','aac','-b:a','320k','-f','hls','-hls_time','2','-hls_list_size','0','-hls_flags','independent_segments+temp_file','-hls_segment_filename',path.join(dir,'part%06d.ts'),path.join(dir,'live.m3u8')];
 const p=spawn('ffmpeg',args);s.proc=p;let err='';p.stderr.on('data',d=>err=(err+d).slice(-3000));p.on('error',e=>{s.error=e.message;s.status='error';s.proc=null;});
 p.on('close',async code=>{s.proc=null;s.status=code===0||s.stopping?'stopped':'error';if(s.status==='error')s.error=err.slice(-1000);await scan(s);for(const c of s.pending.splice(0)) await enqueue(s,c);log(s.status==='error'?'Source disconnected with an error':'Capture ended; buffer remains available');});
 log(`Connected ${s.sourceName}`);return {id};
}
async function scan(s) {
 if(s.scanning)return;s.scanning=true;
 try {
 const manifest=await fs.readFile(path.join(s.dir,'live.m3u8'),'utf8');let total=0,duration=0;
 for(const line of manifest.split('\n')) {
  if(line.startsWith('#EXTINF:'))duration=parseFloat(line.slice(8));
  else if(line.endsWith('.ts')) {const seg={name:line,start:total,end:total+duration};total+=duration;if(!s.seen.has(line)){s.seen.add(line);s.segments.push(seg);await analyze(s,seg);}}
 }
 s.elapsed=total;if(s.proc && total>0)s.status='live';
 for(const c of [...s.pending])if(total>=c.end){s.pending.splice(s.pending.indexOf(c),1);await enqueue(s,c);}
 // Keep a two-minute rolling buffer; each render receives private copies before pruning.
 const keep=total-120;const old=s.segments.filter(x=>x.end<keep);s.segments=s.segments.filter(x=>x.end>=keep);
 for(const seg of old)await fs.rm(path.join(s.dir,seg.name),{force:true});
 }catch(e){if(e.code!=='ENOENT')log(`Buffer: ${e.message}`);}finally{s.scanning=false;}
}
async function analyze(s,seg) {
 const result=await run(['-hide_banner','-i',path.join(s.dir,seg.name),'-vn','-af','volumedetect','-f','null','-']).catch(()=> '');
 const match=result.match(/mean_volume: (-?[\d.]+) dB/);const db=match?Number(match[1]):-60,prev=s.db;s.db=db;s.levels.push({time:seg.end,db});s.levels=s.levels.slice(-60);s.elapsed=seg.end;
 if(s.settings.auto&&shouldTrigger(db,prev,seg.end,s.lastTrigger,s.settings.threshold)){s.lastTrigger=seg.end;try{createClip(s,'Audio peak');}catch(e){log(e.message);}}
 // Preview is a real frame from the latest completed segment.
 await run(['-y','-v','error','-i',path.join(s.dir,seg.name),'-frames:v','1','-vf','scale=720:-2',path.join(s.dir,'preview-next.jpg')]).then(()=>fs.rename(path.join(s.dir,'preview-next.jpg'),path.join(s.dir,'preview.jpg'))).catch(()=>{});
}
function createClip(s,reason) {
 if(s.elapsed<2)throw new Error('Wait for the first two seconds of buffered video');
 if(clips.filter(c=>['collecting','queued','rendering'].includes(c.status)).length>=8)throw new Error('Export queue is full; wait for a clip to finish');
 const c={id:randomUUID(),number:Math.max(0,...clips.map(x=>x.number||0))+1,session:s.id,meta:s.meta||null,title:s.settings.hook||`${s.settings.style==='reaction'?'Reaction':'Cinematic'} moment`,style:s.settings.style,settings:{...s.settings},reason,start:Math.max(s.segments[0]?.start||0,s.elapsed-s.settings.pre),end:s.elapsed+(s.proc?s.settings.post:0),status:'collecting',created:Date.now()};clips.unshift(c);s.pending.push(c);save();log(`${reason}: collecting the ending`);if(!s.proc){s.pending.pop();enqueue(s,c);}return c;
}
async function enqueue(s,c) {
 const chosen=selectSegments(s.segments,c.start,Math.min(c.end,s.elapsed));
 if(!chosen.length){c.status='failed';c.error='No buffered footage';await save();return;}
 const dir=path.join(data,c.id);await fs.mkdir(dir,{recursive:true});
 try{for(const seg of chosen)await fs.copyFile(path.join(s.dir,seg.name),path.join(dir,seg.name));}catch(e){c.status='failed';c.error=e.message;await save();return;}
 c.end=Math.min(c.end,s.elapsed);c.duration=c.end-c.start;c.status='queued';await save();
 queue=queue.then(()=>render(c,dir,chosen)).catch(e=>log(e.message));
}
async function render(c,dir,chosen) {
 c.status='rendering';await save();
 try {
 await fs.writeFile(path.join(dir,'input.txt'),chosen.map(x=>`file '${x.name}'`).join('\n'));
 let filter=videoFilter(c.style,c.settings.split,c.settings);let overlayArgs=[];
 if(c.settings.hook) {
  const words=c.settings.hook.split(/\s+/),lines=[''];for(const word of words){if((lines.at(-1)+' '+word).length>24&&lines.length<4)lines.push(word);else lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}
  const svg=`<svg width="1080" height="1920" viewBox="0 0 540 960" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:${c.style==='cinematic'?'Georgia':'Arial'};font-weight:bold;font-size:34px;}</style>${lines.map((l,i)=>`<text x="270" y="${c.style==='cinematic'?360+i*42:90+i*40}" text-anchor="middle" fill="${c.style==='cinematic'?'#ecd6ad':'white'}" stroke="#111" stroke-width="5" paint-order="stroke">${escapeXML(l)}</text>`).join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(dir,'hook.png'));overlayArgs=['-i',path.join(dir,'hook.png')];filter+=';[base][1:v]overlay=0:0[out]';
 }else filter+=';[base]null[out]';
 await run(['-y','-v','error','-f','concat','-safe','0','-i',path.join(dir,'input.txt'),...overlayArgs,'-ss',String(Math.max(0,c.start-chosen[0].start)),'-t',String(c.duration),'-filter_complex',filter,'-map','[out]','-map','0:a:0?','-c:v','libx264','-preset','medium','-crf','16','-pix_fmt','yuv420p','-c:a','aac','-b:a','320k','-af','alimiter=limit=0.95','-movflags','+faststart',path.join(dir,'uncaptioned.mp4')]);
 c.stage='Transcribing speech';await save();
 if(c.settings.captions!==false){c.captions=await addCaptions(path.join(dir,'uncaptioned.mp4'),path.join(dir,'clip.mp4'),dir);}else await fs.copyFile(path.join(dir,'uncaptioned.mp4'),path.join(dir,'clip.mp4'));
 await fs.rm(path.join(dir,'uncaptioned.mp4'),{force:true});c.stage=null;
 await run(['-y','-v','error','-i',path.join(dir,'clip.mp4'),'-frames:v','1',path.join(dir,'poster.jpg')]);
 c.status='ready';c.url=`/data/${c.id}/clip.mp4`;c.poster=`/data/${c.id}/poster.jpg`;log(`${c.title} is ready`);
 await writeCaption(c,dir);
 if((await publish.publishConfig()).auto)queueUpload(c);
 }catch(e){c.status='failed';c.error=e.message;log('An export failed; see clip details');}
 finally{for(const seg of chosen)await fs.rm(path.join(dir,seg.name),{force:true});await save();}
}
setInterval(()=>{if(session)scan(session);},1000);
export function captionFileText(cap){return [cap.title||'','','--- DESCRIPTION ---','',cap.description||'','','--- TAGS ---','',(cap.tags||[]).join(', '),''].join('\n');}
const readLocal=async(dir,name)=>{try{return JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));}catch{return null;}};
async function writeCaption(c,dir){
 try{const phrases=await readLocal(dir,'captions.json'),transcript=await readLocal(dir,'transcript.json');
 c.caption=buildCaption({stream:c.meta||{},clip:c,phrases:phrases||[],words:transcript?.words||[]});
 // Written beside the MP4 so the wording outlives the page, and travels with the clip.
 await fs.writeFile(path.join(dir,'caption.txt'),captionFileText(c.caption));
 c.captionFile=`/data/${c.id}/caption.txt`;}
 catch(e){c.caption=null;c.captionFile=null;log('Caption could not be generated: '+e.message);}
}
let uploads=Promise.resolve();
function queueUpload(c,overrides){uploads=uploads.then(()=>sendToYouTube(c,overrides)).catch(e=>log(e.message));return uploads;}
async function sendToYouTube(c,overrides={}){
 if(c.status!=='ready')throw new Error('That clip has not finished exporting');
 const config=await publish.publishConfig();
 // Rebuild from the clip's own transcript so an upload always carries the current caption.
 await writeCaption(c,path.join(data,c.id));
 const caption=c.caption||{};
 c.upload={status:'uploading'};await save();
 try{
  const sent=await publish.uploadClip({file:path.join(data,c.id,'clip.mp4'),title:overrides.title||caption.title||c.title,
   description:overrides.description!==undefined?overrides.description:(caption.description||''),tags:caption.tags||[],
   privacy:['private','unlisted','public'].includes(overrides.privacy)?overrides.privacy:config.privacy,categories:c.meta?.categories||[]});
  c.upload={status:'done',id:sent.id,url:sent.url,privacy:sent.privacy,at:Date.now()};
  log(`Uploaded to YouTube as ${sent.privacy}`);
 }catch(e){c.upload={status:'failed',error:e.message};log('YouTube upload failed; see the clip for details');}
 await save();
}
let publishCache={at:0,value:{configured:false,connected:false,channel:'',auto:false,privacy:'private'}};
const forgetPublishStatus=()=>{publishCache.at=0;};
async function publishStatus(){if(Date.now()-publishCache.at<4000)return publishCache.value;publishCache={at:Date.now(),value:await publish.status()};return publishCache.value;}
const scheme=req=>((req.headers['x-forwarded-proto']||'').split(',')[0].trim()||'http');
const redirectURI=req=>`${scheme(req)}://${req.headers.host}/oauth/callback`;
const signedIn=req=>!password||verifyToken(secret,readCookie(req.headers.cookie,COOKIE));
function state(){const s=session;return{session:s?{id:s.id,status:s.status,sourceName:s.sourceName,elapsed:s.elapsed,buffer:s.segments.length?s.elapsed-s.segments[0].start:0,db:s.db,levels:s.levels,settings:s.settings,error:s.error,stream:s.meta?{title:s.meta.title,channel:s.meta.channel,tags:s.meta.tags.length}:null,preview:`/data/${s.id}/preview.jpg`,playlist:`/data/${s.id}/live.m3u8`}:null,clips:clips.map(({meta,...rest})=>rest),events};}
async function body(req){let result='';for await(const chunk of req){result+=chunk;if(result.length>16000)throw new Error('Request too large');}return JSON.parse(result||'{}');}
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.mp4':'video/mp4','.ts':'video/mp2t','.m3u8':'application/vnd.apple.mpegurl','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');
 const origin=req.headers.origin;
 // The uploader reads from two places: its own popup, and the Studio page it runs in. Extension
 // origins can read this server through their service worker whatever CORS says, so allowing the
 // read here gives nothing away; web pages other than Studio still get nothing.
 const extensionOrigin=typeof origin==='string'&&origin.startsWith('chrome-extension://');
 if(origin==='https://studio.youtube.com'||extensionOrigin){
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET','Access-Control-Max-Age':'600'});res.end();return;}
  if(req.method!=='GET'){res.writeHead(405,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Read-only from the browser extension'}));return;}
 }
 if(password&&!isOpenPath(url.pathname)&&!signedIn(req)){
  if(url.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Sign in again'}));return;}
  res.writeHead(302,{Location:'/login'});res.end();return;
 }
 if(url.pathname==='/login'){
  if(!password||signedIn(req)){res.writeHead(302,{Location:'/'});res.end();return;}
  const page=await fs.readFile(path.join(root,'public/login.html'));
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page);return;
 }
 if(req.method==='POST'){
  if(origin&&origin!==`${scheme(req)}://${req.headers.host}`&&origin!==`http://${req.headers.host}`)throw new Error('Cross-origin request rejected');
  const b=await body(req);let result={ok:true};
  if(url.pathname==='/api/login'){
   const who=req.socket.remoteAddress||'unknown';
   if(!password)throw new Error('This desk has no password set');
   if(tooManyAttempts(who))throw new Error('Too many attempts. Wait ten minutes.');
   if(!passwordMatches(password,b.password)){recordAttempt(who);throw new Error('That password is not right');}
   clearAttempts(who);
   res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':cookieHeader(issue(secret),scheme(req)==='https')});
   res.end(JSON.stringify({ok:true}));return;
  }
  else if(url.pathname==='/api/logout'){res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`});res.end(JSON.stringify({ok:true}));return;}
  else if(url.pathname==='/api/start'){if(starting)throw new Error('A connection is already in progress');starting=true;try{result=await start(b);}finally{starting=false;}}
  else if(url.pathname==='/api/stop'){if(session?.proc){session.stopping=true;session.proc.kill('SIGINT');}}
  else if(url.pathname==='/api/settings'){if(!session)throw new Error('Start a source first');session.settings=validateSettings(b);}
  else if(url.pathname==='/api/clip'){if(!session)throw new Error('Start a source first');result=createClip(session,'Manual mark');}
  else if(url.pathname==='/api/youtube/connect'){result={url:await publish.authUrl(redirectURI(req))};}
  else if(url.pathname==='/api/youtube/disconnect'){await publish.disconnect();forgetPublishStatus();log('YouTube Studio disconnected');}
  else if(url.pathname==='/api/youtube/config'){result=await publish.setPublishConfig(b);forgetPublishStatus();}
  else if(url.pathname==='/api/youtube/upload'){const c=clips.find(x=>x.id===b.id);if(!c)throw new Error('Unknown clip');if(c.upload?.status==='uploading')throw new Error('That clip is already uploading');queueUpload(c,b);}
  else throw new Error('Unknown endpoint');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
 }
 if(url.pathname==='/oauth/callback'){
  try{const failure=url.searchParams.get('error');if(failure)throw new Error('Google returned: '+failure);
   await publish.completeAuth(url.searchParams.get('code'),url.searchParams.get('state'),redirectURI(req));
   forgetPublishStatus();log('YouTube Studio connected');
   res.writeHead(302,{Location:'/'});res.end();return;
  }catch(e){res.writeHead(400,{'Content-Type':'text/html; charset=utf-8'});res.end(`<body style="font:14px system-ui;background:#10120f;color:#eff1e8;padding:40px"><h1>Could not connect</h1><p>${escapeXML(e.message)}</p><p><a style="color:#d2f86a" href="/">Back to Clipcrow</a></p></body>`);return;}
 }
 if(url.pathname==='/api/state'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({...state(),youtube:await publishStatus()}));return;}
 const media=url.pathname.startsWith('/data/');
 const base=media?data:root;
 let filename=url.pathname==='/vendor/hls.js'?path.join(root,'node_modules/hls.js/dist/hls.min.js')
  :media?path.resolve(data,decodeURIComponent(url.pathname).slice('/data/'.length))
  :path.resolve(root,'public/'+(url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1)));
 if(!filename.startsWith(base+path.sep))throw new Error('Invalid path');
 // Never expose arbitrary capture metadata or concat manifests.
 if(url.pathname.startsWith('/data/')&&!/^\/data\/[a-f0-9-]+\/(clip\.mp4|caption\.txt|poster\.jpg|preview\.jpg|live\.m3u8|part\d+\.ts)$/.test(url.pathname))throw new Error('Invalid media path');
 const stat=await fs.stat(filename),headers={'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache'};
 if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416);res.end();return;}const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;if(start>end||start>=stat.size){res.writeHead(416);res.end();return;}res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});createReadStream(filename,{start,end}).pipe(res);}
 else{res.writeHead(200,{...headers,'Content-Length':stat.size});createReadStream(filename).pipe(res);}
 }catch(e){res.writeHead(e.code==='ENOENT'?404:400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
server.listen(Number(process.env.PORT||4317),host,()=>console.log(`Clipcrow → http://${host}:${process.env.PORT||4317}${password?' (password protected)':''}`));
process.on('SIGINT',()=>{session?.proc?.kill('SIGINT');server.close();process.exit(0);});

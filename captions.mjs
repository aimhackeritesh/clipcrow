import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {escapeXML} from './engine.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
function execute(bin,args){return new Promise((resolve,reject)=>{const p=spawn(bin,args);let error='';p.stderr.on('data',d=>error=(error+d).slice(-3000));p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error(error)));});}
export function captionPhrases(words){
 const groups=[];let group=[];
 const flush=()=>{if(group.length)groups.push(group);group=[];};
 for(const w of words){if(w.end<=w.start)continue;if(group.length&&(w.start-group.at(-1).end>.3||group.length>=2||[...group.map(x=>x.text),w.text].join(' ').length>16))flush();group.push(w);if(/[.!?]$/.test(w.text))flush();}flush();
 return groups.flatMap(g=>g.map((w,i)=>({text:g.map(x=>x.text).join(' ').toUpperCase(),words:g.map(x=>x.text.toUpperCase()),active:i,start:w.start,end:i<g.length-1?Math.min(g[i+1].start,w.end+.12):w.end})));
}
export function captionSVG(p,pop=false){
 const size=Math.min(72,Math.floor(460/(Math.max(1,p.text.length)*.60)))*(pop?1.10:1);
 const spans=p.words.map((word,i)=>`<tspan fill="${i===p.active?'#e5ff35':'#ffffff'}">${escapeXML(word)}${i<p.words.length-1?' ':''}</tspan>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="320" viewBox="0 0 540 160" xml:space="preserve"><g transform="translate(270 80) rotate(-2) translate(-270 -80)"><text x="270" y="106" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-weight="900" font-size="${size}" letter-spacing="-1" fill="#080808" stroke="#080808" stroke-width="12" stroke-linejoin="round">${escapeXML(p.text)}</text><text x="270" y="100" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-weight="900" font-size="${size}" letter-spacing="-1" stroke="#080808" stroke-width="8" stroke-linejoin="round" paint-order="stroke">${spans}</text></g></svg>`;
}
export async function addCaptions(input,output,dir){
 const wav=path.join(dir,'speech.wav'),json=path.join(dir,'transcript.json');
 await execute('ffmpeg',['-y','-v','error','-i',input,'-vn','-ac','1','-ar','16000',wav]);
 await execute(process.env.PYTHON_PATH||path.join(root,'.venv/bin/python'),[path.join(root,'scripts/transcribe.py'),wav,json]);
 const transcript=JSON.parse(await fs.readFile(json,'utf8'));const phrases=captionPhrases(transcript.words);
 await fs.writeFile(path.join(dir,'captions.json'),JSON.stringify(phrases,null,2));
 if(!phrases.length){await fs.copyFile(input,output);return {count:0,language:transcript.language};}
 const blank=path.join(dir,'caption-blank.png');await sharp({create:{width:1080,height:320,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toFile(blank);
 const sequence=[];const generated=[blank];let cursor=0;
 const push=(file,duration)=>{if(duration>0)sequence.push(`file '${file}'\nduration ${duration.toFixed(4)}`);};
 for(let i=0;i<phrases.length;i++){
  const p=phrases[i];if(p.start>cursor)push('caption-blank.png',p.start-cursor);
  const start=Math.max(cursor,p.start),length=p.end-start;if(length<=0)continue;
  const popName=`caption-${i}-pop.png`,name=`caption-${i}.png`;
  for(const [file,pop] of [[popName,true],[name,false]]){const png=path.join(dir,file);await sharp(Buffer.from(captionSVG(p,pop))).png().toFile(png);generated.push(png);}
  const popDuration=Math.min(.075,length);push(popName,popDuration);push(name,length-popDuration);cursor=p.end;
 }
 // End in a transparent frame, so the final word never sticks on screen.
 push('caption-blank.png',1);sequence.push("file 'caption-blank.png'");
 const sequenceFile=path.join(dir,'caption-timeline.txt'),movie=path.join(dir,'caption-track.mov');
 await fs.writeFile(sequenceFile,sequence.join('\n'));
 await execute('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',sequenceFile,'-vf','fps=30,format=argb','-c:v','qtrle',movie]);
 await execute('ffmpeg',['-y','-v','error','-i',input,'-i',movie,'-filter_complex','[0:v][1:v]overlay=0:1010:eof_action=pass:repeatlast=0[out]','-map','[out]','-map','0:a:0','-c:v','libx264','-preset','medium','-crf','16','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output]);
 await fs.rm(wav,{force:true});for(const file of [...generated,movie,sequenceFile])await fs.rm(file,{force:true});
 return {count:phrases.length,language:transcript.language};
}

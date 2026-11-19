export function validateSettings(body = {}) {
  const number = (key, fallback, min, max) => {
    const v = body[key] === undefined ? fallback : Number(body[key]);
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${key} must be between ${min} and ${max}`);
    return v;
  };
  if (body.style && !['reaction','cinematic'].includes(body.style)) throw new Error('Unknown style');
  return {style:body.style || 'reaction', pre:number('pre',12,2,40), post:number('post',6,0,20), threshold:number('threshold',-16,-50,0), auto:body.auto === true, hook:String(body.hook || '').slice(0,100), captions:body.captions !== false, split:body.split !== false, faceX:number('faceX',0,0,95), faceY:number('faceY',43,0,95), faceW:number('faceW',20,5,100), faceH:number('faceH',23,5,100)};
}
export function selectSegments(segments, start, end) { return segments.filter(s => s.end > start && s.start < end); }
export function shouldTrigger(db, previous, time, last, threshold) { return db > threshold && db > previous + 3 && time - last >= 25; }
export function escapeXML(s) { return s.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
export function videoFilter(style, split, settings = {}) {
  const x=Number(settings.faceX ?? 0)/100,y=Number(settings.faceY ?? 43)/100;
  const w=Math.min(Number(settings.faceW ?? 20)/100,1-x),h=Math.min(Number(settings.faceH ?? 23)/100,1-y);
  if (style === 'reaction' && split) return `[0:v]split=2[cam][game];[cam]crop=iw*${w}:ih*${h}:iw*${x}:ih*${y},scale=1080:800:flags=lanczos:force_original_aspect_ratio=increase,crop=1080:800[top];[game]scale=1080:1120:flags=lanczos:force_original_aspect_ratio=increase,crop=1080:1120[bottom];[top][bottom]vstack,setsar=1[base]`;
  return `[0:v]scale=1080:1920:flags=lanczos:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${style === 'cinematic' ? ',eq=contrast=1.12:saturation=0.82:brightness=-0.02,colorbalance=rs=.04:bs=-.03,unsharp=3:3:0.35' : ''}[base]`;
}

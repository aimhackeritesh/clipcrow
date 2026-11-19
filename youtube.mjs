// Prefer the best available video and audio, with combined-stream fallbacks.
export const youtubeFormat = 'bestvideo+bestaudio/best[protocol*=m3u8]/best';
export function youtubeInputs(info) {
 const tracks=info.requested_formats || [info];
 const video=tracks.find(f=>f.vcodec && f.vcodec!=='none');
 const audio=tracks.find(f=>f.acodec!=='none' && (f.acodec || f.vcodec==='none'));
 if(!video?.url || !audio?.url) throw new Error('YouTube did not provide usable video and audio tracks');
 for(const track of [video,audio]) if(!/^https?:\/\//.test(track.url)) throw new Error('Unsupported YouTube media URL');
 return {video:video.url,audio:audio.url===video.url?null:audio.url};
}
export function captureInputs(source,audio,remote) {
 const options=remote?['-rw_timeout','15000000']:['-re'];
 return [...options,'-i',source,...(audio?['-rw_timeout','15000000','-i',audio]:[]),'-map','0:v:0','-map',audio?'1:a:0':'0:a:0?'];
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeInputs,captureInputs} from '../youtube.mjs';
test('separate YouTube video and audio tracks map to different inputs',()=>{
 const media=youtubeInputs({requested_formats:[{url:'https://media/video',vcodec:'avc1',acodec:'none'},{url:'https://media/audio',vcodec:'none',acodec:'mp4a'}]});
 assert.deepEqual(media,{video:'https://media/video',audio:'https://media/audio'});
 assert.deepEqual(captureInputs(media.video,media.audio,true),['-rw_timeout','15000000','-i',media.video,'-rw_timeout','15000000','-i',media.audio,'-map','0:v:0','-map','1:a:0']);
});
test('combined streams keep a single input',()=>assert.deepEqual(youtubeInputs({url:'https://media/combined',vcodec:'avc1',acodec:'aac'}),{video:'https://media/combined',audio:null}));
test('missing audio fails explicitly instead of silently dropping sound',()=>assert.throws(()=>youtubeInputs({url:'https://media/video',vcodec:'avc1',acodec:'none'}),/video and audio/));

test('HLS audio-only tracks may omit the codec name',()=>assert.deepEqual(youtubeInputs({requested_formats:[{url:'https://m/v',vcodec:'avc1',acodec:'none'},{url:'https://m/a',vcodec:'none'}]}),{video:'https://m/v',audio:'https://m/a'}));

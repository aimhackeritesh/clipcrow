import test from 'node:test';import assert from 'node:assert/strict';import {captionPhrases,captionSVG} from '../captions.mjs';
test('two-word bursts highlight the spoken word without crossing pauses',()=>{const p=captionPhrases([{text:'There',start:0,end:.2},{text:'is',start:.2,end:.3},{text:'what?',start:.3,end:.7},{text:'Drake',start:1.5,end:2}]);assert.deepEqual(p.map(x=>[x.text,x.active,x.start,x.end]),[['THERE IS',0,0,.2],['THERE IS',1,.2,.3],['WHAT?',0,.3,.7],['DRAKE',0,1.5,2]]);});
test('silent audio produces no invented captions',()=>assert.deepEqual(captionPhrases([]),[]));
test('highlighted captions escape transcript markup',()=>{assert.match(captionSVG({text:'<HI>',words:['<HI>'],active:0}),/&lt;HI&gt;/);assert.match(captionSVG({text:'HI',words:['HI'],active:0}),/#e5ff35/);});

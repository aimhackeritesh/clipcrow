import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings,selectSegments,shouldTrigger,escapeXML} from '../engine.mjs';
test('reject unsafe duration, threshold and style values',()=>{for(const b of [{pre:NaN},{post:90},{threshold:1},{style:'bad'}])assert.throws(()=>validateSettings(b));});
test('only include overlapping segments, preserving the pre-roll boundary',()=>{assert.deepEqual(selectSegments([{start:0,end:2},{start:2,end:4},{start:4,end:6}],2,4),[{start:2,end:4}]);});
test('audio triggers require threshold, rise and cooldown',()=>{assert.equal(shouldTrigger(-10,-20,30,0,-16),true);assert.equal(shouldTrigger(-10,-20,10,0,-16),false);assert.equal(shouldTrigger(-10,-11,30,0,-16),false);assert.equal(shouldTrigger(-30,-40,30,0,-16),false);});
test('hook text is escaped as SVG data',()=>assert.equal(escapeXML('<x>&'), '&lt;x&gt;&amp;'));

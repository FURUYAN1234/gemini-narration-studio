import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSubtitleCues,captionAtFrame} from '../subtitles.mjs';
function audio(){const rate=1000,b=Buffer.alloc(44+rate*6*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);for(let i=0;i<rate*6;i++)b.writeInt16LE(i>=2800&&i<3200?0:1000,44+i*2);return b;}
test('two sentences switch around the recorded pause, keep exact text, and never show the whole cut',()=>{
 const cues=buildSubtitleCues({caption:'最初の説明。次の説明。',speech:'さいしょのせつめい。つぎのせつめい。',bytes:audio(),fps:30,frames:180});
 assert.equal(cues.length,2);assert.deepEqual(cues.map(c=>c.text),['最初の説明。','次の説明。']);assert.ok(cues[1].from>=84&&cues[1].from<=96);assert.equal(cues[0].to,cues[1].from);assert.equal(cues[1].to,180);
 assert.equal(captionAtFrame({caption:'全文',subtitles:cues},0),'最初の説明。');assert.equal(captionAtFrame({subtitles:cues},cues[1].from),'次の説明。');assert.equal(captionAtFrame({subtitles:cues},180),'');
});
test('continuous speech still has bounded sentence cues, using reading lengths rather than equal durations',()=>{
 const bytes=audio();for(let i=44;i<bytes.length;i+=2)bytes.writeInt16LE(1000,i);
 const cues=buildSubtitleCues({caption:'短い。長めの文章です。',speech:'みじかい。ながめのぶんしょうです。',bytes,fps:30,frames:180});assert.equal(cues.length,2);assert.ok(cues[1].from<90);assert.equal(cues.map(c=>c.text).join(''),'短い。長めの文章です。');
});
test('single sentence and legacy slides remain supported, malformed timing/audio cannot silently pass',()=>{
 assert.equal(buildSubtitleCues({caption:'一文。',speech:'いちぶん。',bytes:audio(),fps:30,frames:180}).length,1);assert.equal(captionAtFrame({caption:'旧版。'},10),'旧版。');
 assert.throws(()=>buildSubtitleCues({caption:'字幕',speech:'よみ',bytes:Buffer.from('bad'),fps:30,frames:180}),/WAV/);assert.throws(()=>buildSubtitleCues({caption:'字幕',speech:'よみ',bytes:audio(),fps:0,frames:0}),/TIMING/);
});

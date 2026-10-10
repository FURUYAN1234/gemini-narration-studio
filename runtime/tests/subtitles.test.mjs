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


test('subtitle wrapping balances long sentences instead of leaving a tiny verb ending',async()=>{
 const {fitSubtitleText}=await import('../subtitles.mjs');
 for(const text of ['コスト削減の一方で、無限ループなどの不満が増え、複雑な対応を迫られる人間の負担が増加しています。','窓を開ける前に周囲の安全を確認し、道具をそろえてから順番に作業を進めると、落ち着いて掃除ができます。'])for(const width of [1630,1700]){
  const fit=fitSubtitleText(text,{width});
  assert.equal(fit.lines.join(''),text);assert.ok(fit.lines.length<=2);
  if(width===1630)assert.equal(fit.lines.length,2);
  assert.ok(fit.lines.every(line=>[...line].length>=15),JSON.stringify(fit));
  assert.ok(fit.lines.every(line=>!/^[、。）」]/.test(line)));
  assert.ok(fit.lines.length*fit.size*1.35<=128);
 }
});
test('subtitle fitting preserves short text, explicit line breaks and bounded multilingual text',async()=>{
 const {fitSubtitleText}=await import('../subtitles.mjs');
 assert.deepEqual(fitSubtitleText('短い説明。').lines,['短い説明。']);
 for(const text of ['一行目。\n二行目。','API setup: Install Node.js, then launch the application. 手順を確認してください。','長い文章、'.repeat(80)+'終わり。']){
  const fit=fitSubtitleText(text);assert.equal(fit.lines.join(''),text);
  assert.ok(fit.lines.length*fit.size*1.35<=128);
  assert.ok(fit.lines.every(line=>[...line].reduce((n,c)=>n+(/[\x20-\x7e]/.test(c)?.6:c==='\n'?0:1),0)*fit.size<=1700));
 }
 assert.throws(()=>fitSubtitleText('字幕',{width:0}),/INVALID_MOTION_TEXT/);
});

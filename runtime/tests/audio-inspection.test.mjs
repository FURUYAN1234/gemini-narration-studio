import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {analyzePcm,pcmWav,validateInspectionInput,normalizeInspectionResult,inspectAudioFile,requestStudioInspection} from '../audio-inspection.mjs';
import {NarrationSession} from '../core.mjs';
import {startServer} from '../server.mjs';
import {ProductionInputs} from '../production.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const sha=b=>createHash('sha256').update(b).digest('hex');
const tone=(seconds=1,channels=1)=>{const b=Buffer.alloc(16000*seconds*channels*2);for(let i=0;i<b.length/2;i++)b.writeInt16LE(Math.round(Math.sin(Math.floor(i/channels)*2*Math.PI*440/16000)*6000)*(i%channels===1?-1:1),i*2);return b;};
const input=()=>{const b=pcmWav(tone(),16000,1);return {consent:true,audioBase64:b.toString('base64'),audioSha256:sha(b),expectedText:'こんにちは。',sessionId:'test'};};
const result=()=>({transcript:'こんにちは。',checks:{content:'checked',pronunciation:'checked',delivery:'checked',noise:'checked'},findings:[]});
async function folder(t){const d=await mkdtemp(path.join(tmpdir(),'audio-inspection-test-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}

test('normal speech-level signal and short pauses remain allowed; silence is rejected',()=>{
  const ok=analyzePcm(Buffer.concat([tone(),Buffer.alloc(3200),tone()]),16000,1);
  assert.equal(ok.status,'pass');assert.equal(ok.findings.length,0);assert.ok(ok.rmsDbfs<0);assert.equal(ok.durationSeconds,2.1);
  assert.equal(analyzePcm(Buffer.alloc(32000),16000,1).status,'failed');
});
test('stereo opposite-phase audio is not falsely classified silent; brief peaks do not prove clipping',()=>{
  assert.equal(analyzePcm(tone(1,2),16000,2).status,'pass');
  const b=tone();b.writeInt16LE(32767,0);assert.ok(!analyzePcm(b,16000,1).findings.some(x=>x.kind==='clipping'));
  const clipped=Buffer.alloc(32000);for(let i=0;i<16000;i++)clipped.writeInt16LE(i%20<10?32767:-32768,i*2);
  assert.ok(analyzePcm(clipped,16000,1).findings.some(x=>x.kind==='clipping'));
});
test('semantic input requires exact consent, validated WAV and matching hash',()=>{
  assert.equal(validateInspectionInput(input()).durationSeconds,1);
  for(const consent of [false,undefined,'true'])assert.throws(()=>validateInspectionInput({...input(),consent}),/INSPECTION_CONSENT_REQUIRED/);
  assert.throws(()=>validateInspectionInput({...input(),audioSha256:'0'.repeat(64)}),/AUDIO_HASH_MISMATCH/);
  assert.throws(()=>validateInspectionInput({...input(),audioBase64:Buffer.from('not WAV').toString('base64')}),/INVALID_INSPECTION_AUDIO/);
  const b=pcmWav(Buffer.alloc(32000),16000,1);assert.throws(()=>validateInspectionInput({...input(),audioBase64:b.toString('base64'),audioSha256:sha(b)}),/SILENT_AUDIO/);
});
test('longer complete audio remains valid and incomplete base64 is refused',()=>{
  const b=pcmWav(tone(300),16000,1),i={...input(),audioBase64:b.toString('base64'),audioSha256:sha(b)};
  assert.equal(validateInspectionInput(i).durationSeconds,300);
  assert.throws(()=>validateInspectionInput({...i,audioBase64:i.audioBase64.slice(1)}),/INVALID_INSPECTION_AUDIO/);
});
test('material failures require attention; harmless variation never becomes automatic regeneration',()=>{
  const ctx=validateInspectionInput(input());assert.equal(normalizeInspectionResult(result(),ctx).verdict,'no_material_issue');
  const finding={kind:'pronunciation',severity:'minor',startSeconds:0,endSeconds:.5,detail:'自然な地域差',expected:'',heard:''};
  assert.equal(normalizeInspectionResult({...result(),findings:[finding]},ctx).verdict,'no_material_issue');
  assert.equal(normalizeInspectionResult({...result(),findings:[{...finding,severity:'material'}]},ctx).verdict,'needs_review');
  assert.equal(normalizeInspectionResult({...result(),checks:{...result().checks,pronunciation:'uncertain'}},ctx).verdict,'uncertain');
  assert.throws(()=>normalizeInspectionResult({...result(),findings:[{...finding,endSeconds:2}]},ctx),/INVALID_INSPECTION_RESULT/);
  assert.throws(()=>normalizeInspectionResult({transcript:'',checks:{},findings:[]},ctx),/INVALID_INSPECTION_RESULT/);
});
test('real FFmpeg decode is read-only and detects damaged audio; missing dependency fails closed',async t=>{
  const d=await folder(t),f=path.join(d,'音声.wav'),b=pcmWav(tone(),16000,1);await writeFile(f,b);
  const r=await inspectAudioFile(f);assert.equal(r.technical.status,'pass');assert.equal(r.semantic.status,'not_run');assert.equal(r.source.sha256,sha(b));assert.equal(sha(await readFile(f)),sha(b));
  await assert.rejects(inspectAudioFile(f,{ffmpeg:path.join(d,'missing.exe')}),/FFMPEG_REQUIRED/);
  await writeFile(f,b.subarray(0,55));await assert.rejects(inspectAudioFile(f),/AUDIO_DECODE_FAILED/);
});
test('HTTP semantic inspection rejects unauthorized requests, uses one provider call and leaves job untouched',async t=>{
  const d=await folder(t),s=await NarrationSession.open({outputDir:d});s.setKey('test-only-key');
  const service=await startServer({session:s,port:0});t.after(()=>service.close());
  const boot=await (await fetch(service.url+'/api/bootstrap')).json();
  const post=(value,headers={})=>fetch(service.url+'/api/audio-inspect',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token,...headers},body:JSON.stringify({...value,sessionId:s.status().sessionId})});
  assert.equal((await post(input(),{Origin:'https://evil.example'})).status,403);
  assert.equal((await post(input(),{'X-Narration-Token':''})).status,403);
  let calls=0;const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://generativelanguage.googleapis.com/')){calls++;assert.match(String(url),/gemini-3.8-flash:generateContent$/);const payload=JSON.parse(options.body);assert.equal(payload.contents[0].parts[0].inlineData.mimeType,'audio/wav');return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result())}]}}]}));}return original(url,options);};
  const before=JSON.stringify(s.job);assert.equal((await post({...input(),consent:false})).status,409);assert.equal(calls,0);
  const response=await post(input());assert.equal(response.status,200);assert.equal((await response.json()).verdict,'no_material_issue');assert.equal(calls,1);assert.equal(JSON.stringify(s.job),before);assert.equal(s.busy,false);
  const client=await requestStudioInspection(input(),{url:service.url,consent:true});assert.equal(client.verdict,'no_material_issue');assert.equal(calls,2);
  const file=path.join(d,'input.wav'),expected=path.join(d,'expected.txt'),report=path.join(d,'semantic.json');await writeFile(file,pcmWav(tone(),16000,1));await writeFile(expected,'こんにちは。');
  const cli=new URL('../inspect-audio.mjs',import.meta.url);const executed=await promisify(execFile)(process.execPath,[cli.pathname.replace(/^\/(\w:)/,'$1'),'--audio',file,'--expected',expected,'--out',report,'--semantic','--allow-paid','--url',service.url]);
  assert.deepEqual(JSON.parse(executed.stdout).apiUi,{required:true,view:'result',report});
  assert.equal(JSON.parse(await readFile(report,'utf8')).semantic.verdict,'no_material_issue');assert.equal(calls,3);assert.equal(JSON.stringify(s.job),before);
  globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://generativelanguage.googleapis.com/')){calls++;return new Response(JSON.stringify({error:{message:'test-only-key'}}),{status:429});}return original(url,options);};
  const fail=await post(input());assert.equal(fail.status,409);assert.ok(!(await fail.text()).includes('test-only-key'));assert.equal(calls,4);assert.equal(JSON.stringify(s.job),before);
  globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://generativelanguage.googleapis.com/')){calls++;return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...result(),transcript:'test-only-key'})}]}}]}));}return original(url,options);};
  const leaked=await post(input());assert.equal(leaked.status,409);assert.ok(!(await leaked.text()).includes('test-only-key'));assert.equal(calls,5);
});
test('client never calls server without explicit paid consent and forbids remote/redirect URLs',async()=>{
  let calls=0;const transport=async()=>{calls++;throw new Error('unexpected');};
  await assert.rejects(requestStudioInspection(input(),{consent:false,fetchImpl:transport}),/INSPECTION_CONSENT_REQUIRED/);
  await assert.rejects(requestStudioInspection(input(),{consent:true,url:'https://example.com',fetchImpl:transport}),/LOCAL_STUDIO_REQUIRED/);
  assert.equal(calls,0);
});
test('read-only inspection allows sealed projects but rejects stale session, missing key and busy operations',async t=>{
  const d=await folder(t),s=await NarrationSession.open({outputDir:d});await s.setPresentation({theme:'moon'});
  const production=await ProductionInputs.open(d);production.value.finalization={revision:'a'.repeat(64),inputsHash:'b'.repeat(64)};
  await writeFile(path.join(d,'production.json'),JSON.stringify(production.status()));
  const service=await startServer({session:s,port:0});t.after(()=>service.close());
  const boot=await (await fetch(service.url+'/api/bootstrap')).json();
  const post=body=>fetch(service.url+'/api/audio-inspect',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token},body:JSON.stringify(body)});
  assert.equal((await (await post({...input(),sessionId:s.status().sessionId})).json()).error,'API_KEY_REQUIRED');
  assert.equal((await (await post({...input(),sessionId:'other'})).json()).error,'SESSION_MISMATCH');
  s.setKey('test-only-key');s.busy=true;
  assert.equal((await (await post({...input(),sessionId:s.status().sessionId})).json()).error,'BUSY');s.busy=false;
  // Invalid audio reaches its validation boundary, proving the sealed-project
  // writable gate was not invoked by this read-only endpoint.
  assert.equal((await (await post({...input(),sessionId:s.status().sessionId,audioSha256:'0'.repeat(64)})).json()).error,'AUDIO_HASH_MISMATCH');
  assert.equal((await (await fetch(service.url+'/api/status')).json()).audioInspection.available,true);
});
test('CLI runs without API, preserves source/report and rejects paid mode without authorization',async t=>{
  const d=await folder(t),f=path.join(d,'audio.wav'),out=path.join(d,'report.json'),b=pcmWav(tone(),16000,1);await writeFile(f,b);
  const cli=new URL('../inspect-audio.mjs',import.meta.url),exec=promisify(execFile);
  const args=[cli.pathname.replace(/^\/(\w:)/,'$1'),'--audio',f,'--out',out];
  const executed=await exec(process.execPath,args);assert.deepEqual(JSON.parse(executed.stdout).apiUi,{required:false,view:'none'});const r=JSON.parse(await readFile(out,'utf8'));assert.equal(r.semantic.status,'not_run');assert.equal(r.source.sha256,sha(b));
  const saved=await readFile(out);await assert.rejects(exec(process.execPath,[...args,'--semantic','--allow-paid']),e=>e.stderr.includes('REPORT_ALREADY_EXISTS'));assert.deepEqual(await readFile(out),saved);
  await assert.rejects(exec(process.execPath,[...args,'--semantic']),e=>e.stderr.includes('INSPECTION_CONSENT_REQUIRED'));assert.equal(sha(await readFile(f)),sha(b));
});

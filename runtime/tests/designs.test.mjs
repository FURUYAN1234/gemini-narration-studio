import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {VIDEO_TEMPLATES,normalizeDesign,normalizePresentation,presentationDesign,assertDesignReady} from '../designs.mjs';
import {NarrationSession,buildDesignRequest} from '../core.mjs';
import {ProductionInputs} from '../production.mjs';
import {startServer} from '../server.mjs';
import {prepareReviewedAudio} from '../client.mjs';

const custom={...VIDEO_TEMPLATES[0].design,name:'今回だけの案',accent:'#923349',imageSide:'left',imageRatio:.52,titleSize:68};
test('motion changes bind the final revision without charging or invalidating current readings/audio; explicit off survives AI design',async t=>{
 const {s,dir}=await setup(t,async()=>({...custom,motion:{version:1,style:'kinetic',intensity:'bold'}}));
 const original=s.status(),motion={version:1,style:'editorial',intensity:'standard'};
 await s.setPresentation({...original.presentation,motion});const next=s.status();assert.notEqual(next.revision,original.revision);
 assert.deepEqual(next.rows,original.rows);assert.deepEqual((await NarrationSession.open({outputDir:dir})).status().presentation.motion,motion);
 await s.draftDesign('大きく文字を動かす');assert.equal(s.status().presentation.motion.style,'kinetic');
 await s.setPresentation({...s.status().presentation,motion:null});await s.draftDesign('演出案');assert.equal(s.status().presentation.motion,null);
 const p=await ProductionInputs.open(dir);await p.confirmCut(s.status().rows[0],p.cutFingerprint(s.status().rows[0]));await p.finalize(s.status());await s.exportManifest();
 await s.setPresentation({...s.status().presentation,motion});await assert.rejects(prepareReviewedAudio({sourceDir:dir,publicDir:path.join(dir,'out')}),/STALE|FINAL/);
});
function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}
async function setup(t,designProvider){const dir=await mkdtemp(path.join(tmpdir(),'studio-design-'));t.after(()=>rm(dir,{recursive:true,force:true}));const s=await NarrationSession.open({outputDir:dir,provider:async()=>wav(),designProvider});await (await ProductionInputs.open(dir)).saveMusicEnabled(false);s.setKey('test-design-key');await s.appendRow({id:'one',caption:'字幕。',speech:'よみ。'});await s.approve('one',s.revision());await s.generate(['one']);await s.markListened('one',s.revision());return {dir,s};}

test('twelve templates have distinct designs, nine layouts and readable validated palettes',()=>{
 assert.equal(VIDEO_TEMPLATES.length,12);assert.equal(new Set(VIDEO_TEMPLATES.map(t=>t.id)).size,12);assert.equal(new Set(VIDEO_TEMPLATES.map(t=>JSON.stringify(t.design))).size,12);assert.equal(new Set(VIDEO_TEMPLATES.map(t=>t.design.layout)).size,9);
 for(const t of VIDEO_TEMPLATES)assert.deepEqual(presentationDesign({theme:'moon',mode:'template',template:t.id}),normalizeDesign(t.design));
});
test('declarative design rejects code, URLs, credential text, unreadable colors and out-of-range geometry',()=>{
 assert.deepEqual(normalizeDesign(custom),custom);
 for(const edit of [{background:'url(https://example.com)'},{layout:'javascript'},{name:'AIza'+'x'.repeat(35)},{heading:'#ffffff',background:'#ffffff'},{titleSize:500},{imageRatio:2},{radius:-1},{html:'<script>bad</script>'}])assert.throws(()=>normalizeDesign({...custom,...edit}),/INVALID|CREDENTIAL/);
 assert.throws(()=>normalizePresentation({theme:'moon',mode:'template',template:'unknown'}),/INVALID_TEMPLATE/);
 assert.throws(()=>normalizePresentation({theme:'moon',mode:'ai',instructions:'Bearer '+'x'.repeat(20)}),/CREDENTIAL/);
 assert.doesNotThrow(()=>normalizePresentation({theme:'moon',mode:'ai',instructions:'余白を広めに。青を少し明るく。'}));
});
test('template/theme changes persist without invalidating unchanged pronunciation or audio; legacy revision survives reopening',async t=>{
 const {s,dir}=await setup(t);await s.setPresentation({theme:'moon'});const original=s.status(),reopened=await NarrationSession.open({outputDir:dir});assert.equal(reopened.revision(),s.revision());assert.equal(presentationDesign(original.presentation),null);
 await s.setPresentation({theme:'moon',mode:'template',template:'blueprint'});await s.setTheme('white');const current=s.status();assert.equal(current.presentation.template,'blueprint');assert.equal(current.rows[0].audio.file,original.rows[0].audio.file);assert.equal(current.rows[0].audioCurrent,true);assert.equal(current.rows[0].reviewed,true);assert.equal(current.rows[0].listenedCurrent,true);assert.notEqual(current.revision,original.revision);
 assert.deepEqual((await NarrationSession.open({outputDir:dir})).status().presentation,current.presentation);
});
test('unfinished AI design blocks sealing, export and offline preparation; a completed custom design reaches renderer data',async t=>{
 const {s,dir}=await setup(t,async()=>custom),p=await ProductionInputs.open(dir);await p.confirmCut(s.status().rows[0],p.cutFingerprint(s.status().rows[0]));
 await s.setPresentation({theme:'moon',mode:'ai',instructions:'図を左に置く'});assert.throws(()=>assertDesignReady(s.status().presentation),/DESIGN_REQUIRED/);await assert.rejects(p.finalize(s.status()),/DESIGN_REQUIRED/);await assert.rejects(s.exportManifest(),/DESIGN_REQUIRED/);
 await s.draftDesign('図を左に置く');assert.deepEqual(presentationDesign(s.status().presentation),custom);await p.finalize(s.status());await s.exportManifest();const prepared=await prepareReviewedAudio({sourceDir:dir,publicDir:path.join(dir,'public')});assert.deepEqual(presentationDesign(prepared.presentation),custom);
});
test('AI authoring sends only disclosed title/instructions, calls once, and preserves last good design after failure or cancellation',async t=>{
 let calls=0,received;const {s,dir}=await setup(t,async input=>{calls++;received=input;return custom;});await s.draftDesign('落ち着いた色で図を左に');assert.equal(calls,1);assert.deepEqual(Object.keys(received).sort(),['instructions','key','signal','title']);const saved=await readFile(path.join(dir,'job.json'),'utf8');assert.ok(!saved.includes('test-design-key'));
 const request=buildDesignRequest({title:'動画',instructions:'落ち着いた色'});assert.equal(request.generationConfig.responseMimeType,'application/json');assert.equal(request.generationConfig.responseJsonSchema.additionalProperties,false);assert.ok(!JSON.stringify(request).includes('template'));
 s.designProvider=async()=>{calls++;throw new Error('secret upstream detail');};await assert.rejects(s.draftDesign('次の案'),/^Error: PROVIDER_FAILED$/);assert.equal(calls,2);assert.equal(await readFile(path.join(dir,'job.json'),'utf8'),saved);assert.equal(s.busy,false);
 s.designProvider=async()=>{s.cancel();return custom;};await assert.rejects(s.draftDesign('次の案'),/CANCELED/);assert.equal(await readFile(path.join(dir,'job.json'),'utf8'),saved);
});
test('HTTP chooser enforces CSRF, stale revision, explicit AI consent and final seal',async t=>{
 let calls=0;const {s,dir}=await setup(t,async()=>{calls++;return custom;});const service=await startServer({session:s,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty')});t.after(()=>service.close());
 const {token}=await (await fetch(service.url+'/api/bootstrap')).json();const post=(route,input,auth=token)=>fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':auth},body:JSON.stringify(input)});
 assert.equal((await (await fetch(service.url+'/api/designs')).json()).length,12);
 assert.equal((await post('presentation',{revision:s.revision(),presentation:{theme:'moon',mode:'template',template:'pop'}},'bad')).status,403);
 assert.equal((await (await post('presentation',{revision:'stale',presentation:{theme:'moon',mode:'template',template:'pop'}})).json()).error,'STALE_REVISION');
 assert.equal((await post('presentation',{revision:s.revision(),presentation:{theme:'moon',mode:'template',template:'pop'}})).status,200);
 assert.equal((await (await post('design-draft',{revision:s.revision(),instructions:'独自の配置',consent:false})).json()).error,'GENERATION_CONSENT_REQUIRED');assert.equal(calls,0);
 assert.equal((await post('design-draft',{revision:s.revision(),instructions:'独自の配置',consent:true})).status,200);assert.equal(calls,1);
 const row=s.status().rows[0];await post('confirm-cut',{revision:s.revision(),id:'one',fingerprint:(await ProductionInputs.open(dir)).cutFingerprint(row)});assert.equal((await post('finalize',{revision:s.revision(),confirmIrreversible:true})).status,200);
 assert.equal((await (await post('design-draft',{revision:s.revision(),instructions:'変更',consent:true})).json()).error,'VIDEO_FINALIZED');assert.equal(calls,1);
});

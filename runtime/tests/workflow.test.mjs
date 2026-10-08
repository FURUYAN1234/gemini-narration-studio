import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProductionInputs} from '../production.mjs';
import {NarrationSession} from '../core.mjs';
import {startServer} from '../server.mjs';

async function directory(t){const dir=await mkdtemp(path.join(tmpdir(),'studio-workflow-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('source evidence survives later saves and changed captions lose only their old citation binding',async t=>{
 const dir=await directory(t),p=await ProductionInputs.open(dir),script='元の本文。';
 const sourceEvidence={sources:[{id:'text',status:'provided',label:'参考本文',summary:'参照した内容'}],bindings:[{lineIndex:0,captionHash:createHash('sha256').update(script).digest('hex'),sourceIds:['text']}]};
 await p.saveBrief({...p.status().brief,script,sourceEvidence});assert.equal((await ProductionInputs.open(dir)).status().brief.sourceEvidence.bindings.length,1);
 await p.saveBrief({...p.status().brief,script:'編集した本文。'});assert.equal(p.status().brief.sourceEvidence.bindings.length,0);assert.equal(p.status().brief.sourceEvidence.sources.length,1);
});
async function draftStudio(t,provider){
 const dir=await directory(t),session=await NarrationSession.open({outputDir:dir,draftProvider:provider});session.setKey('test-only-key');
 const service=await startServer({session,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty')});t.after(()=>service.close());
 const boot=await(await fetch(service.url+'/api/bootstrap')).json(),status=await(await fetch(service.url+'/api/status')).json();
 const post=(route,input)=>fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token},body:JSON.stringify(input)});
 const input={operation:'compose',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sequence:1,projectId:status.projectId,instanceId:boot.instanceId,revision:status.revision,productionRevision:status.productionRevision,consent:true,brief:{scriptMode:'ai',assetMode:'mixed',instructions:'一般的な説明',script:'',autoDirection:false}};
 return {dir,session,service,post,input,status:async()=>await(await fetch(service.url+'/api/status')).json()};
}

for(const failure of ['before-job','after-job','conflict'])test('interrupted adoption recovers safely: '+failure,async t=>{
 const studio=await draftStudio(t,()=>{throw Error('provider must not run');});let current=await studio.status();const close=studio.service.close;let closed=false;studio.service.close=async()=>{if(!closed){closed=true;await close();}};
 const adopt=async script=>{current=await studio.status();return studio.post('adopt-script',{script,projectId:current.projectId,instanceId:studio.input.instanceId,revision:current.revision,productionRevision:current.productionRevision});};
 assert.equal((await adopt('元の本文。')).status,200);const before=studio.session.status().rows;
 let mock;if(failure==='after-job'){const original=ProductionInputs.prototype.saveAuthoring;mock=t.mock.method(ProductionInputs.prototype,'saveAuthoring',async function(input,brief){if(!input.pendingAdoption&&this.status().authoring?.pendingAdoption)throw Error('injected clear failure');return original.call(this,input,brief);});}
 else mock=t.mock.method(studio.session,'applyScriptAdoption',async()=>{throw Error('injected job write failure');});
 assert.equal((await adopt('変更した本文。')).status,409);mock.mock.restore();
 assert.ok((await ProductionInputs.open(studio.dir)).status().authoring.pendingAdoption);
 if(failure!=='after-job')assert.deepEqual(studio.session.status().rows,before);
 if(failure==='conflict'){
  await studio.session.updateRow(before[0].id,{caption:'別タブの編集。'});assert.equal((await adopt('変更した本文。')).status,409);assert.equal(studio.session.status().rows[0].caption,'別タブの編集。');
 }
 await studio.service.close();const reopened=await NarrationSession.open({outputDir:studio.dir});
 const service=await startServer({session:reopened,port:0,sampleDir:path.join(studio.dir,'samples'),bundledSampleDir:path.join(studio.dir,'empty')});t.after(()=>service.close());
 const boot=await(await fetch(service.url+'/api/bootstrap')).json();current=await(await fetch(service.url+'/api/status')).json();
 if(failure==='after-job'){assert.equal(current.production.authoring.pendingAdoption,undefined);assert.equal(current.rows[0].caption,'変更した本文。');}
 else if(failure==='conflict')assert.equal(current.adoptionError,'ADOPTION_CONFLICT');
 else{
  const response=await fetch(service.url+'/api/adopt-script',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token},body:JSON.stringify({script:'変更した本文。',projectId:current.projectId,instanceId:boot.instanceId,revision:current.revision,productionRevision:current.productionRevision})});assert.equal(response.status,200);assert.equal(reopened.status().rows.length,1);assert.equal(reopened.status().rows[0].caption,'変更した本文。');
 }
});

test('adopting unchanged captions without supplied readings retains current audio and approvals',async t=>{
 const dir=await directory(t);let calls=0;const session=await NarrationSession.open({outputDir:dir,provider:async()=>{calls++;return wav();}});session.setKey('test-only-key');
 await session.appendRow({id:'one',caption:'元の本文。',speech:'もとのほんぶん。'});await session.approve('one',session.revision());await session.generate(['one']);const before=session.status().rows[0];
 await session.adoptScript('元の本文。',{expectedRevision:session.revision()});const after=session.status().rows[0];assert.equal(after.id,before.id);assert.deepEqual(after.audio,before.audio);assert.equal(after.audioCurrent,true);assert.equal(after.reviewed,true);assert.equal(calls,1);
});
test('duplicate running requests and old sequences never repeat a provider call',async t=>{
 let release,started,calls=0;const wait=new Promise(r=>release=r),began=new Promise(r=>started=r);
 const studio=await draftStudio(t,async()=>{calls++;started();await wait;return {rows:[{caption:'説明。',speech:'せつめい。'}]};});
 const running=studio.post('draft',studio.input);await began;
 const replay=await(await studio.post('draft',studio.input)).json();assert.equal(replay.attempt.state,'running');assert.equal(calls,1);
 release();assert.equal((await running).status,200);const current=await studio.status();
 const next={...studio.input,sequence:2,requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',revision:current.revision,productionRevision:current.productionRevision};assert.equal((await studio.post('draft',next)).status,200);assert.equal(calls,2);
 assert.equal((await studio.post('draft',studio.input)).status,409);assert.equal(calls,2);
});
test('cancel preserves the prior draft and rejects late output without an automatic retry',async t=>{
 let release,started,calls=0;const wait=new Promise(r=>release=r),began=new Promise(r=>started=r);
 const studio=await draftStudio(t,async()=>{calls++;started();await wait;return {rows:[{caption:'新しい説明。',speech:'あたらしいせつめい。'}]};});
 const running=studio.post('draft',studio.input);await began;assert.equal((await studio.post('cancel',{})).status,200);release();assert.equal((await running).status,409);
 const current=await studio.status();assert.equal(current.production.brief.script,'');assert.equal(current.production.authoring.lastAttempt.state,'canceled');assert.equal(calls,1);
 assert.equal((await studio.post('draft',studio.input)).status,200);assert.equal(calls,1);
});
test('failed result persistence retains an unsaved result; saving it costs no further provider request',async t=>{
 let calls=0;const original=ProductionInputs.prototype.saveAuthoring;
 const mock=t.mock.method(ProductionInputs.prototype,'saveAuthoring',async function(input,brief){if(input.lastAttempt?.state==='complete')throw Error('injected local write failure');return original.call(this,input,brief);});
 const studio=await draftStudio(t,async()=>{calls++;return {rows:[{caption:'保持する説明。',speech:'ほじするせつめい。'}]};});
 const result=await(await studio.post('draft',studio.input)).json();assert.equal(result.saved,false);assert.equal(result.script,'保持する説明。');const current=await studio.status();assert.equal(current.unsavedDraft.result.script,result.script);assert.equal(calls,1);
 mock.mock.restore();assert.equal((await studio.post('save-draft-result',{revision:current.revision,productionRevision:current.productionRevision})).status,200);
 assert.equal((await ProductionInputs.open(studio.dir)).status().brief.script,result.script);assert.equal(calls,1);
});
test('reading preparation sends only unconfirmed captions and preserves references and confirmed readings',async t=>{
 let received,calls=0;const studio=await draftStudio(t,async input=>{received=input.brief;calls++;return {rows:[{caption:'次。',speech:'つぎ。'}]};});
 await studio.session.adoptScript('最初。\n次。',{expectedRevision:studio.session.revision()});const first=studio.session.status().rows[0];await studio.session.updateRow(first.id,{speech:'さいしょ。'});await studio.session.approve(first.id,studio.session.revision());
 let current=await studio.status();await studio.post('production',{...current.production.brief,script:'最初。\n次。',scriptEdited:true,instructions:'送信しない制作指示',references:{text:'送信しない参考本文',urls:['https://example.com/reference']},productionRevision:current.productionRevision});current=await studio.status();
 const input={...studio.input,operation:'prepare-readings',revision:current.revision,productionRevision:current.productionRevision,brief:{scriptMode:'existing',assetMode:'provided',autoDirection:false,script:'最初。\n次。',instructions:'',references:{text:'余計な本文',urls:['https://example.com/extra']}}};
 const response=await studio.post('prepare-readings',input);assert.equal(response.status,200);assert.equal(calls,1);assert.equal(received.script,'次。');assert.deepEqual(received.references,{text:'',urls:[]});assert.equal(received.autoDirection,false);
 current=await studio.status();assert.equal(current.rows[0].reviewed,true);assert.equal(current.rows[1].speech,'つぎ。');assert.equal(current.rows[1].reviewed,false);assert.deepEqual(current.production.brief.references.urls,['https://example.com/reference']);
});
test('legacy script import cannot silently prepare readings even with its old consent flag',async t=>{
 let calls=0;const studio=await draftStudio(t,async()=>{calls++;throw Error('must not generate');});
 const response=await studio.post('append-script',{script:'手入力の本文。',consent:true});assert.equal(response.status,409);assert.equal(calls,0);assert.equal(studio.session.status().rows.length,0);
});

test('failed reading result save can be saved and applied locally without another generation',async t=>{
 let calls=0;const studio=await draftStudio(t,async()=>{calls++;return {rows:[{caption:'本文。',speech:'ほんぶん。'}]};});await studio.session.adoptScript('本文。',{expectedRevision:studio.session.revision()});
 const original=ProductionInputs.prototype.saveAuthoring,mock=t.mock.method(ProductionInputs.prototype,'saveAuthoring',async function(input,brief){if(input.lastAttempt?.state==='complete')throw Error('injected result save failure');return original.call(this,input,brief);});let current=await studio.status();
 const response=await(await studio.post('prepare-readings',{...studio.input,operation:'prepare-readings',revision:current.revision,productionRevision:current.productionRevision,brief:{scriptMode:'existing',assetMode:'provided',autoDirection:false,script:'本文。'}})).json();assert.equal(response.saved,false);assert.equal(studio.session.status().rows[0].speech,'');mock.mock.restore();
 current=await studio.status();assert.equal((await studio.post('save-draft-result',{revision:current.revision,productionRevision:current.productionRevision})).status,200);current=await studio.status();assert.equal((await studio.post('apply-draft-readings',{revision:current.revision,productionRevision:current.productionRevision})).status,200);assert.equal(studio.session.status().rows[0].speech,'ほんぶん。');assert.equal(studio.session.status().rows[0].reviewed,false);assert.equal(calls,1);
});
test('draft result is durable, request replay is free, and stale requests never call provider',async t=>{
 const dir=await directory(t);let calls=0;const session=await NarrationSession.open({outputDir:dir,draftProvider:async()=>{calls++;return {rows:[{caption:'説明します。',speech:'せつめいします。'}]};}});session.setKey('test-only-key');
 const service=await startServer({session,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty')});t.after(()=>service.close());
 const boot=await(await fetch(service.url+'/api/bootstrap')).json(),initial=await(await fetch(service.url+'/api/status')).json();
 const post=input=>fetch(service.url+'/api/draft',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token},body:JSON.stringify(input)});
 const input={operation:'compose',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sequence:1,projectId:initial.projectId,instanceId:boot.instanceId,revision:initial.revision,productionRevision:initial.productionRevision,consent:true,brief:{scriptMode:'ai',assetMode:'mixed',instructions:'テーマ',script:'',autoDirection:false}};
 const first=await post(input);assert.equal(first.status,200);const result=await first.json();assert.equal(result.script,'説明します。');assert.equal(calls,1);
 assert.equal((await ProductionInputs.open(dir)).status().brief.script,'説明します。');
 assert.equal((await post(input)).status,200);assert.equal(calls,1);
 assert.equal((await post({...input,brief:{...input.brief,instructions:'別の指示'}})).status,409);assert.equal(calls,1);
 assert.equal((await post({...input,sequence:2,requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})).status,409);assert.equal(calls,1);
});
test('new BGM preference is on, switches persist without destroying assets, and finalized preferences reject changes',async t=>{
 const dir=await directory(t),p=await ProductionInputs.open(dir);
 assert.equal(p.status().musicEnabled,true);
 await p.saveMusicEnabled(false);assert.equal((await ProductionInputs.open(dir)).status().musicEnabled,false);
 await p.saveMusicEnabled(true);assert.equal(p.status().musicEnabled,true);
 await assert.rejects(p.saveMusicEnabled('on'),/INVALID_MUSIC_PREFERENCE/);
 p.value.finalization={revision:'a'.repeat(64),inputsHash:'b'.repeat(64)};
 await assert.rejects(p.saveMusicEnabled(false),/VIDEO_FINALIZED/);
});
test('initial voice is a candidate; explicit settings selection persists, provisional AI settings are not a decision',async t=>{
 const dir=await directory(t),session=await NarrationSession.open({outputDir:dir});
 const service=await startServer({session,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty')});t.after(()=>service.close());
 const initial=await(await fetch(service.url+'/api/status')).json();assert.equal(initial.voiceConfirmed,false);
 const {token}=await(await fetch(service.url+'/api/bootstrap')).json();
 const post=input=>fetch(service.url+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify(input)});
 const selected=await(await post(initial.settings)).json();assert.equal(selected.voiceConfirmed,true);
 assert.match((await ProductionInputs.open(dir)).status().voiceConfirmation,/^[a-f0-9]{64}$/);
 const proposed=await(await post({...initial.settings,candidate:true})).json();assert.equal(proposed.voiceConfirmed,false);
});
test('reference-only source planning reaches the provider once and empty input remains blocked',async t=>{
 const dir=await directory(t),session=await NarrationSession.open({outputDir:dir});session.setKey('test-only-key');let calls=0;
 const response={visualStyle:'白地に青い文字',title:'資料の説明',summary:'資料を解説',voice:'Kore',voiceReason:'明瞭な説明',motion:{version:1,style:'editorial',intensity:'standard'},sources:[{id:'text',summary:'参考資料'}],rows:[{purpose:'detail',caption:'資料を説明します。',speech:'しりょうをせつめいします。',title:'資料',points:[],imageFile:'',sourceIds:['text']}]};
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response)}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});});
 const brief={scriptMode:'ai',assetMode:'provided',instructions:'',script:'',references:{text:'参考資料',urls:[]}};
 assert.equal((await session.planSources(brief,[],()=>{})).script,'資料を説明します。');assert.equal(calls,1);
 await assert.rejects(session.planSources({...brief,references:{text:'',urls:[]}},[],()=>{}),/REFERENCE_REQUIRED/);assert.equal(calls,1);
});

function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}
for(const scenario of ['on','off','voice-failure','music-failure'])test('explicit narration pipeline: '+scenario+' preserves order and never retries',async t=>{
 const dir=await directory(t),calls=[];
 const session=await NarrationSession.open({outputDir:dir,provider:async()=>{calls.push('voice');if(scenario==='voice-failure')throw new Error('PROVIDER_RATE_LIMIT');return wav();}});
 session.setKey('test-only-key');await session.appendRow({id:'one',caption:'説明。',speech:'せつめい。'});
 const production=await ProductionInputs.open(dir);if(scenario==='off')await production.saveMusicEnabled(false);
 const service=await startServer({session,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty'),musicFactory:async()=>{calls.push('music');if(scenario==='music-failure')throw new Error('PROVIDER_RATE_LIMIT');return {bytes:Buffer.concat([Buffer.from('ID3'),Buffer.alloc(32)]),durationSeconds:30};}});t.after(()=>service.close());
 const {token}=await(await fetch(service.url+'/api/bootstrap')).json();
 const post=async(route,input)=>(await fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify(input)})).json();
 await post('settings',session.status().settings);
 assert.equal((await post('generate',{ids:['one'],consent:false,createMusic:scenario!=='off'})).error,'GENERATION_CONSENT_REQUIRED');
 assert.equal((await post('generate',{ids:['one'],consent:true,createMusic:scenario!=='off'})).error,'READING_REVIEW_REQUIRED');assert.deepEqual(calls,[]);
 await session.approve('one',session.revision());
 assert.equal((await post('generate',{ids:['one'],consent:true,revision:'stale',createMusic:scenario!=='off'})).error,'STALE_REVISION');
 assert.equal((await post('generate',{ids:['one'],consent:true,revision:session.revision(),createMusic:scenario!=='off'})).started,true);
 let state;for(let i=0;i<200;i++){state=await(await fetch(service.url+'/api/status')).json();if(!state.busy)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(state.busy,false);assert.deepEqual(calls,scenario==='off'||scenario==='voice-failure'?['voice']:['voice','music']);
 assert.equal(state.rows[0].audioCurrent,scenario!=='voice-failure');
 assert.equal(!!state.production.music,scenario==='on');
 if(scenario.endsWith('failure'))assert.ok(state.error);
 if(scenario==='off')assert.equal((await post('generate',{ids:[],consent:true,createMusic:true})).error,'MUSIC_DISABLED');
});

test('BGM off keeps the original asset but omits it; on without music cannot finalize',async t=>{
 const p=await ProductionInputs.open(await directory(t));assert.throws(()=>p.assertMusicCurrent({}),/MUSIC_REQUIRED/);
 await p.addAsset('music.mp3',Buffer.concat([Buffer.from('ID3'),Buffer.alloc(32)]),{origin:'generated-music'});
 await p.saveMusic({file:p.status().assets[0].file,signature:'a'.repeat(64),direction:'静かな曲',model:'lyria-3.5',durationSeconds:30,level:.16});
 await p.saveMusicEnabled(false);p.assertMusicCurrent({});assert.equal(p.effectiveMusic(),undefined);assert.equal(p.status().assets.length,1);assert.ok(p.status().music);
});
test('production saving rejects a missing or stale baseline and preserves the other tab saved input',async t=>{
 const dir=await directory(t),session=await NarrationSession.open({outputDir:dir}),service=await startServer({session,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty')});t.after(()=>service.close());
 const initial=await(await fetch(service.url+'/api/status')).json(),{token}=await(await fetch(service.url+'/api/bootstrap')).json();
 const brief={scriptMode:'ai',assetMode:'mixed',instructions:'資料から解説',script:'',references:{text:'元の資料',urls:[]}};
 const post=input=>fetch(service.url+'/api/production',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify(input)});
 assert.equal((await post(brief)).status,409);assert.equal((await post({...brief,productionRevision:initial.productionRevision})).status,200);
 assert.equal((await post({...brief,instructions:'古いタブの内容',productionRevision:initial.productionRevision})).status,409);
 const saved=await(await fetch(service.url+'/api/status')).json();assert.equal(saved.production.brief.instructions,brief.instructions);
 assert.equal((await post({...brief,instructions:'新しい内容',productionRevision:saved.productionRevision})).status,200);
});

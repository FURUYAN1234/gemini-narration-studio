import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProductionInputs,STUDIO_WATERMARK,normalizeDraftScriptReadings,normalizeScriptReadings} from '../production.mjs';
import {NarrationSession} from '../core.mjs';
import {startServer} from '../server.mjs';

async function directory(t){const dir=await mkdtemp(path.join(tmpdir(),'studio-workflow-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('source evidence survives later saves and changed captions lose only their old citation binding',async t=>{
 const dir=await directory(t),p=await ProductionInputs.open(dir),script='元の本文。';
 const sourceEvidence={sources:[{id:'text',status:'provided',label:'参考本文',summary:'参照した内容'}],bindings:[{lineIndex:0,captionHash:createHash('sha256').update(script).digest('hex'),sourceIds:['text']}]};
 await p.saveBrief({...p.status().brief,script,sourceEvidence});assert.equal((await ProductionInputs.open(dir)).status().brief.sourceEvidence.bindings.length,1);
 await p.saveBrief({...p.status().brief,script:'編集した本文。'});assert.equal(p.status().brief.sourceEvidence.bindings.length,0);assert.equal(p.status().brief.sourceEvidence.sources.length,1);
});
test('authoring progress is live and indeterminate while the provider runs, and clears on success or failure',async t=>{
 for(const fails of [false,true]){
  let started,release;const entered=new Promise(r=>started=r),wait=new Promise(r=>release=r);
  const studio=await draftStudio(t,async()=>{started();await wait;if(fails)throw Error('PROVIDER_FAILED');return {rows:[{caption:'一般的な説明。',speech:'いっぱんてきなせつめい。'}]};});
  const running=studio.post('draft',studio.input);await entered;
  const live=await studio.status();assert.equal(live.busy,true);assert.equal(live.authoringProgress.operation,'compose');assert.match(live.authoringProgress.phase,/台本|読み/);assert.equal(live.authoringProgress.total,undefined);
  release();const response=await running;assert.equal(response.status,fails?409:200);assert.equal((await studio.status()).authoringProgress,null);assert.equal((await studio.status()).busy,false);
 }
});

async function draftStudio(t,provider){
 const dir=await directory(t),session=await NarrationSession.open({outputDir:dir,draftProvider:provider,provider:async()=>{throw Error('unexpected test synthesis');}});session.setKey('test-only-key');
 const service=await startServer({session,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty')});t.after(()=>service.close());
 const boot=await(await fetch(service.url+'/api/bootstrap')).json(),status=await(await fetch(service.url+'/api/status')).json();
 const post=(route,input)=>fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token},body:JSON.stringify(input)});
 const input={operation:'compose',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sequence:1,projectId:status.projectId,instanceId:boot.instanceId,revision:status.revision,productionRevision:status.productionRevision,consent:true,brief:{scriptMode:'ai',assetMode:'provided',instructions:'一般的な説明',script:'',autoDirection:false}};
 return {dir,session,service,post,input,token:boot.token,status:async()=>await(await fetch(service.url+'/api/status')).json()};
}

test('first draft response preserves the script and canonicalizes kana locally without another provider request',async t=>{
 let calls=0;const studio=await draftStudio(t,async()=>{calls++;return {rows:[{caption:'端末を紹介します。',speech:'タンマツヲショウカイシマス。'}]};});
 const response=await studio.post('draft',studio.input),result=await response.json();assert.equal(response.status,200);assert.equal(calls,1);assert.equal(result.script,'端末を紹介します。');assert.equal(result.readings[0].speech,'たんまつをしょうかいします。');assert.equal(result.saved,true);assert.equal(result.attempt.state,'complete');
 assert.equal((await studio.status()).production.brief.script,result.script);assert.equal((await studio.status()).rows.length,0);
});

test('draft kana normalization is phonetic only; kanji, numerals and sentence mismatch remain unresolved candidates',()=>{
 for(const speech of ['ヴァイオリンを、ひきます。','ｳﾞｧｲｵﾘﾝを、ひきます。','ゔぁいおりんを、ひきます。'])assert.equal(normalizeDraftScriptReadings('楽器を弾きます。',[{caption:'楽器を弾きます。',speech}])[0].speech,'ゔぁいおりんを、ひきます。');
 for(const speech of ['楽器をひきます。','3かい、ひきます。','ひきます。やすみます。']){const candidate=normalizeDraftScriptReadings('楽器を弾きます。',[{caption:'楽器を弾きます。',speech}]);assert.equal(candidate[0].speech,speech);assert.throws(()=>normalizeScriptReadings('楽器を弾きます。',candidate),/HIRAGANA_READING_REQUIRED|READING_SENTENCE_MISMATCH/);}
 assert.throws(()=>normalizeDraftScriptReadings('別の字幕。',[{caption:'楽器を弾きます。',speech:'ひきます。'}]),/STALE_SCRIPT_READINGS/);
});

test('title reading defects preserve the first script while candidate-bound title import cannot approve or synthesize them',async t=>{
 let calls=0;const studio=await draftStudio(t,async()=>{calls++;return {title:'情報の届け方',titleSpeech:'情報のとどけかた。',rows:[{caption:'伝えます。',speech:'つたえます。'}]};});
 const result=await(await studio.post('draft',studio.input)).json();assert.equal(result.script,'伝えます。');assert.equal(result.saved,true);assert.ok(result.warnings.some(w=>w.stage==='title-reading'));assert.equal(calls,1);
 await studio.post('title',{title:result.titleReading.caption});let state=await studio.status();const fields={...STUDIO_WATERMARK,title:result.titleReading.caption,speech:result.titleReading.speech,endSeconds:4,revision:state.revision,productionRevision:state.productionRevision};
 const forged=await studio.post('bookends',{...fields,speech:'別の読み。',readingCandidate:true});assert.equal(forged.status,409);
 const added=await studio.post('bookends',{...fields,readingCandidate:true});assert.equal(added.status,200);state=await studio.status();assert.equal(state.titleReadingPreparationRequired,true);assert.equal(state.rows[0].reviewed,false);assert.equal(state.rows[0].readingPreparationRequired,true);
 const approval=await studio.post('approve',{id:state.rows[0].id,revision:state.revision});assert.equal(approval.status,409);assert.equal((await approval.json()).error,'HIRAGANA_READING_REQUIRED');
 const saved=await studio.post('bookends',{...fields,speech:'じょうほうのとどけかた。',revision:state.revision,productionRevision:state.productionRevision});assert.equal(saved.status,200);state=await studio.status();assert.equal(state.titleReadingPreparationRequired,false);assert.equal(state.rows[0].reviewed,false);assert.equal(calls,1);
});

test('first draft preserves incomplete reading candidates but blocks approval and synthesis until the affected reading is corrected',async t=>{
 let calls=0;const studio=await draftStudio(t,async()=>{calls++;return {rows:[{caption:'設定します。',speech:'せっていします。'},{caption:'画面を確認します。',speech:'画面を、かくにんします。'}]};});
 const response=await studio.post('draft',studio.input),result=await response.json();assert.equal(response.status,200);assert.equal(calls,1);assert.equal(result.saved,true);assert.equal(result.attempt.state,'partial');assert.ok(result.warnings.some(w=>w.stage==='reading'));assert.equal(result.readings[1].speech,'画面を、かくにんします。');
 let current=await studio.status();const adopted=await studio.post('adopt-script',{script:result.script,readings:result.readings,projectId:current.projectId,instanceId:current.instanceId,revision:current.revision,productionRevision:current.productionRevision});assert.equal(adopted.status,200);current=await studio.status();assert.equal(current.rows[1].readingPreparationRequired,true);
 const bad=await studio.post('approve',{id:current.rows[1].id,revision:current.revision});assert.equal(bad.status,409);assert.equal((await bad.json()).error,'HIRAGANA_READING_REQUIRED');assert.equal((await studio.status()).rows[1].reviewed,false);
 assert.throws(()=>studio.session.validateGeneration(current.rows.map(r=>r.id)),/READING_REVIEW_REQUIRED|HIRAGANA_READING_REQUIRED/);assert.equal(calls,1);
 await studio.post('row',{id:current.rows[1].id,caption:current.rows[1].caption,speech:'がめんを、かくにんします。'});current=await studio.status();for(const row of current.rows){await studio.post('approve',{id:row.id,revision:(await studio.status()).revision});}current=await studio.status();assert.equal(current.rows.every(r=>r.reviewed),true);assert.equal(studio.session.validateGeneration(current.rows.map(r=>r.id)).length,2);assert.equal(calls,1);
 const reopened=await ProductionInputs.open(studio.dir);assert.equal(reopened.status().authoring.lastAttempt.result.script,result.script);
});

test('ready but unconfirmed readings cannot trigger another paid preparation',async t=>{
 let calls=0;const studio=await draftStudio(t,()=>{calls++;throw Error('must not generate');});
 await studio.session.adoptScript('説明。',{readings:[{caption:'説明。',speech:'せつめい。'}],expectedRevision:studio.session.revision()});
 const current=await studio.status(),response=await studio.post('prepare-readings',{...studio.input,operation:'prepare-readings',revision:current.revision,productionRevision:current.productionRevision,brief:{scriptMode:'existing',script:'説明。',autoDirection:false}});
 assert.equal(response.status,409);assert.equal((await response.json()).error,'READING_PREPARATION_NOT_NEEDED');assert.equal(calls,0);assert.equal((await studio.status()).rows[0].reviewed,false);
});

test('user trigger: composing a script prepares supplied and generated images before returning the result, with no later generate click',async t=>{
 const studio=await draftStudio(t,()=>{throw Error('source planning should be used');}),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
 await fetch(studio.service.url+'/api/material?name=supplied.png',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Narration-Token':studio.token},body:png});
 const initial=await studio.status(),file=initial.production.assets[0].file;let plans=0,images=0;
 const readings=[{caption:'素材を使います。',speech:'そざいをつかいます。'},{caption:'新しい景色です。',speech:'あたらしいけしきです。'}];
 studio.session.planSources=async()=>{plans++;return {script:readings.map(r=>r.caption).join('\n'),readings,visualPlanStatus:'ready',warnings:[],storyboard:{version:1,title:'説明',summary:'概要',voice:'Kore',voiceReason:'解説',motion:null,sources:[],scenes:readings.map((r,i)=>({caption:r.caption,title:'場面',points:[],sourceIds:[],imageFile:i?'':file,...(i?{imagePrompt:'緑の丘',imageReferences:[file]}:{})}))}};};
 studio.session.generateMedia=async(kind,args)=>{images++;assert.equal(kind,'image');assert.equal(args.references.length,1);return {bytes:Buffer.concat([png,Buffer.from('new'+images)]),extension:'png'};};
 const input={...studio.input,brief:{...studio.input.brief,assetMode:'mixed'},productionRevision:initial.productionRevision},res=await studio.post('source-plan',input),result=await res.json();assert.equal(res.status,200);assert.equal(plans,1);assert.equal(images,1);assert.equal(result.storyboard.scenes[0].imageFile,file);assert.ok(result.storyboard.scenes.every(s=>s.imageFile&&!s.imagePrompt));assert.equal((await studio.status()).rows.length,0);
 let st=await studio.status();assert.equal((await studio.post('cut-image',{draftIndex:1,file:'b'.repeat(64)+'.png',revision:st.revision,productionRevision:st.productionRevision})).status,409);assert.equal(images,1);
 assert.equal((await studio.post('cut-image',{draftIndex:1,file,revision:st.revision,productionRevision:st.productionRevision})).status,200);st=await studio.status();assert.equal(st.production.brief.storyboard.scenes[1].imageFile,file);assert.equal(images,1);
 assert.equal((await studio.post('regenerate-image',{draftIndex:1,revision:st.revision,productionRevision:st.productionRevision,consent:true})).status,200);st=await studio.status();assert.equal(images,2);assert.equal(st.production.brief.storyboard.scenes[0].imageFile,file);assert.notEqual(st.production.brief.storyboard.scenes[1].imageFile,result.storyboard.scenes[1].imageFile);assert.equal(st.rows.length,0);
 assert.equal((await studio.post('regenerate-image',{draftIndex:0,revision:st.revision,productionRevision:'stale',consent:true})).status,409);assert.equal(images,2);
 assert.equal((await studio.post('source-plan',input)).status,200);assert.equal(plans,1);assert.equal(images,2);assert.equal((await ProductionInputs.open(studio.dir)).status().authoring.lastAttempt.result.storyboard.scenes[1].imageFile,st.production.brief.storyboard.scenes[1].imageFile);
});

test('an image preparation failure retains the new script and completed images as a partial result, never claims completion or retries automatically',async t=>{
 const studio=await draftStudio(t,()=>{throw Error('source planning should be used');}),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');let images=0;
 const readings=[{caption:'一つ目。',speech:'ひとつめ。'},{caption:'二つ目。',speech:'ふたつめ。'}];
 studio.session.planSources=async()=>({script:readings.map(r=>r.caption).join('\n'),readings,visualPlanStatus:'ready',warnings:[],storyboard:{version:1,title:'説明',summary:'概要',voice:'Kore',voiceReason:'解説',motion:null,sources:[],scenes:readings.map(r=>({caption:r.caption,title:'場面',points:[],sourceIds:[],imageFile:'',imagePrompt:'丘の風景',imageReferences:[]}))}});
 studio.session.generateMedia=async()=>{if(++images===2)throw Error('PROVIDER_RATE_LIMIT');return {bytes:Buffer.concat([png,Buffer.from(String(images))]),extension:'png'};};
 const input={...studio.input,brief:{...studio.input.brief,assetMode:'mixed',references:{text:'参考本文',urls:[]}}},res=await studio.post('source-plan',input),result=await res.json();assert.equal(res.status,200);assert.equal(result.attempt.state,'partial');assert.equal(result.attempt.error.stage,'images');assert.ok(result.storyboard.scenes[0].imageFile);assert.ok(result.storyboard.scenes[1].imagePrompt);assert.equal(images,2);assert.equal((await studio.post('source-plan',input)).status,200);assert.equal(images,2);assert.equal((await studio.status()).rows.length,0);assert.equal((await ProductionInputs.open(studio.dir)).status().brief.script,result.script);
 let st=await studio.status();assert.equal((await studio.post('adopt-script',{script:result.script,readings:result.readings,projectId:st.projectId,instanceId:studio.input.instanceId,revision:st.revision,productionRevision:st.productionRevision})).status,409);assert.equal(images,2);
 assert.equal((await studio.post('regenerate-image',{draftIndex:1,revision:st.revision,productionRevision:st.productionRevision,consent:true})).status,200);st=await studio.status();assert.equal(images,3);assert.equal(st.production.authoring.lastAttempt.state,'complete');assert.equal(st.production.brief.storyboard.scenes[0].imageFile,result.storyboard.scenes[0].imageFile);
 assert.equal((await studio.post('adopt-script',{script:st.production.brief.script,readings:st.production.brief.readings,projectId:st.projectId,instanceId:studio.input.instanceId,revision:st.revision,productionRevision:st.productionRevision})).status,200);assert.equal(images,3);
});

test('cancellation during image preparation keeps the validated script and successful image, and running replay never restarts generation',async t=>{
 const studio=await draftStudio(t,()=>{throw Error('source planning should be used');}),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');let release,started,images=0;const waiting=new Promise(r=>release=r),began=new Promise(r=>started=r);
 const readings=[{caption:'一つ目。',speech:'ひとつめ。'},{caption:'二つ目。',speech:'ふたつめ。'}];studio.session.planSources=async()=>({script:readings.map(r=>r.caption).join('\n'),readings,visualPlanStatus:'ready',warnings:[],storyboard:{version:1,title:'説明',summary:'概要',voice:'Kore',voiceReason:'解説',motion:null,sources:[],scenes:readings.map(r=>({caption:r.caption,title:'場面',points:[],sourceIds:[],imageFile:'',imagePrompt:'丘の風景',imageReferences:[]}))}});
 studio.session.generateMedia=async()=>{if(++images===2){started();await waiting;}return {bytes:png,extension:'png'};};const input={...studio.input,brief:{...studio.input.brief,assetMode:'mixed',references:{text:'参考本文',urls:[]}}};const pending=studio.post('source-plan',input);await began;
 const replay=await(await studio.post('source-plan',input)).json();assert.equal(replay.attempt.state,'running');assert.ok(replay.storyboard.scenes[0].imageFile);assert.equal(images,2);await studio.post('cancel',{});release();assert.equal((await pending).status,409);
 const st=await studio.status();assert.equal(st.production.authoring.lastAttempt.state,'canceled');assert.equal(st.production.authoring.lastAttempt.error.stage,'images');assert.equal(st.production.brief.script,readings.map(r=>r.caption).join('\n'));assert.ok(st.production.brief.storyboard.scenes[0].imageFile);assert.ok(st.production.brief.storyboard.scenes[1].imagePrompt);assert.equal(st.rows.length,0);assert.equal(images,2);
});

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
 const response={visualStyle:'白地に青い文字',title:'資料の説明',titleSpeech:'しりょうのせつめい',summary:'資料を解説',voice:'Kore',voiceReason:'明瞭な説明',motion:{version:1,style:'editorial',intensity:'standard'},sources:[{id:'text',summary:'参考資料'}],rows:[{purpose:'detail',caption:'資料を説明します。',speech:'しりょうをせつめいします。',title:'資料',points:[],imageFile:'',sourceIds:['text']}]};
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

test('generated title reading survives the ordinary draft route and reopening before adoption',async t=>{
 const studio=await draftStudio(t,async()=>({title:'朝の準備',titleSpeech:'あさのじゅんび',rows:[{caption:'窓を開けます。',speech:'まどをあけます。'}]}));
 const res=await studio.post('draft',studio.input),draft=await res.json();assert.equal(res.status,200);
 assert.deepEqual(draft.titleReading,{caption:'朝の準備',speech:'あさのじゅんび'});
 assert.deepEqual((await ProductionInputs.open(studio.dir)).status().brief.titleReading,draft.titleReading);
 assert.equal((await studio.status()).rows.length,0);
});

test('a successful second generation retains the first failure for diagnosis',async t=>{
 let calls=0;const studio=await draftStudio(t,async()=>{if(++calls===1)throw Error('PROVIDER_EMPTY_TEXT');return {rows:[{caption:'説明。',speech:'せつめい。'}]};});
 assert.equal((await studio.post('draft',studio.input)).status,409);let st=await studio.status();assert.equal(st.production.authoring.lastAttempt.state,'failed');
 const next={...studio.input,requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sequence:2,revision:st.revision,productionRevision:st.productionRevision};assert.equal((await studio.post('draft',next)).status,200);
 const saved=(await ProductionInputs.open(studio.dir)).status().authoring;assert.equal(saved.lastAttempt.state,'complete');assert.equal(saved.failures[0].sequence,1);assert.equal(saved.failures[0].error.code,'PROVIDER_EMPTY_TEXT');assert.equal(calls,2);
});

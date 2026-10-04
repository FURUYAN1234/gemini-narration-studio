import test from 'node:test';
import assert from 'node:assert/strict';
import {generateArtwork} from '../image-generation.mjs';
import {musicSignature,musicTimeline,buildMusicRequest,parseMusic,normalizeMusic,musicVolume,musicClips} from '../music.mjs';
import {collectSources,normalizeSourcePlan} from '../source-plan.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NarrationSession} from '../core.mjs';
import {ProductionInputs,normalizePause} from '../production.mjs';
import {startServer} from '../server.mjs';
const file='a'.repeat(64)+'.png';
const brief={scriptMode:'ai',assetMode:'mixed',script:'',instructions:'説明動画',references:{text:'制作の説明',urls:[]}};
const output={title:'制作',summary:'制作の流れ',voice:'Kore',voiceReason:'解説',motion:{version:1,style:'editorial',intensity:'standard'},sources:[{id:'text',summary:'制作の説明'}],rows:[{caption:'制作します。',speech:'せいさくします。',title:'制作',points:[],imageFile:'',imagePrompt:'漫画制作の机とペン。文字なし。',imageReason:'工程を示す素材がない',sourceIds:['text']}]};
test('mixed plans allow missing artwork; supplied-only plans cannot request paid images',async()=>{
 const bundle=await collectSources(brief,[],()=>{});const plan=normalizeSourcePlan(output,bundle,['Kore']);assert.equal(plan.storyboard.scenes[0].imagePrompt,output.rows[0].imagePrompt);
 assert.throws(()=>normalizeSourcePlan(output,{...bundle,assetMode:'provided'},['Kore']),/IMAGE_GENERATION_NOT_ALLOWED/);
 const conflicting=structuredClone(output);conflicting.rows[0].imageFile=file;
 assert.throws(()=>normalizeSourcePlan(conflicting,{...bundle,sources:[...bundle.sources,{id:'asset-0',file,kind:'image/png'}]},['Kore']));
});
test('image generation validates references before one call and rejects malformed image output without retry',async()=>{
 let calls=0;const request=async()=>{calls++;return {candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}}]}}]};};
 const image=await generateArtwork({request,prompt:'机の図解',references:[]});assert.equal(image.extension,'png');assert.equal(calls,1);
 await assert.rejects(generateArtwork({request,prompt:'',references:[]}),/IMAGE_PROMPT_REQUIRED/);assert.equal(calls,1);
 await assert.rejects(generateArtwork({request:async()=>{calls++;return {candidates:[{finishReason:'STOP',content:{parts:[]}}]};},prompt:'机',references:[]}),/PROVIDER_IMAGE_REQUIRED/);assert.equal(calls,2);
});
const rows=[{id:'one',caption:'制作',speech:'せいさく',audio:{file:'a.wav',durationSeconds:10},audioCurrent:true,reviewed:true}];
test('music uses actual audio timing and changes invalidate content-bound music',()=>{
 const current={title:'漫画制作',rows};const timeline=musicTimeline(current);assert.equal(timeline.durationInFrames,307);assert.equal(timeline.rows[0].frames,300);
 assert.notEqual(musicSignature(current),musicSignature({...current,title:'別の動画'}));
 assert.throws(()=>musicTimeline({...current,rows:[{...rows[0],audioCurrent:false}]}),/AUDIO_REQUIRED/);
 const req=buildMusicRequest(current,'軽快な電子音');assert.match(JSON.stringify(req),/instrumental/i);assert.match(JSON.stringify(req),/10\.23/);assert.match(JSON.stringify(req),/漫画制作/);
});
test('music parsing, config and timing fail closed; fades and ducking stay within bounds',()=>{
 assert.throws(()=>parseMusic({candidates:[{finishReason:'STOP',content:{parts:[]}}]}),/PROVIDER_MUSIC_REQUIRED/);
 assert.throws(()=>normalizeMusic({file:'../x.mp3'}),/INVALID_MUSIC/);
 const timeline={fps:30,durationInFrames:600,rows:[{from:60,frames:300}]};
 assert.equal(musicVolume(0,timeline),0);assert.equal(musicVolume(600,timeline),0);
 assert.ok(musicVolume(180,timeline)<musicVolume(420,timeline));
 const clips=musicClips(600,180,30);assert.ok(clips.length>1);assert.equal(clips[0].from,0);assert.ok(clips.at(-1).from+clips.at(-1).frames>=600);
 assert.throws(()=>musicClips(600,0,30),/INVALID_MUSIC/);
});
test('breathing space changes the video/music timeline without regenerating current music',async t=>{
 for(const value of [-1,4,NaN,'0.8'])assert.throws(()=>normalizePause(value),/INVALID_CUT_PAUSE/);
 const current={title:'制作',rows},timeline=musicTimeline({...current,pauseSeconds:.8});assert.equal(timeline.durationInFrames,324);assert.equal(musicSignature({...current,pauseSeconds:.8}),musicSignature(current));
 const dir=await mkdtemp(path.join(tmpdir(),'cut-pause-'));t.after(()=>rm(dir,{recursive:true,force:true}));const p=await ProductionInputs.open(dir),hash=p.finalInputsHash();await p.savePause(.8);assert.notEqual(hash,p.finalInputsHash());assert.equal((await ProductionInputs.open(dir)).status().pauseSeconds,.8);p.value.finalization={};await assert.rejects(p.savePause(.5),/VIDEO_FINALIZED/);
});
test('all supplied sources are analyzed but only relevant images need to appear',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]);const bundle=await collectSources(brief,[{name:'one.png',file,size:8},{name:'two.png',file:'b'.repeat(64)+'.png',size:8}],async()=>png);
 const result=structuredClone(output);result.sources.push({id:'asset-0',summary:'採用する図'},{id:'asset-1',summary:'参考のみの図'});Object.assign(result.rows[0],{imageFile:file,imagePrompt:'',sourceIds:['text','asset-0']});
 assert.equal(normalizeSourcePlan(result,bundle,['Kore']).storyboard.scenes[0].imageFile,file);
 const reused=await collectSources(brief,[{name:'bgm.mp3',file:'c'.repeat(64)+'.mp3',size:12,origin:'generated-music'}],()=>{throw Error('BGM must not be sent as source');});assert.equal(reused.sources.length,1);
});
test('image endpoint enforces consent, revision, mode and references before spending; success preserves narration',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mixed-images-'));t.after(()=>rm(dir,{recursive:true,force:true}));const session=await NarrationSession.open({outputDir:dir});await session.appendRow({id:'one',caption:'制作します。',speech:'せいさくします。'});
 const production=await ProductionInputs.open(dir);await production.saveBrief(brief);const service=await startServer({session,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty')});t.after(()=>service.close());const {token}=await(await fetch(service.url+'/api/bootstrap')).json();
 const originalFetch=globalThis.fetch;let calls=0;session.setKey('test-only-key');
 globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://generativelanguage.googleapis.com/')){calls++;return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}}]}}]}));}return originalFetch(url,options);};t.after(()=>{globalThis.fetch=originalFetch;});
 const get=async()=> (await fetch(service.url+'/api/status')).json();const post=async(input)=>(await fetch(service.url+'/api/generate-image',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify(input)})).json();
 const state=await get(),input={id:'one',prompt:'机',references:[],revision:state.revision,productionRevision:state.productionRevision,consent:true};
 assert.equal((await post({...input,consent:false})).error,'GENERATION_CONSENT_REQUIRED');assert.equal((await post({...input,productionRevision:'stale'})).error,'STALE_REVISION');assert.equal((await post({...input,references:[file]})).error,'INVALID_IMAGE_REFERENCES');assert.equal(calls,0);
 const before=await readFile(path.join(dir,'job.json'));const result=await post(input);assert.equal(result.error,null);assert.equal(calls,1);assert.equal(result.production.assets[0].origin,'generated-image');assert.ok(result.rows[0].cutImage);assert.deepEqual(await readFile(path.join(dir,'job.json')),before);
 assert.equal((await post(input)).error,'STALE_REVISION');assert.equal(calls,1);
 const p=await ProductionInputs.open(dir);assert.equal(p.status().assets[0].origin,'generated-image');
});
test('BGM is persisted, sealed, and rejected when narration or settings change',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bgm-state-'));t.after(()=>rm(dir,{recursive:true,force:true}));const p=await ProductionInputs.open(dir),mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(32)]);await p.addAsset('bgm.mp3',mp3,{origin:'generated-music'});
 const current={title:'漫画',rows},music={file:p.status().assets[0].file,signature:musicSignature(current),direction:'明るく',model:'lyria-3.5',durationSeconds:30,level:.16};const before=p.finalInputsHash();await p.saveMusic(music);assert.notEqual(p.finalInputsHash(),before);p.assertMusicCurrent(current);
 const reopened=await ProductionInputs.open(dir);assert.deepEqual(reopened.status().music,music);assert.throws(()=>reopened.assertMusicCurrent({...current,title:'変更'}),/STALE_MUSIC/);
 await p.saveMusic({...music,level:.08});assert.notEqual(p.finalInputsHash(),reopened.finalInputsHash());p.value.finalization={revision:'a'.repeat(64),inputsHash:p.finalInputsHash()};await assert.rejects(p.saveMusic(null),/VIDEO_FINALIZED/);
 await reopened.saveMusic(null);assert.equal(reopened.status().music,undefined);reopened.assertMusicCurrent({...current,title:'変更'});
});
test('pending generated image blocks confirmation even when no image was supplied',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pending-art-'));t.after(()=>rm(dir,{recursive:true,force:true}));const p=await ProductionInputs.open(dir),plan=normalizeSourcePlan(output,await collectSources(brief,[],()=>{}),['Kore']);await p.saveBrief({...brief,...plan});
 const row={...rows[0],caption:output.rows[0].caption,listenedCurrent:true};assert.equal(p.cutInfo(row).cutFingerprint,null);await assert.rejects(p.confirmCut(row,'any'),/CUT_IMAGE_REQUIRED/);
 const textPlan=structuredClone(plan);delete textPlan.storyboard.scenes[0].imagePrompt;delete textPlan.storyboard.scenes[0].imageReferences;await p.saveBrief({...brief,assetMode:'provided',...textPlan});assert.ok(p.cutInfo(row).cutFingerprint);
});
test('canceled media generation releases busy state and never retries',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'media-cancel-'));t.after(()=>rm(dir,{recursive:true,force:true}));const s=await NarrationSession.open({outputDir:dir});s.setKey('test-only-key');const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,{signal})=>{calls++;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));};t.after(()=>{globalThis.fetch=original;});
 const result=s.generateMedia('image',{prompt:'制作の机'});s.cancel();await assert.rejects(result,/CANCELED/);assert.equal(calls,1);assert.equal(s.busy,false);assert.equal(s.status().keyConfigured,true);
});

test('bookend image exemption is limited to title; ED extends music timing and saved year survives reopening',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bookend-boundary-'));t.after(()=>rm(dir,{recursive:true,force:true}));const p=await ProductionInputs.open(dir);await p.addAsset('body.png',Buffer.from([137,80,78,71,13,10,26,10]));
 await p.saveBookends({titleRowId:'intro',endLabel:'制作',endUrl:'https://example.com',owner:'Author',creationYear:2021,endSeconds:4});
 assert.equal(p.imageRequired({id:'intro'}),false);assert.equal(p.imageRequired({id:'body'}),true);await assert.rejects(p.assignCutImage({id:'intro'},p.status().assets[0].file),/TITLE_IMAGE_NOT_ALLOWED/);
 assert.equal((await ProductionInputs.open(dir)).status().bookends.creationYear,2021);
 const current={title:'制作',rows,pauseSeconds:.8};assert.equal(musicTimeline({...current,bookends:p.status().bookends}).durationInFrames,musicTimeline(current).durationInFrames+120);
 assert.throws(()=>musicTimeline({...current,bookends:{endSeconds:-4}}),/INVALID_BOOKENDS/);
});

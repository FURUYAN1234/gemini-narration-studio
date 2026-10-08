import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NarrationSession, applyDictionary, inspectReading, decodeAudio, buildRequest,parseGoogleJson} from '../core.mjs';
import {startServer} from '../server.mjs';
import {prepareReviewedAudio} from '../client.mjs';
import {ProductionInputs} from '../production.mjs';
import {themeTokens} from '../themes.mjs';
import {atomicWrite} from '../atomic-write.mjs';
import {loadLocalFont} from '../font-loader.mjs';

const row = {id:'intro', caption:'APIで動画を作ります。', speech:'エー・ピー・アイで動画を作ります。'};

test('JSON response parsing distinguishes envelope text failures without exposing response content',()=>{
 const response=parts=>({candidates:[{finishReason:'STOP',content:{parts}}]});
 assert.deepEqual(parseGoogleJson(response([{thought:true,text:'private thought'},{text:'{"rows":'},{text:'[]}'}])),{rows:[]});
 for(const value of ['```json\n{"rows":[]}\n```','```\n{"rows":[]}\n```'])assert.deepEqual(parseGoogleJson(response([{text:value}])),{rows:[]});
 for(const value of ['', 'private text that is not JSON', 'prefix ```json\n{}\n```', '```json\n{}\n```\n```json\n{}\n```'])assert.throws(()=>parseGoogleJson(response([{text:value}])),e=>{assert.match(e.message,/PROVIDER_(INVALID_RESPONSE|EMPTY_TEXT)/);assert.match(e.providerDiagnostic,/textParts=1; characters=\d+; markdownFence=(true|false)/);assert.ok(!e.providerDiagnostic.includes('private'));return true;});
 assert.throws(()=>parseGoogleJson({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]}),/PROVIDER_INCOMPLETE_TEXT/);
});

test('a complete JSON object survives only an exact repeated trailing fragment, without repairing or choosing data',()=>{
 const response=(text,finishReason='STOP')=>({candidates:[{finishReason,content:{parts:[{text}]}}]});
 for(const result of [{rows:[{caption:'別の入力。',speech:'べつのにゅうりょく。'}],template:'editorial'},{rows:[{caption:'記号 } と \\" を含む。'}],title:'短い結び'}]){
  const json=JSON.stringify(result),tail=json.slice(json.lastIndexOf(':')+2);
  assert.deepEqual(parseGoogleJson(response(json+'\n'+tail+'\n')),result);
  assert.deepEqual(parseGoogleJson(response(json)),result);
 }
 for(const text of ['{"rows":[]}\n{"rows":[1]}','{"rows":[]}\nother text','{"rows":[}', '{"rows":[]','prefix {"rows":[]}', '{"rows":[]}\n[1]'])assert.throws(()=>parseGoogleJson(response(text)),/PROVIDER_INVALID_RESPONSE/);
 assert.throws(()=>parseGoogleJson(response('{"rows":[]}\n}', 'MAX_TOKENS')),/PROVIDER_INCOMPLETE_TEXT/);
});
test('manual adoption is local, persists missing readings, and is idempotent',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'studio-adoption-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const session=await NarrationSession.open({outputDir:dir,draftProvider:()=>{throw Error('must not call provider');}});
 await session.adoptScript('最初の本文。\n次の本文。',{expectedRevision:session.revision()});
 assert.equal(session.status().rows.length,2);assert.equal(session.status().rows[0].speech,'');
 await assert.rejects(session.approve(session.status().rows[0].id,session.revision()),/READING_PREPARATION_REQUIRED/);
 await session.adoptScript('最初の本文。\n次の本文。',{expectedRevision:session.revision()});assert.equal(session.status().rows.length,2);
 const reopened=await NarrationSession.open({outputDir:dir});assert.equal(reopened.status().rows[0].readingState,'pending');assert.equal(reopened.status().rows[0].reviewed,false);
});
test('font loading blocks render until ready and cancels on failure without rendering blank glyphs',async()=>{
  const events=[];let finish;
  const options={FontFace:class {load(){events.push('load');return new Promise(resolve=>finish=resolve);}},fonts:{add(){events.push('add');}},url:'/assets/font.ttf',family:'NarrationJapanese',delayRender:()=>{events.push('delay');return 7;},continueRender:h=>{assert.equal(h,7);events.push('continue');},cancelRender:()=>events.push('cancel')};
  const pending=loadLocalFont(options);assert.deepEqual(events,['delay','load']);finish();assert.equal(await pending,true);assert.deepEqual(events,['delay','load','add','continue']);
  events.length=0;options.FontFace=class {async load(){throw new Error('font missing');}};assert.equal(await loadLocalFont(options),false);assert.deepEqual(events,['delay','cancel']);
});
test('font loading can clear the component-owned render handle without creating a module-time handle',async()=>{
 const events=[];
 const options={handle:42,FontFace:class {async load(){events.push('loaded');}},fonts:{add(){events.push('added');}},url:'/local.ttf',family:'Japanese',delayRender:()=>{throw new Error('unexpected second handle');},continueRender:h=>events.push(h),cancelRender:()=>events.push('failed')};
 assert.equal(await loadLocalFont(options),true);assert.deepEqual(events,['loaded','added',42]);
 options.FontFace=class {async load(){throw new Error('font unavailable');}};assert.equal(await loadLocalFont(options),false);assert.equal(events.at(-1),'failed');
});
test('presentation starts font blocking at component mount after Remotion modules finish initialization',async()=>{
 const source=await readFile(new URL('../presentation.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/if\(typeof document[^\n]+loadLocalFont/);
 assert.match(source,/useState\(\(\)=>delayRender\('Load presentation Japanese font'\)\)/);
 assert.match(source,/useEffect\(\(\)=>\{void loadLocalFont\(\{handle/);
});
function wav() {
  const b=Buffer.alloc(48); b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;
}
async function setup(t, provider) {
  const dir=await mkdtemp(path.join(tmpdir(),'narration-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const s=await NarrationSession.open({outputDir:dir, provider});
  await (await ProductionInputs.open(dir)).saveMusicEnabled(false);await s.replaceJob({title:'回帰テスト',rows:[row]});return {s,dir};
}
test('dictionary handles longest matches, treats terms literally and preserves captions',()=>{
  assert.equal(applyDictionary('AI API A+B',[{term:'AI',reading:'エーアイ'},{term:'API',reading:'エーピーアイ'},{term:'A+B',reading:'たす'}]),'エーアイ エーピーアイ たす');
  assert.equal(applyDictionary('これは自然な日本語です。',[]),'これは自然な日本語です。');
  assert.ok(inspectReading('APIを1回使う').some(x=>x.kind==='latin'));
  assert.ok(inspectReading('APIを1回使う').some(x=>x.kind==='number'));
});
test('unreviewed rows and absent credentials block requests before provider execution',async t=>{
  let calls=0;const {s}=await setup(t,async()=>{calls++;return wav();});
  await assert.rejects(s.generate(['intro']),/API_KEY_REQUIRED/);
  s.setKey('test-only-key');
  await assert.rejects(s.generate(['intro']),/READING_REVIEW_REQUIRED/);assert.equal(calls,0);
});
test('explicit approval is tied to exact caption and reading; edits revoke it',async t=>{
  const {s}=await setup(t,async()=>wav());s.setKey('test-only-key');
  const revision=s.status().revision;
  await assert.rejects(s.approve('intro','stale'),/STALE_REVISION/);
  await s.approve('intro',revision);
  assert.equal(s.status().rows[0].reviewed,true);
  await s.updateRow('intro',{speech:'えーぴーあいで動画を作ります。'});
  assert.equal(s.status().rows[0].reviewed,false);
  await assert.rejects(s.generate(['intro']),/READING_REVIEW_REQUIRED/);
});
test('approved synthesis uses Gemini request shape and yields caption/audio manifest without key',async t=>{
  let args;const {s,dir}=await setup(t,async a=>{args=a;return wav();});s.setKey('test-only-key');
  await s.approve('intro',s.status().revision);await s.generate(['intro']);
  assert.equal(args.settings.model,'gemini-3.8-flash-tts');assert.equal(args.text,row.speech);
  await assert.rejects(s.exportManifest(),/AUDIO_LISTEN_REQUIRED/);
  await s.markListened('intro',s.status().revision);
  const manifest=await s.exportManifest();assert.equal(manifest.rows[0].caption,row.caption);assert.equal(manifest.rows[0].durationSeconds,4/48000);
  assert.ok(!JSON.stringify(s.status()).includes('test-only-key'));
  for(const name of await readdir(dir))if(name.endsWith('.json'))assert.ok(!(await readFile(path.join(dir,name),'utf8')).includes('test-only-key'));
});
test('provider errors are sanitized, have no fallback or retry, and retain previous audio',async t=>{
  let calls=0;const {s}=await setup(t,async()=>{if(++calls>1)throw new Error('test-only-key Authorization: Bearer abcdef provider diagnostic');return wav();});s.setKey('test-only-key');
  await s.approve('intro',s.status().revision);await s.generate(['intro']);const first=s.status().rows[0].audio;
  await assert.rejects(s.generate(['intro']),/REGENERATION_CONFIRM_REQUIRED/);
  await assert.rejects(s.generate(['intro'],{regenerate:true}),/PROVIDER_FAILED/);
  assert.equal(calls,2);assert.deepEqual(s.status().rows[0].audio,first);
  assert.ok(!JSON.stringify(s.status()).includes('test-only-key'));assert.ok(!JSON.stringify(s.status()).includes('abcdef'));
});
test('stale concurrent edits and duplicate requests fail closed; loading clears',async t=>{
  let release,entered;const ready=new Promise(r=>entered=r);const {s}=await setup(t,async()=>{await new Promise(r=>{release=r;entered();});return wav();});s.setKey('test-only-key');await s.approve('intro',s.status().revision);
  const pending=s.generate(['intro']);
  await assert.rejects(s.generate(['intro']),/BUSY/);
  await assert.rejects(s.updateRow('intro',{speech:'変更'}),/BUSY/);
  await ready;release();await pending;assert.equal(s.status().busy,false);
});
test('persisted job restores reading and audio but never credentials; changed settings invalidate audio',async t=>{
  const {s,dir}=await setup(t,async()=>wav());s.setKey('test-only-key');await s.approve('intro',s.status().revision);await s.generate(['intro']);
  const restored=await NarrationSession.open({outputDir:dir,provider:async()=>wav()});assert.equal(restored.status().keyConfigured,false);
  await restored.configure({model:'gemini-3.8-flash-lite-tts',voice:'Kore',style:'落ち着いて'});
  assert.equal(restored.status().rows[0].audioCurrent,false);
  await assert.rejects(restored.exportManifest(),/AUDIO_REQUIRED/);
});
test('strict input boundary rejects credentials, markup, unknown models, duplicate ids and blank readings',async t=>{
  const {s}=await setup(t,async()=>wav());
  await assert.rejects(s.updateRow('intro',{speech:''}),/EMPTY_SPEECH/);
  await assert.rejects(s.updateRow('intro',{caption:'AIza'+'a'.repeat(35)}),/CREDENTIAL/);
  await assert.rejects(s.updateRow('intro',{speech:'<script>alert(1)</script>'}),/MARKUP/);
  await assert.rejects(s.configure({model:'other',voice:'Kore',style:''}),/MODEL/);
  await assert.rejects(s.replaceJob({title:'x',rows:[row,row]}),/DUPLICATE/);
  assert.equal(s.status().rows[0].caption,row.caption);
});
test('audio parser accepts WAV and Interactions audio output; rejects missing/truncated audio',()=>{
  const audio=wav();const result={outputs:[{type:'audio',mime_type:'audio/wav',data:audio.toString('base64')}]};
  assert.deepEqual(decodeAudio(result).bytes,audio);
  assert.throws(()=>decodeAudio({outputs:[]}),/AUDIO/);
  assert.throws(()=>decodeAudio({outputs:[{type:'audio',mime_type:'audio/wav',data:Buffer.alloc(48).toString('base64')}]}),/WAV/);
  const request=buildRequest(row.speech,{model:'gemini-3.8-flash-tts',voice:'Kore',style:'落ち着いて'});
  assert.equal(request.input[0].content[0].text,row.speech);assert.equal(request.input[0].content[0].annotations[0].style,'落ち着いて');
  assert.equal(request.store,false);assert.equal(request.response_format.mime_type,'audio/wav');
});
test('HTTP gate blocks foreign origin, missing CSRF, arbitrary paths and pre-review synthesis',async t=>{
  const {s}=await setup(t,async()=>wav());const service=await startServer({session:s,port:0});t.after(()=>service.close());
  const base=service.url;const boot=await (await fetch(base+'/api/bootstrap')).json();
  const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token,...headers},body:JSON.stringify(body)});
  assert.equal((await post('/api/key',{key:'test-only-key'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(base+'/api/key',{method:'POST',body:'{}'})).status,403);
  assert.equal((await post('/api/key',{key:'test-only-key'})).status,200);
  assert.equal((await post('/api/generate',{ids:['intro'],consent:true})).status,409);
  assert.equal((await fetch(base+'/audio/..%2F..%2F.env')).status,404);
  assert.ok(!(await (await fetch(base+'/api/status')).text()).includes('test-only-key'));
});
test('renderer adapter copies reviewed audio and refuses manifests after a reading edit',async t=>{
  const {s,dir}=await setup(t,async()=>wav());s.setKey('test-only-key');await s.approve('intro',s.status().revision);await s.generate(['intro']);await s.markListened('intro',s.status().revision);await s.exportManifest();
  await (await ProductionInputs.open(dir)).finalize(s.status());
  const publicDir=path.join(dir,'public');const data=await prepareReviewedAudio({sourceDir:dir,publicDir});assert.equal(data.rows[0].caption,row.caption);assert.equal(data.rows[0].frames,1);assert.ok(data.rows[0].src.startsWith('narration/'));
  await s.updateRow('intro',{speech:'新しい読み'});
  await assert.rejects(prepareReviewedAudio({sourceDir:dir,publicDir}),/READING_REVIEW_REQUIRED/);
});
test('appending a row and changing title preserve previous approvals and audio candidates',async t=>{
  const {s}=await setup(t,async()=>wav());s.setKey('test-only-key');await s.approve('intro',s.status().revision);await s.generate(['intro']);
  const audio=s.status().rows[0].audio;await s.appendRow({id:'second',caption:'次の行',speech:'つぎのぎょう'});await s.setTitle('別のタイトル');
  assert.equal(s.status().rows[0].reviewed,true);assert.deepEqual(s.status().rows[0].audio,audio);assert.equal(s.status().rows[1].reviewed,false);
});
test('three downloaded presentation themes are executable local color sources',async()=>{
  for(const name of ['moon','black','white']){const theme=await themeTokens(name);assert.match(theme.background,/^#[0-9a-f]{3,8}$/i);assert.notEqual(theme.background,theme.heading);}
  await assert.rejects(themeTokens('../secret'),/INVALID_THEME/);
});
test('presentation theme changes survive restart without invalidating already reviewed audio',async t=>{
  const {s,dir}=await setup(t,async()=>wav());s.setKey('test-only-key');await s.approve('intro',s.status().revision);await s.generate(['intro']);await s.markListened('intro',s.status().revision);
  await s.setTheme('white');assert.equal(s.status().rows[0].audioCurrent,true);assert.equal(s.status().rows[0].listenedCurrent,true);
  const manifest=await s.exportManifest();assert.equal(manifest.presentation.theme,'white');
  const restored=await NarrationSession.open({outputDir:dir});assert.equal(restored.status().presentation.theme,'white');
});
test('current Interactions steps envelope is parsed and incomplete output is rejected',()=>{
  const block={type:'audio',mime_type:'audio/wav',data:wav().toString('base64')};
  assert.equal(decodeAudio({status:'completed',steps:[{type:'model_output',content:[block]}]}).durationSeconds,4/48000);
  assert.throws(()=>decodeAudio({status:'incomplete',steps:[{type:'model_output',content:[block]}]}),/INCOMPLETE/);
});
test('atomic save retries a transient Windows lock without removing old data or making API calls',async t=>{
  const {dir}=await setup(t,async()=>wav());const file=path.join(dir,'save.json');let attempts=0,waits=0;
  const {writeFile,rename}=await import('node:fs/promises');await writeFile(file,'old');
  await atomicWrite(file,'new',{renameFile:async(a,b)=>{assert.equal(await readFile(file,'utf8'),'old');if(++attempts<3)throw Object.assign(new Error('locked'),{code:'EPERM'});await rename(a,b);},wait:async ms=>{waits++;await new Promise(resolve=>setTimeout(resolve,ms));}});
  // Real Windows indexers may add locks beyond the two deliberately injected failures.
  assert.equal(await readFile(file,'utf8'),'new');assert.ok(attempts>=3&&attempts<=6);assert.equal(waits,attempts-1);
});
test('existing job replacement needs exact session/revision and explicit replacement consent',async t=>{
  const {s}=await setup(t,async()=>wav());const next={title:'新しいジョブ',rows:[{id:'next',caption:'次',speech:'つぎ'}]};
  await assert.rejects(s.replaceJob(next),/JOB_REPLACE_CONFIRM_REQUIRED/);
  await assert.rejects(s.replaceJob(next,{confirmReplace:true,expectedRevision:s.status().revision,sessionId:'other'}),/SESSION_MISMATCH/);
  await assert.rejects(s.replaceJob(next,{confirmReplace:true,expectedRevision:'old',sessionId:s.status().sessionId}),/STALE_REVISION/);
  await s.replaceJob(next,{confirmReplace:true,expectedRevision:s.status().revision,sessionId:s.status().sessionId});assert.equal(s.status().title,next.title);
});

test('pre-theme reviewed export migrates without re-synthesis; stale export never rewrites itself',async t=>{
  const {s,dir}=await setup(t,async()=>wav());delete s.job.presentation;
  s.setKey('test-only-key');await s.approve('intro',s.status().revision);await s.generate(['intro']);await s.markListened('intro',s.status().revision);await s.exportManifest();
  const file=path.join(dir,'narration-manifest.json'),original=await readFile(file,'utf8');
  const legacy=(await ProductionInputs.open(dir)).status();delete legacy.requiresFinalization;delete legacy.finalization;await writeFile(path.join(dir,'production.json'),JSON.stringify(legacy));
  const prepared=await prepareReviewedAudio({sourceDir:dir,publicDir:path.join(dir,'public')});
  assert.equal(prepared.presentation.theme,'moon');assert.equal(await readFile(file,'utf8'),original);
  await s.setTitle('Changed after export');
  for(let i=0;i<2;i++)await assert.rejects(prepareReviewedAudio({sourceDir:dir,publicDir:path.join(dir,'public')}),/STALE_AUDIO_MANIFEST/);
  assert.equal(await readFile(file,'utf8'),original);
});

test('reference intake: source planning accepts a URL without instructions and rejects empty or unread URLs without retry',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'studio-reference-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const session=await NarrationSession.open({outputDir:dir});session.setKey('test-only-key');let calls=0,retrieved=true;
 const url='https://example.com/article';
 const result={visualStyle:'白地に青い文字',title:'資料の説明',summary:'資料を解説',voice:'Kore',voiceReason:'明瞭な説明',motion:{version:1,style:'editorial',intensity:'standard'},sources:[{id:'url-0',summary:'参考資料'}],rows:[{purpose:'detail',caption:'資料を説明します。',speech:'しりょうをせつめいします。',title:'資料',points:[],imageFile:'',sourceIds:['url-0']}]};
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({candidates:[{finishReason:'STOP',urlContextMetadata:{urlMetadata:[{retrievedUrl:url,urlRetrievalStatus:retrieved?'URL_RETRIEVAL_STATUS_SUCCESS':'URL_RETRIEVAL_STATUS_ERROR'}]},content:{parts:[{text:JSON.stringify(result)}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});});
 const brief={scriptMode:'ai',assetMode:'provided',instructions:'',script:'',references:{text:'',urls:[url]}};
 assert.equal((await session.planSources(brief,[],()=>{})).script,result.rows[0].caption);assert.equal(calls,1);
 await assert.rejects(session.planSources({...brief,references:{text:'',urls:[]}},[],()=>{}),/REFERENCE_REQUIRED/);assert.equal(calls,1);
 retrieved=false;await assert.rejects(session.planSources(brief,[],()=>{}),/SOURCE_URL_NOT_RETRIEVED/);assert.equal(calls,2);
});

test('script authoring: AI theme is a typed opt-in, supplies instructions once, and never rewrites an existing script implicitly',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'studio-authoring-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0,received;
 const session=await NarrationSession.open({outputDir:dir,draftProvider:async input=>{calls++;received=input.brief;return {rows:[{caption:'AIが選んだテーマ。',speech:'えーあいがえらんだてーま。'}]};}});session.setKey('test-only-key');
 const brief={scriptMode:'ai',assetMode:'ai',instructions:'',script:''};await assert.rejects(session.draftScript(brief),/EMPTY_INSTRUCTIONS/);await assert.rejects(session.draftScript({...brief,themeAuto:'yes'}),/INVALID_THEME_PREFERENCE/);assert.equal(calls,0);
 await session.draftScript({...brief,themeAuto:true});assert.equal(calls,1);assert.ok(received.instructions);assert.equal(received.themeAuto,true);assert.equal(session.status().rows.length,0);
 await assert.rejects(session.draftScript({...brief,scriptMode:'existing',themeAuto:true,script:'手入力の台本。'}),/EMPTY_INSTRUCTIONS/);assert.equal(calls,1);
 const production=await ProductionInputs.open(dir);await production.saveBrief({...brief,themeAuto:true,scriptEdited:true});const saved=(await ProductionInputs.open(dir)).status().brief;assert.equal(saved.themeAuto,true);assert.equal(saved.scriptEdited,true);assert.equal(saved.script,'');
 await assert.rejects(production.saveBrief({...brief,scriptEdited:'yes'}),/INVALID_SCRIPT_EDIT_PREFERENCE/);
});

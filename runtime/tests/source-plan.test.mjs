import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeReferences,normalizeBrief,ProductionInputs} from '../production.mjs';
import {collectSources,buildSourcePlanRequest,normalizeSourcePlan,MAX_SOURCE_BYTES} from '../source-plan.mjs';
import {NarrationSession,VOICES,classifyGoogleFailure,redactProviderDiagnostic,prepareGooglePayload,buildDraftRequest} from '../core.mjs';
import {startServer} from '../server.mjs';
const file='a'.repeat(64)+'.png',brief={scriptMode:'ai',assetMode:'provided',script:'',instructions:'説明動画',references:{text:'中央の丸が入口です。',urls:[]}};
const focus={x:.5,y:.4,zoom:1.6,label:'入口'},output={title:'入口から始めよう',summary:'入口の説明',voice:'Kore',voiceReason:'落ち着いた説明',motion:{version:1,style:'editorial',intensity:'standard'},sources:[{id:'text',summary:'入口は中央の丸。'}],rows:[{caption:'入口は中央です。',speech:'いりぐちはちゅうおうです。',title:'中央から',points:['入口'],imageFile:'',sourceIds:['text']}]};
test('references reject local URLs, credentials, limits and non-HTTP protocols',()=>{
 assert.deepEqual(normalizeReferences({text:'本文',urls:['https://example.com/a#b','https://example.com/a']}),{text:'本文',urls:['https://example.com/a']});
 for(const url of ['file:///etc/passwd','http://127.0.0.1/a','http://[::1]/','http://localhost/a','https://x.local/a','https://a:b@example.com','https://example.com:444','https://example.com?token=secret'])assert.throws(()=>normalizeReferences({text:'',urls:[url]}),/INVALID_REFERENCE/);
 assert.throws(()=>normalizeReferences({text:'AIza'+'x'.repeat(30),urls:[]}),/CREDENTIAL/);
 assert.throws(()=>normalizeReferences({text:'',urls:Array(11).fill('https://example.com')}),/INVALID_REFERENCES/);
});
test('request sends actual bounded material contents, no file system paths or executable tools',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]);let reads=0;
 const bundle=await collectSources(brief,[{name:'figure.png',file,size:png.length}],async()=>{reads++;return png;});
 const request=buildSourcePlanRequest({brief,bundle,voices:VOICES});assert.equal(reads,1);assert.equal(request.contents[0].parts.at(-1).inlineData.data,png.toString('base64'));assert.match(JSON.stringify(request),/中央の丸/);assert.equal(request.tools,undefined);
 await assert.rejects(collectSources(brief,[{name:'large.png',file,size:MAX_SOURCE_BYTES+1}],()=>{throw Error('must not read')}),/SOURCE_SIZE_LIMIT/);
 await assert.rejects(collectSources({...brief,references:{text:'',urls:[]}},[],()=>{}),/REFERENCE_REQUIRED/);
 const withURL=await collectSources({...brief,references:{text:'',urls:['https://example.com/']}},[],()=>{});assert.deepEqual(buildSourcePlanRequest({brief,bundle:withURL,voices:VOICES}).tools,[{url_context:{}}]);
});
test('source plan rejects invented citations, missing retrieval evidence, stale readings, unknown images/voices',async()=>{
 const bundle=await collectSources(brief,[],()=>{});const valid=normalizeSourcePlan(output,bundle,VOICES);assert.equal(valid.storyboard.title,output.title);assert.equal(valid.readings[0].speech,output.rows[0].speech);
 for(const mutate of [r=>r.voice='Unknown',r=>r.rows[0].sourceIds=['made-up'],r=>r.rows[0].imageFile=file,r=>r.rows[0].speech='漢字',r=>r.sources=[],r=>r.rows[0].imageFocus=focus]){const changed=structuredClone(output);mutate(changed);assert.throws(()=>normalizeSourcePlan(changed,bundle,VOICES));}
 const url='https://example.com/',urlBundle={sources:[{id:'url-0',label:url,kind:'url'}],urls:[url]},r={...structuredClone(output),sources:[{id:'url-0',summary:'入口の説明'}]};r.rows[0].sourceIds=['url-0'];
 assert.throws(()=>normalizeSourcePlan(r,urlBundle,VOICES),/SOURCE_URL_NOT_RETRIEVED/);
 assert.throws(()=>normalizeSourcePlan(r,urlBundle,VOICES,{urlMetadata:[{retrievedUrl:url,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_ERROR'}]}),/SOURCE_URL_NOT_RETRIEVED/);
 assert.equal(normalizeSourcePlan(r,urlBundle,VOICES,{urlMetadata:[{retrievedUrl:url,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_SUCCESS'}]}).storyboard.sources[0].status,'retrieved');
 assert.throws(()=>normalizeBrief({...brief,...valid,script:'書き換えた。'}),/STALE/);
});

test('source request uses the documented responseFormat without conflicting legacy fields',async()=>{
 const request=buildSourcePlanRequest({brief,bundle:await collectSources(brief,[],()=>{}),voices:VOICES});
 const config=request.generationConfig;
 assert.equal(config.responseFormat?.text.mimeType,'APPLICATION_JSON');
 assert.equal(config.responseFormat.text.schema.properties.voice.enum,VOICES);
 assert.deepEqual(config.responseFormat.text.schema.required,['title','summary','voice','voiceReason','motion','sources','rows']);
 for(const key of ['responseMimeType','responseSchema','responseJsonSchema','_responseJsonSchema'])assert.equal(Object.hasOwn(config,key),false);
});
test('UI HTTP save/import carries storyboard into actual scene visuals, without synthesis or approval',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'source-plan-'));t.after(()=>rm(dir,{recursive:true,force:true}));const session=await NarrationSession.open({outputDir:dir,correctionProvider:async({rows})=>rows.map(r=>({id:r.id,caption:'入口を見ます。',speech:'いりぐちをみます。',title:'入口を見る',points:['入口'],imagePrompt:''}))});
 const service=await startServer({session,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty')});t.after(()=>service.close());const {token}=await(await fetch(service.url+'/api/bootstrap')).json();
 const post=(route,input)=>fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify(input)});
 assert.equal((await post('source-plan',{brief,consent:false,revision:session.revision()})).status,409);
 assert.equal((await post('source-plan',{brief,consent:true,revision:'stale'})).status,409);
 const result=normalizeSourcePlan(output,await collectSources(brief,[],()=>{}),VOICES);
 assert.equal((await post('production',{...brief,...result,titleMode:'auto',voiceMode:'manual'})).status,200);
 assert.equal((await post('append-script',{script:result.script})).status,200);
 const state=await(await fetch(service.url+'/api/status')).json(),row=state.rows.at(-1);
 assert.equal(row.cutVisual.title,'中央から');assert.equal(state.presentation.motion.style,'editorial');assert.equal(row.reviewed,false);assert.equal(row.audio,null);assert.equal(state.production.finalization,null);
 assert.deepEqual((await ProductionInputs.open(dir)).status().brief.storyboard,result.storyboard);
 assert.equal((await post('append-script',{script:result.script})).status,200);assert.equal(session.status().rows.length,state.rows.length);
 session.setKey('test-only-key');const correction=await post('apply-review',{consent:true,expectedRevision:session.revision(),review:{version:1,sourceRevision:'',overall:'短く修正',cuts:[]}});const corrected=await correction.json();assert.equal(correction.status,200,JSON.stringify(corrected));assert.equal(corrected.production.brief.storyboard,undefined);assert.equal(session.status().rows.at(-1).caption,'入口を見ます。');
 const p=await ProductionInputs.open(dir),png=Buffer.from([137,80,78,71,13,10,26,10]);await p.addAsset('one.png',png);await p.addAsset('two.png',Buffer.concat([png,Buffer.from([1])]));const images=p.status().assets;await p.assignCutImage(row,images[0].file);await p.saveVisuals({[row.id]:{title:'入口',points:[],imageFocus:focus}},session.status().rows);await p.assignCutImage(row,images[0].file);assert.deepEqual(p.status().visuals[row.id].imageFocus,focus);await p.assignCutImage(row,images[1].file);assert.equal(p.status().visuals[row.id].imageFocus,undefined);assert.equal(p.status().visuals[row.id].title,'入口');
});

test('Google failure reason is categorized without returning echoed credentials or raw provider content',()=>{
 for(const [body,expected]of [[{error:{message:'API key not valid. Please pass a valid API key.',details:[{reason:'API_KEY_INVALID',metadata:{key:'never-output-secret'}}]}},'PROVIDER_INVALID_API_KEY'],[{error:{message:'Invalid responseJsonSchema value: never-output-secret'}},'PROVIDER_SCHEMA_REJECTED'],[{error:{message:'Unable to decode invalid image: never-output-secret'}},'PROVIDER_MEDIA_REJECTED'],[{error:{message:'arbitrary never-output-secret'}},'PROVIDER_BAD_REQUEST']])assert.equal(classifyGoogleFailure(400,body),expected);
 assert.equal(classifyGoogleFailure(403,{error:{details:[{reason:'API_KEY_HTTP_REFERRER_BLOCKED'}]}}),'PROVIDER_KEY_RESTRICTED');
 assert.equal(classifyGoogleFailure(400,{error:{message:`Invalid value at 'generation_config.response_format.text.mime_type' (TextResponseFormat.MimeType), "application/json"`}}),'PROVIDER_OUTPUT_FORMAT_REJECTED');
});

test('connection diagnosis makes only a model-read request and returns no credential or raw body',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'source-connect-'));t.after(()=>rm(dir,{recursive:true,force:true}));const s=await NarrationSession.open({outputDir:dir});s.setKey('test-only-key');const prior=globalThis.fetch;let count=0;globalThis.fetch=async(url,options)=>{count++;assert.match(url,/models\/gemini-3\.5-flash$/);assert.equal(options.method,undefined);return new Response(JSON.stringify({error:{message:'API key not valid.',details:[{reason:'API_KEY_INVALID',metadata:{value:'test-only-key'}}]}}),{status:400});};t.after(()=>{globalThis.fetch=prior;});await assert.rejects(s.checkConnection(),/^Error: PROVIDER_INVALID_API_KEY: HTTP 400$/);assert.equal(count,1);assert.equal(s.busy,false);assert.ok(!JSON.stringify(s.status()).includes('test-only-key'));
});

test('diagnostic preserves technical reason while removing exact key, request content and encoded media',()=>{
 const key='test-only-key',content='private reference sentence',raw='Invalid argument generation_config. '+key+' '+content+' '+'a'.repeat(120)+' https://example.com/?key='+key;
 const result=redactProviderDiagnostic({error:{message:raw}},key,{contents:[{parts:[{text:content}]}]});assert.match(result,/Invalid argument generation_config/);for(const value of [key,content,'a'.repeat(40),'https://'])assert.ok(!result.includes(value));
});

test('source inspection sends the real request to countTokens only and exposes redacted failure diagnostics',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'source-inspect-'));t.after(()=>rm(dir,{recursive:true,force:true}));const s=await NarrationSession.open({outputDir:dir});s.setKey('test-only-key');const prior=globalThis.fetch;let count=0;globalThis.fetch=async(url,options)=>{count++;assert.match(url,/:countTokens$/);const request=JSON.parse(options.body);assert.match(JSON.stringify(request),/中央の丸/);return new Response(JSON.stringify({error:{message:'Request validation failed: test-only-key'}}),{status:400});};t.after(()=>{globalThis.fetch=prior;});await assert.rejects(s.inspectSources(brief,[],()=>{}),/PROVIDER_BAD_REQUEST/);assert.equal(count,1);assert.equal(s.busy,false);assert.match(s.status().providerDiagnostic,/Request validation failed/);assert.ok(!JSON.stringify(s.status()).includes('test-only-key'));
});

test('minimal generation diagnosis requires consent, sends no project content and never changes production',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'source-probe-'));t.after(()=>rm(dir,{recursive:true,force:true}));const s=await NarrationSession.open({outputDir:dir});s.setKey('test-only-key');const revision=s.revision(),prior=globalThis.fetch;let count=0;globalThis.fetch=async(url,options)=>{count++;assert.match(url,/:generateContent$/);assert.deepEqual(JSON.parse(options.body),{contents:[{role:'user',parts:[{text:'Reply with exactly OK.'}]}]});return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'OK'}]}}]}));};t.after(()=>{globalThis.fetch=prior;});
 await assert.rejects(s.probeGeneration(),/GENERATION_CONSENT_REQUIRED/);assert.equal(count,0);assert.deepEqual(await s.probeGeneration({consent:true}),{ready:true,generation:true,model:'gemini-3.5-flash'});assert.equal(count,1);assert.equal(s.revision(),revision);assert.equal(s.busy,false);assert.ok(!JSON.stringify(s.status()).includes('test-only-key'));
});

test('JSON generation retains the contract and local guards without provider schema constraints',async()=>{
 for(const input of [buildDraftRequest({brief}),buildSourcePlanRequest({brief,bundle:await collectSources(brief,[],()=>{}),voices:VOICES})]){
  const before=JSON.stringify(input),prepared=prepareGooglePayload(input);
  assert.deepEqual(prepared.generationConfig.responseFormat,{text:{mimeType:'APPLICATION_JSON'}});
  assert.equal(prepared.generationConfig.maxOutputTokens,16384);
  assert.equal(Object.hasOwn(prepared.generationConfig,'responseJsonSchema'),false);
  assert.match(prepared.systemInstruction.parts.at(-1).text,/JSON contract:.*"caption".*"speech"/);
  assert.deepEqual(prepared.contents,input.contents);assert.equal(JSON.stringify(input),before);
  assert.deepEqual(prepareGooglePayload({generateContentRequest:input}).generateContentRequest,prepared);
 }
 const audio={model:'tts',input:'text'},image={generationConfig:{responseModalities:['IMAGE']}};
 assert.equal(prepareGooglePayload(audio),audio);assert.equal(prepareGooglePayload(image),image);
 const bundle=await collectSources(brief,[],()=>{});
 for(const change of [r=>r.voice='Unknown',r=>r.rows[0].sourceIds=['unknown'],r=>r.rows[0].speech='漢字',r=>r.motion.style='script']){const invalid=structuredClone(output);change(invalid);assert.throws(()=>normalizeSourcePlan(invalid,bundle,VOICES));}
});

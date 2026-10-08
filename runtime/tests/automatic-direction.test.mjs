import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NarrationSession,buildDraftRequest,buildDesignRequest} from '../core.mjs';
import {TRANSITION_FAMILIES,TRANSITION_TONES,TRANSITION_INSTRUCTION} from '../motion.mjs';
import {buildSourcePlanRequest,collectSources} from '../source-plan.mjs';
import {normalizeAutomaticDirection,VIDEO_TEMPLATES} from '../designs.mjs';
import {normalizeBrief} from '../production.mjs';

const direction={title:'手順の説明',template:'steps',motion:{version:1,style:'editorial',intensity:'standard',transitions:['split','blinds','fade'],transitionTones:['background','accent','image']}};
test('AI transition planning rides the existing draft, source and design request, never the manual path',async()=>{
 const brief={scriptMode:'ai',assetMode:'provided',instructions:'説明動画',script:'',autoDirection:true,references:{text:'提供情報',urls:[]}};
 const requests=[buildDraftRequest({brief}),buildDesignRequest({title:'説明',instructions:'静かに'}),buildSourcePlanRequest({brief,bundle:await collectSources(brief,[],()=>{}),voices:['Kore']})];
 for(const request of requests){assert.ok(request.systemInstruction.parts.some(p=>p.text===TRANSITION_INSTRUCTION));const schema=request.generationConfig.responseJsonSchema||request.generationConfig.responseFormat.text.schema;const m=schema.properties.direction?.properties.motion?.anyOf?.[0]||schema.properties.motion?.anyOf?.[0]||schema.properties.motion;assert.deepEqual(m.properties.transitions.items.enum,TRANSITION_FAMILIES);}
 for(const request of requests){const schema=request.generationConfig.responseJsonSchema||request.generationConfig.responseFormat.text.schema,m=schema.properties.direction?.properties.motion?.anyOf?.[0]||schema.properties.motion?.anyOf?.[0]||schema.properties.motion;assert.deepEqual(m.properties.transitionTones.items.enum,TRANSITION_TONES);}
 assert.equal(buildDraftRequest({brief:{...brief,autoDirection:false}}).systemInstruction.parts.some(p=>p.text===TRANSITION_INSTRUCTION),false);
});
test('automatic direction permits catalog choices and quiet motion, rejects invented or executable output',()=>{
 assert.deepEqual(normalizeAutomaticDirection(direction),direction);
 assert.equal(normalizeAutomaticDirection({...direction,motion:null}).motion,null);
 for(const invalid of [{...direction,template:'unknown'},{...direction,title:''},{...direction,code:'alert(1)'},{...direction,motion:{style:'custom'}}])assert.throws(()=>normalizeAutomaticDirection(invalid));
 assert.deepEqual(normalizeBrief({scriptMode:'ai',assetMode:'mixed',instructions:'解説',script:'',autoDirection:true,direction}).direction,direction);
 assert.throws(()=>normalizeBrief({scriptMode:'ai',assetMode:'mixed',instructions:'',script:'',autoDirection:'yes'}));
});
test('automatic title/template/motion comes from the same drafting call; manual and pronunciation-only paths do not require it',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'auto-direction-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0,result={rows:[{caption:'手順を説明します。',speech:'てじゅんをせつめいします。'}],direction};
 const session=await NarrationSession.open({outputDir:dir,draftProvider:async()=>{calls++;return result;}});session.setKey('test-only-key');
 const brief={scriptMode:'ai',assetMode:'mixed',instructions:'手順の説明',script:'',autoDirection:true};
 const draft=await session.draftScript(brief);assert.equal(calls,1);assert.deepEqual(draft.direction,direction);assert.equal(session.status().rows.length,0);
 result={rows:result.rows};assert.equal((await session.draftScript(brief)).warnings[0].code,'INVALID_AUTOMATIC_DIRECTION');assert.equal(calls,2);
 assert.equal((await session.draftScript({...brief,autoDirection:false})).direction,undefined);assert.equal(calls,3);
 const request=buildDraftRequest({brief});assert.ok(request.generationConfig.responseJsonSchema.required.includes('direction'));assert.deepEqual(request.generationConfig.responseJsonSchema.properties.direction.properties.template.enum,VIDEO_TEMPLATES.map(t=>t.id));
});

function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}
test('accepting a regenerated script replaces its cuts once and preserves exact unchanged audio; stale or invalid drafts cannot replace it',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'prepared-replace-'));t.after(()=>rm(dir,{recursive:true,force:true}));const session=await NarrationSession.open({outputDir:dir,provider:async()=>wav()});session.setKey('test-only-key');
 await session.appendRow({id:'one',caption:'最初。',speech:'さいしょ。'});await session.appendRow({id:'two',caption:'次。',speech:'つぎ。'});await session.approve('one',session.revision());await session.generate(['one']);const original=session.status().rows[0],revision=session.revision();
 const readings=[{caption:'最初。',speech:'さいしょ。'},{caption:'新しい文。',speech:'あたらしいぶん。'}],script=readings.map(r=>r.caption).join('\n');
 await assert.rejects(session.appendScript(script,{replace:true,expectedRevision:'old',readings}),/STALE_REVISION/);assert.equal(session.status().rows.length,2);
 await assert.rejects(session.appendScript(script,{replace:true,expectedRevision:revision,readings:[readings[0]]}),/INVALID_SCRIPT_READINGS/);assert.deepEqual(session.status().rows[0].audio,original.audio);
 await session.appendScript(script,{replace:true,expectedRevision:revision,readings});assert.equal(session.status().rows.length,2);assert.deepEqual(session.status().rows[0].audio,original.audio);assert.equal(session.status().rows[1].reviewed,false);assert.equal(session.status().rows[1].audio,null);
 await session.appendScript(script,{replace:true,expectedRevision:session.revision(),readings});assert.equal(session.status().rows.length,2);assert.deepEqual(session.status().rows[0].audio,original.audio);
});

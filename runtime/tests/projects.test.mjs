import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NarrationSession} from '../core.mjs';
import {ProductionInputs} from '../production.mjs';
import {startServer} from '../server.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'studio-projects-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
 const session=await NarrationSession.open({outputDir:dir,provider:async()=>wav});session.setKey('test-project-key');await session.setTitle('Completed project');await session.appendRow({id:'one',caption:'字幕。',speech:'よみ。'});await session.approve('one',session.revision());await session.generate(['one']);await session.markListened('one',session.revision());
 const production=await ProductionInputs.open(dir);await production.saveMusicEnabled(false);await production.finalize(session.status());
 const original=await readFile(path.join(dir,'job.json')),seal=await readFile(path.join(dir,'production.json'));
 let service=await startServer({session,port:0,videoRendererRoot:dir,downloadsDir:path.join(dir,'downloads')});t.after(()=>service.close());
 const status=async()=> (await fetch(service.url+'/api/status')).json();
 let token=(await (await fetch(service.url+'/api/bootstrap')).json()).token;
 const post=async(route,input,auth=token)=>{const response=await fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':auth},body:JSON.stringify(input)});return {code:response.status,data:await response.json()};};
 const refresh=async()=>{token=(await (await fetch(service.url+'/api/bootstrap')).json()).token;};
 const restart=async()=>{await service.close();service=await startServer({session:await NarrationSession.open({outputDir:dir}),port:0,videoRendererRoot:dir,downloadsDir:path.join(dir,'downloads')});await refresh();};
 return {dir,session,original,seal,status,post,refresh,restart,token:()=>token};
}
test('new video isolates a sealed project, preserves its files/key, and allows design and palette selection',async t=>{
 const f=await fixture(t),old=await f.status(),oldToken=f.token();
 const created=await f.post('new-project',{sessionId:old.sessionId,revision:old.revision,discardPrevious:true});assert.equal(created.code,200);
 const next=created.data;assert.notEqual(next.sessionId,old.sessionId);assert.equal(next.rows.length,0);assert.equal(next.production.finalization,null);assert.equal(next.production.assets.length,0);assert.equal(next.keyConfigured,true);assert.equal(next.video.result,null);assert.equal(next.projects,undefined);
 await f.refresh();assert.equal((await f.post('presentation',{revision:next.revision,presentation:{theme:'black',mode:'template',template:'blueprint'}})).code,200);
 assert.equal((await f.post('title',{title:'Second project'},oldToken)).data.error,'CSRF_TOKEN_REQUIRED');
 assert.deepEqual(await readFile(path.join(f.dir,'job.json')),f.original);assert.deepEqual(await readFile(path.join(f.dir,'production.json')),f.seal);
 const current=await f.status();assert.equal(current.presentation.template,'blueprint');assert.equal(current.presentation.theme,'black');
 assert.equal((await f.post('project',{id:'original',sessionId:current.sessionId,revision:current.revision})).code,404);assert.equal((await f.status()).projectId,next.projectId);
 assert.equal((await readFile(path.join(f.dir,'projects',next.projectId,'job.json'),'utf8')).includes('test-project-key'),false);
});
test('active project persists across server restart without a past-production menu',async t=>{
 const f=await fixture(t),old=await f.status(),created=await f.post('new-project',{sessionId:old.sessionId,revision:old.revision,discardPrevious:true});assert.equal(created.code,200);await f.refresh();
 await f.post('title',{title:'Saved second project'});const id=(await f.status()).projectId;await f.restart();
 const current=await f.status();assert.equal(current.projectId,id);assert.equal(current.title,'Saved second project');assert.equal(current.keyConfigured,false);assert.equal(current.projects,undefined);
 assert.equal((await f.post('project',{id:'original',sessionId:current.sessionId,revision:current.revision})).code,404);
});
test('new actions reject missing token, stale state, traversal and active work without changing project',async t=>{
 const f=await fixture(t),old=await f.status();
 assert.equal((await f.post('new-project',{sessionId:old.sessionId,revision:old.revision,discardPrevious:true},'wrong')).code,403);
 assert.equal((await f.post('new-project',{sessionId:old.sessionId,revision:'stale'})).data.error,'STALE_REVISION');
 assert.equal((await f.post('new-project',{sessionId:'other',revision:old.revision})).data.error,'SESSION_MISMATCH');
 assert.equal((await f.post('project',{id:'../outside',sessionId:old.sessionId,revision:old.revision})).code,404);
 f.session.busy=true;assert.equal((await f.post('new-project',{sessionId:old.sessionId,revision:old.revision,discardPrevious:true})).data.error,'BUSY');f.session.busy=false;
 assert.equal((await f.status()).sessionId,old.sessionId);assert.deepEqual(await readFile(path.join(f.dir,'job.json')),f.original);
});

test('past productions have no listing or reopen endpoint and cannot affect the active production',async t=>{
 const f=await fixture(t),old=await f.status();assert.equal(old.projects,undefined);
 const result=await f.post('project',{id:'original',sessionId:old.sessionId,revision:old.revision});assert.equal(result.code,404);assert.equal(result.data.error,'NOT_FOUND');assert.equal((await f.status()).projectId,old.projectId);
});

test('clearing into a new production retains one active workspace, survives restart and preserves downloaded videos',async t=>{
 const f=await fixture(t),old=await f.status();let created=await f.post('new-project',{sessionId:old.sessionId,revision:old.revision,discardPrevious:true});assert.equal(created.code,200);await f.refresh();
 const previous=created.data;await f.post('title',{title:'作業中'});await mkdir(path.join(f.dir,'downloads'),{recursive:true});await writeFile(path.join(f.dir,'downloads','finished.mp4'),'downloaded artifact');
 const current=await f.status();assert.equal((await f.post('new-project',{sessionId:current.sessionId,revision:current.revision})).data.error,'PROJECT_CLEAR_CONFIRMATION_REQUIRED');assert.equal((await f.status()).projectId,previous.projectId);
 created=await f.post('new-project',{sessionId:current.sessionId,revision:current.revision,discardPrevious:true});assert.equal(created.code,200);await f.refresh();assert.deepEqual(await readdir(path.join(f.dir,'projects')),[created.data.projectId]);assert.equal(await readFile(path.join(f.dir,'downloads','finished.mp4'),'utf8'),'downloaded artifact');
 await f.restart();assert.equal((await f.status()).projectId,created.data.projectId);assert.equal((await f.status()).projects,undefined);
});

test('startup never reads unrelated past-production files',async t=>{
 const f=await fixture(t);const unrelated=path.join(f.dir,'projects','11111111-1111-4111-8111-111111111111');await mkdir(unrelated);await writeFile(path.join(unrelated,'job.json'),'invalid old history');await f.restart();assert.equal((await f.status()).projectId,'original');assert.equal((await f.status()).projects,undefined);
});

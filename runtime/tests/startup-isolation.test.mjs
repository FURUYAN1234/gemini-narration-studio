import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {NarrationSession} from '../core.mjs';
import {ProductionInputs} from '../production.mjs';
import {startServer} from '../server.mjs';
test('fresh launch isolates old materials, script and selection without deleting prior productions',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'studio-fresh-start-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const s=await NarrationSession.open({outputDir:root});await s.replaceJob({...s.job,title:'保存済みの制作',rows:[{id:'old',caption:'前の台本。',speech:'まえのだいほん。'}]});
 const p=await ProductionInputs.open(root);await p.saveBrief({...p.status().brief,references:{text:'前の参考本文',urls:[]}});await p.addAsset('old.txt',Buffer.from('前の素材です。'));
 const before=await Promise.all(['job.json','production.json'].map(f=>readFile(path.join(root,f))));
 const server=await startServer({session:s,port:0,startupMode:'new'});t.after(()=>server.close());
 const state=await (await fetch(server.url+'/api/status')).json();assert.equal(state.rows.length,0);assert.equal(state.production.assets.length,0);assert.equal(state.production.brief.references.text,'');assert.notEqual(state.projectId,'original');assert.equal(state.resumed,false);
 const after=await Promise.all(['job.json','production.json'].map(f=>readFile(path.join(root,f))));assert.deepEqual(after,before);
 const {token}=await (await fetch(server.url+'/api/bootstrap')).json();const r=await fetch(server.url+'/api/project',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify({id:'original',sessionId:state.sessionId,revision:state.revision})});
 assert.equal(r.status,404);const current=await(await fetch(server.url+'/api/status')).json();assert.equal(current.projectId,state.projectId);assert.equal(current.rows.length,0);assert.deepEqual(await Promise.all(['job.json','production.json'].map(f=>readFile(path.join(root,f)))),before);
});

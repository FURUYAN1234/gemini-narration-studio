import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {NarrationSession} from '../core.mjs';
import {startServer} from '../server.mjs';
import {promoPresentation} from '../promo.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSUMAAAAASUVORK5CYII=','base64');

test('MCP grant is browser-scoped and only permits current, imported promo assets',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'narration-promo-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const session=await NarrationSession.open({outputDir:root});
  let renderCalls=0;
  const runner=async({sourceDir,output,promo})=>{
    renderCalls+=1;
    assert.equal(promo,true);
    const model=await promoPresentation(sourceDir,path.join(sourceDir,'test-public'));
    assert.equal(model.bookends.watermarkEnabled,false);
    assert.equal(model.bookends.frames,120);
    assert.deepEqual(model.bookends.tools.slice(1,3),['Remotion','FFmpeg']);
    assert.equal(model.durationInFrames,240);
    const draft=JSON.parse(await readFile(path.join(sourceDir,'promo.json'),'utf8'));
    assert.equal(Boolean(model.promoAudio),draft.soundEnabled);
    if(model.promoAudio){
      const audio=await readFile(path.join(sourceDir,'test-public',model.promoAudio));
      assert.equal(audio.toString('ascii',0,4),'RIFF');
      assert.equal(audio.readUInt32LE(40),8*48000*4);
      assert.ok(audio.subarray(44,48044).some(byte=>byte!==0));
    }
    await writeFile(output,Buffer.from('0000ftypdemo0000'));
  };
  const studio=await startServer({session,port:0,videoRendererRoot:root,downloadsDir:path.join(root,'downloads'),videoRunner:runner});
  t.after(()=>studio.close());
  const get=async route=>(await fetch(studio.url+route)).json();
  const {token}=await get('/api/bootstrap');
  const post=(route,data,origin)=>fetch(studio.url+route,{
    method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token,...(origin?{Origin:origin}:{})},body:JSON.stringify(data)
  });
  const initial=await get('/api/status');
  assert.equal(initial.mcp.allowed,false);
  assert.equal((await post('/api/mcp-action',{action:'project'})).status,403);
  assert.equal((await post('/api/mcp-access',{enabled:true,projectId:initial.projectId})).status,403);
  assert.equal((await post('/api/mcp-access',{enabled:true,projectId:initial.projectId},studio.url)).status,200);
  assert.equal((await post('/api/mcp-action',{action:'project'},studio.url)).status,403);
  const response=await fetch(studio.url+'/api/material?name=screen.png',{method:'POST',headers:{'X-Narration-Token':token},body:png});
  assert.equal(response.status,200);
  const current=await (await post('/api/mcp-action',{action:'project'})).json();
  const {projectId,revision,productionRevision}=current;
  const input={action:'promo',projectId,revision,productionRevision,title:'紹介動画',watermarkEnabled:false,cuts:[{image:current.assets[0].file,title:'実画面'}]};
  assert.equal((await post('/api/mcp-action',{...input,revision:'0'.repeat(64)})).status,409);
  assert.notEqual((await post('/api/mcp-action',{...input,cuts:[{image:'../hidden.png',title:'不正'}]})).status,202);
  assert.equal((await post('/api/mcp-action',input)).status,202);
  for(let i=0;i<60&&(await get('/api/status')).promo.running;i++)await new Promise(resolve=>setTimeout(resolve,20));
  const done=await get('/api/status');
  assert.equal(done.promo.stage,'complete');
  assert.equal(renderCalls,1);
  assert.equal((await fetch(studio.url+'/api/promo-video',{headers:{Range:'bytes=0-3'}})).status,206);
  assert.equal((await post('/api/mcp-action',{...input,soundEnabled:false})).status,202);
  for(let i=0;i<60&&(await get('/api/status')).promo.running;i++)await new Promise(resolve=>setTimeout(resolve,20));
  const silent=await get('/api/status');
  assert.equal(silent.promo.stage,'complete');
  assert.equal(renderCalls,2);
  assert.equal((await post('/api/mcp-access',{enabled:false,projectId},studio.url)).status,200);
  assert.equal((await post('/api/mcp-action',{action:'project'})).status,403);
  assert.equal((await get('/api/status')).promo.result.sha256,silent.promo.result.sha256);
});

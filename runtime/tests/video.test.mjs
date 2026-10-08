import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {StudioVideo,mediaRange,downloadName,fullDecodeVideo,extractVideoAudio,findRendererRoot,renderErrorCode} from '../video.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {NarrationSession} from '../core.mjs';
import {ProductionInputs} from '../production.mjs';
import {startServer} from '../server.mjs';

const mp4=Buffer.from('\0\0\0\x18ftypisom00000000');
test('font timeout is classified without leaking raw renderer diagnostics',()=>{
 assert.equal(renderErrorCode(new Error('A delayRender() "Load presentation Japanese font" was called but not cleared after 118000ms.')),'VIDEO_FONT_TIMEOUT');
 assert.equal(renderErrorCode(new Error('private path or stack')),'VIDEO_RENDER_FAILED');
 assert.equal(renderErrorCode(new Error('VIDEO_MEDIA_QA_FAILED')),'VIDEO_MEDIA_QA_FAILED');
});

test('cancel stops only the active render and never saves/publishes a late successful candidate',async t=>{
 const dir=await directory(t);let release,signal;
 const video=await StudioVideo.open({sourceDir:dir,rendererRoot:dir,downloadsDir:path.join(dir,'Downloads'),runner:async input=>{signal=input.signal;await new Promise(r=>release=r);await writeFile(input.output,mp4);}});
 assert.equal(video.cancel(),false);video.start({revision:'one',title:'Cancel trial'});while(!release)await new Promise(r=>setTimeout(r,1));
 assert.equal(video.cancel(),true);assert.equal(signal.aborted,true);assert.equal(video.status('one').running,true);assert.equal(video.status('one').canceling,true);release();await video.completion;
 assert.equal(video.status('one').stage,'canceled');assert.equal(video.status('one').running,false);assert.equal(video.status('one').result,null);await assert.rejects(readFile(path.join(dir,'Downloads')),/ENOENT/);
 assert.equal((await StudioVideo.open({sourceDir:dir,rendererRoot:dir})).status('one').stage,'canceled');
});
async function directory(t){const dir=await mkdtemp(path.join(tmpdir(),'studio-video-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('bundled FFmpeg fully decodes real video and audio but rejects a corrupt MP4',async t=>{
 const root=await findRendererRoot(process.cwd());if(!root||process.platform!=='win32'){t.skip('Existing Windows Remotion runtime required');return;}
 const dir=await directory(t),ffmpeg=path.join(root,'node_modules','@remotion','compositor-win32-x64-msvc','ffmpeg.exe');
 const wav=Buffer.alloc(44+4800);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4800,40);
 const raw=path.join(dir,'frame.png'),audio=path.join(dir,'tone.wav'),output=path.join(dir,'real.mp4');await writeFile(raw,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64'));await writeFile(audio,wav);
 await promisify(execFile)(ffmpeg,['-v','error','-loop','1','-framerate','30','-i',raw,'-i',audio,'-vf','scale=16:16','-c:v','libx264','-c:a','aac','-shortest',output],{windowsHide:true});
 await fullDecodeVideo(ffmpeg,output);
 const independent=path.join(dir,'real.m4a');await extractVideoAudio(ffmpeg,output,independent);const audioBytes=await readFile(independent);assert.equal(audioBytes.toString('ascii',4,8),'ftyp');await assert.rejects(extractVideoAudio(ffmpeg,raw,path.join(dir,'bad.m4a')));
 const corrupt=path.join(dir,'corrupt.mp4');await writeFile(corrupt,(await readFile(output)).subarray(0,40));await assert.rejects(fullDecodeVideo(ffmpeg,corrupt));
});
test('real runner status is bounded, complete output is saved with byte parity, duplicate render is reused and restart restores it',async t=>{
 const dir=await directory(t),downloadsDir=path.join(dir,'Downloads');let calls=0,unblock;
 const video=await StudioVideo.open({sourceDir:dir,rendererRoot:dir,downloadsDir,runner:async({output,onProgress})=>{calls++;onProgress({stage:'rendering',progress:0.4,renderedFrames:4,totalFrames:10});onProgress({stage:'invented',progress:1});await new Promise(r=>{unblock=r;});await writeFile(output,mp4);await writeFile(output.replace(/\.mp4$/,'.m4a'),mp4);}});
 assert.deepEqual(video.start({revision:'rev',title:'説明/動画?'}),{started:true});
 while(!unblock)await new Promise(r=>setTimeout(r,1));assert.equal(video.status('rev').stage,'rendering');assert.equal(video.status('rev').progress,.4);assert.equal(video.status('rev').result,null);
 assert.throws(()=>video.start({revision:'rev',title:'test'}),/BUSY/);unblock();await video.completion;
 const status=video.status('rev');assert.equal(status.running,false);assert.equal(status.stage,'complete');assert.deepEqual(await readFile(status.result.savedPath),mp4);assert.equal(path.dirname(status.result.savedPath),downloadsDir);
 assert.deepEqual(video.start({revision:'rev',title:'test'}),{started:false,cached:true});assert.equal(calls,1);assert.equal(video.status('other-rev').result,null);
 const restored=await StudioVideo.open({sourceDir:dir,rendererRoot:dir,downloadsDir});assert.deepEqual((await restored.media('rev')).bytes,mp4);await writeFile(path.join(dir,'video',status.result.file),Buffer.from('tampered'));await assert.rejects(restored.media('rev'),/VIDEO_HASH_MISMATCH/);
});
test('failed or interrupted rendering never publishes a player result and never automatically retries',async t=>{
 const dir=await directory(t);let calls=0;
 const video=await StudioVideo.open({sourceDir:dir,rendererRoot:dir,downloadsDir:path.join(dir,'Downloads'),runner:async()=>{calls++;throw new Error('private raw log');}});video.start({revision:'rev',title:'test'});await video.completion;
 assert.equal(calls,1);assert.equal(video.status('rev').running,false);assert.equal(video.status('rev').error,'VIDEO_RENDER_FAILED');assert.equal(video.status('rev').result,null);
 await writeFile(video.record(),JSON.stringify({running:true,stage:'rendering'}));const interrupted=await StudioVideo.open({sourceDir:dir});assert.equal(interrupted.status('rev').error,'VIDEO_RENDER_INTERRUPTED');assert.equal(interrupted.status('rev').result,null);
});
test('media range supports playback/seek and rejects invalid requests; filenames cannot escape Downloads',()=>{
 assert.deepEqual(mediaRange('bytes=5-10',20),{start:5,end:10,partial:true});assert.deepEqual(mediaRange('bytes=-5',20),{start:15,end:19,partial:true});assert.throws(()=>mediaRange('bytes=99-',20),/INVALID/);assert.throws(()=>mediaRange('bytes=0-1,3-5',20),/INVALID/);assert.ok(!/[\\/:?]/.test(downloadName('../test?:','12345678')));
});
test('HTTP render requires current final seal and CSRF, then exposes actual progress, range player and download after completion',async t=>{
 const dir=await directory(t),s=await NarrationSession.open({outputDir:dir});await s.appendRow({id:'one',caption:'字幕',speech:'よみ'});
 let called=0;let service=await startServer({session:s,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty'),videoRendererRoot:dir,downloadsDir:path.join(dir,'Downloads'),videoRunner:async({output,onProgress})=>{called++;onProgress({stage:'rendering',progress:.5});await writeFile(output,mp4);await writeFile(output.replace(/\.mp4$/,'.m4a'),mp4);}});t.after(()=>service.close());
 const {token}=await (await fetch(service.url+'/api/bootstrap')).json();const post=(revision=s.revision(),auth=token)=>fetch(service.url+'/api/render-video',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':auth},body:JSON.stringify({revision})});
 assert.equal((await post(undefined,'bad')).status,403);assert.equal((await post('stale')).status,409);assert.equal((await post()).status,409);assert.equal(called,0);
 const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
 const revision=s.revision();s.job.rows[0].approval=s.rowHash(s.job.rows[0]);s.job.rows[0].audio={fingerprint:s.audioHash(s.job.rows[0]),file:'a'.repeat(64)+'.wav',contentHash:'fixture',durationSeconds:1};s.job.rows[0].listened=s.audioHash(s.job.rows[0]);
 // Persist the test-only state via the real session boundary and seal it.
 await s.setTitle('Test video');const production=await ProductionInputs.open(dir);await production.saveMusicEnabled(false);await production.confirmCut(s.status().rows[0],production.cutFingerprint(s.status().rows[0]));await production.finalize(s.status());
 // Reopen the HTTP service so it loads the persisted final seal.
 await service.close();service=await startServer({session:s,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty'),videoRendererRoot:dir,downloadsDir:path.join(dir,'Downloads'),videoRunner:async({output})=>{called++;await writeFile(output,mp4);await writeFile(output.replace(/\.mp4$/,'.m4a'),mp4);}});const sealedService=service;
 const boot=await (await fetch(sealedService.url+'/api/bootstrap')).json();const response=await fetch(sealedService.url+'/api/render-video',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token},body:JSON.stringify({revision:s.revision()})});assert.equal(response.status,202);
 let status;for(let i=0;i<100;i++){status=await (await fetch(sealedService.url+'/api/status')).json();if(!status.video.running)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(status.video.stage,'complete');assert.equal(called,1);const ranged=await fetch(sealedService.url+'/video/'+status.video.result.file,{headers:{Range:'bytes=4-7'}});assert.equal(ranged.status,206);assert.equal(await ranged.text(),'ftyp');assert.equal((await fetch(sealedService.url+'/api/video-download')).headers.get('content-type'),'video/mp4');
});

test('HTTP cancellation remains reachable on a sealed active video, rejects wrong token and preserves the seal',async t=>{
 const dir=await directory(t),s=await NarrationSession.open({outputDir:dir});await s.appendRow({id:'one',caption:'字幕',speech:'よみ'});
 const row=s.job.rows[0];row.approval=s.rowHash(row);row.audio={fingerprint:s.audioHash(row),file:'a'.repeat(64)+'.wav',contentHash:'fixture',durationSeconds:1};row.listened=s.audioHash(row);await s.setTitle('Cancel video');
 const production=await ProductionInputs.open(dir);await production.saveMusicEnabled(false);await production.confirmCut(s.status().rows[0],production.cutFingerprint(s.status().rows[0]));await production.finalize(s.status());const seal=production.status().finalization;
 let release,signal;const service=await startServer({session:s,port:0,sampleDir:path.join(dir,'samples'),bundledSampleDir:path.join(dir,'empty'),videoRendererRoot:dir,downloadsDir:path.join(dir,'Downloads'),videoRunner:async input=>{signal=input.signal;await new Promise(r=>release=r);await writeFile(input.output,mp4);}});t.after(()=>service.close());
 const {token}=await(await fetch(service.url+'/api/bootstrap')).json();const post=(route,input={},auth=token)=>fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':auth},body:JSON.stringify(input)});
 assert.equal((await post('render-video',{revision:s.revision()})).status,202);while(!release)await new Promise(r=>setTimeout(r,1));
 assert.equal((await post('cancel',{},'wrong')).status,403);assert.equal(signal.aborted,false);assert.equal((await post('cancel')).status,200);assert.equal(signal.aborted,true);release();
 let status;for(let i=0;i<100;i++){status=await(await fetch(service.url+'/api/status')).json();if(!status.video.running)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(status.video.stage,'canceled');assert.equal(status.video.result,null);assert.deepEqual(status.production.finalization,seal);assert.equal((await fetch(service.url+'/api/video-download')).status,409);
});

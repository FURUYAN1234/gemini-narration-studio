import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,copyFile,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here=path.dirname(fileURLToPath(import.meta.url));
const stages=['preparing','bundling','rendering','verifying','saving','complete'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function renderErrorCode(error){
  const message=String(error.message||'');
  if(/delayRender\(\).*Load presentation Japanese font.*not cleared/.test(message))return 'VIDEO_FONT_TIMEOUT';
  return /^[A-Z_]+$/.test(message)?message:'VIDEO_RENDER_FAILED';
}
export async function fullDecodeVideo(ffmpeg,output,{signal}={}){
  // Remotion's bundled FFmpeg omits null's default wrapped_avframe encoder.
  // Decode every video/audio frame using encoders present in that runtime.
  await promisify(execFile)(ffmpeg,['-v','error','-xerror','-i',output,'-map','0:v:0','-map','0:a:0','-c:v','rawvideo','-c:a','pcm_s16le','-f','null','-'],{windowsHide:true,maxBuffer:1024*1024,signal});
}
export async function extractVideoAudio(ffmpeg,video,output,{signal}={}){
  const run=promisify(execFile),options={windowsHide:true,maxBuffer:1024*1024,signal};
  // The bundled FFmpeg enables mp4 but not the ipod/m4a alias. Preserve AAC
  // packets without another lossy encode and explicitly select its container.
  await run(ffmpeg,['-v','error','-xerror','-i',video,'-map','0:a:0','-vn','-c:a','copy','-f','mp4','-y',output],options);
  await run(ffmpeg,['-v','error','-xerror','-i',output,'-c:a','pcm_s16le','-f','null','-'],options);
}
export async function downloadsFolder(){
  if(process.platform!=='win32')return path.join(homedir(),'Downloads');
  const script="$p=Get-ItemPropertyValue -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -Name '{374DE290-123F-4565-9164-39C4925E467B}'; [Environment]::ExpandEnvironmentVariables($p)";
  try{const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});const folder=stdout.trim();if(path.isAbsolute(folder))return folder;}catch{}
  throw new Error('DOWNLOADS_FOLDER_UNAVAILABLE');
}
export function downloadName(title,runId){const name=title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').replace(/[. ]+$/g,'').trim().slice(0,90)||'Narration-Video';return `動画-${name}-${runId.slice(0,8)}.mp4`;}
export async function findRendererRoot(sourceDir){
  for(let root=path.resolve(sourceDir);;root=path.dirname(root)){
    const candidate=path.join(root,'remotion_video');
    try{await stat(path.join(candidate,'node_modules','@remotion','renderer','package.json'));return candidate;}catch{}
    if(path.dirname(root)===root)return null;
  }
}
export function runRenderer({sourceDir,rendererRoot,output,onProgress,signal}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('CANCELED'));
    const child=spawn(process.execPath,[path.join(here,'render-video.mjs'),'--source',sourceDir,'--renderer-root',rendererRoot,'--output',output],{cwd:rendererRoot,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    const cancel=()=>{if(child.connected)child.send({type:'cancel'},()=>{});};signal?.addEventListener('abort',cancel,{once:true});
    let buffer='',code='VIDEO_RENDER_FAILED';
    child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>65536)buffer=buffer.slice(-65536);let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const event=JSON.parse(line);if(event.error&&/^[A-Z_]+$/.test(event.error))code=event.error;else onProgress(event);}catch{}}});
    // Only whitelisted structured status goes to the UI; never forward raw logs.
    child.stderr.resume();child.once('error',()=>reject(new Error('VIDEO_RENDERER_UNAVAILABLE')));
    child.once('close',exit=>{signal?.removeEventListener('abort',cancel);signal?.aborted?reject(new Error('CANCELED')):exit===0?resolve():reject(new Error(code));});
  });
}
export class StudioVideo {
  constructor({sourceDir,rendererRoot,downloadsDir,runner=runRenderer}){Object.assign(this,{sourceDir,rendererRoot,downloadsDir,runner});this.state={running:false,stage:'idle',progress:0,error:null,result:null};}
  static async open(options){const video=new StudioVideo(options);try{const saved=JSON.parse(await readFile(video.record(),'utf8'));video.state=saved.running?{running:false,stage:'failed',progress:0,error:'VIDEO_RENDER_INTERRUPTED',result:null}:saved;}catch{}return video;}
  record(){return path.join(this.sourceDir,'video-render.json');}
  status(revision){return {...this.state,available:!!this.rendererRoot,result:this.state.result?.revision===revision?this.state.result:null};}
  async save(){await writeFile(this.record(),JSON.stringify(this.state,null,2));}
  start({revision,title}){
    if(this.state.running)throw new Error('BUSY');
    if(this.state.result?.revision===revision&&this.state.result.audio)return {started:false,cached:true};
    if(!this.rendererRoot)throw new Error('VIDEO_RENDERER_REQUIRED');
    this.controller=new AbortController();this.state={running:true,stage:'preparing',progress:0,error:null,result:null,steps:['preparing']};
    this.completion=this.render({revision,title});return {started:true};
  }
  cancel(){if(!this.state.running)return false;this.state.canceling=true;this.controller?.abort();return true;}
  async render({revision,title}){
    const signal=this.controller.signal,check=()=>signal.throwIfAborted(),runId=randomUUID(),videoDir=path.join(this.sourceDir,'video'),temporary=path.join(videoDir,runId+'.mp4');
    try{
      await mkdir(videoDir,{recursive:true});await this.save();
      check();await this.runner({sourceDir:this.sourceDir,rendererRoot:this.rendererRoot,output:temporary,signal,onProgress:event=>{
        if(signal.aborted)return;
        if(!stages.includes(event.stage)||['saving','complete'].includes(event.stage))return;
        if(stages.indexOf(event.stage)<stages.indexOf(this.state.stage))return;
        this.state.stage=event.stage;if(!this.state.steps.includes(event.stage))this.state.steps.push(event.stage);
        this.state.progress=Number.isFinite(event.progress)?Math.max(0,Math.min(1,event.progress)):0;
        for(const key of ['renderedFrames','encodedFrames','totalFrames'])if(Number.isSafeInteger(event[key])&&event[key]>=0)this.state[key]=event[key];
      }});
      check();this.state.stage='saving';this.state.steps.push('saving');await this.save();check();
      const bytes=await readFile(temporary);if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw new Error('INVALID_VIDEO_OUTPUT');
      const audioBytes=await readFile(temporary.replace(/\.mp4$/,'.m4a'));if(audioBytes.length<12||audioBytes.toString('ascii',4,8)!=='ftyp')throw new Error('INVALID_AUDIO_OUTPUT');
      const audioHash=digest(audioBytes),audioFile=audioHash+'.m4a';await copyFile(temporary.replace(/\.mp4$/,'.m4a'),path.join(videoDir,audioFile));
      const sha256=digest(bytes),file=sha256+'.mp4';await copyFile(temporary,path.join(videoDir,file));
      const folder=this.downloadsDir||await downloadsFolder();if(!path.isAbsolute(folder))throw new Error('INVALID_DOWNLOADS_FOLDER');
      check();await mkdir(folder,{recursive:true});const filename=downloadName(title,runId),savedPath=path.join(folder,filename);check();
      await copyFile(path.join(videoDir,file),savedPath,constants.COPYFILE_EXCL);
      if(digest(await readFile(savedPath))!==sha256)throw new Error('VIDEO_SAVE_HASH_MISMATCH');
      const audioName=filename.replace(/^動画-/, '音声-').replace(/\.mp4$/,'.m4a'),audioPath=path.join(folder,audioName);check();await copyFile(path.join(videoDir,audioFile),audioPath,constants.COPYFILE_EXCL);if(digest(await readFile(audioPath))!==audioHash)throw new Error('AUDIO_SAVE_HASH_MISMATCH');
      check();this.state={...this.state,running:false,canceling:false,stage:'complete',progress:1,error:null,result:{revision,file,filename,savedPath,audio:{file:audioFile,filename:audioName,savedPath:audioPath,sha256:audioHash,bytes:audioBytes.length},bytes:bytes.length,sha256,completedAt:new Date().toISOString()}};
      this.state.steps.push('complete');await this.save();
    }catch(error){this.state={...this.state,running:false,canceling:false,stage:signal.aborted?'canceled':'failed',error:signal.aborted?'VIDEO_RENDER_CANCELED':/^[A-Z_]+$/.test(error.message)?error.message:error.code==='EACCES'?'VIDEO_SAVE_DENIED':'VIDEO_RENDER_FAILED',result:null};await this.save();}
  }
  async media(revision,kind='video'){
    const saved=this.status(revision).result,result=kind==='audio'?saved?.audio:saved;if(!result||!new RegExp('^[a-f0-9]{64}\\.'+(kind==='audio'?'m4a':'mp4')+'$').test(result.file))throw new Error('VIDEO_NOT_READY');
    const root=await realpath(path.join(this.sourceDir,'video')),file=await realpath(path.join(root,result.file));if(path.dirname(file)!==root)throw new Error('INVALID_VIDEO_PATH');
    const bytes=await readFile(file);if(digest(bytes)!==result.sha256)throw new Error('VIDEO_HASH_MISMATCH');return {bytes,result};
  }
}

export function mediaRange(range,size){
  if(!range)return {start:0,end:size-1,partial:false};const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match||(!match[1]&&!match[2]))throw new Error('INVALID_VIDEO_RANGE');
  const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2])),end=match[1]?(match[2]?Math.min(size-1,Number(match[2])):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw new Error('INVALID_VIDEO_RANGE');return {start,end,partial:true};
}

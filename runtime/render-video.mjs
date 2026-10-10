import {readFile,writeFile,mkdir,copyFile,stat,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {prepareReviewedAudio,preparePreviewAudio} from './client.mjs';
import {themeTokens} from './themes.mjs';
import {ProductionInputs} from './production.mjs';
import {fullDecodeVideo,extractVideoAudio,renderErrorCode} from './video.mjs';
import {presentationDesign,presentationMotion} from './designs.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const report=event=>console.log(JSON.stringify(event));
const controller=new AbortController();let cancelRender;
process.on('message',message=>{if(message?.type==='cancel'){controller.abort();cancelRender?.();}});
const checkCanceled=()=>controller.signal.throwIfAborted();
async function existingBrowser(root){
  const base=path.join(root,'node_modules','.remotion','chrome-headless-shell');
  async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){const found=await walk(file);if(found)return found;}else if(['chrome-headless-shell.exe','chrome-headless-shell'].includes(entry.name))return file;}return null;}
  try{const file=await walk(base);if(file)return file;}catch{}throw new Error('VIDEO_BROWSER_REQUIRED');
}
try{
  const sourceDir=option('--source'),rendererRoot=option('--renderer-root'),output=option('--output');if(!sourceDir||!rendererRoot||!output)throw new Error('VIDEO_RENDER_ARGUMENTS_REQUIRED');
  const require=createRequire(path.join(rendererRoot,'package.json')),{bundle}=require('@remotion/bundler'),{selectComposition,renderMedia,makeCancelSignal}=require('@remotion/renderer');
  const cancellation=makeCancelSignal();cancelRender=cancellation.cancel;checkCanceled();
  const browserExecutable=await existingBrowser(rendererRoot),work=path.join(sourceDir,'video','project'),publicDir=path.join(work,'public');
  report({stage:'preparing',progress:0});await mkdir(publicDir,{recursive:true});
  const data=await (args.includes('--preview')?preparePreviewAudio({sourceDir,publicDir}):prepareReviewedAudio({sourceDir,publicDir})),production=await ProductionInputs.open(sourceDir),theme=await themeTokens(data.presentation.theme);
  const design=presentationDesign(data.presentation);if(design)data.design=design;
  const motion=presentationMotion(data.presentation);if(motion)data.motion=motion;
  const scenes=production.status().visuals||await readFile(path.join(sourceDir,'video-scenes.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
  await mkdir(path.join(publicDir,'cuts'),{recursive:true});
  for(const row of data.rows){
    const asset=production.cutImage(row);
    if(asset){await writeFile(path.join(publicDir,'cuts',asset.file),await production.readAsset(asset.file));row.image='cuts/'+asset.file;row.layout='split';}
    const visual=scenes[row.id]||{};if(visual.imageFocus)row.imageFocus=visual.imageFocus;row.title=typeof visual.title==='string'?visual.title.slice(0,200):row.scene||data.title;
    row.points=Array.isArray(visual.points)?visual.points.filter(v=>typeof v==='string').slice(0,6).map(v=>v.slice(0,160)):[];
  }
  const music=production.effectiveMusic();if(music){await writeFile(path.join(publicDir,'cuts',music.file),await production.readAsset(music.file));data.music={src:'cuts/'+music.file,durationSeconds:music.durationSeconds,level:music.level};}
  await writeFile(path.join(publicDir,'video-data.json'),JSON.stringify({data,theme}));
  for(const name of ['presentation.tsx','motion-presentation.tsx','motion.mjs','music.mjs','font-loader.mjs','subtitles.mjs'])await copyFile(path.join(here,name),path.join(work,name));
  for(const name of ['NotoSansJP.ttf','NotoSansJP-OFL.txt','reveal-LICENSE.txt'])await copyFile(path.join(here,'vendor',name),path.join(publicDir,'narration',name));
  const entry=path.join(work,'main.tsx');await writeFile(entry,"import React from 'react';import {registerRoot} from 'remotion';import {NarratedPresentationComposition} from './presentation';import payload from './public/video-data.json';registerRoot(()=> <NarratedPresentationComposition data={payload.data} theme={payload.theme}/>);\n");
  checkCanceled();report({stage:'bundling',progress:0});
  const serveUrl=await bundle({entryPoint:entry,publicDir,outDir:path.join(work,'bundle'),onProgress:progress=>report({stage:'bundling',progress:progress/100}),webpackOverride:config=>({...config,resolve:{...config.resolve,modules:[path.join(rendererRoot,'node_modules'),...(config.resolve?.modules||['node_modules'])]}})});
  checkCanceled();const composition=await selectComposition({serveUrl,id:'GeminiNarratedPresentation',browserExecutable,logLevel:'error'});checkCanceled();
  report({stage:'rendering',progress:0,totalFrames:composition.durationInFrames});let last=-1;
  await renderMedia({serveUrl,composition,browserExecutable,cancelSignal:cancellation.cancelSignal,codec:'h264',audioCodec:'aac',crf:19,pixelFormat:'yuv420p',outputLocation:output,concurrency:1,timeoutInMilliseconds:120000,logLevel:'error',onProgress:p=>{const percent=Math.floor(p.progress*100);if(percent!==last){last=percent;report({stage:'rendering',progress:p.progress,renderedFrames:p.renderedFrames,encodedFrames:p.encodedFrames,totalFrames:composition.durationInFrames});}}});checkCanceled();
  report({stage:'verifying',progress:0});
  const bins=path.join(rendererRoot,'node_modules','@remotion','compositor-win32-x64-msvc');
  const ffmpeg=path.join(bins,process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),ffprobe=path.join(bins,process.platform==='win32'?'ffprobe.exe':'ffprobe');await stat(ffmpeg);await stat(ffprobe);
  const run=promisify(execFile);checkCanceled();await fullDecodeVideo(ffmpeg,output,{signal:controller.signal});
  const {stdout}=await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',output],{windowsHide:true,maxBuffer:1024*1024,signal:controller.signal});checkCanceled();const metadata=JSON.parse(stdout),video=metadata.streams.find(s=>s.codec_type==='video'),audio=metadata.streams.find(s=>s.codec_type==='audio');
  if(!video||!audio||video.width!==composition.width||video.height!==composition.height||Math.abs(Number(metadata.format.duration)-composition.durationInFrames/composition.fps)>0.25)throw new Error('VIDEO_MEDIA_QA_FAILED');
  const audioOutput=output.replace(/\.mp4$/,'.m4a');
  await extractVideoAudio(ffmpeg,output,audioOutput,{signal:controller.signal});checkCanceled();
  await writeFile(path.join(sourceDir,'video','media-qa.json'),JSON.stringify({fullDecode:true,frames:composition.durationInFrames,fps:composition.fps,metadata,provider:data.provider,settings:data.settings,...(data.music?{music:data.music}:{}),...(data.bookends?{bookends:data.bookends}:{}),rows:data.rows.map(r=>({id:r.id,image:r.image,file:r.file,frames:r.frames})),renderedAt:new Date().toISOString()},null,2));report({stage:'verifying',progress:1});
}catch(error){
  // This local renderer never receives credentials. Keep bounded, redacted
  // diagnostics on disk so encoding failures can be diagnosed without UI logs.
  const message=String(error.message).slice(0,12000).replace(/AIza[\w-]{20,}|(?:api[_-]?key|authorization|token)\s*[:=]\s*\S+/gi,'[redacted]');
  const sourceDir=option('--source');if(sourceDir)await writeFile(path.join(sourceDir,'video','last-render-error.json'),JSON.stringify({name:error.name,message,at:new Date().toISOString()},null,2)).catch(()=>{});
  report({error:controller.signal.aborted?'CANCELED':renderErrorCode(error)});process.exitCode=1;
}finally{if(process.connected)process.disconnect();}

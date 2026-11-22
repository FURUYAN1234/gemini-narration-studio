
import path from 'node:path';
import os from 'node:os';
import {access,mkdir,mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {safeText} from './production.mjs';

const exec=promisify(execFile);
const manifests=fileURLToPath(new URL('../scripts/recording-runtime/',import.meta.url));
const localHome=process.env.LOCALAPPDATA||os.homedir();

export function recordingRuntime(cache=process.env.NARRATION_STUDIO_RECORDING_CACHE||path.join(localHome,'GeminiNarrationStudio','recording')) {
  let state='checking',chrome,install;
  const status=()=>state;
  const setup=async()=>{
    const pkg=JSON.parse(await readFile(path.join(manifests,'package.json'),'utf8'));
    const version=pkg.dependencies['playwright-core'];
    const root=path.join(cache,version);
    const browserCache=path.join(root,'browsers');
    await mkdir(root,{recursive:true});
    const require=createRequire(path.join(root,'package.json'));
    const packageRoot=path.join(root,'node_modules','playwright-core');
    const installedVersion=async()=>JSON.parse(await readFile(path.join(packageRoot,'package.json'),'utf8')).version;
    const load=()=>{
      process.env.PLAYWRIGHT_BROWSERS_PATH=browserCache;
      return require(packageRoot).chromium;
    };
    try {
      if(await installedVersion()!==version)throw new Error('RECORDING_SETUP_FAILED');
      const browser=load();
      await access(browser.executablePath());
      return browser;
    } catch {}
    const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:browserCache};
    for(const key of ['PLAYWRIGHT_DOWNLOAD_HOST','PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD','NODE_TLS_REJECT_UNAUTHORIZED'])delete env[key];
    const runOptions={cwd:root,env,timeout:180_000,windowsHide:true,maxBuffer:4*1024*1024};
    for(const file of ['package.json','package-lock.json'])await copyFile(path.join(manifests,file),path.join(root,file));
    try { if(await installedVersion()!==version)throw new Error('RECORDING_SETUP_FAILED');await access(path.join(packageRoot,'cli.js')); }
    catch {
      const cli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
      await exec(process.execPath,[cli,'ci','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--fetch-retries=0'],runOptions);
    }
    await exec(process.execPath,[path.join(packageRoot,'cli.js'),'install','--no-shell','chromium'],runOptions);
    const browser=load();
    await access(browser.executablePath());
    return browser;
  };
  const prepare=()=>{
    if(chrome)return Promise.resolve(true);
    install??=setup().then(browser=>{chrome=browser;state='ready';return true;},()=>{state='unavailable';return false;}).finally(()=>{install=undefined;});
    state='installing';
    return install;
  };
  return {status,prepare,get chromium(){return chrome;}};
}

export function normalizeRecording(input) {
  const urlText=input?.url;
  if(typeof urlText!=='string'||urlText.length>500)throw new Error('INVALID_RECORDING_URL');
  let url;
  try{url=new URL(urlText);}catch{throw new Error('INVALID_RECORDING_URL');}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash)
    throw new Error('INVALID_RECORDING_URL');
  if(!Array.isArray(input.steps)||input.steps.length<1||input.steps.length>7)throw new Error('INVALID_RECORDING_STEPS');
  const steps=input.steps.map(step=>{
    if(!step||typeof step.target!=='string'||!step.target.trim()||step.target.length>120||/[\x00-\x1f]/.test(step.target))throw new Error('INVALID_RECORDING_STEPS');
    const {action,target,text}=step;
    safeText(target,120);
    if(action==='click'&&Object.keys(step).length===2)return {action,target};
    if(action==='fill'&&typeof text==='string'&&text.length<=180&&Object.keys(step).length===3)return {action,target,text:safeText(text,180)};
    throw new Error('INVALID_RECORDING_STEPS');
  });
  return {url,steps};
}

export function rendererTool(root,name){
  if(!root)throw new Error('VIDEO_RENDERER_UNAVAILABLE');
  return path.join(root,'node_modules','@remotion','compositor-win32-x64-msvc',name+(process.platform==='win32'?'.exe':''));
}

export async function mediaDuration(root,file,signal) {
  try {
    const {stdout}=await exec(rendererTool(root,'ffprobe'),['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{windowsHide:true,signal,timeout:20_000});
    const seconds=Number(stdout.trim());
    if(seconds>0&&Number.isFinite(seconds))return seconds;
  } catch(error){if(signal?.aborted)throw error;}
  throw new Error('RECORDING_MEDIA_INVALID');
}

export async function videoDuration(root,file,signal) {
  try {
    const {stdout}=await exec(rendererTool(root,'ffprobe'),['-v','error','-select_streams','v:0','-show_entries','stream=duration:stream_tags=DURATION:format=duration','-of','json',file],{windowsHide:true,signal,timeout:20_000});
    const result=JSON.parse(stdout),stream=result.streams?.[0];
    if(stream){
      const stamp=stream.tags?.DURATION?.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
      const seconds=Number(stream.duration)||(stamp?Number(stamp[1])*3600+Number(stamp[2])*60+Number(stamp[3]):Number(result.format?.duration));
      if(seconds>0&&Number.isFinite(seconds))return seconds;
    }
  } catch(error){if(signal?.aborted)throw error;}
  throw new Error('RECORDING_MEDIA_INVALID');
}

export async function captureRecording({input,chromium,rendererRoot,outputDir,signal}) {
  const {url,steps}=normalizeRecording(input);
  const work=await mkdtemp(path.join(outputDir,'recording-'));
  let browser,context,sampling=false,samples;
  const abort=()=>{void browser?.close().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try {
    signal.throwIfAborted();
    const env={};
    for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','COMSPEC'])if(process.env[key])env[key]=process.env[key];
    browser=await chromium.launch({executablePath:chromium.executablePath(),chromiumSandbox:true,headless:true,timeout:15_000,env,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
    signal.throwIfAborted();
    const size={width:1280,height:720};
    context=await browser.newContext({viewport:size,acceptDownloads:false,serviceWorkers:'block'});
    await context.routeWebSocket('**/*',socket=>socket.close());
    await context.route('**/*',async route=>{
      const request=route.request();
      let same=false;
      try{same=new URL(request.url()).origin===url.origin;}catch{}
      if(!same||!['GET','HEAD'].includes(request.method()))return route.abort();
      try {
        const response=await route.fetch({maxRedirects:0,timeout:5000});
        if(response.status()>=300&&response.status()<400&&response.status()!==304)return route.abort();
        return await route.fulfill({response});
      } catch { await route.abort().catch(()=>{}); }
    });
    const page=await context.newPage();
    context.on('page',other=>{if(other!==page)void other.close().catch(()=>{});});
    const events=[];
    const result=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:7000}).catch(()=>null);
    if(!result?.ok()||new URL(page.url()).origin!==url.origin)throw new Error('RECORDING_PAGE_FAILED');
    const began=performance.now(),frames=[];
    const sample=async()=>{
      const name='frame-'+frames.length+'.jpg',time=performance.now()-began;
      await page.screenshot({path:path.join(work,name),type:'jpeg',quality:91,timeout:2500});
      frames.push({name,time});
    };
    await sample();
    sampling=true;
    let sampleError;
    samples=(async()=>{
      while(sampling&&!signal.aborted){
        await delay(70,undefined,{signal});
        if(sampling&&!signal.aborted)await sample();
      }
    })().catch(error=>{sampleError=error;});
    await delay(650,undefined,{signal});
    for(const {action,target,text} of steps){
      signal.throwIfAborted();
      if(sampleError)throw sampleError;
      events.push({action,target,startMs:Math.round(performance.now()-began)});
      const element=action==='click'?page.getByRole('button',{name:target,exact:true}):page.getByRole('textbox',{name:target,exact:true});
      if(action==='click')await element.click({timeout:2000});
      else {
        const type=await element.getAttribute('type',{timeout:2000});
        if(type&&type!=='text'&&type!=='search')throw new Error('INVALID_RECORDING_STEPS');
        await element.fill(text,{timeout:2000});
      }
      events.at(-1).endMs=Math.round(performance.now()-began);
      await delay(700,undefined,{signal});
    }
    await delay(1000,undefined,{signal});
    sampling=false;
    await samples;
    if(sampleError)throw sampleError;
    const end=performance.now()-began;
    if(end>29_900)throw new Error('RECORDING_TOO_LONG');
    const manifest=frames.map(({name,time},index)=>"file "+name+"\nduration "+Math.max(0.04,((frames[index+1]?.time??end)-time)/1000).toFixed(4)).join('\n');
    const source=path.join(work,'frames.txt'),destination=path.join(work,'recording.mp4');
    await writeFile(source,manifest+'\nfile '+frames.at(-1).name+'\n');
    await exec(rendererTool(rendererRoot,'ffmpeg'),['-nostdin','-v','error','-f','concat','-safe','1','-i',source,'-an','-r','30','-t',(end/1000).toFixed(3),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',destination],{windowsHide:true,signal,timeout:60_000});
    const duration=await mediaDuration(rendererRoot,destination,signal);
    if(events.at(-1).endMs>duration*1000)throw new Error('RECORDING_TIMING_UNAVAILABLE');
    return {bytes:await readFile(destination),duration,events};
  } catch(error){
    if(signal.aborted)throw new Error('CANCELED');
    if(/^[A-Z][A-Z_]+$/.test(error.message))throw error;
    throw new Error('RECORDING_FAILED');
  } finally {
    signal.removeEventListener('abort',abort);
    sampling=false;
    await context?.close().catch(()=>{});
    await samples;
    await browser?.close().catch(()=>{});
    await rm(work,{recursive:true,force:true});
  }
}

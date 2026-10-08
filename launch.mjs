import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readFile, mkdir, access,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

export const appRoot = path.dirname(fileURLToPath(import.meta.url));
export function options(args, home=os.homedir()) {
  const allowed = new Set(['--no-browser','--setup-only','--output','--port']);
  const result={openBrowser:true,setupOnly:false,output:path.join(home,'GeminiNarrationStudio'),port:6181};
  for(let i=0;i<args.length;i++) {
    const flag=args[i]; if(!allowed.has(flag))throw new Error('UNKNOWN_LAUNCH_OPTION');
    if(flag==='--no-browser')result.openBrowser=false;
    else if(flag==='--setup-only')result.setupOnly=true;
    else {
      const value=args[++i]; if(!value||value.startsWith('--'))throw new Error('MISSING_LAUNCH_VALUE');
      if(flag==='--output')result.output=path.resolve(value);
      else {result.port=Number(value); if(!Number.isInteger(result.port)||result.port<1024||result.port>65535)throw new Error('INVALID_PORT');}
    }
  }
  return result;
}
export function runNode(script,args=[],cwd=appRoot) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,...args],{cwd,stdio:'inherit',windowsHide:true});
    child.once('error',reject); child.once('exit',code=>code===0?resolve():reject(new Error('SETUP_COMMAND_FAILED')));
  });
}
export async function ensureSetup(root=appRoot) {
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const require=createRequire(path.join(root,'package.json'));
  let ready=true;
  for(const [name,version] of Object.entries(pkg.dependencies)) {
    try {if(require(name+'/package.json').version!==version)ready=false;} catch {ready=false;}
  }
  if(!ready) {
    console.log('初回準備: 動画作成用ファイルをインストールしています。');
    const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
    await access(npmCli); await runNode(npmCli,['ci','--no-audit','--no-fund'],root);
  }
  const {ensureBrowser}=require('@remotion/renderer');
  await ensureBrowser({logLevel:'info'});
  // The renderer's own cache must be present; no dependency on another app.
  await access(path.join(root,'node_modules','.remotion','chrome-headless-shell'));
}
export async function runtimeIdentity(root=appRoot){
 const files=['launch.mjs','package-lock.json'];
 async function walk(dir,prefix){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory()){if(entry.name!=='tests')await walk(path.join(dir,entry.name),name+'/');}else if(/\.(mjs|tsx|html|css|json)$/.test(name))files.push(name);}}
 await walk(path.join(root,'runtime'),'runtime/');const hash=createHash('sha256');
 for(const file of files.sort())hash.update(file+'\0'+createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')+'\n');
 return {buildId:hash.digest('hex'),protocol:1};
}
export async function existingStudio(port,output,identity) {
  try {
    const response=await fetch('http://127.0.0.1:'+port+'/api/launcher-status',{signal:AbortSignal.timeout(1200)});
    if(!response.ok)return false;
    const state=await response.json();
    if(state.app!=='gemini-narration-studio')return false;
    if(path.resolve(state.output)!==path.resolve(output))throw new Error('STUDIO_ALREADY_RUNNING_WITH_OTHER_PROJECT');
    identity??=await runtimeIdentity();
    if(state.buildId!==identity.buildId||state.protocol!==identity.protocol)throw new Error('STUDIO_RUNTIME_MISMATCH');
    return true;
  } catch(error) {
    if(['STUDIO_ALREADY_RUNNING_WITH_OTHER_PROJECT','STUDIO_RUNTIME_MISMATCH'].includes(error.message))throw error;
    return false;
  }
}
export function openLocalBrowser(url) {
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw new Error('INVALID_LOCAL_URL');
  const child=spawn('powershell.exe',['-NoProfile','-Command',`Start-Process '${url}'`],{windowsHide:true,stdio:'ignore'});
  child.on('error',()=>console.log('ブラウザで開いてください: '+url));
}
export async function launch(args=process.argv.slice(2)) {
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('NODE_22_REQUIRED');
  const config=options(args);
  process.chdir(appRoot);
  if(config.setupOnly){await ensureSetup();console.log('NARRATION_STUDIO_SETUP_READY');return;}
  const identity=await runtimeIdentity();
  if(await existingStudio(config.port,config.output,identity)) {
    const url='http://127.0.0.1:'+config.port;
    console.log('NARRATION_STUDIO_REUSED '+url); if(config.openBrowser)openLocalBrowser(url); return;
  }
  // A bound port must never be stopped or silently reused as a different app.
  const {createServer}=await import('node:net');
  await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',()=>reject(new Error('PORT_ALREADY_IN_USE')));probe.listen(config.port,'127.0.0.1',()=>probe.close(resolve));});
  await ensureSetup();
  await mkdir(config.output,{recursive:true});
  const {NarrationSession}=await import('./runtime/core.mjs');
  const {startServer}=await import('./runtime/server.mjs');
  const session=await NarrationSession.open({outputDir:config.output});
  const service=await startServer({session,port:config.port,sampleDir:path.join(config.output,'voice-samples'),videoRendererRoot:appRoot,launcherStatus:{app:'gemini-narration-studio',version:JSON.parse(await readFile(path.join(appRoot,'package.json'),'utf8')).version,output:config.output,...identity}});
  console.log('NARRATION_STUDIO_READY '+service.url);
  console.log('制作データ: '+config.output);
  if(config.openBrowser)openLocalBrowser(service.url);
  process.once('SIGINT',async()=>{await service.close();process.exitCode=0;});
  return service;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  launch().catch(error=>{console.error('NARRATION_STUDIO_START_FAILED '+(/^[A-Z_]+$/.test(error.message)?error.message:'CHECK_NODE_NETWORK_AND_PERMISSIONS'));process.exitCode=1;});
}

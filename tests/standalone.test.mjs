import * as launcher from '../launch.mjs';
import {NarrationSession} from '../runtime/core.mjs';
import {ProductionInputs} from '../runtime/production.mjs';
import {startServer} from '../runtime/server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {options,existingStudio,runtimeIdentity} from '../launch.mjs';
import {allowedFile,audit,validateDependencyAudit} from '../scripts/preflight.mjs';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';

test('release dependency audit fails closed on vulnerabilities or unavailable results',()=>{
 const counts={info:0,low:0,moderate:0,high:0,critical:0,total:0};
 assert.deepEqual(validateDependencyAudit({metadata:{vulnerabilities:counts},vulnerabilities:{}}),counts);
 for(const input of [null,{}, {error:{code:'NETWORK'}}, {metadata:{vulnerabilities:counts},vulnerabilities:3}, {metadata:{vulnerabilities:counts},vulnerabilities:[]}, {metadata:{vulnerabilities:{...counts,high:1,total:1}},vulnerabilities:{ws:{severity:'high'}}}, {metadata:{vulnerabilities:counts},vulnerabilities:{zip:{}}}, {metadata:{vulnerabilities:{...counts,total:'0'}},vulnerabilities:{}}]) assert.throws(()=>validateDependencyAudit(input),/DEPENDENCY_AUDIT/);
});
test('portable launch keeps persistent data outside replaceable release copy',()=>{
  const config=options(['--no-browser'],'C:/Users/Test User');
  assert.equal(config.openBrowser,false);assert.equal(config.port,6181);
  assert.equal(config.output,path.join('C:/Users/Test User','GeminiNarrationStudio'));
  assert.equal(options(['--output','C:/Data With Spaces']).output,path.resolve('C:/Data With Spaces'));
});
test('batch defaults to a fresh production while explicit resume/output retains a selected session',()=>{
 assert.equal(options([]).startupMode,'new');
 assert.equal(options(['--resume']).startupMode,'resume');
 assert.equal(options(['--output','C:/Selected']).startupMode,'resume');
});
test('running studio launch isolates a new production, explicit resume retains it, and busy reuse changes nothing',async t=>{
 const priorCwd=process.cwd(),home=await mkdtemp(path.join(os.tmpdir(),'studio-launch-reuse-')),dir=path.join(home,'GeminiNarrationStudio');t.after(()=>{process.chdir(priorCwd);return rm(home,{recursive:true,force:true});});
 const session=await NarrationSession.open({outputDir:dir});session.setKey('fixture-key');await session.appendRow({id:'old',caption:'前の字幕。',speech:'まえのじまく。'});
 const production=await ProductionInputs.open(dir);await production.addAsset('前の画像.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZioAAAAASUVORK5CYII=','base64'));
 const oldJob=await readFile(path.join(dir,'job.json')),oldProduction=await readFile(path.join(dir,'production.json'));const service=await startServer({session,port:0,videoRendererRoot:dir,launcherStatus:{app:'gemini-narration-studio',output:dir,...await launcher.runtimeIdentity()}});t.after(()=>service.close());const args=['--no-browser','--port',service.url.split(':').at(-1)];
 session.busy=true;await assert.rejects(launcher.launch(args,home),/BUSY/);session.busy=false;
 await launcher.launch(args,home);const created=await(await fetch(service.url+'/api/status')).json();assert.notEqual(created.projectId,'original');assert.equal(created.rows.length,0);assert.equal(created.production.assets.length,0);assert.equal(created.keyConfigured,true);
 await launcher.launch([...args,'--resume'],home);const resumed=await(await fetch(service.url+'/api/status')).json();assert.equal(resumed.projectId,created.projectId);assert.equal(resumed.rows.length,0);
 const boot=await(await fetch(service.url+'/api/bootstrap')).json(),switched=await fetch(service.url+'/api/project',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':boot.token},body:JSON.stringify({id:'original',sessionId:resumed.sessionId,revision:resumed.revision})});assert.equal(switched.status,404);
 const reopened=await launcher.reuseStudio(service.url,'resume');assert.equal(reopened.projectId,created.projectId);assert.equal(reopened.production.assets.length,0);
 assert.equal((await(await fetch(service.url+'/api/status')).json()).projectId,created.projectId);assert.deepEqual(await readFile(path.join(dir,'job.json')),oldJob);assert.deepEqual(await readFile(path.join(dir,'production.json')),oldProduction);
});

test('reject invalid launch arguments',()=>{
  for(const args of [['--port','0'],['--port','6181.2'],['--port','70000'],['--output'],['--api-key','secret']])assert.throws(()=>options(args));
});
test('distribution permits source and samples but rejects private state and settings',()=>{
  for(const file of ['launch.mjs','scripts/bootstrap.ps1','docs/publication.md','docs/note-draft.md','package-lock.json','runtime/core.mjs','runtime/vendor/voice-samples/abc.wav','runtime/vendor/sources.json'])assert.equal(allowedFile(file),true,file);
  for(const file of ['.env','runtime/job.json','runtime/vendor/production.json','data/job.json','node_modules/a.js','runtime/vendor/.npmrc','output/private.png','runtime/private.txt'])assert.equal(allowedFile(file),false,file);
});
test('documentation screenshots stay in a narrow image-only release directory',async()=>{
 for(const file of ['docs/screenshots/templates.jpg','docs/screenshots/reading.png'])assert.equal(allowedFile(file),true,file);
 for(const file of ['docs/screenshots/.env.jpg','docs/screenshots/../private.jpg','docs/screenshots/private.mp4','docs/screenshots/code.html','docs/screenshots/nested/image.jpg'])assert.equal(allowedFile(file),false,file);
 const root=await mkdtemp(path.join(os.tmpdir(),'narration-doc-image-'));
 try{
  await mkdir(path.join(root,'docs/screenshots'),{recursive:true});
  await writeFile(path.join(root,'docs/screenshots/fake.jpg'),'<script>not an image</script>');
  await assert.rejects(audit(root),/DOCUMENTATION_IMAGE_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Windows bootstrap reuses ready Node/npm and rejects missing runtime and corrupt downloads before extraction', {skip:process.platform!=='win32'}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'narration-bootstrap-test-'));
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 try{
  const bootstrap=fileURLToPath(new URL('../scripts/bootstrap.ps1',import.meta.url));
  const ps=`$ErrorActionPreference='Stop'
. ${quote(bootstrap)}
if (-not (Test-StudioNode ${quote(process.execPath)})) { throw 'Expected ready Node/npm' }
if (Test-StudioNode ${quote(path.join(root,'missing.exe'))}) { throw 'Missing Node accepted' }
$env:PATH=$env:SystemRoot+'\\System32;'+$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0'
$env:PROCESSOR_ARCHITECTURE='AMD64';$env:PROCESSOR_ARCHITEW6432=''
function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing) [IO.File]::WriteAllText($OutFile,'damaged archive') }

$rejected=$false
try { Get-StudioNode -CacheRoot ${quote(root)} } catch { if ($_.Exception.Message -match '^NODE_DOWNLOAD_CHECKSUM_FAILED') {$rejected=$true} else {throw} }
if (-not $rejected) {throw 'Corrupt download accepted'}
if (@(Get-ChildItem -LiteralPath ${quote(root)} -Directory -Force).Count -ne 0) {throw 'Failed installation was cached'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipSource=Join-Path ${quote(root)} 'archive-source';New-Item -ItemType Directory -Path $zipSource | Out-Null
[IO.File]::WriteAllText((Join-Path $zipSource 'CHANGELOG.md'),'fixture')
[IO.Directory]::CreateDirectory((Join-Path $zipSource 'node_modules/npm')) | Out-Null
[IO.File]::WriteAllText((Join-Path $zipSource 'node_modules/npm/test.txt'),'nested')
$validZip=Join-Path ${quote(root)} 'valid.zip';[IO.Compression.ZipFile]::CreateFromDirectory($zipSource,$validZip)
$z=[IO.Compression.ZipFile]::Open($validZip,[IO.Compression.ZipArchiveMode]::Update);try {$entry=$z.CreateEntry('forward/slash.txt');$w=[IO.StreamWriter]::new($entry.Open());try {$w.Write('forward-slash')} finally {$w.Dispose()}} finally {$z.Dispose()}
$sha=[Security.Cryptography.SHA256]::Create();try {$expected=[BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($validZip))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
$extracted=Join-Path ${quote(root)} ('long-destination-' + ('x' * 180))
Expand-StudioArchive $validZip $extracted $expected
if ([IO.File]::ReadAllText((([string][char]92)*2 + '?' + [char]92 + (Join-Path $extracted 'CHANGELOG.md'))) -ne 'fixture') {throw 'Valid archive not extracted'}
if ([IO.File]::ReadAllText((([string][char]92)*2 + '?' + [char]92 + $extracted + [char]92 + 'forward' + [char]92 + 'slash.txt')) -ne 'forward-slash') {throw 'ZIP forward slash not normalized'}


$badZip=Join-Path ${quote(root)} 'traversal.zip';$z=[IO.Compression.ZipFile]::Open($badZip,[IO.Compression.ZipArchiveMode]::Create)
try {$z.CreateEntry('../escape.txt') | Out-Null} finally {$z.Dispose()}
$sha=[Security.Cryptography.SHA256]::Create();try {$expected=[BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($badZip))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
$rejected=$false;try {Expand-StudioArchive $badZip (Join-Path ${quote(root)} 'bad-output') $expected} catch {if ($_.Exception.Message -eq 'NODE_ARCHIVE_PATH_INVALID') {$rejected=$true} else {throw}}
if (-not $rejected -or (Test-Path -LiteralPath (Join-Path ${quote(root)} 'escape.txt'))) {throw 'Archive traversal accepted'}
Write-Output 'BOOTSTRAP_BOUNDARIES_OK'
`;
  const fixture=path.join(root,'test.ps1');await writeFile(fixture,ps);
  const result=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fixture],{encoding:'utf8'});
  assert.match(result,/BOOTSTRAP_BOUNDARIES_OK/);
  const batch=await readFile(new URL('../start_narration_studio.bat',import.meta.url),'utf8');assert.match(batch,/bootstrap\.ps1" %\*/);assert.match(batch,/exit \/b %studio_exit%/);
 }finally{assert.equal(path.dirname(root),os.tmpdir());await rm(root,{recursive:true,force:true});}
});
test('reuse only exact matching standalone studio; reject another data directory',async()=>{
  const identity={buildId:'same',protocol:1};const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'gemini-narration-studio',output:path.resolve('a'),...identity}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {assert.equal(await existingStudio(server.address().port,'a',identity),true);await assert.rejects(existingStudio(server.address().port,'b',identity),/OTHER_PROJECT/);}finally{await new Promise(r=>server.close(r));}
});
test('same data directory cannot silently reuse a different runtime build',async()=>{
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'gemini-narration-studio',output:path.resolve('a'),buildId:'old',protocol:1}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await assert.rejects(existingStudio(server.address().port,'a',{buildId:'new',protocol:1}),/RUNTIME_MISMATCH/);}
 finally{await new Promise(r=>server.close(r));}
});

test('runtime identity is independent of root and changes with executable content, not tests',async t=>{
 const first=await mkdtemp(path.join(os.tmpdir(),'studio-build-a-')),second=await mkdtemp(path.join(os.tmpdir(),'studio-build-b-'));t.after(()=>rm(first,{recursive:true,force:true}));t.after(()=>rm(second,{recursive:true,force:true}));
 for(const root of [first,second]){await mkdir(path.join(root,'runtime/tests'),{recursive:true});for(const [file,text]of [['launch.mjs','launch'],['package-lock.json','{}'],['runtime/server.mjs','server'],['runtime/tests/test.mjs','test']])await writeFile(path.join(root,file),text);}
 const initial=await runtimeIdentity(first);assert.deepEqual(await runtimeIdentity(second),initial);await writeFile(path.join(second,'runtime/tests/test.mjs'),'changed test');assert.deepEqual(await runtimeIdentity(second),initial);await writeFile(path.join(second,'runtime/server.mjs'),'changed executable');assert.notEqual((await runtimeIdentity(second)).buildId,initial.buildId);
});

test('launcher rejects legacy protocol and other applications while preserving a busy matching studio',async()=>{
 let state={app:'gemini-narration-studio',output:path.resolve('a'),buildId:'same',protocol:1,busy:true};const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const port=server.address().port,identity={buildId:'same',protocol:1};assert.equal(await existingStudio(port,'a',identity),true);assert.equal(state.busy,true);delete state.protocol;await assert.rejects(existingStudio(port,'a',identity),/RUNTIME_MISMATCH/);state.app='other-app';assert.equal(await existingStudio(port,'a',identity),false);}finally{await new Promise(r=>server.close(r));}
});
test('release audit rejects private state or installed packages forcibly staged in Git',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'narration-release-test-'));
  try {
    execFileSync('git',['init','-q'],{cwd:root,stdio:'ignore'});
    for(const file of ['output/job.json','node_modules/local/settings.json']) {
      await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),'{}');
      execFileSync('git',['add','-f',file],{cwd:root,stdio:'ignore'});
      await assert.rejects(audit(root),/TRACKED_RELEASE_FILE_REJECTED/);
      execFileSync('git',['rm','--cached','-q',file],{cwd:root,stdio:'ignore'});
    }
  } finally {assert.equal(path.dirname(root),os.tmpdir());await rm(root,{recursive:true,force:true});}
});

test('only the public manual PDF is distributable and false PDFs are rejected',async t=>{
 assert.equal(allowedFile('docs/narration-guide.pdf'),true);assert.equal(allowedFile('.gitattributes'),true);
 for(const name of ['docs/private.pdf','docs/../private.pdf','docs/narration-guide.pdf.exe'])assert.equal(allowedFile(name),false);
 const dir=await mkdtemp(path.join(os.tmpdir(),'narration-pdf-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'docs'));await writeFile(path.join(dir,'docs/narration-guide.pdf'),'<html>wrong</html>');await assert.rejects(audit(dir),/DOCUMENTATION_PDF_INVALID/);
});

// The guide is a fixed bundled file; reading/saving it must not need a key.
test('manual opens the bundled PDF without a duplicate save control or exposed paths',async t=>{
 const {NarrationSession}=await import('../runtime/core.mjs');
 const {startServer}=await import('../runtime/server.mjs');
 const {mkdtemp,rm,readFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {fileURLToPath}=await import('node:url');
 const folder=await mkdtemp(path.join(tmpdir(),'narration-manual-'));
 const session=await NarrationSession.open({outputDir:folder});
 const appRoot=fileURLToPath(new URL('../',import.meta.url));
 const service=await startServer({session,port:0,videoRendererRoot:appRoot});
 t.after(async()=>{await service.close();await rm(folder,{recursive:true,force:true});});
 const expected=await readFile(path.join(appRoot,'docs/narration-guide.pdf'));
 for(const [suffix,disposition] of [['','inline'],['?file=LICENSE','inline']]){
  const res=await fetch(service.url+'/narration-guide.pdf'+suffix);assert.equal(res.status,200);
  assert.equal(res.headers.get('content-type'),'application/pdf');
  assert.equal(res.headers.get('x-content-type-options'),'nosniff');
  assert.equal(res.headers.get('content-disposition'),disposition+'; filename="narration-guide.pdf"');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()),expected);
 }
 assert.equal((await fetch(service.url+'/docs/LICENSE')).status,404);
 assert.equal((await fetch(service.url+'/narration-guide.pdf',{headers:{Origin:'https://foreign.invalid'}})).status,403);
 const html=await(await fetch(service.url+'/')).text();
 assert.match(html,/<header[^>]*>[\s\S]*使い方マニュアル（PDF）[\s\S]*画面の配色[\s\S]*<\/header>/);
 assert.match(html,/href="\/narration-guide.pdf" target="_blank" rel="noopener noreferrer"/);
 assert.doesNotMatch(html,/manual-save|マニュアルPDFをダウンロード|↓ 保存/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {options,existingStudio} from '../launch.mjs';
import {allowedFile,audit} from '../scripts/preflight.mjs';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
test('portable launch keeps persistent data outside replaceable release copy',()=>{
  const config=options(['--no-browser'],'C:/Users/Test User');
  assert.equal(config.openBrowser,false);assert.equal(config.port,6181);
  assert.equal(config.output,path.join('C:/Users/Test User','GeminiNarrationStudio'));
  assert.equal(options(['--output','C:/Data With Spaces']).output,path.resolve('C:/Data With Spaces'));
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
  const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'gemini-narration-studio',output:path.resolve('a')}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {assert.equal(await existingStudio(server.address().port,'a'),true);await assert.rejects(existingStudio(server.address().port,'b'),/OTHER_PROJECT/);}finally{await new Promise(r=>server.close(r));}
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

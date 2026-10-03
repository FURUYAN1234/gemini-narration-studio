import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {options,existingStudio} from '../launch.mjs';
import {allowedFile,audit} from '../scripts/preflight.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import {createServer} from 'node:http';
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
  for(const file of ['launch.mjs','package-lock.json','runtime/core.mjs','runtime/vendor/voice-samples/abc.wav','runtime/vendor/sources.json'])assert.equal(allowedFile(file),true,file);
  for(const file of ['.env','runtime/job.json','runtime/vendor/production.json','data/job.json','node_modules/a.js','runtime/vendor/.npmrc','output/private.png','runtime/private.txt'])assert.equal(allowedFile(file),false,file);
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

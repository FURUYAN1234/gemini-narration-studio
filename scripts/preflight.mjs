import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SAMPLE_SETTINGS,previewFingerprint,wavInfo} from '../runtime/core.mjs';
export function allowedFile(relative) {
  if(/(^|\/)(\.git|node_modules|output|data)(\/|$)/.test(relative))return false;
  if(/(^|\/)(\.env[^/]*|\.npmrc|job\.json|production\.json|active-project\.json|video-receipt\.json|credentials[^/]*|auth\.json)$/.test(relative))return false;
  return /^(package(-lock)?\.json|\.gitignore|start_narration_studio\.bat|launch\.mjs|README\.md|THIRD_PARTY_NOTICES\.md|scripts\/[^/]+\.mjs|tests\/[^/]+\.test\.mjs|docs\/(deploy\.md|releases\/v\d+\.\d+\.\d+\.md)|runtime\/[^/]+\.(mjs|tsx)|runtime\/tests\/[^/]+\.test\.mjs|runtime\/ui\/(app\.mjs|index\.html|style\.css)|runtime\/vendor\/[A-Za-z0-9_.\/-]+)$/.test(relative);
}
export async function audit(root,{tracked=false}={}) {
  let count=0,samples=0;const sampleIds=new Set();
  async function walk(dir,prefix='') {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      if(!prefix&&['.git','node_modules','output','data'].includes(entry.name))continue;
      if(!prefix&&entry.name==='HANDOFF.md')continue;
      const rel=prefix+entry.name;
      if(entry.isSymbolicLink())throw new Error('RELEASE_SYMLINK_REJECTED');
      if(entry.isDirectory()){await walk(path.join(dir,entry.name),rel+'/');continue;}
      if(!allowedFile(rel))throw new Error('RELEASE_FILE_REJECTED: '+rel);
      if(/\.(json|mjs|tsx|md|html|css|bat)$/.test(rel)) {
        const text=await readFile(path.join(root,rel),'utf8');
        if(/AIza[\w-]{35}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}/.test(text))throw new Error('RELEASE_SECRET_REJECTED');
        if(rel.startsWith('runtime/vendor/voice-samples/')&&rel.endsWith('.json')) {
          const sample=JSON.parse(text);
          if(!/^[a-f0-9]{64}\.wav$/.test(sample.file)||sample.source!=='Gemini TTS')throw new Error('INVALID_BUNDLED_SAMPLE');
          const wave=await readFile(path.join(root,'runtime/vendor/voice-samples',sample.file));
          wavInfo(wave);
          if(sample.id!==previewFingerprint(sample.settings)||rel!==`runtime/vendor/voice-samples/${sample.id}.json`)throw new Error('INVALID_SAMPLE_FINGERPRINT');
          sampleIds.add(sample.id);
          samples++;
        }
      }
      count++;
    }
  }
  await walk(root);
  if(SAMPLE_SETTINGS.some(config=>!sampleIds.has(previewFingerprint(config))))throw new Error('BUNDLED_180_SAMPLES_REQUIRED');
  for(const required of ['package.json','package-lock.json','launch.mjs','start_narration_studio.bat','README.md','runtime/server.mjs'])await stat(path.join(root,required));
  return {count,samples,presetCoverage:SAMPLE_SETTINGS.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await audit(path.resolve(fileURLToPath(new URL('..',import.meta.url))));
  console.log('STANDALONE_RELEASE_PREFLIGHT_OK '+JSON.stringify(result));
}

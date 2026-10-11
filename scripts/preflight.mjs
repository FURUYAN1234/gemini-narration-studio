import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {SAMPLE_SETTINGS,previewFingerprint,wavInfo} from '../runtime/core.mjs';
import {validateAsset} from '../runtime/production.mjs';
export function allowedFile(relative) {
  if(/(^|\/)(\.git|node_modules|output|data|dist)(\/|$)/.test(relative))return false;
  if(/(^|\/)(\.env[^/]*|\.npmrc|job\.json|production\.json|active-project\.json|video-receipt\.json|credentials[^/]*|auth\.json)$/.test(relative))return false;
  return /^(package(-lock)?\.json|\.gitignore|start_narration_studio\.bat|launch\.mjs|LICENSE|index\.html|public\/LICENSE\.txt|README\.md|THIRD_PARTY_NOTICES\.md|scripts\/(bootstrap\.ps1|[^/]+\.mjs)|tests\/[^/]+\.test\.mjs|docs\/(narration-guide\.pdf|deploy\.md|publication\.md|note-draft\.md|licenses\/previous-notices\.md|releases\/v\d+\.\d+\.\d+\.md|screenshots\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp))|runtime\/[^/]+\.(mjs|tsx)|runtime\/tests\/[^/]+\.test\.mjs|runtime\/ui\/(app\.mjs|index\.html|style\.css)|runtime\/vendor\/[A-Za-z0-9_.\/-]+)$/.test(relative);
}
export function validateDependencyAudit(result) {
  const counts=result?.metadata?.vulnerabilities;
  if(result?.error||!counts||!result.vulnerabilities||typeof result.vulnerabilities!=='object'||Array.isArray(result.vulnerabilities))throw new Error('DEPENDENCY_AUDIT_UNAVAILABLE');
  for(const key of ['info','low','moderate','high','critical','total'])if(!Number.isInteger(counts[key])||counts[key]<0)throw new Error('DEPENDENCY_AUDIT_INVALID');
  if(Object.values(counts).some(value=>value!==0)||Object.keys(result.vulnerabilities).length)throw new Error('DEPENDENCY_AUDIT_VULNERABILITIES');
  return counts;
}
export async function audit(root,{tracked=false}={}) {
  let count=0,samples=0;const sampleIds=new Set();
  const hasGit=await stat(path.join(root,'.git')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  if(hasGit) {
    const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);
    for(const file of files)if(!allowedFile(file))throw new Error('TRACKED_RELEASE_FILE_REJECTED: '+file);
  }
  async function walk(dir,prefix='') {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      if(!prefix&&['.git','node_modules','output','data','dist'].includes(entry.name))continue;
      if(!prefix&&entry.name==='HANDOFF.md')continue;
      const rel=prefix+entry.name;
      if(entry.isSymbolicLink())throw new Error('RELEASE_SYMLINK_REJECTED');
      if(entry.isDirectory()){await walk(path.join(dir,entry.name),rel+'/');continue;}
      if(!allowedFile(rel))throw new Error('RELEASE_FILE_REJECTED: '+rel);
      if(rel==='docs/narration-guide.pdf'){
        const pdf=await readFile(path.join(root,rel));
        if(pdf.subarray(0,5).toString()!=='%PDF-'||!pdf.subarray(-1024).toString().includes('%%EOF'))throw new Error('DOCUMENTATION_PDF_INVALID');
      }
      if(rel.startsWith('docs/screenshots/')){
        try{validateAsset(entry.name,await readFile(path.join(root,rel)));}
        catch{throw new Error('DOCUMENTATION_IMAGE_INVALID: '+rel);}
      }
      if(/\.(json|mjs|tsx|md|html|css|bat|ps1)$/.test(rel)) {
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
  for(const required of ['package.json','package-lock.json','launch.mjs','start_narration_studio.bat','scripts/bootstrap.ps1','README.md','runtime/server.mjs'])await stat(path.join(root,required));
  return {count,samples,presetCoverage:SAMPLE_SETTINGS.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
  const result=await audit(root);
  let dependencyResult;
  try {
    const command=process.platform==='win32'?'cmd.exe':'npm';
    const args=process.platform==='win32'?['/d','/s','/c','npm audit --json --ignore-scripts']:['audit','--json','--ignore-scripts'];
    dependencyResult=JSON.parse(execFileSync(command,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,stdio:['ignore','pipe','pipe']}));
  }catch{throw new Error('DEPENDENCY_AUDIT_FAILED');}
  validateDependencyAudit(dependencyResult);
  console.log('STANDALONE_DEPENDENCY_AUDIT_OK total=0');
  console.log('STANDALONE_RELEASE_PREFLIGHT_OK '+JSON.stringify(result));
}

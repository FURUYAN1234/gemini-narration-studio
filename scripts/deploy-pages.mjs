import {mkdtemp,cp,rm,realpath,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {verifyBuiltSecurity} from './web-security.mjs';
const root=process.cwd(),repo='https://github.com/FURUYAN1234/gemini-narration-studio.git';
const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true});
if(git(['remote','get-url','origin']).trim()!==repo)throw new Error('UNEXPECTED_PUBLIC_REPOSITORY');
verifyBuiltSecurity(await readFile(path.join(root,'dist/index.html'),'utf8'));
const work=await mkdtemp(path.join(tmpdir(),'narration-pages-'));
try{
 await cp(path.join(root,'dist'),work,{recursive:true});
 git(['init','--initial-branch=gh-pages'],work);
 git(['config','user.name',git(['config','user.name']).trim()],work);
 git(['config','user.email',git(['config','user.email']).trim()],work);
 git(['add','--all'],work);git(['commit','-m','Publish verified narration download guide'],work);
 git(['push',repo,'HEAD:gh-pages','--force'],work);
 const pages='repos/FURUYAN1234/gemini-narration-studio/pages';
 const result=spawnSync('gh',['api',pages],{encoding:'utf8',windowsHide:true});
 if(result.status!==0){
   if(!/HTTP 404/.test(result.stderr||''))throw new Error('PAGES_SETTINGS_READ_FAILED');
   execFileSync('gh',['api',pages,'--method','POST','-f','source[branch]=gh-pages','-f','source[path]=/','-f','build_type=legacy'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 }else{
   const settings=JSON.parse(result.stdout);
   if(settings.source?.branch!=='gh-pages'||settings.source?.path!=='/')execFileSync('gh',['api',pages,'--method','PUT','-f','source[branch]=gh-pages','-f','source[path]=/'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 }
 console.log('NARRATION_PUBLIC_GUIDE_PUBLISHED');
}finally{
 const resolved=await realpath(work),base=await realpath(tmpdir());
 if(path.dirname(resolved).toLowerCase()!==base.toLowerCase()||!path.basename(resolved).startsWith('narration-pages-'))throw new Error('UNSAFE_PAGES_TEMP_PATH');
 await rm(resolved,{recursive:true,force:true});
}

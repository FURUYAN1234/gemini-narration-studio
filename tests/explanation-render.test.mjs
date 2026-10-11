import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill} from '@remotion/renderer';

test('all four explanation layouts render Japanese text with motion and quiet mode through the actual presentation',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),work=await mkdtemp(path.join(tmpdir(),'explanation-render-'));t.after(()=>rm(work,{recursive:true,force:true}));
 const publicDir=path.join(work,'public');await mkdir(path.join(publicDir,'narration'),{recursive:true});await copyFile(path.join(root,'runtime/vendor/NotoSansJP.ttf'),path.join(publicDir,'narration/NotoSansJP.ttf'));
 // Explicit renderer-only fixtures. This test does not count as API or audio proof.
 const examples=[
  {type:'comparison',unit:'',items:[{label:'画像',value:'情景を伝える',quote:'画像は情景を伝える'},{label:'図解',value:'関係を伝える',quote:'図解は関係を伝える'}]},
  {type:'steps',unit:'',items:['素材を集める','台本を整える','読みを確認する','動画を作る'].map(label=>({label,value:'',quote:label}))},
  {type:'stat',unit:'',items:[{label:'サンプル',value:'180件',quote:'サンプルは180件'}]},
  {type:'bar',unit:'分',items:[['準備','12'],['確認','8'],['共有','4']].map(([label,value])=>({label,value,quote:label+'は'+value+'分'}))}
 ];
 const rows=examples.map((explanation,i)=>({id:'test'+i,title:['見せ方を選ぶ','順番に進める','数字を大きく伝える','同じ単位で比べる'][i],caption:explanation.items.map(x=>x.quote).join('。')+'。',src:'fixture.wav',from:0,frames:300,explanation}));
 const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);await writeFile(path.join(publicDir,'fixture.wav'),wav);
 const entry=path.join(work,'main.tsx'),component=path.join(root,'runtime/presentation.tsx').replaceAll('\\','/');
 await writeFile(entry,`import React from 'react';import {registerRoot,Composition} from 'remotion';import {NarratedPresentation} from ${JSON.stringify(component)};
 const rows=${JSON.stringify(rows)},theme={name:'test',background:'#092e45',foreground:'#d9eef5',heading:'#ffffff',accent:'#75d9ff'};
 const Sheet=({moving=true})=><div>{rows.map((row,i)=><div key={i} style={{position:'absolute',left:i%2*960,top:Math.floor(i/2)*540,width:960,height:540,overflow:'hidden'}}><div style={{width:1920,height:1080,position:'absolute',transform:'scale(.5)',transformOrigin:'0 0'}}><NarratedPresentation theme={theme} data={{title:'TEST FIXTURE',fps:30,durationInFrames:300,rows:[row],motion:moving?{version:1,style:'editorial',intensity:'standard'}:null}}/></div></div>)}</div>;
 registerRoot(()=> <Composition id="Explanations" component={Sheet} defaultProps={{moving:true}} durationInFrames={300} fps={30} width={1920} height={1080}/>);`);
 const browserExecutable=path.join(root,'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
 const serveUrl=await bundle({entryPoint:entry,publicDir,webpackOverride:c=>({...c,resolve:{...c.resolve,modules:[path.join(root,'node_modules'),...(c.resolve?.modules||['node_modules'])]}})});
 const composition=await selectComposition({serveUrl,id:'Explanations',browserExecutable,logLevel:'error'}),hashes=[];
 for(const [name,frame,moving]of [['early',30,true],['complete',270,true],['quiet',270,false]]){const output=path.join(work,name+'.png');await renderStill({serveUrl,composition,browserExecutable,output,imageFormat:'png',frame,inputProps:{moving},logLevel:'error'});const bytes=await readFile(output);assert.ok(bytes.length>30000);hashes.push(createHash('sha256').update(bytes).digest('hex'));if(process.env.STUDIO_EXPLANATION_EVIDENCE){await mkdir(process.env.STUDIO_EXPLANATION_EVIDENCE,{recursive:true});await copyFile(output,path.join(process.env.STUDIO_EXPLANATION_EVIDENCE,name+'.png'));}}
 // Motion changes the entrance, then settles to the same fully readable layout.
 assert.notEqual(hashes[0],hashes[1]);assert.equal(hashes[1],hashes[2]);
});

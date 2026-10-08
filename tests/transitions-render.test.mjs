import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,copyFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill} from '@remotion/renderer';
import {TRANSITION_VARIANTS,transitionLayers} from '../runtime/motion.mjs';

// Decode our Chromium RGB/RGBA PNG using the standard PNG scanline filters.
// The bundled video FFmpeg intentionally has no rawvideo output muxer.
function pixels(png){
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');let width,height,channels;const chunks=[];
 for(let i=8;i<png.length;){const n=png.readUInt32BE(i),type=png.toString('ascii',i+4,i+8),data=png.subarray(i+8,i+8+n);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.ok([2,6].includes(data[9]));channels=data[9]===2?3:4;assert.equal(data[12],0);}if(type==='IDAT')chunks.push(data);i+=n+12;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,out=Buffer.alloc(width*height*3);let prior=Buffer.alloc(stride),at=0;
 for(let y=0;y<height;y++){const filter=raw[at++],line=Buffer.alloc(stride);assert.ok(filter<=4);for(let x=0;x<stride;x++){const a=x>=channels?line[x-channels]:0,b=prior[x],c=x>=channels?prior[x-channels]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c),predictor=[0,a,b,Math.floor((a+b)/2),pa<=pb&&pa<=pc?a:pb<=pc?b:c][filter];line[x]=(raw[at++]+predictor)&255;}for(let x=0;x<width;x++)line.copy(out,(y*width+x)*3,x*channels,x*channels+3);prior=line;}
 assert.equal(at,raw.length);return out;
}

test('all 35 real Chromium masks differ, retain subtitles, and keep the image aligned without mirrored clocks or repeated tiles',async t=>{
 if(process.platform!=='win32'){t.skip('Windows bundled renderer');return;}
 const root=process.cwd(),work=await mkdtemp(path.join(tmpdir(),'studio-transition-'));t.after(()=>rm(work,{recursive:true,force:true}));
 const choices=Object.entries(TRANSITION_VARIANTS).flatMap(([family,n])=>Array.from({length:n},(_,variant)=>({family,variant})));
 const entry=path.join(work,'main.tsx'),component=path.join(root,'runtime/motion-presentation.tsx').replaceAll('\\','/'),publicDir=path.join(work,'public');await mkdir(path.join(publicDir,'cuts'),{recursive:true});
 // Explicit test fixture, not provider output: four asymmetric color quadrants
 // expose mirrored clocks and incorrectly repeated/cropped images in tile masks.
 await writeFile(path.join(publicDir,'cuts/alignment.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="895"><path fill="#f01e14" d="M0 0H960V448H0Z"/><path fill="#14f01e" d="M960 0H1920V448H960Z"/><path fill="#1e14f0" d="M0 448H960V895H0Z"/><path fill="#f0dc14" d="M960 448H1920V895H960Z"/></svg>');
 await writeFile(entry,`import React from 'react';import {registerRoot,Composition} from 'remotion';import {TransitionMask} from ${JSON.stringify(component)};
 const choices=${JSON.stringify(choices)};
 const Sheet=({image=false})=> <div style={{position:'absolute',inset:0,background:'#000000'}}>{choices.map((choice,i)=><div key={i} style={{position:'absolute',left:i%5*384,top:Math.floor(i/5)*216,width:384,height:216,overflow:'hidden'}}><div style={{position:'absolute',width:1920,height:1080,transform:'scale(.2)',transformOrigin:'0 0',background:'#000000'}}><div style={{position:'absolute',bottom:0,height:185,width:1920,background:'#ffffff'}}/><TransitionMask choice={choice} coverage={.5} color={image?'#000000':'#00ff00'} image={image?'cuts/alignment.svg':undefined}/></div></div>)}</div>;
 registerRoot(()=> <Composition id="Transitions" component={Sheet} defaultProps={{image:false}} durationInFrames={1} fps={30} width={1920} height={1512}/>);`);
 const browserExecutable=path.join(root,'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
 const serveUrl=await bundle({entryPoint:entry,publicDir,webpackOverride:c=>({...c,resolve:{...c.resolve,modules:[path.join(root,'node_modules'),...(c.resolve?.modules||['node_modules'])]}})});
 const composition=await selectComposition({serveUrl,id:'Transitions',browserExecutable,logLevel:'error'}),output=path.join(work,'catalogue.png');
 await renderStill({serveUrl,composition,browserExecutable,output,imageFormat:'png',logLevel:'error'});
 const rgb=pixels(await readFile(output));
 const hashes=new Set();for(let i=0;i<choices.length;i++){
  const bytes=[],x=i%5*384,y=Math.floor(i/5)*216;let green=0;
  for(let dy=0;dy<179;dy++)for(let dx=0;dx<384;dx++){const at=((y+dy)*1920+x+dx)*3;bytes.push(rgb[at],rgb[at+1],rgb[at+2]);green+=rgb[at+1];}
  assert.ok(green>0&&green<384*179*255,JSON.stringify(choices[i])+' must reveal content');hashes.add(createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
  for(const dy of [180,200,215])for(const dx of [0,100,383]){const at=((y+dy)*1920+x+dx)*3;assert.deepEqual([...rgb.subarray(at,at+3)],[255,255,255],JSON.stringify(choices[i])+' subtitle lane');}
 }
 assert.equal(hashes.size,35,'visually distinct masks');
 const imageOutput=path.join(work,'image-catalogue.png'),imageComposition=await selectComposition({serveUrl,id:'Transitions',browserExecutable,inputProps:{image:true},logLevel:'error'});await renderStill({serveUrl,composition:imageComposition,browserExecutable,output:imageOutput,imageFormat:'png',inputProps:{image:true},logLevel:'error'});const imageRgb=pixels(await readFile(imageOutput));
 if(process.env.STUDIO_TRANSITION_EVIDENCE){await mkdir(process.env.STUDIO_TRANSITION_EVIDENCE,{recursive:true});await copyFile(imageOutput,path.join(process.env.STUDIO_TRANSITION_EVIDENCE,'image-catalogue.png'));}
 for(let i=0;i<choices.length;i++){const x=i%5*384,y=Math.floor(i/5)*216,rects=transitionLayers(choices[i],.5,'#00ff00').filter(s=>s.left!==undefined).map(s=>({x:parseFloat(s.left)*3.84,y:parseFloat(s.top)*1.79,w:parseFloat(s.width)*3.84,h:parseFloat(s.height)*1.79}));for(let dy=2;dy<177;dy+=7)for(let dx=2;dx<382;dx+=7){if(Math.abs(dx-192)<3||Math.abs(dy-89.6)<3)continue;
  // Subpixel clip edges rasterize differently for an image and a solid fill.
  // Compare interiors (including transparent ones), not their one-pixel fringe.
  if(rects.some(r=>Math.abs(dx-r.x)<1.2||Math.abs(dx-r.x-r.w)<1.2||Math.abs(dy-r.y)<1.2||Math.abs(dy-r.y-r.h)<1.2))continue;
  const at=((y+dy)*1920+x+dx)*3,alpha=rgb[at+1]/255,expected=dy<89.6?(dx<192?[240,30,20]:[20,240,30]):dx<192?[30,20,240]:[240,220,20];if(choices[i].family!=='fade'&&alpha>0&&alpha<1)continue;for(let channel=0;channel<3;channel++)assert.ok(Math.abs(imageRgb[at+channel]-expected[channel]*alpha)<=4,JSON.stringify(choices[i])+` image alignment at ${dx},${dy}, actual=${[...imageRgb.subarray(at,at+3)]}, expected=${expected.map(c=>c*alpha)}`);}
  for(const dy of [180,200,215])for(const dx of [0,100,383]){const at=((y+dy)*1920+x+dx)*3;assert.deepEqual([...imageRgb.subarray(at,at+3)],[255,255,255]);}
 }
 if(process.env.STUDIO_TRANSITION_EVIDENCE){await mkdir(process.env.STUDIO_TRANSITION_EVIDENCE,{recursive:true});await copyFile(output,path.join(process.env.STUDIO_TRANSITION_EVIDENCE,'catalogue.png'));await copyFile(imageOutput,path.join(process.env.STUDIO_TRANSITION_EVIDENCE,'image-catalogue.png'));await writeFile(path.join(process.env.STUDIO_TRANSITION_EVIDENCE,'catalogue.json'),JSON.stringify({choices,distinctMasks:hashes.size,subtitleLane:'unchanged',imageAlignment:'passed',coverage:.5},null,2));}
});

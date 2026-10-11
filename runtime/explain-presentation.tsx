import React from 'react';
import {AbsoluteFill,Audio,Img,staticFile,useCurrentFrame} from 'remotion';
import {ease,fitText} from './motion.mjs';
import {captionAtFrame,fitSubtitleText} from './subtitles.mjs';
import {explanationSchedule} from './explain-scenes.mjs';
import type {Slide,PresentationData,Theme} from './presentation';

export type Explanation={type:'comparison'|'steps'|'stat'|'bar';unit:string;items:{label:string;value:string;quote:string}[]};
const Text=({text,width,height,size,color,weight=700}:{text:string;width:number;height:number;size:number;color:string;weight?:number})=>{
 const f=fitText(text,{width,height,maxSize:size,lineHeight:1.25,balance:true});
 return <div data-explanation-text style={{fontSize:f.size,lineHeight:1.25,color,fontWeight:weight}}>{f.lines.map((line:string,i:number)=><div key={i} style={{whiteSpace:'pre'}}>{line}</div>)}</div>;
};
export const ExplanationSlide=({row,data,theme}:{row:Slide;data:PresentationData;theme:Theme})=>{
 const e=row.explanation!,d=data.design||theme,frame=Math.min(useCurrentFrame(),row.frames-1),times=explanationSchedule(row,e),moving=!!data.motion;
 const strength={subtle:.35,standard:.7,bold:1}[data.motion?.intensity||'standard'],intro=moving?ease(frame/Math.max(1,Math.min(data.fps*.45,row.frames*.1))):1;
 const active=Math.max(0,times.findLastIndex((t:number)=>frame>=t)),width=row.image?1240:1700,top=355,height=460,gap=28;
 const reveal=(i:number)=>moving?ease((frame-times[i])/Math.max(1,Math.min(data.fps*.5,row.frames*.1))):1;
 const caption=fitSubtitleText(captionAtFrame(row,frame),{width:1700});
 const card=(i:number):React.CSSProperties=>({border:`2px solid ${d.accent}${active===i?'ff':'44'}`,borderRadius:20,background:`${d.accent}${active===i?'18':'08'}`,boxSizing:'border-box',overflow:'hidden'});
 return <AbsoluteFill data-explanation={e.type} style={{fontFamily:'NarrationJapanese',background:d.background,color:d.foreground,overflow:'hidden'}}>
  <div aria-hidden="true" style={{position:'absolute',right:-180,top:-510,width:1100,height:1100,borderRadius:'50%',border:`2px solid ${d.accent}22`,transform:`scale(${1+intro*.05})`}}/>
  <div style={{position:'absolute',left:110,top:93,width:100+150*intro,height:5,background:d.accent}}/>
  <div style={{position:'absolute',left:110,top:133,color:d.accent,fontSize:22,letterSpacing:2}}>{({comparison:'比べてわかる',steps:'順番に進める',stat:'数字で見る',bar:'数値を比べる'})[e.type]}</div>
  <div style={{position:'absolute',left:110,top:195,width:1700,height:125,opacity:intro,transform:`translateY(${(1-intro)*24*strength}px)`}}><Text text={row.title||row.scene||data.title} width={1700} height={125} size={76} color={d.heading}/></div>
  {row.image&&<div style={{position:'absolute',left:1410,top:355,width:400,height:460,borderRadius:20,overflow:'hidden',border:`1px solid ${d.accent}44`,padding:16,boxSizing:'border-box'}}><Img src={staticFile(row.image)} style={{width:'100%',height:'100%',objectFit:'contain'}}/></div>}
  <div style={{position:'absolute',left:110,top,width,height}}>
   {e.type==='comparison'&&e.items.map((item,i)=>{const w=(width-gap)/2,r=reveal(i);return <div key={i} style={{...card(i),position:'absolute',left:i*(w+gap),top:0,width:w,height,padding:42,opacity:.35+.65*r,transform:`translateY(${(1-r)*18*strength}px)`}}><Text text={item.label} width={w-84} height={135} size={50} color={d.foreground}/><div style={{height:5,width:60+100*r,background:d.accent,margin:'20px 0 32px'}}/><Text text={item.value} width={w-84} height={210} size={110} color={d.heading}/></div>;})}
   {e.type==='stat'&&<div style={{...card(0),height,padding:'48px 58px',opacity:intro}}><Text text={e.items[0].label} width={width-116} height={100} size={46} color={d.foreground}/><div style={{marginTop:40,transform:`translateY(${(1-reveal(0))*20*strength}px)`}}><Text text={e.items[0].value} width={width-116} height={245} size={170} color={d.accent}/></div></div>}
   {e.type==='steps'&&e.items.map((item,i)=>{const w=(width-gap*(e.items.length-1))/e.items.length,r=reveal(i);return <div key={i} style={{...card(i),position:'absolute',left:i*(w+gap),width:w,height,padding:28,opacity:.3+.7*r,transform:`translateY(${(1-r)*22*strength}px)`}}><div style={{width:64,height:64,background:d.accent,color:d.background,borderRadius:32,textAlign:'center',lineHeight:'64px',fontSize:30,fontWeight:800}}>{i+1}</div><div style={{marginTop:40}}><Text text={item.label} width={w-56} height={285} size={46} color={d.heading}/></div>{i<e.items.length-1&&<div aria-hidden="true" style={{position:'absolute',right:8,bottom:24,color:d.accent,fontSize:32}}>→</div>}</div>;})}
   {e.type==='bar'&&(()=>{const max=Math.max(...e.items.map(i=>Number(i.value.replaceAll(',','')))),h=height/e.items.length,labelW=width*.25,valueW=width*.2,barW=width-labelW-valueW-32;return <>{e.items.map((item,i)=>{const r=reveal(i),fraction=Number(item.value.replaceAll(',',''))/max;return <div key={i} style={{position:'absolute',left:0,top:i*h,width,height:h-14,display:'flex',alignItems:'center',gap:16}}><div style={{width:labelW}}><Text text={item.label} width={labelW} height={h-20} size={36} color={d.foreground}/></div><div style={{width:barW,height:Math.min(60,h-28),background:`${d.accent}16`,borderLeft:`2px solid ${d.accent}`,borderRadius:4}}><div data-chart-bar style={{width:`${fraction*r*100}%`,height:'100%',background:d.accent,borderRadius:'0 4px 4px 0'}}/></div><div style={{width:valueW,opacity:.4+.6*r}}><Text text={item.value+e.unit} width={valueW} height={h-20} size={42} color={d.heading}/></div></div>;})}</>;})()}
  </div>
  <div style={{position:'absolute',left:0,right:0,top:895,height:185,background:d.background,borderTop:`1px solid ${d.accent}66`,display:'flex',alignItems:'center',justifyContent:'center'}}><div data-explanation-caption style={{fontSize:caption.size,lineHeight:1.35,textAlign:'center',color:d.foreground}}>{caption.lines.map((line:string,i:number)=><div key={i} style={{whiteSpace:'pre'}}>{line}</div>)}</div></div>
  <Audio src={staticFile(row.src)}/>
 </AbsoluteFill>;
};

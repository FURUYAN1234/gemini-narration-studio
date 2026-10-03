import React,{useState,useEffect} from 'react';
import {AbsoluteFill,Audio,Composition,Img,Sequence,interpolate,staticFile,useCurrentFrame,delayRender,continueRender,cancelRender} from 'remotion';
import {loadLocalFont} from './font-loader.mjs';
import {captionAtFrame} from './subtitles.mjs';

// Layouts adapt reveal.js themes (MIT; see vendor/reveal-LICENSE.txt).
export type Slide={id:string;scene?:string;caption:string;src:string;from:number;frames:number;title?:string;points?:string[];image?:string;layout?:'title'|'split'|'steps';subtitles?:{text:string;from:number;to:number}[]};
export type Design={name:string;layout:'split'|'visual'|'steps'|'editorial'|'focus';background:string;foreground:string;heading:string;accent:string;decoration:string;titleSize:number;imageSide:string;imageRatio:number;radius:number};
export type PresentationData={title:string;fps:number;durationInFrames:number;rows:Slide[];design?:Design};
export type Theme={name:string;background:string;foreground:string;heading:string;accent:string};
const font='NarrationJapanese';
// Remotion initializes its global handles while modules load. Create the font
// handle at mount so a later module cannot erase it and leave its timer alive.
const useJapaneseFont=()=>{
 const [handle]=useState(()=>delayRender('Load presentation Japanese font'));
 useEffect(()=>{void loadLocalFont({handle,FontFace,fonts:document.fonts,url:staticFile('narration/NotoSansJP.ttf'),family:font,delayRender,continueRender,cancelRender});},[handle]);
};
const SlideView=({row,data,theme,index}:{row:Slide;data:PresentationData;theme:Theme;index:number})=>{
  const frame=useCurrentFrame(),opacity=interpolate(frame,[0,12],[0,1],{extrapolateRight:'clamp'}),layout=row.layout||(index===0?'title':row.image?'split':'steps');
  const points=row.points||[];
  return <AbsoluteFill style={{background:theme.background,color:theme.heading,fontFamily:font,padding:'65px 85px',overflow:'hidden'}}>
    <div style={{position:'absolute',right:-120,top:-200,width:700,height:700,borderRadius:'50%',border:`1px solid ${theme.accent}`,opacity:.22}}/>
    <div style={{display:'flex',justifyContent:'space-between',fontSize:22,color:theme.accent,letterSpacing:3}}><span>{row.scene||data.title}</span><span>{String(index+1).padStart(2,'0')} / {data.rows.length}</span></div>
    <div style={{marginTop:layout==='title'?140:68,opacity,transform:`translateY(${(1-opacity)*18}px)`}}>
      <div style={{height:5,width:80,background:theme.accent,marginBottom:32}}/>
      <h1 style={{fontSize:layout==='title'?82:58,margin:0,lineHeight:1.4,maxWidth:layout==='split'?820:1600,overflowWrap:'anywhere'}}>{row.title||row.caption}</h1>
      {layout==='steps'&&points.length>0&&<div style={{display:'flex',gap:25,marginTop:45}}>{points.map((point,i)=><div key={i} style={{flex:1,border:`1px solid ${theme.accent}`,borderRadius:16,padding:30,fontSize:30,lineHeight:1.7}}><div style={{fontSize:22,color:theme.accent,marginBottom:22}}>0{i+1}</div>{point}</div>)}</div>}
      {layout==='split'&&<div style={{display:'flex',gap:55,marginTop:35}}><div style={{flex:1,fontSize:31,lineHeight:1.8,color:theme.foreground}}>{points.map((point,i)=><p key={i}>{point}</p>)}</div>{row.image&&<Img src={staticFile(row.image)} style={{width:720,height:510,objectFit:'contain',borderRadius:15}}/>}</div>}
    </div>
    <div style={{position:'absolute',bottom:45,left:85,right:85,borderTop:`1px solid ${theme.accent}`,paddingTop:22,fontSize:32,lineHeight:1.6}}>{captionAtFrame(row,frame)}</div>
    <Audio src={staticFile(row.src)}/>
  </AbsoluteFill>;
};
const DesignedSlide=({row,data,index,design:d}:{row:Slide;data:PresentationData;index:number;design:Design})=>{
 const frame=useCurrentFrame(),opacity=interpolate(frame,[0,12],[0,1],{extrapolateRight:'clamp'}),title=row.title||row.scene||data.title,points=row.points||[];
 const image=row.image?<Img src={staticFile(row.image)} style={{width:'100%',height:'100%',objectFit:'contain',borderRadius:d.radius}}/>:null;
 const heading=<h1 style={{fontSize:d.titleSize,lineHeight:1.3,margin:0,color:d.heading,overflowWrap:'anywhere'}}>{title}</h1>;
 const notes=<div style={{fontSize:32,lineHeight:1.8,color:d.foreground}}>{points.map((point,i)=><p key={i}>{point}</p>)}</div>;
 const grid=d.decoration==='grid'?{backgroundImage:`linear-gradient(${d.accent}22 1px,transparent 1px),linear-gradient(90deg,${d.accent}22 1px,transparent 1px)`,backgroundSize:'60px 60px'}:{};
 return <AbsoluteFill style={{background:d.background,color:d.heading,fontFamily:font,...grid}}>
  {d.decoration==='band'&&<div style={{position:'absolute',top:0,right:0,width:40,height:'100%',background:d.accent}}/>}
  {d.decoration==='frame'&&<div style={{position:'absolute',inset:30,border:`2px solid ${d.accent}`,borderRadius:d.radius}}/>}
  <div style={{position:'absolute',top:58,left:85,right:85,display:'flex',justifyContent:'space-between',fontSize:22,letterSpacing:2,color:d.accent}}><span>{row.scene||data.title}</span><span>{String(index+1).padStart(2,'0')}カット / {data.rows.length}</span></div>
  <div style={{position:'absolute',top:170,left:85,right:85,height:655,opacity}}>
   {d.layout==='visual'?<div style={{display:'flex',gap:50,height:'100%',alignItems:'center'}}><div style={{width:'38%'}}>{heading}{notes}</div><div style={{flex:1,height:'100%',padding:18,border:`2px solid ${d.accent}`,borderRadius:d.radius}}>{image}</div></div>
   :d.layout==='steps'?<>{heading}<div style={{display:'flex',gap:28,marginTop:45}}>{(points.length?points:[row.scene||title]).map((point,i)=><div key={i} style={{flex:1,padding:32,border:`2px solid ${d.accent}`,borderRadius:d.radius,color:d.foreground,fontSize:32,lineHeight:1.6}}><span style={{color:d.accent,fontSize:24}}>STEP {i+1}</span><p>{point}</p></div>)}</div>{image&&<div style={{height:260,marginTop:25}}>{image}</div>}</>
   :d.layout==='focus'?<div style={{height:'100%',textAlign:'center'}}>{heading}<div style={{height:390,maxWidth:1050,margin:'35px auto 0'}}>{image||notes}</div>{image&&<div style={{display:'flex',justifyContent:'center',gap:45,fontSize:30,color:d.foreground}}>{points.map((point,i)=><span key={i}>{point}</span>)}</div>}</div>
   :<div style={{display:'flex',flexDirection:d.imageSide==='left'?'row-reverse':'row',gap:60,height:'100%'}}><div style={{flex:1,minWidth:0,paddingTop:d.layout==='editorial'?35:0,borderTop:d.decoration==='line'?`5px solid ${d.accent}`:undefined}}>{heading}{notes}</div><div style={{width:d.imageRatio*100+'%',height:'100%',paddingLeft:d.layout==='editorial'?30:0,borderLeft:d.layout==='editorial'?`2px solid ${d.accent}`:undefined}}>{image}</div></div>}
  </div>
  <div style={{position:'absolute',bottom:0,left:0,right:0,minHeight:105,padding:'24px 85px 38px',borderTop:`1px solid ${d.accent}`,background:d.background,color:d.foreground,fontSize:32,lineHeight:1.6}}>{captionAtFrame(row,frame)}</div>
  <Audio src={staticFile(row.src)}/>
 </AbsoluteFill>;
};
export const NarratedPresentation=({data,theme}:{data:PresentationData;theme:Theme})=>{useJapaneseFont();return <AbsoluteFill>{data.rows.map((row,index)=><Sequence key={row.id} from={row.from} durationInFrames={row.frames+7}>{data.design?<DesignedSlide row={row} data={data} index={index} design={data.design}/>:<SlideView row={row} data={data} theme={theme} index={index}/>}</Sequence>)}</AbsoluteFill>;};
export const NarratedPresentationComposition=({data,theme}:{data:PresentationData;theme:Theme})=><Composition id="GeminiNarratedPresentation" component={NarratedPresentation} defaultProps={{data,theme}} durationInFrames={data.durationInFrames} fps={data.fps} width={1920} height={1080}/>;

import {ExplanationSlide} from './explain-presentation';
import type {Explanation} from './explain-presentation';
import React,{useState,useEffect} from 'react';
import {AbsoluteFill,Audio,Composition,Img,Sequence,interpolate,staticFile,useCurrentFrame,delayRender,continueRender,cancelRender} from 'remotion';
import {loadLocalFont} from './font-loader.mjs';
import {captionAtFrame,fitSubtitleText} from './subtitles.mjs';
import {musicVolume,musicClips,musicClipGain} from './music.mjs';
import {MotionSlide,FocusArtwork,CutTransition} from './motion-presentation';
import {EXPANDED_LAYOUTS,templateGeometry,fitText,motionFrame,ease,pointSchedule} from './motion.mjs';

// Layouts adapt reveal.js themes (MIT; see vendor/reveal-LICENSE.txt).
export type Slide={explanation?:Explanation;id:string;scene?:string;caption:string;src:string;from:number;frames:number;title?:string;points?:string[];image?:string;imageFocus?:{x:number;y:number;zoom:number;label:string};layout?:'title'|'split'|'steps';subtitles?:{text:string;from:number;to:number}[]};
export type Design={name:string;layout:'split'|'visual'|'steps'|'editorial'|'focus'|'poster'|'gallery'|'rail'|'stack';background:string;foreground:string;heading:string;accent:string;decoration:string;titleSize:number;imageSide:string;imageRatio:number;radius:number};
export type PresentationData={bookends?:{titleRowId?:string;endLabel:string;endUrl:string;owner:string;creationYear:number;from:number;frames:number};gapFrames?:number;music?:{src:string;durationSeconds:number;level:number};title:string;fps:number;durationInFrames:number;rows:Slide[];design?:Design;motion?:{version:1;style:'cinematic'|'kinetic'|'editorial';intensity:'subtle'|'standard'|'bold';transitions?:string[];transitionTones?:string[]}|null};
export type Theme={name:string;background:string;foreground:string;heading:string;accent:string};
const font='NarrationJapanese';
const FittedHeading=({text,width,height,size,lineHeight=1.3}:{text:string;width:number;height:number;size:number;lineHeight?:number})=>{
 const fit=fitText(text,{width,height,maxSize:size,lineHeight,balance:true});
 return <div data-fitted-heading style={{fontWeight:800,fontSize:fit.size,lineHeight,whiteSpace:'pre'}}>{fit.lines.map((line,i)=><div key={i}>{line.replace(/\r?\n$/,'')}</div>)}</div>;
};
const SubtitleText=({text,width=1700}:{text:string;width?:number})=>{
 const fit=fitSubtitleText(text,{width});
 return <div data-subtitle-text style={{fontSize:fit.size,lineHeight:1.35,textAlign:'center'}}>{fit.lines.map((line,i)=><div key={i} style={{whiteSpace:'pre'}}>{line.replace(/\r?\n$/,'')}</div>)}</div>;
};
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
      <FittedHeading text={row.title||row.caption} width={layout==='split'?820:1600} height={layout==='split'?250:340} size={layout==='title'?82:58} lineHeight={1.4}/>
      {layout==='steps'&&points.length>0&&<div style={{display:'flex',gap:25,marginTop:45}}>{points.map((point,i)=><div key={i} style={{flex:1,border:`1px solid ${theme.accent}`,borderRadius:16,padding:30,fontSize:30,lineHeight:1.7}}><div style={{fontSize:22,color:theme.accent,marginBottom:22}}>0{i+1}</div>{point}</div>)}</div>}
      {layout==='split'&&<div style={{display:'flex',gap:55,marginTop:35}}><div style={{flex:1,fontSize:31,lineHeight:1.8,color:theme.foreground}}>{points.map((point,i)=><p key={i}>{point}</p>)}</div>{row.image&&<Img src={staticFile(row.image)} style={{width:720,height:510,objectFit:'contain',borderRadius:15}}/>}</div>}
    </div>
    <div style={{position:'absolute',bottom:45,left:85,right:85,borderTop:`1px solid ${theme.accent}`,paddingTop:22,fontSize:32,lineHeight:1.6}}><SubtitleText text={captionAtFrame(row,frame)}/></div>
    <Audio src={staticFile(row.src)}/>
  </AbsoluteFill>;
};
const DesignedSlide=({row,data,index,design:d}:{row:Slide;data:PresentationData;index:number;design:Design})=>{
 const frame=useCurrentFrame(),opacity=interpolate(frame,[0,12],[0,1],{extrapolateRight:'clamp'}),title=row.title||row.scene||data.title,points=row.points||[];
 const image=row.image?<Img src={staticFile(row.image)} style={{width:'100%',height:'100%',objectFit:'contain',borderRadius:d.radius}}/>:null;
 const heading=<FittedHeading text={title} width={d.layout==='visual'?665:['steps','focus'].includes(d.layout)?1750:1750*(1-d.imageRatio)-60} height={['steps','focus'].includes(d.layout)?210:300} size={d.titleSize}/>;
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
  <div style={{position:'absolute',bottom:0,left:0,right:0,minHeight:105,padding:'24px 85px 38px',borderTop:`1px solid ${d.accent}`,background:d.background,color:d.foreground,fontSize:32,lineHeight:1.6}}><SubtitleText text={captionAtFrame(row,frame)}/></div>
  <Audio src={staticFile(row.src)}/>
 </AbsoluteFill>;
};
// New structures use the same bounded geometry with motion on or off.
const ExpandedSlide=({row,data,index,design:d}:{row:Slide;data:PresentationData;index:number;design:Design})=>{
 const frame=Math.min(useCurrentFrame(),row.frames-1),points=row.points||[],g=templateGeometry(d.layout,{hasImage:!!row.image,pointCount:points.length});
 const moving=!!data.motion,state=moving?motionFrame({frame,frames:row.frames,fps:data.fps,motion:data.motion}):null,reveal=state?.reveal??ease(frame/Math.max(1,Math.min(12,row.frames*.15)));
 const box=(b:{x:number;y:number;w:number;h:number}):React.CSSProperties=>({position:'absolute',left:b.x,top:b.y,width:b.w,height:b.h,boxSizing:'border-box'});
 const text=(value:string,b:{x:number;y:number;w:number;h:number},size:number,role:string,color:string)=>{
  const fit=fitText(value,{width:b.w,height:b.h,maxSize:size,lineHeight:1.25,balance:role==='heading'});
  return <div data-template-text={role} style={{...box(b),fontSize:fit.size,lineHeight:1.25,color,fontWeight:role==='heading'?800:500}}>{fit.lines.map((line:string,i:number)=><div key={i} style={{whiteSpace:'pre'}}>{line.replace(/\r?\n$/,'')}</div>)}</div>;
 };
 const times=pointSchedule(row,points.length,data.fps),active=Math.max(0,times.findLastIndex(time=>frame>=time)),caption=captionAtFrame(row,frame);
 return <AbsoluteFill data-video-layout={d.layout} style={{background:d.background,fontFamily:font,color:d.foreground,overflow:'hidden'}}>
  <div style={{position:'absolute',left:110,right:110,top:90,borderBottom:`2px solid ${d.accent}`,paddingBottom:18,fontSize:22,color:d.accent,display:'flex',justifyContent:'space-between'}}><span>{row.scene||data.title}</span><span>{String(index+1).padStart(2,'0')} / {data.rows.length}</span></div>
  <div style={{opacity:reveal,transform:`translateY(${(1-reveal)*(data.motion?.style==='kinetic'?35:16)}px)`}}>{text(row.title||row.scene||data.title,g.heading,d.layout==='poster'?d.titleSize*1.7:d.titleSize,'heading',d.heading)}</div>
  {g.image&&row.image&&(row.imageFocus?<FocusArtwork image={row.image} focus={row.imageFocus} box={g.image} d={d} frame={frame} frames={row.frames} reveal={reveal}/>:<div style={{...box(g.image),overflow:'hidden',opacity:reveal,border:`1px solid ${d.accent}66`,borderRadius:d.radius,padding:18}}><Img src={staticFile(row.image)} style={{width:'100%',height:'100%',objectFit:'contain',transform:state?`scale(${state.scale}) translateX(${state.pan*.15}px)`:'none'}}/></div>)}
  {d.layout==='rail'&&g.points.length>1&&<div aria-hidden="true" style={{position:'absolute',left:g.points[0].x+20,top:g.points[0].y+20,width:2,height:g.points.at(-1)!.y-g.points[0].y,background:d.accent,opacity:.55}}/>}
  {points.map((point,i)=>{
   const b=g.points[i],appearance=moving?ease((frame-times[i])/Math.max(1,Math.min(data.fps*.45,row.frames*.12))):reveal,padding=d.layout==='rail'?64:24,inner={x:b.x+padding,y:b.y+16,w:b.w-padding-20,h:b.h-32};
   return <div key={i} style={{opacity:appearance}}>
    <div style={{...box(b),border:d.layout==='rail'?'none':`1px solid ${d.accent}66`,borderRadius:d.radius,background:moving&&active===i?`${d.accent}18`:`${d.accent}08`}}/>
    {d.layout==='rail'&&<div style={{position:'absolute',left:b.x,top:b.y+10,width:40,height:40,borderRadius:'50%',background:d.accent,color:d.background,fontSize:22,textAlign:'center',lineHeight:'40px'}}>{i+1}</div>}
    {text(point,inner,d.layout==='poster'?38:32,'point',d.foreground)}
   </div>;
  })}
  <div style={{position:'absolute',left:0,right:0,top:895,height:185,background:d.background,borderTop:`1px solid ${d.accent}`,opacity:1}}/>
  <div data-template-text="caption" style={{position:'absolute',left:110,top:920,width:1700,height:128,color:d.foreground}}><SubtitleText text={caption}/></div>
  <Audio src={staticFile(row.src)}/>
 </AbsoluteFill>;
};
const BackgroundMusic=({data}:{data:PresentationData})=>{if(!data.music)return null;const music=data.music;return <>{musicClips(data.durationInFrames,Math.floor(music.durationSeconds*data.fps),data.fps).map(clip=><Sequence key={clip.from} from={clip.from} durationInFrames={clip.frames}><Audio src={staticFile(music.src)} volume={frame=>musicVolume(clip.from+frame,data,music.level)*musicClipGain(frame,clip)}/></Sequence>)}</>;};
const Bookend=({data,theme,row}:{data:PresentationData;theme:Theme;row?:Slide})=>{
 const frame=useCurrentFrame(),ending=!row,b=data.bookends!,frames=ending?b.frames:row!.frames+(data.gapFrames??7);
 const fade=interpolate(frame,[0,18,Math.max(19,frames-18),frames],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 const accent=data.design?.accent||theme.accent,background=data.design?.background||theme.background,foreground=data.design?.foreground||theme.foreground;
 return <AbsoluteFill style={{background,color:foreground,fontFamily:font,overflow:'hidden'}}>
  <div style={{position:'absolute',width:1100,height:1100,borderRadius:'50%',border:`1px solid ${accent}`,opacity:.10,top:-600,right:-280,transform:`translateX(${frame*.2}px)`}}/>
  {ending?<div style={{position:'absolute',right:86,bottom:140,textAlign:'right',opacity:fade*.85,fontSize:26,lineHeight:1.8,maxWidth:1500,overflowWrap:'anywhere'}}><div>{b.endLabel}</div><div style={{fontSize:24}}>{b.endUrl}</div></div>:
  <AbsoluteFill style={{justifyContent:'center',padding:'100px 150px',opacity:fade,transform:`translateY(${interpolate(frame,[0,24],[22,0],{extrapolateRight:'clamp'})}px)`}}><div style={{width:110,height:5,background:accent,marginBottom:42}}/><FittedHeading text={row!.caption} width={1620} height={650} size={92} lineHeight={1.55}/></AbsoluteFill>}
  {ending&&<div style={{position:'absolute',right:86,bottom:80,maxWidth:550,textAlign:'right',overflowWrap:'anywhere',opacity:fade*.75,fontSize:25,letterSpacing:2}}>@{b.creationYear}/{b.owner}</div>}
  {row&&<Audio src={staticFile(row.src)}/>}
 </AbsoluteFill>;
};
export const NarratedPresentation=({data,theme}:{data:PresentationData;theme:Theme})=>{useJapaneseFont();return <AbsoluteFill><BackgroundMusic data={data}/>{data.rows.map((row,index)=><Sequence key={row.id} from={row.from} durationInFrames={row.frames+(data.gapFrames??7)}>{data.bookends?.titleRowId===row.id?<Bookend data={data} theme={theme} row={row}/>:<CutTransition row={row} data={data} palette={data.design||theme}>{row.explanation?<ExplanationSlide row={row} data={data} theme={theme}/>:data.design&&EXPANDED_LAYOUTS.includes(data.design.layout)?<ExpandedSlide row={row} data={data} index={index} design={data.design}/>:data.motion?<MotionSlide row={row} data={data} index={index} design={data.design} theme={theme} motion={data.motion}/>:data.design?<DesignedSlide row={row} data={data} index={index} design={data.design}/>:<SlideView row={row} data={data} theme={theme} index={index}/>}</CutTransition>}</Sequence>)}{data.bookends&&data.bookends.frames>0&&<Sequence from={data.bookends.from} durationInFrames={data.bookends.frames}><Bookend data={data} theme={theme}/></Sequence>}</AbsoluteFill>;};
export const NarratedPresentationComposition=({data,theme}:{data:PresentationData;theme:Theme})=><Composition id="GeminiNarratedPresentation" component={NarratedPresentation} defaultProps={{data,theme}} durationInFrames={data.durationInFrames} fps={data.fps} width={1920} height={1080}/>;

import React from 'react';
import {AbsoluteFill,Freeze,Img,OffthreadVideo,staticFile,useCurrentFrame} from 'remotion';
import type {PresentationData,Slide} from './presentation';
import {fitText,promoSceneDirection,transitionSurface,videoBackground} from './motion.mjs';
import {TransitionMask} from './motion-presentation';

export function PromoSlide({row,data}:{row:Slide;data:PresentationData}){
  const frame=useCurrentFrame();
  const direction=promoSceneDirection(row);
  const {stage,copy,stacked}=direction;
  const heading=fitText(row.title||'',{width:copy.w,height:copy.h,maxSize:stacked?55:48,balance:true});
  const caption=fitText(row.caption,{width:1768,height:114,maxSize:32,lineHeight:1.35});
  const coverage=Math.max(0,1-frame/Math.max(1,Math.min(row.frames/4,direction.reveal*data.fps)));
  const mediaStyle={width:'100%',height:'100%',objectFit:'contain'} as const;
  const media=row.video
    ? <OffthreadVideo muted trimBefore={row.videoStart??0} src={staticFile(row.video)} style={mediaStyle}/>
    : row.image&&<Img src={staticFile(row.image)} style={mediaStyle}/>;
  return <AbsoluteFill style={{...videoBackground(data.design||direction),color:direction.foreground,fontFamily:'Noto Sans JP, sans-serif',overflow:'hidden'}}>
    <div style={{position:'absolute',top:51,left:76,right:76,color:direction.accent,fontSize:25,fontWeight:700}}>{data.title}</div>
    <div style={{position:'absolute',top:stage.y,left:stage.x,width:stage.w,height:stage.h,overflow:'hidden',borderRadius:22}}>
      {row.videoFrames&&frame>=row.videoFrames?<Freeze frame={row.videoFrames-1}>{media}</Freeze>:media}
    </div>
    <div style={{position:'absolute',top:copy.y,left:copy.x,width:copy.w,height:copy.h,display:'flex',flexDirection:'column',justifyContent:'center'}}>
      <div lang="ja" style={{fontSize:heading.size,fontWeight:850,lineHeight:1.24,whiteSpace:'pre-line',color:direction.heading}}>{heading.lines.join('\n')}</div>
    </div>
    {row.caption&&<div style={{position:'absolute',left:76,right:76,bottom:36,minHeight:99,display:'grid',alignContent:'center',fontSize:caption.size,lineHeight:1.35,color:direction.foreground,whiteSpace:'pre-line'}}>{caption.lines.join('\n')}</div>}
    {row.promoTransition&&direction.reveal>0&&<TransitionMask choice={row.promoTransition} coverage={coverage} {...transitionSurface(row.promoTransition,{palette:direction,image:row.image})}/>}
  </AbsoluteFill>;
}

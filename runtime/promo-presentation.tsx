import React from 'react';
import {AbsoluteFill,Easing,Img,OffthreadVideo,interpolate,staticFile,useCurrentFrame} from 'remotion';
import type {PresentationData,Slide} from './presentation';

const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const palettes=[
  {accent:'#79ecdb',glow:'#103e45',paper:'#091820'},
  {accent:'#ffc67b',glow:'#3d2c27',paper:'#201717'},
  {accent:'#a6bbff',glow:'#253959',paper:'#111923'},
];

export function PromoSlide({row,data,index}:{row:Slide;data:PresentationData;index:number}){
  const frame=useCurrentFrame();
  const palette=palettes[index%palettes.length];
  const imageLeft=index%2===1;
  const direction=imageLeft?-1:1;
  const entrance=Math.min(30,Math.max(5,Math.floor(row.frames*.35)));
  const closing=Math.min(11,Math.max(3,Math.floor(row.frames*.18)));
  const enter=interpolate(frame,[0,Math.ceil(entrance*23/30)],[0,1],{...clamp,easing:Easing.out(Easing.cubic)});
  const reveal=interpolate(frame,[Math.floor(entrance/10),Math.ceil(entrance*28/30)],[100,0],{...clamp,easing:Easing.inOut(Easing.cubic)});
  const copy=interpolate(frame,[Math.floor(entrance*.3),entrance],[0,1],{...clamp,easing:Easing.out(Easing.cubic)});
  const exit=interpolate(frame,[row.frames-closing,row.frames],[0,1],{...clamp,easing:Easing.in(Easing.cubic)});
  const zoom=interpolate(frame,[0,row.frames],[1,1.09],clamp);
  const trace=interpolate(frame,[13,44],[0,1],clamp);
  const compact=(row.title?.length??0)>24||(row.caption?.length??0)>70;
  const W=1160;
  return <AbsoluteFill style={{background:palette.paper,color:'#f6fbff',fontFamily:'Noto Sans JP, sans-serif',overflow:'hidden'}}>
    <div style={{position:'absolute',inset:0,background:`radial-gradient(ellipse at ${imageLeft?'29%':'72%'} 44%, ${palette.glow}, transparent 74%)`}}/>
    <div style={{position:'absolute',inset:'72px 88px auto',display:'flex',justifyContent:'space-between',gap:48,alignItems:'center',color:palette.accent,fontSize:26,fontWeight:720}}>
      <span>{data.title}</span>
      <div style={{display:'flex',gap:8}}>{data.rows.map((cut,i)=><div key={cut.id} style={{width:48,height:5,background:'#ffffff35',borderRadius:6,overflow:'hidden'}}><div style={{height:'100%',width:`${i<index?100:i===index?frame/row.frames*100:0}%`,background:palette.accent}}/></div>)}</div>
    </div>
    <div style={{position:'absolute',top:183,left:imageLeft?88:672,width:W,height:750,transform:`translateX(${direction*((1-enter)*192-exit*72)}px) rotate(${direction*((1-enter)*6-exit*2)}deg)`,opacity:1-exit,borderRadius:30,overflow:'hidden',boxShadow:`0 32px 90px #0009, 0 0 72px ${palette.glow}`}}>
      <div style={{position:'absolute',inset:0,clipPath:imageLeft?`inset(0 0 0 ${reveal}%)`:`inset(0 ${reveal}% 0 0)`,background:'#0b141c',display:'grid',placeItems:'center'}}>
        {row.video?<OffthreadVideo muted trimBefore={row.videoStart??0} src={staticFile(row.video)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>:
          <Img src={staticFile(row.image!)} style={{width:'100%',height:'100%',objectFit:'contain',transform:`scale(${zoom})`,transformOrigin:imageLeft?'35% 42%':'65% 42%'}}/>}
      </div>
      <div style={{position:'absolute',inset:0,border:'2px solid #ffffff38',borderRadius:30,opacity:enter}}/>
      <div style={{position:'absolute',top:0,left:imageLeft?'auto':18,right:imageLeft?18:'auto',width:(W-36)*trace,height:4,background:palette.accent,borderRadius:4}}/>
    </div>
    <div style={{position:'absolute',top:compact?222:295,left:imageLeft?1296:88,width:510,opacity:copy*(1-exit),transform:`translateY(${(1-copy)*66-exit*24}px)`}}>
      <div style={{width:86*copy,height:6,borderRadius:4,background:palette.accent,marginBottom:36}}/>
      <div style={{fontSize:compact?42:64,fontWeight:850,lineHeight:1.24,textWrap:'balance',overflowWrap:'anywhere'}}>{row.title}</div>
      {row.caption&&<div style={{fontSize:compact?24:30,lineHeight:1.6,color:'#dde7ee',marginTop:24,overflowWrap:'anywhere'}}>{row.caption}</div>}
    </div>
  </AbsoluteFill>;
}

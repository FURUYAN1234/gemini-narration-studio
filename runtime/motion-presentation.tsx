import React,{useEffect,useState} from 'react';
import {AbsoluteFill,Audio,Img,staticFile,useCurrentFrame,delayRender,continueRender,cancelRender} from 'remotion';
import {ease,clamp,fitText,motionFrame,sceneDirection,pointSchedule,focusFrame,transitionPlan,transitionFrame,transitionLayers,transitionSurface} from './motion.mjs';
import {captionAtFrame,fitSubtitleText} from './subtitles.mjs';
import type {Slide,PresentationData,Design,Theme} from './presentation';

type Motion={version:1;style:'cinematic'|'kinetic'|'editorial';intensity:'subtle'|'standard'|'bold';transitions?:string[];transitionTones?:string[]};
type Box={x:number;y:number;w:number;h:number};
const positioned=(b:Box):React.CSSProperties=>({position:'absolute',left:b.x,top:b.y,width:b.w,height:b.h,boxSizing:'border-box'});

// The common boundary wraps every layout. Bookends keep their own quiet fade;
// AI boundary indices refer to body cuts, not an inserted opening title.
export const TransitionMask=({choice,coverage,color,image}:{choice:{family:string;variant:number};coverage:number;color:string;image?:string})=><div aria-hidden="true" style={{position:'absolute',inset:0,bottom:185,overflow:'hidden',pointerEvents:'none'}}>{transitionLayers(choice,coverage,color).map((style:React.CSSProperties,i:number)=>{
 const clock=choice.family==='clock'&&String(style.background).startsWith('conic-gradient'),x=parseFloat(String(style.left||0))*19.2,y=parseFloat(String(style.top||0))*8.95;
 return <div key={i} style={{position:'absolute',...style,...(image?{overflow:'hidden',background:color,...(clock?{maskImage:String(style.background).replace(color,'#ffffff')}: {})}:{})}}>{image&&<Img src={staticFile(image)} style={{position:'absolute',left:-x,top:-y,width:1920,height:895,objectFit:'contain',...(style.transform==='scaleX(-1)'?{transform:'scaleX(-1)'}:{})}}/>}</div>;
})}</div>;
export const CutTransition=({row,data,palette,children}:{row:Slide;data:PresentationData;palette:Design|Theme;children:React.ReactNode})=>{
 const frame=Math.min(useCurrentFrame(),row.frames-1);
 if(!data.motion)return <>{children}</>;
 const rows=data.rows.filter(r=>r.id!==data.bookends?.titleRowId),index=rows.findIndex(r=>r.id===row.id),plan=transitionPlan({rows,motion:data.motion}),state=transitionFrame({frame,frames:row.frames,fps:data.fps,motion:data.motion});
 const incoming=index>0?plan[index-1]:data.bookends?{family:'fade',variant:0,tone:'background'}:null,outgoing=plan[index];
 return <>{children}{incoming&&<TransitionMask choice={incoming} coverage={state.incoming} {...transitionSurface(incoming,{palette,image:row.image})}/>} {outgoing&&<TransitionMask choice={outgoing} coverage={state.outgoing} {...transitionSurface(outgoing,{palette,image:rows[index+1]?.image})}/>}</>;
};

// Every visual is driven by the render frame. No CSS animation or wall clock.
const Backdrop=({d,m,frame,fps,index}:{d:Design;m:Motion;frame:number;fps:number;index:number})=>{
 const t=frame/fps,strength={subtle:.35,standard:.7,bold:1}[m.intensity],shift=t*9*strength;
 return <AbsoluteFill style={{overflow:'hidden',background:d.background}}>
  {m.style==='cinematic'?<>
   <div style={{position:'absolute',width:1450,height:1450,top:-670+Math.sin(t*.22)*75*strength,left:450+shift,background:`radial-gradient(ellipse,${d.accent}30,${d.accent}08 42%,transparent 69%)`,transform:`rotate(${t*2}deg)`}}/>
   <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{position:'absolute',opacity:.42}}>
    {[0,1,2].map(i=><ellipse key={i} cx={1460+shift} cy={460+index*30} rx={490+i*115} ry={310+i*78} fill="none" stroke={d.accent} strokeWidth={i===1?1.5:.7} transform={`rotate(${-32+Math.sin(t*.2)*8*strength} 1460 460)`}/>)}
    <circle cx={1440+Math.cos(t*.36)*535} cy={450+Math.sin(t*.36)*345} r="5" fill={d.accent}/>
   </svg>
  </>:m.style==='kinetic'?<>
   <div style={{position:'absolute',width:1500,height:300,left:650-shift*2,top:180,background:d.accent,opacity:.12,transform:`rotate(-24deg) translateX(${Math.sin(t*.25)*75*strength}px)`}}/>
   <div style={{position:'absolute',width:950,height:950,border:`65px solid ${d.accent}`,opacity:.13,borderRadius:'50%',right:-460,top:-220,transform:`scale(${1+Math.sin(t*.4)*.04*strength})`}}/>
   <div style={{position:'absolute',height:6,width:480,left:95+shift,top:92,background:d.accent}}/>
  </>:<>
   <div style={{position:'absolute',inset:0,opacity:.065,backgroundImage:`linear-gradient(${d.foreground} 1px,transparent 1px),linear-gradient(90deg,${d.foreground} 1px,transparent 1px)`,backgroundSize:'96px 96px',backgroundPosition:`${shift/2}px ${shift/3}px`}}/>
   <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{position:'absolute',opacity:.3}}>
    <path d="M 1200 -60 L 1200 170 Q 1200 220 1250 220 L 1740 220 Q 1800 220 1800 280 L 1800 900" fill="none" stroke={d.accent} strokeWidth="3" strokeDasharray="1700" strokeDashoffset={1700*(1-ease(t/2))}/>
    {[0,1,2,3].map(i=><circle key={i} cx={1220+i*160} cy="220" r={5+Math.sin(t+i)*1.5*strength} fill={d.accent}/>)}
   </svg>
  </>}
 </AbsoluteFill>;
};

const Headline=({text,box,frame,fps,frames,color,size=112,center=false,kinetic=false}:{text:string;box:Box;frame:number;fps:number;frames:number;color:string;size?:number;center?:boolean;kinetic?:boolean})=>{
 const fit=fitText(text,{width:box.w,height:box.h,maxSize:size,balance:true}),duration=Math.max(1,Math.min(fps*.6,frames*.15));
 return <div data-motion-text="heading" style={{...positioned(box),color,fontSize:fit.size,fontWeight:800,lineHeight:1.2,letterSpacing:'-.035em',textAlign:center?'center':'left'}}>
  {fit.lines.map((line:string,i:number)=>{const reveal=ease((frame-i*Math.min(fps*.075,frames*.015))/duration);return <div key={i} style={{overflow:'hidden',paddingBottom:fit.size*.06,marginBottom:-fit.size*.06}}><div style={{opacity:reveal,transform:`translateY(${(1-reveal)*(kinetic?110:55)}%) rotate(${kinetic?(1-reveal)*-3:0}deg)`,transformOrigin:'left bottom',whiteSpace:'pre'}}>{line.replace(/\r?\n$/,'')}</div></div>;})}
 </div>;
};

const Artwork=({image,box,m,state,side,frame,fps}:{image:string;box:Box;m:Motion;state:ReturnType<typeof motionFrame>;side:string;frame:number;fps:number})=>{
 const direction=side==='left'?-1:1,reveal=state.reveal;
 return <div style={{...positioned(box),opacity:reveal,transform:`translate(${(1-reveal)*80*direction}px,${state.drift*.28}px) rotate(${m.style==='kinetic'?(1-reveal)*7*direction:Math.sin(frame/fps*.2)*.55*state.strength}deg)`,clipPath:`inset(0 ${side==='right'?(1-reveal)*100:0}% 0 ${side==='left'?(1-reveal)*100:0}%)`}}>
  <div style={{position:'absolute',inset:22,background:'rgba(0,0,0,.10)',filter:'blur(30px)',transform:'translateY(20px)'}}/>
  <Img src={staticFile(image)} style={{width:'100%',height:'100%',objectFit:'contain',padding:24,boxSizing:'border-box',transform:`translateX(${state.pan*.32*direction}px) scale(${state.scale})`,filter:'drop-shadow(0 20px 22px rgba(0,0,0,.18))'}}/>
 </div>;
};

export const FocusArtwork=({image,focus,box,d,frame,frames,reveal}:{image:string;focus:NonNullable<Slide['imageFocus']>;box:Box;d:Design;frame:number;frames:number;reveal:number})=>{
 const [dimensions,setDimensions]=useState<{width:number;height:number}|null>(null);
 const [handle]=useState(()=>delayRender('Measure focus image'));
 useEffect(()=>{if(dimensions)continueRender(handle);},[dimensions,handle]);
 const state=focusFrame({frame,frames,focus}),viewport={w:box.w-32,h:box.h-(focus.label?100:32)};
 const ratio=dimensions?Math.min(viewport.w/dimensions.width,viewport.h/dimensions.height):1;
 const imageW=dimensions?dimensions.width*ratio:viewport.w,imageH=dimensions?dimensions.height*ratio:viewport.h;
 const offsetX=(viewport.w-imageW)/2,offsetY=(viewport.h-imageH)/2;
 const locatorX=Math.max(14,Math.min(viewport.w-14,offsetX+imageW*state.locatorX)),locatorY=Math.max(14,Math.min(viewport.h-14,offsetY+imageH*state.locatorY));
 const label=fitText(focus.label,{width:box.w-70,height:48,maxSize:24,lineHeight:1.2});
 return <div style={{...positioned(box),opacity:reveal,border:`1px solid ${d.accent}44`,background:d.background,borderRadius:12,overflow:'hidden'}}>
  <div style={{position:'absolute',left:16,top:16,width:viewport.w,height:viewport.h,overflow:'hidden'}}>
   <Img src={staticFile(image)} onLoad={event=>{const {naturalWidth:width,naturalHeight:height}=event.currentTarget;if(width>0&&height>0)setDimensions(current=>current?.width===width&&current?.height===height?current:{width,height});else cancelRender(new Error('INVALID_FOCUS_IMAGE_DIMENSIONS'));}} onError={()=>cancelRender(new Error('FOCUS_IMAGE_LOAD_FAILED'))} style={{position:'absolute',left:offsetX,top:offsetY,width:imageW,height:imageH,objectFit:'contain',transformOrigin:'50% 50%',transform:`translate(${state.x*imageW}px,${state.y*imageH}px) scale(${state.scale})`}}/>
   <div aria-hidden="true" style={{position:'absolute',left:locatorX-12,top:locatorY-12,width:24,height:24,boxSizing:'border-box',border:`2px solid ${d.accent}`,borderRadius:'50%',boxShadow:`0 0 0 4px ${d.background}aa`,opacity:state.highlight}}/>
  </div>
  {focus.label&&<div data-motion-text="focus-label" style={{position:'absolute',left:22,right:22,bottom:12,height:56,display:'flex',alignItems:'center',gap:12,opacity:state.highlight,color:d.foreground}}><div style={{width:4,height:34,background:d.accent,flexShrink:0}}/><div style={{fontSize:label.size,lineHeight:1.2,fontWeight:600}}>{label.lines.map((line:string,i:number)=><div key={i} style={{whiteSpace:'pre'}}>{line}</div>)}</div></div>}
 </div>;
};

const Points=({row,box,d,frame,fps,style}:{row:Slide;box:Box;d:Design;frame:number;fps:number;style:string})=>{
 const points=row.points||[],schedule=pointSchedule(row,points.length,fps),columns=points.length>3?2:1,rows=Math.ceil(points.length/columns),gap=18,cellW=(box.w-gap*(columns-1))/columns,cellH=(box.h-gap*(rows-1))/Math.max(1,rows);
 if(style!=='editorial'){
  const active=Math.max(0,schedule.findLastIndex(time=>frame>=time)),start=schedule[active]||0,reveal=ease((frame-start)/Math.max(1,Math.min(fps*.65,row.frames*.12))),point=points[active]||'',fit=fitText(point,{width:box.w-45,height:box.h-70,maxSize:style==='kinetic'?64:52,balance:true});
  return <div style={{...positioned(box),paddingTop:20}}>
   <div style={{display:'flex',gap:10,marginBottom:30}}>{points.map((_,i)=><div key={i} style={{height:4,width:i===active?80:24,background:d.accent,opacity:i===active?1:.25}}/>)}</div>
   <div style={{color:d.accent,fontSize:19,letterSpacing:3,marginBottom:18}}>POINT {String(active+1).padStart(2,'0')} / {String(points.length).padStart(2,'0')}</div>
   <div data-motion-text="point" style={{fontSize:fit.size,color:d.foreground,fontWeight:600,lineHeight:1.2,opacity:reveal,transform:`translateY(${(1-reveal)*25}px)`}}>{fit.lines.map((line:string,i:number)=><div key={i} style={{whiteSpace:'pre'}}>{line.replace(/\r?\n$/,'')}</div>)}</div>
  </div>;
 }
 return <div style={positioned(box)}>{points.map((point,i)=>{
  const start=schedule[i],reveal=ease((frame-start)/Math.max(1,Math.min(fps*.55,row.frames*.12))),active=frame>=start&&(i===points.length-1||frame<schedule[i+1]),fit=fitText(point,{width:cellW-70,height:cellH-38,maxSize:Math.min(36,cellH*.3)});
  return <div key={i} data-motion-text="point" style={{position:'absolute',left:(i%columns)*(cellW+gap),top:Math.floor(i/columns)*(cellH+gap),width:cellW,height:cellH,boxSizing:'border-box',opacity:reveal,transform:`translateX(${(1-reveal)*-26}px)`,display:'flex',alignItems:'center',padding:'18px 22px 18px 42px',background:active?`${d.accent}12`:`${d.background}d9`,border:`1px solid ${d.accent}${active?'99':'33'}`,borderRadius:style==='kinetic'?0:12,color:d.foreground}}>
   <div style={{position:'absolute',left:0,top:0,width:4,height:`${reveal*100}%`,background:d.accent}}/>
   <div style={{fontSize:fit.size,lineHeight:1.2,fontWeight:active?700:500}}>{fit.lines.map((line:string,j:number)=><div key={j} style={{whiteSpace:'pre'}}>{line.replace(/\r?\n$/,'')}</div>)}</div>
  </div>;
 })}</div>;
};

export const MotionSlide=({row,data,index,design,theme,motion:m}:{row:Slide;data:PresentationData;index:number;design?:Design;theme:Theme;motion:Motion})=>{
 const frame=Math.min(useCurrentFrame(),row.frames-1),fps=data.fps,state=motionFrame({frame,frames:row.frames,fps,motion:m}),direction=sceneDirection({row,index,count:data.rows.length,motion:m});
 const d:Design=design||{...theme,layout:'visual',decoration:'none',titleSize:64,imageSide:'right',imageRatio:.46,radius:16};
 const title=row.title||row.scene||data.title,points=row.points||[],hasImage=!!row.image,closing=direction.layout==='closing',sequence=direction.layout==='sequence'&&m.style==='editorial',left=direction.side==='left',kinetic=m.style==='kinetic';
 const stage=ease((frame-Math.min(fps*.8,row.frames*.12))/Math.max(1,Math.min(fps*.8,row.frames*.14)));
 const imageBox:Box=closing?{x:1130,y:260,w:650,h:500}:sequence?{x:1140,y:235,w:660,h:610}:left?{x:100,y:210,w:795,h:650}:{x:1000,y:180,w:820,h:675};
 const textX=hasImage&&!closing&&left?970:110,textW=hasImage?closing?1000:800:1700;
 const targetHead:Box=sequence?{x:110,y:165,w:hasImage?990:1640,h:180}:closing?{x:110,y:230,w:hasImage?1000:1650,h:320}:{x:textX,y:hasImage?235:245,w:textW,h:points.length?300:450};
 const headBox:Box=kinetic?{x:110+(targetHead.x-110)*stage,y:290+(targetHead.y-290)*stage,w:1700+(targetHead.w-1700)*stage,h:430+(targetHead.h-430)*stage}:targetHead;
 const caption=captionAtFrame(row,frame),captionFit=fitSubtitleText(caption,{width:1630});
 return <AbsoluteFill style={{fontFamily:'NarrationJapanese',overflow:'hidden',color:d.heading}}>
  <Backdrop d={d} m={m} frame={frame} fps={fps} index={index}/>
  <div style={{position:'absolute',left:110,top:100,width:80+180*state.reveal,height:4,background:d.accent}}/>
  <div style={{position:'absolute',left:110,top:125,fontSize:22,letterSpacing:3,color:d.accent,opacity:state.reveal,maxWidth:1500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{row.scene||data.title}</div>
  {row.image&&(row.imageFocus?<FocusArtwork key={row.image} image={row.image} focus={row.imageFocus} box={imageBox} d={d} frame={frame} frames={row.frames} reveal={kinetic?stage:state.reveal}/>:<Artwork image={row.image} box={imageBox} m={m} state={{...state,reveal:kinetic?stage:state.reveal}} side={direction.side} frame={frame} fps={fps}/>)}
  <Headline text={title} box={headBox} frame={frame} fps={fps} frames={row.frames} color={d.heading} size={sequence?78:kinetic?174-56*stage:112} kinetic={kinetic}/>
  {points.length>0&&<div style={{opacity:stage}}><Points row={row} box={sequence?{x:110,y:390,w:hasImage?940:1700,h:440}:closing?{x:110,y:590,w:hasImage?1000:1650,h:260}:{x:textX,y:590,w:textW,h:265}} d={d} frame={frame} fps={fps} style={m.style}/></div>}
  {points.length===0&&<div style={{position:'absolute',left:headBox.x,top:Math.min(820,headBox.y+headBox.h+25),width:Math.min(headBox.w,520)*state.reveal,height:2,background:d.accent,opacity:.65}}/>}
  <div style={{position:'absolute',bottom:0,left:0,right:0,height:185,background:d.background,borderTop:`1px solid ${d.accent}55`,padding:'24px 110px 26px',display:'flex',alignItems:'center',justifyContent:'center'}}>
   <div data-motion-text="caption" style={{color:d.foreground,fontSize:captionFit.size,lineHeight:1.35,textAlign:'center'}}>{captionFit.lines.map((line:string,i:number)=><div key={i} style={{whiteSpace:'pre'}}>{line.replace(/\r?\n$/,'')}</div>)}</div>
  </div>
  <div style={{position:'absolute',bottom:0,left:0,height:4,width:`${clamp((row.from+frame)/data.durationInFrames)*100}%`,background:d.accent}}/>
  <Audio src={staticFile(row.src)}/>
 </AbsoluteFill>;
};

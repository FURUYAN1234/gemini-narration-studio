// Declarative, offline choreography shared by rendering and the UI preview.
// No scripts, URLs, provider calls or nondeterministic clocks enter a render.
export const MOTION_SCHEMA={type:'object',additionalProperties:false,properties:{version:{type:'integer',enum:[1]},style:{type:'string',enum:['cinematic','kinetic','editorial']},intensity:{type:'string',enum:['subtle','standard','bold']}},required:['version','style','intensity']};
export function normalizeMotion(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3||input.version!==1||!MOTION_SCHEMA.properties.style.enum.includes(input.style)||!MOTION_SCHEMA.properties.intensity.enum.includes(input.intensity))throw new Error('INVALID_MOTION');
 return {version:1,style:input.style,intensity:input.intensity};
}
export const IMAGE_FOCUS_SCHEMA={type:'object',additionalProperties:false,properties:{x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1},zoom:{type:'number',minimum:1,maximum:2},label:{type:'string',maxLength:80}},required:['x','y','zoom','label']};
export function normalizeImageFocus(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==4||Object.keys(input).some(key=>!Object.hasOwn(IMAGE_FOCUS_SCHEMA.properties,key))||!['x','y','zoom','label'].every(key=>Object.hasOwn(input,key)))throw new Error('INVALID_IMAGE_FOCUS');
 if(!Number.isFinite(input.x)||input.x<0||input.x>1||!Number.isFinite(input.y)||input.y<0||input.y>1||!Number.isFinite(input.zoom)||input.zoom<1||input.zoom>2||typeof input.label!=='string'||input.label.length>80||/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(input.label))throw new Error('INVALID_IMAGE_FOCUS');
 return {x:input.x,y:input.y,zoom:input.zoom,label:input.label};
}
// Translations and locator positions use the contained image's dimensions,
// not its letterboxed viewport. Bounded panning never exposes an image edge.
export function focusFrame({frame,frames,focus}){
 const value=normalizeImageFocus(focus);
 if(!Number.isFinite(frame)||!Number.isInteger(frames)||frames<1)throw new Error('INVALID_MOTION_TIMING');
 const progress=clamp(frame/Math.max(1,frames-1)),move=ease((progress-.30)/.40),scale=1+(value.zoom-1)*move;
 const limit=(scale-1)/2,pan=position=>Math.min(limit,Math.max(-limit,(.5-position)*scale))+0;
 const x=pan(value.x),y=pan(value.y);
 return {scale,x,y,locatorX:.5+(value.x-.5)*scale+x,locatorY:.5+(value.y-.5)*scale+y,highlight:ease((progress-.24)/.16)};
}
export const clamp=n=>Math.min(1,Math.max(0,n));
export const ease=n=>1-(1-clamp(n))**3;
export const EXPANDED_LAYOUTS=['poster','gallery','rail','stack'];
// Fixed 1080p safe regions are shared by animated and still template rendering.
// Captions own y=895..1080; title, image and point cells never enter that region.
export function templateGeometry(layout,{hasImage=false,pointCount=0}={}){
 if(!EXPANDED_LAYOUTS.includes(layout)||typeof hasImage!=='boolean'||!Number.isInteger(pointCount)||pointCount<0||pointCount>6)throw new Error('INVALID_TEMPLATE_GEOMETRY');
 const box=(x,y,w,h)=>({x,y,w,h});
 let heading,image,region,columns=1;
 if(layout==='poster'){heading=box(110,160,1700,210);image=box(1050,410,760,440);region=box(110,410,hasImage?860:1700,440);columns=pointCount>3?2:1;}
 else if(layout==='gallery'){heading=box(110,165,hasImage?610:1700,465);image=box(790,165,1020,465);region=box(110,680,1700,175);columns=Math.min(3,Math.max(1,pointCount));}
 else if(layout==='rail'){heading=box(110,160,hasImage?600:1700,220);image=box(110,430,600,425);region=hasImage?box(790,160,1020,695):box(110,420,1700,435);}
 else {heading=box(110,160,1700,160);image=box(1270,380,540,470);region=box(110,380,hasImage?1100:1700,470);columns=pointCount>1?2:1;}
 const rows=Math.max(1,Math.ceil(pointCount/columns)),gap=18,w=(region.w-gap*(columns-1))/columns,h=(region.h-gap*(rows-1))/rows;
 return {heading,image:hasImage?image:null,points:Array.from({length:pointCount},(_,i)=>box(region.x+i%columns*(w+gap),region.y+Math.floor(i/columns)*(h+gap),w,h))};
}
export function motionFrame({frame,frames,fps,motion}){
 normalizeMotion(motion);
 if(!Number.isFinite(frame)||!Number.isInteger(frames)||frames<1||!Number.isFinite(fps)||fps<=0)throw new Error('INVALID_MOTION_TIMING');
 const strength={subtle:.35,standard:.7,bold:1}[motion.intensity],progress=clamp(frame/Math.max(1,frames-1));
 const entrance=Math.max(1,Math.min(fps*.8,frames*.22));
 return {progress,reveal:ease(frame/entrance),pan:(progress-.5)*36*strength,scale:1+progress*.065*strength,drift:Math.sin(progress*Math.PI)*22*strength,exit:ease((frame-(frames-Math.min(fps*.36,frames*.1)))/Math.max(1,Math.min(fps*.36,frames*.1))),strength};
}
export function sceneDirection({row,index,count,motion}){
 normalizeMotion(motion);
 const points=row.points||[];
 const layout=index===0?'hero':index===count-1?'closing':points.length>=2?'sequence':row.image?'image':'statement';
 return {layout,side:index%2?'left':'right',style:motion.style};
}
const graphemes=text=>[...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text)].map(s=>s.segment);
const unit=char=>/^[\x20-\x7e]+$/.test(char)?(.6*char.length):1;
export function fitText(text,{width,height,maxSize,lineHeight=1.2,balance=false}){
 if(typeof text!=='string'||![width,height,maxSize,lineHeight].every(n=>Number.isFinite(n)&&n>0))throw new Error('INVALID_MOTION_TEXT');
 const chars=graphemes(text);
 const wrap=size=>{
  const lines=[];let line='',units=0;
  const maximum=width/size,total=chars.reduce((sum,c)=>sum+unit(c),0),limit=balance?Math.min(maximum,total/Math.max(1,Math.ceil(total/maximum))+.5):maximum;
  for(const char of chars){const next=unit(char);if(line&&units+next>limit){
   const phrase=[...line.matchAll(/[、。！？!?：: ]/gu)].at(-1),split=phrase&&phrase.index>=line.length*.4?phrase.index+1:line.length;
   lines.push(line.slice(0,split));line=line.slice(split);units=graphemes(line).reduce((sum,c)=>sum+unit(c),0);
  }line+=char;units+=next;if(char==='\n'){lines.push(line);line='';units=0;}}
  if(line)lines.push(line);return lines;
 };
 let size=maxSize,lines=wrap(size);
 while(lines.length*size*lineHeight>height&&size>1){size=Math.max(1,size-1);lines=wrap(size);}
 return {lines,size};
}
export function pointSchedule(row,count,fps){
 if(!Number.isInteger(count)||count<0||count>6||!Number.isInteger(row.frames)||row.frames<1||!Number.isFinite(fps)||fps<=0)throw new Error('INVALID_MOTION_TIMING');
 const cues=row.subtitles||[];
 return Array.from({length:count},(_,i)=>Math.max(0,Math.min(row.frames-1,Math.round(cues.length>=count?cues[Math.floor(i*cues.length/count)].from:row.frames*.62*i/Math.max(1,count)))));
}

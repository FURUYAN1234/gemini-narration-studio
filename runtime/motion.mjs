// Declarative, offline choreography shared by rendering and the UI preview.
// No scripts, URLs, provider calls or nondeterministic clocks enter a render.
export const TRANSITION_VARIANTS=Object.freeze({wipe:4,diagonal:4,split:2,doors:2,blinds:2,checker:2,iris:5,diamond:1,ellipse:2,clock:2,stairs:4,tiles:4,fade:1,cut:1});
export const TRANSITION_FAMILIES=Object.freeze(Object.keys(TRANSITION_VARIANTS));
export const TRANSITION_TONES=Object.freeze(['image','background','accent','heading']);
export function videoBackground(palette){
 const base={backgroundColor:palette.background};
 if(palette.decoration==='grid')return {...base,backgroundImage:`linear-gradient(${palette.accent}22 1px,transparent 1px),linear-gradient(90deg,${palette.accent}22 1px,transparent 1px)`,backgroundSize:'60px 60px'};
 if(palette.decoration==='band')return {...base,backgroundImage:`linear-gradient(90deg,transparent 0 calc(100% - 40px),${palette.accent} calc(100% - 40px))`};
 return base;
}
export const TRANSITION_INSTRUCTION='motion.transitionsとmotion.transitionTonesに場面境界の順で提案します。台本が1カットの場合は配列を省略し、2カット以上ではカット数から1を引いた数の項目を返します。種類は'+TRANSITION_FAMILIES.join('/')+'。見る人が操作・比較・場面の変化を理解する助けになる効果だけを選びます。演出する必要がない境界はcutです。色は採用画像または選択中の配色を使い、連続点滅を避けます。色の候補はimage、background、accent、headingです。';
export const MOTION_SCHEMA={type:'object',additionalProperties:false,properties:{version:{type:'integer',enum:[1]},style:{type:'string',enum:['cinematic','kinetic','editorial']},intensity:{type:'string',enum:['subtle','standard','bold']},transitions:{type:'array',minItems:1,maxItems:299,items:{type:'string',enum:TRANSITION_FAMILIES}},transitionTones:{type:'array',minItems:1,maxItems:299,items:{type:'string',enum:TRANSITION_TONES}}},required:['version','style','intensity']};
export function normalizeMotion(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!MOTION_SCHEMA.required.every(k=>Object.hasOwn(input,k))||Object.keys(input).some(k=>!Object.hasOwn(MOTION_SCHEMA.properties,k))||input.version!==1||!MOTION_SCHEMA.properties.style.enum.includes(input.style)||!MOTION_SCHEMA.properties.intensity.enum.includes(input.intensity))throw new Error('INVALID_MOTION');
 for(const [key,catalogue] of [['transitions',TRANSITION_FAMILIES],['transitionTones',TRANSITION_TONES]])if(Object.hasOwn(input,key)&&(!Array.isArray(input[key])||!input[key].length||input[key].length>299||input[key].some(t=>!catalogue.includes(t))))throw new Error('INVALID_MOTION');
 return {version:1,style:input.style,intensity:input.intensity,...(input.transitions?{transitions:[...input.transitions]}:{}),...(input.transitionTones?{transitionTones:[...input.transitionTones]}:{})};
}
// Both short renderers consume the same scenario plan. Geometry is chosen
// from the intended use of the material, never from its sequence number.
export function promoSceneDirection({promoDesign,designLayout,promoStyle,promoTransition,effect,video}={}){
 const layout=designLayout||promoDesign?.layout||'split';
 const stacked=(!effect||effect==='reveal')&&!video&&['poster','stack','focus','gallery'].includes(layout);
 const imageLeft=promoDesign?.imageSide==='left';
 const stage=stacked?{x:382,y:245,w:1152,h:648}:{x:imageLeft?76:632,y:160,w:1216,h:684};
 const copy=stacked?{x:110,y:115,w:1700,h:120}:{x:imageLeft?1340:76,y:179,w:502,h:647};
 const moving=!!promoStyle&&!!promoTransition&&promoTransition.family!=='cut';
 const id=effect==='comparison'?'comparison':effect==='steps'||effect==='focus'||video||layout==='steps'?'procedure':promoStyle==='cinematic'?'quiet':promoStyle==='kinetic'?'kinetic':'editorial';
 const beat={comparison:.62,procedure:.48,quiet:.79,kinetic:.41,editorial:.59}[id];
 return {id,stage,copy,stacked,background:promoDesign?.background||'#14161e',heading:promoDesign?.heading||'#ffffff',foreground:promoDesign?.foreground||'#e1e4ec',accent:promoDesign?.accent||'#a9c6ff',reveal:moving?Math.min(.46,beat*.65):0};
}

// Apply the current plan to its corresponding boundary. For a repeated
// effect, use an alternative that fits the next cut and its media.
function alternateTransition(previous,next,motion){
 const active=next?.layout==='steps'||next?.layout==='rail'||next?.video;
 const comparison=next?.explanation?.type==='comparison';
 const candidates=comparison?['split','doors','fade']
  :active?['wipe','blinds','fade']
  :next?.image&&motion.style==='cinematic'?['fade','ellipse','cut']
  :['fade','wipe'];
 return candidates.find(value=>value!==previous)||'cut';
}

export function transitionPlan({rows,motion}){
 const m=normalizeMotion(motion);
 if(!Array.isArray(rows))throw new Error('INVALID_TRANSITION');
 return rows.slice(1).reduce((plan,next,i)=>{
  let family=m.transitions?.[i]||'cut';
  if(family!=='cut'&&family===plan.at(-1)?.family)family=alternateTransition(family,next,m);
  const tone=m.transitionTones?.[i]||'background';
  const variant=plan.filter(choice=>choice.family===family).length%TRANSITION_VARIANTS[family];
  plan.push({family,variant,tone:tone==='image'&&!next?.image?'background':tone});
  return plan;
 },[]);
}

export function transitionSurface(choice,{palette,image}={}){
 if(!TRANSITION_TONES.includes(choice?.tone)||!palette||!['background','accent','heading'].every(k=>/^#[a-f\d]{6}$/i.test(palette[k])))throw new Error('INVALID_TRANSITION');
 if(image!==undefined&&(typeof image!=='string'||! /^(?:cuts|shots)\/[a-z\d_-]+\.(?:png|jpe?g|webp|gif)$/i.test(image)))throw new Error('INVALID_TRANSITION');
 return choice.tone==='image'?{color:palette.background,...(image?{image}:{})}:{color:palette[choice.tone]};
}
export function transitionFrame({frame,frames,fps,motion,outgoingFrom=0}){
 const m=normalizeMotion(motion);
 if(!Number.isFinite(frame)||!Number.isInteger(frames)||frames<1||!Number.isFinite(fps)||fps<=0)throw new Error('INVALID_MOTION_TIMING');
 if(frames<8)return {incoming:0,outgoing:0};
 const duration=Math.max(1,Math.min(fps*({subtle:.28,standard:.4,bold:.5}[m.intensity]),(frames-1)*.12));
 const outgoingDuration=Math.min(duration,frames-1-outgoingFrom);
 return {incoming:1-ease(frame/duration),outgoing:outgoingDuration>0?ease((frame-(frames-1-outgoingDuration))/outgoingDuration):0};
}
// Native CSS masks, bounded to at most 24 tiles; the caller clips these layers
// above the subtitle lane. Full/empty endpoints are exact for every variant.
export function transitionLayers(choice,coverage,color){
 const {family,variant}=choice||{};
 if(!TRANSITION_FAMILIES.includes(family)||!Number.isInteger(variant)||variant<0||variant>=TRANSITION_VARIANTS[family]||!Number.isFinite(coverage)||coverage<0||coverage>1||!/^#[a-f\d]{6}$/i.test(color))throw new Error('INVALID_TRANSITION');
 if(coverage===0||family==='cut')return [];if(coverage===1)return [{inset:0,background:color}];
 const c=coverage,p=c*100,base={inset:0,background:color},clip=clipPath=>({...base,clipPath});
 const rect=(x,y,w,h)=>({left:x+'%',top:y+'%',width:w+'%',height:h+'%',background:color});
 if(family==='fade')return [{...base,opacity:c}];
 if(family==='wipe')return [clip(['inset(0 '+(100-p)+'% 0 0)','inset(0 0 0 '+(100-p)+'%)','inset(0 0 '+(100-p)+'% 0)','inset('+(100-p)+'% 0 0 0)'][variant])];
 if(family==='diagonal'){
  const q=p*2;const points=[[[-1,-1],[q,-1],[-1,q]],[[101,-1],[101-q,-1],[101,q]],[[101,101],[101-q,101],[101,101-q]],[[-1,101],[q,101],[-1,101-q]]][variant];
  return [clip('polygon('+points.map(([x,y])=>x+'% '+y+'%').join(',')+')')];
 }
 if(family==='split')return [clip(variant===0?`inset(0 ${(100-p)/2}% 0 ${(100-p)/2}%)`:`inset(${(100-p)/2}% 0 ${(100-p)/2}% 0)`)];
 if(family==='doors')return variant===0?[rect(0,0,p/2,100),rect(100-p/2,0,p/2,100)]:[rect(0,0,100,p/2),rect(0,100-p/2,100,p/2)];
 if(family==='blinds')return Array.from({length:10},(_,i)=>variant===0?rect(i*10,0,p/10,100):rect(0,i*10,100,p/10));
 if(family==='iris')return [clip(`circle(${c*(variant===0?110:210)}% at ${['50% 50%','0% 0%','100% 0%','100% 100%','0% 100%'][variant]})`)];
 if(family==='ellipse')return [clip(`ellipse(${p*(variant===0?1.1:.7)}% ${p*(variant===0?.7:1.1)}% at 50% 50%)`)];
 if(family==='diamond')return [clip(`polygon(50% ${50-p}%,${50+p}% 50%,50% ${50+p}%,${50-p}% 50%)`)];
 if(family==='clock')return [{inset:0,background:`conic-gradient(from -90deg,${color} ${c*360}deg,transparent 0deg)`,transform:variant?'scaleX(-1)':'none'}];
 if(family==='stairs')return Array.from({length:10},(_,i)=>{const q=clamp(c*1.3-(variant%2?9-i:i)/9*.3)*100;return variant<2?rect(0,i*10,q,10.1):rect(i*10,0,10.1,q);});
 return Array.from({length:24},(_,i)=>{
  const x=i%6,y=Math.floor(i/6),lag=family==='checker'?(x+y+variant)%2*.25:([x/5,1-x/5,y/3,1-y/3][variant])*.35;
  const q=clamp(c*(1+(family==='checker'?.25:.35))-lag);
  return rect(x*100/6+(1-q)*100/12,y*25+(1-q)*12.5,q*100/6+.02,q*25+.02);
 });
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
export function sceneDirection({row,motion,design}){
 normalizeMotion(motion);
 const points=row.points||[];
 const layout=points.length>=2?'sequence':row.image?'image':'statement';
 return {layout,side:design?.imageSide||'right'};
}
const graphemeSegmenter=new Intl.Segmenter('ja',{granularity:'grapheme'}),wordSegmenter=new Intl.Segmenter('ja',{granularity:'word'});
const graphemes=text=>[...graphemeSegmenter.segment(text)].map(s=>s.segment);
const unit=char=>/^[\x20-\x7e]+$/.test(char)?(.6*char.length):1;
const textUnits=text=>graphemes(text).reduce((sum,char)=>sum+unit(char),0);
function wordChunks(text){
 const chunks=[];let opening='';
 for(const {segment}of wordSegmenter.segment(text)){
  if(/^[\p{Ps}\p{Pi}]+$/u.test(segment)){opening+=segment;continue;}
  const previous=chunks.at(-1),attached=previous&&/[\p{Script=Han}]$/u.test(previous)&&/^[\p{Script=Han}]+$/u.test(segment)||/^(?:の|に|を|が|は|へ|と|で|や|も|な)$/.test(segment)||/^[\p{Pe}\p{Pf}、。，．！？!?：:；;％%]+$/u.test(segment)||previous&&/\d$/.test(previous)&&/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,2}$/u.test(segment);
  if(attached&&previous&&!/[\r\n]$/.test(previous)&&!opening)chunks[chunks.length-1]+=segment;
  else{chunks.push(opening+segment);opening='';}
 }
 if(opening)chunks.push(opening);return chunks;
}
export function fitText(text,{width,height,maxSize,lineHeight=1.2,balance=false}){
 if(typeof text!=='string'||![width,height,maxSize,lineHeight].every(n=>Number.isFinite(n)&&n>0))throw new Error('INVALID_MOTION_TEXT');
 const chunks=wordChunks(text).map(text=>({text,units:textUnits(text)})),total=textUnits(text);
 const wrap=size=>{
  const lines=[];let line='',units=0;
  const maximum=width/size,lineCount=Math.max(1,Math.ceil(total/maximum)),limit=balance?Math.min(maximum,total/lineCount+.5):maximum;
  for(const chunk of chunks){
   const pieces=chunk.units>maximum?graphemes(chunk.text).map(text=>({text,units:unit(text)})):[chunk];
   for(const {text:piece,units:next}of pieces){const target=balance&&lines.length>=lineCount-1?maximum:limit;if(line&&units+next>target){lines.push(line);line='';units=0;}
    line+=piece;units+=next;if(/[\r\n]$/.test(piece)){lines.push(line);line='';units=0;}
   }
  }
  if(line)lines.push(line);return lines;
 };
 let size=Math.min(maxSize,Math.max(1,Math.floor(width/Math.max(1,...chunks.map(chunk=>chunk.units))))),lines=wrap(size);
 while(lines.length*size*lineHeight>height&&size>1){size=Math.max(1,size-1);lines=wrap(size);}
 return {lines,size};
}
export function pointSchedule(row,count,fps){
 if(!Number.isInteger(count)||count<0||count>6||!Number.isInteger(row.frames)||row.frames<1||!Number.isFinite(fps)||fps<=0)throw new Error('INVALID_MOTION_TIMING');
 const cues=row.subtitles||[];
 return Array.from({length:count},(_,i)=>Math.max(0,Math.min(row.frames-1,Math.round(cues.length>=count?cues[Math.floor(i*cues.length/count)].from:row.frames*.62*i/Math.max(1,count)))));
}

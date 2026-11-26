import path from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {STUDIO_WATERMARK,safeText} from './production.mjs';
import {atomicWrite} from './atomic-write.mjs';
import {videoCredits} from './video-credits.mjs';
import {promoSound} from './promo-sound.mjs';
import {mediaDuration} from './demo-recording.mjs';

export const promoVideo=/^[a-f0-9]{64}\.mp4$/;
export const promoVisual=/^[a-f0-9]{64}\.(png|jpe?g|webp|mp4)$/;
export const promoVoice=/^[a-f0-9]{64}\.(wav|mp3)$/;

function promoEffect(cut, renderer){
  const available=['focus','steps','comparison'].filter(name=>cut[name]!==undefined);
  const effect=cut.effect==='auto'||cut.effect===undefined?(available[0]||'reveal'):cut.effect;
  if(available.length>1||!['reveal','focus','steps','comparison'].includes(effect))throw new Error('INVALID_PROMO_EFFECT');
  if(renderer==='remotion'&&(available.length||effect!=='reveal'))throw new Error('HYPERFRAMES_EFFECT_REQUIRES_RENDERER');
  const requiredText=(value,limit)=>{
    if(typeof value!=='string'||!value.trim()||value.length>limit)throw new Error('INVALID_PROMO_EFFECT');
    return safeText(value,limit).trim();
  };
  if(effect==='focus'){
    const {x,y,width,height,label}=cut.focus??{};
    if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>100||y+height>100)throw new Error('INVALID_PROMO_EFFECT');
    return {effect,focus:{x,y,width,height,label:requiredText(label,35)}};
  }
  if(effect==='steps'){
    if(!Array.isArray(cut.steps)||cut.steps.length<2||cut.steps.length>4)throw new Error('INVALID_PROMO_EFFECT');
    return {effect,steps:cut.steps.map(label=>requiredText(label,28))};
  }
  if(effect==='comparison'){
    if(!Array.isArray(cut.comparison)||cut.comparison.length!==2)throw new Error('INVALID_PROMO_EFFECT');
    return {effect,comparison:cut.comparison.map(item=>({label:requiredText(item?.label,22),value:requiredText(item?.value,28)}))};
  }
  return renderer==='hyperframes'?{effect}:{};
}

export async function preparePromo(dir,input,production,rendererRoot,hyperframesReady=false) {
  const title=safeText(input.title,90).trim();
  if(!title||!Array.isArray(input.cuts)||input.cuts.length<1||input.cuts.length>6)throw new Error('INVALID_PROMO');
  const choice=input.renderer===undefined?'auto':input.renderer;
  if(!['auto','remotion','hyperframes'].includes(choice))throw new Error('INVALID_PROMO_RENDERER');
  if(choice==='hyperframes'&&!hyperframesReady)throw new Error('HYPERFRAMES_INSTALL_REQUIRED');
  const renderer=choice==='auto'?(hyperframesReady?'hyperframes':'remotion'):choice;
  const assets=production.status().assets;
  const cuts=[];
  await mkdir(dir,{recursive:true});
  const staged=new Map();
  async function stage(file){
    if(!staged.has(file)){
      const bytes=await production.readAsset(file);
      if(createHash('sha256').update(bytes).digest('hex')!==file.split('.')[0])throw new Error('PROMO_ASSET_CHANGED');
      const destination=path.join(dir,file);
      await atomicWrite(destination,bytes);
      staged.set(file,destination);
    }
    return staged.get(file);
  }
  for(const cut of input.cuts){
    const file=cut?.image,asset=assets.find(a=>a.file===file);
    if(typeof file!=='string'||!promoVisual.test(file)||!asset)throw new Error('INVALID_PROMO_IMAGE');
    const title=safeText(cut.title,66).trim(),caption=safeText(cut.caption??'',120).trim();
    if(!title||cut.seconds!==undefined&&(!Number.isInteger(cut.seconds)||cut.seconds<3||cut.seconds>8))throw new Error('INVALID_PROMO_CUT');
    const source=await stage(file),isVideo=promoVideo.test(file);
    let seconds=cut.seconds??4,videoRange,stillFrames;
    if(isVideo){
      const duration=await mediaDuration(rendererRoot,source);
      if(duration<1||duration>30)throw new Error('INVALID_PROMO_VIDEO_DURATION');
      const available=Math.floor(duration*30),startFrame=cut.startFrame??0,frames=cut.frames??(cut.seconds?Math.min(available-startFrame,cut.seconds*30):available-startFrame);
      if(!Number.isInteger(startFrame)||!Number.isInteger(frames)||startFrame<0||frames<18||startFrame+frames>available)throw new Error('INVALID_PROMO_VIDEO_RANGE');
      seconds=frames/30;
      if(cut.holdFrames!==undefined&&(renderer!=='hyperframes'||!Number.isInteger(cut.holdFrames)||cut.holdFrames<1||frames+cut.holdFrames>900))throw new Error('INVALID_PROMO_VIDEO_RANGE');
      videoRange={startFrame,frames,...(cut.holdFrames?{holdFrames:cut.holdFrames}:{})};
    }else{
      if(cut.startFrame!==undefined||cut.holdFrames!==undefined||cut.frames!==undefined&&(renderer!=='hyperframes'||cut.seconds!==undefined||!Number.isInteger(cut.frames)||cut.frames<18||cut.frames>900))throw new Error('INVALID_PROMO_VIDEO_RANGE');
      if(cut.frames!==undefined){stillFrames=cut.frames;seconds=stillFrames/30;}
    }
    let direction=cut,stepStarts;
    if(renderer==='hyperframes'&&videoRange&&asset.recording?.events&&(cut.effect===undefined||cut.effect==='auto')&&cut.steps===undefined&&cut.focus===undefined&&cut.comparison===undefined){
      const start=videoRange.startFrame/30*1000,end=start+seconds*1000;
      const unique=new Map();
      for(const event of asset.recording.events){
        const label=event.target.slice(0,28).trim();
        if(event.startMs>=start&&event.startMs<end&&label&&!unique.has(label))unique.set(label,(event.startMs-start)/1000);
        if(unique.size===4)break;
      }
      if(unique.size>=2){direction={...cut,steps:[...unique.keys()]};stepStarts=[...unique.values()];}
    }
    cuts.push({image:file,title,caption,seconds,...videoRange,...(stillFrames?{frames:stillFrames}:{}),...promoEffect(direction,renderer),...(stepStarts?{stepStarts}:{})});
  }
  const narration=input.narration??'';
  if(typeof narration!=='string'||narration&&(!promoVoice.test(narration)||!assets.some(a=>a.file===narration)))throw new Error('INVALID_PROMO_NARRATION');
  let narrationSeconds;
  if(input.openingTitleRequired!==undefined&&typeof input.openingTitleRequired!=='boolean')throw new Error('INVALID_OPENING_TITLE_PREFERENCE');
  const titleCall=input.titleCall??'';
  if(narration&&input.openingTitleRequired!==false&&!titleCall)throw new Error('PROMO_TITLE_CALL_REQUIRED');
  if(narration){
    const duration=await mediaDuration(rendererRoot,await stage(narration));
    if(duration>cuts.reduce((sum,cut)=>sum+((cut.frames??cut.seconds*30)+(cut.holdFrames??0))/30,0))throw new Error('PROMO_NARRATION_TOO_LONG');
    if(renderer==='hyperframes')narrationSeconds=duration;
  }
  let opening;
  if(titleCall){
    if(typeof titleCall!=='string'||!promoVoice.test(titleCall)||titleCall===narration||!assets.some(a=>a.file===titleCall))throw new Error('INVALID_PROMO_TITLE_CALL');
    const duration=await mediaDuration(rendererRoot,await stage(titleCall));
    if(duration<=0||duration>20)throw new Error('INVALID_PROMO_TITLE_CALL');
    opening={file:titleCall,seconds:duration,frames:Math.max(75,Math.ceil((duration+.35)*30))};
  }
  if(input.watermarkEnabled!==undefined&&typeof input.watermarkEnabled!=='boolean')throw new Error('INVALID_WATERMARK_PREFERENCE');
  if(input.soundEnabled!==undefined&&typeof input.soundEnabled!=='boolean')throw new Error('INVALID_PROMO_SOUND');
  const watermarkEnabled=input.watermarkEnabled??(production.status().watermarkEnabled!==false);
  const draft={templateVersion:6,title,cuts,watermarkEnabled,soundEnabled:input.soundEnabled??true,...(renderer==='hyperframes'?{renderer}:{}),...(narration?{narration}:{}),...(narrationSeconds?{narrationSeconds}:{}),...(opening?{opening}:{})};
  const revision=createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  await atomicWrite(path.join(dir,'promo.json'),JSON.stringify({...draft,revision}));
  return {title,revision,renderer};
}

export async function promoPresentation(dir,publicDir) {
  const input=JSON.parse(await readFile(path.join(dir,'promo.json'),'utf8'));
  const fps=30,gapFrames=0;
  let from=input.opening?.frames??0;
  const rows=[];
  await mkdir(path.join(publicDir,'shots'),{recursive:true});
  for(const [index,cut] of input.cuts.entries()){
    const {image,title,caption,seconds}=cut;
    if(!promoVisual.test(image))throw new Error('INVALID_PROMO_IMAGE');
    const bytes=await readFile(path.join(dir,image));
    if(createHash('sha256').update(bytes).digest('hex')!==image.split('.')[0])throw new Error('PROMO_ASSET_CHANGED');
    await writeFile(path.join(publicDir,'shots',image),bytes);
    const sourceFrames=cut.frames??Math.floor(seconds*fps),frames=sourceFrames+(cut.holdFrames??0);
    rows.push({id:'cut-'+index,title,caption,from,frames,...(promoVideo.test(image)?{video:'shots/'+image,videoStart:cut.startFrame??0,...(cut.holdFrames?{videoFrames:sourceFrames}: {})}:{image:'shots/'+image}),...promoEffect(cut,input.renderer||'remotion'),stepStarts:cut.stepStarts});
    from+=frames;
  }
  const frames=4*fps;
  const durationInFrames=from+frames;
  let promoAudio;
  if(input.soundEnabled!==false){
    promoAudio='promo-sound.wav';
    await writeFile(path.join(publicDir,promoAudio),promoSound(rows,durationInFrames/fps,fps));
  }
  const bookends={...STUDIO_WATERMARK,creationYear:Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Tokyo'}).format(new Date())),watermarkEnabled:input.watermarkEnabled,from,frames,tools:videoCredits({promo:true,promoAudio:!!promoAudio,renderer:input.renderer})};
  let promoNarration,promoNarrationSeconds;
  if(input.narration){
    if(!promoVoice.test(input.narration))throw new Error('INVALID_PROMO_NARRATION');
    const bytes=await readFile(path.join(dir,input.narration));
    if(createHash('sha256').update(bytes).digest('hex')!==input.narration.split('.')[0])throw new Error('PROMO_ASSET_CHANGED');
    promoNarration='shots/'+input.narration;
    await writeFile(path.join(publicDir,promoNarration),bytes);
    promoNarrationSeconds=input.narrationSeconds;
  }
  let promoOpening;
  if(input.opening){
    const {file,seconds,frames}=input.opening;
    if(!promoVoice.test(file))throw new Error('INVALID_PROMO_TITLE_CALL');
    const bytes=await readFile(path.join(dir,file));
    if(createHash('sha256').update(bytes).digest('hex')!==file.split('.')[0])throw new Error('PROMO_ASSET_CHANGED');
    const src='shots/'+file;
    await writeFile(path.join(publicDir,src),bytes);
    promoOpening={id:'promo-opening',caption:input.title,src,from:0,frames,seconds};
  }
  return {title:input.title,promo:true,...(promoOpening?{promoOpening}:{}),renderer:input.renderer||'remotion',...(promoAudio?{promoAudio}:{}),...(promoNarration?{promoNarration,promoNarrationSeconds}:{}),rows,fps,gapFrames,bookends,durationInFrames};
}

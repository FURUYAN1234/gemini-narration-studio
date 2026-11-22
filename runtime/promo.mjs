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

export async function preparePromo(dir,input,production,rendererRoot) {
  const title=safeText(input.title,90).trim();
  if(!title||!Array.isArray(input.cuts)||input.cuts.length<1||input.cuts.length>6)throw new Error('INVALID_PROMO');
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
    const file=cut?.image;
    if(typeof file!=='string'||!promoVisual.test(file)||!assets.some(a=>a.file===file))throw new Error('INVALID_PROMO_IMAGE');
    const title=safeText(cut.title,66).trim(),caption=safeText(cut.caption??'',120).trim();
    if(!title||cut.seconds!==undefined&&(!Number.isInteger(cut.seconds)||cut.seconds<3||cut.seconds>8))throw new Error('INVALID_PROMO_CUT');
    const source=await stage(file),isVideo=promoVideo.test(file);
    let seconds=cut.seconds??4,videoRange;
    if(isVideo){
      const duration=await mediaDuration(rendererRoot,source);
      if(duration<1||duration>30)throw new Error('INVALID_PROMO_VIDEO_DURATION');
      const available=Math.floor(duration*30),startFrame=cut.startFrame??0,frames=cut.frames??(cut.seconds?Math.min(available-startFrame,cut.seconds*30):available-startFrame);
      if(!Number.isInteger(startFrame)||!Number.isInteger(frames)||startFrame<0||frames<18||startFrame+frames>available)throw new Error('INVALID_PROMO_VIDEO_RANGE');
      seconds=frames/30;
      videoRange={startFrame,frames};
    }else if(cut.startFrame!==undefined||cut.frames!==undefined)throw new Error('INVALID_PROMO_VIDEO_RANGE');
    cuts.push({image:file,title,caption,seconds,...videoRange});
  }
  const narration=input.narration??'';
  if(typeof narration!=='string'||narration&&(!promoVoice.test(narration)||!assets.some(a=>a.file===narration)))throw new Error('INVALID_PROMO_NARRATION');
  if(narration){
    const duration=await mediaDuration(rendererRoot,await stage(narration));
    if(duration>cuts.reduce((sum,cut)=>sum+(cut.frames??cut.seconds*30)/30,0))throw new Error('PROMO_NARRATION_TOO_LONG');
  }
  if(input.watermarkEnabled!==undefined&&typeof input.watermarkEnabled!=='boolean')throw new Error('INVALID_WATERMARK_PREFERENCE');
  if(input.soundEnabled!==undefined&&typeof input.soundEnabled!=='boolean')throw new Error('INVALID_PROMO_SOUND');
  const watermarkEnabled=input.watermarkEnabled??(production.status().watermarkEnabled!==false);
  const draft={templateVersion:narration||cuts.some(cut=>promoVideo.test(cut.image))?3:2,title,cuts,watermarkEnabled,soundEnabled:input.soundEnabled??true,...(narration?{narration}:{})};
  const revision=createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  await atomicWrite(path.join(dir,'promo.json'),JSON.stringify({...draft,revision}));
  return {title,revision};
}

export async function promoPresentation(dir,publicDir) {
  const input=JSON.parse(await readFile(path.join(dir,'promo.json'),'utf8'));
  const fps=30,gapFrames=0;
  let from=0;
  const rows=[];
  await mkdir(path.join(publicDir,'shots'),{recursive:true});
  for(const [index,cut] of input.cuts.entries()){
    const {image,title,caption,seconds}=cut;
    if(!promoVisual.test(image))throw new Error('INVALID_PROMO_IMAGE');
    const bytes=await readFile(path.join(dir,image));
    if(createHash('sha256').update(bytes).digest('hex')!==image.split('.')[0])throw new Error('PROMO_ASSET_CHANGED');
    await writeFile(path.join(publicDir,'shots',image),bytes);
    const frames=cut.frames??Math.floor(seconds*fps);
    rows.push({id:'cut-'+index,title,caption,from,frames,...(promoVideo.test(image)?{video:'shots/'+image,videoStart:cut.startFrame??0}:{image:'shots/'+image})});
    from+=frames;
  }
  const frames=4*fps;
  const durationInFrames=from+frames;
  let promoAudio;
  if(input.soundEnabled!==false){
    promoAudio='promo-sound.wav';
    await writeFile(path.join(publicDir,promoAudio),promoSound(rows,durationInFrames/fps,fps));
  }
  const bookends={...STUDIO_WATERMARK,creationYear:Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Tokyo'}).format(new Date())),watermarkEnabled:input.watermarkEnabled,from,frames,tools:videoCredits({promo:true,promoAudio:!!promoAudio})};
  let promoNarration;
  if(input.narration){
    if(!promoVoice.test(input.narration))throw new Error('INVALID_PROMO_NARRATION');
    const bytes=await readFile(path.join(dir,input.narration));
    if(createHash('sha256').update(bytes).digest('hex')!==input.narration.split('.')[0])throw new Error('PROMO_ASSET_CHANGED');
    promoNarration='shots/'+input.narration;
    await writeFile(path.join(publicDir,promoNarration),bytes);
  }
  return {title:input.title,promo:true,...(promoAudio?{promoAudio}:{}),...(promoNarration?{promoNarration}:{}),rows,fps,gapFrames,bookends,durationInFrames};
}

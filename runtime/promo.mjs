import path from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {STUDIO_WATERMARK,safeText} from './production.mjs';
import {atomicWrite} from './atomic-write.mjs';
import {videoCredits} from './video-credits.mjs';
import {promoSound} from './promo-sound.mjs';

export const promoImage=/^[a-f0-9]{64}\.(png|jpe?g|webp)$/;

export async function preparePromo(dir,input,production) {
  const title=safeText(input.title,90).trim();
  if(!title||!Array.isArray(input.cuts)||input.cuts.length<1||input.cuts.length>6)throw new Error('INVALID_PROMO');
  const assets=production.status().assets;
  const cuts=input.cuts.map(cut=>{
    if(!cut||typeof cut.image!=='string'||!promoImage.test(cut.image)||!assets.some(a=>a.file===cut.image))throw new Error('INVALID_PROMO_IMAGE');
    const title=safeText(cut.title,66).trim(),caption=safeText(cut.caption??'',120).trim(),seconds=cut.seconds??4;
    if(!title||!Number.isInteger(seconds)||seconds<3||seconds>8)throw new Error('INVALID_PROMO_CUT');
    return {image:cut.image,title,caption,seconds};
  });
  if(input.watermarkEnabled!==undefined&&typeof input.watermarkEnabled!=='boolean')throw new Error('INVALID_WATERMARK_PREFERENCE');
  if(input.soundEnabled!==undefined&&typeof input.soundEnabled!=='boolean')throw new Error('INVALID_PROMO_SOUND');
  const watermarkEnabled=input.watermarkEnabled??(production.status().watermarkEnabled!==false);
  const draft={templateVersion:2,title,cuts,watermarkEnabled,soundEnabled:input.soundEnabled??true};
  await mkdir(dir,{recursive:true});
  for(const file of new Set(cuts.map(cut=>cut.image)))await writeFile(path.join(dir,file),await production.readAsset(file));
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
    if(!promoImage.test(image))throw new Error('INVALID_PROMO_IMAGE');
    const bytes=await readFile(path.join(dir,image));
    if(createHash('sha256').update(bytes).digest('hex')!==image.split('.')[0])throw new Error('PROMO_ASSET_CHANGED');
    await writeFile(path.join(publicDir,'shots',image),bytes);
    const frames=seconds*fps;
    rows.push({id:'cut-'+index,title,caption,from,frames,image:'shots/'+image});
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
  return {title:input.title,promo:true,...(promoAudio?{promoAudio}:{}),rows,fps,gapFrames,bookends,durationInFrames};
}

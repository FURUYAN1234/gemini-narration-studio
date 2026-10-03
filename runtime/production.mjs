import {createHash} from 'node:crypto';
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';
import {assertDesignReady} from './designs.mjs';
function normalizeCutImages(items=[]){
 if(!Array.isArray(items)||items.length>100)throw new Error('INVALID_CUT_IMAGES');
 const ids=new Set();return items.map(item=>{if(!item||Object.keys(item).some(k=>!['rowId','file'].includes(k))||typeof item.rowId!=='string'||!/^[\w-]{1,100}$/.test(item.rowId)||! /^[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/.test(item.file)||ids.has(item.rowId))throw new Error('INVALID_CUT_IMAGES');ids.add(item.rowId);return {rowId:item.rowId,file:item.file};});
}
export function normalizeVisuals(value){if(value===undefined)return undefined;if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>300)throw new Error('INVALID_CUT_VISUALS');const result={};for(const [id,visual]of Object.entries(value)){if(!/^[\w-]{1,100}$/.test(id)||!visual||Object.keys(visual).some(k=>!['title','points'].includes(k))||!Array.isArray(visual.points)||visual.points.length>6)throw new Error('INVALID_CUT_VISUALS');result[id]={title:safeText(visual.title,200),points:visual.points.map(p=>safeText(p,160))};}return result;}

export const MAX_ASSET_BYTES=100*1024*1024;
export function safeText(value,max=20000){
  if(typeof value!=='string'||value.length>max)throw new Error('INVALID_PRODUCTION_TEXT');
  if(/(?:AIza[\w-]{20,}|sk-(?:proj-)?[\w-]{16,}|Bearer\s+[\w.-]{8,})/i.test(value))throw new Error('CREDENTIAL_IN_TEXT');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw new Error('INVALID_PRODUCTION_TEXT');
  return value.trim();
}
export function normalizeBrief(input){
  if(!['existing','ai','mixed'].includes(input?.scriptMode)||!['provided','ai','mixed'].includes(input?.assetMode))throw new Error('INVALID_PRODUCTION_MODE');
  const brief={scriptMode:input.scriptMode,assetMode:input.assetMode,instructions:safeText(input.instructions),script:safeText(input.script)};
  if(input.readings!==undefined)brief.readings=normalizeScriptReadings(brief.script,input.readings);return brief;
}
export function isHiraganaReading(value){return typeof value==='string'&&/[ぁ-ゖ]/u.test(value)&&!/[^ぁ-ゖー\p{P}\s\u3099\u309a]/u.test(value);}
export function normalizeScriptReadings(script,readings){
  const captions=safeText(script).split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);
  if(!Array.isArray(readings)||!captions.length||readings.length!==captions.length||readings.length>300)throw new Error('INVALID_SCRIPT_READINGS');
  return readings.map((r,i)=>{const caption=safeText(r?.caption,4000),speech=safeText(r?.speech,4000);if(caption!==captions[i])throw new Error('STALE_SCRIPT_READINGS');if(!isHiraganaReading(speech))throw new Error('HIRAGANA_READING_REQUIRED');const count=v=>[...new Intl.Segmenter('ja',{granularity:'sentence'}).segment(v)].length;if(count(caption)!==count(speech))throw new Error('READING_SENTENCE_MISMATCH');return {caption,speech};});
}
export function normalizeReview(input={version:1,sourceRevision:'',overall:'',cuts:[]}){
  if(input?.version!==1||!Array.isArray(input.cuts)||input.cuts.length>300)throw new Error('INVALID_REVIEW');
  const seen=new Set(),cuts=input.cuts.map(c=>{if(!c||typeof c.rowId!=='string'||!/^[-\w]{1,64}$/.test(c.rowId)||seen.has(c.rowId))throw new Error('INVALID_REVIEW_CUT');seen.add(c.rowId);return {rowId:c.rowId,instruction:safeText(c.instruction,2000)};}).filter(c=>c.instruction);
  const result={version:1,sourceRevision:safeText(input.sourceRevision,100),overall:safeText(input.overall,4000),cuts};
  if(result.overall.length+cuts.reduce((n,c)=>n+c.instruction.length,0)>20000)throw new Error('REVIEW_TOO_LONG');return result;
}
function normalizeCutConfirmations(input=[]){if(!Array.isArray(input)||input.length>300)throw new Error('INVALID_CUT_CONFIRMATIONS');const seen=new Set();return input.map(c=>{if(!c||!/^[-\w]{1,64}$/.test(c.rowId)||seen.has(c.rowId)||!/^[a-f0-9]{64}$/.test(c.fingerprint))throw new Error('INVALID_CUT_CONFIRMATION');seen.add(c.rowId);return {rowId:c.rowId,fingerprint:c.fingerprint};});}
const formats={png:b=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg:b=>b[0]===255&&b[1]===216&&b[2]===255,jpeg:b=>b[0]===255&&b[1]===216&&b[2]===255,webp:b=>b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP',mp4:b=>b.toString('ascii',4,8)==='ftyp',webm:b=>b.subarray(0,4).equals(Buffer.from([26,69,223,163])),wav:b=>b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE',mp3:b=>b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224),pdf:b=>b.toString('ascii',0,5)==='%PDF-',txt:b=>{try{safeText(new TextDecoder('utf-8',{fatal:true}).decode(b));return true;}catch{return false;}}};
export function validateAsset(name,bytes){name=safeText(name,180);if(!name||/[\\/]/.test(name))throw new Error('INVALID_ASSET_NAME');const ext=path.extname(name).slice(1).toLowerCase();if(!formats[ext]||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_ASSET_BYTES||!formats[ext](bytes))throw new Error('INVALID_ASSET_TYPE_OR_SIZE');return ext;}
export class ProductionInputs {
  constructor(dir){this.dir=path.resolve(dir);this.value={version:1,brief:{scriptMode:'existing',assetMode:'mixed',instructions:'',script:''},assets:[],cutConfirmations:[],requiresFinalization:true,finalization:null};}
  static async open(dir){const p=new ProductionInputs(dir);await mkdir(path.join(p.dir,'materials'),{recursive:true});try{const saved=JSON.parse(await readFile(path.join(p.dir,'production.json'),'utf8'));p.value.brief=normalizeBrief(saved.brief);p.value.review=normalizeReview(saved.review);p.value.cutConfirmations=normalizeCutConfirmations(saved.cutConfirmations);p.value.cutImages=normalizeCutImages(saved.cutImages);if(saved.visuals)p.value.visuals=normalizeVisuals(saved.visuals);p.value.requiresFinalization=saved.requiresFinalization===true;p.value.finalization=saved.finalization||null;if(p.value.finalization&&(!/^[a-f0-9]{64}$/.test(p.value.finalization.revision)||!/^[a-f0-9]{64}$/.test(p.value.finalization.inputsHash)))throw new Error("INVALID_FINALIZATION");if(!Array.isArray(saved.assets)||saved.assets.length>100)throw new Error('INVALID_ASSETS');for(const a of saved.assets){if(!/^[a-f0-9]{64}\.(png|jpg|jpeg|webp|mp4|webm|wav|mp3|pdf|txt)$/.test(a.file)||!Number.isSafeInteger(a.size)||a.size<1||a.size>MAX_ASSET_BYTES)throw new Error('INVALID_ASSET');safeText(a.name,180);let bytes;try{bytes=await p.readAsset(a.file);}catch{throw new Error('INVALID_ASSET');}if(bytes.length!==a.size||createHash('sha256').update(bytes).digest('hex')!==a.file.split('.')[0])throw new Error('INVALID_ASSET');p.value.assets.push({name:a.name,file:a.file,size:a.size});}}catch(e){if(e.code!=='ENOENT')throw new Error('SAVED_PRODUCTION_INVALID');}return p;}
  status(){return {...structuredClone(this.value),review:normalizeReview(this.value.review)};}
  assertNoCorrections(){const r=this.status().review;if(r.overall||r.cuts.length)throw new Error('CORRECTIONS_PENDING');}
  assertWritable(){if(this.value.finalization)throw new Error('VIDEO_FINALIZED');}
  finalInputsHash(){return createHash('sha256').update(JSON.stringify({brief:this.value.brief,assets:this.value.assets,review:normalizeReview(this.value.review),cutConfirmations:this.value.cutConfirmations,...(this.value.cutImages?.length?{cutImages:this.value.cutImages}:{}),...(this.value.visuals?{visuals:this.value.visuals}:{})})).digest('hex');}
  assertFinalization(current){if(!this.value.requiresFinalization&&!this.value.finalization)return;if(!this.value.finalization)throw new Error('FINAL_CONFIRMATION_REQUIRED');if(this.value.finalization.revision!==current.revision||this.value.finalization.inputsHash!==this.finalInputsHash())throw new Error('FINALIZED_CONTENT_CHANGED');}
  async finalize(current){this.assertWritable();this.assertNoCorrections();this.assertCutsConfirmed(current.rows);assertDesignReady(current.presentation);const finalization={revision:current.revision,inputsHash:this.finalInputsHash()};await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,requiresFinalization:true,finalization},null,2));this.value.requiresFinalization=true;this.value.finalization=finalization;}
  async reopenCut(rowId){this.assertWritable();const cutConfirmations=this.value.cutConfirmations.filter(c=>c.rowId!==rowId);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,cutConfirmations},null,2));this.value.cutConfirmations=cutConfirmations;}
  cutImage(row){const mapping=(this.value.cutImages||[]).find(c=>c.rowId===row.id);if(mapping){const asset=this.value.assets.find(a=>a.file===mapping.file);if(!asset||! /\.(png|jpg|jpeg|webp)$/.test(asset.file))throw new Error('INVALID_CUT_IMAGE');return asset;}const images=this.value.assets.filter(a=>a.name==='cut-'+row.id+'.png');if(images.length>1)throw new Error('CUT_IMAGE_AMBIGUOUS');return images[0]||null;}
  imageRequired(){return !this.value.finalization&&(this.value.brief.assetMode==='ai'||this.value.assets.some(a=>/\.(png|jpg|jpeg|webp)$/.test(a.file)));}
  cutFingerprint(row){const image=this.cutImage(row);return createHash('sha256').update(JSON.stringify({id:row.id,scene:row.scene,caption:row.caption,speech:row.speech,audio:row.audio,image:image?.file||null,...(this.value.visuals?.[row.id]?{visual:this.value.visuals[row.id]}:{})})).digest('hex');}
  cutInfo(row){let fingerprint,image;try{image=this.cutImage(row);fingerprint=this.cutFingerprint(row);}catch{return {cutConfirmed:false,cutFingerprint:null,cutImage:null};}if(!image&&this.imageRequired())return {cutConfirmed:false,cutFingerprint:null,cutImage:null};return {cutImage:image,cutVisual:this.value.visuals?.[row.id],cutFingerprint:fingerprint,cutConfirmed:!!(row.reviewed&&row.audioCurrent&&row.listenedCurrent&&(!image||this.value.cutConfirmations.some(c=>c.rowId===row.id&&c.fingerprint===fingerprint)))};}
  async assignCutImage(row,file){this.assertWritable();if(!this.value.assets.some(a=>a.file===file&&/\.(png|jpg|jpeg|webp)$/.test(a.file)))throw new Error('INVALID_CUT_IMAGE');const cutImages=normalizeCutImages([...(this.value.cutImages||[]).filter(c=>c.rowId!==row.id),{rowId:row.id,file}]),cutConfirmations=this.value.cutConfirmations.filter(c=>c.rowId!==row.id);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,cutImages,cutConfirmations},null,2));Object.assign(this.value,{cutImages,cutConfirmations});return this.status();}
  async saveVisuals(input,rows){this.assertWritable();const visuals=normalizeVisuals(input);if(Object.keys(visuals).some(id=>!rows.some(r=>r.id===id)))throw new Error('ROW_NOT_FOUND');const cutConfirmations=this.value.cutConfirmations.filter(c=>JSON.stringify(this.value.visuals?.[c.rowId])===JSON.stringify(visuals[c.rowId]));await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,visuals,cutConfirmations},null,2));Object.assign(this.value,{visuals,cutConfirmations});}
  assertCutsConfirmed(rows){if(!rows.length||rows.some(row=>!this.cutInfo(row).cutConfirmed))throw new Error('CUT_CONFIRMATION_REQUIRED');}
  async confirmCut(row,expected){this.assertWritable();this.assertNoCorrections();if(!this.cutInfo(row).cutFingerprint)throw new Error("CUT_IMAGE_REQUIRED");if(!row.reviewed||!row.audioCurrent)throw new Error('AUDIO_REQUIRED');const fingerprint=this.cutFingerprint(row);if(fingerprint!==expected)throw new Error('STALE_CUT_REVIEW');const cutConfirmations=[...this.value.cutConfirmations.filter(c=>c.rowId!==row.id),{rowId:row.id,fingerprint}];await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,requiresFinalization:true,cutConfirmations},null,2));this.value.requiresFinalization=true;this.value.cutConfirmations=cutConfirmations;}
  async saveReview(input){this.assertWritable();const review=normalizeReview(input);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,review},null,2));this.value.review=review;return this.status();}
  async saveBrief(input){this.assertWritable();const brief=normalizeBrief(input);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,brief},null,2));this.value.brief=brief;return this.status();}
  async addAsset(name,bytes){
    this.assertWritable();
    name=safeText(name,180);if(!name||/[\\/]/.test(name))throw new Error('INVALID_ASSET_NAME');
    const ext=validateAsset(name,bytes);
    const file=createHash('sha256').update(bytes).digest('hex')+'.'+ext;
    if(this.value.assets.some(a=>a.file===file))return this.status();
    if(this.value.assets.length>=100)throw new Error('ASSET_LIMIT');
    await writeFile(path.join(this.dir,'materials',file),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const assets=[...this.value.assets,{name,file,size:bytes.length}];await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,assets},null,2));this.value.assets=assets;return this.status();
  }
  async readAsset(file){if(!/^[a-f0-9]{64}\.(png|jpg|jpeg|webp|mp4|webm|wav|mp3|pdf|txt)$/.test(file))throw new Error('INVALID_ASSET');const root=await realpath(path.join(this.dir,'materials')),target=await realpath(path.join(root,file));if(path.dirname(target)!==root)throw new Error('INVALID_ASSET');return readFile(target);}
}

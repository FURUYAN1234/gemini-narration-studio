import {normalizeExplanation} from './explain-scenes.mjs';
import {createHash} from 'node:crypto';
import {mkdir,readFile,realpath,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';
import {FRESH_BRIEF} from './script-flow.mjs';
import {assertDesignReady,normalizeAutomaticDirection} from './designs.mjs';
export const STUDIO_WATERMARK=Object.freeze({endLabel:'ネームから全自動の自律式統合AI漫画システム',endUrl:'https://note.com/happy_duck780',owner:'FURU'});
import {normalizeMusic,musicSignature,musicTimeline} from './music.mjs';
import {normalizeMotion,normalizeImageFocus} from './motion.mjs';

export function normalizePause(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3)throw new Error('INVALID_CUT_PAUSE');return value;}
export function normalizeReferences(input={text:'',urls:[]}){
 if(!input||Object.keys(input).some(k=>!['text','urls'].includes(k))||!Array.isArray(input.urls)||input.urls.length>10)throw new Error('INVALID_REFERENCES');
 const urls=input.urls.map(raw=>{const value=safeText(raw,2048);let u;try{u=new URL(value);}catch{throw new Error('INVALID_REFERENCE_URL');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!u.hostname.includes('.')||/^(?:[\d.]+|\[.*\])$/.test(u.hostname)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname))throw new Error('INVALID_REFERENCE_URL');
 if([...u.searchParams.keys()].some(k=>/^(?:key|api[_-]?key|token|access_token|signature|auth|password|secret)$/i.test(k)))throw new Error('INVALID_REFERENCE_URL');u.hash='';return u.href;});
 return {text:safeText(input.text,60000),urls:[...new Set(urls)]};
}
export const SCENE_PURPOSES=['context','detail','summary'];
export function normalizeStoryboard(input,script){
 if(!input||input.version!==1||!Array.isArray(input.scenes)||!Array.isArray(input.sources)||input.sources.length>100)throw new Error('INVALID_STORYBOARD');
 const captions=script.split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);
 if(input.scenes.length!==captions.length)throw new Error('STALE_STORYBOARD');
 const sources=input.sources.map(s=>{if(!/^(?:text|asset-\d+|url-\d+)$/.test(s.id)||!['provided','retrieved'].includes(s.status))throw new Error('INVALID_STORYBOARD_SOURCE');return {id:s.id,label:safeText(s.label,2048),status:s.status,summary:safeText(s.summary,1200)};});
 if(new Set(sources.map(s=>s.id)).size!==sources.length)throw new Error('INVALID_STORYBOARD_SOURCE');
 const scenes=input.scenes.map((s,i)=>{if(s.caption!==captions[i])throw new Error('STALE_STORYBOARD');if(!Array.isArray(s.points)||s.points.length>6||!Array.isArray(s.sourceIds)||s.sourceIds.some(id=>!sources.some(v=>v.id===id))||typeof s.imageFile!=='string'||(s.imageFile&&!/^[a-f0-9]{64}\.(png|jpe?g|webp)$/.test(s.imageFile)))throw new Error('INVALID_STORYBOARD');const imagePrompt=safeText(s.imagePrompt||'',3000),imageReferences=s.imageReferences||[];if(imagePrompt&&s.imageFile||!Array.isArray(imageReferences)||imageReferences.length>3||imageReferences.some(f=>!/^[a-f0-9]{64}\.(png|jpe?g|webp)$/.test(f)))throw new Error('INVALID_STORYBOARD_IMAGE');return {caption:s.caption,...(s.explanation!==undefined?{explanation:normalizeExplanation(s.explanation,s.caption)}:{}),...(imagePrompt?{imagePrompt,imageReferences}:{}),...(s.imageReason?{imageReason:safeText(s.imageReason,500)}:{}),title:safeText(s.title,200),points:s.points.map(v=>safeText(v,160)),sourceIds:[...new Set(s.sourceIds)],imageFile:s.imageFile,...(s.imageFocus?{imageFocus:normalizeImageFocus(s.imageFocus)}:{})};});
 const voice=safeText(input.voice,40);if(!/^[A-Za-z]+$/.test(voice))throw new Error('INVALID_STORYBOARD_VOICE');
 if(input.visualStyle!==undefined&&(!safeText(input.visualStyle,400)||typeof input.visualStyle!=='string'))throw new Error('INVALID_DIRECTOR_STYLE');
 for(let i=0;i<scenes.length;i++)if(input.scenes[i].purpose!==undefined){if(!SCENE_PURPOSES.includes(input.scenes[i].purpose))throw new Error('INVALID_DIRECTOR_PURPOSE');scenes[i].purpose=input.scenes[i].purpose;}
 const selected=input.template===undefined?{}:{template:normalizeAutomaticDirection({title:input.title,template:input.template,motion:input.motion}).template};
 return {version:1,...selected,title:safeText(input.title,200),summary:safeText(input.summary,2000),voice,voiceReason:safeText(input.voiceReason,500),motion:input.motion===null?null:normalizeMotion(input.motion),sources,scenes,...(input.visualStyle!==undefined?{visualStyle:safeText(input.visualStyle,400)}:{})};
}
function normalizeCutImages(items=[]){
 if(!Array.isArray(items)||items.length>100)throw new Error('INVALID_CUT_IMAGES');
 const ids=new Set();return items.map(item=>{if(!item||Object.keys(item).some(k=>!['rowId','file'].includes(k))||typeof item.rowId!=='string'||!/^[\w-]{1,100}$/.test(item.rowId)||(item.file!==''&&! /^[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/.test(item.file))||ids.has(item.rowId))throw new Error('INVALID_CUT_IMAGES');ids.add(item.rowId);return {rowId:item.rowId,file:item.file};});
}
export function normalizeVisuals(value){if(value===undefined)return undefined;if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>300)throw new Error('INVALID_CUT_VISUALS');const result={};for(const [id,visual]of Object.entries(value)){if(!/^[\w-]{1,100}$/.test(id)||!visual||Object.keys(visual).some(k=>!['title','points','imageFocus','explanation'].includes(k))||!Array.isArray(visual.points)||visual.points.length>6)throw new Error('INVALID_CUT_VISUALS');result[id]={...(visual.explanation!==undefined?{explanation:normalizeExplanation(visual.explanation)}:{}),title:safeText(visual.title,200),points:visual.points.map(p=>safeText(p,160)),...(visual.imageFocus?{imageFocus:normalizeImageFocus(visual.imageFocus)}:{})};}return result;}

export const MAX_ASSET_BYTES=100*1024*1024;
export function normalizeTitleReading(input){
 if(typeof input?.caption!=='string'||typeof input?.speech!=='string')throw new Error('TITLE_READING_REQUIRED');
 const caption=safeText(input?.caption,200),speech=safeText(input?.speech,4000);
 if(!caption||!isHiraganaReading(speech))throw new Error('TITLE_READING_REQUIRED');
 return {caption,speech};
}
function normalizeReadingCandidate(value){
 return safeText(value,4000).replace(/[\uFF61-\uFF9F]+/gu,part=>part.normalize('NFKC')).normalize('NFD').replace(/[ァ-ヶ]/gu,char=>String.fromCodePoint(char.codePointAt(0)-0x60)).normalize('NFC');
}
export function normalizeDraftTitleReading(input){
 const caption=safeText(input?.caption,200);if(!caption)throw new Error('TITLE_READING_REQUIRED');
 return {caption,speech:normalizeReadingCandidate(input?.speech??'')};
}
export function normalizeDraftScriptReadings(script,readings){
 const captions=safeText(script).split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);
 if(!Array.isArray(readings)||!captions.length||readings.length!==captions.length||readings.length>300)throw new Error('INVALID_SCRIPT_READINGS');
 return readings.map((r,i)=>{const caption=safeText(r?.caption,4000);if(caption!==captions[i])throw new Error('STALE_SCRIPT_READINGS');return {caption,speech:normalizeReadingCandidate(r?.speech??'')};});
}
export function isScriptReadingReady(row){try{normalizeScriptReadings(row.caption,[row]);return true;}catch{return false;}}
export function normalizeDraftRecord(input){
 if(!input||typeof input!=='object')throw new Error('INVALID_DRAFT_RESULT');
 const script=safeText(input.script),readings=normalizeDraftScriptReadings(script,input.readings),warnings=input.warnings||[];
 if(!['ready','needs-review','not-requested'].includes(input.visualPlanStatus)||!Array.isArray(warnings)||warnings.length>100)throw new Error('INVALID_DRAFT_RESULT');
 const record={script,readings,visualPlanStatus:input.visualPlanStatus,warnings:warnings.map(w=>{if(!['visual-plan','reading','title-reading'].includes(w.stage)||! /^[A-Z_]+$/.test(w.code))throw new Error('INVALID_DRAFT_RESULT');return {stage:w.stage,code:w.code};})};
 if(readings.some(r=>!isScriptReadingReady(r))&&!record.warnings.some(w=>w.stage==='reading'))record.warnings.push({stage:'reading',code:'READING_REVIEW_REQUIRED'});
 if(input.titleReading){record.titleReading=normalizeDraftTitleReading(input.titleReading);if(!isHiraganaReading(record.titleReading.speech)&&!record.warnings.some(w=>w.stage==='title-reading'))record.warnings.push({stage:'title-reading',code:'TITLE_READING_REQUIRED'});}
 if(input.storyboard)record.storyboard=normalizeStoryboard(input.storyboard,script);if(input.direction)record.direction=normalizeAutomaticDirection(input.direction);
 if(input.verifiedSources){if(!Array.isArray(input.verifiedSources)||input.verifiedSources.length>100)throw new Error('INVALID_DRAFT_RESULT');record.verifiedSources=input.verifiedSources.map(s=>{if(!/^(text|asset-\d+|url-\d+)$/.test(s.id)||!['retrieved','provided'].includes(s.status))throw new Error('INVALID_DRAFT_RESULT');return {id:s.id,status:s.status,label:safeText(s.label,2048),summary:safeText(s.summary,1200)};});}
 if(input.sourceBindings){if(!Array.isArray(input.sourceBindings)||input.sourceBindings.length!==readings.length)throw new Error('INVALID_DRAFT_RESULT');record.sourceBindings=input.sourceBindings.map((b,i)=>{if(b.lineIndex!==i||b.captionHash!==createHash('sha256').update(readings[i].caption).digest('hex')||!Array.isArray(b.sourceIds)||!b.sourceIds.length||b.sourceIds.some(id=>!record.verifiedSources?.some(s=>s.id===id)))throw new Error('INVALID_DRAFT_RESULT');return {lineIndex:i,captionHash:b.captionHash,sourceIds:[...new Set(b.sourceIds)]};});}
 return record;
}
export function normalizeAuthoring(input){
 if(!input||input.version!==1)throw new Error('INVALID_AUTHORING');safeText(JSON.stringify(input),1900000);const result={version:1};
 if(input.failures!==undefined){if(!Array.isArray(input.failures)||input.failures.length>10)throw new Error('INVALID_AUTHORING');result.failures=input.failures.map(a=>{if(!a||typeof a!=='object'||!/^[a-f0-9-]{36}$/.test(a.id)||!Number.isSafeInteger(a.sequence)||a.sequence<1||!['partial','failed','canceled','interrupted'].includes(a.state)||!a.error||! /^[A-Z_]+$/.test(a.error.code))throw new Error('INVALID_AUTHORING');return {id:a.id,sequence:a.sequence,state:a.state,error:{stage:safeText(a.error.stage,40),code:safeText(a.error.code,100)}};});}
 if(input.lastAttempt){const a=input.lastAttempt;if(!/^[a-f0-9-]{36}$/.test(a.id)||!Number.isSafeInteger(a.sequence)||a.sequence<1||!['compose','rewrite','prepare-readings'].includes(a.operation)||!['running','complete','partial','failed','canceled','interrupted'].includes(a.state)||! /^[a-f0-9]{64}$/.test(a.inputHash))throw new Error('INVALID_AUTHORING');result.lastAttempt={id:a.id,sequence:a.sequence,operation:a.operation,state:a.state,inputHash:a.inputHash,projectId:safeText(a.projectId,64),baseRevision:safeText(a.baseRevision,64),baseProductionRevision:safeText(a.baseProductionRevision,64),request:normalizeBrief(a.request),previousDraft:normalizeBrief(a.previousDraft),...(a.result?{result:normalizeDraftRecord(a.result)}:{}),...(a.error?{error:{stage:safeText(a.error.stage,40),code:safeText(a.error.code,100)}}:{})};}
 if(input.pendingAdoption){const p=input.pendingAdoption;if(!/^[a-f0-9-]{36}$/.test(p.id)||! /^[a-f0-9]{64}$/.test(p.baseRowsHash)||! /^[a-f0-9]{64}$/.test(p.desiredRowsHash)||!Array.isArray(p.rows)||p.rows.length>300)throw new Error('INVALID_AUTHORING');for(const r of p.rows){if(!/^[-\w]{1,64}$/.test(r.id))throw new Error('INVALID_AUTHORING');safeText(r.caption,4000);safeText(r.speech,4000);}result.pendingAdoption=structuredClone(p);}
 if(input.adoptedScriptHash!==undefined){if(! /^[a-f0-9]{64}$/.test(input.adoptedScriptHash))throw new Error('INVALID_AUTHORING');result.adoptedScriptHash=input.adoptedScriptHash;}
 return result;
}
export function normalizeBookends(value){
 if(!value||Object.keys(value).some(k=>!['titleRowId','endLabel','endUrl','owner','creationYear','endSeconds'].includes(k))||!/^[-\w]{1,64}$/.test(value.titleRowId)||!Number.isInteger(value.creationYear)||value.creationYear<1900||value.creationYear>9999||!Number.isFinite(value.endSeconds)||value.endSeconds<2||value.endSeconds>10)throw new Error('INVALID_BOOKENDS');
 const endLabel=safeText(value.endLabel,120),owner=safeText(value.owner,60),endUrl=safeText(value.endUrl,200);
 if(!endLabel||!owner)throw new Error('INVALID_BOOKENDS');
 if(endUrl)normalizeReferences({text:'',urls:[endUrl]});
 return {titleRowId:value.titleRowId,endLabel,endUrl,owner,creationYear:value.creationYear,endSeconds:value.endSeconds};
}
export function normalizeImageProposal(value){
 if(value===undefined)return undefined;
 if(!value||Object.keys(value).some(k=>!['id','revision','productionRevision','scenes'].includes(k))||! /^[a-f0-9-]{36}$/.test(value.id)||![value.revision,value.productionRevision].every(v=>/^[a-f0-9]{64}$/.test(v))||!Array.isArray(value.scenes)||!value.scenes.length||value.scenes.length>300)throw new Error('INVALID_IMAGE_PLAN');
 const ids=new Set(),image=file=>/^[a-f0-9]{64}\.(png|jpe?g|webp)$/.test(file);
 const scenes=value.scenes.map(s=>{if(!s||Object.keys(s).some(k=>!['id','caption','imageFile','imagePrompt','imageReferences','reason','generationPrompt'].includes(k))||!/^[-\w]{1,64}$/.test(s.id)||ids.has(s.id)||s.imageFile&&!image(s.imageFile)||s.imageFile&&s.imagePrompt||!Array.isArray(s.imageReferences)||s.imageReferences.length>3||s.imageReferences.some(f=>!image(f)))throw new Error('INVALID_IMAGE_PLAN');ids.add(s.id);return {id:s.id,caption:safeText(s.caption,4000),imageFile:s.imageFile||'',imagePrompt:safeText(s.imagePrompt||'',3000),imageReferences:[...s.imageReferences],reason:safeText(s.reason||'',500),...(s.generationPrompt?{generationPrompt:safeText(s.generationPrompt,3000)}:{})};});return {id:value.id,revision:value.revision,productionRevision:value.productionRevision,scenes};
}
export function safeText(value,max=20000){
  if(typeof value!=='string'||value.length>max)throw new Error('INVALID_PRODUCTION_TEXT');
  if(/(?:AIza[\w-]{20,}|sk-(?:proj-)?[\w-]{16,}|Bearer\s+[\w.-]{8,})/i.test(value))throw new Error('CREDENTIAL_IN_TEXT');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw new Error('INVALID_PRODUCTION_TEXT');
  return value.trim();
}
export function normalizeBrief(input){
  if(!['existing','ai','mixed'].includes(input?.scriptMode)||!['provided','ai','mixed'].includes(input?.assetMode))throw new Error('INVALID_PRODUCTION_MODE');
  if(input.autoDirection!==undefined&&typeof input.autoDirection!=='boolean')throw new Error('INVALID_AUTOMATIC_DIRECTION');
  const brief={scriptMode:input.scriptMode,assetMode:input.assetMode,instructions:safeText(input.instructions),script:safeText(input.script)};
  if(input.autoDirection!==undefined)brief.autoDirection=input.autoDirection;if(input.direction!==undefined)brief.direction=normalizeAutomaticDirection(input.direction);
  for(const [field,code]of [['themeAuto','INVALID_THEME_PREFERENCE'],['scriptEdited','INVALID_SCRIPT_EDIT_PREFERENCE']])if(input[field]!==undefined){if(typeof input[field]!=='boolean')throw new Error(code);brief[field]=input[field];}
  if(brief.themeAuto&&brief.scriptMode==='ai')brief.instructions='';
  if(input.titleReading!==undefined)brief.titleReading=normalizeDraftTitleReading(input.titleReading);
  if(input.readings!==undefined)brief.readings=normalizeDraftScriptReadings(brief.script,input.readings);
  if(input.references!==undefined)brief.references=normalizeReferences(input.references);
  if(input.storyboard!==undefined)brief.storyboard=normalizeStoryboard(input.storyboard,brief.script);
  if(input.sourceEvidence!==undefined)brief.sourceEvidence=normalizeSourceEvidence(input.sourceEvidence,brief.script);
  for(const field of ['titleMode','voiceMode'])if(input[field]!==undefined){if(!['auto','manual'].includes(input[field]))throw new Error('INVALID_PRODUCTION_MODE');brief[field]=input[field];}
  return brief;
}
export function normalizeSourceEvidence(input,script){
 if(!input||!Array.isArray(input.sources)||input.sources.length>100||!Array.isArray(input.bindings)||input.bindings.length>300)throw new Error('INVALID_STORYBOARD_SOURCE');
 const sources=input.sources.map(s=>{if(!/^(text|asset-\d+|url-\d+)$/.test(s.id)||!['provided','retrieved'].includes(s.status))throw new Error('INVALID_STORYBOARD_SOURCE');return {id:s.id,status:s.status,label:safeText(s.label,2048),summary:safeText(s.summary,1200)};});
 if(new Set(sources.map(s=>s.id)).size!==sources.length)throw new Error('INVALID_STORYBOARD_SOURCE');
 const captions=script.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),seen=new Set();const bindings=input.bindings.filter(b=>{if(!Number.isSafeInteger(b.lineIndex)||b.lineIndex<0||seen.has(b.lineIndex)||! /^[a-f0-9]{64}$/.test(b.captionHash)||!Array.isArray(b.sourceIds)||!b.sourceIds.length||b.sourceIds.some(id=>!sources.some(s=>s.id===id)))throw new Error('INVALID_STORYBOARD_SOURCE');seen.add(b.lineIndex);return captions[b.lineIndex]!==undefined&&createHash('sha256').update(captions[b.lineIndex]).digest('hex')===b.captionHash;}).map(b=>({lineIndex:b.lineIndex,captionHash:b.captionHash,sourceIds:[...new Set(b.sourceIds)]}));
 return {sources,bindings};
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
  constructor(dir){this.dir=path.resolve(dir);this.value={version:1,brief:normalizeBrief(FRESH_BRIEF),pauseSeconds:.8,assets:[],cutConfirmations:[],requiresFinalization:true,finalization:null,watermarkEnabled:true,musicEnabled:true,voiceConfirmation:null};}
  static async open(dir){const p=new ProductionInputs(dir);await mkdir(path.join(p.dir,'materials'),{recursive:true});try{const saved=JSON.parse(await readFile(path.join(p.dir,'production.json'),'utf8'));p.value.brief=normalizeBrief(saved.brief);if(saved.imageProposal)p.value.imageProposal=normalizeImageProposal(saved.imageProposal);if(saved.authoring){p.value.authoring=normalizeAuthoring(saved.authoring);if(p.value.authoring.lastAttempt?.state==='running')p.value.authoring.lastAttempt.state='interrupted';}p.value.review=normalizeReview(saved.review);p.value.cutConfirmations=normalizeCutConfirmations(saved.cutConfirmations);p.value.cutImages=normalizeCutImages(saved.cutImages);if(saved.visuals)p.value.visuals=normalizeVisuals(saved.visuals);if(saved.pauseSeconds!==undefined)p.value.pauseSeconds=normalizePause(saved.pauseSeconds);else delete p.value.pauseSeconds;if(saved.music)p.value.music=normalizeMusic(saved.music);if(saved.bookends)p.value.bookends=normalizeBookends(saved.bookends);if(saved.creationYear!==undefined){if(!Number.isInteger(saved.creationYear)||saved.creationYear<1900||saved.creationYear>9999)throw new Error('INVALID_CREATION_YEAR');p.value.creationYear=saved.creationYear;}if(saved.watermarkEnabled!==undefined){if(typeof saved.watermarkEnabled!=='boolean')throw new Error('INVALID_WATERMARK_PREFERENCE');p.value.watermarkEnabled=saved.watermarkEnabled;}if(saved.musicEnabled===undefined)delete p.value.musicEnabled;else{if(typeof saved.musicEnabled!=='boolean')throw new Error('INVALID_MUSIC_PREFERENCE');p.value.musicEnabled=saved.musicEnabled;}if(saved.voiceConfirmation===undefined)delete p.value.voiceConfirmation;else{if(saved.voiceConfirmation!==null&&!/^[a-f0-9]{64}$/.test(saved.voiceConfirmation))throw new Error('INVALID_VOICE_CONFIRMATION');p.value.voiceConfirmation=saved.voiceConfirmation;}p.value.requiresFinalization=saved.requiresFinalization===true;p.value.finalization=saved.finalization||null;if(p.value.finalization&&(!/^[a-f0-9]{64}$/.test(p.value.finalization.revision)||!/^[a-f0-9]{64}$/.test(p.value.finalization.inputsHash)))throw new Error("INVALID_FINALIZATION");if(!Array.isArray(saved.assets)||saved.assets.length>100)throw new Error('INVALID_ASSETS');for(const a of saved.assets){if(!/^[a-f0-9]{64}\.(png|jpg|jpeg|webp|mp4|webm|wav|mp3|pdf|txt)$/.test(a.file)||!Number.isSafeInteger(a.size)||a.size<1||a.size>MAX_ASSET_BYTES)throw new Error('INVALID_ASSET');safeText(a.name,180);let bytes;try{bytes=await p.readAsset(a.file);}catch{throw new Error('INVALID_ASSET');}if(bytes.length!==a.size||createHash('sha256').update(bytes).digest('hex')!==a.file.split('.')[0])throw new Error('INVALID_ASSET');if(a.origin!==undefined&&!['generated-image','generated-music'].includes(a.origin))throw new Error('INVALID_ASSET');p.value.assets.push({name:a.name,file:a.file,size:a.size,...(a.origin?{origin:a.origin}:{})});}}catch(e){if(e.code!=='ENOENT')throw new Error('SAVED_PRODUCTION_INVALID');}try{p.creationYear=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Tokyo'}).format((await stat(path.join(p.dir,'job.json'))).birthtime));}catch{}return p;}
  status(){return {...structuredClone(this.value),review:normalizeReview(this.value.review)};}
  ending(){return {...this.value.bookends,...STUDIO_WATERMARK,endingEnabled:this.value.watermarkEnabled!==false,creationYear:this.value.creationYear||this.value.bookends?.creationYear||this.creationYear||Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Tokyo'}).format(new Date())),endSeconds:this.value.bookends?.endSeconds||4};}
  async saveImageProposal(value){this.assertWritable();const imageProposal=normalizeImageProposal(value);if(imageProposal)for(const s of imageProposal.scenes)for(const file of [...s.imageReferences,...(s.imageFile?[s.imageFile]:[])])if(!this.value.assets.some(a=>a.file===file))throw new Error('INVALID_CUT_IMAGE');await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,imageProposal},null,2));if(imageProposal)this.value.imageProposal=imageProposal;else delete this.value.imageProposal;}
  assertNoCorrections(){const r=this.status().review;if(r.overall||r.cuts.length)throw new Error('CORRECTIONS_PENDING');}
  assertNoPendingImages(current){if(this.value.imageProposal?.scenes.some(s=>current.rows.some(r=>r.id===s.id&&r.caption===s.caption)))throw new Error('IMAGE_APPROVAL_REQUIRED');}
  assertWritable(){if(this.value.finalization)throw new Error('VIDEO_FINALIZED');}
  finalInputsHash(){return createHash('sha256').update(JSON.stringify({brief:this.value.brief,assets:this.value.assets,review:normalizeReview(this.value.review),cutConfirmations:this.value.cutConfirmations,...(this.value.cutImages?.length?{cutImages:this.value.cutImages}:{}),...(this.value.visuals?{visuals:this.value.visuals}:{}),...(this.value.music?{music:this.value.music}:{}),...(this.value.watermarkEnabled===false?{watermarkEnabled:false}:{}),...(this.value.musicEnabled!==undefined?{musicEnabled:this.value.musicEnabled}:{}),...(this.value.bookends?{bookends:this.value.bookends}:{}),...(this.value.creationYear!==undefined?{creationYear:this.value.creationYear}:{}),...(this.value.pauseSeconds!==undefined?{pauseSeconds:this.value.pauseSeconds}:{})})).digest('hex');}
  assertFinalization(current){this.assertNoPendingImages(current);this.assertBookends(current);if(!this.value.requiresFinalization&&!this.value.finalization)return;if(!this.value.finalization)throw new Error('FINAL_CONFIRMATION_REQUIRED');if(this.value.finalization.revision!==current.revision||this.value.finalization.inputsHash!==this.finalInputsHash())throw new Error('FINALIZED_CONTENT_CHANGED');}
  assertBookends(current){const b=this.value.bookends;if(b&&current.rows[0]?.id!==b.titleRowId)throw new Error('STALE_BOOKENDS');}
  async saveWatermarkEnabled(enabled){this.assertWritable();if(typeof enabled!=='boolean')throw new Error('INVALID_WATERMARK_PREFERENCE');await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,watermarkEnabled:enabled},null,2));this.value.watermarkEnabled=enabled;}
  async saveBookends(input){this.assertWritable();const bookends=normalizeBookends(input);if(this.value.bookends&&bookends.creationYear!==this.value.bookends.creationYear)throw new Error('INVALID_CREATION_YEAR');await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,bookends},null,2));this.value.bookends=bookends;}
  async finalize(current){this.assertWritable();this.assertNoPendingImages(current);this.assertBookends(current);this.assertMusicCurrent(current);this.assertNoCorrections();this.assertCutsConfirmed(current.rows);assertDesignReady(current.presentation);const finalization={revision:current.revision,inputsHash:this.finalInputsHash()};await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,requiresFinalization:true,finalization},null,2));this.value.requiresFinalization=true;this.value.finalization=finalization;}
  effectiveMusic(){return this.value.musicEnabled===false?undefined:this.value.music;}
  async saveVoiceConfirmation(fingerprint){this.assertWritable();if(fingerprint!==null&&!/^[a-f0-9]{64}$/.test(fingerprint))throw new Error('INVALID_VOICE_CONFIRMATION');await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,voiceConfirmation:fingerprint},null,2));this.value.voiceConfirmation=fingerprint;}
  async saveMusicEnabled(enabled){this.assertWritable();if(typeof enabled!=='boolean')throw new Error('INVALID_MUSIC_PREFERENCE');await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,musicEnabled:enabled},null,2));this.value.musicEnabled=enabled;}
  assertMusicCurrent(current){if(this.value.musicEnabled===true&&!this.value.music)throw new Error('MUSIC_REQUIRED');if(this.effectiveMusic()){musicTimeline(current);if(this.value.music.signature!==musicSignature(current)||!this.value.assets.some(a=>a.file===this.value.music.file))throw new Error('STALE_MUSIC');}}
  async savePause(value){this.assertWritable();const pauseSeconds=normalizePause(value);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,pauseSeconds},null,2));this.value.pauseSeconds=pauseSeconds;}
  async saveMusic(input){this.assertWritable();const music=normalizeMusic(input);if(music&&!this.value.assets.some(a=>a.file===music.file))throw new Error('INVALID_MUSIC');const next={...this.value};if(music)next.music=music;else delete next.music;await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify(next,null,2));this.value=next;}
  imagePlan(row){const scenes=this.value.brief.storyboard?.scenes||[];return scenes.find(s=>s.caption===row.caption&&s.imagePrompt)||null;}
  async reopenCut(rowId){this.assertWritable();const cutConfirmations=this.value.cutConfirmations.filter(c=>c.rowId!==rowId);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,cutConfirmations},null,2));this.value.cutConfirmations=cutConfirmations;}
  cutImage(row){const mapping=(this.value.cutImages||[]).find(c=>c.rowId===row.id);if(mapping){if(mapping.file==='')return null;const asset=this.value.assets.find(a=>a.file===mapping.file);if(!asset||! /\.(png|jpg|jpeg|webp)$/.test(asset.file))throw new Error('INVALID_CUT_IMAGE');return asset;}const images=this.value.assets.filter(a=>a.name==='cut-'+row.id+'.png');if(images.length>1)throw new Error('CUT_IMAGE_AMBIGUOUS');return images[0]||null;}
  imageRequired(row){if(this.value.bookends?.titleRowId===row?.id)return false;if(this.value.finalization)return false;const scenes=(this.value.brief.storyboard?.scenes||[]).filter(s=>s.caption===row?.caption);if(scenes.length)return scenes.some(s=>s.imageFile||s.imagePrompt);return this.value.brief.assetMode==='ai'||this.value.assets.some(a=>/\.(png|jpg|jpeg|webp)$/.test(a.file));}
  cutFingerprint(row){const image=this.cutImage(row);return createHash('sha256').update(JSON.stringify({id:row.id,scene:row.scene,caption:row.caption,speech:row.speech,audio:row.audio,image:image?.file||null,...(this.value.visuals?.[row.id]?{visual:this.value.visuals[row.id]}:{})})).digest('hex');}
  cutInfo(row){let fingerprint,image;try{image=this.cutImage(row);fingerprint=this.cutFingerprint(row);}catch{return {cutConfirmed:false,cutFingerprint:null,cutImage:null};}if(!image&&this.imageRequired(row))return {cutConfirmed:false,cutFingerprint:null,cutImage:null};return {cutImage:image,cutVisual:this.value.visuals?.[row.id],cutFingerprint:fingerprint,cutConfirmed:!!(!this.value.imageProposal?.scenes.some(s=>s.id===row.id&&s.caption===row.caption)&&row.reviewed&&row.audioCurrent&&row.listenedCurrent&&(!image||this.value.cutConfirmations.some(c=>c.rowId===row.id&&c.fingerprint===fingerprint)))};}
  async assignCutImage(row,file){this.assertWritable();if(this.value.bookends?.titleRowId===row.id)throw new Error('TITLE_IMAGE_NOT_ALLOWED');if(file!==''&&!this.value.assets.some(a=>a.file===file&&/\.(png|jpg|jpeg|webp)$/.test(a.file)))throw new Error('INVALID_CUT_IMAGE');const cutImages=normalizeCutImages([...(this.value.cutImages||[]).filter(c=>c.rowId!==row.id),{rowId:row.id,file}]),cutConfirmations=this.value.cutConfirmations.filter(c=>c.rowId!==row.id);const visuals=structuredClone(this.value.visuals);if(visuals?.[row.id]&&this.cutImage(row)?.file!==file)delete visuals[row.id].imageFocus;await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,cutImages,cutConfirmations,...(visuals?{visuals}:{})},null,2));Object.assign(this.value,{cutImages,cutConfirmations,...(visuals?{visuals}:{})});return this.status();}
  async applyImageChoices(choices,rows){
    this.assertWritable();const ids=new Set(),cutImages=[...(this.value.cutImages||[])],visuals=structuredClone(this.value.visuals);
    for(const choice of choices){const row=rows.find(r=>r.id===choice.id);if(!row||ids.has(choice.id)||this.value.bookends?.titleRowId===row.id)throw new Error('INVALID_IMAGE_PLAN');ids.add(row.id);if(choice.imageFile!==''&&!this.value.assets.some(a=>a.file===choice.imageFile&&/\.(png|jpe?g|webp)$/.test(a.file)))throw new Error('INVALID_CUT_IMAGE');const index=cutImages.findIndex(c=>c.rowId===row.id);if(index>=0)cutImages.splice(index,1);cutImages.push({rowId:row.id,file:choice.imageFile});if(visuals?.[row.id]&&this.cutImage(row)?.file!==choice.imageFile)delete visuals[row.id].imageFocus;}
    const next={...this.value,cutImages:normalizeCutImages(cutImages),cutConfirmations:this.value.cutConfirmations.filter(c=>!ids.has(c.rowId)),...(visuals?{visuals}:{})};await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify(next,null,2));this.value=next;
  }
  async removeAsset(file,rows){
    this.assertWritable();if(!this.value.assets.some(a=>a.file===file))throw new Error('ASSET_NOT_FOUND');if(this.value.music?.file===file)throw new Error('ASSET_IN_USE');
    const affected=rows.filter(r=>this.cutImage(r)?.file===file).map(r=>r.id),brief=structuredClone(this.value.brief);if(brief.storyboard)for(const scene of brief.storyboard.scenes){if(scene.imageFile===file)scene.imageFile='';if(scene.imageReferences)scene.imageReferences=scene.imageReferences.filter(f=>f!==file);}
    const next={...this.value,brief,assets:this.value.assets.filter(a=>a.file!==file),cutImages:[...(this.value.cutImages||[]).filter(c=>!affected.includes(c.rowId)),...affected.map(rowId=>({rowId,file:''}))],cutConfirmations:this.value.cutConfirmations.filter(c=>!affected.includes(c.rowId))};await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify(next,null,2));this.value=next;return this.status();
  }
  async saveVisuals(input,rows){this.assertWritable();const visuals=normalizeVisuals(input);if(Object.keys(visuals).some(id=>!rows.some(r=>r.id===id)))throw new Error('ROW_NOT_FOUND');for(const [id,v]of Object.entries(visuals))if(v.explanation)normalizeExplanation(v.explanation,rows.find(r=>r.id===id).caption);const cutConfirmations=this.value.cutConfirmations.filter(c=>JSON.stringify(this.value.visuals?.[c.rowId])===JSON.stringify(visuals[c.rowId]));await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,visuals,cutConfirmations},null,2));Object.assign(this.value,{visuals,cutConfirmations});}
  assertCutsConfirmed(rows){if(!rows.length||rows.some(row=>!this.cutInfo(row).cutConfirmed))throw new Error('CUT_CONFIRMATION_REQUIRED');}
  async confirmCut(row,expected){this.assertWritable();this.assertNoPendingImages({rows:[row]});this.assertNoCorrections();if(!this.cutInfo(row).cutFingerprint)throw new Error("CUT_IMAGE_REQUIRED");if(!row.reviewed||!row.audioCurrent)throw new Error('AUDIO_REQUIRED');const fingerprint=this.cutFingerprint(row);if(fingerprint!==expected)throw new Error('STALE_CUT_REVIEW');const cutConfirmations=[...this.value.cutConfirmations.filter(c=>c.rowId!==row.id),{rowId:row.id,fingerprint}];await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,requiresFinalization:true,cutConfirmations},null,2));this.value.requiresFinalization=true;this.value.cutConfirmations=cutConfirmations;}
  async saveReview(input){this.assertWritable();const review=normalizeReview(input);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,review},null,2));this.value.review=review;return this.status();}
  async saveAuthoring(input,briefInput){this.assertWritable();const authoring=normalizeAuthoring(input),brief=briefInput===undefined?this.value.brief:normalizeBrief(briefInput);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,authoring,brief},null,2));this.value.authoring=authoring;this.value.brief=brief;return this.status();}
  async saveBrief(input){this.assertWritable();const brief=normalizeBrief(input);await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,brief},null,2));this.value.brief=brief;return this.status();}
  async applyStoryboard(plan,rows){
    this.assertWritable();plan=normalizeStoryboard(plan,rows.map(r=>r.caption).join('\n'));
    const ids=new Set(rows.map(r=>r.id)),visuals={...this.value.visuals},cutImages=(this.value.cutImages||[]).filter(c=>!ids.has(c.rowId));
    for(const [i,scene]of plan.scenes.entries()){const row=rows[i];visuals[row.id]={...(scene.explanation?{explanation:normalizeExplanation(scene.explanation,row.caption)}:{}),title:scene.title,points:scene.points,...(scene.imageFocus?{imageFocus:scene.imageFocus}:{})};if(scene.imageFile){if(!this.value.assets.some(a=>a.file===scene.imageFile))throw new Error('INVALID_CUT_IMAGE');cutImages.push({rowId:row.id,file:scene.imageFile});}}
    normalizeVisuals(visuals);normalizeCutImages(cutImages);const cutConfirmations=this.value.cutConfirmations.filter(c=>!ids.has(c.rowId)||(JSON.stringify(this.value.visuals?.[c.rowId])===JSON.stringify(visuals[c.rowId])&&this.value.cutImages?.find(v=>v.rowId===c.rowId)?.file===cutImages.find(v=>v.rowId===c.rowId)?.file));const next={...this.value,visuals,cutImages,cutConfirmations};await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify(next,null,2));this.value=next;
  }
  async addAsset(name,bytes,{origin}={}){
    this.assertWritable();
    if(origin!==undefined&&!['generated-image','generated-music'].includes(origin))throw new Error('INVALID_ASSET');
    name=safeText(name,180);if(!name||/[\\/]/.test(name))throw new Error('INVALID_ASSET_NAME');
    const ext=validateAsset(name,bytes);
    const file=createHash('sha256').update(bytes).digest('hex')+'.'+ext;
    if(this.value.assets.some(a=>a.file===file))return this.status();
    if(this.value.assets.length>=100)throw new Error('ASSET_LIMIT');
    await writeFile(path.join(this.dir,'materials',file),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const assets=[...this.value.assets,{name,file,size:bytes.length,...(origin?{origin}:{})}];await atomicWrite(path.join(this.dir,'production.json'),JSON.stringify({...this.value,assets},null,2));this.value.assets=assets;return this.status();
  }
  async readAsset(file){if(!/^[a-f0-9]{64}\.(png|jpg|jpeg|webp|mp4|webm|wav|mp3|pdf|txt)$/.test(file))throw new Error('INVALID_ASSET');const root=await realpath(path.join(this.dir,'materials')),target=await realpath(path.join(root,file));if(path.dirname(target)!==root)throw new Error('INVALID_ASSET');return readFile(target);}
}

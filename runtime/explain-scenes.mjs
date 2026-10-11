// Declarative, caption-bound visuals. No generated code, URLs or inferred numbers.
export const EXPLANATION_TYPES=['comparison','steps','stat','bar'];
const string={type:'string'};
export const EXPLANATION_SCHEMA={type:'object',additionalProperties:false,required:['type','items','unit'],properties:{type:{type:'string',enum:EXPLANATION_TYPES},unit:string,items:{type:'array',minItems:1,maxItems:6,items:{type:'object',additionalProperties:false,required:['label','value','quote'],properties:{label:string,value:string,quote:string}}}}};
export const EXPLANATION_INSTRUCTION='各カットは内容に合う場合だけexplanationを付ける。typeはcomparison（対比2項目）、steps（順序のある手順2〜4項目）、stat（重要な数値1項目）、bar（同じ単位の数値2〜6項目）。itemsはlabel,value,quote。labelとvalueはそのカットのcaptionから文字を変えずに抜き出し、quoteは両方を含む連続した原文をそのまま写す。stepsのvalueは空文字。unitはbarだけ全項目共通の単位を原文から写し、それ以外は空文字。barのvalueは半角の非負数だけ（カンマは可）、quoteにはlabelとvalueとunitが必要。推測、換算、架空の数値、独自の目標値を足さない。比較や手順の関係が原文にない場合は作らない。単なる情景や物語にはexplanationを付けず画像を活かす。比較・手順・統計を説明する動画では適切な図解を積極的に選び、同じ見せ方ばかりにしない。';
const fail=(reason='SHAPE')=>{const error=new Error('INVALID_EXPLANATION');error.explanationReason=reason;throw error;};
function text(value,max){if(typeof value!=='string'||value.length>max||/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))fail();return value;}
export function normalizeExplanation(input,caption){
 if(input===undefined)return undefined;
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['type','items','unit'].includes(k))||!EXPLANATION_TYPES.includes(input.type)||!Array.isArray(input.items))fail();
 const limits={comparison:[2,2],steps:[2,4],stat:[1,1],bar:[2,6]},[min,max]=limits[input.type];
 if(input.items.length<min||input.items.length>max)fail('ITEM_COUNT');
 const unit=text(input.unit,16);if(input.type!=='bar'&&unit)fail('UNEXPECTED_UNIT');
 const items=input.items.map(item=>{
  if(!item||Object.keys(item).some(k=>!['label','value','quote'].includes(k)))fail();
  const label=text(item.label,64),value=text(item.value,80),quote=text(item.quote,600);
  if(!label.trim()||!quote.trim())fail('EMPTY_TEXT');
  if(!quote.includes(label))fail('LABEL_NOT_IN_QUOTE');
  if(value&&!quote.includes(value))fail('VALUE_NOT_IN_QUOTE');
  if(input.type==='steps'?!!value:!value.trim())fail('VALUE_REQUIRED_OR_FORBIDDEN');
  if(caption!==undefined&&(typeof caption!=='string'||!caption.includes(quote)))fail('QUOTE_NOT_IN_CAPTION');
  if(input.type==='bar'&&(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value.replaceAll(',','')))))fail('INVALID_BAR_NUMBER');
  if(input.type==='bar'&&(!unit.trim()||!quote.includes(value+unit)))fail('UNIT_NOT_IN_QUOTE');
  return {label,value,quote};
 });
 if(new Set(items.map(i=>i.label)).size!==items.length)fail('DUPLICATE_LABEL');
 if(input.type==='bar'&&items.every(i=>Number(i.value.replaceAll(',',''))===0))fail('ZERO_SCALE');
 return {type:input.type,unit,items};
}
// Diagnostic metadata contains no provider text, credentials or material values.
export function explanationDiagnostics(rows){
 return (Array.isArray(rows)?rows:[]).map((row,index)=>{
  if(row?.explanation===undefined)return {row:index,present:false};
  try{normalizeExplanation(row.explanation,row.caption);return {row:index,present:true,type:row.explanation.type,valid:true};}
  catch(error){return {row:index,present:true,type:EXPLANATION_TYPES.includes(row.explanation?.type)?row.explanation.type:'unknown',valid:false,reason:error.explanationReason||'SHAPE'};}
 });
}
// Resolve against the current caption again at render time: a stale saved scene
// must never silently reuse a chart after the narration has changed.
export function resolveExplanation(row,mode){return mode==='auto'&&row.explanation?normalizeExplanation(row.explanation,row.caption):undefined;}
export function explanationSchedule(row,explanation){
 if(!Number.isInteger(row.frames)||row.frames<1)throw new Error('INVALID_EXPLANATION_TIMING');
 const cues=row.subtitles||[],caption=row.caption||'';
 return explanation.items.map(item=>{
  const quoteStart=caption.indexOf(item.quote),labelOffset=item.quote.indexOf(item.label);if(quoteStart<0||labelOffset<0)fail();
  const index=quoteStart+labelOffset;
  let offset=0;
  for(const cue of cues){const start=caption.indexOf(cue.text,offset);if(start>=0){offset=start+cue.text.length;if(index>=start&&index<offset){const within=(index-start)/cue.text.length;return Math.max(0,Math.min(row.frames-1,Math.round(cue.from+(cue.to-cue.from)*within)));}}}
  return Math.max(0,Math.min(row.frames-1,Math.round(row.frames*.85*index/Math.max(1,caption.length))));
 });
}

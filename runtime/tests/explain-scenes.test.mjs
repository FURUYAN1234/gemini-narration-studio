import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExplanation,resolveExplanation,explanationSchedule,explanationDiagnostics} from '../explain-scenes.mjs';
import {normalizePresentation} from '../designs.mjs';
import {FRESH_PRESENTATION} from '../script-flow.mjs';
import {collectSources,buildSourcePlanRequest,normalizeSourcePlan} from '../source-plan.mjs';
import {ProductionInputs} from '../production.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const caption='記録では、準備は12分、確認は8分、共有は4分でした。';
const chart={type:'bar',unit:'分',items:[{label:'準備',value:'12',quote:'準備は12分'},{label:'確認',value:'8',quote:'確認は8分'},{label:'共有',value:'4',quote:'共有は4分'}]};
test('new productions enable caption-bound explanation scenes; legacy and explicit off stay unchanged',()=>{
 assert.equal(FRESH_PRESENTATION.explainScenes,'auto');assert.equal(normalizePresentation(FRESH_PRESENTATION).explainScenes,'auto');
 assert.deepEqual(normalizePresentation({theme:'moon'}),{theme:'moon'});
 assert.equal(normalizePresentation({...FRESH_PRESENTATION,explainScenes:'off'}).explainScenes,'off');
 assert.throws(()=>normalizePresentation({...FRESH_PRESENTATION,explainScenes:'script'}));
 assert.equal(resolveExplanation({caption,explanation:chart},'off'),undefined);
 assert.deepEqual(resolveExplanation({caption,explanation:chart},'auto'),chart);
});
test('graphs accept actual positive and zero data, reject invented values, changed captions, mixed units and executable input',()=>{
 assert.deepEqual(normalizeExplanation(chart,caption),chart);
 for(const mutate of [c=>c.items[0].value='99',c=>c.items[0].quote='準備は99分',c=>c.items[0].value='-1',c=>c.items[0].label='<script>',c=>c.unit='時間',c=>c.url='https://example.com',c=>c.items.push(c.items[0])]){const c=structuredClone(chart);mutate(c);assert.throws(()=>normalizeExplanation(c,caption),/INVALID_EXPLANATION/);}
 assert.throws(()=>resolveExplanation({caption:'別の説明です。',explanation:chart},'auto'),/INVALID_EXPLANATION/);
 const zero={...chart,items:[{label:'準備',value:'0',quote:'準備は0分'},chart.items[1]]};assert.equal(normalizeExplanation(zero,'準備は0分、確認は8分').items[0].value,'0');
});
test('comparisons, steps and stats retain exact caption values; unstructured narration needs no scene',()=>{
 for(const [type,items,text] of [
  ['comparison',[{label:'朝',value:'静か',quote:'朝は静か'},{label:'夜',value:'にぎやか',quote:'夜はにぎやか'}],'朝は静か、夜はにぎやかです。'],
  ['steps',[{label:'洗う',value:'',quote:'洗う'},{label:'乾かす',value:'',quote:'乾かす'}],'洗う、そのあと乾かす。'],
  ['stat',[{label:'参加者',value:'25人',quote:'参加者は25人'}],'参加者は25人です。']])assert.equal(normalizeExplanation({type,unit:'',items},text).type,type);
 assert.equal(resolveExplanation({caption:'夕暮れの空を眺めます。'},'auto'),undefined);
 const shared='朝は静か、夜はにぎやかです。';assert.equal(normalizeExplanation({type:'comparison',unit:'',items:[{label:'朝',value:'静か',quote:shared},{label:'夜',value:'にぎやか',quote:shared}]},shared).items.length,2);
});
test('diagnostics record the failing boundary without echoing any provider text',()=>{
 const bad={...chart,items:[{label:'機密の見出し',value:'12',quote:'秘匿する応答'}]};
 const result=explanationDiagnostics([{caption:'秘匿する入力',explanation:bad},{caption,explanation:chart}]);
 assert.equal(result[0].reason,'ITEM_COUNT');assert.equal(result[1].valid,true);assert.doesNotMatch(JSON.stringify(result),/機密|秘匿|準備/);
});
test('reveals follow actual subtitle cue frames, falling back to caption position only when cues are absent',()=>{
 const row={caption,frames:300,subtitles:[{text:'記録では、準備は12分、',from:0,to:90},{text:'確認は8分、',from:90,to:180},{text:'共有は4分でした。',from:180,to:300}]};
 assert.deepEqual(explanationSchedule(row,chart),[38,90,180]);
 const times=explanationSchedule({...row,subtitles:[]},chart);assert.ok(times[0]<times[1]&&times[1]<times[2]&&times[2]<300);
});
test('items inside one subtitle cue reveal in narration order and shared quotations use each label',()=>{
 const text='洗う、乾かす、しまう。',e={type:'steps',unit:'',items:['洗う','乾かす','しまう'].map(label=>({label,value:'',quote:text}))};
 const times=explanationSchedule({caption:text,frames:140,subtitles:[{text,from:10,to:120}]},e);
 assert.deepEqual(times,[10,40,80]);
 const split={caption:'洗う。乾かす。',frames:100,subtitles:[{text:'洗う。',from:0,to:40},{text:'乾かす。',from:40,to:100}]};
 assert.deepEqual(explanationSchedule(split,{...e,items:[{label:'洗う',value:'',quote:'洗う。'},{label:'乾かす',value:'',quote:'乾かす。'}]}),[0,40]);
});
test('source-plan schema, validated storyboard, persisted cut visuals and renderer share the same chart; unsupported figures stay needs-review',async()=>{
 const brief={scriptMode:'ai',assetMode:'provided',instructions:'記録の説明',script:'',references:{text:caption,urls:[]},autoDirection:true};
 const bundle=await collectSources(brief,[],()=>{}),request=buildSourcePlanRequest({brief,bundle,voices:['Kore']});
 assert.ok(request.generationConfig.responseFormat.text.schema.properties.rows.items.properties.explanation);
 const result={title:'時間の記録',summary:caption,voice:'Kore',voiceReason:'明瞭',template:'blueprint',motion:{version:1,style:'editorial',intensity:'standard'},visualStyle:'青い図解',sources:[{id:'text',summary:caption}],rows:[{caption,speech:'きろくでは、じゅんびはじゅうにふん、かくにんははっぷん、きょうゆうはよんぷんでした。',title:'時間の内訳',points:[],imageFile:'',sourceIds:['text'],purpose:'detail',explanation:chart}]};
 const draft=normalizeSourcePlan(result,bundle,['Kore']);assert.equal(draft.visualPlanStatus,'ready');assert.deepEqual(draft.storyboard.scenes[0].explanation,chart);
 const dir=await mkdtemp(path.join(tmpdir(),'narration-explain-'));
 try{const p=await ProductionInputs.open(dir),rows=[{id:'cut1',caption}];await p.applyStoryboard(draft.storyboard,rows);const reopened=await ProductionInputs.open(dir);assert.deepEqual(reopened.status().visuals.cut1.explanation,chart);assert.deepEqual(resolveExplanation({...rows[0],...reopened.status().visuals.cut1},'auto'),chart);
 await assert.rejects(p.saveVisuals({cut1:{title:'別の数字',points:[],explanation:{...chart,items:[{...chart.items[0],quote:'準備は99分',value:'99'},...chart.items.slice(1)]}}},rows),/INVALID_EXPLANATION/);
 }finally{await rm(dir,{recursive:true,force:true});}
 const bad=structuredClone(result);bad.rows[0].explanation.items[0].value='99';const rejected=normalizeSourcePlan(bad,bundle,['Kore']);assert.equal(rejected.visualPlanStatus,'needs-review');assert.equal(rejected.storyboard,undefined);assert.equal(rejected.warnings[0].code,'INVALID_EXPLANATION');
});

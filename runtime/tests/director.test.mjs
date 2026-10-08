import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSources,buildSourcePlanRequest,normalizeSourcePlan} from '../source-plan.mjs';
import {normalizeStoryboard} from '../production.mjs';
const brief={scriptMode:'ai',assetMode:'mixed',instructions:'しくみを説明する',script:'',references:{text:'装置の入口から水が入り、出口から出ます。',urls:[]}};
const result={title:'装置のしくみ',summary:'水の流れ',voice:'Kore',voiceReason:'説明に合う',motion:{version:1,style:'editorial',intensity:'subtle'},visualStyle:'同じ青い装置、白い背景、赤い流れの矢印',sources:[{id:'text',summary:'入口と出口のある装置'}],rows:[{caption:'水は入口から入ります。',speech:'みずはいりぐちからはいります。',title:'水の入口',points:['入口から水が入る'],imageFile:'',imagePrompt:'装置の入口を見せる図',imageReferences:[],sourceIds:['text'],purpose:'detail'}]};
test('normal source planning enforces a shared visual style and typed shot purpose through the stored storyboard',async()=>{
 const bundle=await collectSources(brief,[],()=>{}),request=buildSourcePlanRequest({brief,bundle,voices:['Kore']});
 assert.ok(request.generationConfig.responseFormat.text.schema.required.includes('visualStyle'));
 assert.deepEqual(request.generationConfig.responseFormat.text.schema.properties.rows.items.properties.purpose.enum,['context','detail','summary']);
 const plan=normalizeSourcePlan(result,bundle,['Kore']);
 assert.equal(plan.storyboard.visualStyle,result.visualStyle);assert.equal(plan.storyboard.scenes[0].purpose,'detail');
 assert.ok(plan.storyboard.scenes[0].imagePrompt.includes(result.visualStyle));
 assert.deepEqual(normalizeStoryboard(plan.storyboard,plan.script),plan.storyboard);
});
test('director output fails closed for missing style/purpose, executable fields and oversized generated prompts',async()=>{
 const bundle=await collectSources(brief,[],()=>{});
 for(const edit of [r=>delete r.visualStyle,r=>delete r.rows[0].purpose,r=>r.rows[0].purpose='run-shell',r=>r.visualStyle={script:'run'},r=>r.visualStyle='x'.repeat(401),r=>r.rows[0].imagePrompt='x'.repeat(3000)]){
  const changed=structuredClone(result);edit(changed);const draft=normalizeSourcePlan(changed,bundle,['Kore']);assert.equal(draft.storyboard,undefined);assert.equal(draft.visualPlanStatus,'needs-review');assert.equal(draft.script,result.rows[0].caption);
 }
 const legacy=structuredClone(normalizeSourcePlan(result,bundle,['Kore']).storyboard);delete legacy.visualStyle;delete legacy.scenes[0].purpose;
 assert.doesNotThrow(()=>normalizeStoryboard(legacy,result.rows[0].caption));
});

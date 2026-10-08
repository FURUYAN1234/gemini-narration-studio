import test from 'node:test';
import {scriptActionState,parseScriptParts,FRESH_BRIEF} from '../script-flow.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {VOICE_GENDERS,VOICES,MODELS,SAMPLE_SETTINGS} from '../core.mjs';
import {VIDEO_TEMPLATES,presentationDesign} from '../designs.mjs';
import {themeTokens} from '../themes.mjs';

const appSource = (await readFile(new URL('../ui/app.mjs', import.meta.url), 'utf8')).replace(/^import .*script-flow\.mjs';\r?\n/m,'');
const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

test('actions have button semantics and secondary actions keep a visible button boundary',async()=>{
 const css=await readFile(new URL('../ui/style.css',import.meta.url),'utf8');
 assert.doesNotMatch(html,/<a\b[^>]*data-go-step=/);
 for(const step of ['planning','connection','reading','finish'])assert.match(html,new RegExp('<button[^>]*data-go-step="'+step+'"'));
 const quiet=css.match(/button\.quiet\{([^}]+)\}/)?.[1]||'';assert.match(quiet,/border-color:var\(--(?:muted|border)\)/);assert.match(quiet,/background:var\(--panel\)/);
});
test('user requirements: preview colors match saved legacy colors and the adopted renderer template',async()=>{
 const ui=await setup();ui.get('auto-direction').checked=false;await ui.get('auto-direction').emit('change');
 const theme=await themeTokens(ui.state().presentation.theme);assert.equal(ui.get('direction-sample').style.vars.get('--d-bg'),theme.background);
 await ui.get('template-gallery').children.find(b=>b.dataset.template==='blueprint').emit('click');await ui.get('apply-direction').emit('click');
 const design=presentationDesign(ui.state().presentation);for(const [key,value]of [['bg',design.background],['fg',design.foreground],['heading',design.heading],['accent',design.accent]])assert.equal(ui.get('direction-sample').style.vars.get('--d-'+key),value);
});
test('user requirements: prepared images and adoption/regeneration are together in each cut, with no prose-only proposal list',async()=>{
 const file='a'.repeat(64)+'.png',imageProposal={id:'proposal',scenes:[{id:'one',caption:'説明。',imageFile:file,imagePrompt:'',reason:'対応する画像'}]};
 const ui=await setup({rows:[{id:'one',caption:'説明。',speech:'せつめい。',cutImage:null}],assets:[{name:'候補.png',file,size:4}],imageProposal});
 const card=[...ui.get('rows').walk()].find(e=>e.dataset.rowId==='one');assert.ok([...card.walk()].some(e=>e.tagName==='img'&&e.attributes.src==='/materials/'+file));
 const adopt=[...card.walk()].find(e=>e.attributes['data-adopt-image']==='one'),regenerate=[...card.walk()].find(e=>e.attributes['data-generate-image']==='one');assert.ok(adopt);assert.ok(regenerate);
 assert.equal(ui.get('image-proposal').children.length,0);assert.match(ui.get('approve-images').textContent,/APIなし/);
 await adopt.emit('click');assert.equal(ui.requests.filter(r=>r.route==='approve-images').length,1);assert.equal(ui.requests.find(r=>r.route==='approve-images').input.id,'one');assert.equal(ui.requests.some(r=>['prepare-images','generate-image','regenerate-image'].includes(r.route)),false);
});
test('user requirements: automatic theme disables manual instructions and excludes retained text from submission',async()=>{
 const ui=await setup({rows:[]});await ui.edit(ui.get('production-instructions'),'以前の手入力テーマ');
 ui.get('theme-auto').checked=true;await ui.get('theme-auto').emit('change');assert.equal(ui.get('production-instructions').disabled,true);
 await ui.get('generate-script').emit('click');assert.equal(ui.requests.find(r=>r.route==='draft').input.brief.instructions,'');
 ui.get('theme-auto').checked=false;await ui.get('theme-auto').emit('change');assert.equal(ui.get('production-instructions').disabled,false);
});
test('user requirements: ordinary UI contains no material diagnosis or ending-credit inputs',()=>{
 assert.doesNotMatch(html,/素材送信の診断|id="diagnose-sources"|id="ending-(?:label|url|owner|seconds)"/);
 assert.match(html,/id="opening-speech"/);
});
test('user requirements: source context is below the editable result, with no duplicate scene script',async()=>{
 assert.ok(html.indexOf('id="storyboard-preview"')>html.indexOf('id="script-input"'));
 const sourcePlan={script:'新しい説明です。',readings:[{caption:'新しい説明です。',speech:'あたらしいせつめいです。'}],storyboard:{title:'新しい説明',summary:'資料の構成',voice:'Puck',voiceReason:'明るい声',sources:[{id:'text',label:'本文',status:'provided',summary:'参考資料'}],scenes:[{caption:'新しい説明です。',title:'説明',points:['要点'],imageFile:'',sourceIds:['text']}]}};
 const ui=await setup({rows:[],sourcePlan});await ui.edit(ui.get('source-text'),'資料本文');await ui.edit(ui.get('production-instructions'),'説明を作る');await ui.get('generate-script').emit('click');
 assert.equal(ui.get('script-input').value,'新しい説明です。');assert.equal([...ui.get('storyboard-preview').walk()].some(e=>e.textContent==='新しい説明です。'),false);
});
test('adding a material after typing keeps the draft usable without hiding concurrent brief changes',async()=>{
 for(const concurrent of [false,true]){
  const ui=await setup({rows:[],strictProductionRevision:true,materialConcurrentEdit:concurrent});
  await ui.edit(ui.get('script-mode'),'existing');await ui.edit(ui.get('script-input'),'手入力した台本。');
  const bytes=new Uint8Array([1,2,3]);ui.get('material-files').files=[{name:'provided.png',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];
  await ui.get('material-files').emit('change');assert.equal(ui.get('script-input').value,'手入力した台本。');
  await ui.get('plan-sources').emit('click');
  if(concurrent){assert.equal(ui.requests.some(r=>r.route==='adopt-script'),false);assert.equal(ui.state().production.brief.instructions,'他の画面で編集');assert.match(ui.get('source-status').textContent,/台本が更新|STALE_REVISION/);}
  else{assert.equal(ui.location.hash,'#connection');assert.equal(ui.state().rows[0].caption,'手入力した台本。');}
  assert.equal(ui.requests.some(r=>['draft','source-plan','generate'].includes(r.route)),false);
 }
});
test('saving an AI cut plan or changing strength retains its transitions; changing style clears the old plan',async()=>{
 const motion={version:1,style:'cinematic',intensity:'standard',transitions:['iris','split'],transitionTones:['image','background']},ui=await setup({motion});
 assert.equal(ui.get('apply-motion').disabled,true);
 await ui.edit(ui.get('motion-intensity'),'bold');await ui.get('motion-intensity').emit('change');await ui.get('apply-direction').emit('click');
 assert.deepEqual(ui.state().presentation.motion,{...motion,intensity:'bold'});
 await ui.edit(ui.get('motion-style'),'editorial');await ui.get('motion-style').emit('change');await ui.get('apply-direction').emit('click');
 assert.equal(ui.state().presentation.motion.transitions,undefined);
 assert.equal(ui.state().presentation.motion.transitionTones,undefined);
 assert.equal(ui.requests.some(r=>['draft','source-plan','generate'].includes(r.route)),false);
});
test('manual input hides AI controls and adoption never generates or approves readings',async()=>{
 const ui=await setup({rows:[],autoConfirm:false});await ui.edit(ui.get('script-mode'),'existing');await ui.edit(ui.get('script-input'),'新しい手入力の台本。');
 assert.equal(ui.get('ai-script-controls').hidden,true);await ui.get('plan-sources').emit('click');
 assert.equal(ui.location.hash,'#connection');assert.equal(ui.requests.some(r=>['draft','source-plan','approve','generate'].includes(r.route)),false);assert.equal(ui.requests.filter(r=>r.route==='adopt-script').length,1);
});

test('a validated generated candidate survives a later stale save without another provider call or losing the prior saved brief',async()=>{
 const ui=await setup({rows:[],productionErrorAt:2});await ui.edit(ui.get('production-instructions'),'手順を解説');await ui.sendScript({confirmOverwrite:true});await ui.poll();
 assert.equal(ui.get('script-input').value,'AI draft result');assert.equal(ui.state().production.brief.script,'AI draft result');assert.equal(ui.state().production.brief.instructions,'手順を解説');assert.equal(ui.requests.filter(r=>r.route==='draft').length,1);assert.equal(ui.requests.some(r=>r.route==='adopt-script'||r.route==='generate'),false);assert.match(ui.get('source-status').textContent,/保存/);
});

test('draft generation stays for review, displays an actual catalog choice, then confirmation enters voice without a second generation',async()=>{
 const ui=await setup({rows:[]});assert.equal(ui.get('auto-direction').checked,true);assert.equal(ui.get('direction-sample').hidden,true);await ui.edit(ui.get('production-instructions'),'手順を解説');await ui.get('generate-script').emit('click');
 assert.equal(ui.state().rows.length,0);assert.equal(ui.location.hash,'');assert.equal(ui.get('script-input').value,'AI draft result');assert.equal(ui.get('direction-sample').hidden,false);assert.match(ui.get('direction-info').textContent,/ステップ講座/);assert.notEqual(ui.state().presentation.template,'steps');
 // The lightweight UI harness does not parse anonymous HTML children; audit the
 // static markup and exercise the chosen layout through the actual UI code.
 const previewMarkup=html.slice(html.indexOf('id="direction-sample"'),html.indexOf('id="manual-direction"'));assert.match(previewMarkup,/<div class="preview-points"><span>[^<]+<\/span><span>[^<]+<\/span><\/div>/);assert.match(ui.get('direction-sample').attributes.class,/design-steps/);
 assert.equal(ui.get('generate-script').hidden,true);assert.equal(ui.get('regenerate-script').hidden,false);await ui.get('plan-sources').emit('click');assert.equal(ui.location.hash,'#connection');assert.equal(ui.requests.filter(r=>r.route==='draft').length,1);assert.ok(ui.requests.find(r=>r.route==='adopt-script'));assert.equal(ui.state().presentation.template,'steps');assert.equal(ui.requests.some(r=>['approve','generate','finalize'].includes(r.route)),false);
});
test('manual direction stays expanded after applying settings and polling, and stays manual during regeneration',async()=>{
 const ui=await setup({rows:[]});ui.get('auto-direction').checked=false;await ui.get('auto-direction').emit('change');assert.equal(ui.get('manual-direction').hidden,false);assert.equal(ui.get('manual-direction').open,true);
 await ui.edit(ui.get('job-title'),'手動の題名');await ui.get('template-gallery').children.find(b=>b.dataset.template==='blueprint').emit('click');await ui.edit(ui.get('motion-style'),'off');await ui.get('motion-style').emit('change');await ui.get('apply-direction').emit('click');await ui.poll();assert.equal(ui.get('manual-direction').open,true);assert.equal(ui.get('auto-direction').checked,false);assert.equal(ui.state().title,'手動の題名');assert.equal(ui.state().presentation.template,'blueprint');assert.equal(ui.state().presentation.motion,null);assert.equal(ui.requests.some(r=>['draft','source-plan','generate'].includes(r.route)),false);
 await ui.edit(ui.get('script-input'),'既存の台本。');await ui.edit(ui.get('production-instructions'),'わかりやすく修正');await ui.sendScript({confirmOverwrite:true});assert.equal(ui.state().title,'手動の題名');assert.equal(ui.state().presentation.template,'blueprint');assert.equal(ui.state().presentation.motion,null);
});
test('narration completion advances to listening and never automatically seals, marks listening or renders',async()=>{
 const ui=await setup({secondReviewed:false});await ui.get('confirm-script').emit('click');await ui.get('generate-all').emit('click');assert.equal(ui.location.hash,'#finish');assert.equal(ui.requests.filter(r=>r.route==='generate').length,1);assert.equal(ui.requests.some(r=>['listened','confirm-cut','finalize','render-video'].includes(r.route)),false);assert.equal(ui.state().rows.every(r=>!r.listenedCurrent),true);
 assert.ok(html.indexOf('id="full-audio"')>html.indexOf('id="finish"'));assert.ok(html.indexOf('id="confirm-full"')>html.indexOf('id="finish"'));assert.ok(html.indexOf('id="generate-script"')<html.indexOf('id="script-input"'));assert.ok(html.indexOf('id="regenerate-script"')<html.indexOf('id="script-input"'));
});

test('one planning action ends STEP01 and music/pause precede narration without an extra consent checkbox',()=>{
 assert.equal([...html.matchAll(/id="plan-sources"/g)].length,1);
 assert.ok(html.indexOf('id="script-input"')<html.indexOf('id="plan-sources"'));
 assert.ok(html.indexOf('id="plan-sources"')<html.indexOf('id="connection"'));
 assert.ok(html.indexOf('id="cut-pause"')<html.indexOf('id="review-overall"'));
 assert.ok(html.indexOf('id="cut-pause"')<html.indexOf('id="generate-all"'));
 assert.doesNotMatch(html,/id="consent"/);
 assert.match(html,/<div class="production-save">/);
 assert.match(html,/<details class="text-only-alternative" hidden>/);
});
test('URL-only script input uses one source plan and enters voice selection without reading the URL aloud',async()=>{
const result={script:'しくみをつたえます。',readings:[{caption:'しくみをつたえます。',speech:'しくみをつたえます。'}]},ui=await setup({sourcePlan:result,rows:[]});
 await ui.edit(ui.get('script-input'),'https://example.com/article');assert.equal(ui.get('generate-script').disabled,true);assert.match(ui.get('script-send-state').textContent,/参考URL/);assert.equal(ui.requests.some(r=>['draft','source-plan'].includes(r.route)),false);
 await ui.edit(ui.get('script-input'),'');await ui.edit(ui.get('source-urls'),'https://example.com/article');await ui.sendScript({confirmOverwrite:true});await ui.get('plan-sources').emit('click');
 assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.state().rows[0].caption,result.script);assert.equal(ui.location.hash,'#connection');assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
test('failed URL-only planning keeps the input and stable button label without importing or retrying',async()=>{
const ui=await setup({sourceError:'SOURCE_URL_NOT_RETRIEVED',rows:[]});await ui.edit(ui.get('source-urls'),'https://example.com/article');await ui.sendScript({confirmOverwrite:true});await ui.poll();assert.equal(ui.get('source-urls').value,'https://example.com/article');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.requests.some(r=>['adopt-script','draft'].includes(r.route)),false);
});
test('a real existing script advances through the same button without a source generation',async()=>{
 const ui=await setup({rows:[]});ui.get('auto-direction').checked=false;await ui.get('auto-direction').emit('change');await ui.edit(ui.get('script-input'),'せつめいします。');await ui.get('plan-sources').emit('click');assert.equal(ui.location.hash,'#connection');assert.equal(ui.state().rows[0].speech,'せつめいします。');assert.equal(ui.requests.some(r=>r.route==='source-plan'||r.route==='draft'||r.route==='generate'),false);
});
test('next step saves planning and chosen voice without approving readings or spending API calls',async()=>{
 const ui=await setup({secondReviewed:false});await ui.edit(ui.get('production-instructions'),'短い解説');await ui.edit(ui.get('job-title'),'新しい題名');await ui.edit(ui.get('pitch'),'high');
 await ui.get('apply-voice').emit('click');assert.equal(ui.location.hash,'#reading');assert.equal(ui.state().production.brief.instructions,'短い解説');assert.equal(ui.state().title,'新しい題名');assert.equal(ui.state().settings.pitch,'high');assert.equal(ui.state().rows[1].reviewed,false);
 assert.equal(ui.requests.some(r=>['generate','approve','source-plan','draft'].includes(r.route)),false);
});
test('narration button saves and approves the exact visible reading then sends one explicit generation',async()=>{
const ui=await setup({secondReviewed:false});await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');assert.equal(ui.get('generate-all').disabled,true);await ui.get('confirm-script').emit('click');assert.equal(ui.requests.some(r=>r.route==='generate'),false);await ui.get('generate-all').emit('click');assert.equal(ui.state().rows[0].speech,'なおしたよみ。');assert.equal(ui.state().rows.every(r=>r.reviewed&&r.audioCurrent),true);assert.equal(ui.requests.filter(r=>r.route==='generate').length,1);assert.ok(ui.requests.findIndex(r=>r.route==='approve')<ui.requests.findIndex(r=>r.route==='generate'));
});
test('concurrent reading edit blocks narration without overwriting either draft or spending a generation',async()=>{
 const ui=await setup({secondReviewed:false});await ui.edit(ui.textArea('one','speech'),'てもちのよみ。');ui.externalEdit('one',{speech:'ほかでほぞん。'});await ui.get('confirm-script').emit('click');
 assert.equal(ui.textArea('one','speech').value,'てもちのよみ。');assert.equal(ui.state().rows[0].speech,'ほかでほぞん。');assert.equal(ui.requests.some(r=>['generate','row','approve'].includes(r.route)),false);
});
test('new BGM switch defaults on, toggling saves preference without provider calls',async()=>{
 const ui=await setup({rows:[]});await ui.get('new-project').emit('click');assert.equal(ui.get('music-enabled').checked,true);
 ui.get('music-enabled').checked=false;await ui.get('music-enabled').emit('change');assert.equal(ui.state().production.musicEnabled,false);assert.equal(ui.requests.some(r=>['generate','generate-music','source-plan','draft'].includes(r.route)),false);
});
test('editing already generated narration exposes one explicit regeneration action and keeps untouched audio',async()=>{
const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'old.wav'},audioCurrent:true,listenedCurrent:true},{id:'two',caption:'次。',speech:'つぎ。',reviewed:true,attempts:1,audio:{file:'two.wav'},audioCurrent:true,listenedCurrent:true}]});await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');await ui.get('confirm-script').emit('click');assert.equal(ui.get('generate-all').disabled,true);await ui.get('retry-audio').emit('click');assert.equal(ui.requests.some(r=>r.route==='generate'),false);await ui.get('retry-confirm-send').emit('click');const calls=ui.requests.filter(r=>r.route==='generate');assert.equal(calls.length,1);assert.deepEqual(calls[0].input.ids,['one']);assert.equal(calls[0].input.regenerate,true);assert.equal(ui.state().rows[1].audio.file,'two.wav');
});
test('motion choice requires saving, uses only presentation endpoint, survives polling and refuses sealed edits',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:true}]});ui.get('motion-style').value='kinetic';await ui.get('motion-style').emit('change');await ui.poll();assert.equal(ui.get('motion-style').value,'kinetic');assert.equal(ui.get('apply-motion').disabled,false);
 await ui.get('apply-direction').emit('click');assert.equal(ui.state().presentation.motion.style,'kinetic');assert.equal(ui.get('apply-motion').disabled,true);assert.equal(ui.requests.some(r=>['generate','draft','design-draft'].includes(r.route)),false);
 ui.get('motion-style').value='cinematic';await ui.get('motion-style').emit('change');ui.get('motion-style').value='kinetic';await ui.get('motion-style').emit('change');assert.equal(ui.get('apply-motion').disabled,true);assert.equal(ui.get('confirm-full').disabled,false);
 await ui.get('confirm-full').emit('click');assert.equal(ui.get('motion-style').disabled,true);assert.equal(ui.get('apply-motion').disabled,true);
});
test('cut correction input has a send/apply action and global reading confirmation remains distinct',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:true}]});const list=[...ui.get('rows').walk()],input=list.findIndex(e=>e.attributes['aria-label']==='1カットへの修正指示'),apply=list.findIndex(e=>e.dataset.applyReview==='one');assert.ok(input>=0&&input<apply);assert.equal(list.some(e=>e.dataset.confirmCut||e.dataset.editCut),false);assert.equal(ui.get('confirm-script').disabled,true);assert.match(html,/<div class="reading-confirm-actions"><button id="confirm-script"/);
});

test('cut review selects ordinary JPG/PNG materials and reuses audio while invalidating the cut confirmation',async()=>{
 const file='a'.repeat(64)+'.jpg',ui=await setup({assets:[{name:'持込画像.jpg',file}],rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:true,cutConfirmed:false}]});
 const select=[...ui.get('rows').walk()].find(e=>e.dataset.cutImage==='one');assert.equal(select.disabled,false);select.value=file;await select.emit('change');assert.equal(ui.state().rows[0].cutImage.file,file);assert.equal(ui.state().rows[0].audioCurrent,true);assert.equal(ui.state().rows[0].cutConfirmed,false);assert.equal([...ui.get('rows').walk()].find(e=>e.tagName==='img').attributes.src,'/materials/'+file);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
 const preview=[...ui.get('rows').walk()].find(e=>e.classList.contains('cut-template-preview'));assert.ok(preview);assert.ok([...preview.walk()].some(e=>e.attributes.class==='preview-heading'));assert.ok([...preview.walk()].some(e=>e.attributes.class==='preview-caption'&&e.textContent==='字幕。'));
});
test('returning to a sealed step creates an editable revision and retains the original audio',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'idle'});await ui.poll();const audio=ui.state().rows[0].audio;await ui.get('revise-connection').emit('click');assert.equal(ui.state().projectId,'revision-project');assert.equal(ui.location.hash,'#connection');assert.equal(ui.state().production.finalization,null);assert.deepEqual(ui.state().rows[0].audio,audio);assert.equal(ui.get('voice').disabled,false);assert.equal(ui.requests.filter(r=>r.route==='revision-project').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
for(const step of ['planning','connection','reading','finish'])test(step+' allows idle workflow interruption and resumption without changing approvals or discarding draft input',async()=>{
 const ui=await setup();const before=ui.state().rows;await ui.edit(ui.textArea('one','speech'),'保存前のよみ');await ui.edit(ui.get('production-instructions'),'保存前の制作指示');
 assert.equal(ui.get('cancel-'+step).disabled,false);await ui.get('cancel-'+step).emit('click');assert.equal(ui.get('workflow-paused').hidden,false);assert.equal(ui.get(step).hidden,true);assert.equal(ui.location.hash,'#workflow-paused');assert.deepEqual(ui.state().rows,before);assert.equal(ui.requests.some(r=>r.route==='unapprove'||r.route==='cancel'||r.route==='generate'),false);
 await ui.get('resume-workflow').emit('click');assert.equal(ui.get(step).hidden,false);assert.equal(ui.get('workflow-paused').hidden,true);assert.equal(ui.location.hash,'#'+step);assert.equal(ui.textArea('one','speech').value,'保存前のよみ');assert.equal(ui.get('production-instructions').value,'保存前の制作指示');
});
test('workflow interruption is available before reading approvals and saved paused view reloads without a provider request',async()=>{
 const empty=await setup({rows:[]});empty.restart();await empty.poll();assert.equal(empty.get('cancel-planning').disabled,false);await empty.get('cancel-planning').emit('click');assert.equal(empty.get('workflow-paused').hidden,false);
 const restored=await setup({pausedStep:'reading'});assert.equal(restored.get('workflow-paused').hidden,false);assert.equal(restored.get('reading').hidden,true);await restored.get('resume-workflow').emit('click');assert.equal(restored.location.hash,'#reading');assert.equal(restored.requests.some(r=>['generate','cancel','draft'].includes(r.route)),false);
 assert.doesNotMatch(html,/<a href="#reading">全文確認へ進む<\/a>/);
});

test('API registration alone enables explicit narration without a separate checkbox or automatic synthesis',async()=>{
 const ui=await setup();ui.restart();await ui.poll();assert.equal(ui.get('generate-all').disabled,true);assert.equal(ui.get('generation-next').hidden,true);
 ui.get('api-key').value='not-a-real-key';await ui.get('key-form').emit('submit');assert.equal(ui.get('api-settings').open,false);assert.equal(ui.get('generate-all').disabled,false);assert.equal(ui.get('generation-next').hidden,true);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
for(const control of ['unconfirm-script'])test(control+' can undo idle reading confirmation without losing text/audio or local edits',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'old.wav'},audioCurrent:true,listenedCurrent:true,cutConfirmed:false}]});const before=ui.state().rows[0];await ui.edit(ui.textArea('one','speech'),'保存前の修正');assert.equal(ui.get(control).disabled,false);await ui.get(control).emit('click');assert.equal(ui.state().rows[0].reviewed,false);assert.equal(ui.state().rows[0].speech,before.speech);assert.deepEqual(ui.state().rows[0].audio,before.audio);assert.equal(ui.textArea('one','speech').value,'保存前の修正');assert.ok(!html.includes('id="consent"'));assert.equal(ui.requests.filter(r=>r.route==='unapprove').length,1);assert.equal(ui.requests.some(r=>r.route==='cancel'||r.route==='generate'),false);assert.match(ui.get('cancel-status').textContent,/編集に戻れます/);
});
test('final seal hides reading undo/next actions and active synthesis keeps cancellation as execution cancellation',async()=>{
 const sealed=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await sealed.get('confirm-full').emit('click');assert.equal(sealed.get('unconfirm-script').hidden,true);assert.equal(sealed.get('reading-next').hidden,true);assert.equal(sealed.get('cancel').disabled,false);
 const active=await setup();active.externalBusy(true);await active.poll();assert.equal(active.get('unconfirm-script').disabled,true);assert.equal(active.get('cancel').disabled,false);assert.match(active.get('cancel').textContent,/処理を中止/);await active.get('cancel').emit('click');assert.equal(active.requests.filter(r=>r.route==='cancel').length,1);assert.equal(active.requests.some(r=>r.route==='unapprove'),false);
});
test('cancellation stays usable while the AI request promise itself is still pending',async()=>{
 let release;const draftWait=new Promise(r=>release=r),ui=await setup({draftWait,rows:[]});await ui.edit(ui.get('production-instructions'),'作成指示');const running=ui.sendScript({confirmOverwrite:true});await new Promise(r=>setImmediate(r));await ui.poll();assert.equal(ui.state().busy,true);assert.equal(ui.get('cancel').disabled,false);await ui.get('cancel').emit('click');assert.equal(ui.get('workflow-paused').hidden,true);release();await running;assert.equal(ui.get('workflow-paused').hidden,false);assert.equal(ui.requests.filter(r=>r.route==='cancel').length,1);assert.equal(ui.requests.some(r=>r.route==='unapprove'),false);
});

test('AI hiragana readings survive local saving/polling and are passed into review without another provider request',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'作りたい動画');await ui.sendScript({confirmOverwrite:true});assert.equal(ui.get('append-script').textContent,'次へ：声を選ぶ →');await ui.get('save-production').emit('click');await ui.poll();assert.deepEqual(ui.state().production.brief.readings,[{caption:'AI draft result',speech:'えーあいだいほん。'}]);await ui.get('plan-sources').emit('click');const request=ui.requests.find(r=>r.route==='adopt-script');assert.equal(request.input.readings[0].speech,'えーあいだいほん。');assert.equal(request.input.consent,undefined);assert.equal(ui.state().rows.at(-1).speech,'えーあいだいほん。');assert.equal(ui.requests.filter(r=>r.route==='draft').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
test('changed or pasted captions disclose one reading preparation request; missing key disables it and stale readings are not reused',async()=>{
const ui=await setup();await ui.edit(ui.get('production-instructions'),'作成指示');await ui.sendScript({confirmOverwrite:true});await ui.edit(ui.get('script-input'),'変更した字幕。');await ui.get('plan-sources').emit('click');const request=ui.requests.find(r=>r.route==='adopt-script');assert.equal(request.input.readings,undefined);assert.equal(ui.state().rows[0].speech,'');assert.match(ui.get('prepare-readings').textContent,/API 1回/);ui.restart();await ui.poll();assert.equal(ui.get('prepare-readings').disabled,true);assert.equal(ui.requests.filter(r=>r.route==='draft').length,1);
});
test('reading hints are explained, deduplicated and collapsed while clean hiragana shows no hint list',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'AIの画像。',speech:'AIの画像。',hints:[{term:'AI',kind:'latin'},{term:'AI',kind:'latin'},{term:'画像',kind:'kanji'}]}]});const detail=[...ui.get('rows').walk()].find(e=>e.attributes.class==='reading-hints');assert.equal(detail.open,false);assert.equal(detail.children[0].textContent,'読みの確認候補 2語');assert.match(detail.children[1].textContent,/判定した一覧ではありません/);
 const clean=await setup({rows:[{id:'one',caption:'AIの画像。',speech:'えーあいのがぞう。',hints:[]}]});assert.equal([...clean.get('rows').walk()].some(e=>e.attributes.class==='reading-hints'),false);
});

test('local saving reports completion beside its separated control and reading navigation reuses loaded script',async()=>{
 const ui=await setup();assert.ok(!html.includes('取り込み済み台本の読み確認へ'));assert.match(html,/class="production-save"/);
 await ui.edit(ui.get('production-instructions'),'Keep these directions');await ui.get('save-production').emit('click');assert.match(ui.get('save-status').textContent,/保存しました/);assert.equal(ui.state().production.brief.instructions,'Keep these directions');
 await ui.get('plan-sources').emit('click');assert.equal(ui.location.hash,'#connection');assert.match(ui.get('script-status').textContent,/声を選び/);assert.equal(ui.requests.some(r=>r.route==='draft'||r.route==='generate'),false);
 await ui.edit(ui.get('script-input'),'');assert.equal(ui.get('append-script').disabled,true);
});
test('saved project labels distinguish editing from finalized viewing and active video can be canceled without publishing',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});assert.match(ui.get('project-select').children[0].textContent,/編集中/);
 await ui.get('confirm-full').emit('click');assert.match(ui.get('project-select').children[0].textContent,/確定済み・閲覧/);assert.equal(ui.get('cancel').disabled,false);
 await ui.get('cancel').emit('click');assert.equal(ui.state().video.stage,'canceled');assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.get('video-spinner').hidden,true);assert.equal(ui.get('cancel').disabled,true);assert.match(ui.get('cancel-status').textContent,/中止/);assert.match(ui.get('video-stages').children.at(-1).textContent,/中止/);assert.equal(ui.get('confirm-full').textContent,'動画生成を再開する');assert.equal(ui.requests.filter(r=>r.route==='cancel').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('new video exits the completed-project lock and can decide a template/palette, then reopen the original',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'idle'});await ui.poll();
 const original=ui.state();assert.equal(ui.get('new-project').disabled,false);assert.equal(ui.get('theme').disabled,false);
 ui.get('theme').value='black';await ui.get('theme').emit('change');await ui.poll();assert.equal(ui.get('theme').value,'black');assert.deepEqual(ui.state().presentation,original.presentation);assert.equal(ui.requests.some(r=>r.route==='presentation'),false);
 await ui.get('new-project').emit('click');assert.equal(ui.state().rows.length,0);assert.equal(ui.state().production.finalization,null);assert.equal(ui.get('job-title').disabled,false,ui.get('message').textContent);assert.equal(ui.get('theme').disabled,false);assert.ok(!html.includes('id="consent"'));
 ui.get('auto-direction').checked=false;await ui.get('auto-direction').emit('change');await ui.get('template-gallery').children.find(b=>b.dataset.template==='blueprint').emit('click');assert.equal(ui.get('apply-design').disabled,false);await ui.get('apply-direction').emit('click');
 ui.get('theme').value='white';await ui.get('theme').emit('change');assert.equal(ui.state().presentation.template,'blueprint');assert.equal(ui.state().presentation.theme,'white');assert.equal(ui.requests.some(r=>r.route==='generate'||r.route==='design-draft'),false);
 ui.get('project-select').value='original';await ui.get('project-select').emit('change');assert.equal(ui.state().production.finalization.revision,original.production.finalization.revision);assert.equal(ui.get('apply-design').disabled,true);
});
test('new/switch UI is disabled while edits are unsaved or generation is active',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'Unsaved production directions');assert.equal(ui.get('new-project').disabled,true);assert.equal(ui.get('project-select').disabled,true);assert.match(ui.get('project-info').textContent,/保存/);
 await ui.get('save-production').emit('click');assert.equal(ui.get('new-project').disabled,false);
 ui.externalVideo({running:true});await ui.poll();assert.equal(ui.get('new-project').disabled,true);assert.equal(ui.requests.some(r=>r.route==='new-project'),false);
});

test('script-generation result presents prepared images before adoption and voice selection without another generation click',async()=>{
 const file='a'.repeat(64)+'.png',sourcePlan={script:'新しい説明です。',readings:[{caption:'新しい説明です。',speech:'あたらしいせつめいです。'}],storyboard:{title:'説明',summary:'概要',voice:'Kore',voiceReason:'明瞭な解説',sources:[],scenes:[{caption:'新しい説明です。',title:'新しい場面',points:[],imageFile:file,sourceIds:[]}]}};
 const ui=await setup({sourcePlan,rows:[],assets:[{file,name:'生成画像.png',origin:'generated-image'}]});await ui.edit(ui.get('source-text'),'参考本文');await ui.get('generate-script').emit('click');
 const image=[...ui.get('storyboard-preview').walk()].find(e=>e.tagName==='img');assert.equal(image.attributes.src,'/materials/'+file);assert.equal(ui.get('storyboard-preview').hidden,false);assert.equal(ui.state().rows.length,0);assert.match(ui.get('plan-sources').textContent,/台本と画像/);assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.requests.some(r=>['prepare-images','regenerate-image','approve-images','generate'].includes(r.route)),false);
 const card=[...ui.get('storyboard-preview').walk()].find(e=>e.dataset.draftImage==='0');assert.ok(card);assert.ok([...card.walk()].some(e=>e.dataset.regenerateDraftImage==='0'));assert.ok([...card.walk()].some(e=>e.attributes.type==='file'));assert.ok([...card.walk()].some(e=>e.attributes.class==='cut-image-drop'));await ui.get('plan-sources').emit('click');assert.equal(ui.location.hash,'#connection');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);await ui.get('apply-voice').emit('click');assert.equal(ui.requests.some(r=>['prepare-images','regenerate-image','generate'].includes(r.route)),false);
});
test('planning action creates an editable script before narration/video through one unified input flow',()=>{
 assert.match(html,/台本と演出を確定して声選びへ/);assert.doesNotMatch(html,/素材から動画を組み立てる（API利用）/);assert.ok(html.indexOf('class="text-only-alternative"')<html.indexOf('id="draft-script"'));assert.match(html,/不足画像も作成してから結果を表示/);
});
test('material intake precedes script planning in visual and keyboard order',()=>{
 const ids=['asset-mode','material-files','material-list','script-mode','production-instructions','script-input','append-script','save-production'];
 const positions=ids.map(id=>html.indexOf(`id="${id}"`));
 assert.ok(positions.every(position=>position>=0));
 assert.ok(positions.every((position,index)=>index===0||position>positions[index-1]));
 assert.match(html,/素材と台本を用意する/);
});
test('materials and AI planning precede optional design controls, and the bottom advertisement is removed',()=>{
 assert.ok(html.indexOf('id="material-files"')<html.indexOf('id="plan-sources"'));
 assert.ok(html.indexOf('id="design-planning"')<html.indexOf('id="plan-sources"'));
 assert.ok(!html.includes('PRESENTATION TEMPLATE'));assert.match(html,/テンプレートを使わず、AIで今回用に作る/);
});
test('template comparison is local; deciding saves renderer design while retaining unsaved sentence edits',async()=>{
 const ui=await setup();assert.equal(ui.get('template-gallery').children.length,12);
 await ui.edit(ui.textArea('one','speech'),'Unsaved pronunciation');const button=ui.get('template-gallery').children.find(b=>b.dataset.template==='blueprint');await button.emit('click');
 assert.equal(ui.requests.some(r=>r.route==='presentation'||r.route==='design-draft'),false);assert.equal(ui.get('generate-all').disabled,true);
 await ui.get('apply-direction').emit('click');assert.equal(ui.state().presentation.template,'blueprint');assert.equal(ui.textArea('one','speech').value,'Unsaved pronunciation');assert.equal(ui.get('apply-design').disabled,true);
 assert.equal(ui.requests.filter(r=>r.route==='presentation').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
test('all added structures are selectable without API generation and preserve pending reading edits',async()=>{
 for(const id of ['broadsheet','gallery','flow','briefing']){
  const ui=await setup();await ui.edit(ui.textArea('one','speech'),'変更中の読み');
  const button=ui.get('template-gallery').children.find(b=>b.dataset.template===id);assert.ok(button,id);
  await button.emit('click');assert.equal(ui.requests.some(r=>['presentation','generate','design-draft'].includes(r.route)),false);
  await ui.get('apply-direction').emit('click');assert.equal(ui.state().presentation.template,id);
  assert.equal(ui.textArea('one','speech').value,'変更中の読み');assert.equal(ui.requests.filter(r=>r.route==='presentation').length,1);
  assert.equal(ui.requests.some(r=>['generate','design-draft'].includes(r.route)),false);
 }
});
test('AI design uses one explicit consent-gated action; instructions survive polling and result updates preview',async()=>{
 const ui=await setup();ui.get('design-mode').value='ai';await ui.get('design-mode').emit('change');assert.equal(ui.get('template-gallery').hidden,true);assert.equal(ui.get('apply-design').hidden,true);
 await ui.edit(ui.get('design-instructions'),'Blue, large type, image on the left');await ui.poll();assert.equal(ui.get('design-instructions').value,'Blue, large type, image on the left');assert.equal(ui.get('draft-design').disabled,true);assert.equal(ui.requests.some(r=>r.route==='design-draft'),false);
 ui.get('design-consent').checked=true;await ui.get('design-consent').emit('change');assert.equal(ui.get('draft-design').disabled,false);await ui.get('draft-design').emit('click');assert.equal(ui.requests.filter(r=>r.route==='design-draft').length,1);assert.equal(ui.state().presentation.mode,'ai');assert.equal(ui.state().presentation.design.name,'AI design');assert.equal(ui.get('design-sample').hidden,false);assert.match(ui.get('design-selection').textContent,/AI design/);
});
test('finalized video allows browsing template examples without changing its sealed presentation',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'idle'});await ui.poll();const before=ui.state().presentation;
 await ui.get('template-gallery').children.find(b=>b.dataset.template==='pop').emit('click');assert.equal(ui.get('apply-design').disabled,true);await ui.poll();assert.deepEqual(ui.state().presentation,before);assert.equal(ui.get('confirm-full').disabled,false);assert.equal(ui.requests.some(r=>r.route==='presentation'||r.route==='design-draft'),false);assert.match(ui.get('design-selection').textContent,/最終確定済み/);
 ui.restart();await ui.poll();assert.equal(ui.get('api-settings').open,false);assert.equal(ui.get('api-connection').classList.contains('needs-key'),false);
});

test('video generation shows only actual progress, publishes player/download after saving, and preserves the final seal',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:false}]});
 assert.equal(ui.get('confirm-full').disabled,false);await ui.get('confirm-full').emit('click');assert.equal(ui.get('confirm-full').disabled,true);
 assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);assert.equal(ui.get('video-spinner').hidden,false);assert.equal(ui.get('video-progress').value,.4);assert.match(ui.get('video-status').textContent,/40 \/ 100/);assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.get('confirm-full').disabled,true);
 ui.externalVideo({running:false,stage:'complete',progress:1,result:{file:'a'.repeat(64)+'.mp4',filename:'Video.mp4',savedPath:'Downloads/Video.mp4',audio:{file:'b'.repeat(64)+'.m4a',filename:'Audio.m4a',savedPath:'Downloads/Audio.m4a'}}});await ui.poll();
 assert.equal(ui.get('video-spinner').hidden,true);assert.equal(ui.get('video-result').hidden,false);assert.equal(ui.get('video-player').src,'/video/'+'a'.repeat(64)+'.mp4');assert.match(ui.get('video-saved-path').textContent,/保存済み/);assert.equal(ui.get('download-audio').hidden,false);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
 ui.externalVideo({result:null,stage:'failed',error:'VIDEO_RENDER_FAILED',steps:['preparing','bundling','rendering']});await ui.poll();assert.equal(ui.get('video-result').hidden,true);assert.match(ui.get('video-status').textContent,/VIDEO_RENDER_FAILED/);assert.match(ui.get('video-stages').children.at(-1).textContent,/失敗/);assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);
 ui.externalVideo({result:null,stage:'failed',error:'VIDEO_FONT_TIMEOUT',steps:['preparing','bundling','rendering']});await ui.poll();assert.match(ui.get('video-status').textContent,/日本語フォント.*時間切れ/);assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);
});

test('initial voice remains a candidate and next step saves it without synthesis',async()=>{
 const ui=await setup({voiceConfirmed:false});assert.match(ui.get('voice-apply-state').textContent,/候補/);assert.equal(ui.get('apply-voice').disabled,false);
 await ui.edit(ui.get('pitch'),'high');assert.equal(ui.requests.some(r=>r.route==='settings'),false);await ui.get('apply-voice').emit('click');assert.equal(ui.location.hash,'#reading');assert.equal(ui.state().voiceConfirmed,true);assert.equal(ui.state().settings.pitch,'high');assert.match(ui.get('voice-apply-state').textContent,/保存した声：Kore/);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('review shows only the next useful actions, makes the send action explicit and places stale-audio repair inside its cut',async()=>{
 const ui=await setup({secondReviewed:true});assert.equal(ui.get('confirm-script').hidden,true);assert.equal(ui.get('confirm-script').disabled,true);
 assert.match(ui.get('review-save-state').textContent,/全文の読みは確定済み/);
 assert.equal(ui.get('full-audio').hidden,true);assert.equal(ui.get('confirm-full').hidden,true);
 assert.equal(html.includes('id="audio-rows"'),false);assert.equal(html.includes('<details id="generation-tools"'),false);
 assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.generate),false);
 assert.ok(!html.includes('id="consent"'));
 assert.equal(ui.get('generate-all').disabled,false);assert.match(ui.get('generation-state').textContent,/Google.*API/);
 const repaired=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'old.wav'},audioCurrent:false,listenedCurrent:false}],confirmResult:false});
 const regenerate=[...repaired.get('rows').walk()].find(e=>e.dataset.generate==='one');assert.ok(regenerate);
 await regenerate.emit('click');assert.equal(repaired.requests.some(r=>r.route==='generate'),false);
 assert.equal(repaired.confirmations.length,1);
});

test('generated narration leaves all cuts editable until one final review, with no individual cut buttons',async()=>{
 const ui=await setup({secondReviewed:true});await ui.get('generate-all').emit('click');assert.equal(ui.state().rows.every(r=>r.audioCurrent),true);assert.equal(ui.get('generation-tools').hidden,true);assert.equal(ui.get('confirm-full').disabled,false);assert.equal(ui.location.hash,'#finish');assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.confirmCut||e.dataset.editCut),false);assert.equal(ui.textArea('one','speech').disabled,false);assert.equal(ui.requests.some(r=>r.route==='confirm-cut'||r.route==='finalize'),false);
});

test('voice preset fills editable voice/style without synthesis or changing model and preserves row drafts',async()=>{
  const ui=await setup();
  await ui.edit(ui.textArea('one','speech'),'Unsaved reading');
  const model=ui.get('model').value;
  ui.get('voice-preset').value='bright';await ui.get('voice-preset').emit('change');
  assert.equal(ui.get('voice').value,'Puck');assert.match(ui.get('style').value,/明るく/);
  assert.equal(ui.get('model').value,model);assert.equal(ui.get('generate-all').disabled,true);
  assert.equal(ui.requests.some(r=>r.route==='settings'||r.route==='generate'),false);
  await ui.get('settings-form').emit('submit');
  assert.equal(ui.state().settings.voice,'Puck');assert.equal(ui.textArea('one','speech').value,'Unsaved reading');
  await ui.edit(ui.get('style'),'Custom style');assert.equal(ui.get('voice-preset').value,'custom');
  ui.get('voice-preset').value='custom';await ui.get('voice-preset').emit('change');assert.equal(ui.get('style').value,'Custom style');
});
test('cached voice sample plays locally without key or consent; pitch selection makes no provider request',async()=>{const ui=await setup();ui.restart();await ui.poll();assert.equal(ui.get('preview-voice').hidden,true);await ui.get('sample-audio').play();assert.equal(ui.get('sample-audio').src,'/samples/sample-kore.wav');assert.equal(ui.get('sample-audio').played,true);assert.equal(ui.requests.some(r=>r.route==='preview'),false);await ui.edit(ui.get('pitch'),'low');assert.equal(ui.get('preview-voice').disabled,true);assert.equal(ui.requests.some(r=>r.route==='settings'||r.route==='generate'),false);});
test('one voice menu selects its saved sample without a second menu, key, consent or provider request',async()=>{const ui=await setup();ui.restart();await ui.poll();await ui.edit(ui.get('voice'),'Puck');await ui.get('voice').emit('change');assert.equal(ui.get('voice').value,'Puck');assert.equal(ui.get('sample-audio').src,'/samples/sample-puck.wav');assert.equal(ui.get('preview-voice').disabled,false);assert.equal(ui.requests.some(r=>r.route==='settings'||r.route==='generate'||r.route==='preview'),false);assert.equal(/id="sample-library"/.test(html),false);});
test('brief modes, instructions and script drafts survive polling and unrelated saves',async()=>{const ui=await setup();await ui.edit(ui.get('script-mode'),'mixed');await ui.edit(ui.get('asset-mode'),'ai');await ui.edit(ui.get('production-instructions'),'Make an explanatory video');await ui.edit(ui.get('script-input'),'My existing script');await ui.edit(ui.get('job-title'),'New title');await ui.get('save-title').emit('click');await ui.poll();assert.equal(ui.get('script-input').value,'My existing script');await ui.get('save-production').emit('click');assert.equal(ui.state().production.brief.assetMode,'ai');assert.equal(ui.state().production.brief.instructions,'Make an explanatory video');assert.equal(ui.requests.some(r=>r.route==='draft'||r.route==='generate'),false);});
test('explicit disclosed AI draft action carries consent once, fills editable input and never appends or synthesizes',async()=>{
const ui=await setup({rows:[]});assert.equal(ui.get('generate-script').disabled,true);await ui.edit(ui.get('production-instructions'),'Write a brief narration');await ui.sendScript({confirmOverwrite:true});assert.equal(ui.get('script-input').value,'AI draft result');assert.equal(ui.state().rows.length,0);const calls=ui.requests.filter(r=>r.route==='draft');assert.equal(calls.length,1);assert.equal(calls[0].input.consent,true);assert.match(ui.get('source-status').textContent,/保存しました/);assert.equal(ui.requests.some(r=>['generate','approve','adopt-script'].includes(r.route)),false);ui.restart();await ui.poll();assert.equal(ui.get('regenerate-script').disabled,true);
});
test('pasted script becomes visibly editable immediately while preserving unsaved production instructions',async()=>{const ui=await setup();await ui.edit(ui.get('script-input'),'Pasted script');await ui.edit(ui.get('production-instructions'),'Keep this direction');await ui.get('plan-sources').emit('click');assert.equal(ui.state().rows.length,1);assert.equal(ui.textArea('adopted-0','speech').value,'');assert.equal(ui.get('production-instructions').value,'Keep this direction');assert.equal(ui.requests.some(r=>r.route==='draft'),false);});
test('registered key folds the entry UI, can be reopened, and is cleared without losing drafts',async()=>{const ui=await setup();assert.equal(ui.get('api-settings').open,false);assert.equal(ui.get('key-state').textContent,'キー登録済み');ui.get('api-settings').open=true;await ui.poll();assert.equal(ui.get('api-settings').open,true);await ui.edit(ui.textArea('one','speech'),'Unsaved narration');ui.get('api-key').value='test-only-key';await ui.get('key-form').emit('submit');assert.equal(ui.get('api-key').value,'');assert.equal(ui.get('api-settings').open,false);await ui.get('clear-key').emit('click');assert.equal(ui.get('api-settings').open,true);assert.equal(ui.textArea('one','speech').value,'Unsaved narration');});
test('voice order presents preset voices first and other voices alphabetically',async()=>{const ui=await setup({voices:['Zephyr','Aoede','Kore','Achernar','Charon','Puck']});assert.deepEqual(ui.get('voice').children.map(c=>c.attributes.value),['Puck','Charon','Kore','Aoede','Achernar','Zephyr']);});
test('workflow and keyboard DOM order start with planning and keep title in the first section',()=>{const sections=[...html.matchAll(/<section class="panel" id="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(sections,['planning','connection','reading','finish']);assert.ok(html.indexOf('id="job-title"')<html.indexOf('id="connection"'));});
test('API entry is a single top connection panel; script paste replaces JSON import and inline API links',async()=>{assert.ok(html.indexOf('id="api-settings"')<html.indexOf('class="hero"'));assert.equal([...html.matchAll(/id="api-key"/g)].length,1);assert.equal([...html.matchAll(/id="key-state"/g)].length,1);assert.match(html,/<p id="draft-key-link"/);assert.doesNotMatch(html,/id="import-file"|台本JSON/);assert.match(html,/貼り付け/);const ui=await setup();assert.equal(ui.get('api-settings').open,false);ui.restart();await ui.poll();assert.equal(ui.get('api-settings').open,true);});
test('combined presets choose model automatically, include overview, and expose free inputs only in customize mode',async()=>{const ui=await setup();const options=[...ui.get('voice-preset').walk()].filter(e=>e.tagName==='option');assert.equal(options.length,5);assert.ok(options.some(o=>o.textContent.includes('明るく親しみやすい')));ui.get('voice-preset').value='gemini-3.8-flash-lite-tts::Puck';await ui.get('voice-preset').emit('change');assert.equal(ui.get('model').value,'gemini-3.8-flash-lite-tts');assert.equal(ui.get('voice').value,'Puck');assert.equal(ui.get('custom-settings').hidden,true);assert.match(ui.get('model-info').textContent,/Flash-Lite/);assert.equal(ui.requests.some(r=>r.route==='preview'||r.route==='settings'),false);ui.get('voice-preset').value='custom';await ui.get('voice-preset').emit('change');assert.equal(ui.get('custom-settings').hidden,false);await ui.edit(ui.get('style'),'Whisper gently at a slow pace');assert.equal(ui.get('voice-preset').value,'custom');});
test('pitch, sample playback and final apply follow the decision sequence without early save',()=>{assert.ok(html.indexOf('id="pitch"')<html.indexOf('id="sample-audio"'));assert.ok(html.indexOf('id="sample-audio"')<html.indexOf('id="apply-voice"'));});
test('loaded and AI accepted scripts reuse rows instead of a second import',async()=>{const ui=await setup();await ui.get('plan-sources').emit('click');assert.equal(ui.state().rows.length,2);await ui.edit(ui.get('script-input'),'New AI result');await ui.get('plan-sources').emit('click');await ui.get('plan-sources').emit('click');assert.equal(ui.state().rows.length,1);assert.equal(ui.requests.filter(r=>r.route==='adopt-script').length,3);assert.equal(ui.requests.some(r=>['draft','generate'].includes(r.route)),false);});
test('sentence pairs preserve exact text, save both sides and invalidate only edited review',async()=>{const ui=await setup({rows:[{id:'one',caption:'最初の文。 次の文！\n最後です。',speech:'さいしょのぶん。 つぎのぶん！\nさいごです。',reviewed:true}]});const fields=[...ui.get('rows').walk()].filter(e=>e.tagName==='textarea'&&/字幕|読み上げ文/.test(e.attributes['aria-label']||''));assert.equal(fields.length,6);assert.equal(fields.filter((_,i)=>i%2===0).map(e=>e.value).join(''),ui.state().rows[0].caption);assert.equal(fields.filter((_,i)=>i%2===1).map(e=>e.value).join(''),ui.state().rows[0].speech);await ui.edit(fields[3],'なおしたよみ！\n');assert.equal(ui.get('generate-all').disabled,true);const save=[...ui.get('rows').walk()].find(e=>e.textContent==='変更を保存');await save.emit('click');assert.equal(ui.state().rows[0].caption,'最初の文。 次の文！\n最後です。');assert.equal(ui.state().rows[0].speech,'さいしょのぶん。 なおしたよみ！\nさいごです。');assert.equal(ui.state().rows[0].reviewed,false);assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.generate),false);assert.equal(html.includes('id="audio-rows"'),false);});
test('unequal sentence counts retain extra text with an explicit alignment notice',async()=>{const ui=await setup({rows:[{caption:'一文。二文。',speech:'いちぶんだけ。'}]});const fields=[...ui.get('rows').walk()].filter(e=>e.tagName==='textarea'&&/字幕|読み上げ文/.test(e.attributes['aria-label']||''));assert.equal(fields.length,4);assert.equal(fields[2].value,'二文。');assert.equal(fields[3].value,'');assert.ok([...ui.get('rows').walk()].some(e=>e.textContent.includes('文数が違います')));});
test('complete samples hide preparation and missing configurations are prepared once across both models',async()=>{const ui=await setup({samples:[]});ui.get('bank-consent').checked=true;await ui.get('bank-consent').emit('change');await ui.get('prepare-samples').emit('click');assert.equal(ui.requests.filter(r=>r.route==='prepare-samples').length,1);assert.equal(ui.state().samples.length,12);assert.equal(new Set(ui.state().samples.map(s=>s.settings.model)).size,2);assert.equal(new Set(ui.state().samples.map(s=>s.settings.pitch||'standard')).size,3);assert.equal(ui.get('bank-tools').hidden,true);assert.match(ui.get('sample-progress').textContent,/12 \/ 12/);assert.equal(ui.get('prepare-samples').disabled,true);await ui.poll();assert.equal(ui.requests.filter(r=>r.route==='prepare-samples').length,1);assert.equal(ui.state().rows.length,2);});
test('sample library stops on the first failure and retains completed clips without retry',async()=>{const ui=await setup({samples:[],previewError:2});ui.get('bank-consent').checked=true;await ui.get('bank-consent').emit('change');await ui.get('prepare-samples').emit('click');assert.equal(ui.requests.filter(r=>r.route==='prepare-samples').length,1);assert.equal(ui.requests.some(r=>r.route==='preview'),false);assert.equal(ui.state().samples.length,1);assert.equal(ui.get('bank-tools').hidden,false);assert.match(ui.get('message').textContent,/利用上限/);assert.equal(ui.get('voice-preset').disabled,false);});
test('full narration is visible when ready, uses one resource and halts on edits without marking listening',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:false},{id:'two',caption:'次。',speech:'つぎ。',reviewed:true,audio:{file:'two.wav'},audioCurrent:true,listenedCurrent:false}]});assert.equal(ui.get('full-audio').hidden,false);assert.match(ui.get('full-audio').src,/^\/api\/full-audio\?revision=/);const src=ui.get('full-audio').src;await ui.get('full-audio').emit('ended');assert.equal(ui.get('full-audio').src,src);assert.equal(ui.requests.some(r=>r.route==='listened'||r.route==='generate'),false);await ui.edit(ui.textArea('one','speech'),'修正');assert.equal(ui.get('full-audio').paused,true);assert.equal(ui.get('full-audio').hidden,true);assert.equal(ui.get('confirm-full').disabled,true);});
test('unfinished narration cannot start full playback or claim listening',async()=>{const ui=await setup();assert.equal(ui.get('full-audio').hidden,true);assert.equal(ui.get('confirm-full').disabled,true);assert.ok(html.indexOf('id="generate-all"')<html.indexOf('id="finish"'));assert.ok(html.indexOf('id="confirm-full"')>html.indexOf('id="finish"'));});
test('one sentence correction saves only that sentence and preserves other unsaved words without approving them',async()=>{const ui=await setup({rows:[{id:'one',caption:'最初。次。',speech:'さいしょ。つぎ。',reviewed:false}]});const fields=[...ui.get('rows').walk()].filter(e=>e.tagName==='textarea'&&/字幕|読み上げ文/.test(e.attributes['aria-label']||''));await ui.edit(fields[1],'なおしたよみ。');await ui.edit(fields[3],'まだへんしゅうちゅう。');const button=[...ui.get('rows').walk()].find(e=>e.dataset.commitSentence==='one:0');assert.ok(button);await button.emit('click');assert.equal(ui.state().rows[0].speech,'なおしたよみ。つぎ。');assert.equal(ui.textArea('one','speech').value,'なおしたよみ。');assert.equal(fields[3].value,'まだへんしゅうちゅう。');assert.equal(ui.state().rows[0].reviewed,false);assert.equal(ui.requests.some(r=>r.route==='approve'||r.route==='generate'),false);assert.equal(ui.get('generate-all').disabled,true);});
test('bulk correction saves all edited text before explicit approval, keeps unrelated drafts and does not synthesize',async()=>{const ui=await setup({secondReviewed:false});await ui.edit(ui.textArea('one','speech'),'Corrected reading');await ui.edit(ui.textArea('two','caption'),'Corrected caption');await ui.edit(ui.get('style'),'Unapplied voice direction');await ui.get('confirm-script').emit('click');assert.equal(ui.state().rows[0].speech,'Corrected reading');assert.equal(ui.state().rows[1].caption,'Corrected caption');assert.ok(ui.state().rows.every(r=>r.reviewed));assert.equal(ui.get('style').value,'Unapplied voice direction');const routes=ui.requests.filter(r=>['row','approve','generate'].includes(r.route)).map(r=>r.route);assert.deepEqual(routes,['row','row','approve','approve']);assert.equal(ui.get('confirm-script').disabled,true);});
test('failed save leaves edits available and never proceeds to bulk approval or another attempt',async()=>{const ui=await setup({secondReviewed:false,rowError:true});await ui.edit(ui.textArea('one','speech'),'Keep my correction');await ui.get('confirm-script').emit('click');assert.equal(ui.textArea('one','speech').value,'Keep my correction');assert.equal(ui.requests.filter(r=>r.route==='row').length,1);assert.equal(ui.requests.some(r=>r.route==='approve'||r.route==='generate'),false);assert.equal(ui.get('confirm-script').disabled,false);assert.match(ui.get('message').textContent,/処理できません/);});
test('unchanged approved text is not resaved and its existing audio/listening remains intact',async()=>{const ui=await setup({rows:[{id:'one',caption:'確認済み。',speech:'かくにんずみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true},{id:'two',caption:'未確認。',speech:'みかくにん。',reviewed:false}]});await ui.get('confirm-script').emit('click');assert.equal(ui.requests.some(r=>r.route==='row'),false);assert.equal(ui.requests.filter(r=>r.route==='approve').length,1);assert.equal(ui.state().rows[0].audio.file,'original.wav');assert.equal(ui.state().rows[0].listenedCurrent,true);});
test('scene confirmation saves pending words after reopening and never confirms stale audio',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true}]});await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');assert.equal(ui.row('one').disabled,false);await ui.row('one').emit('click');assert.equal(ui.state().rows[0].speech,'なおしたよみ。');assert.equal(ui.state().rows[0].reviewed,true);assert.equal(ui.state().rows[0].audioCurrent,false);assert.equal(ui.state().rows[0].listenedCurrent,false);assert.equal(ui.get('confirm-full').disabled,true);assert.equal(ui.requests.some(r=>r.route==='generate'||r.route==='listened'),false);});
test('concurrent row changes stop confirmation without overwriting saved work or dropping the local draft',async()=>{const ui=await setup({secondReviewed:false});await ui.edit(ui.textArea('one','speech'),'Local draft');ui.externalEdit('one',{speech:'Other saved edit'});await ui.get('confirm-script').emit('click');assert.equal(ui.textArea('one','speech').value,'Local draft');assert.equal(ui.state().rows[0].speech,'Other saved edit');assert.equal(ui.requests.some(r=>r.route==='row'||r.route==='approve'),false);assert.match(ui.get('message').textContent,/最新の内容/);});
test('cut audio uses its real scene file and reopened cut/global correction drafts survive unrelated saves',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'real-scene.wav'},audioCurrent:true,listenedCurrent:true}]});const audio=[...ui.get('rows').walk()].find(e=>e.tagName==='audio');assert.equal(audio.attributes.src,'/audio/real-scene.wav');assert.equal(audio.attributes.preload,'metadata');const note=[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');await ui.edit(note,'名前の読みを直して');await ui.edit(ui.get('review-overall'),'結末を分かりやすく');await ui.poll();await ui.edit(ui.get('job-title'),'Changed title');await ui.get('save-title').emit('click');const currentNote=[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');assert.equal(currentNote.value,'名前の読みを直して');assert.equal(ui.get('review-overall').value,'結末を分かりやすく');assert.equal(ui.get('confirm-full').disabled,true);});
test('correction instructions persist separately, block final handoff, and never start paid generation',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true}]});const before=ui.state().rows;await ui.edit(ui.get('review-overall'),'画像を台本に合わせて');await ui.get('save-review').emit('click');assert.equal(ui.state().production.review.overall,'画像を台本に合わせて');assert.deepEqual(ui.state().rows,before);assert.equal(ui.get('full-audio').hidden,false);assert.equal(ui.get('confirm-full').disabled,true);assert.equal(ui.requests.some(r=>['generate','draft','preview','row'].includes(r.route)),false);await ui.get('clear-review').emit('click');assert.equal(ui.state().production.review.overall,'');assert.equal(ui.get('confirm-full').disabled,false);});

test('cut images use only the exact stable cut name and validated local hash, and refuse ambiguous images',async()=>{
  const hash='a'.repeat(64)+'.png';
  const ui=await setup({assets:[{name:'cut-one.png',file:hash},{name:'unrelated.png',file:'b'.repeat(64)+'.png'}]});
  const images=[...ui.get('rows').walk()].filter(e=>e.tagName==='img');
  assert.equal(images.length,1);assert.equal(images[0].attributes.src,'/materials/'+hash);assert.equal(images[0].attributes.alt,'1カットの使用画像');
  const duplicate=await setup({assets:[{name:'cut-one.png',file:hash},{name:'cut-one.png',file:'b'.repeat(64)+'.png'}]});
  assert.equal([...duplicate.get('rows').walk()].filter(e=>e.tagName==='img').length,0);
  assert.ok([...duplicate.get('rows').walk()].some(e=>e.textContent.includes('複数')));
  const unsafe=await setup({assets:[{name:'cut-one.png',file:'../../private.png'}]});
  assert.equal([...unsafe.get('rows').walk()].filter(e=>e.tagName==='img').length,0);
  await ui.edit(ui.textArea('one','speech'),'Keep unsaved words');
  ui.updateAssets([{name:'cut-one.png',file:hash},{name:'cut-one.png',file:'b'.repeat(64)+'.png'}]);await ui.poll();
  assert.equal([...ui.get('rows').walk()].filter(e=>e.tagName==='img').length,0);
  assert.equal(ui.textArea('one','speech').value,'Keep unsaved words');
});

test('all cuts appear in scroll order and a single final action requires current narration',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true},{id:'two',caption:'次。',speech:'つぎ。',reviewed:true,audio:{file:'two.wav'},audioCurrent:true}]});assert.deepEqual([...ui.get('rows').walk()].filter(e=>e.dataset.rowId).map(e=>e.dataset.rowId),['one','two']);assert.ok([...ui.get('rows').walk()].some(e=>e.textContent==='01カット'));assert.equal(ui.get('confirm-full').disabled,false);await ui.get('confirm-full').emit('click');assert.equal(ui.requests.filter(r=>r.route==='confirm-cut').length,2);assert.equal(ui.requests.filter(r=>r.route==='finalize').length,1);assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);assert.equal(ui.location.hash,'#finish');const missing=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true}]});assert.equal(missing.get('confirm-full').disabled,true);
});

test('gender menu groups all male choices before female choices across both models and uses a single cached audio player for every pitch',async()=>{
 const samples=SAMPLE_SETTINGS.map((settings,i)=>({id:'cached-'+i,file:'cached-'+i+'.wav',settings,durationSeconds:5}));const ui=await setup({voices:VOICES,samples});
 const groups=ui.get('voice-preset').children.filter(e=>e.tagName==='optgroup');assert.deepEqual(groups.map(g=>g.attributes.label),['男性の声 / Gemini 3.8 Flash TTS','男性の声 / Gemini 3.8 Flash-Lite TTS','女性の声 / Gemini 3.8 Flash TTS','女性の声 / Gemini 3.8 Flash-Lite TTS']);
 assert.equal(groups.flatMap(g=>g.children).length,60);for(const group of groups)for(const option of group.children)assert.ok(option.textContent.includes(group.attributes.label.startsWith('男性')?'（男性）':'（女性）'));
 ui.get('voice-preset').value=MODELS[1]+'::Charon';await ui.get('voice-preset').emit('change');for(const pitch of ['standard','low','high']){await ui.edit(ui.get('pitch'),pitch);assert.equal(ui.get('preview-voice').hidden,true);assert.equal(ui.get('sample-audio').hidden,false);assert.ok(ui.get('sample-audio').src.endsWith(samples.find(s=>s.settings.model===MODELS[1]&&s.settings.voice==='Charon'&&(s.settings.pitch||'standard')===pitch).file));}
 assert.equal(ui.get('bank-tools').hidden,true);assert.match(ui.get('sample-progress').textContent,/180 \/ 180/);assert.equal(ui.requests.some(r=>['preview','prepare-samples','generate'].includes(r.route)),false);
});
test('reading review states applied voice/pitch without an inline navigation link, distinguishing unapplied choices',async()=>{const ui=await setup();assert.match(ui.get('production-voice-info').textContent,/Kore.*標準/);assert.ok(html.includes('声・ピッチの変更は'));assert.doesNotMatch(html,/<a href="#connection">声/);await ui.edit(ui.get('pitch'),'low');assert.match(ui.get('production-voice-info').textContent,/Kore.*標準.*未反映/);await ui.get('settings-form').emit('submit');assert.match(ui.get('production-voice-info').textContent,/Kore.*低め/);assert.equal(ui.requests.some(r=>r.route==='generate'),false);});
test('historical cut confirmations do not lock an editable revision or require an undo button',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,cutConfirmed:true,listenedCurrent:true}]});assert.equal(ui.textArea('one','speech').disabled,false);assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.editCut||e.dataset.confirmCut),false);await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');await ui.row('one').emit('click');assert.equal(ui.state().rows[0].audioCurrent,false);assert.equal(ui.state().rows[0].reviewed,true);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('final confirmation asks once, cancel changes nothing, and acceptance permanently locks content while allowing playback/export/key clearing',async()=>{
 const rows=[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:false}];
 const canceled=await setup({rows,confirmResult:false});await canceled.get('confirm-full').emit('click');assert.equal(canceled.confirmations.length,1);assert.match(canceled.confirmations[0],/修正版/);assert.equal(canceled.requests.some(r=>r.route==='confirm-cut'||r.route==='finalize'),false);assert.equal(canceled.textArea('one','speech').disabled,false);
 const ui=await setup({rows});await ui.get('confirm-full').emit('click');assert.equal(ui.confirmations.length,1);assert.equal(ui.requests.filter(r=>r.route==='finalize').length,1);assert.equal(ui.textArea('one','speech').disabled,true);assert.equal(ui.get('voice-preset').disabled,true);assert.equal(ui.get('pitch').disabled,true);assert.equal(ui.get('review-overall').disabled,true);assert.equal(ui.get('confirm-full').disabled,true);assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);ui.externalVideo({running:false,stage:'failed'});await ui.poll();assert.equal(ui.get('confirm-full').disabled,false);assert.equal(ui.get('full-audio').hidden,false);assert.equal(ui.get('clear-key').disabled,false);await ui.poll();assert.equal(ui.textArea('one','speech').disabled,true);assert.match(ui.get('handoff-info').textContent,/編集不可/);
});

// A deliberately small DOM boundary: production event handlers and rendering
// execute unchanged; only DOM/network/timers are replaced. No browser or Google
// request is made. The async wrapper supports the module's top-level await
// without requiring Node's experimental VM-module flag.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.value = '';
    this.textContent = '';
    this.checked = false;
    this.disabled = false;
    this.files = [];
    const classes=new Set();this.classList = {toggle(name,on) {if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)};
    this.style = {vars:new Map(),setProperty(key,value) {this.vars.set(key,value);}};
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  removeAttribute(name){delete this.attributes[name];if(name==='src')this.src='';}
  play(){this.played=true;return Promise.resolve();}
  pause(){this.paused=true;}
  focus(options){this.focusOptions=options;this.focused=true;}
  append(...children) {for(const child of children)child.parent=this;this.children.push(...children);}
  replaceChildren(...children) { this.children=[];this.append(...children); }
  addEventListener(name, listener) {
    const list = this.listeners.get(name) || [];
    list.push(listener);
    this.listeners.set(name, list);
  }
  async emit(name,event={preventDefault(){}}) {
    if (name === 'click'){assert.equal(this.disabled,false,'A user cannot click a disabled control');for(let p=this;p;p=p.parent)assert.equal(!!p.hidden,false,'A user cannot click a hidden control or hidden ancestor');}
    for (const listener of this.listeners.get(name) || []) await listener(event);
  }
  *walk() {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
}

test('source planning applies automatic title/voice, preserves manual choices, keeps real proposal for review',async()=>{
 const sourcePlan={script:'入口です。',readings:[{caption:'入口です。',speech:'いりぐちです。'}],storyboard:{title:'AIのタイトル',summary:'資料の構成',voice:'Puck',voiceReason:'明るい説明',sources:[{id:'text',label:'本文',status:'provided',summary:'入口'}],scenes:[{caption:'入口です。',title:'入口',points:['最初の一歩'],imageFile:'',sourceIds:['text']}],motion:{version:1,style:'editorial',intensity:'standard'}}};
 for(const mode of ['auto','manual']){const ui=await setup({sourcePlan,rows:[]});await ui.edit(ui.get('source-text'),'資料本文');await ui.edit(ui.get('production-instructions'),'短い説明動画');ui.get('auto-direction').checked=mode==='auto';await ui.get('auto-direction').emit('change');await ui.edit(ui.get('voice-mode'),mode);await ui.get('generate-script').emit('click');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.state().title,'Original title');assert.equal(ui.state().settings.voice,'Kore');assert.equal(ui.state().production.brief.storyboard.title,'AIのタイトル');assert.equal(ui.requests.some(r=>['approve','generate','finalize'].includes(r.route)),false);assert.equal(ui.get('storyboard-preview').hidden,false);const voice=[...ui.get('storyboard-preview').walk()].find(e=>e.attributes.class==='voice-proposal');assert.equal(voice.children[0].textContent,'声の提案：Puck');assert.equal(voice.children[1].textContent,'明るい説明');await ui.edit(ui.get('script-input'),'書き換え。');await ui.get('save-production').emit('click');assert.equal(ui.state().production.brief.storyboard,undefined);}
});
test('failed source request preserves existing script and title without automatic paid retry',async()=>{const ui=await setup({sourceError:'SOURCE_URL_NOT_RETRIEVED'});await ui.edit(ui.get('source-urls'),'https://example.com/reference');await ui.edit(ui.get('script-input'),'保持する台本。');await ui.edit(ui.get('production-instructions'),'説明動画');await ui.sendScript({confirmOverwrite:true});assert.equal(ui.get('script-input').value,'保持する台本。');assert.equal(ui.state().title,'Original title');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.match(ui.get('source-status').textContent,/取得成功を確認できません/);});
test('reference-only inputs enable the single planning action without extra instructions',async()=>{
 for(const [id,value] of [['source-urls','https://example.com/article'],['source-text','参考資料の本文']]){
  const ui=await setup({rows:[]});
  assert.equal(ui.get('generate-script').disabled,true);
  await ui.edit(ui.get(id),value);
  assert.equal(ui.get('production-instructions').value,'');
  assert.equal(ui.get('generate-script').disabled,false);
 }
 const empty=await setup({rows:[]});await empty.edit(empty.get('source-urls'),' \n ');
 assert.equal(empty.get('generate-script').disabled,true);
 empty.restart();await empty.poll();assert.equal(empty.get('generate-script').disabled,true);
});

async function setup({titleReading,imageProposal,motion,autoConfirm=false,voiceConfirmed=true,productionErrorAt=0,strictProductionRevision=false,materialConcurrentEdit=false,sourcePlan,sourceError,rows,samples,assets=[],previewError,rowError,draftWait,pausedStep,confirmResult=true,secondReviewed = true,voices=['Kore','Puck']} = {}) {
  const elements = new Map();let anonymous=0;
  const tree=new Element('root'),stack=[tree],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for(const [token,closing,tag,attributes] of html.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)){
   if(closing){for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag){stack.length=i;break;}continue;}
   const node=new Element(tag),id=attributes.match(/\bid="([^"]+)"/)?.[1];
   for(const [,name,value]of attributes.matchAll(/\b(data-[\w-]+)(?:="([^"]*)")?/g))node.setAttribute(name,value||'');
   node.hidden=/\bhidden(?:\s|>|=|$)/.test(attributes);node.disabled=/\bdisabled(?:\s|>|=|$)/.test(attributes);node.checked=/\bchecked(?:\s|>|=|$)/.test(attributes);
   if(id)node.setAttribute('id',id);stack.at(-1).append(node);if(id||attributes.includes('data-cancel')||attributes.includes('data-revise-step'))elements.set(id||'anonymous-'+ ++anonymous,node);if(!voids.has(tag)&&!token.endsWith('/>'))stack.push(node);
  }
  const all = () => [...new Set([...elements.values()].flatMap(element => [...element.walk()]))];
  const matches = (element, selector) => {
    if(selector==='main')return element.tagName==='main';
    if(selector==='#rows audio')return element.tagName==='audio'&&[...elements.get('rows').walk()].includes(element);
    if(selector==='.design-sample .preview-heading,.design-sample .preview-points')return ['preview-heading','preview-points'].some(c=>element.classList.contains?.(c));
    if(selector==='audio,video')return ['audio','video'].includes(element.tagName);
    const match = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    assert.ok(match, 'Extend the test DOM explicitly if the UI needs another selector');
    const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return Object.hasOwn(element.dataset, key) && (match[2] === undefined || element.dataset[key] === match[2]);
  };
  const document = {
    getElementById: id => elements.get(id),
    createElement: tag => new Element(tag),
    querySelector: selector => all().find(element => matches(element, selector)) || null,
    querySelectorAll: selector => all().filter(element => matches(element, selector)),
    documentElement: new Element('html'),
  };
  let state = {
    imageProposal,title: 'Original title', revision: 'revision-0', instanceId: 'instance-1', sessionId: 'fixture-session',
    keyConfigured: true, busy: false, error: null, progress: null,video:{available:true,running:false,stage:'idle',progress:0,result:null,error:null},
    settings: {model: 'gemini-3.8-flash-tts', voice: 'Kore', style: 'Original style'},
    presentation: {theme: 'moon',...(motion?{motion}:{})}, dictionary: [], voices,voiceGenders:VOICE_GENDERS,
    voiceConfirmed,production:{brief:{scriptMode:'ai',assetMode:'mixed',instructions:'',script:'',...(titleReading?{titleReading}:{})},assets:[]},samples:[{id:'sample-kore',file:'sample-kore.wav',settings:{model:'gemini-3.8-flash-tts',voice:'Kore',style:'Original style'},durationSeconds:1},{id:'sample-puck',file:'sample-puck.wav',settings:{model:'gemini-3.8-flash-tts',voice:'Puck',style:'明るく親しみやすい日本語で、聞き取りやすく話す。'},durationSeconds:2}],
    rows: ['one', 'two'].map(id => ({id, caption: 'Caption ' + id, speech: 'Speech ' + id, scene: '', reviewed: id === 'one' || secondReviewed, attempts: 0, hints: [], audio: null, audioCurrent: false, listenedCurrent: false})),
  };
  state.projectId='original';state.projects=[{id:'original',title:state.title}];const savedProjects=new Map();
  if(rows)state.rows=rows.map((r,i)=>({id:'row-'+i,scene:'',reviewed:false,attempts:0,hints:[],audio:null,...r}));
  if(samples)state.samples=samples;
  state.production.assets=assets;
  if(strictProductionRevision){state.productionRevision='inputs-0';state.production.musicEnabled=true;}
  let token = 'fixture-token-1', revision = 0;
  const requests = [], intervals = [], confirmations=[];
  const fetch = async (url, options = {}) => {
    const route = url.replace('/api/', '').split('?')[0], input = typeof options.body==='string' ? JSON.parse(options.body) : undefined;
    requests.push({route, input, headers: options.headers});
    const reply = (value, ok = true) => ({ok, json: async () => structuredClone(value)});
    if (route === 'bootstrap') return reply({token, instanceId: state.instanceId});
    if (route === 'status') return reply({...state,fullAudioRevision:state.revision+'-'+state.rows.map(r=>r.audio?.file||'').join('-')});
    if (route === 'themes') return reply([{name: 'moon', background: '#002b36', foreground: '#93a1a1', heading: '#eee8d5', accent: '#268bd2'}]);
    if (route === 'designs') return reply(VIDEO_TEMPLATES);
    if (options.headers?.['X-Narration-Token'] !== token) return reply({error: 'CSRF_TOKEN_REQUIRED'}, false);
    if(route==='approve-images'){const choices=state.imageProposal.scenes.filter(s=>!input.id||s.id===input.id);for(const scene of choices)state.rows.find(r=>r.id===scene.id).cutImage={file:scene.imageFile};state.imageProposal=null;return reply(state);}
    if(route==='material'){
      const bytes=await options.body.arrayBuffer(),file=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')+'.png';
      state.production.assets.push({name:options.body.name,file,size:bytes.byteLength});state.productionRevision='inputs-material';
      if(materialConcurrentEdit)state.production.brief.instructions='他の画面で編集';return reply(state);
    }
    if(route==='render-video'){if(!state.production.finalization)return reply({error:'FINAL_CONFIRMATION_REQUIRED'},false);state.video={...state.video,running:true,stage:'rendering',progress:.4,renderedFrames:40,totalFrames:100,steps:['preparing','bundling','rendering']};return reply({started:true});}
    if(route==='new-project'||route==='project'||route==='revision-project'){
      savedProjects.set(state.projectId,structuredClone(state));const id=route==='new-project'?'new-project':route==='revision-project'?'revision-project':input.id;
      const list=state.projects,keyConfigured=state.keyConfigured,samples=state.samples;
      if(route==='new-project'){list.push({id,title:'新しい動画'});state={...structuredClone(state),title:'新しい動画',sessionId:'new-session',projectId:id,rows:[],dictionary:[],presentation:{theme:'moon'},voiceConfirmed:false,production:{musicEnabled:true,voiceConfirmation:null,brief:{...FRESH_BRIEF},assets:[],finalization:null},video:{available:true,running:false,stage:'idle',result:null},projects:list};}
      else if(route==='revision-project'){list.push({id,title:state.title+'（修正版）'});state={...structuredClone(state),projectId:id,sessionId:'revision-session',production:{...structuredClone(state.production),finalization:null,cutConfirmations:[]},projects:list,video:{available:true,running:false,stage:'idle',result:null}};for(const row of state.rows)row.cutConfirmed=false;}else state={...structuredClone(savedProjects.get(id)),projects:list,keyConfigured,samples};
      token='fixture-token-project-'+id;state.instanceId='instance-project-'+id;
    }
    else if (route === 'key') state.keyConfigured = !input.clear;
    else if (route === 'title') state.title = input.title;
    else if (route === 'settings') {const {candidate,...settings}=input;state.settings=settings;state.voiceConfirmed=candidate!==true;}
    else if(route==='presentation')state.presentation=input.presentation||{...state.presentation,theme:input.theme};
    else if(route==='design-draft'){if(!input.consent)return reply({error:'GENERATION_CONSENT_REQUIRED'},false);state.presentation={theme:state.presentation.theme,mode:'ai',instructions:input.instructions,design:{...VIDEO_TEMPLATES[0].design,name:'AI design'}};}
    else if(route==='generate'){if(!input.consent)return reply({error:'GENERATION_CONSENT_REQUIRED'},false);for(const id of input.ids){const row=state.rows.find(r=>r.id===id);if(!row.reviewed)return reply({error:'READING_REVIEW_REQUIRED'},false);if(row.attempts&&!input.regenerate)return reply({error:'REGENERATION_CONFIRM_REQUIRED'},false);}for(const id of input.ids){const row=state.rows.find(r=>r.id===id);Object.assign(row,{attempts:row.attempts+1,audio:{file:id+'.wav'},audioCurrent:true,listenedCurrent:false,cutConfirmed:false});}}
    else if(route==='cut-image'){const row=state.rows.find(r=>r.id===input.id);row.cutImage=state.production.assets.find(a=>a.file===input.file);row.cutConfirmed=false;}else if(route==='listened')state.rows.find(r=>r.id===input.id).listenedCurrent=true;
    else if(route==='confirm-cut'){const row=state.rows.find(r=>r.id===input.id);row.listenedCurrent=true;row.cutConfirmed=true;state.production.requiresFinalization=true;}
    else if(route==='reopen-cut'){const row=state.rows.find(r=>r.id===input.id);row.listenedCurrent=false;row.cutConfirmed=false;}
    else if(route==='finalize'){assert.equal(input.confirmIrreversible,true);state.production.finalization={revision:state.revision,inputsHash:'fixture-hash'};state.projects.find(p=>p.id===state.projectId).finalized=true;}
    else if(route==='cancel'){state.busy=false;if(state.video.running)state.video={...state.video,running:false,canceling:false,stage:'canceled',error:'VIDEO_RENDER_CANCELED',result:null};}
    else if(route==='apply-review'){if(!input.consent)return reply({error:'GENERATION_CONSENT_REQUIRED'},false);const ids=input.id?[input.id]:input.review.cuts.map(c=>c.rowId);for(const id of ids){const row=state.rows.find(r=>r.id===id);Object.assign(row,{caption:'修正後。',speech:'しゅうせいご。',reviewed:false,audioCurrent:false,cutConfirmed:false});}state.production.review={...input.review,overall:input.id?input.review.overall:'',cuts:input.review.cuts.filter(c=>!ids.includes(c.rowId))};state.correctionResult={ids,images:0,textChanged:ids.length};}
    else if(route==='review'){if(input.expectedRevision!==state.revision)return reply({error:'STALE_REVISION'},false);state.production.review=input.review;}
    else if(route==='music-preference')state.production.musicEnabled=input.enabled;
    else if (route === 'production') {if(strictProductionRevision&&input.productionRevision!==state.productionRevision||productionErrorAt&&requests.filter(r=>r.route==='production').length===productionErrorAt)return reply({error:'STALE_REVISION'},false);state.production.brief=input;}
    else if(route==='adopt-script'){state.rows=input.script.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((caption,i)=>({id:'adopted-'+i,caption,speech:input.readings?.[i]?.speech||(/^[ぁ-ゖー。！？、\s]+$/.test(caption)?caption:''),readingState:input.readings?'ready':'pending',reviewed:false,attempts:0,hints:[],audioCurrent:false}));}
    else if (route === 'append-script') {const rows=[{id:'added',caption:input.script,speech:input.readings?.[0]?.speech||input.script,reviewed:false,attempts:0,hints:[]}];if(input.replace)state.rows=rows;else state.rows.push(...rows);}
    else if (route === 'preview') {if(previewError&&requests.filter(r=>r.route==='preview').length===previewError)return reply({error:'PROVIDER_RATE_LIMIT'},false);const id='sample-'+state.samples.length;state.samples.push({id,file:id+'.wav',settings:input.settings,durationSeconds:5});return reply({sample:id});}
    else if(route==='prepare-samples'){const configs=SAMPLE_SETTINGS.filter(c=>voices.includes(c.voice));const missing=configs.filter(c=>!state.samples.some(s=>s.settings.model===c.model&&s.settings.voice===c.voice&&s.settings.style===c.style&&(s.settings.pitch||'standard')===(c.pitch||'standard')));state.sampleProgress={running:false,total:missing.length,completed:0};for(const config of missing){if(previewError&&state.sampleProgress.completed+1===previewError){state.error='PROVIDER_RATE_LIMIT';break;}const id='sample-'+state.samples.length;state.samples.push({id,file:id+'.wav',settings:config,durationSeconds:5});state.sampleProgress.completed++;}return reply({started:true,total:missing.length});}
    else if(route==='source-plan'){if(sourceError)return reply({error:sourceError},false);assert.equal(input.consent,true);const result={...sourcePlan,...(input.brief.autoDirection?{direction:sourcePlan?.direction||{title:sourcePlan?.storyboard?.title||'AIのタイトル',template:'steps',motion:{version:1,style:'editorial',intensity:'standard'}}}:{}),saved:true};state.production.brief={...input.brief,script:result.script,readings:result.readings,titleReading:result.titleReading,storyboard:result.storyboard,direction:result.direction,scriptEdited:true};state.production.authoring={version:1,lastAttempt:{sequence:input.sequence,result}};return reply(result);}
    else if (route === 'draft') {if(draftWait){state.busy=true;await draftWait;state.busy=false;return reply({error:'CANCELED'},false);}const script=input.brief.autoDirection&&input.brief.scriptMode==='existing'&&input.brief.script?input.brief.script:'AI draft result';const result={script,readings:[{caption:script,speech:script==='AI draft result'?'えーあいだいほん。':script}],...(input.brief.autoDirection?{direction:{title:'AIのタイトル',template:'steps',motion:{version:1,style:'editorial',intensity:'standard'}}}:{}),saved:true};state.production.brief={...input.brief,script,readings:result.readings,direction:result.direction,scriptEdited:true};state.production.authoring={version:1,lastAttempt:{sequence:input.sequence,result}};return reply(result);}
    else if (route === 'approve') {
      if (input.revision !== state.revision) return reply({error: 'STALE_REVISION'}, false);
      state.rows.find(row => row.id === input.id).reviewed = true;
    } else if(route==='unapprove'){if(input.revision!==state.revision)return reply({error:'STALE_REVISION'},false);for(const row of state.rows)Object.assign(row,{reviewed:false,listenedCurrent:false,cutConfirmed:false});
    } else if (route === 'row') {if(rowError)return reply({error:'ROW_SAVE_FAILED'},false);Object.assign(state.rows.find(row => row.id === input.id), input, {reviewed: false,audioCurrent:false,listenedCurrent:false,cutConfirmed:false});}
    else throw new Error('Unexpected test request: ' + route);
    state.revision = 'revision-' + ++revision;
    return reply(state);
  };
  const storage=new Map(pausedStep?[['narration-paused:original',pausedStep]]:[]);
  const context = vm.createContext({ResizeObserver:class {observe(){}},MutationObserver:class {observe(){}},requestAnimationFrame:callback=>callback(),scriptActionState,parseScriptParts,document, fetch, setInterval: callback => {intervals.push(callback);}, window: {sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},location:{hash:''},confirm: message => {confirmations.push(message);return confirmResult;}}, crypto: {randomUUID: () => 'fixture-id',subtle:crypto.subtle}});
  await vm.runInContext('(async () => {\n' + appSource + '\n})()', context, {filename: 'ui/app.mjs'});
  const get = id => {assert.ok(elements.has(id), 'UI element exists: ' + id); return elements.get(id);};
  const row = id => [...get('rows').walk()].find(element => element.dataset.approve === id);
  const textArea = (id, kind) => {
    const index = state.rows.findIndex(row => row.id === id) + 1;
    return [...get('rows').walk()].find(element => element.attributes['aria-label'] === `${index}場面・1文目の${kind === 'caption' ? '字幕' : '読み上げ文'}`);
  };
  const edit = async (element, value) => {
    let hidden=[];for(let p=element;p;p=p.parent)if(p.hidden)hidden.push(p.attributes.id);
    if(hidden.includes('connection')){const link=all().find(e=>e.dataset.goStep==='connection');await link.emit('click');}
    if(hidden.includes('custom-settings')){get('voice-preset').value='custom';await get('voice-preset').emit('change');}
    if(hidden.includes('manual-direction')){get('auto-direction').checked=false;await get('auto-direction').emit('change');}
    for(let p=element;p;p=p.parent)assert.equal(!!p.hidden,false,'A user cannot edit a hidden field or hidden ancestor');
    assert.equal(element.disabled,false,'A user cannot edit a disabled field');element.value = value; await element.emit('input');};

  // Drive the same explicit in-page decision as a user; individual tests can pause before it.
  for(const element of elements.values()){const emit=element.emit.bind(element);element.emit=async(name,...args)=>{await emit(name,...args);if(name==='click'&&autoConfirm&&element!==get('confirm-script-action')&&element!==get('cancel-script-action')&&!get('script-confirm').hidden)await get(confirmResult?'confirm-script-action':'cancel-script-action').emit('click');};}
  return {
    get, row, textArea, edit, requests, confirmations, location:context.window.location,sendScript:async({confirmOverwrite=false}={})=>{const button=get('generate-script').hidden?get('regenerate-script'):get('generate-script');await button.emit('click');if(!get('script-confirm').hidden)await get(confirmOverwrite?'confirm-script-action':'cancel-script-action').emit('click');},
    observeScroll: callback => {context.window.scrollTo=callback;},
    state: () => structuredClone(state),
    poll: async () => {assert.equal(intervals.length, 1); await intervals[0]();},
    restart: () => {state.instanceId = 'instance-2'; state.keyConfigured = false; token = 'fixture-token-2';},
    externalEdit: (id,input) => {Object.assign(state.rows.find(r=>r.id===id),input,{reviewed:false});state.revision='revision-'+ ++revision;},
    updateAssets: assets=>{state.production.assets=assets;},
    externalVideo:value=>{state.video={...state.video,...value};},
    externalRevision:()=>{state.revision='revision-'+ ++revision;},externalBusy:value=>{state.busy=value;},externalFinalize:()=>{state.production.finalization={revision:state.revision,inputsHash:'fixture-hash'};},
    externalMusic:(music,current=true)=>{state.production.music=music;state.musicCurrent=current;},
    externalCutInfo: (id,value)=>Object.assign(state.rows.find(r=>r.id===id),value),
  };
}

test('BGM removal stops preview; stale BGM blocks final confirmation without paid retry',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'制作。',speech:'せいさく。',reviewed:true,audio:{file:'one.wav',durationSeconds:3},audioCurrent:true,listenedCurrent:true}]});
 const music={file:'a'.repeat(64)+'.mp3',durationSeconds:30,level:.16};ui.externalMusic(music);await ui.poll();assert.equal(ui.get('music-result').hidden,false);assert.match(ui.get('music-player').src,/api\/music-audio/);
 ui.get('music-player').paused=false;ui.externalMusic(undefined);await ui.poll();assert.equal(ui.get('music-player').paused,true);assert.equal(ui.get('music-player').src,'');assert.equal(ui.get('music-result').hidden,true);
 ui.externalMusic(music,false);await ui.poll();assert.equal(ui.get('confirm-full').disabled,true);assert.equal(ui.requests.some(r=>r.route==='generate-music'),false);
});
test('BGM level and cut pause capture the selected value before busy-state rendering resets controls',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'制作。',speech:'せいさく。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:true}]});ui.externalMusic({file:'a'.repeat(64)+'.mp3',durationSeconds:30,level:.16});await ui.poll();
 ui.get('music-level').value='0.24';await ui.get('music-level').emit('change');assert.equal(ui.requests.findLast(r=>r.route==='music').input.level,.24);
 ui.get('cut-pause').value='0.8';await ui.get('cut-pause').emit('change');assert.equal(ui.requests.findLast(r=>r.route==='cut-pause').input.seconds,.8);assert.equal(ui.requests.some(r=>r.route==='generate-music'),false);
});

for (const action of ['key', 'title', 'settings', 'other-row approval']) {
  test('unsaved row caption and reading survive ' + action, async () => {
    const ui = await setup({secondReviewed: action !== 'other-row approval'});
    await ui.edit(ui.textArea('one', 'caption'), 'Unsaved caption');
    await ui.edit(ui.textArea('one', 'speech'), 'Unsaved reading');
    assert.equal(ui.get('generate-all').disabled, true);
    if (action === 'key') {
      ui.get('api-key').value = 'test-fixture-not-a-real-key';
      await ui.get('key-form').emit('submit');
      assert.equal(ui.get('api-key').value, '');
    } else if (action === 'title') {
      await ui.edit(ui.get('job-title'), 'Changed title');
      await ui.get('save-title').emit('click');
      assert.equal(ui.state().title, 'Changed title');
    } else if (action === 'settings') {
      await ui.edit(ui.get('style'), 'Changed style');
      await ui.get('settings-form').emit('submit');
      assert.equal(ui.state().settings.style, 'Changed style');
    } else {
      await ui.row('two').emit('click');
      assert.equal(ui.state().rows[1].reviewed, true);
    }
    await ui.poll();
    assert.equal(ui.textArea('one', 'caption').value, 'Unsaved caption');
    assert.equal(ui.textArea('one', 'speech').value, 'Unsaved reading');
    assert.equal(ui.state().rows[0].caption, 'Caption one');
    assert.equal(ui.state().rows[0].speech, 'Speech one');
    assert.equal(ui.get('generate-all').disabled, true);
    assert.equal(ui.requests.some(request => request.route === 'generate'), false);
  });
}

for (const first of ['title', 'settings']) {
  test('saving ' + first + ' preserves the other dirty form until it is saved', async () => {
    const ui = await setup();
    assert.equal(ui.get('generate-all').disabled, false);
    await ui.edit(ui.get('job-title'), 'Draft title');
    await ui.edit(ui.get('style'), 'Draft style');
    if (first === 'title') await ui.get('save-title').emit('click');
    else await ui.get('settings-form').emit('submit');
    await ui.poll();
    assert.equal(ui.get('job-title').value, 'Draft title');
    assert.equal(ui.get('style').value, 'Draft style');
    assert.equal(ui.get('generate-all').disabled, first==='title');
    assert.equal(ui.state().title, 'Draft title');
    assert.equal(ui.state().settings.style, first === 'settings' ? 'Draft style' : 'Original style');
    if (first === 'title') await ui.get('settings-form').emit('submit');
    else await ui.get('save-title').emit('click');
    assert.equal(ui.get('generate-all').disabled, false);
    assert.equal(ui.state().title, 'Draft title');
    assert.equal(ui.state().settings.style, 'Draft style');
  });
}

test('instance change refreshes bootstrap token without losing the unsaved reading', async () => {
  const ui = await setup();
  await ui.edit(ui.textArea('one', 'speech'), 'Reading survives restart');
  ui.restart();
  await ui.poll();
  assert.equal(ui.textArea('one', 'speech').value, 'Reading survives restart');
  assert.match(ui.get('key-state').textContent, /未設定/);
  assert.equal(ui.get('key-reset-notice').hidden,false);
  assert.equal(ui.requests.filter(request => request.route === 'bootstrap').length, 2);
  ui.get('api-key').value = 'test-fixture-not-a-real-key';
  await ui.get('key-form').emit('submit');
  const request = ui.requests.findLast(request => request.route === 'key');
  assert.equal(request.headers['X-Narration-Token'], 'fixture-token-2');
  assert.equal(ui.state().keyConfigured, true);
  assert.equal(ui.textArea('one', 'speech').value, 'Reading survives restart');
  assert.equal(ui.get('api-key').value, '');
  assert.equal(ui.get('key-reset-notice').hidden,true);
  await ui.get('clear-key').emit('click');assert.equal(ui.get('key-reset-notice').hidden,true);
});

test('batch correction sends pending instructions once, preserves untouched audio, and requires fresh reading before rebuilding changed audio',async()=>{
 const rows=[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'one.wav'},audioCurrent:true},{id:'two',caption:'次。',speech:'つぎ。',reviewed:true,attempts:1,audio:{file:'two.wav'},audioCurrent:true}];const ui=await setup({rows});const note=[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');await ui.edit(note,'説明を短くする');assert.equal(ui.get('confirm-full').disabled,true);await ui.get('apply-review').emit('click');await ui.poll();assert.match(ui.get('review-request-state').textContent,/01カットを修正しました/);assert.equal(ui.requests.filter(r=>r.route==='apply-review').length,1);assert.equal(ui.requests.find(r=>r.route==='apply-review').input.consent,true);assert.equal(ui.state().rows[0].audioCurrent,false);assert.equal(ui.state().rows[1].audio.file,'two.wav');assert.equal(ui.state().rows[1].audioCurrent,true);assert.equal(ui.requests.some(r=>['generate','approve','finalize'].includes(r.route)),false);assert.equal(ui.get('generate-all').disabled,true);await ui.get('confirm-script').emit('click');assert.equal(ui.get('generate-all').disabled,true);await ui.get('retry-audio').emit('click');await ui.get('retry-confirm-send').emit('click');const call=ui.requests.find(r=>r.route==='generate');assert.deepEqual(call.input.ids,['one']);assert.equal(call.input.regenerate,true);assert.equal(ui.state().rows[1].audio.file,'two.wav');
});
test('individual correction applies only that cut and preserves other pending instructions; missing key cannot submit',async()=>{
 const ui=await setup();for(const n of [1,2])await ui.edit([...ui.get('rows').walk()].find(e=>e.attributes['aria-label']===n+'カットへの修正指示'),'直す');await ui.edit(ui.get('review-overall'),'全体を見直す');await [...ui.get('rows').walk()].find(e=>e.dataset.applyReview==='one').emit('click');assert.equal(ui.requests.find(r=>r.route==='apply-review').input.id,'one');assert.equal(ui.get('review-overall').value,'全体を見直す');assert.equal([...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='2カットへの修正指示').value,'直す');ui.restart();await ui.poll();assert.equal(ui.get('apply-review').disabled,true);assert.equal([...ui.get('rows').walk()].find(e=>e.dataset.applyReview==='two').disabled,true);
});

test('bookend edits survive polling, block final approval and save without generation',async()=>{
 const ui=await setup();await ui.edit(ui.get('opening-title'),'制作の紹介');await ui.edit(ui.get('opening-speech'),'せいさくのしょうかい');await ui.poll();assert.equal(ui.get('opening-title').value,'制作の紹介');assert.equal(ui.get('confirm-full').disabled,true);
 await ui.get('save-bookends').emit('click');const call=ui.requests.find(r=>r.route==='bookends');assert.equal(call.input.owner,'FURU');assert.equal(call.input.endUrl,'https://note.com/happy_duck780');assert.equal(call.input.endSeconds,4);assert.equal(call.input.speech,'せいさくのしょうかい');assert.equal(ui.requests.some(r=>['generate','generate-music','finalize'].includes(r.route)),false);
});

for(const buttonId of ['new-project','new-project-bottom'])test(buttonId+' starts an empty project at the page top and preserves the completed project and key',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});
 await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'complete'});await ui.poll();const original=ui.state();
 let scroll;ui.observeScroll(value=>{scroll=value;});await ui.get(buttonId).emit('click');
 assert.equal(ui.location.hash,'#top');assert.equal(scroll.top,0);assert.equal(scroll.behavior,'instant');assert.equal(ui.get('new-project').focused,true);
 assert.equal(ui.state().rows.length,0);assert.equal(ui.state().production.assets.length,0);assert.equal(ui.state().keyConfigured,true);
 assert.equal(ui.requests.filter(r=>r.route==='new-project').length,1);assert.equal(ui.requests.some(r=>['generate','generate-music','source-plan'].includes(r.route)),false);
 ui.get('project-select').value='original';await ui.get('project-select').emit('change');assert.deepEqual(ui.state().production.finalization,original.production.finalization);assert.deepEqual(ui.state().rows,original.rows);
});
test('bottom new video control shares unsaved and active work guards',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'未保存');assert.equal(ui.get('new-project-bottom').disabled,true);
 await ui.get('save-production').emit('click');assert.equal(ui.get('new-project-bottom').disabled,false);
 ui.externalVideo({running:true});await ui.poll();assert.equal(ui.get('new-project-bottom').disabled,true);
 ui.externalVideo({running:false});ui.externalBusy(true);await ui.poll();assert.equal(ui.get('new-project-bottom').disabled,true);assert.equal(ui.requests.some(r=>r.route==='new-project'),false);
});
test('existing BGM precedes optional recreation, missing BGM opens creation, polling retains user disclosure choice',async()=>{
 assert.ok(html.indexOf('id="music-status"')<html.indexOf('id="music-result"'));assert.ok(html.indexOf('id="music-result"')<html.indexOf('id="music-create"'));assert.ok(html.indexOf('id="music-create"')<html.indexOf('id="generate-music"'));
 assert.ok(html.indexOf('id="new-project-bottom"')>html.indexOf('id="manifest"'));
 const ui=await setup();assert.equal(ui.get('music-create').open,true);
 ui.externalMusic({file:'a'.repeat(64)+'.mp3',durationSeconds:30,level:.24});await ui.poll();assert.equal(ui.get('music-create').open,false);assert.equal(ui.get('music-result').hidden,false);
 ui.get('music-create').open=true;await ui.poll();assert.equal(ui.get('music-create').open,true);
 ui.externalMusic(undefined);await ui.poll();assert.equal(ui.get('music-create').open,true);assert.equal(ui.get('music-result').hidden,true);assert.equal(ui.requests.some(r=>r.route==='generate-music'),false);
});

test('reference intake: URL or text alone enables generation while empty, busy and missing-key states remain blocked',async()=>{
 const button=html.includes('id="generate-script"')?'generate-script':'plan-sources';
 for(const [id,value]of [['source-urls','https://example.com/article'],['source-text','資料の内容です。']]){
  const ui=await setup({rows:[]});assert.equal(ui.get(button).disabled,true);
  await ui.edit(ui.get(id),value);assert.equal(ui.get('production-instructions').value,'');assert.equal(ui.get(button).disabled,false);
  ui.externalBusy(true);await ui.poll();assert.equal(ui.get(button).disabled,true);
  ui.externalBusy(false);await ui.poll();assert.equal(ui.get(button).disabled,false);
  ui.restart();await ui.poll();assert.equal(ui.get(button).disabled,true);
 }
 const empty=await setup({rows:[]});await empty.edit(empty.get('source-urls'),' \n ');assert.equal(empty.get(button).disabled,true);
});
test('reference intake: new projects clear saved references and resuming the original restores its own inputs',async()=>{
 const ui=await setup();await ui.edit(ui.get('source-urls'),'https://example.com/saved');await ui.edit(ui.get('source-text'),'保存した資料');
 await ui.get('save-production').emit('click');await ui.get('new-project').emit('click');
 assert.equal(ui.get('source-urls').value,'');assert.equal(ui.get('source-text').value,'');assert.equal(ui.get('production-instructions').value,'');
 assert.equal(ui.requests.some(r=>['source-plan','generate','draft'].includes(r.route)),false);
 ui.get('project-select').value='original';await ui.get('project-select').emit('change');
 assert.equal(ui.get('source-urls').value,'https://example.com/saved');assert.equal(ui.get('source-text').value,'保存した資料');
});
test('reference intake: browser autocomplete cannot supply previous planning text as initial values',()=>{
 for(const id of ['source-text','source-urls','production-instructions','script-input']){
  const tag=html.match(new RegExp('<textarea[^>]*id="'+id+'"[^>]*>'))?.[0];assert.ok(tag);assert.match(tag,/autocomplete="off"/);
 }
});

test('script authoring: explicit AI theme enables exactly one draft without automatic import or narration',async()=>{
 const ui=await setup({rows:[]}),button=html.includes('id="generate-script"')?'generate-script':'plan-sources';
 await ui.edit(ui.get('script-mode'),'ai');assert.equal(ui.get(button).disabled,true);
 ui.get('theme-auto').checked=true;await ui.get('theme-auto').emit('change');assert.equal(ui.get(button).disabled,false);
 await ui.get(button).emit('click');const calls=ui.requests.filter(r=>['draft','source-plan'].includes(r.route));assert.equal(calls.length,1);assert.equal(calls[0].route,'draft');assert.equal(calls[0].input.brief.themeAuto,true);assert.equal(calls[0].input.consent,true);
 assert.ok(ui.get('script-input').value);assert.equal(ui.get('script-input').disabled,false);assert.equal(ui.requests.some(r=>['append-script','generate','render-video'].includes(r.route)),false);
});
test('script authoring: result supports direct typing, editing, confirmed clearing and saving empty without resurrecting loaded rows',async()=>{
 const ui=await setup(),original=ui.state().rows;await ui.edit(ui.get('script-input'),'自分で入力した台本。');await ui.edit(ui.get('script-input'),'編集した台本。');
 assert.equal(ui.requests.some(r=>['draft','source-plan','generate'].includes(r.route)),false);
 await ui.get('clear-script').emit('click');await ui.get('confirm-script-action').emit('click');assert.equal(ui.get('script-input').value,'');assert.equal(ui.get('append-script').disabled,true);
 await ui.get('save-production').emit('click');await ui.poll();assert.equal(ui.get('script-input').value,'');assert.equal(ui.state().production.brief.scriptEdited,true);assert.deepEqual(ui.state().rows,original);
 await ui.edit(ui.get('script-input'),'新しく入力した台本。');assert.equal(ui.get('script-input').value,'新しく入力した台本。');assert.equal(ui.requests.some(r=>['draft','source-plan','generate','append-script'].includes(r.route)),false);
});
test('script authoring: canceled clearing preserves the draft and finalized/busy inputs cannot be cleared',async()=>{
 const ui=await setup({confirmResult:false}),before=ui.get('script-input').value;await ui.get('clear-script').emit('click');assert.equal(ui.get('script-input').value,before);assert.equal(ui.requests.some(r=>['draft','source-plan','production'].includes(r.route)),false);
 ui.externalBusy(true);await ui.poll();assert.equal(ui.get('clear-script').disabled,true);assert.equal(ui.get('theme-auto').disabled,true);ui.externalBusy(false);ui.externalFinalize();await ui.poll();assert.equal(ui.get('clear-script').disabled,true);assert.equal(ui.get('theme-auto').disabled,true);
});
test('script authoring: canceled regeneration keeps manual text and sends nothing',async()=>{
 const ui=await setup({rows:[],confirmResult:false}),button=html.includes('id="regenerate-script"')?'regenerate-script':'plan-sources';await ui.edit(ui.get('script-mode'),'ai');await ui.edit(ui.get('production-instructions'),'短い説明');await ui.edit(ui.get('script-input'),'編集中の台本。');await ui.get(button).emit('click');
 assert.equal(ui.get('script-input').value,'編集中の台本。');assert.equal(ui.requests.some(r=>['draft','source-plan','production'].includes(r.route)),false);
});
test('script authoring: input, send and editable result share one ordered block instead of an alternative disclosure',()=>{
 const button=html.includes('id="generate-script"')?'generate-script':'plan-sources',start=html.indexOf('class="script-authoring"'),end=html.indexOf('id="clear-script"');assert.ok(start>=0);assert.ok(start<html.indexOf('id="production-instructions"'));assert.ok(html.indexOf('id="production-instructions"')<html.indexOf('id="'+button+'"'));assert.ok(html.indexOf('id="'+button+'"')<html.indexOf('id="script-input"'));assert.ok(end>html.indexOf('id="script-input"'));assert.match(html,/<details class="text-only-alternative" hidden>/);
});

test('script authoring: a specified theme uses the same send action and editing remains available without a key',async()=>{const ui=await setup({rows:[]}),button=html.includes('id="generate-script"')?'generate-script':'plan-sources';await ui.edit(ui.get('script-mode'),'ai');await ui.edit(ui.get('production-instructions'),'身近な道具の使い方');await ui.get(button).emit('click');const calls=ui.requests.filter(r=>['draft','source-plan'].includes(r.route));assert.equal(calls.length,1);assert.equal(calls[0].route,'draft');assert.equal(calls[0].input.brief.instructions,'身近な道具の使い方');ui.restart();await ui.poll();await ui.edit(ui.get('script-input'),'直接入力した台本。');assert.equal(ui.get('script-input').disabled,false);assert.equal(ui.get(button).disabled,true);assert.equal(ui.requests.filter(r=>['draft','source-plan'].includes(r.route)).length,1);});

test('script authoring: in-page clearing requires an explicit decision and cancellation preserves the typed result',async()=>{const ui=await setup({autoConfirm:false});await ui.edit(ui.get('script-input'),'直接入力した台本。');await ui.get('clear-script').emit('click');assert.equal(ui.get('script-confirm').hidden,false);assert.equal(ui.get('script-input').value,'直接入力した台本。');await ui.get('cancel-script-action').emit('click');assert.equal(ui.get('script-input').value,'直接入力した台本。');await ui.get('clear-script').emit('click');await ui.get('confirm-script-action').emit('click');assert.equal(ui.get('script-input').value,'');assert.equal(ui.get('script-confirm').hidden,true);assert.equal(ui.requests.some(r=>['draft','source-plan','generate','production'].includes(r.route)),false);});
test('script authoring: changing the input after an overwrite decision blocks the stale send without a provider call',async()=>{const ui=await setup({autoConfirm:false,rows:[]}),button=html.includes('id="regenerate-script"')?'regenerate-script':'plan-sources';await ui.edit(ui.get('script-mode'),'ai');await ui.edit(ui.get('production-instructions'),'説明動画');await ui.edit(ui.get('script-input'),'最初の台本。');await ui.get(button).emit('click');assert.equal(ui.get('script-confirm').hidden,false);assert.equal(ui.requests.some(r=>['draft','source-plan','production'].includes(r.route)),false);await ui.edit(ui.get('script-input'),'後から編集した台本。');await ui.get('confirm-script-action').emit('click');assert.equal(ui.get('script-input').value,'後から編集した台本。');assert.equal(ui.requests.some(r=>['draft','source-plan','production'].includes(r.route)),false);assert.match(ui.get('script-edit-status').textContent,/台本が更新|STALE_REVISION/);});

test('audio retry confirmation rejects a changed revision without generating',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audioCurrent:false}]});
 await ui.get('retry-audio').emit('click');ui.externalRevision();await ui.poll();
 await ui.get('retry-confirm-send').emit('click');assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});


test('an explicitly cleared image does not reappear from a legacy filename after polling',async()=>{
 const file='a'.repeat(64)+'.png',ui=await setup({assets:[{name:'cut-one.png',file}]});
 ui.externalCutInfo('one',{cutImage:null});await ui.poll();
 const select=[...ui.get('rows').walk()].find(e=>e.dataset.cutImage==='one');assert.equal(select.value,'');
 assert.equal([...ui.get('rows').walk()].some(e=>e.tagName==='img'&&e.attributes.src==='/materials/'+file),false);
});
test('unprepared images cannot be adopted; preparing and per-cut regeneration disclose costs without sending on render',async()=>{
 const proposal={id:'proposal-1',scenes:[{id:'one',caption:'字幕。',imageFile:'',imagePrompt:'静かな室内',reason:'説明に対応する画像が必要'}]};
 const ui=await setup({imageProposal:proposal});assert.equal(ui.get('plan-images').hidden,false);assert.match(ui.get('plan-images').textContent,/画像1枚.*API/);assert.equal(ui.get('approve-images').disabled,true);assert.match(ui.get('approve-images').textContent,/APIなし/);assert.equal(ui.get('image-proposal').children.length,0);assert.equal(ui.requests.some(r=>['prepare-images','approve-images','regenerate-image'].includes(r.route)),false);
});
test('only one final render control exists and new-project and draft saving are subordinate actions',()=>{
 assert.ok(!html.includes('id="export"'));assert.ok(!html.includes('id="play-full"'));assert.ok(!html.includes('id="consent"'));assert.ok(!html.includes('class="audio-download"'));assert.match(html,/<button id="new-project-bottom"[^>]*class="quiet">別の制作を始める/);assert.ok(!html.includes('<details class="draft-save">'));assert.match(html,/<button id="save-production"/);assert.ok(html.includes('id="download-audio"'));
});

test('requested controls: save is a direct button, manual cut insertion is absent, title reading is prefilled',async()=>{
 assert.match(html,/<button id="save-production"[^>]*>途中で保存する（APIなし）<\/button>/);
 assert.ok(!html.includes('manual-cut-add'));assert.ok(!appSource.includes("$('manual-cut-add')"));
 const ui=await setup({titleReading:{caption:'Original title',speech:'たいとるのよみ'}});await ui.poll();
 assert.equal(ui.get('opening-speech').value,'たいとるのよみ');
 await ui.edit(ui.get('opening-speech'),'じぶんのよみ');await ui.poll();assert.equal(ui.get('opening-speech').value,'じぶんのよみ');
});

test('the visible image drop frame accepts a dropped file and prevents browser navigation',async()=>{
 const ui=await setup();const zone=[...ui.get('rows').walk()].find(e=>e.attributes.class==='cut-image-drop');assert.ok(zone);
 assert.ok([...zone.walk()].some(e=>e.textContent==='この点線枠の中に画像をドロップして差し替える'));
 let prevented=false;const bytes=new Uint8Array([1,2,3]);await zone.emit('drop',{preventDefault(){prevented=true;},dataTransfer:{files:[{name:'replacement.png',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]}});
 assert.equal(prevented,true);assert.ok(ui.requests.some(r=>r.route==='cut-image'));
});

test('source script adoption carries AI title reading into review without a separate AI action',async()=>{
 const title='朝の道具',titleReading={caption:title,speech:'あさのどうぐ'},sourcePlan={script:'窓を開けます。',readings:[{caption:'窓を開けます。',speech:'まどをあけます。'}],titleReading,direction:{title,template:'steps',motion:null}};
 const ui=await setup({rows:[],sourcePlan});await ui.edit(ui.get('source-text'),'朝の道具を紹介');await ui.get('generate-script').emit('click');await ui.get('plan-sources').emit('click');await ui.get('apply-voice').emit('click');
 assert.equal(ui.get('opening-title').value,title);assert.equal(ui.get('opening-speech').value,titleReading.speech);assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.requests.some(r=>r.route==='prepare-readings'),false);
});

test('fresh project and URL only starts source generation on the first click with no overwrite dialog',async()=>{
 const sourcePlan={script:'道具の紹介。',readings:[{caption:'道具の紹介。',speech:'どうぐのしょうかい。'}]};const ui=await setup({sourcePlan});await ui.get('new-project').emit('click');
 await ui.edit(ui.get('source-urls'),'https://example.com/tools');assert.equal(ui.get('script-input').value,'');assert.equal(ui.get('generate-script').disabled,false);
 await ui.get('generate-script').emit('click');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.get('script-confirm').hidden,true);assert.equal(ui.get('script-input').value,sourcePlan.script);
});

test('draft image regeneration explains missing API readiness and unlocks after UI key registration',async()=>{
 const file='b'.repeat(64)+'.png',sourcePlan={script:'道具の説明。',storyboard:{title:'道具',scenes:[{title:'道具',caption:'道具の説明。',imageFile:file}]}};
 const ui=await setup({rows:[],sourcePlan});await ui.edit(ui.get('source-urls'),'https://example.com/tools');await ui.get('generate-script').emit('click');
 ui.restart();await ui.poll();
 const find=()=>[...ui.get('storyboard-preview').walk()].find(e=>e.attributes['data-regenerate-draft-image']==='0');
 assert.equal(find().disabled,true);assert.ok([...ui.get('storyboard-preview').walk()].some(e=>e.textContent==='画像を再生成するには、画面上部でGemini APIキーを登録してください。'));
 await ui.edit(ui.get('api-key'),'test-only-key');await ui.get('key-form').emit('submit');
 assert.equal(find().disabled,false);assert.equal(ui.requests.some(r=>r.route==='regenerate-image'),false);
});

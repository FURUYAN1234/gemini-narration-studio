import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {VOICE_GENDERS,VOICES,MODELS,SAMPLE_SETTINGS} from '../core.mjs';
import {VIDEO_TEMPLATES} from '../designs.mjs';

const appSource = await readFile(new URL('../ui/app.mjs', import.meta.url), 'utf8');
const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
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

test('API registration stays at the top; reading next only navigates to synthesis with a configured key',async()=>{
 const ui=await setup();ui.restart();await ui.poll();ui.get('consent').checked=false;await ui.get('consent').emit('change');assert.equal(ui.get('generation-next').hidden,true);assert.equal(ui.get('generate-all').disabled,true);assert.doesNotMatch(ui.get('generation-next').textContent,/APIキーを登録/);assert.equal(ui.get('api-settings').open,true);ui.get('api-key').value='not-a-real-key';await ui.get('key-form').emit('submit');assert.equal(ui.location.hash,'');assert.equal(ui.get('api-settings').open,false);assert.equal(ui.get('generation-next').hidden,false);assert.equal(ui.get('generate-all').disabled,true);await ui.get('generation-next').emit('click');assert.equal(ui.get('api-settings').open,false);assert.match(ui.get('message').textContent,/チェック/);ui.get('consent').checked=true;await ui.get('consent').emit('change');assert.equal(ui.get('generate-all').disabled,false);assert.equal(ui.requests.some(r=>r.route==='generate'),false);assert.equal(ui.state().rows.every(r=>r.reviewed),true);
});
for(const control of ['unconfirm-script'])test(control+' can undo idle reading confirmation without losing text/audio or local edits',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'old.wav'},audioCurrent:true,listenedCurrent:true,cutConfirmed:false}]});const before=ui.state().rows[0];await ui.edit(ui.textArea('one','speech'),'保存前の修正');assert.equal(ui.get(control).disabled,false);await ui.get(control).emit('click');assert.equal(ui.state().rows[0].reviewed,false);assert.equal(ui.state().rows[0].speech,before.speech);assert.deepEqual(ui.state().rows[0].audio,before.audio);assert.equal(ui.textArea('one','speech').value,'保存前の修正');assert.equal(ui.get('consent').checked,false);assert.equal(ui.requests.filter(r=>r.route==='unapprove').length,1);assert.equal(ui.requests.some(r=>r.route==='cancel'||r.route==='generate'),false);assert.match(ui.get('cancel-status').textContent,/編集に戻れます/);
});
test('final seal hides reading undo/next actions and active synthesis keeps cancellation as execution cancellation',async()=>{
 const sealed=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await sealed.get('confirm-full').emit('click');assert.equal(sealed.get('unconfirm-script').hidden,true);assert.equal(sealed.get('reading-next').hidden,true);assert.equal(sealed.get('cancel').disabled,false);
 const active=await setup();active.externalBusy(true);await active.poll();assert.equal(active.get('unconfirm-script').disabled,true);assert.equal(active.get('cancel').disabled,false);assert.match(active.get('cancel').textContent,/処理を中止/);await active.get('cancel').emit('click');assert.equal(active.requests.filter(r=>r.route==='cancel').length,1);assert.equal(active.requests.some(r=>r.route==='unapprove'),false);
});
test('cancellation stays usable while the AI request promise itself is still pending',async()=>{
 let release;const draftWait=new Promise(r=>release=r),ui=await setup({draftWait});await ui.edit(ui.get('production-instructions'),'作成指示');const running=ui.get('draft-script').emit('click');await new Promise(r=>setImmediate(r));await ui.poll();assert.equal(ui.state().busy,true);assert.equal(ui.get('cancel').disabled,false);await ui.get('cancel').emit('click');assert.equal(ui.get('workflow-paused').hidden,true);release();await running;assert.equal(ui.get('workflow-paused').hidden,false);assert.equal(ui.requests.filter(r=>r.route==='cancel').length,1);assert.equal(ui.requests.some(r=>r.route==='unapprove'),false);
});

test('AI hiragana readings survive local saving/polling and are passed into review without another provider request',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'作りたい動画');await ui.get('draft-script').emit('click');assert.equal(ui.get('append-script').textContent,'この台本で読み確認へ進む →');await ui.get('save-production').emit('click');await ui.poll();assert.deepEqual(ui.state().production.brief.readings,[{caption:'AI draft result',speech:'えーあいだいほん。'}]);await ui.get('append-script').emit('click');const request=ui.requests.find(r=>r.route==='append-script');assert.equal(request.input.readings[0].speech,'えーあいだいほん。');assert.equal(request.input.consent,false);assert.equal(ui.state().rows.at(-1).speech,'えーあいだいほん。');assert.equal(ui.requests.filter(r=>r.route==='draft').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
test('changed or pasted captions disclose one reading preparation request; missing key disables it and stale readings are not reused',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'作成指示');await ui.get('draft-script').emit('click');await ui.edit(ui.get('script-input'),'変更した字幕。');assert.match(ui.get('append-script').textContent,/API利用/);assert.match(ui.get('reading-prep-info').textContent,/Googleへ1回/);await ui.get('append-script').emit('click');const request=ui.requests.find(r=>r.route==='append-script');assert.equal(request.input.consent,true);assert.equal(request.input.readings,undefined);
 await ui.edit(ui.get('script-input'),'さらに新しい字幕。');ui.restart();await ui.poll();assert.equal(ui.get('append-script').disabled,true);
});
test('reading hints are explained, deduplicated and collapsed while clean hiragana shows no hint list',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'AIの画像。',speech:'AIの画像。',hints:[{term:'AI',kind:'latin'},{term:'AI',kind:'latin'},{term:'画像',kind:'kanji'}]}]});const detail=[...ui.get('rows').walk()].find(e=>e.attributes.class==='reading-hints');assert.equal(detail.open,false);assert.equal(detail.children[0].textContent,'読みの確認候補 2語');assert.match(detail.children[1].textContent,/判定した一覧ではありません/);
 const clean=await setup({rows:[{id:'one',caption:'AIの画像。',speech:'えーあいのがぞう。',hints:[]}]});assert.equal([...clean.get('rows').walk()].some(e=>e.attributes.class==='reading-hints'),false);
});

test('local saving reports completion beside its separated control and reading navigation reuses loaded script',async()=>{
 const ui=await setup();assert.ok(!html.includes('取り込み済み台本の読み確認へ'));assert.match(html,/class="production-save"/);
 await ui.edit(ui.get('production-instructions'),'Keep these directions');await ui.get('save-production').emit('click');assert.match(ui.get('save-status').textContent,/保存しました/);assert.equal(ui.state().production.brief.instructions,'Keep these directions');
 await ui.get('append-script').emit('click');assert.equal(ui.location.hash,'#reading');assert.match(ui.get('script-status').textContent,/移動/);assert.equal(ui.requests.some(r=>r.route==='append-script'||r.route==='draft'||r.route==='generate'),false);
 await ui.edit(ui.get('script-input'),'');assert.equal(ui.get('append-script').disabled,true);
});
test('saved project labels distinguish editing from finalized viewing and active video can be canceled without publishing',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});assert.match(ui.get('project-select').children[0].textContent,/編集中/);
 await ui.get('confirm-full').emit('click');assert.match(ui.get('project-select').children[0].textContent,/確定済み・閲覧/);assert.equal(ui.get('cancel').disabled,false);
 await ui.get('cancel').emit('click');assert.equal(ui.state().video.stage,'canceled');assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.get('video-spinner').hidden,true);assert.equal(ui.get('cancel').disabled,true);assert.match(ui.get('cancel-status').textContent,/中止/);assert.match(ui.get('video-stages').children.at(-1).textContent,/中止/);assert.equal(ui.get('export').textContent,'動画生成を再開する');assert.equal(ui.requests.filter(r=>r.route==='cancel').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('new video exits the completed-project lock and can decide a template/palette, then reopen the original',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'idle'});await ui.poll();
 const original=ui.state();assert.equal(ui.get('new-project').disabled,false);assert.equal(ui.get('theme').disabled,false);
 ui.get('theme').value='black';await ui.get('theme').emit('change');await ui.poll();assert.equal(ui.get('theme').value,'black');assert.deepEqual(ui.state().presentation,original.presentation);assert.equal(ui.requests.some(r=>r.route==='presentation'),false);
 await ui.get('new-project').emit('click');assert.equal(ui.state().rows.length,0);assert.equal(ui.state().production.finalization,null);assert.equal(ui.get('job-title').disabled,false,ui.get('message').textContent);assert.equal(ui.get('theme').disabled,false);assert.equal(ui.get('consent').checked,false);
 await ui.get('template-gallery').children.find(b=>b.dataset.template==='blueprint').emit('click');assert.equal(ui.get('apply-design').disabled,false);await ui.get('apply-design').emit('click');
 ui.get('theme').value='white';await ui.get('theme').emit('change');assert.equal(ui.state().presentation.template,'blueprint');assert.equal(ui.state().presentation.theme,'white');assert.equal(ui.requests.some(r=>r.route==='generate'||r.route==='design-draft'),false);
 ui.get('project-select').value='original';await ui.get('project-select').emit('change');assert.equal(ui.state().production.finalization.revision,original.production.finalization.revision);assert.equal(ui.get('apply-design').disabled,true);
});
test('new/switch UI is disabled while edits are unsaved or generation is active',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'Unsaved production directions');assert.equal(ui.get('new-project').disabled,true);assert.equal(ui.get('project-select').disabled,true);assert.match(ui.get('project-info').textContent,/保存/);
 await ui.get('save-production').emit('click');assert.equal(ui.get('new-project').disabled,false);
 ui.externalVideo({running:true});await ui.poll();assert.equal(ui.get('new-project').disabled,true);assert.equal(ui.requests.some(r=>r.route==='new-project'),false);
});

test('material intake precedes script planning in visual and keyboard order',()=>{
 const ids=['asset-mode','material-files','material-list','script-mode','production-instructions','script-input','append-script','save-production'];
 const positions=ids.map(id=>html.indexOf(`id="${id}"`));
 assert.ok(positions.every(position=>position>=0));
 assert.ok(positions.every((position,index)=>index===0||position>positions[index-1]));
 assert.match(html,/素材と台本を用意する/);
});
test('design chooser is before materials and script, and the bottom advertisement is removed',()=>{
 assert.ok(html.indexOf('id="design-planning"')<html.indexOf('id="asset-mode"'));
 assert.ok(html.indexOf('id="design-planning"')<html.indexOf('id="script-mode"'));
 assert.ok(!html.includes('PRESENTATION TEMPLATE'));assert.match(html,/テンプレートを使わず、AIで今回用に作る/);
});
test('template comparison is local; deciding saves renderer design while retaining unsaved sentence edits',async()=>{
 const ui=await setup();assert.equal(ui.get('template-gallery').children.length,8);
 await ui.edit(ui.textArea('one','speech'),'Unsaved pronunciation');const button=ui.get('template-gallery').children.find(b=>b.dataset.template==='blueprint');await button.emit('click');
 assert.equal(ui.requests.some(r=>r.route==='presentation'||r.route==='design-draft'),false);assert.equal(ui.get('generate-all').disabled,true);
 await ui.get('apply-design').emit('click');assert.equal(ui.state().presentation.template,'blueprint');assert.equal(ui.textArea('one','speech').value,'Unsaved pronunciation');assert.equal(ui.get('apply-design').disabled,true);
 assert.equal(ui.requests.filter(r=>r.route==='presentation').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
test('AI design uses one explicit consent-gated action; instructions survive polling and result updates preview',async()=>{
 const ui=await setup();ui.get('design-mode').value='ai';await ui.get('design-mode').emit('change');assert.equal(ui.get('template-gallery').hidden,true);assert.equal(ui.get('apply-design').hidden,true);
 await ui.edit(ui.get('design-instructions'),'Blue, large type, image on the left');await ui.poll();assert.equal(ui.get('design-instructions').value,'Blue, large type, image on the left');assert.equal(ui.get('draft-design').disabled,true);assert.equal(ui.requests.some(r=>r.route==='design-draft'),false);
 ui.get('design-consent').checked=true;await ui.get('design-consent').emit('change');assert.equal(ui.get('draft-design').disabled,false);await ui.get('draft-design').emit('click');assert.equal(ui.requests.filter(r=>r.route==='design-draft').length,1);assert.equal(ui.state().presentation.mode,'ai');assert.equal(ui.state().presentation.design.name,'AI design');assert.equal(ui.get('design-sample').hidden,false);assert.match(ui.get('design-selection').textContent,/AI design/);
});
test('finalized video allows browsing template examples without changing its sealed presentation',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'idle'});await ui.poll();const before=ui.state().presentation;
 await ui.get('template-gallery').children.find(b=>b.dataset.template==='pop').emit('click');assert.equal(ui.get('apply-design').disabled,true);await ui.poll();assert.deepEqual(ui.state().presentation,before);assert.equal(ui.get('export').disabled,false);assert.equal(ui.requests.some(r=>r.route==='presentation'||r.route==='design-draft'),false);assert.match(ui.get('design-selection').textContent,/最終確定済み/);
 ui.restart();await ui.poll();assert.equal(ui.get('api-settings').open,false);assert.equal(ui.get('api-connection').classList.contains('needs-key'),false);
});

test('video generation shows only actual progress, publishes player/download after saving, and preserves the final seal',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:false}]});
 assert.equal(ui.get('export').disabled,true);await ui.get('confirm-full').emit('click');assert.equal(ui.get('export').disabled,true);
 assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);assert.equal(ui.get('video-spinner').hidden,false);assert.equal(ui.get('video-progress').value,.4);assert.match(ui.get('video-status').textContent,/40 \/ 100/);assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.get('export').disabled,true);
 ui.externalVideo({running:false,stage:'complete',progress:1,result:{file:'a'.repeat(64)+'.mp4',filename:'Video.mp4',savedPath:'Downloads/Video.mp4'}});await ui.poll();
 assert.equal(ui.get('video-spinner').hidden,true);assert.equal(ui.get('video-result').hidden,false);assert.equal(ui.get('video-player').src,'/video/'+'a'.repeat(64)+'.mp4');assert.match(ui.get('video-saved-path').textContent,/保存済み/);assert.equal(ui.get('manifest').hidden,false);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
 ui.externalVideo({result:null,stage:'failed',error:'VIDEO_RENDER_FAILED',steps:['preparing','bundling','rendering']});await ui.poll();assert.equal(ui.get('video-result').hidden,true);assert.match(ui.get('video-status').textContent,/VIDEO_RENDER_FAILED/);assert.match(ui.get('video-stages').children.at(-1).textContent,/失敗/);assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);
 ui.externalVideo({result:null,stage:'failed',error:'VIDEO_FONT_TIMEOUT',steps:['preparing','bundling','rendering']});await ui.poll();assert.match(ui.get('video-status').textContent,/日本語フォント.*時間切れ/);assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);
});

test('registered API panel stops following scroll and applied voice is visibly decided without synthesis',async()=>{
 const ui=await setup();assert.equal(ui.get('api-connection').classList.contains('needs-key'),false);
 assert.equal(ui.get('apply-voice').disabled,true);assert.match(ui.get('apply-voice').textContent,/決定済み/);
 await ui.edit(ui.get('pitch'),'high');assert.equal(ui.get('apply-voice').disabled,false);
 await ui.get('settings-form').emit('submit');assert.equal(ui.get('apply-voice').disabled,true);
 assert.match(ui.get('voice-apply-state').textContent,/Kore.*高め.*決定済み/);
 assert.equal(ui.requests.some(r=>r.route==='generate'),false);
 await ui.edit(ui.get('pitch'),'low');await ui.edit(ui.get('pitch'),'high');
 assert.equal(ui.get('generate-all').disabled,false);assert.equal(ui.get('apply-voice').disabled,true);
 ui.restart();await ui.poll();assert.equal(ui.get('api-connection').classList.contains('needs-key'),true);
});

test('review shows only the next useful actions, keeps synthesis consent and places stale-audio repair inside its cut',async()=>{
 const ui=await setup({secondReviewed:true});assert.equal(ui.get('confirm-script').hidden,false);assert.equal(ui.get('confirm-script').disabled,true);
 assert.match(ui.get('review-save-state').textContent,/全文の読みは確定済み/);
 assert.equal(ui.get('play-full').hidden,true);assert.equal(ui.get('confirm-full').hidden,true);
 assert.equal(html.includes('id="audio-rows"'),false);assert.equal(html.includes('<details id="generation-tools"'),false);
 assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.generate),false);
 ui.get('consent').checked=false;await ui.get('consent').emit('change');
 assert.equal(ui.get('generate-all').disabled,true);assert.match(ui.get('generation-state').textContent,/Google.*同意/);
 const repaired=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'old.wav'},audioCurrent:false,listenedCurrent:false}],confirmResult:false});
 const regenerate=[...repaired.get('rows').walk()].find(e=>e.dataset.generate==='one');assert.ok(regenerate);
 await regenerate.emit('click');assert.equal(repaired.requests.some(r=>r.route==='generate'),false);
 assert.equal(repaired.confirmations.length,1);
});

test('generated narration leaves all cuts editable until one final review, with no individual cut buttons',async()=>{
 const ui=await setup({secondReviewed:true});await ui.get('generate-all').emit('click');assert.equal(ui.state().rows.every(r=>r.audioCurrent),true);assert.equal(ui.get('generation-tools').hidden,true);assert.equal(ui.get('confirm-full').disabled,false);assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.confirmCut||e.dataset.editCut),false);assert.equal(ui.textArea('one','speech').disabled,false);assert.equal(ui.requests.some(r=>r.route==='confirm-cut'||r.route==='finalize'),false);
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
test('explicit disclosed AI draft action carries consent once, fills editable input and never appends or synthesizes',async()=>{const ui=await setup();assert.equal(ui.get('draft-script').disabled,true);assert.ok(!html.includes('id="draft-consent"'));await ui.edit(ui.get('production-instructions'),'Write a brief narration');assert.equal(ui.get('draft-script').disabled,false);await ui.get('draft-script').emit('click');assert.equal(ui.get('script-input').value,'AI draft result');assert.equal(ui.state().rows.length,2);const calls=ui.requests.filter(r=>r.route==='draft');assert.equal(calls.length,1);assert.equal(calls[0].input.consent,true);assert.match(ui.get('draft-status').textContent,/作成しました/);assert.equal(ui.requests.some(r=>r.route==='generate'),false);ui.restart();await ui.poll();assert.equal(ui.get('draft-script').disabled,true);assert.equal(ui.get('draft-key-link').hidden,false);});
test('pasted script becomes visibly editable immediately while preserving unsaved production instructions',async()=>{const ui=await setup();await ui.edit(ui.get('script-input'),'Pasted script');await ui.edit(ui.get('production-instructions'),'Keep this direction');await ui.get('append-script').emit('click');assert.equal(ui.state().rows.length,3);assert.equal(ui.textArea('added','speech').value,'Pasted script');assert.equal(ui.get('production-instructions').value,'Keep this direction');});
test('registered key folds the entry UI, can be reopened, and is cleared without losing drafts',async()=>{const ui=await setup();assert.equal(ui.get('api-settings').open,false);assert.equal(ui.get('key-state').textContent,'キー登録済み');ui.get('api-settings').open=true;await ui.poll();assert.equal(ui.get('api-settings').open,true);await ui.edit(ui.textArea('one','speech'),'Unsaved narration');ui.get('api-key').value='test-only-key';await ui.get('key-form').emit('submit');assert.equal(ui.get('api-key').value,'');assert.equal(ui.get('api-settings').open,false);await ui.get('clear-key').emit('click');assert.equal(ui.get('api-settings').open,true);assert.equal(ui.textArea('one','speech').value,'Unsaved narration');});
test('voice order presents preset voices first and other voices alphabetically',async()=>{const ui=await setup({voices:['Zephyr','Aoede','Kore','Achernar','Charon','Puck']});assert.deepEqual(ui.get('voice').children.map(c=>c.attributes.value),['Puck','Charon','Kore','Aoede','Achernar','Zephyr']);});
test('workflow and keyboard DOM order start with planning and keep title in the first section',()=>{const sections=[...html.matchAll(/<section class="panel" id="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(sections,['planning','connection','reading','finish']);assert.ok(html.indexOf('id="job-title"')<html.indexOf('id="connection"'));});
test('API entry is a single top connection panel; script paste replaces JSON import and inline API links',async()=>{assert.ok(html.indexOf('id="api-settings"')<html.indexOf('class="hero"'));assert.equal([...html.matchAll(/id="api-key"/g)].length,1);assert.equal([...html.matchAll(/id="key-state"/g)].length,1);assert.match(html,/<p id="draft-key-link"/);assert.doesNotMatch(html,/id="import-file"|台本JSON/);assert.match(html,/コピー＆ペースト/);const ui=await setup();assert.equal(ui.get('api-settings').open,false);ui.restart();await ui.poll();assert.equal(ui.get('api-settings').open,true);});
test('combined presets choose model automatically, include overview, and expose free inputs only in customize mode',async()=>{const ui=await setup();const options=[...ui.get('voice-preset').walk()].filter(e=>e.tagName==='option');assert.equal(options.length,5);assert.ok(options.some(o=>o.textContent.includes('明るく親しみやすい')));ui.get('voice-preset').value='gemini-3.8-flash-lite-tts::Puck';await ui.get('voice-preset').emit('change');assert.equal(ui.get('model').value,'gemini-3.8-flash-lite-tts');assert.equal(ui.get('voice').value,'Puck');assert.equal(ui.get('custom-settings').hidden,true);assert.match(ui.get('model-info').textContent,/Flash-Lite/);assert.equal(ui.requests.some(r=>r.route==='preview'||r.route==='settings'),false);ui.get('voice-preset').value='custom';await ui.get('voice-preset').emit('change');assert.equal(ui.get('custom-settings').hidden,false);await ui.edit(ui.get('style'),'Whisper gently at a slow pace');assert.equal(ui.get('voice-preset').value,'custom');});
test('pitch, sample playback and final apply follow the decision sequence without early save',()=>{assert.ok(html.indexOf('id="pitch"')<html.indexOf('id="sample-audio"'));assert.ok(html.indexOf('id="sample-audio"')<html.indexOf('form="settings-form"'));});
test('loaded and AI accepted scripts reuse rows instead of a second import',async()=>{const ui=await setup();assert.equal(ui.get('script-input').value,'Caption one\nCaption two');await ui.get('append-script').emit('click');assert.equal(ui.requests.some(r=>r.route==='append-script'),false);await ui.edit(ui.get('script-input'),'New AI result');await ui.get('append-script').emit('click');await ui.get('append-script').emit('click');assert.equal(ui.requests.filter(r=>r.route==='append-script').length,1);assert.equal(ui.state().rows.length,3);});
test('sentence pairs preserve exact text, save both sides and invalidate only edited review',async()=>{const ui=await setup({rows:[{id:'one',caption:'最初の文。 次の文！\n最後です。',speech:'さいしょのぶん。 つぎのぶん！\nさいごです。',reviewed:true}]});const fields=[...ui.get('rows').walk()].filter(e=>e.tagName==='textarea'&&/字幕|読み上げ文/.test(e.attributes['aria-label']||''));assert.equal(fields.length,6);assert.equal(fields.filter((_,i)=>i%2===0).map(e=>e.value).join(''),ui.state().rows[0].caption);assert.equal(fields.filter((_,i)=>i%2===1).map(e=>e.value).join(''),ui.state().rows[0].speech);await ui.edit(fields[3],'なおしたよみ！\n');assert.equal(ui.get('generate-all').disabled,true);const save=[...ui.get('rows').walk()].find(e=>e.textContent==='変更を保存');await save.emit('click');assert.equal(ui.state().rows[0].caption,'最初の文。 次の文！\n最後です。');assert.equal(ui.state().rows[0].speech,'さいしょのぶん。 なおしたよみ！\nさいごです。');assert.equal(ui.state().rows[0].reviewed,false);assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.generate),false);assert.equal(html.includes('id="audio-rows"'),false);});
test('unequal sentence counts retain extra text with an explicit alignment notice',async()=>{const ui=await setup({rows:[{caption:'一文。二文。',speech:'いちぶんだけ。'}]});const fields=[...ui.get('rows').walk()].filter(e=>e.tagName==='textarea'&&/字幕|読み上げ文/.test(e.attributes['aria-label']||''));assert.equal(fields.length,4);assert.equal(fields[2].value,'二文。');assert.equal(fields[3].value,'');assert.ok([...ui.get('rows').walk()].some(e=>e.textContent.includes('文数が違います')));});
test('complete samples hide preparation and missing configurations are prepared once across both models',async()=>{const ui=await setup({samples:[]});ui.get('bank-consent').checked=true;await ui.get('bank-consent').emit('change');await ui.get('prepare-samples').emit('click');assert.equal(ui.requests.filter(r=>r.route==='prepare-samples').length,1);assert.equal(ui.state().samples.length,12);assert.equal(new Set(ui.state().samples.map(s=>s.settings.model)).size,2);assert.equal(new Set(ui.state().samples.map(s=>s.settings.pitch||'standard')).size,3);assert.equal(ui.get('bank-tools').hidden,true);assert.match(ui.get('sample-progress').textContent,/12 \/ 12/);assert.equal(ui.get('prepare-samples').disabled,true);await ui.poll();assert.equal(ui.requests.filter(r=>r.route==='prepare-samples').length,1);assert.equal(ui.state().rows.length,2);});
test('sample library stops on the first failure and retains completed clips without retry',async()=>{const ui=await setup({samples:[],previewError:2});ui.get('bank-consent').checked=true;await ui.get('bank-consent').emit('change');await ui.get('prepare-samples').emit('click');assert.equal(ui.requests.filter(r=>r.route==='prepare-samples').length,1);assert.equal(ui.requests.some(r=>r.route==='preview'),false);assert.equal(ui.state().samples.length,1);assert.equal(ui.get('bank-tools').hidden,false);assert.match(ui.get('message').textContent,/利用上限/);assert.equal(ui.get('voice-preset').disabled,false);});
test('full narration plays scenes sequentially and halts on edits before finalization',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:false},{id:'two',caption:'次。',speech:'つぎ。',reviewed:true,audio:{file:'two.wav'},audioCurrent:true,listenedCurrent:false}]});await ui.get('play-full').emit('click');assert.equal(ui.get('full-audio').src,'/audio/one.wav');await ui.get('full-audio').emit('ended');assert.equal(ui.get('full-audio').src,'/audio/two.wav');assert.equal(ui.requests.some(r=>r.route==='listened'||r.route==='generate'),false);await ui.get('full-audio').emit('ended');await ui.get('play-full').emit('click');await ui.edit(ui.textArea('one','speech'),'修正');assert.equal(ui.get('full-audio').paused,true);assert.equal(ui.get('play-full').disabled,true);assert.equal(ui.get('export').disabled,true);});
test('unfinished narration cannot start full playback or claim listening',async()=>{const ui=await setup();assert.equal(ui.get('play-full').disabled,true);assert.equal(ui.get('confirm-full').disabled,true);assert.ok(html.indexOf('id="generate-all"')<html.indexOf('id="finish"'));assert.ok(html.indexOf('id="export"')>html.indexOf('id="finish"'));});
test('one sentence correction saves only that sentence and preserves other unsaved words without approving them',async()=>{const ui=await setup({rows:[{id:'one',caption:'最初。次。',speech:'さいしょ。つぎ。',reviewed:false}]});const fields=[...ui.get('rows').walk()].filter(e=>e.tagName==='textarea'&&/字幕|読み上げ文/.test(e.attributes['aria-label']||''));await ui.edit(fields[1],'なおしたよみ。');await ui.edit(fields[3],'まだへんしゅうちゅう。');const button=[...ui.get('rows').walk()].find(e=>e.dataset.commitSentence==='one:0');assert.ok(button);await button.emit('click');assert.equal(ui.state().rows[0].speech,'なおしたよみ。つぎ。');assert.equal(ui.textArea('one','speech').value,'なおしたよみ。');assert.equal(fields[3].value,'まだへんしゅうちゅう。');assert.equal(ui.state().rows[0].reviewed,false);assert.equal(ui.requests.some(r=>r.route==='approve'||r.route==='generate'),false);assert.equal(ui.get('generate-all').disabled,true);});
test('bulk correction saves all edited text before explicit approval, keeps unrelated drafts and does not synthesize',async()=>{const ui=await setup({secondReviewed:false});await ui.edit(ui.textArea('one','speech'),'Corrected reading');await ui.edit(ui.textArea('two','caption'),'Corrected caption');await ui.edit(ui.get('style'),'Unapplied voice direction');await ui.get('confirm-script').emit('click');assert.equal(ui.state().rows[0].speech,'Corrected reading');assert.equal(ui.state().rows[1].caption,'Corrected caption');assert.ok(ui.state().rows.every(r=>r.reviewed));assert.equal(ui.get('style').value,'Unapplied voice direction');const routes=ui.requests.filter(r=>['row','approve','generate'].includes(r.route)).map(r=>r.route);assert.deepEqual(routes,['row','row','approve','approve']);assert.equal(ui.get('confirm-script').disabled,true);});
test('failed save leaves edits available and never proceeds to bulk approval or another attempt',async()=>{const ui=await setup({secondReviewed:false,rowError:true});await ui.edit(ui.textArea('one','speech'),'Keep my correction');await ui.get('confirm-script').emit('click');assert.equal(ui.textArea('one','speech').value,'Keep my correction');assert.equal(ui.requests.filter(r=>r.route==='row').length,1);assert.equal(ui.requests.some(r=>r.route==='approve'||r.route==='generate'),false);assert.equal(ui.get('confirm-script').disabled,false);assert.match(ui.get('message').textContent,/処理できません/);});
test('unchanged approved text is not resaved and its existing audio/listening remains intact',async()=>{const ui=await setup({rows:[{id:'one',caption:'確認済み。',speech:'かくにんずみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true},{id:'two',caption:'未確認。',speech:'みかくにん。',reviewed:false}]});await ui.get('confirm-script').emit('click');assert.equal(ui.requests.some(r=>r.route==='row'),false);assert.equal(ui.requests.filter(r=>r.route==='approve').length,1);assert.equal(ui.state().rows[0].audio.file,'original.wav');assert.equal(ui.state().rows[0].listenedCurrent,true);});
test('scene confirmation saves pending words after reopening and never confirms stale audio',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true}]});await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');assert.equal(ui.row('one').disabled,false);await ui.row('one').emit('click');assert.equal(ui.state().rows[0].speech,'なおしたよみ。');assert.equal(ui.state().rows[0].reviewed,true);assert.equal(ui.state().rows[0].audioCurrent,false);assert.equal(ui.state().rows[0].listenedCurrent,false);assert.equal(ui.get('export').disabled,true);assert.equal(ui.requests.some(r=>r.route==='generate'||r.route==='listened'),false);});
test('concurrent row changes stop confirmation without overwriting saved work or dropping the local draft',async()=>{const ui=await setup({secondReviewed:false});await ui.edit(ui.textArea('one','speech'),'Local draft');ui.externalEdit('one',{speech:'Other saved edit'});await ui.get('confirm-script').emit('click');assert.equal(ui.textArea('one','speech').value,'Local draft');assert.equal(ui.state().rows[0].speech,'Other saved edit');assert.equal(ui.requests.some(r=>r.route==='row'||r.route==='approve'),false);assert.match(ui.get('message').textContent,/最新の内容/);});
test('cut audio uses its real scene file and reopened cut/global correction drafts survive unrelated saves',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'real-scene.wav'},audioCurrent:true,listenedCurrent:true}]});const audio=[...ui.get('rows').walk()].find(e=>e.tagName==='audio');assert.equal(audio.attributes.src,'/audio/real-scene.wav');assert.equal(audio.attributes.preload,'metadata');const note=[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');await ui.edit(note,'名前の読みを直して');await ui.edit(ui.get('review-overall'),'結末を分かりやすく');await ui.poll();await ui.edit(ui.get('job-title'),'Changed title');await ui.get('save-title').emit('click');const currentNote=[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');assert.equal(currentNote.value,'名前の読みを直して');assert.equal(ui.get('review-overall').value,'結末を分かりやすく');assert.equal(ui.get('export').disabled,true);});
test('correction instructions persist separately, block final handoff, and never start paid generation',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true}]});const before=ui.state().rows;await ui.edit(ui.get('review-overall'),'画像を台本に合わせて');await ui.get('save-review').emit('click');assert.equal(ui.state().production.review.overall,'画像を台本に合わせて');assert.deepEqual(ui.state().rows,before);assert.equal(ui.get('play-full').disabled,false);assert.equal(ui.get('export').disabled,true);assert.equal(ui.requests.some(r=>['generate','draft','preview','row'].includes(r.route)),false);await ui.get('clear-review').emit('click');assert.equal(ui.state().production.review.overall,'');assert.equal(ui.get('export').disabled,true);assert.equal(ui.get('confirm-full').disabled,false);});

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
 const ui=await setup({rows});await ui.get('confirm-full').emit('click');assert.equal(ui.confirmations.length,1);assert.equal(ui.requests.filter(r=>r.route==='finalize').length,1);assert.equal(ui.textArea('one','speech').disabled,true);assert.equal(ui.get('voice-preset').disabled,true);assert.equal(ui.get('pitch').disabled,true);assert.equal(ui.get('review-overall').disabled,true);assert.equal(ui.get('confirm-full').disabled,true);assert.equal(ui.requests.filter(r=>r.route==='render-video').length,1);ui.externalVideo({running:false,stage:'failed'});await ui.poll();assert.equal(ui.get('export').disabled,false);assert.equal(ui.get('play-full').disabled,false);assert.equal(ui.get('clear-key').disabled,false);await ui.poll();assert.equal(ui.textArea('one','speech').disabled,true);assert.match(ui.get('handoff-info').textContent,/編集不可/);
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
    const classes=new Set();this.classList = {toggle(name,on) {if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)};
    this.style = {setProperty() {}};
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  removeAttribute(name){delete this.attributes[name];if(name==='src')this.src='';}
  play(){this.played=true;return Promise.resolve();}
  pause(){this.paused=true;}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, listener) {
    const list = this.listeners.get(name) || [];
    list.push(listener);
    this.listeners.set(name, list);
  }
  async emit(name) {
    if (name === 'click') assert.equal(this.disabled, false, 'A user cannot click a disabled control');
    for (const listener of this.listeners.get(name) || []) await listener({preventDefault() {}});
  }
  *walk() {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
}

async function setup({rows,samples,assets=[],previewError,rowError,draftWait,pausedStep,confirmResult=true,secondReviewed = true,voices=['Kore','Puck']} = {}) {
  const elements = new Map();let anonymous=0;
  for(const [,tag,attributes] of html.matchAll(/<([\w-]+)([^>]*)>/g)){const id=attributes.match(/\bid="([^"]+)"/)?.[1];if(!id&&!attributes.includes('data-cancel')&&!attributes.includes('data-revise-step'))continue;const element=new Element(tag);for(const [,name,value]of attributes.matchAll(/\b(data-[\w-]+)(?:="([^"]*)")?/g))element.setAttribute(name,value||'');elements.set(id||'anonymous-'+ ++anonymous,element);}
  const all = () => [...elements.values()].flatMap(element => [...element.walk()]);
  const matches = (element, selector) => {
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
    title: 'Original title', revision: 'revision-0', instanceId: 'instance-1', sessionId: 'fixture-session',
    keyConfigured: true, busy: false, error: null, progress: null,video:{available:true,running:false,stage:'idle',progress:0,result:null,error:null},
    settings: {model: 'gemini-3.8-flash-tts', voice: 'Kore', style: 'Original style'},
    presentation: {theme: 'moon'}, dictionary: [], voices,voiceGenders:VOICE_GENDERS,
    production:{brief:{scriptMode:'existing',assetMode:'mixed',instructions:'',script:''},assets:[]},samples:[{id:'sample-kore',file:'sample-kore.wav',settings:{model:'gemini-3.8-flash-tts',voice:'Kore',style:'Original style'},durationSeconds:1},{id:'sample-puck',file:'sample-puck.wav',settings:{model:'gemini-3.8-flash-tts',voice:'Puck',style:'明るく親しみやすい日本語で、聞き取りやすく話す。'},durationSeconds:2}],
    rows: ['one', 'two'].map(id => ({id, caption: 'Caption ' + id, speech: 'Speech ' + id, scene: '', reviewed: id === 'one' || secondReviewed, attempts: 0, hints: [], audio: null, audioCurrent: false, listenedCurrent: false})),
  };
  state.projectId='original';state.projects=[{id:'original',title:state.title}];const savedProjects=new Map();
  if(rows)state.rows=rows.map((r,i)=>({id:'row-'+i,scene:'',reviewed:false,attempts:0,hints:[],audio:null,...r}));
  if(samples)state.samples=samples;
  state.production.assets=assets;
  let token = 'fixture-token-1', revision = 0;
  const requests = [], intervals = [], confirmations=[];
  const fetch = async (url, options = {}) => {
    const route = url.replace('/api/', ''), input = options.body ? JSON.parse(options.body) : undefined;
    requests.push({route, input, headers: options.headers});
    const reply = (value, ok = true) => ({ok, json: async () => structuredClone(value)});
    if (route === 'bootstrap') return reply({token, instanceId: state.instanceId});
    if (route === 'status') return reply(state);
    if (route === 'themes') return reply([{name: 'moon', background: '#002b36', foreground: '#93a1a1', heading: '#eee8d5', accent: '#268bd2'}]);
    if (route === 'designs') return reply(VIDEO_TEMPLATES);
    if (options.headers?.['X-Narration-Token'] !== token) return reply({error: 'CSRF_TOKEN_REQUIRED'}, false);
    if(route==='render-video'){if(!state.production.finalization)return reply({error:'FINAL_CONFIRMATION_REQUIRED'},false);state.video={...state.video,running:true,stage:'rendering',progress:.4,renderedFrames:40,totalFrames:100,steps:['preparing','bundling','rendering']};return reply({started:true});}
    if(route==='new-project'||route==='project'||route==='revision-project'){
      savedProjects.set(state.projectId,structuredClone(state));const id=route==='new-project'?'new-project':route==='revision-project'?'revision-project':input.id;
      const list=state.projects,keyConfigured=state.keyConfigured,samples=state.samples;
      if(route==='new-project'){list.push({id,title:'新しい動画'});state={...structuredClone(state),title:'新しい動画',sessionId:'new-session',projectId:id,rows:[],dictionary:[],presentation:{theme:'moon'},production:{brief:{scriptMode:'existing',assetMode:'mixed',instructions:'',script:''},assets:[],finalization:null},video:{available:true,running:false,stage:'idle',result:null},projects:list};}
      else if(route==='revision-project'){list.push({id,title:state.title+'（修正版）'});state={...structuredClone(state),projectId:id,sessionId:'revision-session',production:{...structuredClone(state.production),finalization:null,cutConfirmations:[]},projects:list,video:{available:true,running:false,stage:'idle',result:null}};for(const row of state.rows)row.cutConfirmed=false;}else state={...structuredClone(savedProjects.get(id)),projects:list,keyConfigured,samples};
      token='fixture-token-project-'+id;state.instanceId='instance-project-'+id;
    }
    else if (route === 'key') state.keyConfigured = !input.clear;
    else if (route === 'title') state.title = input.title;
    else if (route === 'settings') state.settings = input;
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
    else if (route === 'production') state.production.brief=input;
    else if (route === 'append-script') state.rows.push({id:'added',caption:input.script,speech:input.readings?.[0]?.speech||input.script,reviewed:false,attempts:0,hints:[]});
    else if (route === 'preview') {if(previewError&&requests.filter(r=>r.route==='preview').length===previewError)return reply({error:'PROVIDER_RATE_LIMIT'},false);const id='sample-'+state.samples.length;state.samples.push({id,file:id+'.wav',settings:input.settings,durationSeconds:5});return reply({sample:id});}
    else if(route==='prepare-samples'){const configs=SAMPLE_SETTINGS.filter(c=>voices.includes(c.voice));const missing=configs.filter(c=>!state.samples.some(s=>s.settings.model===c.model&&s.settings.voice===c.voice&&s.settings.style===c.style&&(s.settings.pitch||'standard')===(c.pitch||'standard')));state.sampleProgress={running:false,total:missing.length,completed:0};for(const config of missing){if(previewError&&state.sampleProgress.completed+1===previewError){state.error='PROVIDER_RATE_LIMIT';break;}const id='sample-'+state.samples.length;state.samples.push({id,file:id+'.wav',settings:config,durationSeconds:5});state.sampleProgress.completed++;}return reply({started:true,total:missing.length});}
    else if (route === 'draft') {if(draftWait){state.busy=true;await draftWait;state.busy=false;return reply({error:'CANCELED'},false);}return reply({script:'AI draft result',readings:[{caption:'AI draft result',speech:'えーあいだいほん。'}]});}
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
  const context = vm.createContext({document, fetch, setInterval: callback => {intervals.push(callback);}, window: {sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},location:{hash:''},confirm: message => {confirmations.push(message);return confirmResult;}}, crypto: {randomUUID: () => 'fixture-id'}});
  await vm.runInContext('(async () => {\n' + appSource + '\n})()', context, {filename: 'ui/app.mjs'});
  const get = id => {assert.ok(elements.has(id), 'UI element exists: ' + id); return elements.get(id);};
  const row = id => [...get('rows').walk()].find(element => element.dataset.approve === id);
  const textArea = (id, kind) => {
    const index = state.rows.findIndex(row => row.id === id) + 1;
    return [...get('rows').walk()].find(element => element.attributes['aria-label'] === `${index}場面・1文目の${kind === 'caption' ? '字幕' : '読み上げ文'}`);
  };
  const edit = async (element, value) => {assert.equal(element.disabled,false,'A user cannot edit a disabled field');element.value = value; await element.emit('input');};
  get('consent').checked = true;
  await get('consent').emit('change');
  return {
    get, row, textArea, edit, requests, confirmations, location:context.window.location,
    state: () => structuredClone(state),
    poll: async () => {assert.equal(intervals.length, 1); await intervals[0]();},
    restart: () => {state.instanceId = 'instance-2'; state.keyConfigured = false; token = 'fixture-token-2';},
    externalEdit: (id,input) => {Object.assign(state.rows.find(r=>r.id===id),input,{reviewed:false});state.revision='revision-'+ ++revision;},
    updateAssets: assets=>{state.production.assets=assets;},
    externalVideo:value=>{state.video={...state.video,...value};},
    externalBusy:value=>{state.busy=value;},
    externalCutInfo: (id,value)=>Object.assign(state.rows.find(r=>r.id===id),value),
  };
}

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
    assert.equal(ui.get('generate-all').disabled, true);
    assert.equal(ui.state().title, first === 'title' ? 'Draft title' : 'Original title');
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
  assert.equal(ui.requests.filter(request => request.route === 'bootstrap').length, 2);
  ui.get('api-key').value = 'test-fixture-not-a-real-key';
  await ui.get('key-form').emit('submit');
  const request = ui.requests.findLast(request => request.route === 'key');
  assert.equal(request.headers['X-Narration-Token'], 'fixture-token-2');
  assert.equal(ui.state().keyConfigured, true);
  assert.equal(ui.textArea('one', 'speech').value, 'Reading survives restart');
  assert.equal(ui.get('api-key').value, '');
});

test('batch correction sends pending instructions once, preserves untouched audio, and requires fresh reading before rebuilding changed audio',async()=>{
 const rows=[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'one.wav'},audioCurrent:true},{id:'two',caption:'次。',speech:'つぎ。',reviewed:true,attempts:1,audio:{file:'two.wav'},audioCurrent:true}];const ui=await setup({rows});const note=[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');await ui.edit(note,'説明を短くする');assert.equal(ui.get('confirm-full').disabled,true);await ui.get('apply-review').emit('click');await ui.poll();assert.match(ui.get('review-request-state').textContent,/01カットを修正しました/);assert.equal(ui.requests.filter(r=>r.route==='apply-review').length,1);assert.equal(ui.requests.find(r=>r.route==='apply-review').input.consent,true);assert.equal(ui.state().rows[0].audioCurrent,false);assert.equal(ui.state().rows[1].audio.file,'two.wav');assert.equal(ui.state().rows[1].audioCurrent,true);assert.equal(ui.requests.some(r=>['generate','approve','finalize'].includes(r.route)),false);assert.equal(ui.get('generate-all').disabled,true);await ui.get('confirm-script').emit('click');assert.equal(ui.get('generate-all').disabled,false);await ui.get('generate-all').emit('click');const call=ui.requests.find(r=>r.route==='generate');assert.deepEqual(call.input.ids,['one']);assert.equal(call.input.regenerate,true);assert.equal(ui.state().rows[1].audio.file,'two.wav');
});
test('individual correction applies only that cut and preserves other pending instructions; missing key cannot submit',async()=>{
 const ui=await setup();for(const n of [1,2])await ui.edit([...ui.get('rows').walk()].find(e=>e.attributes['aria-label']===n+'カットへの修正指示'),'直す');await ui.edit(ui.get('review-overall'),'全体を見直す');await [...ui.get('rows').walk()].find(e=>e.dataset.applyReview==='one').emit('click');assert.equal(ui.requests.find(r=>r.route==='apply-review').input.id,'one');assert.equal(ui.get('review-overall').value,'全体を見直す');assert.equal([...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='2カットへの修正指示').value,'直す');ui.restart();await ui.poll();assert.equal(ui.get('apply-review').disabled,true);assert.equal([...ui.get('rows').walk()].find(e=>e.dataset.applyReview==='two').disabled,true);
});

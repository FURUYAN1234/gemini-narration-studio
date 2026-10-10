import test from 'node:test';
import {scriptActionState,parseScriptParts,FRESH_BRIEF} from '../script-flow.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {VOICE_GENDERS,VOICES,MODELS,SAMPLE_SETTINGS} from '../core.mjs';
import {VIDEO_TEMPLATES,presentationDesign} from '../designs.mjs';
import {themeTokens} from '../themes.mjs';
import {fitText} from '../motion.mjs';

const appSource = (await readFile(new URL('../ui/app.mjs', import.meta.url), 'utf8')).replace(/^import .*\.mjs';\r?\n/gm,'');
const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

test('automatic BGM has no settings or separate listening panels and one video creation button',async()=>{
 assert.doesNotMatch(html,/id="(?:music-tools|music-enabled|music-direction|music-level|generate-music|remove-music|reuse-music|music-player|music-listening|full-audio|full-audio-info|full-listening-title)"/);
 const ui=await setup();assert.equal(ui.get('generate-all').textContent,'動画を作成');assert.equal(ui.requests.some(r=>['generate','generate-music'].includes(r.route)),false);
});

test('video creation includes automatic BGM when absent, including legacy disabled projects',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'説明。',speech:'せつめい。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});ui.externalMusic(undefined);ui.externalMusicEnabled(false);await ui.poll();await ui.get('generate-all').emit('click');
 const call=ui.requests.find(r=>r.route==='generate');assert.ok(call);assert.equal(call.input.createMusic,true);assert.equal(call.input.createVideo,true);assert.equal(call.input.musicDirection,'');assert.deepEqual(call.input.ids,[]);assert.equal(ui.state().production.musicEnabled,true);assert.equal(ui.requests.filter(r=>r.route==='generate').length,1);assert.equal(ui.requests.some(r=>r.route==='generate-music'),false);
});

test('video creation reuses prepared audio and BGM without paid regeneration and never offers separate audio playback',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'説明。',speech:'せつめい。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});const music={file:'a'.repeat(64)+'.mp3',durationSeconds:30,level:.16};ui.externalMusic(music);ui.externalMusicEnabled(false);await ui.poll();assert.equal(ui.get('finish').hidden,true);assert.equal(ui.get('generate-all').disabled,false);
 await ui.get('generate-all').emit('click');assert.equal(ui.requests.filter(r=>r.route==='render-preview').length,1);assert.equal(ui.requests.some(r=>['generate','generate-music'].includes(r.route)),false);assert.deepEqual(ui.state().production.music,music);assert.equal(ui.state().production.musicEnabled,true);
});

test('editing restart is hidden before final confirmation, including the initial HTML',async()=>{
 const initial=html.match(/<button[^>]*id="revise-project"[^>]*>/)?.[0];assert.ok(initial);assert.match(initial,/\bhidden\b/);assert.match(initial,/\bdisabled\b/);
 const ui=await setup();assert.equal(ui.get('revise-project').hidden,true);assert.equal(ui.get('revise-project').disabled,true);assert.equal(ui.get('revise-project-help').hidden,true);
 await assert.rejects(ui.get('revise-project').emit('click'));assert.equal(ui.requests.some(r=>r.route==='revision-project'),false);
});

test('finalized editing restart explains unlocking and reuse, preserves materials and audio and makes no paid request',async()=>{
 const file='a'.repeat(64)+'.jpg',ui=await setup({rows:[{id:'one',caption:'説明。',speech:'せつめい。',reviewed:true,cutImage:{file},audio:{file:'one.wav'},audioCurrent:true}],assets:[{file,name:'写真.jpg'}]});
 ui.externalFinalize();await ui.poll();const before=ui.state(),button=ui.get('revise-project');assert.equal(button.hidden,false);assert.equal(button.disabled,false);assert.match(html,/<button[^>]*id="revise-project"[^>]*>最終確定を解除して編集を再開<\/button>/);assert.equal(button.attributes['aria-describedby'],'revise-project-help');assert.equal(ui.get('revise-project-help').hidden,false);const help=html.match(/<p[^>]*id="revise-project-help"[^>]*>([^<]+)<\/p>/)?.[1]||'';assert.match(help,/台本・画像・作成済み音声.*引き継/);assert.match(help,/再生成.*しません/);
 await button.emit('click');assert.equal(ui.requests.filter(r=>r.route==='revision-project').length,1);assert.equal(ui.requests.some(r=>['generate','regenerate-image','source-plan','draft'].includes(r.route)),false);assert.deepEqual(ui.state().rows[0].audio,before.rows[0].audio);assert.deepEqual(ui.state().production.assets,before.production.assets);assert.equal(ui.state().production.finalization,null);assert.equal(ui.get('revise-project').hidden,true);assert.equal(ui.get('revise-project-help').hidden,true);
});

test('editing restart cannot release a lock while generation or other work is running',async()=>{
 const ui=await setup();ui.externalFinalize();ui.externalVideo({running:true});await ui.poll();assert.equal(ui.get('revise-project').hidden,false);assert.equal(ui.get('revise-project').disabled,true);await assert.rejects(ui.get('revise-project').emit('click'));
 ui.externalVideo({running:false});ui.externalBusy(true);await ui.poll();assert.equal(ui.get('revise-project').disabled,true);assert.equal(ui.requests.some(r=>r.route==='revision-project'),false);
});

test('reference images are optional, collapsed and selected visually without generating or replacing artwork',async()=>{
 const assets=['a','b','c','d'].map((x,i)=>({file:x.repeat(64)+'.png',name:`素材${i+1}.png`}));
 const ui=await setup({rows:[{id:'one',caption:'説明。',speech:'せつめい。',cutImage:{file:assets[0].file}}],assets});
 const all=()=>[...ui.get('rows').walk()],picker=all().find(e=>e.dataset.imageReferencePicker==='one');assert.ok(picker);assert.equal(!!picker.open,false);
 assert.equal(all().some(e=>e.tagName==='select'&&e.dataset.imageReferences),false);assert.equal(all().some(e=>e.dataset.imageReference),false);
 picker.open=true;await picker.emit('toggle');let choices=all().filter(e=>e.dataset.imageReference);assert.equal(choices.length,4);
 for(const choice of choices){assert.ok([...choice.walk()].some(e=>e.tagName==='img'&&e.attributes.src==='/materials/'+choice.dataset.imageReference));assert.equal(choice.attributes['aria-pressed'],'false');}
 for(const choice of choices.slice(0,3))await choice.emit('click');assert.equal(choices[3].disabled,true);assert.equal(choices[0].disabled,false);assert.match([...picker.walk()].find(e=>e.attributes.role==='status').textContent,/3.*3/);
 await choices[0].emit('click');assert.equal(choices[3].disabled,false);await choices[3].emit('click');assert.equal(ui.requests.some(r=>['regenerate-image','generate','cut-image'].includes(r.route)),false);assert.equal(ui.state().rows[0].cutImage.file,assets[0].file);
 const selectedFiles=assets.slice(1).map(a=>a.file);await all().find(e=>e.dataset.generateImage==='one').emit('click');assert.deepEqual(ui.requests.find(r=>r.route==='regenerate-image').input.references,selectedFiles);
});

test('reference selection is per cut, survives harmless redraws and cannot be changed during an operation',async()=>{
 const file='a'.repeat(64)+'.jpg',ui=await setup({assets:[{file,name:'写真.jpg'}]});
 const find=key=>[...ui.get('rows').walk()].find(e=>e.dataset[key]==='one');let picker=find('imageReferencePicker');picker.open=true;await picker.emit('toggle');await [...picker.walk()].find(e=>e.dataset.imageReference===file).emit('click');
 ui.externalBusy(true);await ui.poll();picker=find('imageReferencePicker');assert.equal(picker.open,true);const selected=[...picker.walk()].find(e=>e.dataset.imageReference===file);assert.equal(selected.attributes['aria-pressed'],'true');assert.equal(selected.disabled,true);
 ui.externalBusy(false);await ui.poll();assert.equal([...find('imageReferencePicker').walk()].find(e=>e.dataset.imageReference===file).disabled,false);
 await [...ui.get('rows').walk()].find(e=>e.dataset.generateImage==='two').emit('click');assert.equal(ui.requests.find(r=>r.route==='regenerate-image').input.references,undefined);
});

test('the production bar has no history selector while current-production controls remain usable',async()=>{
 assert.doesNotMatch(html,/project-select|保存した制作を開く/);const ui=await setup();assert.equal(ui.get('new-project').disabled,false);assert.equal(ui.requests.some(r=>r.route==='project'),false);
});

test('preview headings use the renderer word wrapping on resize without losing or repeatedly splitting text',async()=>{
 const ui=await setup(),node=ui.get('direction-title');node.classList.add('preview-heading');Object.assign(node,{clientWidth:560,clientHeight:250,scrollWidth:560,scrollHeight:200});
 for(const title of ['自分で行う！発信者情報開示請求','使いやすい画像生成機能']){
  node.textContent=title;ui.resize();assert.equal(node.textContent.replaceAll('\n',''),title);for(const compound of title.match(/[\p{Script=Han}]{2,}/gu))assert.ok(node.textContent.split('\n').some(line=>line.includes(compound)));
  const first=node.textContent;ui.resize();assert.equal(node.textContent,first);assert.equal(node.style.whiteSpace,'pre');assert.equal(node.style.overflowWrap,'normal');
 }
 node.clientWidth=180;ui.resize();assert.ok(node.textContent.split('\n').includes('画像生成機能'));
});

async function previewReady(ui){ui.externalVideo({running:false,stage:'complete',result:{reviewState:'pending',file:'a'.repeat(64)+'.mp4',filename:'Fixture.mp4',savedPath:'Fixture/Fixture.mp4',audio:{file:'b'.repeat(64)+'.m4a',filename:'Fixture.m4a',savedPath:'Fixture/Fixture.m4a'}}});await ui.poll();}

test('unregistered API click warns, focuses connection, sends nothing and blocks following stages',async()=>{
 const ui=await setup({rows:[]});ui.restart();await ui.poll();await ui.edit(ui.get('source-urls'),'https://example.com/article');
 assert.equal(ui.get('generate-script').disabled,false);await ui.get('generate-script').emit('click');
 assert.equal(ui.get('api-required-alert').hidden,false);assert.match(ui.get('api-required-message').textContent,/APIキー.*未登録/);assert.equal(ui.get('api-settings').open,true);assert.equal(ui.get('api-key').focused,true);await ui.get('api-required-dismiss').emit('click');assert.equal(ui.get('api-required-alert').hidden,false);assert.equal(ui.get('api-key').focused,true);
 assert.equal(ui.requests.some(r=>['draft','source-plan','generate','render-video'].includes(r.route)),false);
 assert.equal(ui.get('connection').inert,true);assert.equal(ui.get('reading').inert,true);assert.equal(ui.get('finish').inert,true);
 await ui.edit(ui.get('api-key'),'test-only-key');await ui.get('key-form').emit('submit');assert.equal(ui.get('generate-script').disabled,false);assert.equal(ui.get('api-required-alert').hidden,true);
});

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
test('one cut review groups artwork, editable caption and reading, correction and replacement controls by the same row',async()=>{
 const file='a'.repeat(64)+'.jpg',ui=await setup({rows:[{id:'one',caption:'紹介します。',speech:'しょうかいします。',reviewed:true,cutImage:{file},audio:{file:'one.wav'},audioCurrent:true}],assets:[{file,name:'素材.jpg'}]});
 const card=[...ui.get('rows').walk()].find(e=>e.dataset.rowId==='one'),content=[...card.walk()].find(e=>e.attributes.class==='cut-review-content');assert.ok(content);assert.equal(content.children.length,2);
 assert.ok([...content.children[0].walk()].some(e=>e.tagName==='img'));assert.equal([...content.children[0].walk()].some(e=>e.dataset.cutImage==='one'),false);assert.ok([...content.children[0].walk()].some(e=>e.tagName==='a'&&e.attributes.href==='/materials/'+file&&e.attributes.target==='_blank'));
 assert.ok([...content.children[1].walk()].includes(ui.textArea('one','caption')));assert.ok([...content.children[1].walk()].includes(ui.textArea('one','speech')));
 assert.ok([...card.walk()].some(e=>e.dataset.applyReview==='one'));assert.ok([...card.walk()].some(e=>e.dataset.generateImage==='one'));
 await ui.edit(ui.textArea('one','speech'),'ていねいにしょうかいします。');assert.equal([...card.walk()].find(e=>e.dataset.generateImage==='one').disabled,true);await [...card.walk()].find(e=>e.tagName==='button'&&e.textContent==='変更を保存').emit('click');assert.equal(ui.state().rows[0].cutImage.file,file);assert.equal(ui.state().rows[0].reviewed,false);assert.equal(ui.state().rows[0].audioCurrent,false);assert.equal(ui.requests.some(r=>['regenerate-image','generate','approve'].includes(r.route)),false);
 ui.externalFinalize();await ui.poll();assert.equal(ui.textArea('one','speech').disabled,true);assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.generateImage==='one'),false);
});

test('regenerating artwork from the unified cut keeps readings and audio, and requires explicit candidate adoption',async()=>{
 const old='a'.repeat(64)+'.jpg',next='b'.repeat(64)+'.png',ui=await setup({rows:[{id:'one',caption:'道具の紹介。',speech:'どうぐのしょうかい。',reviewed:true,cutImage:{file:old},audio:{file:'one.wav'},audioCurrent:true,cutConfirmed:false}],assets:[{file:old,name:'選択画像.jpg'}]});
 const find=key=>[...ui.get('rows').walk()].find(e=>e.dataset[key]==='one');await find('generateImage').emit('click');
 assert.equal(ui.requests.filter(r=>r.route==='regenerate-image').length,1);assert.equal(ui.requests.find(r=>r.route==='regenerate-image').input.id,'one');assert.equal(ui.requests.some(r=>['generate','approve','approve-images'].includes(r.route)),false);
 assert.equal(ui.state().rows[0].cutImage.file,old);assert.equal(ui.state().rows[0].reviewed,true);assert.equal(ui.state().rows[0].audioCurrent,true);assert.ok([...ui.get('rows').walk()].some(e=>e.tagName==='img'&&e.attributes.src==='/materials/'+next));
 await find('adoptImage').emit('click');assert.equal(ui.state().rows[0].cutImage.file,next);assert.equal(ui.state().rows[0].audio.file,'one.wav');assert.equal(ui.state().rows[0].reviewed,true);assert.equal(ui.state().rows[0].cutConfirmed,false);
});

test('the first compose click displays and preserves a saved script even when a reading candidate needs correction',async()=>{
 const sourcePlan={script:'道具を紹介します。',readings:[{caption:'道具を紹介します。',speech:'道具を、しょうかいします。'}],warnings:[{stage:'reading',code:'READING_REVIEW_REQUIRED'}],attempt:{state:'partial'}};
 const ui=await setup({rows:[],sourcePlan});await ui.edit(ui.get('source-text'),'道具の説明資料');await ui.get('generate-script').emit('click');assert.equal(ui.get('script-input').value,sourcePlan.script);assert.match(ui.get('source-status').textContent,/台本は作成.*読み.*要修正/);assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.requests.some(r=>['prepare-readings','generate','approve'].includes(r.route)),false);await ui.poll();assert.equal(ui.get('script-input').value,sourcePlan.script);assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);
});

test('unresolved reading candidates remain editable but cannot be confirmed or synthesized unchanged',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'道具を紹介します。',speech:'道具を、しょうかいします。',readingPreparationRequired:true,reviewed:false}]});assert.equal(ui.textArea('one','speech').disabled,false);assert.equal(ui.get('confirm-script').disabled,true);assert.equal(ui.get('generate-all').disabled,true);assert.equal(ui.get('prepare-readings').hidden,false);assert.match(ui.get('reading-prep-status').textContent,/台本は保持.*要修正/);assert.equal(ui.requests.some(r=>['prepare-readings','generate'].includes(r.route)),false);
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
  if(concurrent){assert.equal(ui.requests.some(r=>r.route==='adopt-script'),false);assert.equal(ui.state().production.brief.instructions,'他の画面で編集');assert.match(ui.get('script-status').textContent,/台本が更新|STALE_REVISION/);}
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
test('one creation action includes video and preserves post-generation review without sealing or claiming listening',async()=>{
 const ui=await setup({secondReviewed:false});await ui.get('confirm-script').emit('click');await ui.get('generate-all').emit('click');assert.equal(ui.location.hash,'#finish');assert.equal(ui.requests.filter(r=>r.route==='generate').length,1);assert.equal(ui.requests.find(r=>r.route==='generate').input.createVideo,true);assert.equal(ui.requests.some(r=>['listened','confirm-cut','finalize','render-video'].includes(r.route)),false);assert.equal(ui.state().rows.every(r=>!r.listenedCurrent),true);
 assert.ok(html.indexOf('id="confirm-full"')>html.indexOf('id="finish"'));assert.ok(html.indexOf('id="generate-script"')<html.indexOf('id="script-input"'));assert.ok(html.indexOf('id="regenerate-script"')<html.indexOf('id="script-input"'));
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
test('new productions default to automatic BGM without a settings control or provider call',async()=>{
 const ui=await setup({rows:[]});await ui.get('new-project').emit('click');assert.equal(ui.state().production.musicEnabled,true);assert.doesNotMatch(html,/id="music-enabled"/);assert.equal(ui.requests.some(r=>['generate','generate-music','source-plan','draft'].includes(r.route)),false);
});
test('editing already generated narration exposes one explicit regeneration action and keeps untouched audio',async()=>{
const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'old.wav'},audioCurrent:true,listenedCurrent:true},{id:'two',caption:'次。',speech:'つぎ。',reviewed:true,attempts:1,audio:{file:'two.wav'},audioCurrent:true,listenedCurrent:true}]});await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');await ui.get('confirm-script').emit('click');assert.equal(ui.get('generate-all').disabled,true);await ui.get('retry-audio').emit('click');assert.equal(ui.requests.some(r=>r.route==='generate'),false);await ui.get('retry-confirm-send').emit('click');const calls=ui.requests.filter(r=>r.route==='generate');assert.equal(calls.length,1);assert.deepEqual(calls[0].input.ids,['one']);assert.equal(calls[0].input.regenerate,true);assert.equal(ui.state().rows[1].audio.file,'two.wav');
});
test('motion choice requires saving, uses only presentation endpoint, survives polling and refuses sealed edits',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:true}]});ui.get('motion-style').value='kinetic';await ui.get('motion-style').emit('change');await ui.poll();assert.equal(ui.get('motion-style').value,'kinetic');assert.equal(ui.get('apply-motion').disabled,false);
 await ui.get('apply-direction').emit('click');assert.equal(ui.state().presentation.motion.style,'kinetic');assert.equal(ui.get('apply-motion').disabled,true);assert.equal(ui.requests.some(r=>['generate','draft','design-draft'].includes(r.route)),false);
 ui.get('motion-style').value='cinematic';await ui.get('motion-style').emit('change');ui.get('motion-style').value='kinetic';await ui.get('motion-style').emit('change');assert.equal(ui.get('apply-motion').disabled,true);assert.equal(ui.get('confirm-full').disabled,false);
 await previewReady(ui);await ui.get('confirm-full').emit('click');assert.equal(ui.get('motion-style').disabled,true);assert.equal(ui.get('apply-motion').disabled,true);
});
test('cut correction input has a send/apply action and global reading confirmation remains distinct',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:true}]});const list=[...ui.get('rows').walk()],input=list.findIndex(e=>e.attributes['aria-label']==='1カットへの修正指示'),apply=list.findIndex(e=>e.dataset.applyReview==='one');assert.ok(input>=0&&input<apply);assert.equal(list.some(e=>e.dataset.confirmCut||e.dataset.editCut),false);assert.equal(ui.get('confirm-script').disabled,true);assert.match(html,/<div class="reading-confirm-actions"><button id="confirm-script"/);
});

test('cut review file selection reuses audio while invalidating the cut confirmation',async()=>{
 const bytes=new Uint8Array([7,8,9]),file=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')+'.png',ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:true,cutConfirmed:true}]});
 const upload=[...ui.get('rows').walk()].find(e=>e.attributes.type==='file');assert.equal(upload.disabled,false);assert.match(upload.attributes.accept,/\.jpg/);upload.files=[{name:'持込画像.png',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];await upload.emit('change');assert.equal(ui.state().rows[0].cutImage.file,file);assert.equal(ui.state().rows[0].audioCurrent,true);assert.equal(ui.state().rows[0].cutConfirmed,false);assert.equal([...ui.get('rows').walk()].find(e=>e.tagName==='img').attributes.src,'/materials/'+file);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
 const preview=[...ui.get('rows').walk()].find(e=>e.classList.contains('cut-template-preview'));assert.ok(preview);assert.ok([...preview.walk()].some(e=>e.attributes.class==='preview-heading'));assert.ok([...preview.walk()].some(e=>e.attributes.class==='preview-caption'&&e.textContent==='字幕。'));
});
test('returning to a sealed step creates an editable revision and retains the original audio',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await previewReady(ui);await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'idle'});await ui.poll();const audio=ui.state().rows[0].audio;await ui.get('revise-connection').emit('click');assert.equal(ui.state().projectId,'revision-project');assert.equal(ui.location.hash,'#connection');assert.equal(ui.state().production.finalization,null);assert.deepEqual(ui.state().rows[0].audio,audio);assert.equal(ui.get('voice').disabled,false);assert.equal(ui.requests.filter(r=>r.route==='revision-project').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
for(const step of ['planning','connection','reading','finish'])test(step+' allows idle workflow interruption and resumption without changing approvals or discarding draft input',async()=>{
 const ui=await setup();if(step==='finish'){ui.externalVideo({stage:'failed',error:'FIXTURE_RENDER_FAILED'});await ui.poll();}const before=ui.state().rows;await ui.edit(ui.textArea('one','speech'),'保存前のよみ');await ui.edit(ui.get('production-instructions'),'保存前の制作指示');
 assert.equal(ui.get('cancel-'+step).disabled,false);await ui.get('cancel-'+step).emit('click');assert.equal(ui.get('workflow-paused').hidden,false);assert.equal(ui.get(step).hidden,true);assert.equal(ui.location.hash,'#workflow-paused');assert.deepEqual(ui.state().rows,before);assert.equal(ui.requests.some(r=>r.route==='unapprove'||r.route==='cancel'||r.route==='generate'),false);
 await ui.get('resume-workflow').emit('click');assert.equal(ui.get(step).hidden,false);assert.equal(ui.get('workflow-paused').hidden,true);assert.equal(ui.location.hash,'#'+step);assert.equal(ui.textArea('one','speech').value,'保存前のよみ');assert.equal(ui.get('production-instructions').value,'保存前の制作指示');
});
test('workflow interruption is available before reading approvals and saved paused view reloads without a provider request',async()=>{
 const empty=await setup({rows:[]});empty.restart();await empty.poll();assert.equal(empty.get('cancel-planning').disabled,false);await empty.get('cancel-planning').emit('click');assert.equal(empty.get('workflow-paused').hidden,false);
 const restored=await setup({pausedStep:'reading'});assert.equal(restored.get('workflow-paused').hidden,false);assert.equal(restored.get('reading').hidden,true);await restored.get('resume-workflow').emit('click');assert.equal(restored.location.hash,'#reading');assert.equal(restored.requests.some(r=>['generate','cancel','draft'].includes(r.route)),false);
 assert.doesNotMatch(html,/<a href="#reading">全文確認へ進む<\/a>/);
});

test('API registration alone enables explicit narration without a separate checkbox or automatic synthesis',async()=>{
 const ui=await setup();ui.restart();await ui.poll();assert.equal(ui.get('generate-all').disabled,false);assert.equal(ui.get('generation-next').hidden,true);
 ui.get('api-key').value='not-a-real-key';await ui.get('key-form').emit('submit');assert.equal(ui.get('api-settings').open,false);assert.equal(ui.get('generate-all').disabled,false);assert.equal(ui.get('generation-next').hidden,true);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
for(const control of ['unconfirm-script'])test(control+' can undo idle reading confirmation without losing text/audio or local edits',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,attempts:1,audio:{file:'old.wav'},audioCurrent:true,listenedCurrent:true,cutConfirmed:false}]});const before=ui.state().rows[0];await ui.edit(ui.textArea('one','speech'),'保存前の修正');assert.equal(ui.get(control).disabled,false);await ui.get(control).emit('click');assert.equal(ui.state().rows[0].reviewed,false);assert.equal(ui.state().rows[0].speech,before.speech);assert.deepEqual(ui.state().rows[0].audio,before.audio);assert.equal(ui.textArea('one','speech').value,'保存前の修正');assert.ok(!html.includes('id="consent"'));assert.equal(ui.requests.filter(r=>r.route==='unapprove').length,1);assert.equal(ui.requests.some(r=>r.route==='cancel'||r.route==='generate'),false);assert.match(ui.get('cancel-status').textContent,/編集に戻れます/);
});
test('final seal hides reading undo/next actions and active synthesis keeps cancellation as execution cancellation',async()=>{
 const sealed=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await previewReady(sealed);await sealed.get('confirm-full').emit('click');assert.equal(sealed.get('unconfirm-script').hidden,true);assert.equal(sealed.get('reading-next').hidden,true);assert.equal(sealed.get('cancel').disabled,false);
 const active=await setup();active.externalBusy(true);await active.poll();assert.equal(active.get('unconfirm-script').disabled,true);assert.equal(active.get('cancel').disabled,false);assert.match(active.get('cancel').textContent,/処理を中止/);await active.get('cancel').emit('click');assert.equal(active.requests.filter(r=>r.route==='cancel').length,1);assert.equal(active.requests.some(r=>r.route==='unapprove'),false);
});
test('cancellation stays usable while the AI request promise itself is still pending',async()=>{
 let release;const draftWait=new Promise(r=>release=r),ui=await setup({draftWait,rows:[]});await ui.edit(ui.get('production-instructions'),'作成指示');const running=ui.sendScript({confirmOverwrite:true});await new Promise(r=>setImmediate(r));await ui.poll();assert.equal(ui.state().busy,true);assert.equal(ui.get('cancel').disabled,false);await ui.get('cancel').emit('click');assert.equal(ui.get('workflow-paused').hidden,true);release();await running;assert.equal(ui.get('workflow-paused').hidden,false);assert.equal(ui.requests.filter(r=>r.route==='cancel').length,1);assert.equal(ui.requests.some(r=>r.route==='unapprove'),false);
});

test('AI hiragana readings survive local saving/polling and are passed into review without another provider request',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'作りたい動画');await ui.sendScript({confirmOverwrite:true});assert.equal(ui.get('append-script').textContent,'次へ：声を選ぶ →');await ui.get('save-production').emit('click');await ui.poll();assert.deepEqual(ui.state().production.brief.readings,[{caption:'AI draft result',speech:'えーあいだいほん。'}]);await ui.get('plan-sources').emit('click');const request=ui.requests.find(r=>r.route==='adopt-script');assert.equal(request.input.readings[0].speech,'えーあいだいほん。');assert.equal(request.input.consent,undefined);assert.equal(ui.state().rows.at(-1).speech,'えーあいだいほん。');assert.equal(ui.requests.filter(r=>r.route==='draft').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});
test('changed or pasted captions disclose one reading preparation request; missing key warns without submitting and stale readings are not reused',async()=>{
const ui=await setup();await ui.edit(ui.get('production-instructions'),'作成指示');await ui.sendScript({confirmOverwrite:true});await ui.edit(ui.get('script-input'),'変更した字幕。');await ui.get('plan-sources').emit('click');const request=ui.requests.find(r=>r.route==='adopt-script');assert.equal(request.input.readings,undefined);assert.equal(ui.state().rows[0].speech,'');assert.match(ui.get('prepare-readings').textContent,/API 1回/);ui.restart();await ui.poll();assert.equal(ui.get('prepare-readings').disabled,false);assert.equal(ui.requests.filter(r=>r.route==='draft').length,1);
});
test('reading hints are explained, deduplicated and collapsed while clean hiragana shows no hint list',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'AIの画像。',speech:'AIの画像。',hints:[{term:'AI',kind:'latin'},{term:'AI',kind:'latin'},{term:'画像',kind:'kanji'}]}]});const detail=[...ui.get('rows').walk()].find(e=>e.attributes.class==='reading-hints');assert.equal(detail.open,false);assert.equal(detail.children[0].textContent,'読みの確認候補 2語');assert.match(detail.children[1].textContent,/判定した一覧ではありません/);
 const clean=await setup({rows:[{id:'one',caption:'AIの画像。',speech:'えーあいのがぞう。',hints:[]}]});assert.equal([...clean.get('rows').walk()].some(e=>e.attributes.class==='reading-hints'),false);
});

test('local saving reports completion beside its separated control and reading navigation reuses loaded script',async()=>{
 const ui=await setup();assert.ok(!html.includes('取り込み済み台本の読み確認へ'));assert.match(html,/class="production-save"/);
 await ui.edit(ui.get('production-instructions'),'Keep these directions');await ui.get('save-production').emit('click');assert.match(ui.get('save-status').textContent,/保存しました/);assert.equal(ui.state().production.brief.instructions,'Keep these directions');
 await ui.get('plan-sources').emit('click');assert.equal(ui.location.hash,'#connection');assert.match(ui.get('script-status').textContent,/声を選んだ後/);assert.equal(ui.requests.some(r=>r.route==='draft'||r.route==='generate'),false);
 await ui.edit(ui.get('script-input'),'');assert.equal(ui.get('append-script').disabled,true);
});
test('current production distinguishes editing from finalized viewing and active video can be canceled without publishing',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});assert.equal(!!ui.state().production.finalization,false);
 await previewReady(ui);await ui.get('confirm-full').emit('click');assert.ok(ui.state().production.finalization);assert.equal(ui.get('cancel').disabled,false);
 ui.externalVideo({running:true,stage:'rendering',steps:['preparing','bundling','rendering']});await ui.poll();await ui.get('cancel').emit('click');assert.equal(ui.state().video.stage,'canceled');assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.get('video-spinner').hidden,true);assert.equal(ui.get('cancel').disabled,true);assert.match(ui.get('cancel-status').textContent,/中止/);assert.match(ui.get('video-stages').children.at(-1).textContent,/中止/);assert.equal(ui.get('confirm-full').textContent,'動画生成を再開する');assert.equal(ui.requests.filter(r=>r.route==='cancel').length,1);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('automatic AI choices cannot block a genuinely empty new production or cause a false new-project label',async()=>{
 const file='a'.repeat(64)+'.png',ui=await setup({storyboard:{voice:'Puck',scenes:[{caption:'Caption one'},{caption:'Caption two'}]},assets:[{file,name:'前の画像.png'}]});
 assert.match(ui.get('resume-info').textContent,/制作中|再開/);assert.equal(ui.get('new-project').disabled,false);assert.equal(ui.beforeUnload().prevented,false);
 await ui.get('new-project').emit('click');assert.equal(ui.state().rows.length,0);assert.equal(ui.state().production.assets.length,0);assert.equal(ui.get('material-list').children.length,0);assert.equal(ui.get('script-input').value,'');assert.equal(ui.get('source-urls').value,'');assert.equal(ui.get('opening-speech').value,'');assert.equal(ui.get('voice-proposal').hidden,true);assert.equal([...ui.get('rows').walk()].filter(e=>e.tagName==='img').length,0);
 await ui.edit(ui.get('production-instructions'),'未保存の本人の編集');assert.equal(ui.get('new-project').disabled,true);assert.equal(ui.beforeUnload().prevented,true);
});

test('polling a project change in another tab cannot mix production data or authorize writes with old drafts',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'元の制作の未保存入力');const bootCount=ui.requests.filter(r=>r.route==='bootstrap').length;
 ui.externalProject();await ui.poll();assert.equal(ui.get('production-instructions').value,'元の制作の未保存入力');assert.equal(ui.requests.filter(r=>r.route==='bootstrap').length,bootCount);assert.match(ui.get('message').textContent,/別の.*制作|別の.*タブ/);
 await ui.get('save-production').emit('click');assert.equal(ui.requests.some(r=>r.route==='production'),false);assert.equal(ui.get('production-instructions').value,'元の制作の未保存入力');
});

test('new video exits the completed-project lock and can decide a template/palette without a history selector',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await previewReady(ui);await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'idle'});await ui.poll();
 const original=ui.state();assert.equal(ui.get('new-project').disabled,false);assert.equal(ui.get('theme').disabled,false);
 ui.get('theme').value='black';await ui.get('theme').emit('change');await ui.poll();assert.equal(ui.get('theme').value,'black');assert.deepEqual(ui.state().presentation,original.presentation);assert.equal(ui.requests.some(r=>r.route==='presentation'),false);
 await ui.get('new-project').emit('click');assert.equal(ui.state().rows.length,0);assert.equal(ui.state().production.finalization,null);assert.equal(ui.get('job-title').disabled,false,ui.get('message').textContent);assert.equal(ui.get('theme').disabled,false);assert.ok(!html.includes('id="consent"'));
 ui.get('auto-direction').checked=false;await ui.get('auto-direction').emit('change');await ui.get('template-gallery').children.find(b=>b.dataset.template==='blueprint').emit('click');assert.equal(ui.get('apply-design').disabled,false);await ui.get('apply-direction').emit('click');
 ui.get('theme').value='white';await ui.get('theme').emit('change');assert.equal(ui.state().presentation.template,'blueprint');assert.equal(ui.state().presentation.theme,'white');assert.equal(ui.requests.some(r=>r.route==='generate'||r.route==='design-draft'),false);
});
test('new production UI is disabled while edits are unsaved or generation is active',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'Unsaved production directions');assert.equal(ui.get('new-project').disabled,true);assert.match(ui.get('project-info').textContent,/保存/);
 await ui.get('save-production').emit('click');assert.equal(ui.get('new-project').disabled,false);
 ui.externalVideo({running:true});await ui.poll();assert.equal(ui.get('new-project').disabled,true);assert.equal(ui.requests.some(r=>r.route==='new-project'),false);
});

test('script and prepared artwork enter one cut review after loading without a duplicate image gallery',async()=>{
 const file='a'.repeat(64)+'.png',sourcePlan={script:'新しい説明です。',readings:[{caption:'新しい説明です。',speech:'あたらしいせつめいです。'}],storyboard:{title:'説明',summary:'概要',voice:'Kore',voiceReason:'明瞭な解説',sources:[],scenes:[{caption:'新しい説明です。',title:'新しい場面',points:[],imageFile:file,sourceIds:[]}]}};
 const ui=await setup({sourcePlan,rows:[],assets:[{file,name:'生成画像.png',origin:'generated-image'}]});await ui.edit(ui.get('source-text'),'参考本文');await ui.get('generate-script').emit('click');
 assert.equal([...ui.get('storyboard-preview').walk()].some(e=>e.tagName==='img'),false);assert.equal(ui.state().rows.length,0);assert.equal(ui.requests.some(r=>['prepare-images','regenerate-image','approve','generate'].includes(r.route)),false);
 await ui.get('plan-sources').emit('click');assert.equal(ui.location.hash,'#connection');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);await ui.get('apply-voice').emit('click');assert.equal(ui.requests.some(r=>['prepare-images','regenerate-image','generate'].includes(r.route)),false);const card=[...ui.get('rows').walk()].find(e=>e.dataset.rowId==='adopted-0');assert.ok(card);assert.ok([...card.walk()].some(e=>e.tagName==='img'&&e.attributes.src==='/materials/'+file));assert.equal(ui.textArea('adopted-0','speech').value,'あたらしいせつめいです。');assert.ok([...card.walk()].some(e=>e.dataset.generateImage==='adopted-0'));assert.ok([...card.walk()].some(e=>e.attributes.type==='file'));assert.equal(ui.state().rows[0].reviewed,false);assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);
});
test('planning action creates an editable script before narration/video through one unified input flow',()=>{
 assert.match(html,/台本と準備素材を読み込んで声選びへ/);assert.doesNotMatch(html,/素材から動画を組み立てる（API利用）/);assert.ok(html.indexOf('class="text-only-alternative"')<html.indexOf('id="draft-script"'));assert.match(html,/不足画像も作成してから結果を表示/);
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
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});await previewReady(ui);await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'idle'});await ui.poll();const before=ui.state().presentation;
 await ui.get('template-gallery').children.find(b=>b.dataset.template==='pop').emit('click');assert.equal(ui.get('apply-design').disabled,true);await ui.poll();assert.deepEqual(ui.state().presentation,before);assert.equal(ui.get('confirm-full').disabled,false);assert.equal(ui.requests.some(r=>r.route==='presentation'||r.route==='design-draft'),false);assert.match(ui.get('design-selection').textContent,/最終確定済み/);
 ui.restart();await ui.poll();assert.equal(ui.get('api-settings').open,false);assert.equal(ui.get('api-connection').classList.contains('needs-key'),false);
});

test('video generation shows only actual progress, publishes player/download after saving, and preserves the final seal',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:false}]});
 assert.equal(ui.get('confirm-full').disabled,false);await ui.get('generate-all').emit('click');assert.equal(ui.get('confirm-full').disabled,true);
 assert.equal(ui.requests.filter(r=>r.route==='render-preview').length,1);assert.equal(ui.get('video-spinner').hidden,false);assert.equal(ui.get('video-progress').value,.4);assert.match(ui.get('video-status').textContent,/40 \/ 100/);assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.get('confirm-full').disabled,true);
 ui.externalVideo({running:false,stage:'complete',progress:1,result:{file:'a'.repeat(64)+'.mp4',filename:'Video.mp4',savedPath:'Downloads/Video.mp4',audio:{file:'b'.repeat(64)+'.m4a',filename:'Audio.m4a',savedPath:'Downloads/Audio.m4a'}}});await ui.poll();
 assert.equal(ui.get('video-spinner').hidden,true);assert.equal(ui.get('video-result').hidden,false);assert.equal(ui.get('video-player').src,'/video/'+'a'.repeat(64)+'.mp4');assert.match(ui.get('video-saved-path').textContent,/保存済み/);assert.equal(ui.get('download-audio').hidden,false);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
 ui.externalVideo({result:null,stage:'failed',error:'VIDEO_RENDER_FAILED',steps:['preparing','bundling','rendering']});await ui.poll();assert.equal(ui.get('video-result').hidden,true);assert.match(ui.get('video-status').textContent,/VIDEO_RENDER_FAILED/);assert.match(ui.get('video-stages').children.at(-1).textContent,/失敗/);assert.equal(ui.requests.filter(r=>r.route==='render-preview').length,1);
 ui.externalVideo({result:null,stage:'failed',error:'VIDEO_FONT_TIMEOUT',steps:['preparing','bundling','rendering']});await ui.poll();assert.match(ui.get('video-status').textContent,/日本語フォント.*時間切れ/);assert.equal(ui.get('video-result').hidden,true);assert.equal(ui.requests.filter(r=>r.route==='render-preview').length,1);
});

test('initial voice remains a candidate and next step saves it without synthesis',async()=>{
 const ui=await setup({voiceConfirmed:false});assert.match(ui.get('voice-apply-state').textContent,/候補/);assert.equal(ui.get('apply-voice').disabled,false);
 await ui.edit(ui.get('pitch'),'high');assert.equal(ui.requests.some(r=>r.route==='settings'),false);await ui.get('apply-voice').emit('click');assert.equal(ui.location.hash,'#reading');assert.equal(ui.state().voiceConfirmed,true);assert.equal(ui.state().settings.pitch,'high');assert.match(ui.get('voice-apply-state').textContent,/保存した声：Kore/);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('review shows only the next useful actions, makes the send action explicit and places stale-audio repair inside its cut',async()=>{
 const ui=await setup({secondReviewed:true});assert.equal(ui.get('confirm-script').hidden,true);assert.equal(ui.get('confirm-script').disabled,true);
 assert.match(ui.get('review-save-state').textContent,/全文の読みは確定済み/);
 assert.equal(ui.get('confirm-full').hidden,true);
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
 const ui=await setup({secondReviewed:true});await ui.get('generate-all').emit('click');assert.equal(ui.state().rows.every(r=>r.audioCurrent),true);assert.equal(ui.get('generation-tools').hidden,false);assert.equal(ui.get('confirm-full').disabled,false);assert.equal(ui.location.hash,'#finish');assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.confirmCut||e.dataset.editCut),false);assert.equal(ui.textArea('one','speech').disabled,false);assert.equal(ui.requests.some(r=>r.route==='confirm-cut'||r.route==='finalize'),false);
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
test('cached voice sample plays locally without key or consent; pitch selection makes no provider request',async()=>{const ui=await setup();ui.restart();await ui.poll();assert.equal(ui.get('preview-voice').hidden,false);await ui.get('sample-audio').play();assert.equal(ui.get('sample-audio').src,'/samples/sample-kore.wav');assert.equal(ui.get('sample-audio').played,true);assert.equal(ui.requests.some(r=>r.route==='preview'),false);await ui.edit(ui.get('pitch'),'low');assert.equal(ui.get('preview-voice').disabled,false);assert.equal(ui.requests.some(r=>r.route==='settings'||r.route==='generate'),false);});
test('one voice menu selects its saved sample without a second menu, key, consent or provider request',async()=>{const ui=await setup();ui.restart();await ui.poll();await ui.edit(ui.get('voice'),'Puck');await ui.get('voice').emit('change');assert.equal(ui.get('voice').value,'Puck');assert.equal(ui.get('sample-audio').src,'/samples/sample-puck.wav');assert.equal(ui.get('preview-voice').disabled,false);assert.equal(ui.requests.some(r=>r.route==='settings'||r.route==='generate'||r.route==='preview'),false);assert.equal(/id="sample-library"/.test(html),false);});
test('brief modes, instructions and script drafts survive polling and unrelated saves',async()=>{const ui=await setup();await ui.edit(ui.get('script-mode'),'mixed');await ui.edit(ui.get('asset-mode'),'ai');await ui.edit(ui.get('production-instructions'),'Make an explanatory video');await ui.edit(ui.get('script-input'),'My existing script');await ui.edit(ui.get('job-title'),'New title');await ui.get('save-title').emit('click');await ui.poll();assert.equal(ui.get('script-input').value,'My existing script');await ui.get('save-production').emit('click');assert.equal(ui.state().production.brief.assetMode,'ai');assert.equal(ui.state().production.brief.instructions,'Make an explanatory video');assert.equal(ui.requests.some(r=>r.route==='draft'||r.route==='generate'),false);});
test('explicit disclosed AI draft action carries consent once, fills editable input and never appends or synthesizes',async()=>{
const ui=await setup({rows:[]});assert.equal(ui.get('generate-script').disabled,true);await ui.edit(ui.get('production-instructions'),'Write a brief narration');await ui.sendScript({confirmOverwrite:true});assert.equal(ui.get('script-input').value,'AI draft result');assert.equal(ui.state().rows.length,0);const calls=ui.requests.filter(r=>r.route==='draft');assert.equal(calls.length,1);assert.equal(calls[0].input.consent,true);assert.match(ui.get('source-status').textContent,/保存しました/);assert.equal(ui.requests.some(r=>['generate','approve','adopt-script'].includes(r.route)),false);ui.restart();await ui.poll();assert.equal(ui.get('regenerate-script').disabled,false);
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
test('prepared narration has no separate full audio player and remains unconfirmed until video review',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:false}]});assert.doesNotMatch(html,/id="full-audio"/);assert.equal(ui.state().rows[0].listenedCurrent,false);await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');assert.equal(ui.get('generate-all').disabled,true);assert.equal(ui.requests.some(r=>['listened','generate','render-preview'].includes(r.route)),false);
});
test('unfinished narration cannot create a video or claim listening',async()=>{
 const ui=await setup({secondReviewed:false});assert.equal(ui.get('generate-all').disabled,true);assert.equal(ui.get('confirm-full').hidden,true);assert.equal(ui.requests.some(r=>['listened','generate','render-preview'].includes(r.route)),false);
});
test('one sentence correction saves only that sentence and preserves other unsaved words without approving them',async()=>{const ui=await setup({rows:[{id:'one',caption:'最初。次。',speech:'さいしょ。つぎ。',reviewed:false}]});const fields=[...ui.get('rows').walk()].filter(e=>e.tagName==='textarea'&&/字幕|読み上げ文/.test(e.attributes['aria-label']||''));await ui.edit(fields[1],'なおしたよみ。');await ui.edit(fields[3],'まだへんしゅうちゅう。');const button=[...ui.get('rows').walk()].find(e=>e.dataset.commitSentence==='one:0');assert.ok(button);await button.emit('click');assert.equal(ui.state().rows[0].speech,'なおしたよみ。つぎ。');assert.equal(ui.textArea('one','speech').value,'なおしたよみ。');assert.equal(fields[3].value,'まだへんしゅうちゅう。');assert.equal(ui.state().rows[0].reviewed,false);assert.equal(ui.requests.some(r=>r.route==='approve'||r.route==='generate'),false);assert.equal(ui.get('generate-all').disabled,true);});
test('bulk correction saves all edited text before explicit approval, keeps unrelated drafts and does not synthesize',async()=>{const ui=await setup({secondReviewed:false});await ui.edit(ui.textArea('one','speech'),'Corrected reading');await ui.edit(ui.textArea('two','caption'),'Corrected caption');await ui.edit(ui.get('style'),'Unapplied voice direction');await ui.get('confirm-script').emit('click');assert.equal(ui.state().rows[0].speech,'Corrected reading');assert.equal(ui.state().rows[1].caption,'Corrected caption');assert.ok(ui.state().rows.every(r=>r.reviewed));assert.equal(ui.get('style').value,'Unapplied voice direction');const routes=ui.requests.filter(r=>['row','approve','generate'].includes(r.route)).map(r=>r.route);assert.deepEqual(routes,['row','row','approve','approve']);assert.equal(ui.get('confirm-script').disabled,true);});
test('failed save leaves edits available and never proceeds to bulk approval or another attempt',async()=>{const ui=await setup({secondReviewed:false,rowError:true});await ui.edit(ui.textArea('one','speech'),'Keep my correction');await ui.get('confirm-script').emit('click');assert.equal(ui.textArea('one','speech').value,'Keep my correction');assert.equal(ui.requests.filter(r=>r.route==='row').length,1);assert.equal(ui.requests.some(r=>r.route==='approve'||r.route==='generate'),false);assert.equal(ui.get('confirm-script').disabled,false);assert.match(ui.get('message').textContent,/処理できません/);});
test('unchanged approved text is not resaved and its existing audio/listening remains intact',async()=>{const ui=await setup({rows:[{id:'one',caption:'確認済み。',speech:'かくにんずみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true},{id:'two',caption:'未確認。',speech:'みかくにん。',reviewed:false}]});await ui.get('confirm-script').emit('click');assert.equal(ui.requests.some(r=>r.route==='row'),false);assert.equal(ui.requests.filter(r=>r.route==='approve').length,1);assert.equal(ui.state().rows[0].audio.file,'original.wav');assert.equal(ui.state().rows[0].listenedCurrent,true);});
test('scene confirmation saves pending words after reopening and never confirms stale audio',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true}]});await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');assert.equal(ui.row('one').disabled,false);await ui.row('one').emit('click');assert.equal(ui.state().rows[0].speech,'なおしたよみ。');assert.equal(ui.state().rows[0].reviewed,true);assert.equal(ui.state().rows[0].audioCurrent,false);assert.equal(ui.state().rows[0].listenedCurrent,false);assert.equal(ui.get('confirm-full').disabled,true);assert.equal(ui.requests.some(r=>r.route==='generate'||r.route==='listened'),false);});
test('concurrent row changes stop confirmation without overwriting saved work or dropping the local draft',async()=>{const ui=await setup({secondReviewed:false});await ui.edit(ui.textArea('one','speech'),'Local draft');ui.externalEdit('one',{speech:'Other saved edit'});await ui.get('confirm-script').emit('click');assert.equal(ui.textArea('one','speech').value,'Local draft');assert.equal(ui.state().rows[0].speech,'Other saved edit');assert.equal(ui.requests.some(r=>r.route==='row'||r.route==='approve'),false);assert.match(ui.get('message').textContent,/最新の内容/);});
test('cut audio uses its real scene file and reopened cut/global correction drafts survive unrelated saves',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'real-scene.wav'},audioCurrent:true,listenedCurrent:true}]});const audio=[...ui.get('rows').walk()].find(e=>e.tagName==='audio');assert.equal(audio.attributes.src,'/audio/real-scene.wav');assert.equal(audio.attributes.preload,'metadata');const note=[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');await ui.edit(note,'名前の読みを直して');await ui.edit(ui.get('review-overall'),'結末を分かりやすく');await ui.poll();await ui.edit(ui.get('job-title'),'Changed title');await ui.get('save-title').emit('click');const currentNote=[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');assert.equal(currentNote.value,'名前の読みを直して');assert.equal(ui.get('review-overall').value,'結末を分かりやすく');assert.equal(ui.get('confirm-full').disabled,true);});
test('correction instructions persist separately, block final handoff, and never start paid generation',async()=>{const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'original.wav'},audioCurrent:true,listenedCurrent:true}]});const before=ui.state().rows;await ui.edit(ui.get('review-overall'),'画像を台本に合わせて');await ui.get('save-review').emit('click');assert.equal(ui.state().production.review.overall,'画像を台本に合わせて');assert.deepEqual(ui.state().rows,before);assert.equal(ui.get('confirm-full').disabled,true);assert.equal(ui.requests.some(r=>['generate','draft','preview','row'].includes(r.route)),false);await ui.get('clear-review').emit('click');assert.equal(ui.state().production.review.overall,'');assert.equal(ui.get('confirm-full').disabled,false);});

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
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true},{id:'two',caption:'次。',speech:'つぎ。',reviewed:true,audio:{file:'two.wav'},audioCurrent:true}]});assert.deepEqual([...ui.get('rows').walk()].filter(e=>e.dataset.rowId).map(e=>e.dataset.rowId),['one','two']);assert.ok([...ui.get('rows').walk()].some(e=>e.textContent==='01カット'));assert.equal(ui.get('confirm-full').disabled,false);await ui.get('generate-all').emit('click');assert.equal(ui.requests.filter(r=>r.route==='render-preview').length,1);assert.equal(ui.requests.some(r=>['confirm-cut','finalize'].includes(r.route)),false);await previewReady(ui);await ui.get('confirm-full').emit('click');assert.equal(ui.requests.filter(r=>r.route==='confirm-video').length,1);assert.equal(ui.requests.filter(r=>r.route==='render-preview').length,1);assert.equal(ui.location.hash,'#finish');const missing=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true}]});assert.equal(missing.get('confirm-full').disabled,true);
});

test('gender menu groups all male choices before female choices across both models and uses a single cached audio player for every pitch',async()=>{
 const samples=SAMPLE_SETTINGS.map((settings,i)=>({id:'cached-'+i,file:'cached-'+i+'.wav',settings,durationSeconds:5}));const ui=await setup({voices:VOICES,samples});
 const groups=ui.get('voice-preset').children.filter(e=>e.tagName==='optgroup');assert.deepEqual(groups.map(g=>g.attributes.label),['男性の声 / Gemini 3.8 Flash TTS','男性の声 / Gemini 3.8 Flash-Lite TTS','女性の声 / Gemini 3.8 Flash TTS','女性の声 / Gemini 3.8 Flash-Lite TTS']);
 assert.equal(groups.flatMap(g=>g.children).length,60);for(const group of groups)for(const option of group.children)assert.ok(option.textContent.includes(group.attributes.label.startsWith('男性')?'（男性）':'（女性）'));
 ui.get('voice-preset').value=MODELS[1]+'::Charon';await ui.get('voice-preset').emit('change');for(const pitch of ['standard','low','high']){await ui.edit(ui.get('pitch'),pitch);assert.equal(ui.get('preview-voice').hidden,false);assert.equal(ui.get('sample-audio').hidden,false);assert.ok(ui.get('sample-audio').src.endsWith(samples.find(s=>s.settings.model===MODELS[1]&&s.settings.voice==='Charon'&&(s.settings.pitch||'standard')===pitch).file));}
 assert.equal(ui.get('bank-tools').hidden,true);assert.match(ui.get('sample-progress').textContent,/180 \/ 180/);assert.equal(ui.requests.some(r=>['preview','prepare-samples','generate'].includes(r.route)),false);
});
test('reading review states applied voice/pitch without an inline navigation link, distinguishing unapplied choices',async()=>{const ui=await setup();assert.match(ui.get('production-voice-info').textContent,/Kore.*標準/);assert.ok(html.includes('声・ピッチの変更は'));assert.doesNotMatch(html,/<a href="#connection">声/);await ui.edit(ui.get('pitch'),'low');assert.match(ui.get('production-voice-info').textContent,/Kore.*標準.*未反映/);await ui.get('settings-form').emit('submit');assert.match(ui.get('production-voice-info').textContent,/Kore.*低め/);assert.equal(ui.requests.some(r=>r.route==='generate'),false);});
test('historical cut confirmations do not lock an editable revision or require an undo button',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,cutConfirmed:true,listenedCurrent:true}]});assert.equal(ui.textArea('one','speech').disabled,false);assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.editCut||e.dataset.confirmCut),false);await ui.edit(ui.textArea('one','speech'),'なおしたよみ。');await ui.row('one').emit('click');assert.equal(ui.state().rows[0].audioCurrent,false);assert.equal(ui.state().rows[0].reviewed,true);assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('final confirmation asks once, cancel changes nothing, and acceptance permanently locks content while allowing playback/export/key clearing',async()=>{
 const rows=[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true,listenedCurrent:false}];
 const canceled=await setup({rows,confirmResult:false});await previewReady(canceled);await canceled.get('confirm-full').emit('click');assert.equal(canceled.confirmations.length,1);assert.match(canceled.confirmations[0],/確認/);assert.equal(canceled.requests.some(r=>r.route==='confirm-cut'||r.route==='finalize'),false);assert.equal(canceled.textArea('one','speech').disabled,false);
 const ui=await setup({rows});await previewReady(ui);await ui.get('confirm-full').emit('click');assert.equal(ui.confirmations.length,1);assert.equal(ui.requests.filter(r=>r.route==='confirm-video').length,1);assert.equal(ui.textArea('one','speech').disabled,true);assert.equal(ui.get('voice-preset').disabled,true);assert.equal(ui.get('pitch').disabled,true);assert.equal(ui.get('review-overall').disabled,true);assert.equal(ui.get('confirm-full').hidden,true);assert.equal(ui.requests.filter(r=>r.route==='render-video').length,0);ui.externalVideo({running:false,stage:'failed',result:null});await ui.poll();assert.equal(ui.get('confirm-full').disabled,false);assert.equal(ui.get('clear-key').disabled,false);await ui.poll();assert.equal(ui.textArea('one','speech').disabled,true);assert.match(ui.get('handoff-info').textContent,/編集不可/);
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
  removeAttribute(name){delete this.attributes[name];}
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

test('adoption cannot be clicked before bootstrap and becomes available after a saved script loads',async()=>{
 let initiallyDisabled=false,clickRejected=false;const ui=await setup({beforeBootstrap:async button=>{initiallyDisabled=button.disabled;try{await button.emit('click');}catch{clickRejected=true;}}});
 assert.equal(initiallyDisabled,true);assert.equal(clickRejected,true);assert.equal(ui.get('plan-sources').disabled,false);
});

test('script adoption locks all intermediate saves and displays progress beside the visible next button',async()=>{
 let release;const adoptionWait=new Promise(r=>release=r),ui=await setup({rows:[],adoptionWait});
 await ui.edit(ui.get('production-instructions'),'短い説明');await ui.sendScript();
 const advancing=ui.get('plan-sources').emit('click');await new Promise(r=>setImmediate(r));
 assert.equal(ui.get('plan-sources').disabled,true);assert.equal(ui.get('planning-activity').hidden,false);assert.match(ui.get('planning-activity-label').textContent,/取り込|声選び/);
 assert.equal(ui.get('script-status').parent.hidden,false);assert.ok(ui.get('script-status').parent===ui.get('plan-sources').parent);await ui.poll();assert.equal(ui.get('plan-sources').disabled,true);
 release();await advancing;assert.equal(ui.location.hash,'#connection');assert.equal(ui.requests.filter(r=>r.route==='adopt-script').length,1);assert.equal(ui.get('planning-activity').hidden,true);
});

test('script adoption failure stays visible at the next button and restores controls without navigation or generation',async()=>{
 const ui=await setup({rows:[],adoptionError:'STALE_REVISION'});ui.get('auto-direction').checked=false;await ui.get('auto-direction').emit('change');await ui.edit(ui.get('script-input'),'せつめい。');await ui.get('plan-sources').emit('click');
 assert.equal(ui.get('script-status').parent.hidden,false);assert.ok(ui.get('script-status').parent===ui.get('plan-sources').parent);assert.ok(ui.get('script-status').classList.contains('error'));assert.equal(ui.get('plan-sources').disabled,false);assert.equal(ui.get('planning-activity').hidden,true);assert.notEqual(ui.location.hash,'#connection');assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('AI progress shows indeterminate work then actual completed image counts and clears after failure',async()=>{
 let release;const ui=await setup({rows:[],draftWait:new Promise(r=>release=r)});await ui.edit(ui.get('production-instructions'),'短い解説');
 const running=ui.sendScript();await new Promise(r=>setImmediate(r));
 assert.equal(ui.get('planning-create-activity').hidden,false);assert.equal(ui.get('planning-create-activity-bar').attributes.value,undefined);
 ui.externalAuthoringProgress({operation:'compose',phase:'画像を作成しています（2/4）',completed:1,total:4});await ui.poll();
 assert.equal(ui.get('planning-create-activity-bar').attributes.value,'1');assert.equal(ui.get('planning-create-activity-bar').attributes.max,'4');assert.match(ui.get('planning-create-activity-label').textContent,/画像.*2\/4/);
 ui.externalAuthoringProgress(null);release();await running;await ui.poll();assert.equal(ui.get('planning-create-activity').hidden,true);assert.equal(ui.get('generate-script').disabled,false);
});

test('saved script keeps real image-preparation progress beside the blocked next action',async()=>{
 const ui=await setup({rows:[]});ui.externalBrief({script:'台本を保存しました。',scriptEdited:true});ui.externalBusy(true);ui.externalAuthoringProgress({operation:'compose',phase:'画像を作成しています（2/4）',completed:1,total:4});await ui.poll();
 assert.equal(ui.get('plan-sources').disabled,true);assert.equal(ui.get('planning-activity').hidden,false);assert.equal(ui.get('planning-create-activity').hidden,false);
 assert.equal(ui.get('planning-activity-bar').attributes.value,'1');assert.equal(ui.get('planning-activity-bar').attributes.max,'4');assert.match(ui.get('planning-activity-label').textContent,/台本.*準備|画像/);
 ui.externalAuthoringProgress({operation:'compose',phase:'結果を保存しています…'});await ui.poll();assert.equal(ui.get('planning-activity').hidden,false);assert.equal(ui.get('planning-activity-bar').attributes.value,undefined);
 ui.externalBusy(false);ui.externalAuthoringProgress(null);await ui.poll();assert.equal(ui.get('planning-activity').hidden,true);assert.equal(ui.get('plan-sources').disabled,false);
});

test('full reading confirmation accepts a displayed prepared title before its row exists',async()=>{
 const caption='窓を開けます。',titleReading={caption:'朝の支度',speech:'あさのしたく'};
 const ui=await setup({titleReading,rows:[{id:'one',caption,speech:'まどをあけます。'}]});ui.externalBrief({autoDirection:true,titleMode:'auto',script:caption});ui.externalTitleRequired(true);await ui.poll();
 assert.equal(ui.get('opening-speech').value,titleReading.speech);assert.equal(ui.get('confirm-script').disabled,false);assert.doesNotMatch(ui.get('reading-prep-status').textContent,/要修正/);await ui.get('confirm-script').emit('click');assert.ok(ui.state().rows.every(r=>r.reviewed));assert.equal(ui.requests.some(r=>['draft','prepare-readings','generate'].includes(r.route)),false);
});

test('missing title reading blocks confirmation with an actionable explanation',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。'}]});ui.externalTitleRequired(true);await ui.poll();assert.equal(ui.get('confirm-script').disabled,true);assert.match(ui.get('review-save-state').textContent,/タイトル.*読み/);assert.equal(ui.requests.some(r=>r.route==='approve'),false);
});

test('source planning applies automatic title/voice, preserves manual choices, keeps real proposal for review',async()=>{
 const sourcePlan={script:'入口です。',readings:[{caption:'入口です。',speech:'いりぐちです。'}],storyboard:{title:'AIのタイトル',summary:'資料の構成',voice:'Puck',voiceReason:'明るい説明',sources:[{id:'text',label:'本文',status:'provided',summary:'入口'}],scenes:[{caption:'入口です。',title:'入口',points:['最初の一歩'],imageFile:'',sourceIds:['text']}],motion:{version:1,style:'editorial',intensity:'standard'}}};
 for(const mode of ['auto','manual']){
  const ui=await setup({sourcePlan,rows:[]});await ui.edit(ui.get('source-text'),'資料本文');await ui.edit(ui.get('production-instructions'),'短い説明動画');ui.get('auto-direction').checked=mode==='auto';await ui.get('auto-direction').emit('change');
  if(mode==='manual'){ui.get('voice-manual').checked=true;await ui.get('voice-manual').emit('change');}
  await ui.get('generate-script').emit('click');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.state().title,'Original title');assert.equal(ui.state().settings.voice,'Kore');assert.equal(ui.state().production.brief.storyboard.title,'AIのタイトル');assert.equal(ui.requests.some(r=>['approve','generate','finalize'].includes(r.route)),false);assert.equal(ui.get('storyboard-preview').hidden,false);assert.equal([...ui.get('storyboard-preview').walk()].some(e=>e.attributes.class==='voice-proposal'),false);assert.equal(ui.get('voice-proposal').hidden,true);
  await ui.get('plan-sources').emit('click');assert.equal(ui.location.hash,'#connection');const voice=ui.get('voice-proposal');assert.equal(voice.hidden,false);assert.equal(voice.children[0].textContent,(mode==='auto'?'AIが選んだ声：':'AIの提案：')+'Puck');assert.equal(voice.children[1].textContent,'明るい説明');assert.equal(ui.get('voice').value,mode==='auto'?'Puck':'Kore');assert.equal(ui.state().settings.voice,'Kore');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);
  await ui.edit(ui.get('script-input'),'書き換え。');await ui.get('save-production').emit('click');assert.equal(ui.state().production.brief.storyboard,undefined);
 }
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
 empty.restart();await empty.poll();assert.equal(empty.get('generate-script').disabled,false);
});

async function setup({beforeBootstrap,adoptionWait,adoptionError,titleReading,imageProposal,motion,autoConfirm=false,voiceConfirmed=true,voiceMode='auto',storyboard,productionErrorAt=0,strictProductionRevision=false,materialConcurrentEdit=false,sourcePlan,sourceWait,sourceError,rows,samples,assets=[],previewError,rowError,draftWait,pausedStep,confirmResult=true,secondReviewed = true,voices=['Kore','Puck']} = {}) {
  const elements = new Map();let anonymous=0;
  const tree=new Element('root'),stack=[tree],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for(const [token,closing,tag,attributes] of html.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)){
   if(closing){for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag){stack.length=i;break;}continue;}
   const node=new Element(tag),id=attributes.match(/\bid="([^"]+)"/)?.[1];
   for(const [,name,value]of attributes.matchAll(/\b((?:data|aria)-[\w-]+)(?:="([^"]*)")?/g))node.setAttribute(name,value||'');
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
    voiceConfirmed,production:{musicEnabled:true,brief:{scriptMode:'ai',assetMode:'mixed',instructions:'',script:'',...(titleReading?{titleReading}:{})},assets:[]},samples:[{id:'sample-kore',file:'sample-kore.wav',settings:{model:'gemini-3.8-flash-tts',voice:'Kore',style:'Original style'},durationSeconds:1},{id:'sample-puck',file:'sample-puck.wav',settings:{model:'gemini-3.8-flash-tts',voice:'Puck',style:'明るく親しみやすい日本語で、聞き取りやすく話す。'},durationSeconds:2}],
    rows: ['one', 'two'].map(id => ({id, caption: 'Caption ' + id, speech: 'Speech ' + id, scene: '', reviewed: id === 'one' || secondReviewed, attempts: 0, hints: [], audio: null, audioCurrent: false, listenedCurrent: false})),
  };
  state.projectId='original';state.projects=[{id:'original',title:state.title}];const savedProjects=new Map();
  if(rows)state.rows=rows.map((r,i)=>({id:'row-'+i,scene:'',reviewed:false,attempts:0,hints:[],audio:null,...r}));
  if(samples)state.samples=samples;
  state.production.assets=assets;
  if(state.rows.length&&state.rows.every(r=>r.audioCurrent)){state.production.music={file:'e'.repeat(64)+'.mp3',durationSeconds:30,level:.16};state.musicCurrent=true;}
  state.production.brief.voiceMode=voiceMode;if(storyboard)state.production.brief.storyboard=storyboard;
  if(strictProductionRevision){state.productionRevision='inputs-0';state.production.musicEnabled=true;}
  let token = 'fixture-token-1', revision = 0;
  const requests = [], intervals = [], confirmations=[],alerts=[];
  const fetch = async (url, options = {}) => {
    const route = url.replace('/api/', '').split('?')[0], input = typeof options.body==='string' ? JSON.parse(options.body) : undefined;
    requests.push({route, input, headers: options.headers});
    const reply = (value, ok = true) => ({ok, json: async () => structuredClone(value)});
    if (route === 'bootstrap'){if(beforeBootstrap)await beforeBootstrap(elements.get('plan-sources'));return reply({token, instanceId: state.instanceId});}
    if (route === 'status') return reply({...state,fullAudioRevision:state.revision+'-'+state.rows.map(r=>r.audio?.file||'').join('-')});
    if (route === 'themes') return reply([{name: 'moon', background: '#002b36', foreground: '#93a1a1', heading: '#eee8d5', accent: '#268bd2'}]);
    if (route === 'designs') return reply(VIDEO_TEMPLATES);
    if (options.headers?.['X-Narration-Token'] !== token) return reply({error: 'CSRF_TOKEN_REQUIRED'}, false);
    if(route==='regenerate-image'){const row=state.rows.find(r=>r.id===input.id),file='b'.repeat(64)+'.png';state.production.assets.push({file,name:'新しい候補.png',origin:'generated-image'});state.imageProposal={id:'regenerated',scenes:[{id:row.id,caption:row.caption,imageFile:file,imagePrompt:'',reason:'fixture candidate'}]};return reply(state);}
    else if(route==='approve-images'){const choices=state.imageProposal.scenes.filter(s=>!input.id||s.id===input.id);for(const scene of choices)state.rows.find(r=>r.id===scene.id).cutImage={file:scene.imageFile};state.imageProposal=null;return reply(state);}
    if(route==='material'){
      const bytes=await options.body.arrayBuffer(),file=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')+'.png';
      state.production.assets.push({name:options.body.name,file,size:bytes.byteLength});state.productionRevision='inputs-material';
      if(materialConcurrentEdit)state.production.brief.instructions='他の画面で編集';return reply(state);
    }
    if(route==='confirm-video'){if(input.confirmReviewed!==true)return reply({error:'FINAL_CONFIRMATION_REQUIRED'},false);state.production.finalization={revision:state.revision,inputsHash:'fixture-hash'};for(const row of state.rows){row.cutConfirmed=true;row.listenedCurrent=true;}state.video.result.reviewState='confirmed';state.projects.find(p=>p.id===state.projectId).finalized=true;return reply(state);}
    if(route==='render-preview'){state.video={...state.video,running:true,stage:'rendering',progress:.4,renderedFrames:40,totalFrames:100,steps:['preparing','bundling','rendering'],result:null};return reply({started:true});}
    if(route==='render-video'){if(!state.production.finalization)return reply({error:'FINAL_CONFIRMATION_REQUIRED'},false);state.video={...state.video,running:true,stage:'rendering',progress:.4,renderedFrames:40,totalFrames:100,steps:['preparing','bundling','rendering']};return reply({started:true});}
    if(route==='new-project'||route==='revision-project'){if(route==='new-project')assert.equal(input.discardPrevious,true);
      savedProjects.set(state.projectId,structuredClone(state));const id=route==='new-project'?'new-project':route==='revision-project'?'revision-project':input.id;
      const list=state.projects,keyConfigured=state.keyConfigured,samples=state.samples;
      if(route==='new-project'){list.push({id,title:'新しい動画'});state={...structuredClone(state),title:'新しい動画',sessionId:'new-session',projectId:id,rows:[],dictionary:[],presentation:{theme:'moon'},voiceConfirmed:false,production:{musicEnabled:true,voiceConfirmation:null,brief:{...FRESH_BRIEF},assets:[],finalization:null},video:{available:true,running:false,stage:'idle',result:null},projects:list};}
      else if(route==='revision-project'){list.push({id,title:state.title+'（修正版）'});state={...structuredClone(state),projectId:id,sessionId:'revision-session',production:{...structuredClone(state.production),finalization:null,cutConfirmations:[]},projects:list,video:{available:true,running:false,stage:'idle',result:null}};for(const row of state.rows)row.cutConfirmed=false;}else state={...structuredClone(savedProjects.get(id)),projects:list,keyConfigured,samples};
      token='fixture-token-project-'+id;state.instanceId='instance-project-'+id;
    }
    else if (route === 'key') state.keyConfigured = !input.clear;
    else if (route === 'title') {if(adoptionWait)await adoptionWait;state.title = input.title;}
    else if(route==='bookends'){const id=state.production.bookends?.titleRowId||'title-fixture';const row={id,caption:input.title,speech:input.speech,reviewed:false,hints:[],attempts:0};state.rows=[row,...state.rows.filter(r=>r.id!==id)];state.production.bookends={titleRowId:id};}
    else if (route === 'settings') {const {candidate,...settings}=input;state.settings=settings;state.voiceConfirmed=candidate!==true;}
    else if(route==='presentation')state.presentation=input.presentation||{...state.presentation,theme:input.theme};
    else if(route==='design-draft'){if(!input.consent)return reply({error:'GENERATION_CONSENT_REQUIRED'},false);state.presentation={theme:state.presentation.theme,mode:'ai',instructions:input.instructions,design:{...VIDEO_TEMPLATES[0].design,name:'AI design'}};}
    else if(route==='generate'){if(!input.consent)return reply({error:'GENERATION_CONSENT_REQUIRED'},false);for(const id of input.ids){const row=state.rows.find(r=>r.id===id);if(!row.reviewed)return reply({error:'READING_REVIEW_REQUIRED'},false);if(row.attempts&&!input.regenerate)return reply({error:'REGENERATION_CONFIRM_REQUIRED'},false);}for(const id of input.ids){const row=state.rows.find(r=>r.id===id);Object.assign(row,{attempts:row.attempts+1,audio:{file:id+'.wav'},audioCurrent:true,listenedCurrent:false,cutConfirmed:false});}if(input.createMusic){state.production.music={file:'e'.repeat(64)+'.mp3',durationSeconds:30,level:.16};state.musicCurrent=true;}}
    else if(route==='cut-image'){const row=state.rows.find(r=>r.id===input.id);row.cutImage=state.production.assets.find(a=>a.file===input.file);row.cutConfirmed=false;}else if(route==='listened')state.rows.find(r=>r.id===input.id).listenedCurrent=true;
    else if(route==='confirm-cut'){const row=state.rows.find(r=>r.id===input.id);row.listenedCurrent=true;row.cutConfirmed=true;state.production.requiresFinalization=true;}
    else if(route==='reopen-cut'){const row=state.rows.find(r=>r.id===input.id);row.listenedCurrent=false;row.cutConfirmed=false;}
    else if(route==='finalize'){assert.equal(input.confirmIrreversible,true);state.production.finalization={revision:state.revision,inputsHash:'fixture-hash'};state.projects.find(p=>p.id===state.projectId).finalized=true;}
    else if(route==='cancel'){state.busy=false;if(state.video.running)state.video={...state.video,running:false,canceling:false,stage:'canceled',error:'VIDEO_RENDER_CANCELED',result:null};}
    else if(route==='apply-review'){if(!input.consent)return reply({error:'GENERATION_CONSENT_REQUIRED'},false);const ids=input.id?[input.id]:input.review.cuts.map(c=>c.rowId);for(const id of ids){const row=state.rows.find(r=>r.id===id);Object.assign(row,{caption:'修正後。',speech:'しゅうせいご。',reviewed:false,audioCurrent:false,cutConfirmed:false});}state.production.review={...input.review,overall:input.id?input.review.overall:'',cuts:input.review.cuts.filter(c=>!ids.includes(c.rowId))};state.correctionResult={ids,images:0,textChanged:ids.length};}
    else if(route==='review'){if(input.expectedRevision!==state.revision)return reply({error:'STALE_REVISION'},false);state.production.review=input.review;}
    else if(route==='watermark-preference')state.production.watermarkEnabled=input.enabled;
    else if(route==='music-preference')state.production.musicEnabled=input.enabled;
    else if (route === 'production') {if(strictProductionRevision&&input.productionRevision!==state.productionRevision||productionErrorAt&&requests.filter(r=>r.route==='production').length===productionErrorAt)return reply({error:'STALE_REVISION'},false);state.production.brief=input;}
    else if(route==='adopt-script'){if(adoptionError)return reply({error:adoptionError},false);state.rows=input.script.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((caption,i)=>({id:'adopted-'+i,caption,speech:input.readings?.[i]?.speech||(/^[ぁ-ゖー。！？、\s]+$/.test(caption)?caption:''),readingState:input.readings?'ready':'pending',reviewed:false,attempts:0,hints:[],audioCurrent:false,...(state.production.brief.storyboard?.scenes[i]?.caption===caption?{cutImage:state.production.brief.storyboard.scenes[i].imageFile?{file:state.production.brief.storyboard.scenes[i].imageFile}:null,cutVisual:{title:state.production.brief.storyboard.scenes[i].title,points:state.production.brief.storyboard.scenes[i].points||[]}}:{})}));}
    else if (route === 'append-script') {const rows=[{id:'added',caption:input.script,speech:input.readings?.[0]?.speech||input.script,reviewed:false,attempts:0,hints:[]}];if(input.replace)state.rows=rows;else state.rows.push(...rows);}
    else if (route === 'preview') {if(previewError&&requests.filter(r=>r.route==='preview').length===previewError)return reply({error:'PROVIDER_RATE_LIMIT'},false);const id='sample-'+state.samples.length;state.samples.push({id,file:id+'.wav',settings:input.settings,durationSeconds:5});return reply({sample:id});}
    else if(route==='prepare-samples'){const configs=SAMPLE_SETTINGS.filter(c=>voices.includes(c.voice));const missing=configs.filter(c=>!state.samples.some(s=>s.settings.model===c.model&&s.settings.voice===c.voice&&s.settings.style===c.style&&(s.settings.pitch||'standard')===(c.pitch||'standard')));state.sampleProgress={running:false,total:missing.length,completed:0};for(const config of missing){if(previewError&&state.sampleProgress.completed+1===previewError){state.error='PROVIDER_RATE_LIMIT';break;}const id='sample-'+state.samples.length;state.samples.push({id,file:id+'.wav',settings:config,durationSeconds:5});state.sampleProgress.completed++;}return reply({started:true,total:missing.length});}
    else if(route==='source-plan'){if(sourceWait){state.busy=true;await sourceWait;state.busy=false;}if(sourceError)return reply({error:sourceError},false);assert.equal(input.consent,true);const result={...sourcePlan,...(input.brief.autoDirection?{direction:sourcePlan?.direction||{title:sourcePlan?.storyboard?.title||'AIのタイトル',template:'steps',motion:{version:1,style:'editorial',intensity:'standard'}}}:{}),saved:true};state.production.brief={...input.brief,script:result.script,readings:result.readings,titleReading:result.titleReading,storyboard:result.storyboard,direction:result.direction,scriptEdited:true};state.production.authoring={version:1,lastAttempt:{sequence:input.sequence,result}};return reply(result);}
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
  const resizes=[],windowEvents=new Map();
  const context = vm.createContext({fitText,getComputedStyle:()=>({fontSize:'72px',lineHeight:'100.8px'}),ResizeObserver:class {constructor(callback){resizes.push(callback);}observe(){}},MutationObserver:class {observe(){}},requestAnimationFrame:callback=>callback(),scriptActionState,parseScriptParts,document, fetch, setInterval: callback => {intervals.push(callback);}, window: {addEventListener:(name,handler)=>windowEvents.set(name,handler),sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},location:{hash:''},alert:message=>alerts.push(message),confirm: message => {confirmations.push(message);return confirmResult;}}, crypto: {randomUUID: () => 'fixture-id',subtle:crypto.subtle}});
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
    if(hidden.includes('manual-voice-settings')){get('voice-manual').checked=true;await get('voice-manual').emit('change');}
    if(hidden.includes('custom-settings')){get('voice-preset').value='custom';await get('voice-preset').emit('change');}
    if(hidden.includes('manual-direction')){get('auto-direction').checked=false;await get('auto-direction').emit('change');}
    for(let p=element;p;p=p.parent)assert.equal(!!p.hidden,false,'A user cannot edit a hidden field or hidden ancestor');
    assert.equal(element.disabled,false,'A user cannot edit a disabled field');element.value = value; await element.emit('input');};

  // Drive the same explicit in-page decision as a user; individual tests can pause before it.
  for(const element of elements.values()){const emit=element.emit.bind(element);element.emit=async(name,...args)=>{await emit(name,...args);if(name==='click'&&autoConfirm&&element!==get('confirm-script-action')&&element!==get('cancel-script-action')&&!get('script-confirm').hidden)await get(confirmResult?'confirm-script-action':'cancel-script-action').emit('click');};}
  return {
    get, row, textArea, edit, requests, confirmations,alerts, location:context.window.location,sendScript:async({confirmOverwrite=false}={})=>{const button=get('generate-script').hidden?get('regenerate-script'):get('generate-script');await button.emit('click');if(!get('script-confirm').hidden)await get(confirmOverwrite?'confirm-script-action':'cancel-script-action').emit('click');},
    observeScroll: callback => {context.window.scrollTo=callback;},
    resize:()=>resizes.forEach(callback=>callback()),
    state: () => structuredClone(state),
    poll: async () => {assert.equal(intervals.length, 1); await intervals[0]();},
    restart: () => {state.instanceId = 'instance-2'; state.keyConfigured = false; token = 'fixture-token-2';},
    externalEdit: (id,input) => {Object.assign(state.rows.find(r=>r.id===id),input,{reviewed:false});state.revision='revision-'+ ++revision;},
    updateAssets: assets=>{state.production.assets=assets;},
    beforeUnload:()=>{const e={prevented:false,preventDefault(){this.prevented=true;}};windowEvents.get('beforeunload')?.(e);return e;},
    externalProject:()=>{state={...state,projectId:'different-project',instanceId:'different-instance',production:{brief:{...FRESH_BRIEF},assets:[]},rows:[]};},
    externalBrief: input=>{Object.assign(state.production.brief,input);},
    externalAuthoringProgress:value=>{state.authoringProgress=value;},
    externalTitleRequired:value=>{state.titleReadingPreparationRequired=value;},
    externalVideo:value=>{state.video={...state.video,...value};},
    externalRevision:()=>{state.revision='revision-'+ ++revision;},externalBusy:value=>{state.busy=value;},externalFinalize:()=>{state.production.finalization={revision:state.revision,inputsHash:'fixture-hash'};},
    externalMusic:(music,current=true)=>{state.production.music=music;state.musicCurrent=current;},
    externalMusicEnabled:enabled=>{state.production.musicEnabled=enabled;},
    externalCutInfo: (id,value)=>Object.assign(state.rows.find(r=>r.id===id),value),
  };
}

test('stale BGM blocks final confirmation and polling never regenerates music',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'制作。',speech:'せいさく。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});ui.externalMusic({file:'a'.repeat(64)+'.mp3',durationSeconds:30,level:.16},false);await ui.poll();assert.equal(ui.get('confirm-full').disabled,true);assert.equal(ui.requests.some(r=>['generate','generate-music'].includes(r.route)),false);
});
test('watermark checkbox defaults on, captures manual off before busy rendering and survives polling without API generation',async()=>{
 const ui=await setup();assert.equal(ui.get('watermark-enabled').checked,true);
 ui.get('watermark-enabled').checked=false;await ui.get('watermark-enabled').emit('change');
 assert.equal(ui.requests.findLast(r=>r.route==='watermark-preference').input.enabled,false);await ui.poll();assert.equal(ui.get('watermark-enabled').checked,false);
 ui.get('watermark-enabled').checked=true;await ui.get('watermark-enabled').emit('change');assert.equal(ui.state().production.watermarkEnabled,true);
 assert.equal(ui.requests.some(r=>['generate','generate-music','video'].includes(r.route)),false);
});

test('cut pause captures the selected value without manual BGM controls or paid generation',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'制作。',speech:'せいさく。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});ui.get('cut-pause').value='0.8';await ui.get('cut-pause').emit('change');assert.equal(ui.requests.findLast(r=>r.route==='cut-pause').input.seconds,.8);assert.doesNotMatch(html,/id="music-level"/);assert.equal(ui.requests.some(r=>['generate','generate-music'].includes(r.route)),false);
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
 const ui=await setup();for(const n of [1,2])await ui.edit([...ui.get('rows').walk()].find(e=>e.attributes['aria-label']===n+'カットへの修正指示'),'直す');await ui.edit(ui.get('review-overall'),'全体を見直す');await [...ui.get('rows').walk()].find(e=>e.dataset.applyReview==='one').emit('click');assert.equal(ui.requests.find(r=>r.route==='apply-review').input.id,'one');assert.equal(ui.get('review-overall').value,'全体を見直す');assert.equal([...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='2カットへの修正指示').value,'直す');ui.restart();await ui.poll();assert.equal(ui.get('apply-review').disabled,false);assert.equal([...ui.get('rows').walk()].find(e=>e.dataset.applyReview==='two').disabled,false);
});

test('bookend edits survive polling, block final approval and save without generation',async()=>{
 const ui=await setup();await ui.edit(ui.get('opening-title'),'制作の紹介');await ui.edit(ui.get('opening-speech'),'せいさくのしょうかい');await ui.poll();assert.equal(ui.get('opening-title').value,'制作の紹介');assert.equal(ui.get('confirm-full').disabled,true);
 await ui.get('save-bookends').emit('click');const call=ui.requests.find(r=>r.route==='bookends');assert.equal(call.input.owner,'FURU');assert.equal(call.input.endUrl,'https://note.com/happy_duck780');assert.equal(call.input.endSeconds,4);assert.equal(call.input.speech,'せいさくのしょうかい');assert.equal(ui.requests.some(r=>['generate','generate-music','finalize'].includes(r.route)),false);
});

for(const buttonId of ['new-project','new-project-bottom'])test(buttonId+' starts an empty production at the page top and keeps the connection',async()=>{
 const ui=await setup({rows:[{id:'one',caption:'字幕。',speech:'よみ。',reviewed:true,audio:{file:'one.wav'},audioCurrent:true}]});
 await previewReady(ui);await ui.get('confirm-full').emit('click');ui.externalVideo({running:false,stage:'complete'});await ui.poll();const original=ui.state();
 let scroll;ui.observeScroll(value=>{scroll=value;});await ui.get(buttonId).emit('click');
 assert.equal(ui.location.hash,'#top');assert.equal(scroll.top,0);assert.equal(scroll.behavior,'instant');assert.equal(ui.get('new-project').focused,true);
 assert.equal(ui.state().rows.length,0);assert.equal(ui.state().production.assets.length,0);assert.equal(ui.state().keyConfigured,true);
 assert.equal(ui.requests.filter(r=>r.route==='new-project').length,1);assert.equal(ui.requests.some(r=>['generate','generate-music','source-plan'].includes(r.route)),false);
});
test('bottom new video control shares unsaved and active work guards',async()=>{
 const ui=await setup();await ui.edit(ui.get('production-instructions'),'未保存');assert.equal(ui.get('new-project-bottom').disabled,true);
 await ui.get('save-production').emit('click');assert.equal(ui.get('new-project-bottom').disabled,false);
 ui.externalVideo({running:true});await ui.poll();assert.equal(ui.get('new-project-bottom').disabled,true);
 ui.externalVideo({running:false});ui.externalBusy(true);await ui.poll();assert.equal(ui.get('new-project-bottom').disabled,true);assert.equal(ui.requests.some(r=>r.route==='new-project'),false);
});
test('automatic BGM adds no settings during polling and new production remains below output',async()=>{
 assert.ok(html.indexOf('id="new-project-bottom"')>html.indexOf('id="manifest"'));const ui=await setup();ui.externalMusic({file:'a'.repeat(64)+'.mp3',durationSeconds:30,level:.16});await ui.poll();ui.externalMusic(undefined);await ui.poll();assert.doesNotMatch(html,/id="music-tools"/);assert.equal(ui.requests.some(r=>['generate','generate-music'].includes(r.route)),false);
});

test('reference intake: URL or text alone enables generation while empty, busy and missing-key clicks warn without submitting',async()=>{
 const button=html.includes('id="generate-script"')?'generate-script':'plan-sources';
 for(const [id,value]of [['source-urls','https://example.com/article'],['source-text','資料の内容です。']]){
  const ui=await setup({rows:[]});assert.equal(ui.get(button).disabled,true);
  await ui.edit(ui.get(id),value);assert.equal(ui.get('production-instructions').value,'');assert.equal(ui.get(button).disabled,false);
  ui.externalBusy(true);await ui.poll();assert.equal(ui.get(button).disabled,true);
  ui.externalBusy(false);await ui.poll();assert.equal(ui.get(button).disabled,false);
  ui.restart();await ui.poll();assert.equal(ui.get(button).disabled,false);
 }
 const empty=await setup({rows:[]});await empty.edit(empty.get('source-urls'),' \n ');assert.equal(empty.get(button).disabled,true);
});
test('reference intake: new productions clear saved references without reopening history',async()=>{
 const ui=await setup();await ui.edit(ui.get('source-urls'),'https://example.com/saved');await ui.edit(ui.get('source-text'),'保存した資料');
 await ui.get('save-production').emit('click');await ui.get('new-project').emit('click');
 assert.equal(ui.get('source-urls').value,'');assert.equal(ui.get('source-text').value,'');assert.equal(ui.get('production-instructions').value,'');
 assert.equal(ui.requests.some(r=>['source-plan','generate','draft'].includes(r.route)),false);
 assert.equal(ui.requests.some(r=>r.route==='project'),false);
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
test('script authoring: canceled clearing preserves the draft and only finalization locks local clearing',async()=>{
 const ui=await setup({confirmResult:false}),before=ui.get('script-input').value;await ui.get('clear-script').emit('click');assert.equal(ui.get('script-input').value,before);assert.equal(ui.requests.some(r=>['draft','source-plan','production'].includes(r.route)),false);
 ui.externalBusy(true);await ui.poll();assert.equal(ui.get('clear-script').disabled,false);assert.equal(ui.get('theme-auto').disabled,true);ui.externalBusy(false);ui.externalFinalize();await ui.poll();assert.equal(ui.get('clear-script').disabled,true);assert.equal(ui.get('theme-auto').disabled,true);
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
 assert.equal(ui.state().rows[0].cutImage,null);assert.equal([...ui.get('rows').walk()].some(e=>e.dataset.cutImage==='one'),false);
 assert.equal([...ui.get('rows').walk()].some(e=>e.tagName==='img'&&e.attributes.src==='/materials/'+file),false);
});
test('unprepared images cannot be adopted; preparing and per-cut regeneration disclose costs without sending on render',async()=>{
 const proposal={id:'proposal-1',scenes:[{id:'one',caption:'字幕。',imageFile:'',imagePrompt:'静かな室内',reason:'説明に対応する画像が必要'}]};
 const ui=await setup({imageProposal:proposal});assert.equal(ui.get('plan-images').hidden,false);assert.match(ui.get('plan-images').textContent,/画像1枚.*API/);assert.equal(ui.get('approve-images').disabled,true);assert.match(ui.get('approve-images').textContent,/APIなし/);assert.equal(ui.get('image-proposal').children.length,0);assert.equal(ui.requests.some(r=>['prepare-images','approve-images','regenerate-image'].includes(r.route)),false);
});
test('only one final render control exists and new-project and draft saving are subordinate actions',()=>{
 assert.ok(!html.includes('id="export"'));assert.ok(!html.includes('id="play-full"'));assert.ok(!html.includes('id="consent"'));assert.ok(!html.includes('class="audio-download"'));assert.match(html,/<button id="new-project-bottom"[^>]*class="quiet">制作をクリアして新しく始める/);assert.ok(!html.includes('<details class="draft-save">'));assert.match(html,/<button id="save-production"/);assert.ok(html.includes('id="download-audio"'));
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

test('cut image replacement and regeneration are directly visible without an image assignment dropdown',async()=>{
 const file='a'.repeat(64)+'.jpg',ui=await setup({assets:[{file,name:'既存画像.jpg'}]});
 const direct=element=>{assert.ok(element);for(let p=element;p&&p!==ui.get('rows');p=p.parent){assert.notEqual(p.tagName,'details');assert.equal(!!p.hidden,false);}};
 for(const id of ['one','two']){
  const card=[...ui.get('rows').walk()].find(e=>e.dataset.rowId===id),nodes=[...card.walk()];
  assert.equal(nodes.some(e=>e.dataset.cutImage===id),false);
  direct(nodes.find(e=>e.attributes.type==='file'));direct(nodes.find(e=>e.dataset.imagePrompt===id));direct(nodes.find(e=>e.dataset.generateImage===id));
  assert.equal(nodes.find(e=>e.dataset.generateImage===id).parent,nodes.find(e=>e.dataset.imagePrompt===id).parent.parent);
 }
 const prompt=[...ui.get('rows').walk()].find(e=>e.dataset.imagePrompt==='two');await ui.edit(prompt,'構図を広くする');await ui.poll();assert.equal([...ui.get('rows').walk()].find(e=>e.dataset.imagePrompt==='two').value,'構図を広くする');
 await [...ui.get('rows').walk()].find(e=>e.dataset.generateImage==='two').emit('click');assert.equal(ui.requests.find(r=>r.route==='regenerate-image').input.instructions,'構図を広くする');assert.equal(ui.requests.some(r=>r.route==='generate'),false);
});

test('cut image file selection works directly and busy drops cannot upload or replace artwork',async()=>{
 const ui=await setup(),bytes=new Uint8Array([4,5,6]),file={name:'replacement.png',size:bytes.length,arrayBuffer:async()=>bytes.buffer};
 let upload=[...ui.get('rows').walk()].find(e=>e.attributes.type==='file');upload.files=[file];await upload.emit('change');assert.equal(ui.requests.filter(r=>r.route==='material').length,1);assert.equal(ui.requests.filter(r=>r.route==='cut-image').length,1);
 ui.externalBusy(true);await ui.poll();const zone=[...ui.get('rows').walk()].find(e=>e.attributes.class==='cut-image-drop');await zone.emit('drop',{preventDefault(){},dataTransfer:{files:[file]}});assert.equal(ui.requests.filter(r=>r.route==='material').length,1);assert.equal(ui.requests.filter(r=>r.route==='cut-image').length,1);
 ui.externalBusy(false);await ui.poll();ui.externalFinalize();await ui.poll();assert.equal([...ui.get('rows').walk()].some(e=>e.attributes.type==='file'||e.dataset.imagePrompt||e.dataset.generateImage),false);
});

test('correction submission remains disabled for empty instructions with and without a key',async()=>{
 const ui=await setup();const note=()=>[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');
 const disabled=()=>{assert.equal(ui.get('apply-review').disabled,true);assert.equal([...ui.get('rows').walk()].find(e=>e.dataset.applyReview==='one').disabled,true);};
 disabled();await ui.edit(note(),'  \n ');await ui.edit(ui.get('review-overall'),' \n ');disabled();
 ui.restart();await ui.poll();disabled();assert.equal(ui.requests.some(r=>r.route==='apply-review'),false);
});

test('clearing a saved correction disables submission and a completed correction cannot be sent again',async()=>{
 const ui=await setup(),note=()=>[...ui.get('rows').walk()].find(e=>e.attributes['aria-label']==='1カットへの修正指示');
 await ui.edit(note(),'説明を短くする');await ui.get('save-review').emit('click');assert.equal(ui.get('apply-review').disabled,false);
 await ui.edit(note(),'');assert.equal(ui.get('apply-review').disabled,true);assert.equal(ui.requests.some(r=>r.route==='apply-review'),false);
 await ui.edit(note(),'説明を短くする');await ui.get('apply-review').emit('click');await ui.poll();assert.equal(ui.get('apply-review').disabled,true);assert.equal(ui.requests.filter(r=>r.route==='apply-review').length,1);
});

test('generation results are absent before creation and become visible for progress, failure and completed media',async()=>{
 const ui=await setup(),link=()=>[...ui.get('workflow-nav').walk()].find(e=>e.dataset.goStep==='finish');
 assert.equal(ui.get('finish').hidden,true);assert.equal(link().hidden,true);assert.equal(ui.requests.some(r=>r.route==='generate'||r.route==='render-preview'),false);
 ui.externalVideo({running:true,stage:'rendering'});await ui.poll();assert.equal(ui.get('finish').hidden,false);assert.equal(link().hidden,false);
 ui.externalVideo({running:false,stage:'failed',error:'RENDER_FAILED'});await ui.poll();assert.equal(ui.get('finish').hidden,false);
 ui.externalVideo({stage:'canceled',error:null});await ui.poll();assert.equal(ui.get('finish').hidden,false);
 ui.externalVideo({stage:'idle',error:null,result:{file:'completed.mp4',filename:'completed.mp4',savedPath:'fixture-only',reviewState:'pending'}});await ui.poll();assert.equal(ui.get('finish').hidden,false);assert.equal(ui.get('video-result').hidden,false);
 ui.externalVideo({stage:'idle',result:null});await ui.poll();assert.equal(ui.get('finish').hidden,true);assert.equal(link().hidden,true);
});

test('AI voice is initially selected and manual voice controls appear only when the switch is on',async()=>{
 const sourcePlan={script:'入口です。',readings:[{caption:'入口です。',speech:'いりぐちです。'}],storyboard:{title:'入口',voice:'Puck',voiceReason:'明るく案内する',sources:[],scenes:[{caption:'入口です。'}]}};
 const ui=await setup({rows:[],sourcePlan});await ui.edit(ui.get('source-text'),'入口の案内');await ui.sendScript();await ui.get('plan-sources').emit('click');
 assert.equal(ui.get('voice-manual').checked,false);assert.equal(ui.get('manual-voice-settings').hidden,true);assert.equal(ui.get('voice').value,'Puck');assert.match(ui.get('voice-proposal').children[0].textContent,/AIが選んだ声.*Puck/);assert.equal(html.includes('id="use-proposed-voice"'),false);
 ui.get('voice-manual').checked=true;await ui.get('voice-manual').emit('change');assert.equal(ui.get('manual-voice-settings').hidden,false);ui.get('voice-preset').value='gemini-3.8-flash-lite-tts::Kore';await ui.get('voice-preset').emit('change');await ui.edit(ui.get('pitch'),'low');await ui.poll();assert.equal(ui.get('voice').value,'Kore');assert.equal(ui.get('pitch').value,'low');
 ui.get('voice-manual').checked=false;await ui.get('voice-manual').emit('change');assert.equal(ui.get('manual-voice-settings').hidden,true);assert.equal(ui.get('voice').value,'Puck');assert.equal(ui.get('pitch').value,'standard');
 await ui.get('apply-voice').emit('click');assert.equal(ui.state().settings.voice,'Puck');assert.equal(ui.state().production.brief.voiceMode,'auto');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.requests.some(r=>['generate','preview','prepare-samples'].includes(r.route)),false);
});

test('selected voice playback is available in automatic and manual modes and cached playback never calls the provider',async()=>{
 const ui=await setup();ui.restart();await ui.poll();assert.equal(ui.get('preview-voice').hidden,false);assert.equal(ui.get('preview-voice').disabled,false);await ui.get('preview-voice').emit('click');assert.equal(ui.get('sample-audio').played,true);
 ui.get('voice-manual').checked=true;await ui.get('voice-manual').emit('change');assert.equal(ui.get('preview-voice').hidden,false);assert.equal(ui.get('preview-voice').disabled,false);await ui.get('preview-voice').emit('click');assert.equal(ui.requests.some(r=>['preview','settings','generate'].includes(r.route)),false);
 ui.externalBusy(true);await ui.poll();assert.equal(ui.get('voice-manual').disabled,true);
});

test('a saved manual mode survives bootstrap and stale or invalid AI voice proposals cannot replace it',async()=>{
 const storyboard={voice:'Puck',voiceReason:'案内の声',scenes:[{caption:'Caption one'},{caption:'Caption two'}]},manual=await setup({voiceMode:'manual',storyboard});
 assert.equal(manual.get('voice-manual').checked,true);assert.equal(manual.get('manual-voice-settings').hidden,false);assert.equal(manual.get('voice').value,'Kore');await manual.edit(manual.get('pitch'),'high');await manual.get('apply-voice').emit('click');await manual.poll();assert.equal(manual.state().production.brief.voiceMode,'manual');assert.equal(manual.get('voice').value,'Kore');assert.equal(manual.get('pitch').value,'high');
 for(const invalid of [{...storyboard,scenes:[{caption:'別の台本'}]},{...storyboard,voice:'UnknownVoice'}]){const ui=await setup({storyboard:invalid});assert.equal(ui.get('voice').value,'Kore');assert.equal(ui.get('voice-proposal').hidden,true);assert.equal(ui.get('voice-manual').checked,false);assert.equal(ui.requests.some(r=>['settings','preview','generate'].includes(r.route)),false);}
});

test('saved AI title is visible and joins full reading confirmation even when the project title was not applied',async()=>{
 const caption='朝の道具を紹介します。',title='朝の道具',titleReading={caption:title,speech:'あさのどうぐ'};
 const ui=await setup({titleReading,storyboard:{title,voice:'Puck',scenes:[{caption}]},rows:[{id:'one',caption,speech:'あさのどうぐをしょうかいします。'}]});
 ui.externalBrief({autoDirection:true,titleMode:'auto',script:caption,readings:[{caption,speech:'あさのどうぐをしょうかいします。'}]});await ui.poll();
 assert.equal(ui.get('bookends-tools').tagName,'div');assert.equal(ui.get('opening-title').value,title);assert.equal(ui.get('opening-speech').value,titleReading.speech);
 await ui.get('confirm-script').emit('click');assert.equal(ui.state().title,title);assert.equal(ui.state().rows[0].speech,titleReading.speech);assert.ok(ui.state().rows.every(r=>r.reviewed));
 assert.equal(ui.requests.some(r=>['source-plan','draft','prepare-readings','generate','preview'].includes(r.route)),false);
});

test('title candidates are bound to the adopted script and preserve manual corrections through polling',async()=>{
 const caption='朝の道具を紹介します。',titleReading={caption:'朝の道具',speech:'あさのどうぐ'};
 for(const brief of [{autoDirection:true,titleMode:'manual',script:caption},{autoDirection:true,titleMode:'auto',script:'違う本文。'}]){
  const ui=await setup({titleReading,rows:[{id:'one',caption,speech:'あさのどうぐをしょうかいします。'}]});ui.externalBrief(brief);await ui.poll();assert.equal(ui.get('opening-title').value,'Original title');assert.equal(ui.get('opening-speech').value,'');assert.equal(ui.requests.some(r=>r.route==='bookends'),false);
 }
 const ui=await setup({titleReading:{caption:'Original title',speech:'たいとる'}});await ui.edit(ui.get('opening-speech'),'てなおししたたいとる');await ui.poll();await ui.get('confirm-script').emit('click');assert.equal(ui.state().rows[0].speech,'てなおししたたいとる');assert.ok(ui.state().rows.every(r=>r.reviewed));assert.equal(ui.requests.some(r=>['generate','prepare-readings'].includes(r.route)),false);
});

test('image controls stay usable with an AI voice candidate and preserve independent manual edits',async()=>{
 const caption='道具を紹介します。',file='a'.repeat(64)+'.png',ui=await setup({storyboard:{voice:'Puck',scenes:[{caption}]},assets:[{file,name:'道具.png'}],rows:[{id:'one',caption,speech:'どうぐをしょうかいします。',cutImage:{file}}]});
 const card=()=>[...ui.get('rows').walk()].find(e=>e.dataset.rowId==='one'),find=fn=>[...card().walk()].find(fn);
 assert.equal(find(e=>e.tagName==='input'&&e.attributes.type==='file').disabled,false);assert.equal(find(e=>e.dataset.generateImage==='one').disabled,false);assert.equal(find(e=>e.dataset.visualTitle==='one').disabled,false);assert.equal(find(e=>e.dataset.saveVisual==='one').disabled,false);
 await ui.edit(ui.get('opening-speech'),'てなおししたよみ');const voice=ui.get('voice').value;await find(e=>e.tagName==='button'&&e.textContent==='このカットから画像を外す').emit('click');
 assert.equal(ui.state().rows[0].cutImage?.file,undefined);assert.equal(ui.get('voice').value,voice);assert.equal(ui.get('opening-speech').value,'てなおししたよみ');
 await ui.edit(ui.textArea('one','speech'),'ていねいにしょうかいします。');assert.equal(find(e=>e.tagName==='input'&&e.attributes.type==='file').disabled,false);assert.equal(find(e=>e.dataset.generateImage==='one').disabled,true);
 assert.equal(find(e=>e.dataset.imagePrompt==='one').disabled,false);assert.equal(ui.requests.some(r=>['generate','regenerate-image','approve'].includes(r.route)),false);
 ui.externalBusy(true);await ui.poll();assert.equal(find(e=>e.tagName==='input'&&e.attributes.type==='file').disabled,true);
});

test('source script adoption carries AI title reading into review without a separate AI action',async()=>{
 const title='朝の道具',titleReading={caption:title,speech:'あさのどうぐ'},sourcePlan={script:'窓を開けます。',readings:[{caption:'窓を開けます。',speech:'まどをあけます。'}],titleReading,direction:{title,template:'steps',motion:null}};
 const ui=await setup({rows:[],sourcePlan});await ui.edit(ui.get('source-text'),'朝の道具を紹介');await ui.get('generate-script').emit('click');await ui.get('plan-sources').emit('click');await ui.get('apply-voice').emit('click');
 assert.equal(ui.get('opening-title').value,title);assert.equal(ui.get('opening-speech').value,titleReading.speech);assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.requests.some(r=>r.route==='prepare-readings'),false);
 assert.ok(ui.requests.some(r=>r.route==='bookends'&&r.input.speech===titleReading.speech));
 assert.equal(ui.state().rows[0].caption,title);assert.equal(ui.state().rows[0].speech,titleReading.speech);assert.equal(ui.state().rows[0].reviewed,false);
 assert.equal(ui.get('prepare-readings').hidden,true);
});

test('local script clearing remains available while production is busy and polling preserves the empty draft',async()=>{
 const ui=await setup();const saved=ui.state().production.brief.script;ui.externalBusy(true);await ui.poll();
 assert.equal(ui.get('clear-script').disabled,false);assert.equal(ui.get('script-input').disabled,false);
 await ui.get('clear-script').emit('click');await ui.get('confirm-script-action').emit('click');await ui.poll();
 assert.equal(ui.get('script-input').value,'');assert.equal(ui.state().production.brief.script,saved);
 assert.equal(ui.requests.some(r=>['draft','source-plan','production','cancel','generate'].includes(r.route)),false);
 ui.externalBusy(false);ui.externalFinalize();await ui.poll();assert.equal(ui.get('clear-script').disabled,true);
});

test('paid connection diagnosis is in a closed optional disclosure',()=>{
 assert.match(html,/<details id="generation-diagnostic"><summary>[^<]+<\/summary>[\s\S]*?id="probe-generation"[\s\S]*?<\/details>/);
 assert.doesNotMatch(html,/<details id="generation-diagnostic"[^>]*\bopen\b/);
});

test('fresh project and URL only starts source generation on the first click with no overwrite dialog',async()=>{
 const sourcePlan={script:'道具の紹介。',readings:[{caption:'道具の紹介。',speech:'どうぐのしょうかい。'}]};const ui=await setup({sourcePlan});await ui.get('new-project').emit('click');
 await ui.edit(ui.get('source-urls'),'https://example.com/tools');assert.equal(ui.get('script-input').value,'');assert.equal(ui.get('generate-script').disabled,false);
 await ui.get('generate-script').emit('click');assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.get('script-confirm').hidden,true);assert.equal(ui.get('script-input').value,sourcePlan.script);
});

test('unified cut image regeneration explains missing API readiness and unlocks after UI key registration',async()=>{
 const file='b'.repeat(64)+'.png',sourcePlan={script:'道具の説明。',storyboard:{title:'道具',scenes:[{title:'道具',caption:'道具の説明。',imageFile:file}]}};
 const ui=await setup({rows:[],sourcePlan,assets:[{file,name:'道具.png'}]});await ui.edit(ui.get('source-urls'),'https://example.com/tools');await ui.get('generate-script').emit('click');await ui.get('plan-sources').emit('click');
 ui.restart();await ui.poll();const find=()=>[...ui.get('rows').walk()].find(e=>e.dataset.generateImage==='adopted-0');
 assert.equal(find().disabled,false,JSON.stringify({busy:ui.state().busy,finalized:!!ui.state().production.finalization,video:ui.state().video.running,key:ui.state().keyConfigured,hidden:find().hidden,loc:ui.location.hash}));assert.ok([...ui.get('rows').walk()].some(e=>e.textContent==='画像の生成・再生成には、画面上部でGemini APIキーを登録してください。'));await find().emit('click');assert.equal(ui.get('api-required-alert').hidden,false);assert.equal(ui.requests.some(r=>r.route==='regenerate-image'),false);
 await ui.edit(ui.get('api-key'),'test-only-key');await ui.get('key-form').emit('submit');assert.equal(find().disabled,false);assert.equal(ui.requests.some(r=>r.route==='regenerate-image'),false);
});

 test('clearing a displayed result during source preparation is not overwritten when generation completes',async()=>{
 let finish;const sourceWait=new Promise(resolve=>{finish=resolve;}),sourcePlan={script:'新しい本文。',readings:[{caption:'新しい本文。',speech:'あたらしいほんぶん。'}]};
 const ui=await setup({sourceWait,sourcePlan,rows:[]});await ui.edit(ui.get('source-text'),'参考本文');await ui.edit(ui.get('script-input'),'残っている台本。');
 const sending=ui.sendScript({confirmOverwrite:true});while(!ui.requests.some(r=>r.route==='source-plan'))await new Promise(resolve=>setTimeout(resolve,0));await ui.poll();
 await ui.get('clear-script').emit('click');await ui.get('confirm-script-action').emit('click');finish();await sending;await ui.poll();
 assert.equal(ui.get('script-input').value,'');assert.equal(ui.state().production.brief.script,sourcePlan.script);assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);assert.equal(ui.requests.some(r=>r.route==='cancel'),false);
 });

test('switching automatic direction on does not present a retained proposal as newly generated',async()=>{
 const sourcePlan={script:'朝の説明。',readings:[{caption:'朝の説明。',speech:'あさのせつめい。'}],direction:{title:'朝の道具',template:'steps',motion:null}};
 const ui=await setup({rows:[],sourcePlan});await ui.edit(ui.get('source-text'),'参考本文');await ui.get('generate-script').emit('click');assert.equal(ui.get('direction-sample').hidden,false);
 ui.get('auto-direction').checked=false;await ui.get('auto-direction').emit('change');ui.get('auto-direction').checked=true;await ui.get('auto-direction').emit('change');assert.equal(ui.get('direction-sample').hidden,true);assert.doesNotMatch(ui.get('direction-info').textContent,/AIの提案/);assert.equal(ui.requests.filter(r=>r.route==='source-plan').length,1);
 await ui.sendScript({confirmOverwrite:true});assert.equal(ui.get('direction-sample').hidden,false);
});

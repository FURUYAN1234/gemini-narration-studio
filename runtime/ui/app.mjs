const $=id=>document.getElementById(id);
let state,token,instanceId,themes=[],designs=[],designChoice,designPreviewOnly=false,designGenerating=false,lastRevision='',wasBusy=false,localBusy=false,lastKeyConfigured,customMode=false,fullPlayback=null,screenTheme,projectSignature='';
const dirtyFields=new Set();
let correctionOutcome='',draftGenerating=false,draftOutcome='',productionSaving=false,cancelRequested=false,scriptReadings,storyboard;
let workflowPaused=false,pauseRequested=false,workflowProject,pauseStep='planning';
const workflowSteps=['planning','connection','reading','finish'];
function syncWorkflow(){
 if(workflowProject!==state.projectId){workflowProject=state.projectId;workflowPaused=false;pauseRequested=false;try{const step=window.sessionStorage?.getItem('narration-paused:'+workflowProject);if(workflowSteps.includes(step)){pauseStep=step;workflowPaused=true;}}catch{}}
 if(pauseRequested&&!state.busy&&!state.video?.running&&!localBusy){pauseRequested=false;workflowPaused=true;try{window.sessionStorage?.setItem('narration-paused:'+workflowProject,pauseStep);}catch{}window.location.hash='#workflow-paused';$('workflow-paused').scrollIntoView?.({block:'start'});actionMessage('cancel-status','制作を中断しました。台本・素材・音声は保持しています。');}
 $('workflow-paused').hidden=!workflowPaused;
 for(const id of [...workflowSteps,'studio-intro','workflow-nav'])$(id).hidden=workflowPaused;
 $('resume-workflow').disabled=!!(state.busy||state.video?.running||localBusy);
}
const artworkDrafts=new Map(),visualDrafts=new Map();
const rowEditors=new Map(),cutInstructions=new Map(),cutImages=new Map();
const voicePresets={auto:{voice:'Kore',style:'自然な日本語で、落ち着いて明瞭に話す。'},bright:{voice:'Puck',style:'明るく親しみやすい日本語で、聞き取りやすく話す。'},explain:{voice:'Charon',style:'落ち着いた日本語で、要点と区切りを明瞭に説明する。'},soft:{voice:'Aoede',style:'やわらかく親しみやすい日本語で、穏やかに話す。'}};
const genderFor=voice=>state.voiceGenders?.[voice]||'unknown';
const genderLabel=gender=>gender==='male'?'男性':gender==='female'?'女性':'分類未確認';
function voiceCompare(a,b){const genders=['male','female','unknown'],first=['Kore','Puck','Charon','Aoede'];const rank=v=>first.includes(v)?first.indexOf(v):4;return genders.indexOf(genderFor(a))-genders.indexOf(genderFor(b))||rank(a)-rank(b)||a.localeCompare(b,'en');}
const modelLabel=model=>model.includes('lite')?'Gemini 3.8 Flash-Lite TTS':'Gemini 3.8 Flash TTS';
function styleForVoice(voice){return Object.values(voicePresets).find(p=>p.voice===voice)?.style||voicePresets.auto.style;}
function summaryForVoice(voice){return voice==='Puck'?'明るく親しみやすい案内':voice==='Charon'?'落ち着いた明瞭な解説':voice==='Aoede'?'やわらかく穏やかな語り':'自然で明瞭なナレーション';}
function allPresets(){return (state.models||['gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts']).flatMap(model=>[...state.voices].sort(voiceCompare).map(voice=>({model,voice,style:styleForVoice(voice)})));}
function sameSettings(a,b){return a.model===b.model&&a.voice===b.voice&&a.style===b.style&&(a.pitch||'standard')===(b.pitch||'standard');}
function allSamplePresets(){return state.sampleSettings||allPresets().flatMap(config=>['standard','low','high'].map(pitch=>({...config,...(pitch==='standard'?{}:{pitch})})));}
function missingPresets(){return allSamplePresets().filter(config=>!(state.samples||[]).some(s=>sameSettings(s.settings,config)));}
function syncVoicePreset(){const s=selectedSettings();if(s.style!==styleForVoice(s.voice))customMode=true;$('voice-preset').value=customMode?'custom':s.model+'::'+s.voice;$('custom-settings').hidden=!customMode;$('model-info').textContent='使用モデル：'+modelLabel(s.model)+' · '+s.voice+(customMode?' · カスタマイズ':'');}
function buildPresetMenu(){const groups=[];for(const gender of ['male','female','unknown'])for(const model of (state.models||['gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts'])){const voices=state.voices.filter(voice=>genderFor(voice)===gender).sort(voiceCompare);if(!voices.length)continue;const group=element('optgroup',undefined,{label:genderLabel(gender)+'の声 / '+modelLabel(model)});for(const voice of voices)group.append(element('option',voice+'（'+genderLabel(gender)+'） — '+summaryForVoice(voice)+' ['+(model.includes('lite')?'Flash-Lite':'Flash')+']',{value:model+'::'+voice}));groups.push(group);}$('voice-preset').replaceChildren(...groups,element('option','カスタマイズ — モデル・声・話し方を自由に設定',{value:'custom'}));}

function applyTheme(name){const t=themes.find(t=>t.name===name);if(!t)return;const root=document.documentElement;root.style.setProperty('--bg',t.background);root.style.setProperty('--fg',t.heading);root.style.setProperty('--accent',t.accent);root.style.setProperty('--muted',t.name==='white'?'#536072':'#b4c5c8');root.style.setProperty('--border',t.name==='white'?'#cad3dc':'rgba(180,207,217,.22)');root.style.setProperty('--panel',t.name==='white'?'rgba(30,60,100,.035)':'rgba(255,255,255,.045)');root.style.colorScheme=t.name==='white'?'light':'dark';}
const errors={INVALID_BOOKENDS:'タイトルとEDの名前・URL・秒数を確認してください。',STALE_BOOKENDS:'冒頭タイトルの対応が変わっています。保存した制作を開き直してください。',TITLE_IMAGE_NOT_ALLOWED:'タイトル画面は文字と背景で構成します。画像の割り当ては本編で行ってください。',INVALID_CUT_PAUSE:'カット間の長さは0〜3秒の範囲で指定してください。',STALE_MUSIC:'台本か音声が変わりました。今のBGMを使うか、BGMを作り直すか、外してから確定してください。',IMAGE_GENERATION_NOT_ALLOWED:'画像生成を使うには制作条件を「提供素材から選び、不足する絵をAIで補う」に変更してください。',IMAGE_PROMPT_REQUIRED:'生成する画像の内容を入力してください。',INVALID_IMAGE_REFERENCES:'参照画像は登録済みの画像から3枚まで選んでください。',MUSIC_DECODE_FAILED:'生成されたBGMを音声として検証できませんでした。素材は保存しています。自動再生成はしません。',INVALID_MUSIC:'BGMの出力または設定が不正です。元の内容を保持しています。',PROVIDER_MUSIC_REQUIRED:'GoogleからBGM音声が返りませんでした。自動再試行はしません。',PROVIDER_INCOMPLETE_MUSIC:'GoogleのBGM生成が完了しませんでした。',PROVIDER_IMAGE_REQUIRED:'Googleから画像が返りませんでした。',PROVIDER_INCOMPLETE_IMAGE:'Googleの画像生成が完了しませんでした。',PROVIDER_OUTPUT_FORMAT_REJECTED:'Googleが出力形式の指定を拒否しました。アプリの送信設定を修正する必要があります。',PROVIDER_INVALID_API_KEY:'GoogleがAPIキーを無効または期限切れと判定しました。アプリ上部で有効なGemini APIキーを設定してください。',PROVIDER_KEY_RESTRICTED:'APIキーの利用元またはAPIの制限により拒否されました。Google側のキー制限を確認してください。',PROVIDER_SERVICE_DISABLED:'このGoogleプロジェクトで必要なAPIが無効です。',PROVIDER_BILLING_DISABLED:'Google側で請求設定が無効と報告されました。',PROVIDER_SCHEMA_REJECTED:'Googleが出力データのスキーマを拒否しました。送信形式の修正が必要です。',PROVIDER_MEDIA_REJECTED:'Googleが画像・メディアの形式を拒否しました。',PROVIDER_REQUEST_TOO_LARGE:'Googleがリクエスト容量の超過を報告しました。',REFERENCE_REQUIRED:'画像・TXTなどの資料、参考本文、またはURLを入れてください。',INVALID_REFERENCES:'参考本文・URLの形式または件数を確認してください。',INVALID_REFERENCE_URL:'公開されたHTTP/HTTPSのURLを入れてください。認証情報・鍵付きURL・ローカルURLは使えません。',SOURCE_SIZE_LIMIT:'送信する素材が合計12MBを超えています。小さくしてから実行してください。',SOURCE_COUNT_LIMIT:'一度に送る素材は20件までです。',SOURCE_URL_NOT_RETRIEVED:'参考URLの取得成功を確認できませんでした。取得できたふりをせず、構成の適用を止めています。本文を貼る方法も使えます。再実行にはAPIを使います。',SOURCE_NOT_ANALYZED:'読み取れなかった資料があります。資料を確認してください。自動再試行はしません。',INVALID_STORYBOARD:'AIの構成データが条件に合いませんでした。前の内容は残っています。',INVALID_IMAGE_FOCUS:'画像の注目位置が範囲外です。',HIRAGANA_READING_REQUIRED:'読み上げ文に漢字・カタカナ・英字・数字が残っています。ひらがなの読みが必要です。',READING_PREPARATION_REQUIRED:'この台本のひらがなの読みを先に用意してください。',INVALID_SCRIPT_READINGS:'字幕と読みの組み合わせが不正です。',STALE_SCRIPT_READINGS:'字幕が変更されたため、その読みを引き継げません。',READING_SENTENCE_MISMATCH:'字幕と読みの文数が一致しません。',GENERATION_CONSENT_REQUIRED:'Googleへの送信・音声作成への同意を確認してください。',VIDEO_FINALIZED:'全カットを最終確定済みです。この動画はこの版は編集終了になります。後から修正版を作って各工程へ戻れます。',FINAL_CONFIRMATION_REQUIRED:'全カットの最終確定を行ってください。',FINALIZED_CONTENT_CHANGED:'最終確定後の内容が変更されています。動画への引き渡しを中止します。',CUT_LOCKED:'このカットは確定済みです。「編集する」で解除してから修正してください。',CUT_CONFIRMATION_REQUIRED:'画像と音声を確認し、カットを確定してください。',STALE_CUT_REVIEW:'カットの画像か音声が更新されました。最新の内容を確認してください。',CUT_IMAGE_REQUIRED:'このカットで使用する画像を準備・割り当ててください。',INVALID_CUT_IMAGE:'画像素材を選択してください。',CUT_IMAGE_AMBIGUOUS:'このカットの画像が複数あります。使用画像を一つに指定してください。',CORRECTIONS_PENDING:'修正指示が残っています。指摘した箇所を直してから動画へ渡してください。',API_KEY_REQUIRED:'APIキーを設定してください。',READING_REVIEW_REQUIRED:'未確認の読みが残っています。各行の読みを確認してください。',STALE_REVISION:'台本が更新されました。最新の内容を確認し直してください。',AUDIO_REQUIRED:'現在の台本・声に対応する音声がありません。',AUDIO_LISTEN_REQUIRED:'生成した音声を試聴して、確認済みにしてください。',REGENERATION_CONFIRM_REQUIRED:'再合成には、その行の再合成ボタンを使ってください。',PROVIDER_AUTH_FAILED:'Googleで認証に失敗しました。APIキーを確認してください。',PROVIDER_PERMISSION_DENIED:'Googleがアクセスを拒否しました。キーの権限・プロジェクト設定を確認してください。',PROVIDER_RATE_LIMIT:'Googleの利用上限に達しました。利用枠とクォータを確認してください。',PROVIDER_BAD_REQUEST:'Googleがリクエストを受け付けませんでした。モデルと設定を確認してください。',PROVIDER_MODEL_NOT_FOUND:'指定モデルをGoogleで利用できません。提供状況を確認してください。',PROVIDER_NETWORK_FAILED:'Googleへの接続に失敗しました。',PROVIDER_TIMEOUT:'Googleの応答待ちが時間切れになりました。',CANCELED:'合成を中止しました。完成済みの音声は保持しています。',BUSY:'音声合成中です。終了するまでお待ちください。',CREDENTIAL_IN_TEXT:'台本にAPIキーらしい文字列があります。削除してください。',MARKUP_OR_CONTROL_IN_TEXT:'読み上げ文にはタグや制御文字を入れないでください。'};
Object.assign(errors,{EMPTY_CORRECTION:'修正指示を入力してください。',INVALID_CORRECTION_RESULT:'修正結果の形式が不正なため、反映しませんでした。指示と元の音声・画像は保持しています。',INVALID_CORRECTION_IMAGE:'修正画像を検証できないため、反映しませんでした。',CORRECTION_IMAGE_TOO_LARGE:'修正元の画像が大きすぎます。15MB以下の画像を選んでください。',DESIGN_REQUIRED:'AIデザインを作成してから最終確定してください。',INVALID_DESIGN:'デザイン案に使えない色・配置が含まれているため、保存しませんでした。',INVALID_DESIGN_CONTRAST:'デザイン案の文字が読みづらいため、保存しませんでした。',INVALID_TEMPLATE:'選んだテンプレートを確認してください。',BUSY:'ほかの作成処理が終わるまでお待ちください。'});
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
async function api(route,data){const res=await fetch('/api/'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify(data)});const value=await res.json();if(!res.ok)throw new Error(value.error||'REQUEST_FAILED');return value;}
function actionMessage(id,text,error=false){if(id==='draft-status')draftOutcome=text;$(id).textContent=text;$(id).classList.toggle('error',error);message(text,error);}
function guarded(action,statusId){return async event=>{event?.preventDefault();try{await action(event);}catch(error){const code=error.message.split(':')[0],text=errors[code]||'処理できませんでした：'+error.message;if(statusId)actionMessage(statusId,text,true);else message(text,true);}};}
function element(tag,text,attrs={}){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
function isDirty(exceptVisual){return [...visualDrafts].some(([id,d])=>id!==exceptVisual&&d.dirty)||dirtyFields.has('bookends')||dirtyFields.has('settings')||dirtyFields.has('title')||dirtyFields.has('design')||dirtyFields.has('motion')||!!document.querySelector('[data-dirty="true"]');}
function selectedMotion(){return $('motion-style').value==='off'?null:{version:1,style:$('motion-style').value,intensity:$('motion-intensity').value};}
function savedMotion(){return Object.hasOwn(state.presentation||{},'motion')?state.presentation.motion:state.presentation?.design?.motion||null;}
function updateMotion(){
 const saved=savedMotion(),locked=state.busy||localBusy||state.video?.running||isFinalized();
 if(!dirtyFields.has('motion')){$('motion-style').value=saved?.style||'off';$('motion-intensity').value=saved?.intensity||'standard';}
 const selected=selectedMotion(),same=JSON.stringify(selected)===JSON.stringify(saved);
 if(same)dirtyFields.delete('motion');
 $('motion-style').disabled=locked;$('motion-intensity').disabled=locked||!selected;$('apply-motion').disabled=locked||same;
 $('apply-motion').textContent=same?'この演出に決定済み':'この演出を使う';$('play-motion').disabled=!selected;
 $('motion-status').textContent=isFinalized()?'確定済みの演出は変更できません。「ここから修正」で別の制作として変更できます。':same?(saved?'この演出で動画を作ります。台本と音声はそのまま使います。':'従来の表示です。動きを加えるには演出を選んで決定してください。'):'演出を選択中です。「この演出を使う」で保存します。';
 const preview=$('motion-preview');preview.setAttribute('data-style',selected?.style||'off');preview.style.setProperty('--motion-distance',selected?.intensity==='subtle'?'12px':selected?.intensity==='bold'?'50px':'28px');
 const d=state.presentation?.design||designs.find(t=>t.id===state.presentation?.template)?.design||designs.find(t=>t.id==='cinema')?.design;
 if(d)for(const [key,value]of Object.entries({bg:d.background,fg:d.heading,accent:d.accent}))preview.style.setProperty('--motion-'+key,value);
 const row=state.rows[0];$('motion-preview-title').textContent=row?.cutVisual?.title||row?.scene||state.title||'文字と画像を動かす';
 const file=row?.cutImage?.file,art=$('motion-preview-art');if(art.dataset.file!==(file||'')){art.replaceChildren();art.dataset.file=file||'';if(file)art.append(element('img',undefined,{src:'/materials/'+file,alt:''}));}
}
function paintDesign(node,d){
 if(!d)return;node.setAttribute('class','design-sample design-'+d.layout+' decor-'+d.decoration);
 for(const [key,value]of Object.entries({bg:d.background,fg:d.foreground,heading:d.heading,accent:d.accent,radius:d.radius+'px',ratio:d.imageRatio*100+'%',size:d.titleSize/12+'cqw'}))node.style.setProperty('--d-'+key,value);
 node.setAttribute('data-image-side',d.imageSide);
}
function buildDesignGallery(){
 $('template-gallery').replaceChildren(...designs.map(t=>{
  const button=element('button',undefined,{type:'button','data-template':t.id,'aria-pressed':'false',class:'template-card'}),thumb=element('div');paintDesign(thumb,t.design);
  thumb.append(element('strong',t.name,{class:'preview-heading'}),element('div',undefined,{class:'preview-image'}),element('span','見出しと要点',{class:'preview-points'}),element('small','字幕',{class:'preview-caption'}));
  button.append(thumb,element('strong',t.name),element('span',t.description));
  button.addEventListener('click',()=>{designChoice={mode:'template',template:t.id};designPreviewOnly=isFinalized();if(!isFinalized())dirtyFields.add('design');updateControls();});return button;
 }));
}
function updateDesign(){
 updateMotion();
 const saved=state.presentation||{theme:'moon'},lock=state.busy||localBusy,sealed=isFinalized();
 if(!designChoice||(!dirtyFields.has('design')&&!designPreviewOnly))designChoice={mode:saved.mode||'template',template:saved.template||'clean'};
 if(dirtyFields.has('design')&&((designChoice.mode==='template'&&saved.mode==='template'&&designChoice.template===saved.template)||(designChoice.mode==='ai'&&saved.mode==='ai'&&$('design-instructions').value.trim()===saved.instructions)))dirtyFields.delete('design');
 $('design-mode').value=designChoice.mode;$('design-mode').disabled=lock;
 $('template-gallery').hidden=designChoice.mode!=='template';$('ai-design-options').hidden=designChoice.mode!=='ai';
 const draft=designChoice.mode==='template'?designs.find(t=>t.id===designChoice.template)?.design:saved.mode==='ai'?saved.design:null;
 $('design-sample').hidden=!draft;if(draft)paintDesign($('design-sample'),draft);
 for(const button of document.querySelectorAll('[data-template]'))button.setAttribute('aria-pressed',String(designChoice.mode==='template'&&button.dataset.template===designChoice.template));
 const decided=designChoice.mode==='template'&&saved.mode==='template'&&designChoice.template===saved.template;
 $('apply-design').hidden=designChoice.mode!=='template';$('apply-design').disabled=lock||sealed||decided;
 $('apply-design').textContent=decided?'このデザインに決定済み':'このデザインに決定する';
 $('design-instructions').disabled=lock||sealed;$('design-consent').disabled=lock||sealed;
 $('draft-design').disabled=lock||sealed||!state.keyConfigured||!$('design-consent').checked||!$('design-instructions').value.trim();
 $('draft-design').textContent=designGenerating?'デザインを作成中…':'AIでデザインを作って使う';
 const applied=saved.mode==='ai'?saved.design?.name||'AIデザイン未作成':saved.mode==='template'?designs.find(t=>t.id===saved.template)?.name:'標準デザイン（既存設定）';
 $('design-selection').textContent=sealed?'この動画は最終確定済みです。見本の比較だけできます。':dirtyFields.has('design')?'見本を選択中です。決定すると動画に使います。':'動画に使うデザイン：'+applied;
}
function isCutConfirmed(row){return !!(row?.cutConfirmed??row?.listenedCurrent);}
function isFinalized(){return !!state.production?.finalization;}
function selectedSettings(){return {model:$('model').value,voice:$('voice').value,style:$('style').value,pitch:$('pitch').value||'standard'};}
function markSettingsDirty(){if(sameSettings(selectedSettings(),state.settings))dirtyFields.delete('settings');else dirtyFields.add('settings');}
function scriptParts(){return $('script-input').value.split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);}
function hasScriptReadings(){const parts=scriptParts();return !!parts.length&&scriptReadings?.length===parts.length&&scriptReadings.every((r,i)=>r.caption===parts[i]);}
function readingPreparationNeeded(){return !scriptAlreadyLoaded()&&!hasScriptReadings()&&scriptParts().some(s=>!/[ぁ-ゖ]/u.test(s)||/[^ぁ-ゖー\p{P}\s\u3099\u309a]/u.test(s));}
function currentBrief(){return {scriptMode:$('script-mode').value,assetMode:$('asset-mode').value,instructions:$('production-instructions').value,script:$('script-input').value,references:{text:$('source-text').value,urls:$('source-urls').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)},titleMode:$('title-mode').value,voiceMode:$('voice-mode').value,...(storyboard&&storyboard.scenes.map(r=>r.caption).join('\n\n')===$('script-input').value?{storyboard}:{}),...(hasScriptReadings()?{readings:scriptReadings}:{})};}
function cachedSample(){const s=selectedSettings();return state.samples?.find(i=>sameSettings(i.settings,s));}
function scriptAlreadyLoaded(){const parts=$('script-input').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);return !!parts.length&&state.rows.some((_,i)=>parts.every((text,j)=>state.rows[i+j]?.caption.trim()===text));}
function fitSentencePair(cap,speech){if(!cap.scrollHeight||!speech.scrollHeight)return;cap.style.height='auto';speech.style.height='auto';const height=(Math.max(86,cap.scrollHeight,speech.scrollHeight)+2)+'px';cap.style.height=height;speech.style.height=height;}
function sentences(text){return text?[...new Intl.Segmenter('ja',{granularity:'sentence'}).segment(text)].map(part=>part.segment):[];}
function editorText(editor,pair){return {caption:editor.pairs.map(p=>!pair||p===pair?p.cap.value:p.saved.caption).join(''),speech:editor.pairs.map(p=>!pair||p===pair?p.speech.value:p.saved.speech).join('')};}
function textMatches(a,b){return a.caption.trim()===b.caption.trim()&&a.speech.trim()===b.speech.trim();}
function editorChanged(editor){return !textMatches(editorText(editor),editor.baseline);}
function hasCorrections(){return !!(state.production?.review?.overall||state.production?.review?.cuts?.length||$('review-overall').value.trim()||[...cutInstructions.values()].some(v=>v.trim()));}
function updateCutImages(){for(const [id,box]of cutImages){
 const row=state.rows.find(r=>r.id===id),assets=(state.production?.assets||[]).filter(a=>/^[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/.test(a.file)),legacy=assets.filter(a=>a.name==='cut-'+id+'.png'),asset=(row?.cutImage&&assets.find(a=>a.file===row.cutImage.file))||(legacy.length===1?legacy[0]:null),file=asset?.file;
 const design=state.presentation?.mode==='ai'?state.presentation.design:designs.find(d=>d.id===(state.presentation?.template||'clean'))?.design;
 const signature=JSON.stringify([assets.map(a=>a.file),file,row?.cutVisual,row?.caption,design,isFinalized(),state.busy,localBusy,state.keyConfigured,state.production?.brief.assetMode,state.production?.brief.storyboard,row?.cutConfirmed]);if(box.dataset.files===signature)continue;box.dataset.files=signature;box.replaceChildren();
 if(state.production?.bookends?.titleRowId===id){box.hidden=false;box.append(element('strong',row.caption),element('figcaption','冒頭のタイトル画面。背景と文字を動かして表示します。画像は不要です。',{class:'help'}));continue;}
 if(file){const frame=element('div');paintDesign(frame,design);frame.classList.toggle('cut-template-preview',true);const image=element('div',undefined,{class:'preview-image'});image.append(element('img',undefined,{src:'/materials/'+file,alt:`${state.rows.findIndex(r=>r.id===id)+1}カットの使用画像`,class:'cut-frame-art',loading:'lazy'}));const notes=element('div',undefined,{class:'preview-points'});for(const point of row?.cutVisual?.points||[])notes.append(element('span',point));frame.append(element('span',row.scene||state.title,{class:'preview-kicker'}),element('strong',row?.cutVisual?.title||row.scene||state.title,{class:'preview-heading'}),notes,image,element('small',sentences(row.caption)[0]||row.caption,{class:'preview-caption'}));box.append(frame,element('figcaption',savedMotion()?'素材確認用の静止画です。完成動画では選んだ演出で構図と動きが変わります。':'動画レイアウトの見本。字幕は音声に合わせて一文ずつ切り替わります。',{class:'help'}));}
 if(assets.length){const label=element('label','このカットで使う画像'),select=element('select',undefined,{'data-cut-image':id,'aria-label':`${state.rows.findIndex(r=>r.id===id)+1}カットの使用画像を選択`});select.append(element('option','画像を選択してください',{value:''}),...assets.map(a=>element('option',a.name,{value:a.file})));select.value=file||'';select.disabled=!!(isFinalized()||state.busy);select.addEventListener('change',guarded(async()=>{if(!select.value)return;await pending(async()=>render(await api('cut-image',{id,file:select.value,revision:state.revision})));message('このカットの画像を変更しました。音声は再利用します。画像と音声を見直してください。');}));label.append(select);box.append(label);}
 if(!file&&legacy.length>1)box.append(element('p','このカットの画像が複数あります。使用画像を一つに指定してください。',{class:'help'}));
 else if(!file)box.append(element('p','このカットの画像は未準備です。台本に合う画像を準備して割り当ててから確認してください。',{class:'help'}));
 if(!isFinalized()){
  const saved=row?.cutVisual||{title:row.scene||'',points:[]},draft=visualDrafts.get(id)||{title:saved.title,points:saved.points.join('\n'),dirty:false};if(!draft.dirty){draft.title=saved.title;draft.points=saved.points.join('\n');}visualDrafts.set(id,draft);
  const detail=element('details'),titleLabel=element('label','画面の見出し'),title=element('input',undefined,{'data-visual-title':id,maxlength:'200'}),pointsLabel=element('label','画面の要点（1行に1つ・6項目まで）'),points=element('textarea',undefined,{'data-visual-points':id,rows:'3',maxlength:'966'});title.value=draft.title;points.value=draft.points;title.addEventListener('input',()=>{draft.title=title.value;draft.dirty=true;updateControls();});points.addEventListener('input',()=>{draft.points=points.value;draft.dirty=true;updateControls();});titleLabel.append(title);pointsLabel.append(points);
  const save=element('button','見出し・要点を保存（APIなし）',{type:'button','data-save-visual':id});save.disabled=title.disabled=points.disabled=!!(state.busy||localBusy);save.addEventListener('click',guarded(async()=>{if(isDirty(id))throw new Error('STALE_REVISION');await pending(async()=>{const next=await api('cut-visuals',{id,title:draft.title,points:draft.points.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),revision:state.revision,productionRevision:state.productionRevision});visualDrafts.delete(id);render(next,true);});message('画面の見出しと要点を保存しました。字幕・読み・音声・BGMは再利用します。');}));
  detail.append(element('summary','見出し・要点を確認する'),element('p','画像を差し替えた場合は、元の人物名や説明が残っていないか確認してください。ここを編集しても読み上げは変わりません。',{class:'help'}),titleLabel,pointsLabel,save);box.append(detail);
 }
 if(!isFinalized()&&state.production?.brief.assetMode!=='provided'){
  const planned=state.production?.brief.storyboard?.scenes.find(s=>s.caption===row.caption),draft=artworkDrafts.get(id)||{prompt:planned?.imagePrompt||'',references:planned?.imageReferences||[]};artworkDrafts.set(id,draft);
  const detail=element('details'),label=element('label','このカットに生成する絵'),prompt=element('textarea',undefined,{'data-image-prompt':id,rows:'3',maxlength:'3000'});prompt.value=draft.prompt;prompt.addEventListener('input',()=>{draft.prompt=prompt.value;});label.append(prompt);
  const refsLabel=element('label','参照画像（任意・複数選択は3枚まで）'),refs=element('select',undefined,{'data-image-references':id,multiple:'multiple','aria-label':'生成画像の参照素材'});for(const a of assets){const option=element('option',a.name,{value:a.file});option.selected=draft.references.includes(a.file);refs.append(option);}refs.addEventListener('change',()=>{draft.references=[...refs.selectedOptions].map(o=>o.value);});refsLabel.append(refs);
  const button=element('button',file?'このカットの新しい画像を生成（API 1回）':'不足する画像を生成（API 1回）',{type:'button','data-generate-image':id});button.disabled=!!(state.busy||localBusy||!state.keyConfigured);prompt.disabled=refs.disabled=!!(state.busy||localBusy);
  button.addEventListener('click',guarded(async()=>{if(isDirty())throw new Error('STALE_REVISION');if(!draft.prompt.trim())throw new Error('IMAGE_PROMPT_REQUIRED');if(!window.confirm('この指示と選択した参照画像をGoogleへ送り、画像を1枚生成します。APIを1回使用します。台本と音声はそのまま使います。'))return;await pending(async()=>{render(await api('generate-image',{id,prompt:draft.prompt,references:draft.references,revision:state.revision,productionRevision:state.productionRevision,consent:true}),true);});message('新しい画像をこのカットに割り当てました。台本と音声は再利用しています。');}));
  detail.append(element('summary','AIで画像を補う・差し替える'),label,refsLabel,button);detail.open=!!planned?.imagePrompt&&!file;box.append(detail);
 }
 box.hidden=false;
}}
function updateReviewControls(){const busy=state.busy||localBusy||isFinalized();for(const editor of rowEditors.values()){const locked=busy;for(const p of editor.pairs){p.cap.disabled=locked;p.speech.disabled=locked;p.commit.hidden=p.cap.value===p.saved.caption&&p.speech.value===p.saved.speech;p.commit.disabled=locked||p.commit.hidden;}editor.instruction.disabled=locked;editor.save.hidden=!editorChanged(editor);editor.save.disabled=locked;editor.approve.hidden=!editorChanged(editor)&&!!state.rows.find(r=>r.id===editor.id)?.reviewed;editor.approve.disabled=locked||(!editorChanged(editor)&&state.rows.find(r=>r.id===editor.id)?.reviewed);}
  $('review-overall').disabled=busy;$('save-review').disabled=busy||!dirtyFields.has('review');$('clear-review').disabled=busy||!hasCorrections();$('apply-review').disabled=busy||isDirty()||!state.keyConfigured||!hasCorrections();for(const b of document.querySelectorAll('[data-apply-review]'))b.disabled=busy||isDirty()||!state.keyConfigured||!cutInstructions.get(b.dataset.applyReview)?.trim();
  const changed=[...rowEditors.values()].some(editorChanged),reviewed=!!state.rows.length&&!changed&&state.rows.every(r=>r.reviewed);$('confirm-script').hidden=isFinalized()||!state.rows.length;$('confirm-script').textContent=reviewed?'全文の読みは確定済み':'全文の読みを確定（制作前）';$('confirm-script').disabled=busy||!state.rows.length||reviewed;$('review-save-state').textContent=changed?'修正内容が未確定です':reviewed?'全文の読みは確定済みです。':'字幕と読みを確認して、全文の読みを確定してください。';$('review-count').textContent=`${state.rows.filter(r=>r.reviewed&&!(rowEditors.get(r.id)&&editorChanged(rowEditors.get(r.id)))).length} / ${state.rows.length} 読み確認済み`;
}
async function saveEditor(editor,pair){const current=state.rows.find(r=>r.id===editor.id);if(!current||!textMatches(current,editor.baseline))throw new Error('STALE_REVISION');const input=editorText(editor,pair),saved=editor.pairs.map(p=>({pair:p,caption:p.cap.value,speech:p.speech.value}));if(!textMatches(input,current)){const next=await api('row',{id:editor.id,...input});editor.baseline=next.rows.find(r=>r.id===editor.id);for(const value of saved)if(!pair||value.pair===pair)value.pair.saved={caption:value.caption,speech:value.speech};if(editorChanged(editor))editor.box.dataset.dirty='true';else delete editor.box.dataset.dirty;render(next,true);}else{for(const value of saved)if(!pair||value.pair===pair)value.pair.saved={caption:value.caption,speech:value.speech};if(!editorChanged(editor))delete editor.box.dataset.dirty;updateControls();}}
function sampleAudio(id){const item=state.samples?.find(i=>i.id===id);if(!item)return;const audio=$('sample-audio');const src='/samples/'+item.file;if(!audio.src?.endsWith(src))audio.src=src;audio.hidden=false;$('sample-info').textContent=`${item.settings.voice} / ${item.settings.model} / ${item.settings.pitch==='low'?'低め':item.settings.pitch==='high'?'高め':'標準'} · ${item.durationSeconds.toFixed(1)}秒 · 保存済み（API呼び出しなし）`;}
function refreshSampleAudio(){const sample=cachedSample();$('preview-options').hidden=!!sample;$('preview-voice').hidden=!!sample;if(sample)sampleAudio(sample.id);else{$('sample-audio').pause();$('sample-audio').hidden=true;$('sample-info').textContent='このモデル・声・話し方・高さの組み合わせは未保存です。初回だけサンプルを作成できます。';}}
function updateExtras(){
 updateBookendsControls();updateMusicControls();const busy=state.busy||localBusy||isFinalized();for(const id of ['source-text','source-urls','title-mode','voice-mode','append-script','save-production','material-files','script-mode','asset-mode','production-instructions','script-input','pitch','voice-preset','voice','model','style'])$(id).disabled=busy;
 const applied=sameSettings(selectedSettings(),state.settings);$('apply-voice').disabled=busy||applied;$('apply-voice').textContent=applied?'この声に決定済み':'この声に決定する';$('voice-apply-state').textContent=applied?`${state.settings.voice} ／ ${state.settings.pitch==='low'?'低め':state.settings.pitch==='high'?'高め':'標準'} に決定済みです。${state.rows.length&&state.rows.every(r=>r.reviewed&&r.audioCurrent)?'ナレーションは作成済みです。全文確認で画像と音声を確認できます。':'次は全文確認でナレーションを作成します。'}`:'選択中の声は未反映です。「この声に決定する」で本番の声を決めてください。';
 const needsReading=readingPreparationNeeded();$('append-script').textContent=needsReading?'ひらがなの読みを準備して確認へ（API利用）':scriptAlreadyLoaded()?'この台本の読み確認へ進む →':'この台本で読み確認へ進む →';$('append-script').disabled=busy||!$('script-input').value.trim()||needsReading&&!state.keyConfigured;
 $('reading-prep-info').textContent=needsReading?'このボタンで台本をGoogleへ1回送り、ひらがなの読みを用意します。API利用料が発生する場合があります。':hasScriptReadings()?'字幕とひらがなの読みは準備済みです。追加のAPI利用はありません。':'取り込み済みの台本を確認します。追加のAPI利用はありません。';
 $('inspect-sources').disabled=busy||!state.keyConfigured;
 $('provider-diagnostic').hidden=!state.providerDiagnostic;$('provider-diagnostic').textContent=state.providerDiagnostic||'';
 $('check-connection').disabled=busy||!state.keyConfigured;
 $('probe-generation').disabled=busy||!state.keyConfigured;
 $('plan-sources').textContent=storyboard?'制作指示の修正を反映してドラフトを作り直す（API 1回）':'素材から構成・台本を作る（API利用）';
 $('plan-sources').disabled=busy||!state.keyConfigured||!$('production-instructions').value.trim();
 $('draft-script').disabled=busy||!state.keyConfigured||!$('production-instructions').value.trim();$('draft-script').textContent=draftGenerating?'AIが台本案を作成中…':'AIで台本案を作る（API利用）';
 $('draft-status').textContent=draftGenerating?'台本案を作成しています。':draftOutcome||(!state.keyConfigured?'APIキーが未設定です。画面上部で登録すると作成できます。':!$('production-instructions').value.trim()?'作りたい動画の指示を入力してください。':'準備できています。ボタンを押すとAPIを1回利用します。');$('draft-key-link').hidden=state.keyConfigured;
 $('save-production').textContent=productionSaving?'保存中…':'制作条件を保存';
 $('preview-voice').disabled=busy||(!cachedSample()&&(!state.keyConfigured||!$('preview-consent').checked));$('preview-voice').textContent=cachedSample()?'保存済みの声・高さを試聴（API不要）':'この声・高さのサンプルを作る（初回のみ）';
}
function stopFullAudio(){if(fullPlayback){$('full-audio').pause();fullPlayback=null;}}
function updateVideo(){
  const video=state.video||{},result=video.result,labels={preparing:'確定済みの画像・音声を準備',bundling:'動画レイアウトを準備',rendering:'映像と音声を動画に変換',verifying:'動画と音声を検査',saving:'ダウンロードフォルダへ保存',complete:'動画が完成しました'},videoErrors={VIDEO_FONT_TIMEOUT:'日本語フォントの読み込み待ちが時間切れになりました。台本・音声は保持しています。',VIDEO_RENDER_CANCELED:'動画生成を中止しました。確認済みの素材と音声は保持しています。',VIDEO_RENDERER_REQUIRED:'動画レンダラーが未設定です。Codexへこの動画の続きを依頼してください。',VIDEO_BROWSER_REQUIRED:'動画生成用ブラウザーが見つかりません。',VIDEO_RENDER_INTERRUPTED:'前回の動画生成は中断されました。確定済みの素材は保持しています。',VIDEO_SAVE_DENIED:'ダウンロードフォルダへ保存できませんでした。保存先へのアクセスを確認してください。'};
  $('export').textContent=video.canceling?'中止処理中…':video.running?'動画を生成中…':result?'動画を生成済み':video.stage==='canceled'?'動画生成を再開する':video.error?'動画生成を再実行する':'動画を生成する';
  $('video-work').hidden=!video.running&&!video.error&&!result;$('video-spinner').hidden=!video.running;
  $('video-status').textContent=video.canceling?'動画生成を中止しています。処理の終了を待っています。':video.error?(videoErrors[video.error]||'動画を生成できませんでした：'+video.error):(labels[video.stage]||'動画生成を準備しています。')+(video.stage==='rendering'?`（${video.renderedFrames||0} / ${video.totalFrames||0}フレーム）`:'');
  $('video-progress').hidden=!video.running||!['bundling','rendering'].includes(video.stage);$('video-progress').value=video.progress||0;
  const steps=(video.steps||[]).filter(step=>labels[step]);
  $('video-stages').replaceChildren(...steps.map((step,index)=>element('li',labels[step]+(video.error&&index===steps.length-1?video.stage==='canceled'?' — 中止':' — 失敗':step===video.stage&&video.running?' — 処理中':' — 完了'))));
  $('video-result').hidden=!result;if(result){const src='/video/'+result.file;if(!$('video-player').src?.endsWith(src))$('video-player').src=src;$('download-video').download=result.filename;$('video-saved-path').textContent='保存済み：'+result.savedPath;}
  $('manifest').hidden=!isFinalized();
}
function updateControls(){
  $('theme').disabled=state.busy||localBusy;
  const projectLocked=state.busy||localBusy||state.video?.running||isDirty()||dirtyFields.size>0;
  $('new-project').disabled=!!projectLocked;$('new-project-bottom').disabled=!!projectLocked;$('project-select').disabled=!!projectLocked;
  $('revise-project').disabled=!!projectLocked;
  for(const button of document.querySelectorAll('[data-revise-step]')){button.disabled=!!projectLocked;button.hidden=!isFinalized();}
  $('project-info').textContent=dirtyFields.size||isDirty()?'編集中の内容を保存してから、動画を切り替えられます。':state.busy||state.video?.running?'処理が完了すると、別の動画を始められます。':isFinalized()?'この動画は最終確定済みです。閲覧・再生できます。別の制作は「新しい動画を作る」で開始します。':'編集中の動画は編集を再開できます。最終確定済みの動画は閲覧・再生用です。';
  updateExtras();updateReviewControls();
  updateDesign();
  const lock=state.busy||localBusy||isDirty(),sealed=isFinalized(),ready=state.rows.filter(r=>r.reviewed&&!r.audioCurrent);
  $('production-voice-info').textContent=`本番の声：${state.settings.voice} ／ 高さ：${state.settings.pitch==='low'?'低め':state.settings.pitch==='high'?'高め':'標準'}${dirtyFields.has('settings')?'（選択中の変更はまだ未反映）':''}。`;
  $('generate-all').disabled=lock||sealed||!state.keyConfigured||!$('consent').checked||!ready.length;
  $('generate-all').textContent=`ナレーションを作成する（${ready.length}カット）`;
  $('generate-all').hidden=!ready.length;
  $('export').disabled=lock||hasCorrections()||!sealed||!state.video?.available||state.video?.running||!!state.video?.result||!state.rows.length||state.rows.some(r=>!r.reviewed||!r.audioCurrent||!isCutConfirmed(r));
  updateVideo();
  const active=state.busy||state.video?.running,canUndoReading=!sealed&&state.rows.some(r=>r.reviewed);if(!active&&cancelRequested){cancelRequested=false;$('cancel-status').textContent='中止処理が終了しました。保存済みの台本・素材・音声は保持しています。';}
  for(const button of document.querySelectorAll('[data-cancel]')){const inline=button.dataset.cancelInline!==undefined;button.disabled=!!(workflowPaused||pauseRequested||cancelRequested||state.video?.canceling||(!active&&(localBusy||inline)));button.textContent=cancelRequested||state.video?.canceling?'中止処理中…':active?'実行中の処理を中止':'制作を中断';if(inline)button.hidden=!active;}
  const readingDone=!!state.rows.length&&state.rows.every(r=>r.reviewed);$('unconfirm-script').hidden=!canUndoReading;$('unconfirm-script').disabled=!!(localBusy||active||sealed);
  $('generation-next').hidden=sealed||!readingDone||!state.keyConfigured||state.rows.every(r=>r.audioCurrent);$('generation-next').disabled=!!(localBusy||active||isDirty()||dirtyFields.has('settings'));
  $('reading-next').hidden=$('generation-next').hidden;
  $('generation-next').textContent='ナレーション作成へ進む →';
  $('generation-next-state').textContent=!readingDone?'読みの確定後に、音声作成へ進めます。':!$('consent').checked?'次の音声作成欄で送信・作成のチェックを入れると、合成できます。':'次の音声作成欄から、決定した声で合成できます。';
  const complete=!!state.rows.length&&state.rows.every(r=>r.reviewed&&r.audioCurrent);
  $('generation-tools').hidden=complete||sealed;
  $('generation-state').textContent=state.busy?`${state.progress?.phase||'ナレーションを作成中です。'}${state.progress?.completed||0} / ${state.progress?.total||0}カット。`:!state.rows.length?'先に台本を用意してください。':dirtyFields.has('settings')?'選択した声を決定してから、ナレーションを作成してください。':isDirty()?'編集内容を保存し、読みを確定してください。':state.rows.some(r=>!r.reviewed)?'全文の読みを確定してから、ナレーションを作成してください。':!state.keyConfigured?'画面上部でGemini APIキーを登録してください。':!$('consent').checked?'Googleへの送信・音声作成に同意すると、ナレーションを作成できます。':ready.length?`決定済みの声で${ready.length}カットの音声を作成します。完成後、各カットで画像と音声を確認できます。`:!complete?'修正したカット内の「音声を作り直す」で、必要な音声だけを更新してください。':'ナレーションは作成済みです。';
  $('play-full').hidden=!complete;$('confirm-full').hidden=!complete;$('full-listening-title').hidden=!complete;
  $('play-full').disabled=lock||!complete;
  $('confirm-full').disabled=lock||sealed||(state.production?.music&&!state.musicCurrent)||hasCorrections()||!complete||state.rows.some(r=>r.cutFingerprint===null)||(state.presentation?.mode==='ai'&&!state.presentation.design);
  syncWorkflow();
  if(fullPlayback&&(lock||fullPlayback.revision!==state.revision))stopFullAudio();
  $('handoff-info').textContent=sealed?'全カット最終確定済み・編集不可。この内容を動画へ渡せます。':hasCorrections()?'修正指示が残っています。指摘した箇所を直して確認してから、動画へ渡せます。':isDirty()?'編集中の内容を反映してから音声を渡してください。':!complete?'声・ピッチを選び、全文確認でナレーションを作成・試聴してください。':'全カットの画像・字幕・読み・音声を見直し、「すべて確認OK・動画を生成」で一括確定してください。';
  for(const b of document.querySelectorAll('[data-generate]')){const row=state.rows.find(r=>r.id===b.dataset.generate);b.hidden=!!row?.audioCurrent||sealed;b.disabled=lock||sealed||!state.keyConfigured||!$('consent').checked||!row?.reviewed;}
}
function render(next,force=false){state=next;let keyLost=false;try{keyLost=!state.keyConfigured&&window.sessionStorage?.getItem('narration-had-key')==='yes';if(state.keyConfigured)window.sessionStorage?.setItem('narration-had-key','yes');}catch{}$('key-reset-notice').hidden=!keyLost;if(lastKeyConfigured!==state.keyConfigured){$('api-settings').open=!state.keyConfigured&&!isFinalized();lastKeyConfigured=state.keyConfigured;}$('api-connection').classList.toggle('needs-key',!state.keyConfigured&&!isFinalized());$('api-summary').textContent=state.keyConfigured?'APIキーを変更・解除':'Gemini APIキーを登録';$('key-state').textContent=state.keyConfigured?'キー登録済み':'APIキー未設定';$('key-state').classList.toggle('ready',state.keyConfigured);$('review-count').textContent=`${state.rows.filter(r=>r.reviewed).length} / ${state.rows.length} 読み確認済み`;$('audio-count').textContent=`${state.rows.filter(r=>r.audioCurrent&&r.listenedCurrent).length} / ${state.rows.length} 試聴確認済み`;$('progress').textContent=state.busy?`${state.progress?.phase||'合成中'}：${state.progress?.completed||0} / ${state.progress?.total||0} カット（自動再試行なし）`:state.progress?`合成終了：${state.progress.completed} / ${state.progress.total} カット`:'';
  const signature=JSON.stringify(state.projects||[]);if(projectSignature!==signature){$('project-select').replaceChildren(...(state.projects||[]).map(p=>element('option',p.title+'（'+(p.finalized?'確定済み・閲覧':'編集中')+'）',{value:p.id})));projectSignature=signature;}$('project-select').value=state.projectId||'original';
  $('theme').value=screenTheme||state.presentation?.theme||'moon';applyTheme($('theme').value);
  if(!dirtyFields.has('design')&&!designPreviewOnly)$('design-instructions').value=state.presentation?.instructions||'';
  if((force||state.revision!==lastRevision)&&!isDirty()){
    $('job-title').value=state.title;$('slide-title').textContent=state.title;$('model').value=state.settings.model;$('voice').replaceChildren(...[...state.voices].sort(voiceCompare).map(v=>element('option',v+'（'+genderLabel(genderFor(v))+'）',{value:v})));$('voice').value=state.settings.voice;$('style').value=state.settings.style;$('pitch').value=state.settings.pitch||'standard';
    buildPresetMenu();syncVoicePreset();rowEditors.clear();cutImages.clear();$('rows').replaceChildren();if(!state.rows.length)$('rows').append(element('div','最初の「台本と素材」で台本を用意すると、ここに表示されます。',{class:'empty'}));
    state.rows.forEach((r,index)=>{
      const box=element('article',undefined,{class:'row','data-row-id':r.id}),head=element('div',undefined,{class:'row-head'});head.append(element('strong',String(index+1).padStart(2,'0')+'カット'),element('span',r.cutVisual?.title||r.scene||'ナレーション'),element('span',r.reviewed?'読み確認済み':'読み未確認'));box.append(head);const imageBox=element('figure',undefined,{class:'cut-image-box'});imageBox.hidden=true;cutImages.set(r.id,imageBox);box.append(imageBox);
      const captionParts=sentences(r.caption),speechParts=sentences(r.speech),pairs=[],editor={id:r.id,box,pairs,baseline:r};rowEditors.set(r.id,editor);if(r.audio){const preview=element('audio',undefined,{controls:'',preload:'metadata',src:'/audio/'+r.audio.file,'aria-label':`${index+1}カットの音声`,class:'cut-audio'});box.append(preview);if(!r.audioCurrent)box.append(element('p','修正前の音声です。本文の変更を反映するには再合成します。',{class:'help'}));}else box.append(element('p','このカットの音声はまだ作成されていません。',{class:'help'}));
      for(let n=0;n<Math.max(captionParts.length,speechParts.length);n++){
        const grid=element('div',undefined,{class:'row-grid sentence-pair'}),cap=element('textarea',undefined,{rows:2,'aria-label':`${index+1}場面・${n+1}文目の字幕`}),speech=element('textarea',undefined,{rows:2,'aria-label':`${index+1}場面・${n+1}文目の読み上げ文`});cap.value=captionParts[n]||'';speech.value=speechParts[n]||'';const pair={cap,speech,saved:{caption:cap.value,speech:speech.value},commit:element('button','この文の変更を保存',{type:'button',class:'secondary sentence-confirm','data-commit-sentence':r.id+':'+n})};pairs.push(pair);pair.commit.addEventListener('click',guarded(async()=>{await pending(async()=>{state=await api('status');await saveEditor(editor,pair);});message('この文の修正を保存しました。全文の読みは一括で確定できます。');}));grid.append(element('span',`${n+1}文目`,{class:'sentence-number'}));
        for(const [label,input]of [['字幕（表示用）',cap],['読み上げ文（ひらがな・音声用）',speech]]){const l=element('label',label);l.append(input);grid.append(l);input.addEventListener('input',()=>{box.dataset.dirty='true';approve.disabled=true;fitSentencePair(cap,speech);updateControls();});input.disabled=state.busy||isFinalized();}
        grid.append(pair.commit);box.append(grid);
      }
      if(captionParts.length!==speechParts.length)box.append(element('p','字幕と読みの文数が違います。前後の対応を確認して修正してください。',{class:'help'}));
      const uniqueHints=[...new Map(r.hints.map(h=>[h.kind+':'+h.term,h])).values()];if(uniqueHints.length){const disclosure=element('details',undefined,{class:'reading-hints'});disclosure.open=false;disclosure.append(element('summary',`読みの確認候補 ${uniqueHints.length}語`),element('p','読み間違いと判定した一覧ではありません。発音を確かめたい英字・数字・漢字です。読み上げ欄をひらがなに直すと候補は減ります。',{class:'help'}));const hints=element('div',undefined,{class:'hints'});for(const h of uniqueHints)hints.append(element('span',`${h.term} · ${h.kind==='latin'?'英字':h.kind==='number'?'数字':'漢字'}`,{class:'hint'}));disclosure.append(hints);box.append(disclosure);}
      const actions=element('div',undefined,{class:'row-actions'}),save=editor.save=element('button','変更を保存',{type:'button',class:'secondary'}),approve=editor.approve=element('button',r.reviewed?'読み確認済み':'このカットの読みを確認（音声作成前）',{type:'button',class:'secondary','data-approve':r.id});approve.disabled=r.reviewed||state.busy;save.disabled=state.busy||isFinalized();
      save.addEventListener('click',guarded(async()=>{await pending(async()=>{state=await api('status');await saveEditor(editor);});message('変更を保存しました。読みを確認し直してください。');}));
      approve.addEventListener('click',guarded(async()=>{await pending(async()=>{state=await api('status');await saveEditor(editor);render(await api('approve',{id:r.id,revision:state.revision}),true);});message('この場面の修正と読みを確定しました。');}));actions.append(save,approve);
      const instructionLabel=element('label','このカットへの修正指示'),instruction=editor.instruction=element('textarea',undefined,{rows:3,maxlength:2000,'aria-label':`${index+1}カットへの修正指示`,placeholder:'例：この名前の読みを直して。説明を短くして。画像を台本に合わせて。'});instruction.value=dirtyFields.has('review')?(cutInstructions.get(r.id)||''):(state.production?.review?.cuts?.find(c=>c.rowId===r.id)?.instruction||'');cutInstructions.set(r.id,instruction.value);instruction.addEventListener('input',()=>{cutInstructions.set(r.id,instruction.value);dirtyFields.add('review');updateControls();});instructionLabel.append(instruction);
      const applyCut=element('button','このカットの修正指示を送信・反映（API利用）',{type:'button',class:'secondary','data-apply-review':r.id});applyCut.addEventListener('click',guarded(()=>applyReview(r.id),'review-request-state'));
      if(r.attempts>0){const generate=element('button','このカットの音声を作り直す',{type:'button','data-generate':r.id,class:'secondary'});generate.addEventListener('click',guarded(async()=>{if(isDirty()||!$('consent').checked)throw new Error('GENERATION_CONSENT_REQUIRED');if(!window.confirm('このカットをGoogleへ再送し、追加の音声合成を1回行います。続けますか？'))return;await api('generate',{ids:[r.id],consent:$('consent').checked,regenerate:true});render(await api('status'),true);message('このカットの音声作成を開始しました。');}));actions.append(generate);}
      box.append(actions,instructionLabel,applyCut,element('p','修正指示は最後にまとめて反映できます。音声・画像を見直し、最後のボタンで全カットを一括確認します。',{class:'help'}));$('rows').append(box);for(const pair of pairs)fitSentencePair(pair.cap,pair.speech);
    });
    $('dictionary-list').replaceChildren(...state.dictionary.map((item,i)=>{const chip=element('span',`${item.term} → ${item.reading}`,{class:'dictionary-chip'}),remove=element('button','×',{type:'button','aria-label':`${item.term}を辞書から削除`});remove.addEventListener('click',guarded(async()=>render(await api('dictionary',{items:state.dictionary.filter((_,n)=>n!==i)}),true)));chip.append(remove);return chip;}));lastRevision=state.revision;
  }
  for(const id of ['model','voice','voice-preset','style','add-row','save-title','job-title','term','pronunciation','apply-dictionary'])$(id).disabled=state.busy||isFinalized();
  for(const id of ['api-key','clear-key'])$(id).disabled=state.busy;
  $('theme').disabled=state.busy||localBusy;updateCutImages();renderExtras();updateControls();
  if(state.error){message(errors[state.error.split(':')[0]]||state.error,true);}else if(wasBusy&&!state.busy&&!localBusy)message(state.progress?.phase?'修正処理が終了しました。変更したカットを見直してください。':state.rows.some(r=>r.audioCurrent)?'処理が終了しました。作成済みの音声は全文確認で試聴できます。':'処理が終了しました。');wasBusy=state.busy;
}
$('key-form').addEventListener('submit',guarded(async()=>{const key=$('api-key').value;$('api-key').value='';render(await api('key',{key}),true);$('api-settings').open=false;message('キーをメモリに設定しました。「API接続を確認（生成なし）」で認証とモデルを確認できます。');}));
$('clear-key').addEventListener('click',guarded(async()=>{const cleared=await api('key',{clear:true});try{window.sessionStorage?.setItem('narration-had-key','no');}catch{}render(cleared,true);message('キーを解除しました。');}));
for(const id of ['model','voice','style','pitch','job-title'])$(id).addEventListener('input',()=>{if(id==='job-title'){dirtyFields.add('title');$('title-mode').value='manual';}else{markSettingsDirty();$('voice-mode').value='manual';}dirtyFields.add('production');syncVoicePreset();refreshSampleAudio();updateControls();});
$('voice-preset').addEventListener('change',guarded(async()=>{const value=$('voice-preset').value;$('voice-mode').value='manual';dirtyFields.add('production');if(value==='custom'){customMode=true;syncVoicePreset();return;}const legacy=voicePresets[value];const config=legacy?{model:$('model').value,...legacy}:allPresets().find(p=>p.model+'::'+p.voice===value);if(!config)throw new Error('INVALID_VOICE_PRESET');customMode=false;$('model').value=config.model;$('voice').value=config.voice;$('style').value=config.style;markSettingsDirty();syncVoicePreset();refreshSampleAudio();updateControls();message('声と話し方を選びました。保存済みのサンプルを試聴し、「この声に決定する」で本番に反映します。');}));
$('settings-form').addEventListener('submit',guarded(async()=>{const next=await api('settings',selectedSettings());dirtyFields.delete('settings');render(next,true);message('この声に決定しました。全文確認でナレーションを作成し、画像と音声を確認してください。');}));
function editableJob(){return {title:$('job-title').value,settings:state.settings,dictionary:state.dictionary,rows:state.rows.map(({id,caption,speech,scene})=>({id,caption,speech,scene}))};}
$('add-row').addEventListener('click',guarded(async()=>{if(isDirty())throw new Error('先に編集内容を保存してください');const caption=window.prompt('追加する字幕・台本を入力してください。');if(!caption)return;const speech=window.prompt('読み上げ文をひらがなで入力してください。');if(!speech)return;render(await api('append-row',{id:'line-'+crypto.randomUUID(),caption,speech}),true);message('台本を追加しました。読み上げ文を確認してください。');}));
$('save-title').addEventListener('click',guarded(async()=>{const next=await api('title',{title:$('job-title').value});dirtyFields.delete('title');render(next,true);message('タイトルを反映しました。');}));
$('dictionary-form').addEventListener('submit',guarded(async()=>{const next=await api('dictionary',{items:[...state.dictionary,{term:$('term').value,reading:$('pronunciation').value}]});$('term').value='';$('pronunciation').value='';render(next,true);message('読み辞書に追加しました。');}));
$('apply-dictionary').addEventListener('click',guarded(async()=>{render(await api('apply-dictionary',{}),true);message('辞書を反映しました。変更された行を確認し直してください。');}));
$('consent').addEventListener('change',updateControls);
$('generate-all').addEventListener('click',guarded(async()=>{if(isDirty())throw new Error('STALE_REVISION');if(!$('consent').checked)throw new Error('GENERATION_CONSENT_REQUIRED');const ids=state.rows.filter(r=>r.reviewed&&!r.audioCurrent).map(r=>r.id);await api('generate',{ids,consent:$('consent').checked,regenerate:state.rows.some(r=>ids.includes(r.id)&&r.attempts>0)});render(await api('status'),true);message(`${ids.length}カットのナレーション作成を開始しました。`);}));
async function undoReading(){await pending(async()=>{const next=await api('unapprove',{revision:state.revision});$('consent').checked=false;render(next);});actionMessage('cancel-status','読みの確定を取り消しました。台本・素材・音声を保持して、編集に戻れます。');}
$('unconfirm-script').addEventListener('click',guarded(undoReading,'cancel-status'));
$('generation-next').addEventListener('click',()=>{$('generation-tools').scrollIntoView?.({block:'start'});$('consent').focus?.();message($('consent').checked?'ナレーション作成ボタンで合成できます。':'送信・音声作成のチェックを入れると、ナレーション作成ボタンを押せます。');});
for(const button of document.querySelectorAll('[data-cancel]'))button.addEventListener('click',guarded(async()=>{
 pauseStep=button.dataset.step||workflowSteps.find(step=>window.location.hash==='#'+step)||'planning';pauseRequested=true;stopFullAudio();artworkDrafts.clear();visualDrafts.clear();for(const media of document.querySelectorAll('audio,video'))media.pause();
 if(!state.busy&&!state.video?.running){syncWorkflow();updateControls();return;}
 cancelRequested=true;updateControls();try{render(await api('cancel',{}));actionMessage('cancel-status',state.busy||state.video?.running?'中止を要求しました。処理の終了を待ってから制作を中断します。':'処理を中止しました。台本・素材・音声は保持しています。');}catch(error){pauseRequested=false;cancelRequested=false;updateControls();throw error;}
},'cancel-status'));
$('resume-workflow').addEventListener('click',()=>{workflowPaused=false;try{window.sessionStorage?.removeItem('narration-paused:'+workflowProject);}catch{}updateControls();window.location.hash='#'+pauseStep;$(pauseStep).scrollIntoView?.({block:'start'});actionMessage('cancel-status','制作を再開しました。入力内容と確定状態はそのままです。');});
$('export').addEventListener('click',guarded(async()=>{if(isDirty()||hasCorrections()||!isFinalized())throw new Error('FINAL_CONFIRMATION_REQUIRED');await api('render-video',{revision:state.revision});render(await api('status'));message('動画生成を開始しました。進行状況と完成動画は、この画面に表示します。');}));
async function playFullPart(){if(!fullPlayback)return;const row=fullPlayback.rows[fullPlayback.index];$('full-audio').src='/audio/'+row.audio.file;$('full-audio').hidden=false;$('full-audio-info').textContent=`全文の試聴：${fullPlayback.index+1} / ${fullPlayback.rows.length}場面`;await $('full-audio').play();}
$('play-full').addEventListener('click',guarded(async()=>{if(isDirty()||state.busy||localBusy||!state.rows.length||state.rows.some(r=>!r.reviewed||!r.audioCurrent))throw new Error('AUDIO_REQUIRED');$('music-player').pause();fullPlayback={rows:state.rows,revision:state.revision,index:0};await playFullPart();}));
$('full-audio').addEventListener('ended',guarded(async()=>{if(!fullPlayback)return;if(isDirty()||state.revision!==fullPlayback.revision){stopFullAudio();return;}fullPlayback.index++;if(fullPlayback.index<fullPlayback.rows.length)await playFullPart();else{stopFullAudio();$('full-audio-info').textContent='全文の再生が終わりました。内容を確認して試聴確認を記録できます。';}}));
$('review-overall').addEventListener('input',()=>{dirtyFields.add('review');updateControls();$('review-request-state').textContent='修正指示：未保存';});
function currentReview(){return {version:1,sourceRevision:state.revision,overall:$('review-overall').value,cuts:state.rows.map(r=>({rowId:r.id,instruction:cutInstructions.get(r.id)||''})).filter(c=>c.instruction.trim())};}
async function applyReview(id){if(isDirty())throw new Error('STALE_REVISION');const review=currentReview();correctionOutcome='修正指示を送信・反映しています…';try{await pending(async()=>{const next=await api('apply-review',{review,id,expectedRevision:state.revision,consent:true});dirtyFields.delete('review');cutInstructions.clear();render(next,true);const ids=next.correctionResult.ids,ordered=state.rows.filter(r=>ids.includes(r.id)),numbers=ordered.map(r=>String(state.rows.indexOf(r)+1).padStart(2,'0')+'カット');correctionOutcome=numbers.join(' → ')+'を修正しました。変更した読みを確認し、必要な音声を作り直してから再試聴してください。';actionMessage('review-request-state',correctionOutcome);rowEditors.get(ordered[0]?.id)?.box.scrollIntoView?.({block:'start'});});}catch(error){correctionOutcome=errors[error.message.split(':')[0]]||'修正できませんでした。元の素材と指示は保持しています。';throw error;}}
$('apply-review').addEventListener('click',guarded(()=>applyReview(),'review-request-state'));
$('save-review').addEventListener('click',guarded(async()=>{await pending(async()=>{const review={version:1,sourceRevision:state.revision,overall:$('review-overall').value,cuts:state.rows.map(r=>({rowId:r.id,instruction:cutInstructions.get(r.id)||''})).filter(c=>c.instruction.trim())};const next=await api('review',{review,expectedRevision:state.revision});dirtyFields.delete('review');render(next);});message('修正指示を下書き保存しました。送信・反映ボタンでまとめて反映できます。');}));
$('clear-review').addEventListener('click',guarded(async()=>{await pending(async()=>{const next=await api('review',{review:{version:1,sourceRevision:state.revision,overall:'',cuts:[]},expectedRevision:state.revision});dirtyFields.delete('review');cutInstructions.clear();render(next);});message('修正指示を取り消しました。台本と音声はそのまま保持しています。');}));
$('confirm-script').addEventListener('click',guarded(async()=>{if(state.busy||localBusy)throw new Error('BUSY');const editors=[...rowEditors.values()],expected=editors.map(e=>({id:e.id,...editorText(e)}));await pending(async()=>{state=await api('status');for(const editor of editors){const current=state.rows.find(r=>r.id===editor.id);if(!current||!textMatches(current,editor.baseline))throw new Error('STALE_REVISION');}for(const editor of editors)await saveEditor(editor);state=await api('status');if(state.rows.length!==expected.length||expected.some(e=>{const row=state.rows.find(r=>r.id===e.id);return !row||!textMatches(row,e);}))throw new Error('STALE_REVISION');for(const row of expected)if(!state.rows.find(r=>r.id===row.id).reviewed)render(await api('approve',{id:row.id,revision:state.revision}),true);render(state,true);});message('全文の修正と読みを確定しました。音声の変更は再合成で反映できます。');}));
$('confirm-full').addEventListener('click',guarded(async()=>{if(isDirty()||hasCorrections()||state.busy||localBusy)throw new Error('STALE_REVISION');if(!window.confirm('全カットの画像・字幕・読み・音声・BGMを確認OKとして、動画を生成します。確定後はこの版は編集終了になります。後から修正版を作って各工程へ戻れます。続けますか？'))return;await pending(async()=>{for(const row of state.rows.filter(r=>!isCutConfirmed(r)))render(await api('confirm-cut',{id:row.id,revision:state.revision,fingerprint:row.cutFingerprint}),true);render(await api('finalize',{revision:state.revision,confirmIrreversible:true}),true);await api('render-video',{revision:state.revision});render(await api('status'),true);});window.location.hash='#finish';$('finish').scrollIntoView?.({block:'start'});message('全カットを確認OKとして動画生成を開始しました。ここで生成状況と完成動画を確認できます。');}));
$('theme').addEventListener('change',guarded(async()=>{const name=$('theme').value;if(isFinalized()){screenTheme=name;applyTheme(name);message('画面の配色を変更しました。完成済み動画はそのままです。');}else{screenTheme=undefined;render(await api('presentation',{theme:name}),true);message('配色を反映しました。');}}));
async function changeProject(route,input={}){
 if(isDirty()||dirtyFields.size)throw new Error('編集中の内容を保存してから切り替えてください');
 if(state.busy||localBusy||state.video?.running)throw new Error('BUSY');
 await pending(async()=>{
  const next=await api(route,{...input,sessionId:state.sessionId,revision:state.revision});const boot=await api('bootstrap');token=boot.token;instanceId=boot.instanceId;
  stopFullAudio();artworkDrafts.clear();visualDrafts.clear();for(const media of document.querySelectorAll('audio,video'))media.pause();
  for(const id of ['full-audio','video-player'])$(id).removeAttribute('src');$('full-audio').hidden=true;
  $('full-audio-info').textContent='';for(const id of ['consent','preview-consent','design-consent','bank-consent'])$(id).checked=false;
  dirtyFields.clear();correctionOutcome='';draftOutcome='';cancelRequested=false;scriptReadings=undefined;storyboard=undefined;$('save-status').textContent='指示・素材の使い方・台本案を保存します。APIは使いません。';cutInstructions.clear();designChoice=undefined;designPreviewOnly=false;customMode=false;screenTheme=undefined;lastRevision='';lastKeyConfigured=undefined;
  render(next,true);
 });
 message(route==='new-project'?'新しい動画を開始しました。デザイン、素材、台本を用意してください。':route==='revision-project'?'元の動画を残して修正版を開きました。音声は変更したカットだけ作り直せます。':'保存済みの動画へ切り替えました。');
 if(route==='new-project'){window.location.hash='#top';$('new-project').focus?.({preventScroll:true});window.scrollTo?.({top:0,left:0,behavior:'instant'});}
 else{window.location.hash='#planning';$('planning').scrollIntoView?.({block:'start'});}
}
$('new-project').addEventListener('click',guarded(async()=>changeProject('new-project')));
$('new-project-bottom').addEventListener('click',guarded(async()=>changeProject('new-project')));
$('revise-project').addEventListener('click',guarded(async()=>changeProject('revision-project')));
for(const button of document.querySelectorAll('[data-revise-step]'))button.addEventListener('click',guarded(async()=>{const step=button.dataset.reviseStep;if(isFinalized())await changeProject('revision-project');window.location.hash='#'+step;$(step).scrollIntoView?.({block:'start'});message('修正版でこの工程を編集できます。元の動画と音声は保持しています。');}));
$('project-select').addEventListener('change',guarded(async()=>{const id=$('project-select').value;if(id!==state.projectId)await changeProject('project',{id});}));
 $('design-mode').addEventListener('change',()=>{designChoice={...designChoice,mode:$('design-mode').value};designPreviewOnly=isFinalized();if(!isFinalized())dirtyFields.add('design');updateControls();});
 $('design-instructions').addEventListener('input',()=>{dirtyFields.add('design');updateControls();});
 $('design-consent').addEventListener('change',updateControls);
 $('apply-design').addEventListener('click',guarded(async()=>{await pending(async()=>{const next=await api('presentation',{revision:state.revision,presentation:{theme:state.presentation.theme,mode:'template',template:designChoice.template,motion:savedMotion()}});dirtyFields.delete('design');designPreviewOnly=false;render(next);});message('動画に使うデザインを決定しました。次は素材と台本を用意してください。');}));
 for(const id of ['motion-style','motion-intensity'])$(id).addEventListener('change',()=>{dirtyFields.add('motion');$('motion-preview').classList.remove('motion-playing');$('play-motion').textContent='動きの見本を再生';updateControls();});
 $('apply-motion').addEventListener('click',guarded(async()=>{await pending(async()=>{const next=await api('presentation',{revision:state.revision,presentation:{...state.presentation,motion:selectedMotion()}});dirtyFields.delete('motion');render(next);});message('演出を保存しました。台本・画像・音声の再生成はありません。');}));
 $('play-motion').addEventListener('click',()=>{const preview=$('motion-preview');if(preview.classList.contains('motion-playing')){preview.classList.remove('motion-playing');$('play-motion').textContent='動きの見本を再生';return;}preview.classList.add('motion-playing');$('play-motion').textContent='見本を停止';});
 $('motion-preview').addEventListener('animationend',event=>{if(event.animationName==='motion-orbit'){ $('motion-preview').classList.remove('motion-playing');$('play-motion').textContent='動きの見本を再生';}});
 $('draft-design').addEventListener('click',guarded(async()=>{designGenerating=true;try{await pending(async()=>{const next=await api('design-draft',{revision:state.revision,instructions:$('design-instructions').value,consent:$('design-consent').checked});dirtyFields.delete('design');designPreviewOnly=false;render(next);});message('AIが今回用に作ったデザインを保存しました。見本を確認できます。');}finally{designGenerating=false;updateControls();}}));
try{const boot=await api('bootstrap');token=boot.token;instanceId=boot.instanceId;themes=await api('themes');designs=await api('designs');buildDesignGallery();render(await api('status'),true);message(isFinalized()?'この動画は最終確定済みです。完成動画を再生・保存できます。':!state.keyConfigured?'画面上部でGemini APIキーを登録してください。':state.rows.length&&state.rows.every(r=>r.reviewed&&r.audioCurrent)?'各カットの画像と音声を確認してください。':state.rows.length?'台本と本番の声を確認して、ナレーションを作成してください。':'デザイン、素材、台本を用意してください。');setInterval(async()=>{try{const next=await api('status');if(next.instanceId!==instanceId){const fresh=await api('bootstrap');token=fresh.token;instanceId=fresh.instanceId;message('サーバーに再接続しました。未保存の編集は保持しています。APIキーは再入力してください。');}render(next);}catch{message('ローカルの接続が切れました。Codexにこの画面の再開を依頼してください。',true);}},2000);}catch{message('設定画面を読み込めません。ローカルサーバーの状態を確認してください。',true);}

function renderExtras(){
  const missing=missingPresets(),total=allSamplePresets().length,progress=state.sampleProgress,standard=allSamplePresets().filter(config=>!config.pitch||config.pitch==='standard'),standardSaved=standard.filter(config=>(state.samples||[]).some(s=>sameSettings(s.settings,config))).length;
  $('sample-progress').textContent=progress?.running?`サンプル準備：${progress.completed} / ${progress.total} · ${progress.settings?.voice||''} / ${progress.settings?.model?modelLabel(progress.settings.model):''} / ${progress.settings?.pitch==='low'?'低め':progress.settings?.pitch==='high'?'高め':'標準'}`:`保存済みサンプル：${total-missing.length} / ${total}件（標準 ${standardSaved}/${standard.length}・低め／高め ${total-missing.length-standardSaved}/${total-standard.length}）`;
  $('bank-tools').hidden=missing.length===0&&!progress?.running;
  $('prepare-samples').disabled=state.busy||localBusy||!state.keyConfigured||!$('bank-consent').checked||!missing.length;
  $('prepare-samples').textContent=`不足する${missing.length}件のサンプルを用意`;

  const production=state.production;
  if(!dirtyFields.has('review')){$('review-overall').value=production?.review?.overall||'';for(const [id,editor]of rowEditors){const note=production?.review?.cuts?.find(c=>c.rowId===id)?.instruction||'';cutInstructions.set(id,note);editor.instruction.value=note;}}$('review-request-state').textContent=state.busy&&state.progress?.phase?state.progress.phase:dirtyFields.has('review')?'修正指示：未保存':hasCorrections()?'修正指示：保存済み · 送信・反映ボタンで反映できます。':correctionOutcome||'修正指示はありません。';
  if(production&&!dirtyFields.has('production')){const b=production.brief;$('script-mode').value=b.scriptMode;$('asset-mode').value=b.assetMode;$('production-instructions').value=b.instructions;$('script-input').value=b.script||state.rows.map(r=>r.caption).join('\n');scriptReadings=b.readings;storyboard=b.storyboard;$('source-text').value=b.references?.text||'';$('source-urls').value=(b.references?.urls||[]).join('\n');$('title-mode').value=b.titleMode||'auto';$('voice-mode').value=b.voiceMode||'auto';renderStoryboard();}
  $('brief-state').textContent=dirtyFields.has('production')?'制作条件：未保存':'制作条件：保存済み';
  $('material-list').replaceChildren(...(production?.assets||[]).map(a=>element('a',a.name+' · '+(a.size/1024/1024).toFixed(2)+' MB',{href:'/materials/'+a.file,download:a.name})));
  refreshSampleAudio();
}
for(const id of ['source-text','source-urls','title-mode','voice-mode','script-mode','asset-mode','production-instructions','script-input'])$(id).addEventListener('input',()=>{dirtyFields.add('production');$('brief-state').textContent='制作条件：未保存';updateControls();});
$('preview-consent').addEventListener('change',updateControls);
$('bank-consent').addEventListener('change',()=>{renderExtras();updateControls();});
$('prepare-samples').addEventListener('click',guarded(async()=>{if(!$('bank-consent').checked)throw new Error('GENERATION_CONSENT_REQUIRED');const missing=missingPresets().length;await api('prepare-samples',{consent:true});render(await api('status'));if(!state.error)message(`不足する${missing}件のサンプルを準備しています。完成分は保存し、画面を移動しても処理を続けます。`);}));
$('voice').addEventListener('change',()=>{const demo=(state.samples||[]).filter(i=>i.settings.voice===$('voice').value&&(i.settings.pitch||'standard')===($('pitch').value||'standard')).sort((a,b)=>(a.settings.model===$('model').value?-1:1)-(b.settings.model===$('model').value?-1:1)||a.durationSeconds-b.durationSeconds)[0];if(demo){$('style').value=demo.settings.style;markSettingsDirty();syncVoicePreset();}refreshSampleAudio();updateControls();});
async function pending(action){localBusy=true;updateControls();try{return await action();}finally{localBusy=false;updateControls();}}
$('preview-voice').addEventListener('click',guarded(async()=>{const existing=cachedSample();if(existing){sampleAudio(existing.id);await $('sample-audio').play();return;}message('音声サンプルを1回合成しています。');await pending(async()=>{const result=await api('preview',{settings:selectedSettings(),consent:$('preview-consent').checked});render(await api('status'));sampleAudio(result.sample);message('サンプルを保存しました。次回はAPIを使わず再生できます。');});}));
$('save-production').addEventListener('click',guarded(async()=>{productionSaving=true;actionMessage('save-status','制作条件を保存しています…');try{await pending(async()=>{const next=await api('production',currentBrief());dirtyFields.delete('production');render(next);actionMessage('save-status','保存しました。指示・素材の使い方・台本案をこの動画に保存済みです。');});}finally{productionSaving=false;updateControls();}},'save-status'));
$('append-script').addEventListener('click',guarded(async()=>{
 if(document.querySelector('[data-dirty="true"]'))throw new Error('読み確認の編集を先に保存してください');if(dirtyFields.has('settings')||dirtyFields.has('title'))throw new Error('声・タイトルの編集を先に反映してください');
 if(!$('script-input').value.trim())throw new Error('台本を入力してください');
 await pending(async()=>{if(dirtyFields.has('production')){const next=await api('production',currentBrief());dirtyFields.delete('production');render(next);actionMessage('save-status','台本と制作条件を保存しました。');}if(!scriptAlreadyLoaded()||currentBrief().storyboard){const consent=readingPreparationNeeded();actionMessage('script-status',consent?'ひらがなの読みを準備しています…':'準備済みの台本と読みを取り込んでいます…');render(await api('append-script',{script:$('script-input').value,...(hasScriptReadings()?{readings:scriptReadings}:{}),consent}),true);}});
 actionMessage('script-status','この台本の読み確認へ移動します。字幕と読みを一文ずつ確かめてください。');window.location.hash='#reading';$('reading').scrollIntoView?.({block:'start'});
},'script-status'));
function renderStoryboard(){
 const box=$('storyboard-preview');box.replaceChildren();box.hidden=!storyboard;if(!storyboard)return;
 const voice=element('p',undefined,{class:'voice-proposal'});voice.append(element('strong','声の提案：'+storyboard.voice),element('span',storyboard.voiceReason));
 box.append(element('h3',storyboard.title),element('p',storyboard.summary),voice);
 for(const source of storyboard.sources)box.append(element('p',(source.status==='retrieved'?'URL取得済み':'送信した資料')+'：'+source.label+' — '+source.summary,{class:'help'}));
 for(const [i,scene]of storyboard.scenes.entries()){const card=element('article',undefined,{class:'storyboard-card'});card.append(element('strong',(i+1)+' / '+scene.title),element('p',scene.caption),element('p',scene.points.join(' ・ '),{class:'help'}),element('small','出典：'+scene.sourceIds.map(id=>storyboard.sources.find(s=>s.id===id)?.label||id).join(' / ')+(scene.imageFocus?' ｜ 注目：'+scene.imageFocus.label:'')+(scene.imagePrompt?' ｜ 新規生成予定：'+scene.imagePrompt:' ｜ 提供素材を採用')+(scene.imageReason?' ｜ '+scene.imageReason:'')));box.append(card);}
}
$('inspect-sources').addEventListener('click',guarded(async()=>{await pending(async()=>{actionMessage('source-inspect-status','同じ送信内容をトークン計数APIで検査しています…');const result=await api('source-inspect',{brief:currentBrief(),consent:true,revision:state.revision});actionMessage('source-inspect-status','送信内容のトークン計数が成功しました：'+result.totalTokens+'トークン。生成はしていません。');});},'source-inspect-status'));
$('check-connection').addEventListener('click',guarded(async()=>{await pending(async()=>{const result=await api('connection-check',{});actionMessage('connection-status',result.ready?'Geminiの接続と構成作成モデルの利用を確認しました。生成は行っていません。':'接続確認が完了していません。');});},'connection-status'));
$('probe-generation').addEventListener('click',guarded(async()=>{await pending(async()=>{actionMessage('connection-status','素材を含まない最小構成で生成を確認しています…');await api('generation-check',{consent:true});actionMessage('connection-status','最小構成の文章生成に成功しました。素材からの構成作成は別途確認が必要です。');});},'connection-status'));
$('plan-sources').addEventListener('click',guarded(async()=>{
 actionMessage('source-status','素材を送信し、構成・台本・演出を作成しています…');
 await pending(async()=>{const brief=currentBrief(),result=await api('source-plan',{brief,consent:true,revision:state.revision});
 $('script-input').value=result.script;scriptReadings=result.readings;storyboard=result.storyboard;dirtyFields.add('production');renderStoryboard();
 // Save the valid proposal before optional settings mutations; a failure never loses it.
 let next=await api('production',currentBrief());dirtyFields.delete('production');render(next);
 if(brief.titleMode==='auto'){next=await api('title',{title:storyboard.title});dirtyFields.delete('title');render(next);}
 if(brief.voiceMode==='auto'){next=await api('settings',{...state.settings,voice:storyboard.voice,style:styleForVoice(storyboard.voice)});dirtyFields.delete('settings');render(next,true);}
 actionMessage('source-status','素材から構成を作成しました。タイトル・声は変更できます。台本を確かめて読み確認へ進んでください。');});
},'source-status'));
$('draft-script').addEventListener('click',guarded(async()=>{draftGenerating=true;draftOutcome='';try{await pending(async()=>{const result=await api('draft',{brief:currentBrief(),consent:true});$('script-input').value=result.script;scriptReadings=result.readings;storyboard=undefined;renderStoryboard();dirtyFields.add('production');actionMessage('draft-status','字幕とひらがなの読みを作成しました。下の台本を編集し、読み確認へ進めます。');});}finally{draftGenerating=false;updateControls();}},'draft-status'));
async function uploadMaterials(files){await pending(async()=>{for(const file of files){if(file.size>100*1024*1024)throw new Error('ASSET_TOO_LARGE');message('素材をこのPCに保存しています：'+file.name);const response=await fetch('/api/material?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Narration-Token':token},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error);render(result);}message('素材を保存しました。Googleへのアップロードは行っていません。');});}
$('material-files').addEventListener('change',guarded(async()=>{await uploadMaterials($('material-files').files);$('material-files').value='';}));
$('material-drop').addEventListener('dragover',e=>{e.preventDefault();$('material-drop').classList.toggle('dragging',true);});
$('material-drop').addEventListener('dragleave',()=>$('material-drop').classList.toggle('dragging',false));
$('material-drop').addEventListener('drop',guarded(async e=>{ $('material-drop').classList.toggle('dragging',false);if(state.busy||localBusy)throw new Error('BUSY');await uploadMaterials(e.dataTransfer.files);}));
$('material-drop').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('material-files').click();}});

function updateBookendsControls(){
 const b=state.production?.bookends,signature=state.projectId+state.revision+JSON.stringify(b),busy=state.busy||localBusy||isFinalized();
 for(const id of ['opening-title','opening-speech','ending-label','ending-url','ending-owner','ending-seconds','save-bookends'])$(id).disabled=!!busy;
 if(!dirtyFields.has('bookends')&&$('bookends-tools').dataset.signature!==signature){
  $('bookends-tools').dataset.signature=signature;const row=state.rows.find(r=>r.id===b?.titleRowId);
  $('opening-title').value=row?.caption||state.title.replace(/(?:（修正版）)+$/u,'');$('opening-speech').value=row?.speech||'';
  $('ending-label').value=b?.endLabel||'';$('ending-url').value=b?.endUrl||'';$('ending-owner').value=b?.owner||'';$('ending-seconds').value=String(b?.endSeconds||4);
 }
 $('bookends-status').textContent=b?'ED右下：'+b.endLabel+' / '+b.endUrl+' / @'+b.creationYear+'/'+b.owner+'（作成年は保存済み）':'作成年を自動保存し、@作成年/作者名 をED右下に表示します。';
}
for(const id of ['opening-title','opening-speech','ending-label','ending-url','ending-owner','ending-seconds'])$(id).addEventListener('input',()=>{dirtyFields.add('bookends');updateControls();});
$('save-bookends').addEventListener('click',guarded(async()=>{
 const input={title:$('opening-title').value,speech:$('opening-speech').value,endLabel:$('ending-label').value,endUrl:$('ending-url').value,owner:$('ending-owner').value,endSeconds:Number($('ending-seconds').value),revision:state.revision,productionRevision:state.productionRevision};
 await pending(async()=>{const next=await api('bookends',input);dirtyFields.delete('bookends');render(next,true);});message('タイトルとEDを保存しました。新しいタイトルの読みを確認してください。');
}));
function updateMusicControls(){
 const busy=state.busy||localBusy||isFinalized(),ready=state.rows.length&&state.rows.every(r=>r.reviewed&&r.audioCurrent),music=state.production?.music;
 $('cut-pause').disabled=!!busy;$('cut-pause').value=String(state.production?.pauseSeconds??7/30);
 $('generate-music').disabled=busy||!ready||!state.keyConfigured;$('music-direction').disabled=busy;$('music-level').disabled=busy||!state.musicCurrent;$('remove-music').disabled=busy;$('reuse-music').hidden=!music||state.musicCurrent;$('reuse-music').disabled=busy||!ready;
 if(!music&&$('music-player').dataset.signature){$('music-player').pause();$('music-player').src='';delete $('music-player').dataset.signature;}
 $('generate-music').textContent=music?'BGMを作り直す（API 1回）':'内容に合うBGMを作る（API 1回）';$('music-result').hidden=!music;
 $('music-create-label').textContent=music?'BGMを作り直す':'BGMを作成する';
 const musicKey=music?.file||'';if($('music-create').dataset.music!==musicKey){$('music-create').open=!music;$('music-create').dataset.music=musicKey;}
 if(music){const signature=state.projectId+music.file+state.musicCurrent;if($('music-player').dataset.signature!==signature){$('music-player').dataset.signature=signature;$('music-player').pause();if(state.musicCurrent)$('music-player').src='/api/music-audio?file='+music.file;else $('music-player').removeAttribute('src');}$('music-level').value=String(music.level);}
 $('music-status').textContent=music?(state.musicCurrent?'BGMを準備しました。原曲 '+music.durationSeconds.toFixed(1)+'秒 → 動画の長さに合わせて使用します。':'台本か音声が変わったため、このBGMは確定できません。今のBGMを使うか、作り直すかを選んでください。'):ready?'BGMはまだありません。作成ボタンを押すとGoogleに台本と長さを送信します。':'先にナレーションを作成すると、その長さに合わせてBGMを作れます。';
}
$('generate-music').addEventListener('click',guarded(async()=>{if(isDirty()||hasCorrections())throw new Error('STALE_REVISION');if(!window.confirm('現在の台本・音声の長さ・BGMの希望をGoogleへ送り、Lyria 3.5で1曲作成します。APIを1回使用します。'))return;await pending(async()=>{message('動画に合うBGMを生成しています…');render(await api('generate-music',{direction:$('music-direction').value,revision:state.revision,productionRevision:state.productionRevision,consent:true}),true);});message('BGMができました。原曲を試聴してから動画を確定してください。');}));
$('music-level').addEventListener('change',guarded(async()=>{const level=Number($('music-level').value);await pending(async()=>render(await api('music',{level,revision:state.revision,productionRevision:state.productionRevision}),true));}));
$('reuse-music').addEventListener('click',guarded(async()=>{if(isDirty()||hasCorrections())throw new Error('STALE_REVISION');await pending(async()=>render(await api('music',{reuse:true,revision:state.revision,productionRevision:state.productionRevision}),true));}));
$('remove-music').addEventListener('click',guarded(async()=>{await pending(async()=>render(await api('music',{remove:true,revision:state.revision,productionRevision:state.productionRevision}),true));}));

$('cut-pause').addEventListener('change',guarded(async()=>{const seconds=Number($('cut-pause').value);await pending(async()=>render(await api('cut-pause',{seconds,revision:state.revision,productionRevision:state.productionRevision}),true));message('カット間の余白を保存しました。音声・BGMは再利用します。');}));

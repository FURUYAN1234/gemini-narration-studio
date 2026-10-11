import {scriptActionState,parseScriptParts} from './script-flow.mjs';
import {fitText} from './motion.mjs';
const $=id=>document.getElementById(id);
let state,token,instanceId,themes=[],designs=[],designChoice,designPreviewOnly=false,designGenerating=false,lastRevision='',wasBusy=false,localBusy=false,lastKeyConfigured,customMode=false,screenTheme;
const dirtyFields=new Set();
let planningAdvancing=false,activeRequest=null,projectChanged=false;
const activityRoutes={draft:['planning','台本と読みを作成しています…'],'source-plan':['planning','参考資料から台本と画像を準備しています…'],'prepare-readings':['reading','読み候補を準備しています…'],'design-draft':['planning','見た目を考えています…'],preview:['connection','声のサンプルを作成しています…'],'prepare-samples':['connection','声のサンプルを準備しています…'],'generate-image':['reading','画像を作成しています…'],'regenerate-image':['reading','画像を作り直しています…'],'plan-images':['reading','画像の割り当てを考えています…'],'prepare-images':['reading','画像を準備しています…'],'apply-review':['reading','修正指示を反映しています…'],generate:['reading','音声・動画の作成を開始しています…'],'generate-music':['reading','BGMを作成しています…']};
let scriptEdited=false,scriptDraftVersion=0;
function aiThemeEnabled(){return $('theme-auto').checked&&$('script-mode').value==='ai';}
let productionBaseline,directionProposal,directionPending=false,advanceAfterAudio=false,retryBaseline;
function retrySignature(){return JSON.stringify({project:state.projectId,revision:state.revision,productionRevision:state.productionRevision,settings:selectedSettings(),ids:state.rows.filter(r=>!r.audioCurrent).map(r=>r.id),music:musicEnabled(),musicCurrent:state.musicCurrent,musicDirection:''});}
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
function syncVoicePreset(){const s=selectedSettings(),manual=$('voice-mode').value==='manual';if(s.style!==styleForVoice(s.voice))customMode=true;$('voice-manual').checked=manual;$('manual-voice-settings').hidden=!manual;$('voice-preset').value=customMode?'custom':s.model+'::'+s.voice;$('custom-settings').hidden=!manual||!customMode;$('model-info').textContent='選択中の声：'+s.voice+'（'+genderLabel(genderFor(s.voice))+'） ／ '+modelLabel(s.model)+' ／ 高さ：'+(s.pitch==='low'?'低め':s.pitch==='high'?'高め':'標準')+(customMode?' ／ カスタマイズ':'');}
function buildPresetMenu(){const groups=[];for(const gender of ['male','female','unknown'])for(const model of (state.models||['gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts'])){const voices=state.voices.filter(voice=>genderFor(voice)===gender).sort(voiceCompare);if(!voices.length)continue;const group=element('optgroup',undefined,{label:genderLabel(gender)+'の声 / '+modelLabel(model)});for(const voice of voices)group.append(element('option',voice+'（'+genderLabel(gender)+'） — '+summaryForVoice(voice)+' ['+(model.includes('lite')?'Flash-Lite':'Flash')+']',{value:model+'::'+voice}));groups.push(group);}$('voice-preset').replaceChildren(...groups,element('option','カスタマイズ — モデル・声・話し方を自由に設定',{value:'custom'}));}

function applyTheme(name){const t=themes.find(t=>t.name===name);if(!t)return;const root=document.documentElement;root.style.setProperty('--bg',t.background);root.style.setProperty('--fg',t.heading);root.style.setProperty('--accent',t.accent);root.style.setProperty('--muted',t.name==='white'?'#536072':'#b4c5c8');root.style.setProperty('--border',t.name==='white'?'#cad3dc':'rgba(180,207,217,.22)');root.style.setProperty('--panel',t.name==='white'?'rgba(30,60,100,.035)':'rgba(255,255,255,.045)');root.style.colorScheme=t.name==='white'?'light':'dark';}
const errors={SOURCE_URL_UNSAFE:'参考URLが安全な公開URLとして確認できませんでした。内部アドレスや認証付きURLは取得しません。',SOURCE_URL_FETCH_FAILED:'参考URLの公開本文を取得できませんでした。台本APIへの送信は行っていません。',SOURCE_URL_DNS_FAILED:'参考URLの接続先を確認できませんでした。台本APIへの送信は行っていません。',SOURCE_URL_TIMEOUT:'参考URLの取得が時間内に完了しませんでした。台本APIへの送信は行っていません。',SOURCE_URL_EMPTY:'参考URLから利用できる公開本文を取得できませんでした。有料・ログイン部分は取得しません。',SOURCE_URL_UNSUPPORTED:'この参考URLの本文形式には対応していません。台本APIへの送信は行っていません。',SOURCE_URL_CONTENT_LIMIT:'参考URLの公開本文が取得上限を超えています。台本APIへの送信は行っていません。',SOURCE_URL_REDIRECT_LIMIT:'参考URLの転送回数が上限を超えています。台本APIへの送信は行っていません。',TITLE_READING_REQUIRED:'AIから有効なタイトルの読みが返りませんでした。保存済みの制作は保持しています。',IMAGE_PREPARATION_REQUIRED:'台本に対応する画像の準備が終わっていません。失敗した画像だけを再開してください。',IMAGE_APPROVAL_REQUIRED:'未採用の画像があります。各カットの実画像を確認して採用してください。',IMAGE_CANDIDATE_REQUIRED:'画像を先に準備し、実画像を確認してから採用してください。',PROVIDER_INVALID_RESPONSE:'Googleの応答を台本データとして読み取れませんでした。入力は保持しています。詳細を確認してください。自動再試行はしません。',PROVIDER_EMPTY_TEXT:'Googleから台本文が返りませんでした。入力は保持しています。自動再試行はしません。',INVALID_BOOKENDS:'冒頭タイトルの設定を確認してください。',STALE_BOOKENDS:'冒頭タイトルの対応が変わっています。保存した制作を開き直してください。',TITLE_IMAGE_NOT_ALLOWED:'タイトル画面は文字と背景で構成します。画像の割り当ては本編で行ってください。',INVALID_CUT_PAUSE:'カット間の長さは0〜3秒の範囲で指定してください。',STALE_MUSIC:'BGMが現在の台本・音声に対応していません。「動画を作成」で更新してください。',IMAGE_GENERATION_NOT_ALLOWED:'画像生成を使うには制作条件を「提供素材から選び、不足する絵をAIで補う」に変更してください。',IMAGE_PROMPT_REQUIRED:'生成する画像の内容を入力してください。',INVALID_IMAGE_REFERENCES:'参照画像は登録済みの画像から3枚まで選んでください。',MUSIC_DECODE_FAILED:'生成されたBGMを音声として検証できませんでした。素材は保存しています。自動再生成はしません。',INVALID_MUSIC:'BGMの出力または設定が不正です。元の内容を保持しています。',PROVIDER_MUSIC_REQUIRED:'GoogleからBGM音声が返りませんでした。自動再試行はしません。',PROVIDER_INCOMPLETE_MUSIC:'GoogleのBGM生成が完了しませんでした。',PROVIDER_IMAGE_REQUIRED:'Googleから画像が返りませんでした。',PROVIDER_INCOMPLETE_IMAGE:'Googleの画像生成が完了しませんでした。',PROVIDER_OUTPUT_FORMAT_REJECTED:'Googleが出力形式の指定を拒否しました。アプリの送信設定を修正する必要があります。',PROVIDER_INVALID_API_KEY:'GoogleがAPIキーを無効または期限切れと判定しました。アプリ上部で有効なGemini APIキーを設定してください。',PROVIDER_KEY_RESTRICTED:'APIキーの利用元またはAPIの制限により拒否されました。Google側のキー制限を確認してください。',PROVIDER_SERVICE_DISABLED:'このGoogleプロジェクトで必要なAPIが無効です。',PROVIDER_BILLING_DISABLED:'Google側で請求設定が無効と報告されました。',PROVIDER_SCHEMA_REJECTED:'Googleが出力データのスキーマを拒否しました。送信形式の修正が必要です。',PROVIDER_MEDIA_REJECTED:'Googleが画像・メディアの形式を拒否しました。',PROVIDER_REQUEST_TOO_LARGE:'Googleがリクエスト容量の超過を報告しました。',REFERENCE_REQUIRED:'画像・TXTなどの資料、参考本文、またはURLを入れてください。',INVALID_REFERENCES:'参考本文・URLの形式または件数を確認してください。',INVALID_REFERENCE_URL:'公開されたHTTP/HTTPSのURLを入れてください。認証情報・鍵付きURL・ローカルURLは使えません。',SOURCE_SIZE_LIMIT:'送信する素材が合計12MBを超えています。小さくしてから実行してください。',SOURCE_COUNT_LIMIT:'一度に送る素材は20件までです。',SOURCE_URL_NOT_RETRIEVED:'参考URLの取得成功を確認できませんでした。取得できたふりをせず、構成の適用を止めています。本文を貼る方法も使えます。再実行にはAPIを使います。',SOURCE_NOT_ANALYZED:'読み取れなかった資料があります。資料を確認してください。自動再試行はしません。',INVALID_STORYBOARD:'AIの構成データが条件に合いませんでした。前の内容は残っています。',INVALID_IMAGE_FOCUS:'画像の注目位置が範囲外です。',HIRAGANA_READING_REQUIRED:'読み上げ文に漢字・カタカナ・英字・数字が残っています。ひらがなの読みが必要です。',READING_PREPARATION_REQUIRED:'この台本のひらがなの読みを先に用意してください。',INVALID_SCRIPT_READINGS:'字幕と読みの組み合わせが不正です。',STALE_SCRIPT_READINGS:'字幕が変更されたため、その読みを引き継げません。',READING_SENTENCE_MISMATCH:'字幕と読みの文数が一致しません。',GENERATION_CONSENT_REQUIRED:'Googleへの送信・音声作成への同意を確認してください。',VIDEO_FINALIZED:'全カットを最終確定済みです。この動画はこの版は編集終了になります。後から修正版を作って各工程へ戻れます。',FINAL_CONFIRMATION_REQUIRED:'全カットの最終確定を行ってください。',FINALIZED_CONTENT_CHANGED:'最終確定後の内容が変更されています。動画への引き渡しを中止します。',CUT_LOCKED:'このカットは確定済みです。「編集する」で解除してから修正してください。',CUT_CONFIRMATION_REQUIRED:'画像と音声を確認し、カットを確定してください。',STALE_CUT_REVIEW:'カットの画像か音声が更新されました。最新の内容を確認してください。',CUT_IMAGE_REQUIRED:'このカットで使用する画像を準備・割り当ててください。',INVALID_CUT_IMAGE:'画像素材を選択してください。',CUT_IMAGE_AMBIGUOUS:'このカットの画像が複数あります。使用画像を一つに指定してください。',CORRECTIONS_PENDING:'修正指示が残っています。指摘した箇所を直してから動画へ渡してください。',API_KEY_REQUIRED:'APIキーを設定してください。',READING_REVIEW_REQUIRED:'未確認の読みが残っています。各行の読みを確認してください。',STALE_REVISION:'台本が更新されました。最新の内容を確認し直してください。',AUDIO_REQUIRED:'現在の台本・声に対応する音声がありません。',AUDIO_LISTEN_REQUIRED:'生成した音声を試聴して、確認済みにしてください。',REGENERATION_CONFIRM_REQUIRED:'再合成には、その行の再合成ボタンを使ってください。',PROVIDER_AUTH_FAILED:'Googleで認証に失敗しました。APIキーを確認してください。',PROVIDER_PERMISSION_DENIED:'Googleがアクセスを拒否しました。キーの権限・プロジェクト設定を確認してください。',PROVIDER_RATE_LIMIT:'Googleの利用上限に達しました。利用枠とクォータを確認してください。',PROVIDER_BAD_REQUEST:'Googleがリクエストを受け付けませんでした。モデルと設定を確認してください。',PROVIDER_MODEL_NOT_FOUND:'指定モデルをGoogleで利用できません。提供状況を確認してください。',PROVIDER_NETWORK_FAILED:'Googleへの接続に失敗しました。',PROVIDER_TIMEOUT:'Googleの応答待ちが時間切れになりました。',CANCELED:'合成を中止しました。完成済みの音声は保持しています。',BUSY:'音声合成中です。終了するまでお待ちください。',CREDENTIAL_IN_TEXT:'台本にAPIキーらしい文字列があります。削除してください。',MARKUP_OR_CONTROL_IN_TEXT:'読み上げ文にはタグや制御文字を入れないでください。'};
Object.assign(errors,{MANUAL_CUT_EDITOR_REQUIRED:'手動カット追加は③のカット編集欄を使ってください。',SCRIPT_REQUIRED:'台本の本文を入力してください。',SCRIPT_ADOPTION_REQUIRED:'変更した台本を①で採用してから進んでください。',REFERENCE_IN_SCRIPT:'URLだけの場合は参考URL欄へ入力してください。',SCRIPT_OPERATION_NOT_ALLOWED:'この方法ではAI台本作成を使いません。台本を手入力するか、作り方を選び直してください。',VOICE_CONFIRMATION_REQUIRED:'②で本番の声を決定してください。',DRAFT_REQUEST_CONFLICT:'この送信は古いか内容が変わっています。現在の入力を確認してください。',DRAFT_RESULT_REQUIRED:'この作成では利用できる台本が返りませんでした。入力は保持しています。',ADOPTION_CONFLICT:'保存済みの台本採用と現在の編集が競合しています。現在の台本は保持しています。',UNSAVED_READING_EDIT:'カットの編集を保存してから読みの準備を実行してください。',EMPTY_INSTRUCTIONS:'資料・テーマ・指示を入力するか、テーマをAIに任せるを選んでください。',INVALID_STORYBOARD_IMAGE:'画像の割り当て案が条件に合いません。現在の台本は保持しています。',SCRIPT_REQUIRED:'上の台本案生成ボタンで作るか、台本を入力してください。',INVALID_AUTOMATIC_DIRECTION:'自動演出の選択結果を検証できませんでした。前の台本と設定は保持しています。',EMPTY_CORRECTION:'修正指示を入力してください。',INVALID_CORRECTION_RESULT:'修正結果の形式が不正なため、反映しませんでした。指示と元の音声・画像は保持しています。',INVALID_CORRECTION_IMAGE:'修正画像を検証できないため、反映しませんでした。',CORRECTION_IMAGE_TOO_LARGE:'修正元の画像が大きすぎます。15MB以下の画像を選んでください。',DESIGN_REQUIRED:'AIデザインを作成してから最終確定してください。',INVALID_DESIGN:'デザイン案に使えない色・配置が含まれているため、保存しませんでした。',INVALID_DESIGN_CONTRAST:'デザイン案の文字が読みづらいため、保存しませんでした。',INVALID_TEMPLATE:'選んだテンプレートを確認してください。',BUSY:'ほかの作成処理が終わるまでお待ちください。'});
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
async function api(route,data){if(data!==undefined&&projectChanged)throw new Error('PROJECT_CHANGED');if(data!==undefined&&!state?.keyConfigured&&['draft','source-plan','prepare-readings','design-draft','source-inspect','generation-check','generate-image','apply-review','prepare-images','regenerate-image','plan-images','generate','prepare-samples'].includes(route))throw new Error('API_KEY_REQUIRED');const previousProductionRevision=state?.productionRevision;if(route==='production')data={...data,productionRevision:productionBaseline??state.productionRevision};const activity=data!==undefined&&activityRoutes[route]?{stage:activityRoutes[route][0],phase:activityRoutes[route][1]}:null;if(activity){activeRequest=activity;updateActivityProgress();}try{const res=await fetch('/api/'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify(data)});const value=await res.json();if(!res.ok)throw new Error(value.error||'REQUEST_FAILED');if(route==='production')productionBaseline=undefined;else if(route==='music-preference'&&productionBaseline===previousProductionRevision)productionBaseline=value.productionRevision;return value;}finally{if(activity&&activeRequest===activity){activeRequest=null;updateActivityProgress();}}}
function actionMessage(id,text,error=false){if(id==='draft-status')draftOutcome=text;$(id).textContent=text;$(id).classList.toggle('error',error);message(text,error);}
function guarded(action,statusId){return async event=>{event?.preventDefault();try{await action(event);}catch(error){const code=error.message.split(':')[0],text=code==='PROJECT_CHANGED'?'別のタブで制作が切り替わっています。この画面の入力は保持し、別の制作への送信を止めました。':code==='API_KEY_REQUIRED'?'APIキーが未登録です。登録してからAPI利用を実行してください。':errors[code]||'処理できませんでした：'+error.message;if(code==='API_KEY_REQUIRED'){$('api-settings').open=true;$('api-connection').scrollIntoView?.({block:'start'});$('api-key').focus();$('api-required-message').textContent=text;$('api-required-alert').hidden=false;}if(statusId)actionMessage(statusId,text,true);else message(text,true);}};}
function element(tag,text,attrs={}){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
function isDirty(exceptVisual,ignoreAutomaticVoice=false){return [...visualDrafts].some(([id,d])=>id!==exceptVisual&&d.dirty)||dirtyFields.has('bookends')||dirtyFields.has('settings')&&!(ignoreAutomaticVoice&&automaticVoiceChoice())||dirtyFields.has('title')||dirtyFields.has('design')||dirtyFields.has('motion')||!!document.querySelector('[data-dirty="true"]');}
function automaticVoiceChoice(){const p=currentVoiceProposal();return $('voice-mode').value==='auto'&&p&&sameSettings(selectedSettings(),{model:state.settings.model,voice:p.voice,style:styleForVoice(p.voice),pitch:'standard'});}
function hasUserEdits(){return isDirty(undefined,true)||[...dirtyFields].some(field=>field!=='settings'||!automaticVoiceChoice());}
function projectHasContent(){const b=state.production?.brief;return !!(state.rows.length||state.production?.assets?.length||b?.script?.trim()||b?.instructions?.trim()||b?.references?.text?.trim()||b?.references?.urls?.length);}
function selectedMotion(){const saved=savedMotion(),style=$('motion-style').value;return style==='off'?null:{version:1,style,intensity:$('motion-intensity').value,...(saved?.style===style?Object.fromEntries(['transitions','transitionTones'].filter(k=>saved[k]).map(k=>[k,[...saved[k]]])):{})};}
function savedMotion(){return Object.hasOwn(state.presentation||{},'motion')?state.presentation.motion:state.presentation?.design?.motion||null;}
function updateMotion(){
 const saved=savedMotion(),locked=state.busy||localBusy||state.video?.running||isFinalized();
 if(!dirtyFields.has('motion')){$('motion-style').value=saved?.style||'off';$('motion-intensity').value=saved?.intensity||'standard';}
 const selected=selectedMotion(),same=JSON.stringify(selected)===JSON.stringify(saved);
 if(same&&!(dirtyFields.has('motion')&&!Object.hasOwn(state.presentation||{},'motion')))dirtyFields.delete('motion');
 $('explain-scenes').checked=state.presentation?.explainScenes==='auto';$('explain-scenes').disabled=locked;
 $('motion-style').disabled=locked;$('motion-intensity').disabled=locked||!selected;$('apply-motion').disabled=locked||same;
 $('apply-motion').textContent=same?'この演出に決定済み':'この演出を使う';$('play-motion').disabled=!selected;
 $('apply-motion').hidden=true;$('save-title').hidden=false;$('save-production').hidden=false;$('draft-script').hidden=true;$('motion-status').textContent=isFinalized()?'確定済みの演出は変更できません。「ここから修正」で別の制作として変更できます。':same?(saved?'この演出で動画を作ります。台本と音声はそのまま使います。':'従来の表示です。演出を選ぶと、次のSTEPへ進む際に保存します。'):'選択した演出は次のSTEPへ進むと保存します。';
 const preview=$('motion-preview');preview.setAttribute('data-style',selected?.style||'off');preview.style.setProperty('--motion-distance',selected?.intensity==='subtle'?'12px':selected?.intensity==='bold'?'50px':'28px');
 const d=state.presentation?.design||designs.find(t=>t.id===state.presentation?.template)?.design||designs.find(t=>t.id==='cinema')?.design;
 if(d)for(const [key,value]of Object.entries({bg:d.background,fg:d.heading,accent:d.accent}))preview.style.setProperty('--motion-'+key,value);
 const row=state.rows[0];$('motion-preview-title').textContent=row?.cutVisual?.title||row?.scene||state.title||'文字と画像を動かす';
 const file=row?.cutImage?.file,art=$('motion-preview-art');if(art.dataset.file!==(file||'')){art.replaceChildren();art.dataset.file=file||'';if(file)art.append(element('img',undefined,{src:'/materials/'+file,alt:''}));}
}
function renderPreviewDesign(presentation){
 if(presentation?.mode==='ai')return presentation.design;
 if(presentation?.mode==='template')return designs.find(d=>d.id===presentation.template)?.design;
 const palette=themes.find(t=>t.name===presentation?.theme);return palette?{...palette,layout:'split',decoration:'none',imageSide:'right',radius:0,imageRatio:.45,titleSize:72}:undefined;
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
 $('apply-design').hidden=true;$('apply-design').disabled=lock||sealed||decided;
 $('apply-design').textContent=decided?'このデザインに決定済み':'このデザインに決定する';
 $('design-instructions').disabled=lock||sealed;$('design-consent').disabled=lock||sealed;
 $('draft-design').disabled=lock||sealed||!state.keyConfigured||!$('design-consent').checked||!$('design-instructions').value.trim();
 $('draft-design').textContent=designGenerating?'デザインを作成中…':'AIでデザインを作って使う';
 const applied=saved.mode==='ai'?saved.design?.name||'AIデザイン未作成':saved.mode==='template'?designs.find(t=>t.id===saved.template)?.name:'標準デザイン（既存設定）';
 $('design-selection').textContent=sealed?'この動画は最終確定済みです。見本の比較だけできます。':dirtyFields.has('design')?'選択した見本は次のSTEPへ進むと保存します。':'動画に使うデザイン：'+applied;
}
function isCutConfirmed(row){return !!(row?.cutConfirmed??row?.listenedCurrent);}
function isFinalized(){return !!state.production?.finalization;}
function hasGenerationOutput(){return !!(state.video?.running||state.video?.result||state.video?.error||state.video?.stage&&state.video.stage!=='idle'||isFinalized());}
function selectedSettings(){return {model:$('model').value,voice:$('voice').value,style:$('style').value,pitch:$('pitch').value||'standard'};}
function markSettingsDirty(){if(sameSettings(selectedSettings(),state.settings))dirtyFields.delete('settings');else dirtyFields.add('settings');}
function scriptParts(){return $('script-input').value.split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);}
function hasScriptReadings(){const parts=scriptParts();return !!parts.length&&scriptReadings?.length===parts.length&&scriptReadings.every((r,i)=>r.caption===parts[i]);}
function readingPreparationNeeded(){return !scriptAlreadyLoaded()&&!hasScriptReadings()&&scriptParts().some(s=>!/[ぁ-ゖ]/u.test(s)||/[^ぁ-ゖー\p{P}\s\u3099\u309a]/u.test(s));}
function automaticDirectionEnabled(){return $('script-mode').value!=='existing'&&$('auto-direction').checked;}
function currentBrief(){return {...(state.production?.brief.titleReading?{titleReading:state.production.brief.titleReading}:{}),...(scriptEdited?{scriptEdited:true}:{}),...(aiThemeEnabled()?{themeAuto:true}:{}),autoDirection:automaticDirectionEnabled(),...(!directionPending&&directionProposal&&scriptParts().join('\n')===parseScriptParts(state.production?.brief?.script).join('\n')?{direction:directionProposal}:{}),...(state.production?.brief?.sourceEvidence?{sourceEvidence:state.production.brief.sourceEvidence}:{}),scriptMode:$('script-mode').value,assetMode:$('asset-mode').value,instructions:aiThemeEnabled()?'':$('production-instructions').value,script:$('script-input').value,references:{text:$('source-text').value,urls:$('source-urls').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)},titleMode:automaticDirectionEnabled()?'auto':'manual',voiceMode:$('voice-mode').value,...(storyboard&&storyboard.scenes.map(r=>r.caption).join('\n')===scriptParts().join('\n')?{storyboard}:{}),...(hasScriptReadings()?{readings:scriptReadings}:{})};}
function musicEnabled(){return true;}
async function enableAutomaticMusic(){if(state.production?.musicEnabled!==true)render(await api('music-preference',{enabled:true,revision:state.revision,productionRevision:state.productionRevision}),true);}
function scriptUrls(){const parts=scriptParts();return parts.length&&parts.every(s=>/^https?:\/\/\S+$/i.test(s))?parts:[];}
function hasSources(){return !!($('source-text').value.trim()||$('source-urls').value.trim()||state.production?.assets?.some(a=>a.origin!=='generated-music'));}
function selectDirectionProposal(){if(!directionProposal||!designs.some(t=>t.id===directionProposal.template))throw new Error('INVALID_AUTOMATIC_DIRECTION');$('job-title').value=directionProposal.title;designChoice={mode:'template',template:directionProposal.template};$('motion-style').value=directionProposal.motion?.style||'off';$('motion-intensity').value=directionProposal.motion?.intensity||'standard';for(const field of ['title','design','motion'])dirtyFields.add(field);}
function updateDirectionControls(){const automatic=automaticDirectionEnabled(),proposal=directionPending?undefined:directionProposal,locked=state.busy||localBusy||isFinalized();$('auto-direction').disabled=locked;$('manual-direction').hidden=automatic;$('manual-direction').open=!automatic;$('apply-direction').disabled=locked;const legacy=!automatic&&!state.presentation?.mode&&!dirtyFields.has('design');const choice=legacy?undefined:automatic&&proposal?designs.find(t=>t.id===proposal.template):designChoice?.mode==='template'?designs.find(t=>t.id===designChoice.template):undefined,selectedDesign=choice?.design||renderPreviewDesign(state.presentation),show=automatic?!!proposal:!!selectedDesign;$('direction-sample').hidden=!show;if(show&&selectedDesign)paintDesign($('direction-sample'),selectedDesign);$('direction-preview-caption').textContent=legacy?'保存済みの配色の見本（配置は簡易表示）':'選択したテンプレートの配色・レイアウト見本';$('direction-title').textContent=automatic&&proposal?proposal.title:$('job-title').value;$('direction-info').textContent=automatic?(proposal?'AIの提案（台本採用時に反映）：'+(choice?.name||proposal.template)+' ／ '+proposal.title+' ／ '+(proposal.motion?.style||'静かなスライド'):'台本生成後にタイトル・テンプレート・動きを自動選択します。'):'手動設定：'+(choice?.name||(legacy?'保存済みの配色':'今回用のデザイン'))+'。下の調整欄で変更できます。';}
$('auto-direction').addEventListener('change',guarded(async()=>{if(!dirtyFields.has('production'))productionBaseline=state.productionRevision;dirtyFields.add('production');$('manual-direction').open=!automaticDirectionEnabled();directionPending=automaticDirectionEnabled();updateControls();}));
$('apply-direction').addEventListener('click',guarded(async()=>{await pending(savePlanning);updateDirectionControls();message('調整を反映しました。台本を確認して声選びへ進めます。');}));
function cachedSample(){const s=selectedSettings();return state.samples?.find(i=>sameSettings(i.settings,s));}
function scriptAlreadyLoaded(){return scriptParts().join('\n')===state.rows.filter(r=>r.id!==state.production?.bookends?.titleRowId).map(r=>r.caption.trim()).join('\n')&&!!scriptParts().length;}
function fitSentencePair(cap,speech){if(!cap.scrollHeight||!speech.scrollHeight)return;cap.style.height='auto';speech.style.height='auto';const height=(Math.max(86,cap.scrollHeight,speech.scrollHeight)+2)+'px';cap.style.height=height;speech.style.height=height;}
function sentences(text){return text?[...new Intl.Segmenter('ja',{granularity:'sentence'}).segment(text)].map(part=>part.segment):[];}
function editorText(editor,pair){return {caption:editor.pairs.map(p=>!pair||p===pair?p.cap.value:p.saved.caption).join(''),speech:editor.pairs.map(p=>!pair||p===pair?p.speech.value:p.saved.speech).join('')};}
function textMatches(a,b){return a.caption.trim()===b.caption.trim()&&a.speech.trim()===b.speech.trim();}
function editorChanged(editor){return !textMatches(editorText(editor),editor.baseline);}
function hasCorrections(){return dirtyFields.has('review')?!!($('review-overall').value.trim()||state.rows.some(r=>cutInstructions.get(r.id)?.trim())):!!(state.production?.review?.overall?.trim()||state.production?.review?.cuts?.some(c=>c.instruction?.trim()));}
function cutImageInputsDirty(id){return !!(rowEditors.get(id)&&editorChanged(rowEditors.get(id))||visualDrafts.get(id)?.dirty);}
function titleReadingReadyToSave(){return !!(dirtyFields.has('bookends')||preparedTitleReading()?.speech)&&!!$('opening-speech').value.trim();}
function updateCutImages(){for(const [id,box]of cutImages){
 const row=state.rows.find(r=>r.id===id),candidate=state.imageProposal?.scenes.find(s=>s.id===id),assets=(state.production?.assets||[]).filter(a=>/^[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/.test(a.file)),legacy=assets.filter(a=>a.name==='cut-'+id+'.png'),asset=(candidate?.imageFile&&assets.find(a=>a.file===candidate.imageFile))||(row?.cutImage&&assets.find(a=>a.file===row.cutImage.file))||(row?.cutImage===undefined&&legacy.length===1?legacy[0]:null),file=asset?.file;
 const design=renderPreviewDesign(state.presentation),locked=state.busy||localBusy||state.video?.running;
 const signature=JSON.stringify([assets.map(a=>a.file),file,candidate,state.imageProposal?.id,row?.cutVisual,row?.caption,state.presentation?.explainScenes,design,isFinalized(),locked,isDirty(),dirtyFields.has('production'),state.keyConfigured,state.production?.brief.assetMode,state.production?.brief.storyboard,row?.cutConfirmed,cutImageInputsDirty(id)]);if(box.dataset.files===signature)continue;box.dataset.files=signature;box.replaceChildren();
 if(state.production?.bookends?.titleRowId===id){box.hidden=false;box.append(element('strong',row.caption),element('figcaption','冒頭のタイトル画面。背景と文字を動かして表示します。画像は不要です。',{class:'help'}));continue;}
 const explanation=state.presentation?.explainScenes==='auto'?row?.cutVisual?.explanation:null;
 if(explanation){const preview=element('div',undefined,{class:'explanation-preview','data-explanation':explanation.type}),names={comparison:'比較',steps:'手順',stat:'数字強調',bar:'棒グラフ'};preview.append(element('strong',names[explanation.type]+'：'+(row.cutVisual.title||row.scene||'')));const items=element('div',undefined,{class:'explanation-items'}),max=explanation.type==='bar'?Math.max(...explanation.items.map(i=>Number(i.value.replaceAll(',','')))):1;for(const [i,item]of explanation.items.entries()){const card=element('div',undefined,{class:'explanation-item'});card.append(element('span',(explanation.type==='steps'?(i+1)+'．':'')+item.label),element('strong',item.value+explanation.unit));if(explanation.type==='bar'){const bar=element('div',undefined,{class:'explanation-bar'});bar.style.width=(Number(item.value.replaceAll(',',''))/max*100)+'%';card.append(bar);}items.append(card);}preview.append(items);box.append(preview,element('figcaption','図解の内容確認。完成動画では音声に合わせて順番に強調します。',{class:'help'}));}
 if(file){const frame=element('div');paintDesign(frame,design);frame.classList.toggle('cut-template-preview',true);const image=element('div',undefined,{class:'preview-image'});image.append(element('img',undefined,{src:'/materials/'+file,alt:`${state.rows.findIndex(r=>r.id===id)+1}カットの使用画像`,class:'cut-frame-art',loading:'lazy'}));const notes=element('div',undefined,{class:'preview-points'});for(const point of row?.cutVisual?.points||[])notes.append(element('span',point));frame.append(element('span',row.scene||state.title,{class:'preview-kicker'}),element('strong',row?.cutVisual?.title||row.scene||state.title,{class:'preview-heading'}),notes,image,element('small',sentences(row.caption)[0]||row.caption,{class:'preview-caption'}));box.append(frame,element('figcaption',savedMotion()?'素材確認用の静止画です。完成動画では選んだ演出で構図と動きが変わります。':'動画レイアウトの見本。字幕は音声に合わせて一文ずつ切り替わります。',{class:'help'}));}
 if(!isFinalized()){
  const actions=element('div',undefined,{class:'input-row image-actions'});
  if(candidate?.imageFile&&!candidate.imagePrompt){const adopt=element('button','この画像を採用（APIなし）',{type:'button','data-adopt-image':id});adopt.disabled=!!(locked||cutImageInputsDirty(id));adopt.addEventListener('click',guarded(()=>adoptImages(id)));actions.append(adopt);box.append(element('p','未採用の画像候補です。画像を確認して採用してください。',{class:'help'}));}
  if(actions.children.length)box.append(actions);
 }
 if(file)box.append(element('a','画像そのものを拡大して確認（APIなし）',{href:'/materials/'+file,target:'_blank',rel:'noopener noreferrer',class:'cut-original-link'}));
 if(!file&&legacy.length>1)box.append(element('p','このカットの画像が複数あります。使う画像をファイル選択かドロップで指定してください。',{class:'help'}));
 else if(!file)box.append(element('p',explanation?'このカットは図解で表示します。画像の追加は任意です。':'このカットの画像は未準備です。台本に合う画像を準備して割り当ててから確認してください。',{class:'help'}));
 if(!isFinalized()){
  const upload=element('input',undefined,{type:'file',accept:'.png,.jpg,.jpeg,.webp','aria-label':`${state.rows.findIndex(r=>r.id===id)+1}カットの画像を追加・差し替え`}),drop=element('div',undefined,{class:'cut-image-drop'});drop.append(element('p','この点線枠の中に画像をドロップして差し替える'),element('p','または、下の「ファイルを選択」ボタンから選ぶ。',{class:'help'}),upload);upload.disabled=!!locked;
  const assign=async files=>{if(state.busy||localBusy||state.video?.running)throw new Error('BUSY');if(isFinalized())throw new Error('VIDEO_FINALIZED');if(files.length!==1)throw new Error('画像は1枚ずつ選んでください');const added=await uploadMaterials(files);await pending(async()=>render(await api('cut-image',{id,file:added[0],revision:state.revision}),true));};upload.addEventListener('change',guarded(()=>assign(upload.files)));drop.addEventListener('dragover',event=>event.preventDefault());drop.addEventListener('drop',guarded(async event=>{event.preventDefault();await assign(event.dataTransfer.files);}));box.append(drop);
  if(file){const clear=element('button','このカットから画像を外す',{type:'button',class:'quiet'});clear.disabled=!!locked;clear.addEventListener('click',guarded(async()=>{await pending(async()=>render(await api('cut-image',{id,file:'',revision:state.revision}),true));}));box.append(clear);}
 }
 if(!isFinalized()){
  const saved=row?.cutVisual||{title:row.scene||'',points:[]},draft=visualDrafts.get(id)||{title:saved.title,points:saved.points.join('\n'),dirty:false};if(!draft.dirty){draft.title=saved.title;draft.points=saved.points.join('\n');}visualDrafts.set(id,draft);
  const detail=element('details'),titleLabel=element('label','画面の見出し'),title=element('input',undefined,{'data-visual-title':id,maxlength:'200'}),pointsLabel=element('label','画面の要点（1行に1つ・6項目まで）'),points=element('textarea',undefined,{'data-visual-points':id,rows:'3',maxlength:'966'});title.value=draft.title;points.value=draft.points;title.addEventListener('input',()=>{draft.title=title.value;draft.dirty=true;updateControls();});points.addEventListener('input',()=>{draft.points=points.value;draft.dirty=true;updateControls();});titleLabel.append(title);pointsLabel.append(points);
  const save=element('button','見出し・要点を保存（APIなし）',{type:'button','data-save-visual':id});save.disabled=title.disabled=points.disabled=!!locked;save.addEventListener('click',guarded(async()=>{await pending(async()=>{const next=await api('cut-visuals',{id,title:draft.title,points:draft.points.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),revision:state.revision,productionRevision:state.productionRevision});visualDrafts.delete(id);render(next,true);});message('画面の見出しと要点を保存しました。字幕・読み・音声・BGMは再利用します。');}));
  detail.append(element('summary','見出し・要点を確認する'),element('p','画像を差し替えた場合は、元の人物名や説明が残っていないか確認してください。ここを編集しても読み上げは変わりません。',{class:'help'}),titleLabel,pointsLabel,save);box.append(detail);
 }
 if(!isFinalized()&&state.production?.brief.assetMode!=='provided'){
  const draft=artworkDrafts.get(id)||{prompt:'',references:[]};artworkDrafts.set(id,draft);
  const panel=element('div',undefined,{class:'cut-image-regeneration'}),label=element('label','この画像の変更希望（任意）'),prompt=element('textarea',undefined,{'data-image-prompt':id,rows:'3',maxlength:'3000'});prompt.value=draft.prompt;prompt.addEventListener('input',()=>{draft.prompt=prompt.value;});label.append(prompt);
  draft.references=draft.references.filter(file=>assets.some(a=>a.file===file));
  const refs=element('details',undefined,{class:'image-reference-picker','data-image-reference-picker':id}),summary=element('summary','AI生成に参考画像を使う（任意）'),count=element('p',undefined,{class:'help',role:'status','aria-live':'polite'}),gallery=element('div',undefined,{class:'image-reference-gallery'});refs.open=!!draft.referenceOpen;refs.hidden=!assets.length;
  refs.append(summary,element('p','人物の外見や絵柄を参考にしたいときに、画像を選んでください。選択だけでは画像は変わりません。下のAI生成ボタンを押したときに使います。',{class:'help'}),count,gallery);
  const updateSelection=()=>{count.textContent=`選択中：${draft.references.length} / 3枚`;for(const button of gallery.children){const selected=draft.references.includes(button.dataset.imageReference);button.setAttribute('aria-pressed',String(selected));button.disabled=!!locked||!selected&&draft.references.length>=3;button.children[button.children.length-1].textContent=selected?'✓ 選択済み':'選ぶ';}};
  const showReferences=()=>{gallery.replaceChildren();if(refs.open)for(const a of assets){const button=element('button',undefined,{type:'button',class:'image-reference-choice','data-image-reference':a.file,'aria-label':a.name+'をAI生成の参考にする'});button.append(element('img',undefined,{src:'/materials/'+a.file,alt:a.name,loading:'lazy'}),element('span',a.name,{class:'image-reference-name'}),element('span'));
   button.addEventListener('click',()=>{if(locked)return;const selected=draft.references.includes(a.file);if(selected)draft.references=draft.references.filter(file=>file!==a.file);else if(draft.references.length<3)draft.references.push(a.file);updateSelection();});gallery.append(button);}updateSelection();};
  refs.addEventListener('toggle',()=>{draft.referenceOpen=refs.open;showReferences();});showReferences();
  const regenerate=element('button',file?'この画像をAIで再生成（API 1回）':'このカットの画像を生成（API 1回）',{type:'button',class:'secondary','data-generate-image':id});regenerate.disabled=!!(locked||cutImageInputsDirty(id)||!state.keyConfigured);regenerate.addEventListener('click',guarded(()=>regenerateImage(id)));
  prompt.disabled=!!locked;panel.append(label,refs,regenerate);if(!state.keyConfigured)panel.append(element('p','画像の生成・再生成には、画面上部でGemini APIキーを登録してください。',{class:'help'}));box.append(panel);
 }
 if(cutImageInputsDirty(id)&&!isFinalized())box.append(element('p','このカットの字幕・読み・見出しの変更を保存すると、その内容でAIに画像を生成できます。ファイル選択・ドロップでの差し替えはそのまま使えます。',{class:'help'}));box.hidden=false;
}}
function updateReviewControls(){const busy=state.busy||localBusy||state.video?.running||isFinalized();for(const editor of rowEditors.values()){const locked=busy;for(const p of editor.pairs){p.cap.disabled=locked;p.speech.disabled=locked;p.commit.hidden=p.cap.value===p.saved.caption&&p.speech.value===p.saved.speech;p.commit.disabled=locked||p.commit.hidden;}editor.instruction.disabled=locked;editor.save.hidden=!editorChanged(editor);editor.save.disabled=locked;editor.approve.hidden=!editorChanged(editor)&&!!state.rows.find(r=>r.id===editor.id)?.reviewed;editor.approve.disabled=!!(locked||(!editorChanged(editor)&&(state.rows.find(r=>r.id===editor.id)?.reviewed||state.rows.find(r=>r.id===editor.id)?.readingPreparationRequired)));}
  $('review-overall').disabled=busy;$('save-review').disabled=busy||!dirtyFields.has('review');$('clear-review').disabled=busy||!hasCorrections();$('apply-review').disabled=busy||isDirty()||!state.keyConfigured||!hasCorrections();for(const b of document.querySelectorAll('[data-apply-review]'))b.disabled=busy||isDirty()||!state.keyConfigured||!cutInstructions.get(b.dataset.applyReview)?.trim();
  const prepared=preparedTitleReading(),pendingTitle=dirtyFields.has('bookends')||prepared&&!state.production?.bookends?.titleRowId,canSaveTitle=titleReadingReadyToSave(),changed=[...rowEditors.values()].some(editorChanged)||pendingTitle,reviewed=!!state.rows.length&&!changed&&state.rows.every(r=>r.reviewed);
  const missingTitle=state.titleReadingPreparationRequired&&!canSaveTitle||pendingTitle&&!$('opening-speech').value.trim(),missingRow=state.rows.find(r=>(r.id!==state.production?.bookends?.titleRowId||!canSaveTitle)&&r.readingPreparationRequired&&!rowEditors.get(r.id)?.box.dataset.dirty),emptyRow=[...rowEditors.values()].find(e=>!editorText(e).speech.trim());
  $('confirm-script').hidden=reviewed;$('confirm-script').textContent=reviewed?'全文の読みは確定済み':'全文の読みを確定（制作前）';$('confirm-script').disabled=!!(busy||!state.rows.length||reviewed||missingTitle||missingRow||emptyRow);
  $('review-save-state').textContent=busy?'処理中です。終了すると読みを確定できます。':missingTitle?'冒頭タイトルの読みを入力・修正してください。全文の確定時に一緒に保存します。':missingRow||emptyRow?`${state.rows.findIndex(r=>r.id===(missingRow||emptyRow).id)+1}カットの読みが未準備です。読み上げ文を入力・修正してください。`:reviewed?'全文の読みは確定済みです。':changed?'表示中の字幕・読み・タイトルを確認し、「全文の読みを確定」でまとめて保存・確定してください（APIなし）。':'字幕と読みを確認してください。「全文の読みを確定」を押してから、音声を作成してください。';$('review-count').textContent=`${state.rows.filter(r=>r.reviewed&&!(rowEditors.get(r.id)&&editorChanged(rowEditors.get(r.id)))).length} / ${state.rows.length} 読み確認済み`;
}
async function saveEditor(editor,pair){const current=state.rows.find(r=>r.id===editor.id);if(!current||!textMatches(current,editor.baseline))throw new Error('STALE_REVISION');const input=editorText(editor,pair),saved=editor.pairs.map(p=>({pair:p,caption:p.cap.value,speech:p.speech.value}));if(!textMatches(input,current)){const next=await api('row',{id:editor.id,...input});editor.baseline=next.rows.find(r=>r.id===editor.id);for(const value of saved)if(!pair||value.pair===pair)value.pair.saved={caption:value.caption,speech:value.speech};if(editorChanged(editor))editor.box.dataset.dirty='true';else delete editor.box.dataset.dirty;render(next,true);}else{for(const value of saved)if(!pair||value.pair===pair)value.pair.saved={caption:value.caption,speech:value.speech};if(!editorChanged(editor))delete editor.box.dataset.dirty;updateControls();}}
function sampleAudio(id){const item=state.samples?.find(i=>i.id===id);if(!item)return;const audio=$('sample-audio');const src='/samples/'+item.file;if(!audio.src?.endsWith(src))audio.src=src;audio.hidden=false;$('sample-info').textContent=`${item.settings.voice} / ${item.settings.model} / ${item.settings.pitch==='low'?'低め':item.settings.pitch==='high'?'高め':'標準'} · ${item.durationSeconds.toFixed(1)}秒 · 保存済み（API呼び出しなし）`;}
function refreshSampleAudio(){const sample=cachedSample();$('preview-options').hidden=!!sample;$('preview-voice').hidden=false;if(sample)sampleAudio(sample.id);else{$('sample-audio').pause();$('sample-audio').hidden=true;$('sample-info').textContent='このモデル・声・話し方・高さの組み合わせは未保存です。初回だけサンプルを作成できます。';}}
function updateExtras(){
 $('theme-auto').disabled=!!(state.busy||localBusy||isFinalized()||$('script-mode').value==='existing');$('clear-script').disabled=!!(isFinalized()||!$('script-input').value.trim());
 updateBookendsControls();updateTimingControls();const busy=state.busy||localBusy||state.video?.running||isFinalized();for(const id of ['source-text','source-urls','title-mode','voice-mode','voice-manual','append-script','save-production','material-files','script-mode','asset-mode','production-instructions','script-input','pitch','voice-preset','voice','model','style'])$(id).disabled=busy;
 $('script-input').disabled=isFinalized();
 const applied=state.voiceConfirmed===true&&sameSettings(selectedSettings(),state.settings);$('apply-voice').disabled=busy||!state.rows.length;$('apply-voice').textContent='この声で全文確認へ →';$('voice-apply-state').textContent=applied?'保存した声：'+state.settings.voice+'。次へ進むと選択内容を保存します。':'声の候補：'+selectedSettings().voice+'。次へ進むと本番の声として保存します。';
 const needsReading=readingPreparationNeeded();$('append-script').textContent=needsReading?'読みを用意して声選びへ（API 1回）':'次へ：声を選ぶ →';$('append-script').disabled=busy||!$('script-input').value.trim()||needsReading&&!state.keyConfigured;
 $('reading-prep-info').textContent=needsReading?'このボタンで台本をGoogleへ1回送り、ひらがなの読みを用意します。API利用料が発生する場合があります。':hasScriptReadings()?'字幕とひらがなの読みは準備済みです。追加のAPI利用はありません。':'取り込み済みの台本を確認します。追加のAPI利用はありません。';

 $('provider-diagnostic').hidden=!state.providerDiagnostic;$('provider-diagnostic').textContent=state.providerDiagnostic||'';
 $('check-connection').disabled=busy||!state.keyConfigured;
 $('probe-generation').disabled=busy||!state.keyConfigured;
 const action=scriptActionState({mode:$('script-mode').value,script:$('script-input').value,instructions:$('production-instructions').value,hasReferences:hasSources(),themeAuto:aiThemeEnabled(),keyConfigured:state.keyConfigured,busy:state.busy||localBusy,finalized:isFinalized(),inputErrors:{script:scriptUrls().length?'REFERENCE_IN_SCRIPT':null}});
 $('ai-source-controls').hidden=!action.showAiControls;$('script-instruction-label').textContent=$('script-mode').value==='mixed'?'直したい点・AIへの指示':'テーマ・AIへの指示';$('ai-script-controls').hidden=!action.showAiControls;$('ai-script-controls').disabled=busy;$('theme-auto-control').hidden=!action.showThemeAuto;$('theme-auto').disabled=busy||!action.showThemeAuto;$('auto-direction-control').hidden=!action.showAiControls;$('script-instructions-field').hidden=aiThemeEnabled();$('production-instructions').disabled=busy||!action.showAiControls||aiThemeEnabled();
 $('script-send-state').textContent=action.reason==='EMPTY_INSTRUCTIONS'?($('script-mode').value==='mixed'?'本文と直したい点を入力してください。':'資料・テーマを入力するか、テーマをAIに任せるを選んでください。'):action.reason==='REFERENCE_IN_SCRIPT'?'URLだけの場合は、参考URL欄へ入力してください。台本欄は本文の入力・編集用です。':action.reason==='SCRIPT_REQUIRED'?'整える台本を結果欄に入力してください。':action.reason==='API_KEY_REQUIRED'?'画面上部でGemini APIキーを登録すると送信できます。':action.reason==='BUSY'?'処理が終わるまでお待ちください。':action.showAiControls?'このボタンで指定した内容をGoogleへ送り、台本案を1回作成します。':'手入力の編集・採用ではAIへ送信しません。';
 $('plan-sources').textContent='台本と準備素材を読み込んで声選びへ（APIなし）';$('plan-sources').disabled=!action.canAdopt;$('append-script').hidden=true;
 const realScript=!!scriptParts().length;$('generate-script').hidden=!action.showAiControls||realScript;$('regenerate-script').hidden=!action.showAiControls||!realScript;for(const id of ['generate-script','regenerate-script'])$(id).disabled=!action.canGenerate;
 $('planning-request-info').textContent=realScript?'編集した本文をカットへ反映し、声選びへ進みます。APIは使いません。読みが未準備なら③で用意します。':'AIで台本を作るか、結果欄へ手入力・貼り付けしてください。';
 const missingReading=state.rows.some(r=>r.readingPreparationRequired||!r.speech?.trim()||r.readingState==='pending');$('prepare-readings').hidden=!missingReading;$('prepare-readings').disabled=busy||isDirty()||!state.keyConfigured||!missingReading;$('prepare-readings').textContent='未準備・要修正の読みをAIで準備（API 1回）';$('reading-prep-status').textContent=state.titleReadingPreparationRequired&&!titleReadingReadyToSave()?'タイトルの読み候補は要修正です。「冒頭タイトルの読み」で修正できます。台本を作り直す必要はありません。':missingReading?'台本は保持しています。要修正・未準備の読みだけ手入力で直すか、明示操作でAIに用意してもらえます。':'タイトルと本文の読みは準備済みです。下で確認して「全文の読みを確定」を押してください。追加の読み生成は不要です。';
 const readingAttempt=state.production?.authoring?.lastAttempt,bodyRows=state.rows.filter(r=>r.id!==state.production?.bookends?.titleRowId),savedReadings=readingAttempt?.result?.readings;
 $('apply-readings-result').hidden=readingAttempt?.operation!=='prepare-readings'||!Array.isArray(savedReadings)||savedReadings.length!==bodyRows.length||savedReadings.some((r,i)=>r.caption!==bodyRows[i].caption)||savedReadings.every((r,i)=>r.speech===bodyRows[i].speech);$('apply-readings-result').disabled=busy||isDirty();
 updateDirectionControls();
 $('draft-script').disabled=busy||!state.keyConfigured||!$('production-instructions').value.trim();$('draft-script').textContent=draftGenerating?'AIが台本案を作成中…':'AIで台本案を作る（API利用）';
 $('draft-status').textContent=draftGenerating?'台本案を作成しています。':draftOutcome||(!state.keyConfigured?'APIキーが未設定です。画面上部で登録すると作成できます。':!$('production-instructions').value.trim()?'作りたい動画の指示を入力してください。':'準備できています。ボタンを押すとAPIを1回利用します。');$('draft-key-link').hidden=state.keyConfigured;
 $('save-production').textContent=productionSaving?'保存中…':'途中で保存する（APIなし）';
 $('preview-voice').disabled=busy||(!cachedSample()&&(!state.keyConfigured||!$('preview-consent').checked));$('preview-voice').textContent=cachedSample()?'保存済みの声・高さを試聴（API不要）':'この声・高さのサンプルを作る（初回のみ）';
}
function updateVideo(){
  const video=state.video||{},result=video.result,labels={preparing:'確定済みの画像・音声を準備',bundling:'動画レイアウトを準備',rendering:'映像と音声を動画に変換',verifying:'動画と音声を検査',saving:'ダウンロードフォルダへ保存',complete:'動画が完成しました'},videoErrors={VIDEO_FONT_TIMEOUT:'日本語フォントの読み込み待ちが時間切れになりました。台本・音声は保持しています。',VIDEO_RENDER_CANCELED:'動画生成を中止しました。確認済みの素材と音声は保持しています。',VIDEO_RENDERER_REQUIRED:'動画レンダラーが未設定です。Codexへこの動画の続きを依頼してください。',VIDEO_BROWSER_REQUIRED:'動画生成用ブラウザーが見つかりません。',VIDEO_RENDER_INTERRUPTED:'前回の動画生成は中断されました。確定済みの素材は保持しています。',VIDEO_SAVE_DENIED:'ダウンロードフォルダへ保存できませんでした。保存先へのアクセスを確認してください。'};
  $('confirm-full').textContent=video.canceling?'中止処理中…':video.running?'動画を生成中…':result?.reviewState==='pending'?'完成した動画・音声を確認して確定（APIなし）':result?.audio?'動画と音声を保存済み':result?'動画と音声を保存する':video.stage==='canceled'?'動画生成を再開する':video.error?'動画生成を再実行する':'動画作成を再開（APIなし）';
  $('video-work').hidden=!video.running&&!video.error&&!result;$('video-spinner').hidden=!video.running;
  $('video-status').textContent=video.canceling?'動画生成を中止しています。処理の終了を待っています。':video.error?(videoErrors[video.error]||'動画を生成できませんでした：'+video.error):(labels[video.stage]||'動画生成を準備しています。')+(video.stage==='rendering'?`（${video.renderedFrames||0} / ${video.totalFrames||0}フレーム）`:'');
  $('video-progress').hidden=!video.running||!['bundling','rendering'].includes(video.stage);$('video-progress').value=video.progress||0;
  const steps=(video.steps||[]).filter(step=>labels[step]);
  $('video-stages').replaceChildren(...steps.map((step,index)=>element('li',labels[step]+(video.error&&index===steps.length-1?video.stage==='canceled'?' — 中止':' — 失敗':step===video.stage&&video.running?' — 処理中':' — 完了'))));
  $('video-result').hidden=!result;if(result){const src='/video/'+result.file;if(!$('video-player').src?.endsWith(src))$('video-player').src=src;$('download-video').download=result.filename;$('video-saved-path').textContent='保存済み：'+result.savedPath;}
  $('download-audio').hidden=!result?.audio;$('audio-saved-path').textContent=result?.audio?'音声の保存先：'+result.audio.savedPath:'';if(result?.audio)$('download-audio').download=result.audio.filename;
}
function updateActivityProgress(){
 if(!state)return;
 const authored=state.authoringProgress;
 const activity=planningAdvancing?{stage:'planning',phase:'台本と素材を取り込み、声選びの画面を開いています…'}:authored?{...authored,stage:authored.operation==='prepare-readings'?'reading':'planning'}:activeRequest|| (draftGenerating?{stage:'planning',phase:'台本と画像を準備しています…'}:state.busy?{stage:state.sampleProgress?'connection':'reading',phase:state.progress?.phase||'AIが処理しています…',...(state.progress||{})}:null);
 const target=activity?.stage==='planning'&&!planningAdvancing?'planning-create':activity?.stage;
 for(const stage of ['planning','planning-create','connection','reading']){
  const box=$(stage+'-activity'),bar=$(stage+'-activity-bar');box.hidden=target!==stage&&!(stage==='planning'&&target==='planning-create');
  if(box.hidden)continue;$(stage+'-activity-label').textContent=activity.phase;
  if(Number.isFinite(activity.total)&&activity.total>0&&Number.isFinite(activity.completed)&&activity.completed>=0&&activity.completed<=activity.total){bar.setAttribute('max',activity.total);bar.setAttribute('value',activity.completed);}
  else{bar.removeAttribute('value');bar.setAttribute('max',1);}
 }
}
function currentVoiceProposal(){const proposal=state.production?.brief.storyboard,body=state.rows.filter(r=>r.id!==state.production?.bookends?.titleRowId);return proposal?.voice&&state.voices.includes(proposal.voice)&&body.length>0&&body.map(r=>r.caption).join('\n')===proposal.scenes.map(s=>s.caption).join('\n')?proposal:null;}
function updateVoiceChoice(reset=false){
 const proposal=currentVoiceProposal();
 if($('voice-mode').value!=='manual'&&!isFinalized()&&!state.busy&&!localBusy&&!state.video?.running&&(proposal||reset)){
  const config=proposal?{model:state.settings.model,voice:proposal.voice,style:styleForVoice(proposal.voice),pitch:'standard'}:state.settings;
  if(!sameSettings(selectedSettings(),config)){customMode=false;$('model').value=config.model;$('voice').value=config.voice;$('style').value=config.style;$('pitch').value=config.pitch||'standard';markSettingsDirty();refreshSampleAudio();}
 }
 syncVoicePreset();
}
function updateVoiceProposal(){
 const proposal=currentVoiceProposal(),box=$('voice-proposal');box.hidden=!proposal;
 if(proposal)box.replaceChildren(element('strong',($('voice-mode').value==='manual'?'AIの提案：':'AIが選んだ声：')+proposal.voice),element('span',proposal.voiceReason));
}
function updateControls(){
  updateVoiceChoice();updateActivityProgress();updateVoiceProposal();
  $('use-adopted-script').hidden=!state.rows.length;$('use-adopted-script').disabled=state.busy||localBusy||isFinalized();

  $('theme').disabled=state.busy||localBusy;
  const projectLocked=state.busy||localBusy||state.video?.running||hasUserEdits();
  $('new-project').disabled=!!projectLocked;$('new-project-bottom').disabled=!!projectLocked;
  $('revise-project').hidden=!isFinalized();$('revise-project').disabled=!!projectLocked||!isFinalized();$('revise-project-help').hidden=!isFinalized();
  for(const button of document.querySelectorAll('[data-revise-step]')){button.disabled=!!projectLocked;button.hidden=!isFinalized();}
  $('project-info').textContent=hasUserEdits()?'編集中の内容を保存してから、動画を切り替えられます。':state.busy||state.video?.running?'処理が完了すると、別の動画を始められます。':isFinalized()?'この制作は最終確定済みです。修正する場合は「最終確定を解除して編集を再開」を押してください。':'現在の制作は自動保存されます。新しく始めると、今の制作データはクリアされます。完成動画のダウンロードファイルは残ります。';
  updateExtras();updateReviewControls();
  updateDesign();
  const lock=state.busy||localBusy||isDirty(),sealed=isFinalized(),ready=state.rows.filter(r=>!r.audioCurrent||dirtyFields.has('settings')||(rowEditors.has(r.id)&&editorChanged(rowEditors.get(r.id))));
  $('production-voice-info').textContent=`本番の声：${state.settings.voice} ／ 高さ：${state.settings.pitch==='low'?'低め':state.settings.pitch==='high'?'高め':'標準'}${dirtyFields.has('settings')?'（選択中の変更はまだ未反映）':''}。`;
  const needsMusic=musicEnabled()&&(!state.production?.music||!state.musicCurrent);$('generate-all').disabled=state.busy||localBusy||state.video?.running||sealed||!state.keyConfigured||hasCorrections()||!state.rows.length||(!ready.length&&!needsMusic);
  $('generate-all').textContent='動画を作成';
  $('generate-all').hidden=sealed||state.rows.some(r=>!r.audioCurrent&&r.attempts>0);$('generate-all').disabled=state.busy||localBusy||state.video?.running||sealed||hasCorrections()||isDirty()||!state.rows.length||state.rows.some(r=>!r.reviewed)||state.titleReadingPreparationRequired||!state.voiceConfirmed||dirtyFields.has('settings')||state.rows.some(r=>!r.audioCurrent&&r.attempts>0)||((ready.length||needsMusic)&&!state.keyConfigured);$('retry-audio').hidden=sealed||!state.rows.some(r=>!r.audioCurrent&&r.attempts>0);$('retry-audio').disabled=state.busy||localBusy||sealed||!state.keyConfigured||state.rows.some(r=>!r.reviewed)||state.titleReadingPreparationRequired||!state.voiceConfirmed;
  updateVideo();
  const active=state.busy||state.video?.running,canUndoReading=!sealed&&state.rows.some(r=>r.reviewed);if(!active&&cancelRequested){cancelRequested=false;$('cancel-status').textContent='中止処理が終了しました。保存済みの台本・素材・音声は保持しています。';}
  for(const button of document.querySelectorAll('[data-cancel]')){const inline=button.dataset.cancelInline!==undefined;button.disabled=!!(workflowPaused||pauseRequested||cancelRequested||state.video?.canceling||(!active&&(localBusy||inline)));button.textContent=cancelRequested||state.video?.canceling?'中止処理中…':active?'実行中の処理を中止':'制作を中断';if(inline)button.hidden=!active;}
  const readingDone=!!state.rows.length&&state.rows.every(r=>r.reviewed);$('unconfirm-script').hidden=!canUndoReading;$('unconfirm-script').disabled=!!(localBusy||active||sealed);
  $('generation-next').hidden=true;$('generation-next').disabled=!!(localBusy||active||isDirty()||dirtyFields.has('settings'));
  $('reading-next').hidden=$('generation-next').hidden;
  $('generation-next').textContent='ナレーション作成へ進む →';
  $('generation-next-state').textContent=!readingDone?'読みを確定してから、音声・動画を作成します。':'下の1つのボタンで音声・BGM・動画を順番に作成します。';
  const complete=!!state.rows.length&&state.rows.every(r=>r.reviewed&&r.audioCurrent);
  $('generation-tools').hidden=sealed||!!state.video?.result;
  $('generation-state').textContent=state.busy?(state.progress?.phase||'作成中です。'):!state.rows.length?'01で台本を用意してください。':!state.keyConfigured?'画面上部でGemini APIキーを登録してください。':'確定した読みをGoogleへ送信します。未確定の読みは、先に「全文の読みを確定」で確認してください。音声は対象カットごとにAPI1回'+(musicEnabled()?'、必要なBGMはLyria 3.5で1回':'')+'。料金が発生する場合があります。自動再試行はありません。';
  $('confirm-full').hidden=!complete||state.video?.result?.reviewState!=='pending';
  renderImageProposal();
  $('confirm-full').disabled=lock||!!state.video?.running||!state.video?.available||needsMusic||hasCorrections()||!complete||state.rows.some(r=>r.cutFingerprint===null)||(state.presentation?.mode==='ai'&&!state.presentation.design);
  syncWorkflow();if(!workflowPaused){if(!state.rows.length)for(const id of ['connection','reading'])$(id).hidden=window.location.hash!=='#'+id;$('finish').hidden=!hasGenerationOutput();}
  $('handoff-info').textContent=sealed?'全カット最終確定済み・編集不可。この内容を動画へ渡せます。':hasCorrections()?'修正指示が残っています。指摘した箇所を直して確認してから、動画へ渡せます。':isDirty()?'編集中の内容を反映してから音声を渡してください。':!complete?'声・ピッチを選び、全文確認で読みを確定して音声・動画をまとめて作成してください。':'完成した動画を再生し、画像・字幕・音声を確認してから確定してください。';
  for(const b of document.querySelectorAll('[data-generate]')){const row=state.rows.find(r=>r.id===b.dataset.generate);b.hidden=!!row?.audioCurrent||sealed;b.disabled=lock||sealed||!state.keyConfigured||!row?.reviewed;}
  updateCutImages();updateApiBoundary();
}
function updateApiBoundary(){
 const locked=state.busy||state.video?.running||localBusy||isFinalized();
 if(!state.keyConfigured&&!locked){for(const id of ['generate-script','regenerate-script','prepare-readings','draft-design','draft-script','generate-all','retry-audio','apply-review','plan-images','prepare-samples','check-connection','probe-generation']){const button=$(id);if(button&&!button.hidden&&(id!=='apply-review'||hasCorrections()))button.disabled=false;}if(!cachedSample())$('preview-voice').disabled=false;for(const selector of ['[data-generate]','[data-generate-image]','[data-apply-review]'])for(const button of document.querySelectorAll(selector))if(!button.hidden&&(!button.dataset.applyReview||cutInstructions.get(button.dataset.applyReview)?.trim()))button.disabled=false;}
 const missing=!state.keyConfigured&&!isFinalized(),planningBlocked=missing&&!state.rows.length;
 const finishBlocked=missing&&(!state.rows.length||state.rows.some(r=>!r.audioCurrent)||musicEnabled()&&(!state.production?.music||!state.musicCurrent));
 $('connection').inert=planningBlocked;$('reading').inert=planningBlocked;$('finish').inert=finishBlocked;
 for(const button of document.querySelectorAll('[data-go-step]')){const step=button.dataset.goStep;if(step==='finish')button.hidden=!hasGenerationOutput();if(missing&&(['connection','reading'].includes(step)?planningBlocked:step==='finish'&&finishBlocked))button.disabled=true;else button.disabled=!!(state.busy||localBusy);}
}
function maybeAdvanceAudio(){updateApiBoundary();if(!advanceAfterAudio||state.busy||localBusy)return;if(state.error){advanceAfterAudio=false;return;}if(!state.rows.length||state.rows.some(r=>!r.audioCurrent)||(musicEnabled()&&(!state.production?.music||!state.musicCurrent)))return;advanceAfterAudio=false;window.location.hash='#finish';$('finish').scrollIntoView?.({block:'start'});message('音声とBGMを準備しました。続けて動画を作成しています。完成後に動画と音声を確認してください。');}
function render(next,force=false){state=next;if(state.keyConfigured)$('api-required-alert').hidden=true;$('resume-info').textContent=state.resumed?'保存した制作「'+state.title+'」を再開しています。':projectHasContent()?'制作中の動画です。別の制作を始めると、台本・素材のない空の制作を開きます。':'新規制作です。台本・素材はまだ登録されていません。';let keyLost=false;try{keyLost=!state.keyConfigured&&window.sessionStorage?.getItem('narration-had-key')==='yes';if(state.keyConfigured)window.sessionStorage?.setItem('narration-had-key','yes');}catch{}$('key-reset-notice').hidden=!keyLost;if(lastKeyConfigured!==state.keyConfigured){$('api-settings').open=!state.keyConfigured&&!isFinalized();lastKeyConfigured=state.keyConfigured;}$('api-connection').classList.toggle('needs-key',!state.keyConfigured&&!isFinalized());$('api-summary').textContent=state.keyConfigured?'APIキーを変更・解除':'Gemini APIキーを登録';$('key-state').textContent=state.keyConfigured?'キー登録済み':'APIキー未設定';$('key-state').classList.toggle('ready',state.keyConfigured);$('review-count').textContent=`${state.rows.filter(r=>r.reviewed).length} / ${state.rows.length} 読み確認済み`;$('progress').textContent=state.busy&&state.production?.authoring?.lastAttempt?.state==='running'?'指定した台本・読みの作成処理を実行中です。完了を待っています。':state.busy?`${state.progress?.phase||'合成中'}：${state.progress?.completed||0} / ${state.progress?.total||0} カット（自動再試行なし）`:state.progress?`合成終了：${state.progress.completed} / ${state.progress.total} カット`:'';
  $('theme').value=screenTheme||state.presentation?.theme||'moon';applyTheme($('theme').value);
  if(!dirtyFields.has('design')&&!designPreviewOnly)$('design-instructions').value=state.presentation?.instructions||'';
  if((force||state.revision!==lastRevision)&&!isDirty()){
    $('job-title').value=state.title;$('slide-title').textContent=state.title;$('model').value=state.settings.model;$('voice').replaceChildren(...[...state.voices].sort(voiceCompare).map(v=>element('option',v+'（'+genderLabel(genderFor(v))+'）',{value:v})));$('voice').value=state.settings.voice;$('style').value=state.settings.style;$('pitch').value=state.settings.pitch||'standard';
    buildPresetMenu();syncVoicePreset();rowEditors.clear();cutImages.clear();$('rows').replaceChildren();if(!state.rows.length)$('rows').append(element('div','最初の「台本と素材」で台本を用意すると、ここに表示されます。',{class:'empty'}));
    state.rows.forEach((r,index)=>{
      const box=element('article',undefined,{class:'row','data-row-id':r.id}),head=element('div',undefined,{class:'row-head'});head.append(element('strong',String(index+1).padStart(2,'0')+'カット'),element('span',r.cutVisual?.title||r.scene||'ナレーション'),element('span',r.reviewed?'読み確認済み':'読み未確認'));box.append(head);const imageBox=element('figure',undefined,{class:'cut-image-box'});imageBox.hidden=true;cutImages.set(r.id,imageBox);const content=element('div',undefined,{class:'cut-review-content'}),copy=element('div',undefined,{class:'cut-review-copy'});content.append(imageBox,copy);box.append(content);
      if(r.readingPreparationRequired)box.append(element('p','この読みは要修正の候補です。ひらがなの読みと文の対応を直してください。台本の再生成は不要です。',{class:'help error'}));
      const captionParts=sentences(r.caption),speechParts=sentences(r.speech),pairs=[],editor={id:r.id,box,pairs,baseline:r};rowEditors.set(r.id,editor);if(r.audio){const preview=element('audio',undefined,{controls:'',preload:'metadata',src:'/audio/'+r.audio.file,'aria-label':`${index+1}カットの音声`,class:'cut-audio'});copy.append(preview);if(!r.audioCurrent)copy.append(element('p','修正前の音声です。本文の変更を反映するには再合成します。',{class:'help'}));}else copy.append(element('p','このカットの音声はまだ作成されていません。',{class:'help'}));
      for(let n=0;n<Math.max(captionParts.length,speechParts.length);n++){
        const grid=element('div',undefined,{class:'row-grid sentence-pair'}),cap=element('textarea',undefined,{rows:2,'aria-label':`${index+1}場面・${n+1}文目の字幕`}),speech=element('textarea',undefined,{rows:2,'aria-label':`${index+1}場面・${n+1}文目の読み上げ文`});cap.value=captionParts[n]||'';speech.value=speechParts[n]||'';const pair={cap,speech,saved:{caption:cap.value,speech:speech.value},commit:element('button','この文の変更を保存',{type:'button',class:'secondary sentence-confirm','data-commit-sentence':r.id+':'+n})};pairs.push(pair);pair.commit.addEventListener('click',guarded(async()=>{await pending(async()=>{state=await api('status');await saveEditor(editor,pair);});message('この文の修正を保存しました。全文の読みは一括で確定できます。');}));grid.append(element('span',`${n+1}文目`,{class:'sentence-number'}));
        for(const [label,input]of [['字幕（表示用）',cap],['読み上げ文（ひらがな・音声用）',speech]]){const l=element('label',label);l.append(input);grid.append(l);input.addEventListener('input',()=>{box.dataset.dirty='true';approve.disabled=true;fitSentencePair(cap,speech);updateControls();});input.disabled=state.busy||isFinalized();}
        grid.append(pair.commit);copy.append(grid);
      }
      if(captionParts.length!==speechParts.length)copy.append(element('p','字幕と読みの文数が違います。前後の対応を確認して修正してください。',{class:'help'}));
      const uniqueHints=[...new Map(r.hints.map(h=>[h.kind+':'+h.term,h])).values()];if(uniqueHints.length){const disclosure=element('details',undefined,{class:'reading-hints'});disclosure.open=false;disclosure.append(element('summary',`読みの確認候補 ${uniqueHints.length}語`),element('p','読み間違いと判定した一覧ではありません。発音を確かめたい英字・数字・漢字です。読み上げ欄をひらがなに直すと候補は減ります。',{class:'help'}));const hints=element('div',undefined,{class:'hints'});for(const h of uniqueHints)hints.append(element('span',`${h.term} · ${h.kind==='latin'?'英字':h.kind==='number'?'数字':'漢字'}`,{class:'hint'}));disclosure.append(hints);copy.append(disclosure);}
      const actions=element('div',undefined,{class:'row-actions'}),save=editor.save=element('button','変更を保存',{type:'button',class:'secondary'}),approve=editor.approve=element('button',r.reviewed?'読み確認済み':'このカットだけ読みを確定（任意・APIなし）',{type:'button',class:'secondary','data-approve':r.id});approve.disabled=r.reviewed||state.busy;save.disabled=state.busy||isFinalized();
      save.addEventListener('click',guarded(async()=>{await pending(async()=>{state=await api('status');await saveEditor(editor);});message('変更を保存しました。読みを確認し直してください。');}));
      approve.addEventListener('click',guarded(async()=>{await pending(async()=>{state=await api('status');await saveEditor(editor);render(await api('approve',{id:r.id,revision:state.revision}),true);});message('この場面の修正と読みを確定しました。');}));actions.append(save,approve);
      const instructionLabel=element('label','このカットへの修正指示'),instruction=editor.instruction=element('textarea',undefined,{rows:3,maxlength:2000,'aria-label':`${index+1}カットへの修正指示`,placeholder:'例：この名前の読みを直して。説明を短くして。画像を台本に合わせて。'});instruction.value=dirtyFields.has('review')?(cutInstructions.get(r.id)||''):(state.production?.review?.cuts?.find(c=>c.rowId===r.id)?.instruction||'');cutInstructions.set(r.id,instruction.value);instruction.addEventListener('input',()=>{cutInstructions.set(r.id,instruction.value);dirtyFields.add('review');updateControls();});instructionLabel.append(instruction);
      const applyCut=element('button','このカットの修正指示を送信・反映（API利用）',{type:'button',class:'secondary','data-apply-review':r.id});applyCut.addEventListener('click',guarded(()=>applyReview(r.id),'review-request-state'));
      if(r.attempts>0){const generate=element('button','このカットの音声を作り直す',{type:'button','data-generate':r.id,class:'secondary'});generate.addEventListener('click',guarded(async()=>{if(isDirty())throw new Error('STALE_REVISION');if(!window.confirm('このカットをGoogleへ再送し、追加の音声合成を1回行います。続けますか？'))return;await api('generate',{ids:[r.id],consent:true,regenerate:true});render(await api('status'),true);message('このカットの音声作成を開始しました。');}));actions.append(generate);}
      copy.append(actions,instructionLabel,applyCut,element('p','修正指示は最後にまとめて反映できます。音声・画像を見直し、最後のボタンで全カットを一括確認します。',{class:'help'}));$('rows').append(box);for(const pair of pairs)fitSentencePair(pair.cap,pair.speech);
    });
    $('dictionary-list').replaceChildren(...state.dictionary.map((item,i)=>{const chip=element('span',`${item.term} → ${item.reading}`,{class:'dictionary-chip'}),remove=element('button','×',{type:'button','aria-label':`${item.term}を辞書から削除`});remove.addEventListener('click',guarded(async()=>render(await api('dictionary',{items:state.dictionary.filter((_,n)=>n!==i)}),true)));chip.append(remove);return chip;}));lastRevision=state.revision;
  }
  for(const id of ['model','voice','voice-preset','style','add-row','save-title','job-title','term','pronunciation','apply-dictionary'])$(id).disabled=state.busy||isFinalized();
  for(const id of ['api-key','clear-key'])$(id).disabled=state.busy;
  $('theme').disabled=state.busy||localBusy;updateCutImages();renderExtras();updateControls();
  if(state.error){message(errors[state.error.split(':')[0]]||state.error,true);}else if(wasBusy&&!state.busy&&!localBusy)message(state.progress?.phase?'修正処理が終了しました。変更したカットを見直してください。':state.rows.some(r=>r.audioCurrent)?'処理が終了しました。作成済みの音声は④で試聴できます。':'処理が終了しました。');wasBusy=state.busy;maybeAdvanceAudio();
}
$('key-form').addEventListener('submit',guarded(async()=>{const key=$('api-key').value;$('api-key').value='';render(await api('key',{key}),true);$('api-settings').open=false;message('キーをメモリに設定しました。「API接続を確認（生成なし）」で認証とモデルを確認できます。');}));
$('clear-key').addEventListener('click',guarded(async()=>{const cleared=await api('key',{clear:true});try{window.sessionStorage?.setItem('narration-had-key','no');}catch{}render(cleared,true);message('キーを解除しました。');}));
for(const id of ['model','voice','style','pitch','job-title'])$(id).addEventListener('input',()=>{if(id==='job-title'){dirtyFields.add('title');$('title-mode').value='manual';}else{markSettingsDirty();$('voice-mode').value='manual';}dirtyFields.add('production');syncVoicePreset();refreshSampleAudio();updateControls();});
function chooseVoice(value){$('voice-mode').value='manual';dirtyFields.add('production');if(value==='custom'){customMode=true;syncVoicePreset();return;}const legacy=voicePresets[value];const config=legacy?{model:$('model').value,...legacy}:allPresets().find(p=>p.model+'::'+p.voice===value);if(!config)throw new Error('INVALID_VOICE_PRESET');customMode=false;$('model').value=config.model;$('voice').value=config.voice;$('style').value=config.style;markSettingsDirty();syncVoicePreset();refreshSampleAudio();updateControls();message('声と話し方を選びました。サンプルを試聴し、「この声で全文確認へ」で保存します。');}
$('voice-preset').addEventListener('change',guarded(()=>chooseVoice($('voice-preset').value)));
$('voice-manual').addEventListener('change',guarded(()=>{if(state.busy||localBusy||state.video?.running||isFinalized())throw new Error('BUSY');$('voice-mode').value=$('voice-manual').checked?'manual':'auto';dirtyFields.add('production');updateVoiceChoice(true);refreshSampleAudio();updateControls();}));
$('settings-form').addEventListener('submit',guarded(()=>goStep('reading')));$('apply-voice').addEventListener('click',guarded(()=>goStep('reading')));for(const link of document.querySelectorAll('[data-go-step]'))link.addEventListener('click',guarded(()=>goStep(link.dataset.goStep)));
function editableJob(){return {title:$('job-title').value,settings:state.settings,dictionary:state.dictionary,rows:state.rows.map(({id,caption,speech,scene})=>({id,caption,speech,scene}))};}
$('add-row').addEventListener('click',guarded(()=>{throw new Error('MANUAL_CUT_EDITOR_REQUIRED');}));
$('save-title').addEventListener('click',guarded(async()=>{const next=await api('title',{title:$('job-title').value});dirtyFields.delete('title');render(next,true);message('タイトルを反映しました。');}));
$('dictionary-form').addEventListener('submit',guarded(async()=>{const next=await api('dictionary',{items:[...state.dictionary,{term:$('term').value,reading:$('pronunciation').value}]});$('term').value='';$('pronunciation').value='';render(next,true);message('読み辞書に追加しました。');}));
$('apply-dictionary').addEventListener('click',guarded(async()=>{render(await api('apply-dictionary',{}),true);message('辞書を反映しました。変更された行を確認し直してください。');}));
$('generate-all').addEventListener('click',guarded(async()=>{
 if(state.busy||localBusy||isFinalized()||hasCorrections())throw new Error('BUSY');
 if(isDirty()||state.rows.some(r=>!r.reviewed))throw new Error('READING_REVIEW_REQUIRED');if(dirtyFields.has('settings')||!state.voiceConfirmed)throw new Error('VOICE_CONFIRMATION_REQUIRED');
 if(state.production?.musicEnabled!==true)await pending(enableAutomaticMusic);
 if(state.rows.length&&state.rows.every(r=>r.audioCurrent)&&!isDirty()&&(!musicEnabled()||(state.production?.music&&state.musicCurrent))){await pending(async()=>{await api('render-preview',{revision:state.revision,productionRevision:state.productionRevision});render(await api('status'),true);});window.location.hash='#finish';$('finish').scrollIntoView?.({block:'start'});return;}
 if(isDirty()||state.rows.some(r=>!r.reviewed))throw new Error('READING_REVIEW_REQUIRED');if(dirtyFields.has('settings')||!state.voiceConfirmed)throw new Error('VOICE_CONFIRMATION_REQUIRED');await pending(async()=>{await savePlanning();});if(state.rows.some(r=>!r.audioCurrent&&r.attempts>0))throw new Error('REGENERATION_CONFIRM_REQUIRED');
 await pending(async()=>{const ids=state.rows.filter(r=>!r.audioCurrent).map(r=>r.id),createMusic=musicEnabled()&&(!state.production?.music||!state.musicCurrent);await api('generate',{ids,consent:true,revision:state.revision,productionRevision:state.productionRevision,regenerate:false,createMusic,createVideo:true,musicDirection:''});advanceAfterAudio=true;render(await api('status'),true);});maybeAdvanceAudio();message('音声'+(musicEnabled()?'・BGM':'')+'・動画の作成を開始しました。完了後に④で確認できます。');
}));
async function undoReading(){await pending(async()=>{const next=await api('unapprove',{revision:state.revision});render(next);});actionMessage('cancel-status','読みの確定を取り消しました。台本・素材・音声を保持して、編集に戻れます。');}
$('unconfirm-script').addEventListener('click',guarded(undoReading,'cancel-status'));
$('generation-next').addEventListener('click',()=>{$('generation-tools').scrollIntoView?.({block:'start'});$('generate-all').focus?.();});
for(const button of document.querySelectorAll('[data-cancel]'))button.addEventListener('click',guarded(async()=>{
 pauseStep=button.dataset.step||workflowSteps.find(step=>window.location.hash==='#'+step)||'planning';pauseRequested=true;artworkDrafts.clear();visualDrafts.clear();for(const media of document.querySelectorAll('audio,video'))media.pause();
 if(!state.busy&&!state.video?.running){syncWorkflow();updateControls();return;}
 cancelRequested=true;updateControls();try{render(await api('cancel',{}));actionMessage('cancel-status',state.busy||state.video?.running?'中止を要求しました。処理の終了を待ってから制作を中断します。':'処理を中止しました。台本・素材・音声は保持しています。');}catch(error){pauseRequested=false;cancelRequested=false;updateControls();throw error;}
},'cancel-status'));
$('resume-workflow').addEventListener('click',()=>{workflowPaused=false;try{window.sessionStorage?.removeItem('narration-paused:'+workflowProject);}catch{}updateControls();window.location.hash='#'+pauseStep;$(pauseStep).scrollIntoView?.({block:'start'});actionMessage('cancel-status','制作を再開しました。入力内容と確定状態はそのままです。');});
$('review-overall').addEventListener('input',()=>{dirtyFields.add('review');updateControls();$('review-request-state').textContent='修正指示：未保存';});
function currentReview(){return {version:1,sourceRevision:state.revision,overall:$('review-overall').value,cuts:state.rows.map(r=>({rowId:r.id,instruction:cutInstructions.get(r.id)||''})).filter(c=>c.instruction.trim())};}
async function applyReview(id){if(isDirty())throw new Error('STALE_REVISION');const review=currentReview();correctionOutcome='修正指示を送信・反映しています…';try{await pending(async()=>{const next=await api('apply-review',{review,id,expectedRevision:state.revision,consent:true});dirtyFields.delete('review');cutInstructions.clear();render(next,true);const ids=next.correctionResult.ids,ordered=state.rows.filter(r=>ids.includes(r.id)),numbers=ordered.map(r=>String(state.rows.indexOf(r)+1).padStart(2,'0')+'カット');correctionOutcome=numbers.join(' → ')+'を修正しました。変更した読みを確認し、必要な音声を作り直してから再試聴してください。';actionMessage('review-request-state',correctionOutcome);rowEditors.get(ordered[0]?.id)?.box.scrollIntoView?.({block:'start'});});}catch(error){correctionOutcome=errors[error.message.split(':')[0]]||'修正できませんでした。元の素材と指示は保持しています。';throw error;}}
$('apply-review').addEventListener('click',guarded(()=>applyReview(),'review-request-state'));
$('save-review').addEventListener('click',guarded(async()=>{await pending(async()=>{const review={version:1,sourceRevision:state.revision,overall:$('review-overall').value,cuts:state.rows.map(r=>({rowId:r.id,instruction:cutInstructions.get(r.id)||''})).filter(c=>c.instruction.trim())};const next=await api('review',{review,expectedRevision:state.revision});dirtyFields.delete('review');render(next);});message('修正指示を下書き保存しました。送信・反映ボタンでまとめて反映できます。');}));
$('clear-review').addEventListener('click',guarded(async()=>{await pending(async()=>{const next=await api('review',{review:{version:1,sourceRevision:state.revision,overall:'',cuts:[]},expectedRevision:state.revision});dirtyFields.delete('review');cutInstructions.clear();render(next);});message('修正指示を取り消しました。台本と音声はそのまま保持しています。');}));
function renderImageProposal(){
 const proposal=state.imageProposal,busy=state.busy||localBusy||isDirty()||dirtyFields.has('production'),pending=proposal?.scenes.filter(s=>s.imagePrompt).length||0;
 $('image-planning').hidden=isFinalized()||!state.rows.length;$('image-proposal').replaceChildren();
 const ready=state.rows.filter(r=>r.id!==state.production?.bookends?.titleRowId).every(r=>r.cutImage||state.production?.brief.storyboard?.scenes.find(s=>s.caption===r.caption&&!s.imageFile&&!s.imagePrompt));
 $('plan-images').hidden=!!proposal&&!pending||!proposal&&ready;$('plan-images').disabled=busy||!state.keyConfigured;
 $('plan-images').textContent=pending?'残りの画像'+pending+'枚を準備（API利用）':'AIに画像を準備してもらう（不足画像を生成）';
 $('approve-images').hidden=!proposal;$('approve-images').disabled=busy||!!pending;$('approve-images').textContent='表示した画像をまとめて採用（APIなし）';
 $('image-plan-status').textContent=pending?'未準備の画像が'+pending+'枚あります。生成できた候補は各カットに表示しています。':proposal?'各カットに生成・選択済みの画像を表示しています。画像を見て採用するか、気になるカットだけ再生成・差し替えできます。':ready?'画像は選択済みです。各カットで字幕・読みとの対応を確認し、必要なら変更してください。':'画像を準備すると、各カットに実画像が表示されます。準備時に台本・参照素材をGoogleへ送信し、不足画像1枚につき生成APIを1回使用します。';
}
async function planImages(){if(isDirty()||dirtyFields.has('production'))throw new Error('STALE_REVISION');await pending(async()=>render(await api('prepare-images',{revision:state.revision,productionRevision:state.productionRevision,consent:true}),true));$('image-planning').scrollIntoView?.({block:'start'});}
async function adoptImages(id){if(id?cutImageInputsDirty(id):[...rowEditors.keys()].some(cutImageInputsDirty))throw new Error('STALE_REVISION');const proposal=state.imageProposal;if(!proposal)throw new Error('STALE_IMAGE_PROPOSAL');await pending(async()=>render(await api('approve-images',{id,proposalId:proposal.id,revision:state.revision,productionRevision:state.productionRevision,consent:true}),true));message('確認した画像を採用しました。台本と音声は保持しています。');}
async function regenerateImage(id){if(cutImageInputsDirty(id))throw new Error('STALE_REVISION');const draft=artworkDrafts.get(id)||{};await pending(async()=>render(await api('regenerate-image',{id,instructions:draft.prompt||'',...(draft.references?.length?{references:draft.references}:{}),revision:state.revision,productionRevision:state.productionRevision,consent:true}),true));message('このカットの新しい候補を用意しました。画像を見て採用してください。');}
$('plan-images').addEventListener('click',guarded(()=>planImages()));$('approve-images').addEventListener('click',guarded(()=>adoptImages()));
async function approveReadings(){
 if(state.busy||localBusy||isFinalized())throw new Error('BUSY');
 const editors=[...rowEditors.values()],expected=editors.map(e=>({id:e.id,...editorText(e)}));
 await pending(async()=>{
  state=await api('status');
  for(const editor of editors){const current=state.rows.find(r=>r.id===editor.id);if(!current||!textMatches(current,editor.baseline))throw new Error('STALE_REVISION');}
  for(const editor of editors)await saveEditor(editor);
  const editedTitle=dirtyFields.has('bookends'),titleId=state.production?.bookends?.titleRowId;
  const addedTitle=editedTitle?await saveTitleReading():await adoptPreparedTitle();
  if(editedTitle&&titleId){const title=state.rows.find(r=>r.id===titleId),previous=expected.find(r=>r.id===titleId);if(previous)Object.assign(previous,{caption:title.caption,speech:title.speech});}
  state=await api('status');
  if(state.rows.length!==expected.length+(addedTitle?1:0)||state.rows.some(r=>!expected.some(e=>e.id===r.id)&&r.id!==addedTitle)||expected.some(e=>{const row=state.rows.find(r=>r.id===e.id);return !row||!textMatches(row,e);}))throw new Error('STALE_REVISION');
  for(const row of state.rows)if(!row.reviewed)render(await api('approve',{id:row.id,revision:state.revision}),true);
  render(state,true);
 });message('全文の修正と読みを確定しました。音声の変更は再合成で反映できます。');
}
$('confirm-script').addEventListener('click',guarded(approveReadings));
$('confirm-full').addEventListener('click',guarded(async()=>{if(isDirty()||hasCorrections()||state.busy||localBusy)throw new Error('STALE_REVISION');if(state.video?.result?.reviewState==='pending'){if(!window.confirm('完成した動画と音声を確認しました。この版を確定しますか？'))return;await pending(async()=>render(await api('confirm-video',{revision:state.revision,productionRevision:state.productionRevision,confirmReviewed:true}),true));message('完成した動画と音声を確認済みとして確定しました。');return;}if(!isFinalized()){await pending(async()=>{await api('render-preview',{revision:state.revision,productionRevision:state.productionRevision});render(await api('status'),true);});return;}if(isFinalized()){await api('render-video',{revision:state.revision});render(await api('status'),true);return;}if(!window.confirm('全カットの画像・字幕・読み・音声・BGMを確認OKとして、動画と単独音声を生成・保存します。確定後はこの版は編集終了になります。後から修正版を作って各工程へ戻れます。続けますか？'))return;await pending(async()=>{for(const row of state.rows.filter(r=>!isCutConfirmed(r)))render(await api('confirm-cut',{id:row.id,revision:state.revision,fingerprint:row.cutFingerprint}),true);render(await api('finalize',{revision:state.revision,confirmIrreversible:true}),true);await api('render-video',{revision:state.revision});render(await api('status'),true);});window.location.hash='#finish';$('finish').scrollIntoView?.({block:'start'});message('全カットを確認OKとして動画生成を開始しました。ここで生成状況と完成動画を確認できます。');}));
$('theme').addEventListener('change',guarded(async()=>{const name=$('theme').value;if(isFinalized()){screenTheme=name;applyTheme(name);message('画面の配色を変更しました。完成済み動画はそのままです。');}else{screenTheme=undefined;render(await api('presentation',{theme:name}),true);message('配色を反映しました。');}}));
async function changeProject(route,input={}){
 if(hasUserEdits())throw new Error('編集中の内容を保存してから切り替えてください');
 if(state.busy||localBusy||state.video?.running)throw new Error('BUSY');
 await pending(async()=>{
  const next=await api(route,{...input,sessionId:state.sessionId,revision:state.revision});const boot=await api('bootstrap');token=boot.token;instanceId=boot.instanceId;
  artworkDrafts.clear();visualDrafts.clear();for(const media of document.querySelectorAll('audio,video'))media.pause();
  $('video-player').removeAttribute('src');
  for(const id of ['preview-consent','design-consent','bank-consent'])$(id).checked=false;
  dirtyFields.clear();projectChanged=false;scriptEdited=false;pendingScriptAction=undefined;$('script-confirm').hidden=true;productionBaseline=undefined;directionProposal=undefined;advanceAfterAudio=false;correctionOutcome='';draftOutcome='';cancelRequested=false;scriptReadings=undefined;storyboard=undefined;$('save-status').textContent='指示・素材の使い方・台本案を保存します。APIは使いません。';cutInstructions.clear();designChoice=undefined;designPreviewOnly=false;customMode=false;screenTheme=undefined;lastRevision='';lastKeyConfigured=undefined;
  render(next,true);
 });
 message(route==='new-project'?'新しい動画を開始しました。デザイン、素材、台本を用意してください。':route==='revision-project'?'現在の制作を修正版にしました。ダウンロード済みの完成動画は保持します。':'現在の制作を更新しました。');
 if(route==='new-project'){window.location.hash='#top';$('new-project').focus?.({preventScroll:true});window.scrollTo?.({top:0,left:0,behavior:'instant'});}
 else{window.location.hash='#planning';$('planning').scrollIntoView?.({block:'start'});}
}
$('new-project').addEventListener('click',guarded(async()=>changeProject('new-project',{discardPrevious:true})));
$('new-project-bottom').addEventListener('click',guarded(async()=>changeProject('new-project',{discardPrevious:true})));
$('revise-project').addEventListener('click',guarded(async()=>changeProject('revision-project')));
for(const button of document.querySelectorAll('[data-revise-step]'))button.addEventListener('click',guarded(async()=>{const step=button.dataset.reviseStep;if(isFinalized())await changeProject('revision-project');window.location.hash='#'+step;updateControls();$(step).scrollIntoView?.({block:'start'});message('修正版でこの工程を編集できます。元の動画と音声は保持しています。');}));
 $('design-mode').addEventListener('change',()=>{designChoice={...designChoice,mode:$('design-mode').value};designPreviewOnly=isFinalized();if(!isFinalized())dirtyFields.add('design');updateControls();});
 $('design-instructions').addEventListener('input',()=>{dirtyFields.add('design');updateControls();});
 $('design-consent').addEventListener('change',updateControls);
 $('apply-design').addEventListener('click',guarded(async()=>{await pending(async()=>{const next=await api('presentation',{revision:state.revision,presentation:{...(state.presentation.explainScenes?{explainScenes:state.presentation.explainScenes}:{}),theme:state.presentation.theme,mode:'template',template:designChoice.template,motion:savedMotion()}});dirtyFields.delete('design');designPreviewOnly=false;render(next);});message('動画に使うデザインを決定しました。次は素材と台本を用意してください。');}));
 for(const id of ['motion-style','motion-intensity'])$(id).addEventListener('change',()=>{dirtyFields.add('motion');$('motion-preview').classList.remove('motion-playing');$('play-motion').textContent='動きの見本を再生';updateControls();});
 $('explain-scenes').addEventListener('change',guarded(async()=>{const explainScenes=$('explain-scenes').checked?'auto':'off';await pending(async()=>render(await api('presentation',{revision:state.revision,presentation:{...state.presentation,explainScenes}}),true));message('図解の表示を保存しました。音声や画像の再生成はありません。');}));
 $('apply-motion').addEventListener('click',guarded(async()=>{await pending(async()=>{const next=await api('presentation',{revision:state.revision,presentation:{...state.presentation,motion:selectedMotion()}});dirtyFields.delete('motion');render(next);});message('演出を保存しました。台本・画像・音声の再生成はありません。');}));
 $('play-motion').addEventListener('click',()=>{const preview=$('motion-preview');if(preview.classList.contains('motion-playing')){preview.classList.remove('motion-playing');$('play-motion').textContent='動きの見本を再生';return;}preview.classList.add('motion-playing');$('play-motion').textContent='見本を停止';});
 $('motion-preview').addEventListener('animationend',event=>{if(event.animationName==='motion-orbit'){ $('motion-preview').classList.remove('motion-playing');$('play-motion').textContent='動きの見本を再生';}});
 $('draft-design').addEventListener('click',guarded(async()=>{designGenerating=true;try{await pending(async()=>{const next=await api('design-draft',{revision:state.revision,instructions:$('design-instructions').value,consent:$('design-consent').checked});dirtyFields.delete('design');designPreviewOnly=false;render(next);});message('AIが今回用に作ったデザインを保存しました。見本を確認できます。');}finally{designGenerating=false;updateControls();}}));
$('api-required-dismiss').addEventListener('click',guarded(()=>{$('api-key').focus();}));
try{const boot=await api('bootstrap');token=boot.token;instanceId=boot.instanceId;themes=await api('themes');designs=await api('designs');buildDesignGallery();render(await api('status'),true);message(isFinalized()?'この動画は最終確定済みです。完成動画を再生・保存できます。':!state.keyConfigured?'画面上部でGemini APIキーを登録してください。':state.rows.length&&state.rows.every(r=>r.reviewed&&r.audioCurrent)?'各カットの画像と音声を確認してください。':state.rows.length?'台本と本番の声を確認して、音声・動画をまとめて作成してください。':'デザイン、素材、台本を用意してください。');setInterval(async()=>{try{const next=await api('status');if(next.projectId!==state.projectId){projectChanged=true;message('別のタブまたはバッチで制作が切り替わりました。この画面の入力は保持しています。再読み込みすると現在の制作を開きます。',true);return;}if(next.instanceId!==instanceId){const fresh=await api('bootstrap');token=fresh.token;instanceId=fresh.instanceId;message('サーバーに再接続しました。未保存の編集は保持しています。'+(next.keyConfigured?'':'APIキーを画面上部で登録してください。')+'');}render(next);}catch{message('ローカルの接続が切れました。Codexにこの画面の再開を依頼してください。',true);}},2000);}catch{message('設定画面を読み込めません。ローカルサーバーの状態を確認してください。',true);}

function renderExtras(){
  const missing=missingPresets(),total=allSamplePresets().length,progress=state.sampleProgress,standard=allSamplePresets().filter(config=>!config.pitch||config.pitch==='standard'),standardSaved=standard.filter(config=>(state.samples||[]).some(s=>sameSettings(s.settings,config))).length;
  $('sample-progress').textContent=progress?.running?`サンプル準備：${progress.completed} / ${progress.total} · ${progress.settings?.voice||''} / ${progress.settings?.model?modelLabel(progress.settings.model):''} / ${progress.settings?.pitch==='low'?'低め':progress.settings?.pitch==='high'?'高め':'標準'}`:`保存済みサンプル：${total-missing.length} / ${total}件（標準 ${standardSaved}/${standard.length}・低め／高め ${total-missing.length-standardSaved}/${total-standard.length}）`;
  $('bank-tools').hidden=missing.length===0&&!progress?.running;
  $('prepare-samples').disabled=state.busy||localBusy||!state.keyConfigured||!$('bank-consent').checked||!missing.length;
  $('prepare-samples').textContent=`不足する${missing.length}件のサンプルを用意`;

  const production=state.production;
  if(!dirtyFields.has('review')){$('review-overall').value=production?.review?.overall||'';for(const [id,editor]of rowEditors){const note=production?.review?.cuts?.find(c=>c.rowId===id)?.instruction||'';cutInstructions.set(id,note);editor.instruction.value=note;}}$('review-request-state').textContent=state.busy&&state.progress?.phase?state.progress.phase:dirtyFields.has('review')?'修正指示：未保存':hasCorrections()?'修正指示：保存済み · 送信・反映ボタンで反映できます。':correctionOutcome||'修正指示はありません。';
  if(production&&!dirtyFields.has('production')){const b=production.brief;scriptEdited=b.scriptEdited===true;$('theme-auto').checked=b.themeAuto===true;$('script-mode').value=b.scriptMode;$('asset-mode').value=b.assetMode;$('production-instructions').value=b.instructions;$('script-input').value=b.scriptEdited?b.script:(b.script||state.rows.map(r=>r.caption).join('\n'));scriptReadings=b.readings;storyboard=b.storyboard;directionProposal=b.direction||((b.storyboard?.template)?{title:b.storyboard.title,template:b.storyboard.template,motion:b.storyboard.motion}:undefined);$('auto-direction').checked=b.autoDirection??(b.titleMode!=='manual'&&!state.rows.length);$('source-text').value=b.references?.text||'';$('source-urls').value=(b.references?.urls||[]).join('\n');$('title-mode').value=b.titleMode||'auto';$('voice-mode').value=b.voiceMode||'auto';renderSourceSummary();}
  $('brief-state').textContent=dirtyFields.has('production')?'制作条件：未保存':'制作条件：保存済み';
  $('material-list').replaceChildren(...(production?.assets||[]).map(a=>{const item=element('div');item.append(element('a',a.name+' · '+(a.size/1024/1024).toFixed(2)+' MB',{href:'/materials/'+a.file,download:a.name}));if(!isFinalized()&&a.file!==production?.music?.file){const remove=element('button','素材一覧から削除',{type:'button',class:'quiet','aria-label':a.name+'を素材一覧から削除'});remove.disabled=!!(state.busy||localBusy);remove.addEventListener('click',guarded(async()=>{if(isDirty())throw new Error('STALE_REVISION');await pending(async()=>render(await api('remove-material',{file:a.file,revision:state.revision,productionRevision:state.productionRevision}),true));message('素材一覧から外しました。元のファイルは保持しています。');}));item.append(remove);}return item;}));
  if(state.unsavedDraft&&!dirtyFields.has('production')){const draft=state.unsavedDraft.result;scriptEdited=true;$('script-input').value=draft.script;scriptReadings=draft.readings;storyboard=draft.storyboard;directionProposal=draft.direction;dirtyFields.add('production');$('save-draft-result').hidden=false;actionMessage('source-status','生成結果は保持していますが未保存です。保存し直してください。',true);}
  refreshSampleAudio();
}
for(const id of ['source-text','source-urls','title-mode','voice-mode','script-mode','asset-mode','production-instructions','script-input'])$(id).addEventListener('input',()=>{if(!dirtyFields.has('production'))productionBaseline=state.productionRevision;dirtyFields.add('production');$('brief-state').textContent='制作条件：未保存';updateControls();});
$('preview-consent').addEventListener('change',updateControls);
$('bank-consent').addEventListener('change',()=>{renderExtras();updateControls();});
$('prepare-samples').addEventListener('click',guarded(async()=>{if(!$('bank-consent').checked)throw new Error('GENERATION_CONSENT_REQUIRED');const missing=missingPresets().length;await api('prepare-samples',{consent:true});render(await api('status'));if(!state.error)message(`不足する${missing}件のサンプルを準備しています。完成分は保存し、画面を移動しても処理を続けます。`);}));
$('voice').addEventListener('change',()=>{const demo=(state.samples||[]).filter(i=>i.settings.voice===$('voice').value&&(i.settings.pitch||'standard')===($('pitch').value||'standard')).sort((a,b)=>(a.settings.model===$('model').value?-1:1)-(b.settings.model===$('model').value?-1:1)||a.durationSeconds-b.durationSeconds)[0];if(demo){$('style').value=demo.settings.style;markSettingsDirty();syncVoicePreset();}refreshSampleAudio();updateControls();});
async function savePlanning(){
 if(isFinalized())return;
 if(state.production?.musicEnabled===undefined&&!state.rows.length)render(await api('music-preference',{enabled:true,revision:state.revision,productionRevision:state.productionRevision}),true);
 if(dirtyFields.has('title')){const next=await api('title',{title:$('job-title').value});dirtyFields.delete('title');render(next,true);}
 if(dirtyFields.has('design')){if(designChoice.mode==='ai'&&!state.presentation?.design)throw new Error('CUSTOM_DESIGN_REQUIRED');const presentation=designChoice.mode==='template'?{...(state.presentation.explainScenes?{explainScenes:state.presentation.explainScenes}:{}),theme:state.presentation.theme,mode:'template',template:designChoice.template,...(Object.hasOwn(state.presentation,'motion')?{motion:state.presentation.motion}:{})}:{...state.presentation,mode:'ai',instructions:$('design-instructions').value};const next=await api('presentation',{presentation,revision:state.revision});dirtyFields.delete('design');render(next,true);}
 if(dirtyFields.has('motion')){const next=await api('presentation',{presentation:{...state.presentation,motion:selectedMotion()},revision:state.revision});dirtyFields.delete('motion');render(next,true);}
 if(dirtyFields.has('production')){const next=await api('production',currentBrief());dirtyFields.delete('production');render(next);}
}
function preparedTitleReading(){
 const brief=state.production?.brief,prepared=brief?.titleReading,row=state.rows.find(r=>r.id===state.production?.bookends?.titleRowId);
 if(!prepared||dirtyFields.has('title')||row&&row.caption!==prepared.caption)return;
 if(prepared.caption===state.title)return prepared;
 const body=state.rows.filter(r=>r.id!==state.production?.bookends?.titleRowId);
 if(brief.autoDirection===true&&brief.titleMode!=='manual'&&body.length&&parseScriptParts(brief.script).join('\n')===body.map(r=>r.caption.trim()).join('\n'))return prepared;
}
async function adoptPreparedTitle(){
 const prepared=preparedTitleReading();
 if(!prepared||!prepared.speech||dirtyFields.has('bookends')||isFinalized())return;
 const b=state.production?.bookends,row=state.rows.find(r=>r.id===b?.titleRowId);
 if(row?.caption===prepared.caption&&(!row.readingPreparationRequired||row.speech===prepared.speech))return;
 if(state.title!==prepared.caption)render(await api('title',{title:prepared.caption}),true);
 render(await api('bookends',{title:prepared.caption,speech:prepared.speech,readingCandidate:true,endLabel:b?.endLabel||'ネームから全自動の自律式統合AI漫画システム',endUrl:b?.endUrl||'https://note.com/happy_duck780',owner:b?.owner||'FURU',endSeconds:b?.endSeconds||4,revision:state.revision,productionRevision:state.productionRevision}),true);
 return b?.titleRowId?undefined:state.production?.bookends?.titleRowId;
}
async function saveVoice(){if(isFinalized())return;const next=await api('settings',selectedSettings());dirtyFields.delete('settings');render(next,true);}
async function goStep(step){if(state.busy||localBusy||state.video?.running)throw new Error('BUSY');if($(step)?.inert)throw new Error('API_KEY_REQUIRED');await pending(async()=>{await savePlanning();if(step==='reading'||step==='finish')await saveVoice();if(step==='reading')await adoptPreparedTitle();});window.location.hash='#'+step;$(step).scrollIntoView?.({block:'start'});}
async function pending(action){localBusy=true;updateControls();try{return await action();}finally{localBusy=false;updateControls();}}
$('preview-voice').addEventListener('click',guarded(async()=>{const existing=cachedSample();if(existing){sampleAudio(existing.id);await $('sample-audio').play();return;}if(!state.keyConfigured)throw new Error('API_KEY_REQUIRED');message('音声サンプルを1回合成しています。');await pending(async()=>{const result=await api('preview',{settings:selectedSettings(),consent:$('preview-consent').checked});render(await api('status'));sampleAudio(result.sample);message('サンプルを保存しました。次回はAPIを使わず再生できます。');});}));
$('save-production').addEventListener('click',guarded(async()=>{productionSaving=true;actionMessage('save-status','制作条件を保存しています…');try{await pending(async()=>{const next=await api('production',currentBrief());dirtyFields.delete('production');render(next);actionMessage('save-status','保存しました。指示・素材の使い方・台本案をこの動画に保存済みです。');});}finally{productionSaving=false;updateControls();}},'save-status'));
async function advanceScript(){
 if(state.busy||localBusy||planningAdvancing)throw new Error('BUSY');
 if(!scriptParts().length||scriptUrls().length)throw new Error('SCRIPT_REQUIRED');
 planningAdvancing=true;actionMessage('script-status','台本と素材を取り込み、声選びの画面を開いています…');
 try{await pending(async()=>{
  let partial=false;try{await savePlanning();}catch(error){if(!['INVALID_REFERENCES','INVALID_REFERENCE_URL','INVALID_PRODUCTION_TEXT'].includes(error.message))throw error;partial=true;}
  if(!directionPending&&directionProposal&&automaticDirectionEnabled()&&scriptParts().join('\n')===parseScriptParts(state.production?.brief?.script).join('\n')){selectDirectionProposal();await savePlanning();}
  const next=await api('adopt-script',{script:$('script-input').value,...(hasScriptReadings()?{readings:scriptReadings}:{}),projectId:state.projectId,instanceId,revision:state.revision,productionRevision:state.productionRevision});if(!partial)dirtyFields.delete('production');render(next);
  actionMessage('script-status',partial?'台本だけを採用しました。参考資料の入力は未保存のまま保持しています。':'台本と準備素材を読み込みました。声を選んだ後、③で絵・字幕・読みを一緒に確認できます。APIは使っていません。');window.location.hash='#connection';$('connection').scrollIntoView?.({block:'start'});
 });}finally{planningAdvancing=false;updateControls();}
}
$('append-script').addEventListener('click',guarded(advanceScript,'script-status'));
function renderSourceSummary(){
 const box=$('storyboard-preview'),sources=storyboard?.sources||state.production?.brief?.sourceEvidence?.sources||[];box.replaceChildren();box.hidden=!sources.length;
 if(sources.length)box.append(element('strong','作成に使った参考資料'));for(const source of sources)box.append(element('p',(source.status==='retrieved'?'URL取得の記録：':'送信資料：')+source.label+' — '+source.summary,{class:'help'}));
}
$('check-connection').addEventListener('click',guarded(async()=>{await pending(async()=>{const result=await api('connection-check',{});actionMessage('connection-status',result.ready?'Geminiの接続と構成作成モデルの利用を確認しました。生成は行っていません。':'接続確認が完了していません。');});},'connection-status'));
$('probe-generation').addEventListener('click',guarded(async()=>{await pending(async()=>{actionMessage('connection-status','素材を含まない最小構成で生成を確認しています…');await api('generation-check',{consent:true});actionMessage('connection-status','最小構成の文章生成に成功しました。素材からの構成作成は別途確認が必要です。');});},'connection-status'));
async function createScript({readingOnly=false}={}){
 await pending(async()=>{
  actionMessage(readingOnly?'reading-prep-status':'source-status','入力を確認して送信を開始しています…');
  if(!readingOnly)await savePlanning();
  if(readingOnly&&isDirty())throw new Error('UNSAVED_READING_EDIT');const brief=readingOnly?{scriptMode:'existing',assetMode:'provided',references:{text:'',urls:[]},instructions:'',autoDirection:false,themeAuto:false,script:state.rows.filter(r=>r.id!==state.production?.bookends?.titleRowId).map(r=>r.caption).join('\n'),readings:undefined,storyboard:undefined,direction:undefined}:currentBrief();
  const operation=readingOnly?'prepare-readings':brief.scriptMode==='mixed'?'rewrite':'compose';
  actionMessage(readingOnly?'reading-prep-status':'source-status',readingOnly?'字幕を送り、ひらがなの読みを用意しています…':'台本・素材の割り当て・不足画像をまとめて準備しています…');
  const sentVersion=scriptDraftVersion,sentProject=state.projectId;
  const result=await api(readingOnly?'prepare-readings':hasSources()?'source-plan':'draft',{brief,operation,requestId:crypto.randomUUID(),sequence:(state.production?.authoring?.lastAttempt?.sequence||0)+1,projectId:state.projectId,instanceId,revision:state.revision,productionRevision:state.productionRevision,consent:true});
  if(result.attempt?.state==='running'){actionMessage(readingOnly?'reading-prep-status':'source-status','同じ作成処理が実行中です。完了後に結果を表示します。');return;}if(!result.script)throw new Error(result.attempt?.error?.code||'DRAFT_RESULT_REQUIRED');
  if(!readingOnly&&scriptDraftVersion!==sentVersion){const next=await api('status');if(next.projectId===sentProject)productionBaseline=next.productionRevision;render(next);actionMessage('source-status','生成結果は保存しました。処理中に編集した結果欄はそのまま保持しています。');return;}
  if(!readingOnly)directionPending=false;scriptEdited=true;$('script-input').value=result.script;scriptReadings=result.readings;storyboard=result.storyboard;directionProposal=result.direction;dirtyFields.delete('production');productionBaseline=undefined;
  const next=await api('status');render(next);if(result.saved===false){$('script-input').value=result.script;scriptReadings=result.readings;dirtyFields.add('production');}
  renderSourceSummary();$('save-draft-result').hidden=result.saved!==false;
  actionMessage('source-status',result.saved===false?'台本案は表示していますが、保存できていません。「生成結果を保存」で保存し直してください。':result.attempt?.error?.stage==='images'?'台本と準備済みの画像は保持していますが、画像準備が途中で失敗しました。失敗したカットだけ再開できます。':result.warnings?.some(w=>['reading','title-reading'].includes(w.stage))?'台本は作成して保存しました。読み候補の一部は要修正です。台本を作り直さず、③で読みだけを修正・確認してください。':result.warnings?.length?'台本を保存しました。未適用の演出は確認してください。声は②で選びます。':'台本を保存しました。下のボタンで取り込み、②で声を選んでください。絵・字幕・読みは③で確認できます。',result.saved===false||result.attempt?.error?.stage==='images');
  if(readingOnly){$('apply-readings-result').hidden=!result.applicationError;actionMessage('reading-prep-status',result.saved===false?'読み候補は表示していますが、保存・反映できていません。①の「生成結果を保存」で保存し直してください。':result.applicationError?'読み候補は保存しましたが、カットへ反映できていません。保存した読みを反映し直せます。':'未確認の読み候補を用意しました。③で確認して読みを確定してください。',result.saved===false||!!result.applicationError);$('rows').focus?.();}else $('script-input').focus?.();
 });
}
async function generateScript(regenerate=false,confirmed=false){if(!state.keyConfigured)throw new Error('API_KEY_REQUIRED');if($('script-mode').value==='existing')throw new Error('SCRIPT_OPERATION_NOT_ALLOWED');if($('script-input').value.trim()&&!confirmed){requestScriptAction(()=>generateScript(regenerate,true),'generate',regenerate?'regenerate-script':'generate-script');return;}await createScript();}
async function confirmPlanning(){await advanceScript({replace:true});}
$('generate-script').addEventListener('click',guarded(()=>generateScript(false),'source-status'));$('regenerate-script').addEventListener('click',guarded(()=>generateScript(true),'source-status'));$('plan-sources').addEventListener('click',guarded(confirmPlanning,'script-status'));
$('prepare-readings').addEventListener('click',guarded(()=>createScript({readingOnly:true}),'reading-prep-status'));
$('save-draft-result').addEventListener('click',guarded(async()=>{render(await api('save-draft-result',{revision:state.revision,productionRevision:state.productionRevision}));dirtyFields.delete('production');$('save-draft-result').hidden=true;actionMessage('source-status','生成結果を保存しました。追加のAPI利用はありません。');},'source-status'));
$('draft-script').addEventListener('click',guarded(()=>generateScript(false),'source-status'));
function receiveMaterialAddition(next,previous){
 const {assets:beforeAssets,...beforeInputs}=previous.production||{}, {assets:afterAssets,...afterInputs}=next.production||{};
 if(productionBaseline===previous.productionRevision&&previous.projectId===next.projectId&&previous.revision===next.revision&&JSON.stringify(beforeInputs)===JSON.stringify(afterInputs))productionBaseline=next.productionRevision;
 render(next);
}
async function uploadMaterials(files){const added=[];await pending(async()=>{for(const file of files){if(file.size>100*1024*1024)throw new Error('ASSET_TOO_LARGE');message('素材をこのPCに保存しています：'+file.name);const previous=state,response=await fetch('/api/material?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Narration-Token':token},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error);const bytes=await file.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');const asset=result.production.assets.find(a=>a.file.startsWith(hash+'.'));if(!asset)throw new Error('INVALID_ASSET');added.push(asset.file);receiveMaterialAddition(result,previous);}message('素材を保存しました。Googleへのアップロードは行っていません。');});return added;}
$('material-files').addEventListener('change',guarded(async()=>{await uploadMaterials($('material-files').files);$('material-files').value='';}));
$('material-drop').addEventListener('dragover',e=>{e.preventDefault();$('material-drop').classList.toggle('dragging',true);});
$('material-drop').addEventListener('dragleave',()=>$('material-drop').classList.toggle('dragging',false));
$('material-drop').addEventListener('drop',guarded(async e=>{ $('material-drop').classList.toggle('dragging',false);if(state.busy||localBusy)throw new Error('BUSY');await uploadMaterials(e.dataTransfer.files);}));
$('material-drop').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('material-files').click();}});

function updateBookendsControls(){
 const b=state.production?.bookends,signature=state.projectId+state.revision+JSON.stringify([b,state.production?.brief.titleReading,preparedTitleReading(),state.title]),busy=state.busy||localBusy||isFinalized();

 for(const id of ['opening-title','opening-speech','save-bookends'])$(id).disabled=!!busy;
 if(!dirtyFields.has('bookends')&&$('bookends-tools').dataset.signature!==signature){
  $('bookends-tools').dataset.signature=signature;const row=state.rows.find(r=>r.id===b?.titleRowId);
  const prepared=preparedTitleReading();$('opening-title').value=row?.caption||prepared?.caption||state.title.replace(/(?:（修正版）)+$/u,'');$('opening-speech').value=row?.speech||(prepared?.caption===$('opening-title').value?prepared.speech:'');
 }
 $('save-bookends').hidden=!dirtyFields.has('bookends');$('bookends-status').textContent='タイトルと本文の読みを一緒に確認します。変更した場合だけ保存してください。末尾のウォーターマークは下のチェックボックスで切り替えられます。';
}
for(const id of ['opening-title','opening-speech'])$(id).addEventListener('input',()=>{dirtyFields.add('bookends');updateControls();});
async function saveTitleReading(){
 const input={title:$('opening-title').value,speech:$('opening-speech').value,endLabel:state.production?.bookends?.endLabel||'ネームから全自動の自律式統合AI漫画システム',endUrl:state.production?.bookends?.endUrl||'https://note.com/happy_duck780',owner:state.production?.bookends?.owner||'FURU',endSeconds:state.production?.bookends?.endSeconds||4,revision:state.revision,productionRevision:state.productionRevision};
 const previousTitle=state.production?.bookends?.titleRowId,next=await api('bookends',input);dirtyFields.delete('bookends');render(next,true);
 if(state.title!==input.title)render(await api('title',{title:input.title}),true);
 return previousTitle?undefined:state.production?.bookends?.titleRowId;
}
$('save-bookends').addEventListener('click',guarded(async()=>{await pending(saveTitleReading);message('タイトルを保存しました。全文の読みを確認して確定してください。');}));
function updateTimingControls(){
 const busy=state.busy||localBusy||isFinalized();
 $('watermark-enabled').checked=state.production?.watermarkEnabled!==false;$('watermark-enabled').disabled=!!(busy||state.video?.running);
 $('cut-pause').disabled=!!busy;$('cut-pause').value=String(state.production?.pauseSeconds??7/30);
}

$('watermark-enabled').addEventListener('change',guarded(async()=>{const enabled=$('watermark-enabled').checked;await pending(async()=>render(await api('watermark-preference',{enabled,revision:state.revision,productionRevision:state.productionRevision}),true));message('末尾のウォーターマークを'+(enabled?'ON':'OFF')+'にしました。音声・BGMは再利用します。');}));
$('cut-pause').addEventListener('change',guarded(async()=>{const seconds=Number($('cut-pause').value);await pending(async()=>render(await api('cut-pause',{seconds,revision:state.revision,productionRevision:state.productionRevision}),true));message('カット間の余白を保存しました。音声・BGMは再利用します。');}));

$('theme-auto').addEventListener('change',()=>{if(!dirtyFields.has('production'))productionBaseline=state.productionRevision;dirtyFields.add('production');updateControls();});
$('script-input').addEventListener('input',()=>{scriptEdited=true;scriptDraftVersion++;});
async function clearScriptDraft(confirmed=false){if(isFinalized())throw new Error('BUSY');if(!$('script-input').value.trim())return;if(!confirmed){requestScriptAction(()=>clearScriptDraft(true),'clear','clear-script');return;}if(!dirtyFields.has('production'))productionBaseline=state.productionRevision;scriptEdited=true;scriptDraftVersion++;$('script-input').value='';scriptReadings=undefined;storyboard=undefined;directionProposal=undefined;dirtyFields.add('production');renderSourceSummary();updateControls();actionMessage('script-edit-status','結果欄を空にしました。そのまま新しい台本を入力できます。');}
$('clear-script').addEventListener('click',guarded(()=>clearScriptDraft()));

let pendingScriptAction;
function scriptActionSignature(){return JSON.stringify(currentBrief())+state.projectId+state.revision+state.productionRevision;}
function requestScriptAction(action,kind,origin){pendingScriptAction={action,signature:scriptActionSignature(),draftVersion:scriptDraftVersion,projectId:state.projectId,origin,kind};$('script-confirm-message').textContent=kind==='clear'?'結果欄を空にします。保存済みの台本・音声は削除しません。':'結果欄を新しい台本案に置き換えます。指示と台本、参考資料があればその内容をGoogleへ送信します。API料金が発生する場合があります。';$('confirm-script-action').textContent=kind==='clear'?'結果欄を空にする':'送信して作り直す（API 1回）';$('script-confirm').hidden=false;$('confirm-script-action').focus?.();}
$('script-confirm').hidden=true;
$('cancel-script-action').addEventListener('click',()=>{const pending=pendingScriptAction;pendingScriptAction=undefined;$('script-confirm').hidden=true;if(pending)$(pending.origin).focus?.();});
$('confirm-script-action').addEventListener('click',guarded(async()=>{const pending=pendingScriptAction;if(!pending)return;pendingScriptAction=undefined;$('script-confirm').hidden=true;if(isFinalized()||pending.kind!=='clear'&&(state.busy||localBusy))throw new Error('BUSY');if(pending.kind==='clear'?pending.projectId!==state.projectId||pending.draftVersion!==scriptDraftVersion:pending.signature!==scriptActionSignature())throw new Error('STALE_REVISION');if(pending.kind==='generate'&&!state.keyConfigured)throw new Error('API_KEY_REQUIRED');await guarded(pending.action,pending.kind==='generate'?'source-status':'script-edit-status')();$('script-input').focus?.();},'script-edit-status'));

$('retry-audio').addEventListener('click',guarded(()=>{if(isDirty()||state.rows.some(r=>!r.reviewed))throw new Error('READING_REVIEW_REQUIRED');retryBaseline=retrySignature();$('retry-confirm').hidden=false;$('retry-confirm-send').focus?.();},'generation-state'));
$('retry-confirm-cancel').addEventListener('click',()=>{retryBaseline=undefined;$('retry-confirm').hidden=true;$('retry-audio').focus?.();});
$('retry-confirm-send').addEventListener('click',guarded(async()=>{if(!retryBaseline||retryBaseline!==retrySignature())throw new Error('STALE_REVISION');if(isDirty()||!state.voiceConfirmed||state.rows.some(r=>!r.reviewed))throw new Error('READING_REVIEW_REQUIRED');await enableAutomaticMusic();retryBaseline=undefined;$('retry-confirm').hidden=true;const ids=state.rows.filter(r=>!r.audioCurrent).map(r=>r.id);await api('generate',{ids,consent:true,revision:state.revision,productionRevision:state.productionRevision,regenerate:true,createVideo:true,createMusic:musicEnabled()&&(!state.production?.music||!state.musicCurrent),musicDirection:''});advanceAfterAudio=true;render(await api('status'));},'generation-state'));
$('use-adopted-script').addEventListener('click',()=>{const rows=state.rows.filter(r=>r.id!==state.production?.bookends?.titleRowId);scriptEdited=true;$('script-input').value=rows.map(r=>r.caption).join('\n');scriptReadings=rows.every(r=>r.speech)?rows.map(({caption,speech})=>({caption,speech})):undefined;storyboard=undefined;dirtyFields.add('production');updateControls();});
window.addEventListener?.('beforeunload',event=>{if(hasUserEdits()){event.preventDefault();event.returnValue='';}});

$('apply-readings-result').addEventListener('click',guarded(async()=>{render(await api('apply-draft-readings',{revision:state.revision,productionRevision:state.productionRevision}));$('apply-readings-result').hidden=true;actionMessage('reading-prep-status','保存した読みを反映しました。追加のAPI利用はありません。');},'reading-prep-status'));

let fitting=false;
const previewTexts=new WeakMap();
function fitPreviewText(){if(fitting)return;fitting=true;requestAnimationFrame(()=>{try{for(const node of document.querySelectorAll('.design-sample .preview-heading,.design-sample .preview-points')){if(!node.clientWidth||!node.clientHeight)continue;node.style.fontSize='';const style=getComputedStyle(node);let size=parseFloat(style.fontSize);if(node.classList.contains('preview-heading')){const prior=previewTexts.get(node),input=prior&&node.textContent===prior.output?prior.input:node.textContent,lineHeight=parseFloat(style.lineHeight)/size||1.4,fit=fitText(input,{width:node.clientWidth,height:node.clientHeight,maxSize:size,lineHeight,balance:true}),output=fit.lines.map(line=>line.replace(/\r?\n$/,'')).join('\n');size=fit.size;node.style.whiteSpace='pre';node.style.overflowWrap='normal';if(node.textContent!==output)node.textContent=output;previewTexts.set(node,{input,output});}node.style.fontSize=size+'px';while(size>1&&(node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1)){size-=.5;node.style.fontSize=size+'px';}}}finally{fitting=false;}});}
new ResizeObserver(fitPreviewText).observe(document.querySelector('main'));
new MutationObserver(fitPreviewText).observe(document.querySelector('main'),{childList:true,subtree:true,characterData:true});
fitPreviewText();

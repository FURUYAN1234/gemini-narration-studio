export function initPromoTools({$,element,api,guarded,render,readState,errors}){
  const cuts=[];
  let choicesKey,promoShown,recordingShown,lastRecorded;
  const isVideo=file=>file.endsWith('.mp4');
  const assets=()=>readState()?.production?.assets||[];
  const identity=()=>{const {projectId,productionRevision}=readState();return {projectId,productionRevision};};
  const refresh=async()=>render(await api('status'));
  const list=(id,items,placeholder)=>{
    const select=$(id),saved=select.value;
    select.replaceChildren(element('option',placeholder,{value:''}),...items.map(asset=>element('option',asset.name,{value:asset.file})));
    if(items.some(asset=>asset.file===saved))select.value=saved;
  };
  Object.assign(errors,{
    INVALID_RECORDING_URL:'別のデモ用アプリのURLを http://127.0.0.1:ポート/ の形式で入力してください。',
    INVALID_RECORDING_STEPS:'操作は例の形式で1〜7件を入力してください。',
    RECORDING_PAGE_FAILED:'デモ用アプリを開けませんでした。起動中のURLと転送設定を確認してください。',
    RECORDING_FAILED:'録画できませんでした。ボタン・入力欄の名前とデモ画面を確認してください。',
    RECORDING_SETUP_REQUIRED:'録画機能のセットアップが終わるまでお待ちください。',
    INVALID_PROMO_VIDEO_RANGE:'カットの開始と長さを元の動画内に収めてください。最短は0.6秒です。',
    PROMO_NARRATION_TOO_LONG:'ナレーションがカットの合計時間を超えています。映像を延ばすか音声を短くしてください。',
    HYPERFRAMES_INSTALL_REQUIRED:'先にバッチでHyperFramesを導入してください。',
    HYPERFRAMES_RENDER_FAILED:'HyperFramesで書き出せませんでした。診断を確認してください。'
  });
  function drawCuts(){
    $('promo-cuts').replaceChildren(...cuts.map((cut,index)=>{
      const row=element('li'),asset=assets().find(a=>a.file===cut.image);
      row.append(element('strong',asset?.name||'素材なし'));
      const fields=element('div',undefined,{class:'promo-cut-fields'});
      const field=(label,type,value,attrs,change)=>{
        const box=element('label',label),control=element('input',undefined,{type,...attrs});control.value=value;
        control.addEventListener('input',()=>change(control.value));
        box.append(control);fields.append(box);
      };
      field('見出し','text',cut.title,{maxlength:66},value=>{cut.title=value;});
      field('字幕','text',cut.caption||'',{maxlength:120},value=>{cut.caption=value;});
      if(isVideo(cut.image)){
        field('開始位置（秒）','number',(cut.startFrame/30).toFixed(2),{min:0,step:.01},value=>{cut.startFrame=Math.round(Number(value)*30);});
        field('長さ（秒、空欄で末尾まで）','number',cut.frames===undefined?'':(cut.frames/30).toFixed(2),{min:.6,step:.01},value=>{cut.frames=value===''?undefined:Math.round(Number(value)*30);});
      } else field('表示時間（秒）','number',cut.seconds,{min:3,max:8,step:1},value=>{cut.seconds=Number(value);});
      row.append(fields);
      const controls=element('div',undefined,{class:'input-row'});
      const button=(label,disabled,change)=>{
        const control=element('button',label,{type:'button',class:'secondary'});control.disabled=disabled;
        control.addEventListener('click',()=>{change();drawCuts();update();});controls.append(control);
      };
      button('上へ',index===0,()=>{[cuts[index-1],cuts[index]]=[cuts[index],cuts[index-1]];});
      button('下へ',index===cuts.length-1,()=>{[cuts[index+1],cuts[index]]=[cuts[index],cuts[index+1]];});
      button('取り除く',false,()=>cuts.splice(index,1));
      row.append(controls);
      return row;
    }));
  }
  function parseSteps(raw){
    const lines=raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if(!lines.length||lines.length>7)throw new Error('INVALID_RECORDING_STEPS');
    return lines.map(line=>{
      const [name,target,...rest]=line.split('｜');
      if(!target?.trim())throw new Error('INVALID_RECORDING_STEPS');
      if(name==='クリック'&&!rest.length)return {action:'click',target:target.trim()};
      if(name==='入力'&&rest.length)return {action:'fill',target:target.trim(),text:rest.join('｜')};
      throw new Error('INVALID_RECORDING_STEPS');
    });
  }
  function update(){
    const state=readState(),items=assets(),key=items.map(a=>a.file).join(',');
    if(choicesKey!==key){
      list('promo-images',items.filter(a=>/\.(png|jpe?g|webp|mp4)$/.test(a.file)),'素材を選択');
      const voiceAssets=items.filter(a=>a.origin!=='generated-music'&&/\.(wav|mp3)$/.test(a.file));
      list('promo-narration',voiceAssets,'音声なし');
      list('promo-title-call',voiceAssets,'音声を選択');
      list('recording-source',items.filter(a=>a.recording),'録画を選択');
      choicesKey=key;
    }
    const intro=state.promo||{},recording=state.recording||{},edit=recording.edit;
    const busy=intro.running||state.busy||state.video?.running;
    const renderer=$('promo-renderer');
    renderer.disabled=!!busy;
    $('promo-hyperframes-option').disabled=!intro.hyperframesVersion;
    if(renderer.value==='hyperframes'&&!intro.hyperframesVersion)renderer.value='auto';
    $('promo-renderer-help').textContent=intro.hyperframesVersion
      ? '自動はHyperFramesを使用します。操作録画に手順があれば、カットごとに表示します。'
      : '自動はRemotionを使用します。HyperFramesは start_narration_studio.bat --install-hyperframes --setup-only で導入できます。';
    if(recording.asset&&recording.asset!==lastRecorded){
      lastRecorded=recording.asset;
      $('recording-source').value=recording.asset;
      $('promo-images').value=recording.asset;
    }
    const selected=$('recording-source').value;
    if(recordingShown!==selected){
      recordingShown=selected;
      const player=$('recording-player');player.hidden=!selected;
      if(selected)player.src='/api/recording-media?file='+encodeURIComponent(selected);
      else player.removeAttribute('src');
    }
    $('promo-add').disabled=!$('promo-images').value||cuts.length>=6;
    $('promo-start').disabled=busy||!intro.available||!cuts.length;
    $('promo-stop').hidden=!intro.running;
    $('recording-start').disabled=busy||recording.setup!=='ready';
    $('recording-stop').hidden=!recording.running&&!edit?.running;
    $('recording-setup').hidden=recording.setup!=='unavailable';
    $('recording-status').textContent=recording.running?'操作を録画中…':recording.error?(errors[recording.error]||'録画に失敗しました。'):recording.asset?'録画を素材に追加しました。':recording.setup==='unavailable'?'録画機能の準備に失敗しました。ネット接続を確認して再セットアップしてください。':recording.setup==='ready'?'':'初回の録画機能を準備中…';
    $('recording-edit').disabled=busy||!selected||!$('recording-consent').checked;
    $('recording-apply').hidden=!selected||edit?.file!==selected||!edit?.cuts;
    $('recording-edit-status').textContent=edit?.running?'Geminiでカット案を作成中…':selected&&edit?.file===selected&&edit.error?(errors[edit.error]||'AIでカット案を作成できませんでした。 ('+edit.error+')'):!$('recording-apply').hidden?edit.cuts.length+'カットの案ができました。反映後に開始位置や字幕を調整できます。':'';
    const engine=intro.renderer==='hyperframes'?'HyperFrames':intro.renderer==='remotion'?'Remotion':'';
    $('promo-status').textContent=intro.running?'紹介動画を書き出し中 · '+Math.round((intro.progress||0)*100)+'%'+(engine?' · '+engine:''):intro.error?(errors[intro.error]||'紹介動画を書き出せませんでした。')+' ('+intro.error+')':intro.result?'書き出しが完了しました。'+(engine?' '+engine:''):'';
    $('promo-result-link').hidden=$('promo-result').hidden=!intro.result;
    if(intro.result?.file!==promoShown){
      promoShown=intro.result?.file;
      if(promoShown)$('promo-player').src='/api/promo-video?v='+encodeURIComponent(promoShown);
      else $('promo-player').removeAttribute('src');
    }
  }
  for(const id of ['promo-images','recording-source','recording-consent'])$(id).addEventListener('change',update);
  $('promo-add').addEventListener('click',()=>{
    const asset=assets().find(a=>a.file===$('promo-images').value);
    if(!asset||cuts.length>=6)return;
    cuts.push({image:asset.file,title:asset.recording?'操作デモ':asset.name.replace(/\.[a-z0-9]+$/i,'').slice(0,66),caption:'',...(isVideo(asset.file)?{startFrame:0,...(asset.recording?{frames:Math.floor(asset.recording.duration*30)}:{})}:{seconds:4})});
    drawCuts();update();
  });
  $('recording-setup').addEventListener('click',guarded(async()=>{await api('recording-setup',{projectId:identity().projectId});await refresh();},'recording-status'));
  $('recording-start').addEventListener('click',guarded(async()=>{
    await api('recording',{...identity(),url:$('recording-url').value.trim(),steps:parseSteps($('recording-steps').value)});await refresh();
  },'recording-status'));
  for(const [id,status] of [['recording-stop','recording-status'],['promo-stop','promo-status']])$(id).addEventListener('click',guarded(async()=>{await api('cancel',{});await refresh();},status));
  $('recording-edit').addEventListener('click',guarded(async()=>{
    await api('recording-edit',{...identity(),file:$('recording-source').value,sendOperationNamesToGemini:$('recording-consent').checked});
    $('recording-consent').checked=false;
    await refresh();
  },'recording-edit-status'));
  $('recording-apply').addEventListener('click',()=>{
    const edit=readState().recording?.edit;
    if(edit?.file!==$('recording-source').value||!edit?.cuts)return;
    cuts.splice(0,cuts.length,...edit.cuts.map(cut=>({...cut})));drawCuts();update();
  });
  $('promo-start').addEventListener('click',guarded(async()=>{
    const title=$('promo-title').value.trim();
    if(!title||!cuts.length||cuts.some(cut=>!cut.title.trim()))throw new Error('動画タイトル、カット素材、各カットの見出しを入力してください。');
    await api('promo',{...identity(),title,cuts,renderer:$('promo-renderer').value,narration:$('promo-narration').value,titleCall:$('promo-title-call').value,openingTitleRequired:$('promo-opening-required').checked,soundEnabled:$('promo-sound').checked,watermarkEnabled:$('promo-watermark').checked});
    await refresh();
  },'promo-status'));
  return update;
}

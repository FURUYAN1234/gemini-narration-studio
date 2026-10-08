import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
import {musicSignature,musicTimeline,MUSIC_MODEL} from './music.mjs';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,realpath,mkdir,readdir,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {NarrationSession,SAMPLE_SETTINGS,VOICE_GENDERS,previewFingerprint} from './core.mjs';
import {themeTokens,THEME_NAMES} from './themes.mjs';
import {ProductionInputs,MAX_ASSET_BYTES,isHiraganaReading,normalizeReview,normalizeBrief,normalizeDraftRecord,validateAsset,safeText,normalizeBookends} from './production.mjs';
import {assertScriptOperation,parseScriptParts,FRESH_BRIEF,FRESH_PRESENTATION} from './script-flow.mjs';
import {VoiceSamples} from './samples.mjs';
import {StudioVideo,findRendererRoot,mediaRange} from './video.mjs';
import {VIDEO_TEMPLATES} from './designs.mjs';
import {atomicWrite} from './atomic-write.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function body(req){let bytes=0,parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2_000_000)throw new Error('BODY_TOO_LARGE');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
export async function startServer({session,port=6181,sampleDir=path.join(session.outputDir,'..','voice-samples'),bundledSampleDir=path.join(here,'vendor','voice-samples'),videoRendererRoot,downloadsDir,videoRunner,launcherStatus,musicFactory}) {
  const root=session.outputDir,projectsDir=path.join(root,'projects'),pointer=path.join(root,'active-project.json');
  await mkdir(projectsDir,{recursive:true});if(path.dirname(await realpath(projectsDir))!==await realpath(root))throw new Error('INVALID_PROJECT');const projects=[{id:'original',title:session.status().title,finalized:!!(await ProductionInputs.open(root)).status().finalization}],projectPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const projectPath=async id=>{
    if(id==='original')return root;
    if(!projectPattern.test(id)||!projects.some(p=>p.id===id))throw new Error('INVALID_PROJECT');
    const target=await realpath(path.join(projectsDir,id)),parent=await realpath(projectsDir);
    if(path.dirname(target)!==parent)throw new Error('INVALID_PROJECT');return target;
  };
  for(const entry of await readdir(projectsDir,{withFileTypes:true})){if(!entry.isDirectory()||!projectPattern.test(entry.name))continue;projects.push({id:entry.name,title:'新しい動画'});const outputDir=await projectPath(entry.name),opened=await session.openRelated(outputDir);projects.at(-1).title=opened.status().title;projects.at(-1).finalized=!!(await ProductionInputs.open(outputDir)).status().finalization;}
  let projectId='original';try{const saved=JSON.parse(await readFile(pointer,'utf8'));await projectPath(saved.id);projectId=saved.id;}catch(error){if(error.code!=='ENOENT')throw new Error('SAVED_PROJECT_INVALID');}
  if(projectId!=='original')session=await session.openRelated(await projectPath(projectId));
  const rendererRoot=videoRendererRoot||await findRendererRoot(root);
  let production=await ProductionInputs.open(session.outputDir);
  const hadJob=await stat(path.join(session.outputDir,'job.json')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});if(!hadJob){await session.setPresentation(FRESH_PRESENTATION);await production.saveBrief(FRESH_BRIEF);await production.savePause(.8);}
  let unsavedDraft=null,draftCanceled=false,adoptionError=null;let resumed=hadJob;
  const recoverAdoption=async()=>{const pending=production.status().authoring?.pendingAdoption;if(!pending)return;const actual=session.rowsHash();if(actual===pending.desiredRowsHash){const {pendingAdoption,...authoring}=production.status().authoring;await production.saveAuthoring(authoring);}else if(actual!==pending.baseRowsHash)adoptionError='ADOPTION_CONFLICT';};
  await recoverAdoption();
  let video=await StudioVideo.open({sourceDir:session.outputDir,rendererRoot,downloadsDir,runner:videoRunner});
  const samples=await new VoiceSamples([sampleDir,bundledSampleDir]).load();let inputBusy=false,sampleProgress=null,bankCanceled=false,bankError=null,narrationStage=null,narrationError=null,narrationCanceled=false;
  let token=randomBytes(32).toString('hex'),instanceId=randomBytes(16).toString('hex'),url;
  const status=()=>{const current=session.status();Object.assign(projects.find(p=>p.id===projectId),{title:current.title,finalized:!!production.status().finalization});return {...current,voiceConfirmed:production.status().voiceConfirmation===previewFingerprint(current.settings)||(production.status().voiceConfirmation===undefined&&current.rows.some(r=>r.audioCurrent)),projectId,projects:projects.map(p=>({...p})),video:video.status(current.revision),voiceGenders:VOICE_GENDERS,sampleSettings:SAMPLE_SETTINGS,rows:current.rows.map(row=>({...row,...production.cutInfo(row)})),busy:session.busy||inputBusy,error:narrationError||bankError||session.error,progress:narrationStage?{...current.progress,phase:narrationStage}:current.progress,instanceId,resumed,adoptionError,unsavedDraft,production:production.status(),productionRevision:production.finalInputsHash(),musicCurrent:production.status().musicEnabled===false||!production.status().music||production.status().music.signature===musicSignature(current),samples:samples.status(),sampleProgress,sampleLibraryTotal:SAMPLE_SETTINGS.length};};
  async function musicDependency(){if(musicFactory)return;if(!rendererRoot)throw new Error('VIDEO_RENDERER_UNAVAILABLE');await stat(path.join(rendererRoot,'node_modules','@remotion','compositor-win32-x64-msvc',process.platform==='win32'?'ffprobe.exe':'ffprobe'));}
  async function createMusic(direction){
    const current={...session.status(),pauseSeconds:production.status().pauseSeconds,bookends:production.status().bookends};musicTimeline(current);direction=safeText(direction||'',2000);await musicDependency();
    const result=musicFactory?await musicFactory({current,direction}):await session.generateMedia('music',{current,direction});
    if(narrationCanceled)throw new Error('CANCELED');
    await production.addAsset('生成BGM-'+Date.now()+'.mp3',result.bytes,{origin:'generated-music'});
    const file=createHash('sha256').update(result.bytes).digest('hex')+'.mp3';let durationSeconds=result.durationSeconds;
    if(!musicFactory){const probe=path.join(rendererRoot,'node_modules','@remotion','compositor-win32-x64-msvc',process.platform==='win32'?'ffprobe.exe':'ffprobe');try{const decoded=await promisify(execFile)(probe,['-v','error','-show_format','-of','json',path.join(session.outputDir,'materials',file)],{windowsHide:true,maxBuffer:1024*1024});durationSeconds=Number(JSON.parse(decoded.stdout).format.duration);}catch{throw new Error('MUSIC_DECODE_FAILED');}}
    await production.saveMusic({file,signature:musicSignature(current),direction,model:MUSIC_MODEL,durationSeconds,level:.16});
  }
  const switchProject=async(id,{fresh=false}={})=>{
    const outputDir=await projectPath(id),next=await session.openRelated(outputDir,{fresh});
    const nextProduction=await ProductionInputs.open(outputDir),nextVideo=await StudioVideo.open({sourceDir:outputDir,rendererRoot,downloadsDir,runner:videoRunner});
    await atomicWrite(pointer,JSON.stringify({id}));session=next;production=nextProduction;video=nextVideo;projectId=id;bankError=null;sampleProgress=null;narrationError=null;narrationStage=null;narrationCanceled=false;
    token=randomBytes(32).toString('hex');instanceId=randomBytes(16).toString('hex');unsavedDraft=null;resumed=!fresh;adoptionError=null;await recoverAdoption();
  };
  const assertAdopted=()=>{if(production.status().authoring?.pendingAdoption)throw new Error('ADOPTION_CONFLICT');const brief=production.status().brief,body=session.status().rows.filter(r=>r.id!==production.status().bookends?.titleRowId).map(r=>r.caption).join('\n');if(brief.scriptEdited===true&&parseScriptParts(brief.script).join('\n')!==body)throw new Error('SCRIPT_ADOPTION_REQUIRED');};
  const reviewedManifest=async()=>{assertAdopted();if(session.busy||inputBusy)throw new Error('BUSY');production.assertNoCorrections();production.assertCutsConfirmed(session.status().rows);production.assertFinalization(session.status());return session.exportManifest();};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      if(req.headers.host!==new URL(url).host)return json(res,403,{error:'INVALID_HOST'});
      const route=new URL(req.url,url).pathname;
      if(req.headers.origin&&req.headers.origin!==url)return json(res,403,{error:'FOREIGN_ORIGIN'});
      if(req.method==='GET'){
        if(route==='/api/bootstrap')return json(res,200,{token,instanceId});
        if(route==='/api/status')return json(res,200,status());
        if(route==='/api/production')return json(res,200,production.status());
        if(route==='/api/themes')return json(res,200,await Promise.all(THEME_NAMES.map(themeTokens)));
        if(route==='/api/launcher-status'&&launcherStatus)return json(res,200,launcherStatus);
        if(route==='/api/designs')return json(res,200,VIDEO_TEMPLATES);
        if(route==='/api/manifest')return json(res,200,await reviewedManifest());
        if(route==='/api/video-download'||/^\/video\/[a-f0-9]{64}\.mp4$/.test(route)){
          production.assertFinalization(session.status());const {bytes,result}=await video.media(session.revision());
          if(route!=='/api/video-download'&&route!=='/video/'+result.file)return json(res,404,{error:'VIDEO_NOT_FOUND'});
          let range;try{range=mediaRange(req.headers.range,bytes.length);}catch{res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`});return res.end();}
          res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',range.end-range.start+1);
          if(route==='/api/video-download')res.setHeader('Content-Disposition',`attachment; filename="Narration-Video.mp4"; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
          if(range.partial)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${bytes.length}`);
          res.writeHead(range.partial?206:200);return res.end(bytes.subarray(range.start,range.end+1));
        }
        if(route==='/script-flow.mjs'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(here,'script-flow.mjs')));}
        const assets={'/':'index.html','/app.mjs':'app.mjs','/style.css':'style.css'};
        if(assets[route]){res.setHeader('Content-Type',route==='/'?'text/html; charset=utf-8':route.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');return res.end(await readFile(path.join(here,'ui',assets[route])));}
        if(/^\/samples\/[a-f0-9]{64}\.wav$/.test(route)){res.setHeader('Content-Type','audio/wav');return res.end(await samples.read(route.slice(9,-4)));}
        if(route==='/api/music-audio'){const music=production.status().music;if(!music)return json(res,404,{error:'MUSIC_REQUIRED'});production.assertMusicCurrent(session.status());res.setHeader('Content-Type','audio/mpeg');return res.end(await production.readAsset(music.file));}
        if(route.startsWith('/materials/')){const file=route.slice(11),asset=production.status().assets.find(a=>a.file===file);if(!asset)return json(res,404,{error:'ASSET_NOT_FOUND'});res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment');return res.end(await production.readAsset(file));}
        if(/^\/audio\/[a-f0-9]{64}\.wav$/.test(route)){
          const file=route.slice(7);if(!session.status().rows.some(r=>r.audio?.file===file))return json(res,404,{error:'AUDIO_NOT_FOUND'});
          const target=await realpath(path.join(session.outputDir,'audio',file)),root=await realpath(path.join(session.outputDir,'audio'));
          if(path.dirname(target)!==root)return json(res,404,{error:'AUDIO_NOT_FOUND'});
          res.setHeader('Content-Type','audio/wav');return res.end(await readFile(target));
        }
        return json(res,404,{error:'NOT_FOUND'});
      }
      if(req.method!=='POST')return json(res,405,{error:'METHOD_NOT_ALLOWED'});
      const supplied=Buffer.from(String(req.headers['x-narration-token']||'')),expected=Buffer.from(token);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json(res,403,{error:'CSRF_TOKEN_REQUIRED'});
      const draftRoute=['/api/draft','/api/source-plan','/api/prepare-readings'].includes(route);
      if(inputBusy&&route!=='/api/cancel'&&!draftRoute)throw new Error('BUSY');
      if(!['/api/key','/api/connection-check','/api/cancel','/api/preview','/api/prepare-samples','/api/render-video','/api/new-project','/api/project','/api/revision-project'].includes(route))production.assertWritable();
      if(route==='/api/material'){
        if(session.busy)throw new Error('BUSY');inputBusy=true;
        try{const parts=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_ASSET_BYTES)throw new Error('ASSET_TOO_LARGE');parts.push(chunk);}await production.addAsset(new URL(req.url,url).searchParams.get('name'),Buffer.concat(parts));return json(res,200,status());}finally{inputBusy=false;}
      }
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'JSON_REQUIRED'});
      const input=await body(req);
      const currentToken=Buffer.from(token);if(supplied.length!==currentToken.length||!timingSafeEqual(supplied,currentToken))return json(res,403,{error:'CSRF_TOKEN_REQUIRED'});
      if(inputBusy&&route!=='/api/cancel'&&!draftRoute)throw new Error('BUSY');
      if(route==='/api/new-project'||route==='/api/project'||route==='/api/revision-project'){
        if(session.busy||video.status(session.revision()).running)throw new Error('BUSY');
        if(input.sessionId!==session.status().sessionId)throw new Error('SESSION_MISMATCH');if(input.revision!==session.revision())throw new Error('STALE_REVISION');
        inputBusy=true;
        try{let id=input.id;if(route==='/api/new-project'||route==='/api/revision-project'){
          id=randomUUID();const destination=path.join(projectsDir,id);await mkdir(destination);
          if(route==='/api/revision-project'){
            const source=await realpath(session.outputDir);production.assertFinalization(session.status());
            const job=JSON.parse(await readFile(path.join(source,'job.json'),'utf8'));job.title=(job.title+'（修正版）').slice(0,200);await atomicWrite(path.join(destination,'job.json'),JSON.stringify(job,null,2));
            for(const name of ['audio','materials']){const folder=await realpath(path.join(source,name));if(path.dirname(folder)!==source)throw new Error('INVALID_PROJECT');await cp(folder,path.join(destination,name),{recursive:true});}
            const creationYear=production.status().creationYear||production.status().bookends?.creationYear||Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Tokyo'}).format((await stat(path.join(source,'job.json'))).birthtime));
            const revisedProduction={...production.status(),creationYear,cutConfirmations:[],finalization:null,requiresFinalization:true};if(revisedProduction.music)revisedProduction.music.signature=musicSignature({...session.status(),title:job.title});
            await atomicWrite(path.join(destination,'production.json'),JSON.stringify(revisedProduction,null,2));
            try{await atomicWrite(path.join(destination,'video-scenes.json'),await readFile(path.join(source,'video-scenes.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
          }
          projects.push({id,title:'新しい動画'});
        }await switchProject(id,{fresh:route==='/api/new-project'});if(route==='/api/new-project'){await session.setPresentation(FRESH_PRESENTATION);await production.saveBrief(FRESH_BRIEF);await production.savePause(.8);}}finally{inputBusy=false;}
        return json(res,200,status());
      }
      if(!['/api/key','/api/connection-check','/api/cancel','/api/preview','/api/prepare-samples','/api/render-video'].includes(route))production.assertWritable();
      if(route==='/api/cut-image'){
        if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');const row=session.status().rows.find(r=>r.id===input.id);if(!row)throw new Error('ROW_NOT_FOUND');await production.assignCutImage(row,input.file);return json(res,200,status());
      }
      if(route==='/api/bookends'){
        if(session.busy||video.status(session.revision()).running)throw new Error('BUSY');
        if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');
        const previous=production.status().bookends,caption=safeText(input.title,200),speech=safeText(input.speech,4000);
        if(!caption||!isHiraganaReading(speech))throw new Error('HIRAGANA_READING_REQUIRED');
        const bookends=normalizeBookends({titleRowId:previous?.titleRowId||'title-'+randomUUID(),endLabel:input.endLabel,endUrl:input.endUrl,owner:input.owner,creationYear:previous?.creationYear||production.status().creationYear||Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Tokyo'}).format((await stat(path.join(session.outputDir,'job.json'))).birthtime)),endSeconds:input.endSeconds});
        if(previous&&session.status().rows[0]?.id!==previous.titleRowId)throw new Error('STALE_BOOKENDS');
        inputBusy=true;try{if(previous)await session.updateRow(bookends.titleRowId,{caption,speech});else await session.appendRow({id:bookends.titleRowId,caption,speech,scene:'タイトルコール'},{prepend:true});await production.saveBookends(bookends);return json(res,200,status());}finally{inputBusy=false;}
      }
      if(route==='/api/music-preference'){if(session.busy||inputBusy||video.status(session.revision()).running)throw new Error('BUSY');if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');await production.saveMusicEnabled(input.enabled);return json(res,200,status());}
      if(route==='/api/cut-pause'){if(session.busy||video.status(session.revision()).running)throw new Error('BUSY');if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');inputBusy=true;try{await production.savePause(input.seconds);return json(res,200,status());}finally{inputBusy=false;}}
      if(route==='/api/render-video'){
        if(input.revision!==session.revision())throw new Error('STALE_REVISION');if(!production.status().finalization)throw new Error('FINAL_CONFIRMATION_REQUIRED');await reviewedManifest();
        return json(res,202,video.start({revision:session.revision(),title:session.status().title}));
      }
      if(route==='/api/prepare-samples'){
        const missing=SAMPLE_SETTINGS.filter(s=>!samples.find(s));if(!missing.length)return json(res,200,{started:false});
        if(input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');if(!session.status().keyConfigured)throw new Error('API_KEY_REQUIRED');if(session.busy)throw new Error('BUSY');
        inputBusy=true;bankCanceled=false;bankError=null;sampleProgress={running:true,completed:0,total:missing.length};
        (async()=>{try{for(const config of missing){if(bankCanceled)break;sampleProgress.settings=config;await samples.save(await session.voicePreview(config));sampleProgress.completed++;}}catch(e){bankError=/^[A-Z_]+(?:: HTTP \d{3})?$/.test(e.message)?e.message:'PROVIDER_FAILED';}finally{sampleProgress.running=false;inputBusy=false;}})();
        return json(res,202,{started:true,total:missing.length});
      }
      if(route==='/api/preview'){
        const existing=samples.find(input.settings);if(existing)return json(res,200,{sample:existing.id,cached:true});
        if(input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');
        inputBusy=true;try{const item=await samples.save(await session.voicePreview(input.settings));return json(res,200,{sample:item.id,cached:false});}finally{inputBusy=false;}
      }
      if(route==='/api/connection-check')return json(res,200,await session.checkConnection());
      if(route==='/api/generation-check')return json(res,200,await session.probeGeneration(input));
      if(route==='/api/source-inspect'){
        if(input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');
        if(input.revision!==session.revision())throw new Error('STALE_REVISION');
        return json(res,200,await session.inspectSources(input.brief,production.status().assets,file=>production.readAsset(file)));
      }
      if(draftRoute){
        if(input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');
        const operation=route==='/api/prepare-readings'?'prepare-readings':input.operation;if(operation==='prepare-readings')assertAdopted();
        if(operation==='prepare-readings'&&input.brief?.autoDirection===true)throw new Error('SCRIPT_OPERATION_NOT_ALLOWED');
        let brief=normalizeBrief(operation==='prepare-readings'?{scriptMode:'existing',assetMode:'provided',instructions:'',script:input.brief?.script,autoDirection:false,themeAuto:false,references:{text:'',urls:[]}}:{...input.brief,sourceEvidence:undefined,storyboard:undefined,direction:undefined,readings:undefined});const assets=production.status().assets,hasReferences=!!(brief.references?.text||brief.references?.urls?.length||assets.some(a=>a.origin!=='generated-music'));
        const readingRows=operation==='prepare-readings'?session.status().rows.filter(r=>r.id!==production.status().bookends?.titleRowId):[],readingTargets=readingRows.filter(r=>!r.reviewed);
        if(operation==='prepare-readings'&&parseScriptParts(brief.script).join('\n')!==readingRows.map(r=>r.caption).join('\n'))throw new Error('STALE_SCRIPT_READINGS');
        assertScriptOperation({operation,brief:{...brief,hasReferences}});
        if(operation==='compose')brief=normalizeBrief({...brief,script:'',readings:undefined,storyboard:undefined,direction:undefined,scriptMode:'ai'});
        const inputHash=createHash('sha256').update(JSON.stringify({operation,brief})).digest('hex'),last=production.status().authoring?.lastAttempt;
        if(last&&input.sequence===last.sequence){if(input.requestId!==last.id||inputHash!==last.inputHash||input.projectId!==projectId)throw new Error('DRAFT_REQUEST_CONFLICT');return json(res,200,{...(unsavedDraft?.result||last.result||{}),attempt:last,saved:!unsavedDraft,model:'gemini-3.5-flash'});}
        if(!/^[a-f0-9-]{36}$/.test(input.requestId)||input.sequence!==(last?.sequence||0)+1)throw new Error('DRAFT_REQUEST_CONFLICT');
        if(input.projectId!==projectId||input.instanceId!==instanceId)throw new Error('SESSION_MISMATCH');
        if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');
        if(inputBusy||session.busy||video.status(session.revision()).running)throw new Error('BUSY');
        if(!session.status().keyConfigured)throw new Error('API_KEY_REQUIRED');
        if(operation==='prepare-readings'&&!readingTargets.length)throw new Error('READING_PREPARATION_NOT_NEEDED');
        const target=session,targetProduction=production,targetProject=projectId,previousDraft=production.status().brief;
        const attempt={id:input.requestId,sequence:input.sequence,operation,inputHash,projectId,baseRevision:session.revision(),baseProductionRevision:production.finalInputsHash(),request:brief,previousDraft,state:'running'};
        inputBusy=true;unsavedDraft=null;draftCanceled=false;
        try{
          await production.saveAuthoring({...production.status().authoring,version:1,lastAttempt:attempt},brief);
          const baseline=production.finalInputsHash();
          const generated=operation==='prepare-readings'?await session.draftScript({...brief,script:readingTargets.map(r=>r.caption).join('\n'),instructions:'字幕の各行を一文字も変えず、対応するひらがなの読みだけを用意してください。'},[]):hasReferences?await session.planSources(brief,assets,file=>production.readAsset(file)):await session.draftScript(brief,[]);
          const draft=normalizeDraftRecord(operation==='prepare-readings'?{...generated,script:brief.script,readings:readingRows.map(r=>{const i=readingTargets.findIndex(t=>t.id===r.id);return {caption:r.caption,speech:i<0?r.speech:generated.readings[i]?.speech};})}:generated);
          if(draftCanceled)throw new Error('CANCELED');
          if(target!==session||targetProduction!==production||targetProject!==projectId||attempt.baseRevision!==session.revision()||baseline!==production.finalInputsHash())throw new Error('STALE_REVISION');
          const finished={...attempt,result:draft,state:draft.warnings.length?'partial':'complete'};
          const nextBrief=normalizeBrief({... (operation==='prepare-readings'?previousDraft:brief),script:draft.script,readings:draft.readings,storyboard:operation==='prepare-readings'?previousDraft.storyboard:draft.storyboard,direction:operation==='prepare-readings'?previousDraft.direction:draft.direction,sourceEvidence:operation==='prepare-readings'?previousDraft.sourceEvidence:draft.verifiedSources?{sources:draft.verifiedSources,bindings:draft.sourceBindings}:undefined,scriptEdited:true});
          try{await production.saveAuthoring({...production.status().authoring,version:1,lastAttempt:finished},nextBrief);}catch{unsavedDraft={attempt:finished,result:draft,brief:nextBrief};return json(res,200,{...draft,attempt:finished,saved:false,saveError:'DRAFT_SAVE_FAILED'});}
          if(operation==='prepare-readings'){
            try{await session.applyPreparedReadings(draft.readings,{expectedRevision:attempt.baseRevision,preserveIds:production.status().bookends?[production.status().bookends.titleRowId]:[]});}
            catch{const pending={...finished,state:'partial',error:{stage:'application',code:'READING_APPLY_FAILED'}};try{await production.saveAuthoring({...production.status().authoring,version:1,lastAttempt:pending});}catch{}return json(res,200,{...draft,attempt:pending,saved:true,applicationError:'READING_APPLY_FAILED'});}
          }
          return json(res,200,{...draft,attempt:finished,saved:true,model:'gemini-3.5-flash'});
        }catch(error){const failed={...attempt,state:error.message==='CANCELED'?'canceled':'failed',error:{stage:'generation',code:/^[A-Z_]+$/.test(error.message)?error.message:'REQUEST_FAILED'}};try{await targetProduction.saveAuthoring({...targetProduction.status().authoring,version:1,lastAttempt:failed},previousDraft);}catch{}throw error;}
        finally{inputBusy=false;}
      }
      if(route==='/api/save-draft-result'){if(!unsavedDraft)throw new Error('DRAFT_RESULT_REQUIRED');if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');await production.saveAuthoring({...production.status().authoring,version:1,lastAttempt:unsavedDraft.attempt},unsavedDraft.brief);unsavedDraft=null;return json(res,200,status());}
      if(route==='/api/apply-draft-readings'){const attempt=production.status().authoring?.lastAttempt;if(attempt?.operation!=='prepare-readings'||!attempt.result)throw new Error('DRAFT_RESULT_REQUIRED');if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');await session.applyPreparedReadings(attempt.result.readings,{expectedRevision:input.revision,preserveIds:production.status().bookends?[production.status().bookends.titleRowId]:[]});await production.saveAuthoring({...production.status().authoring,version:1,lastAttempt:{...attempt,state:'complete',error:undefined}});return json(res,200,status());}
      if(route==='/api/adopt-script'){
        if(adoptionError)throw new Error(adoptionError);
        const interrupted=production.status().authoring?.pendingAdoption;if(interrupted&&![interrupted.baseRowsHash,interrupted.desiredRowsHash].includes(session.rowsHash()))throw new Error('ADOPTION_CONFLICT');
        if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash()||input.projectId!==projectId||input.instanceId!==instanceId)throw new Error('STALE_REVISION');
        production.assertNoCorrections();const previous=production.status().brief,preserveIds=production.status().bookends?[production.status().bookends.titleRowId]:[];
        const rows=session.planScriptAdoption(input.script,{readings:input.readings,preserveIds}),pending={id:randomUUID(),baseRowsHash:session.rowsHash(),desiredRowsHash:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),rows};
        const brief=normalizeBrief({...previous,script:input.script,readings:input.readings,storyboard:previous.script===input.script?previous.storyboard:undefined,scriptEdited:true});
        inputBusy=true;try{await production.saveAuthoring({...production.status().authoring,version:1,pendingAdoption:pending},brief);await session.applyScriptAdoption(rows,pending.baseRowsHash);const {pendingAdoption,...authoring}=production.status().authoring;await production.saveAuthoring({...authoring,adoptedScriptHash:createHash('sha256').update(parseScriptParts(input.script).join('\n')).digest('hex')});if(brief.storyboard)await production.applyStoryboard(brief.storyboard,session.status().rows.filter(r=>!preserveIds.includes(r.id)));return json(res,200,status());}finally{inputBusy=false;}
      }
      if(route==='/api/design-draft'){
        if(input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');
        if(input.revision!==session.revision())throw new Error('STALE_REVISION');
        await session.draftDesign(input.instructions);return json(res,200,status());
      }
      if(route==='/api/cut-pause'){if(session.busy||video.status(session.revision()).running)throw new Error('BUSY');if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');inputBusy=true;try{await production.savePause(input.seconds);return json(res,200,status());}finally{inputBusy=false;}}
      if(route==='/api/cut-visuals'){
        if(session.busy||video.status(session.revision()).running)throw new Error('BUSY');
        if(input.revision!==session.revision()||(input.id&&input.productionRevision!==production.finalInputsHash()))throw new Error('STALE_REVISION');
        const rows=session.status().rows,row=rows.find(r=>r.id===input.id);if(input.id&&!row)throw new Error('ROW_NOT_FOUND');if(input.id&&input.visuals)throw new Error('INVALID_CUT_VISUALS');const visuals=row?{...production.status().visuals,[row.id]:{...production.status().visuals?.[row.id],title:input.title,points:input.points}}:input.visuals;
        inputBusy=true;try{await production.saveVisuals(visuals,rows);return json(res,200,status());}finally{inputBusy=false;}
      }
      if(['/api/generate-image','/api/generate-music','/api/music'].includes(route)){
        if(session.busy||video.status(session.revision()).running)throw new Error('BUSY');
        if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');
        if(route!=='/api/music'&&input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');
        inputBusy=true;try{
          if(route==='/api/music'){if(input.remove===true)await production.saveMusic(null);else{if(!production.status().music)throw new Error('MUSIC_REQUIRED');if(input.reuse===true){musicTimeline(session.status());await production.saveMusic({...production.status().music,signature:musicSignature(session.status())});}else{production.assertMusicCurrent(session.status());await production.saveMusic({...production.status().music,level:input.level});}}return json(res,200,status());}
          if(route==='/api/generate-image'){if(production.status().bookends?.titleRowId===input.id)throw new Error('TITLE_IMAGE_NOT_ALLOWED');
            if(production.status().brief.assetMode==='provided')throw new Error('IMAGE_GENERATION_NOT_ALLOWED');
            const row=session.status().rows.find(r=>r.id===input.id);if(!row)throw new Error('ROW_NOT_FOUND');
            const prompt=safeText(input.prompt,3000),files=input.references||[];if(!Array.isArray(files)||files.length>3||new Set(files).size!==files.length)throw new Error('INVALID_IMAGE_REFERENCES');
            const references=[];for(const file of files){const asset=production.status().assets.find(a=>a.file===file);if(!asset||! /\.(png|jpe?g|webp)$/.test(file))throw new Error('INVALID_IMAGE_REFERENCES');references.push({bytes:await production.readAsset(file),extension:file.split('.').at(-1)});}
            const image=await session.generateMedia('image',{prompt,references});
            await production.addAsset('生成画像-'+row.id+'.'+image.extension,image.bytes,{origin:'generated-image'});
            const file=createHash('sha256').update(image.bytes).digest('hex')+'.'+image.extension;await production.assignCutImage(row,file);
            const brief=production.status().brief;if(brief.storyboard){const scenes=brief.storyboard.scenes;const index=session.status().rows.findIndex(r=>r.id===row.id);if(scenes[index]?.caption===row.caption){scenes[index]={...scenes[index],imageFile:file,imagePrompt:'',imageReferences:[]};delete scenes[index].imageFocus;await production.saveBrief(brief);}}
            return json(res,200,status());
          }
          narrationCanceled=false;await createMusic(input.direction);return json(res,200,status());
        }finally{inputBusy=false;}
      }
      if(route==='/api/apply-review'){
        if(input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');if(session.busy||video.status(session.revision()).running)throw new Error('BUSY');if(input.expectedRevision!==session.revision())throw new Error('STALE_REVISION');
        const review=normalizeReview(input.review),all=session.status().rows;if(review.cuts.some(c=>!all.some(r=>r.id===c.rowId)))throw new Error('INVALID_REVIEW_CUT');
        const cuts=input.id?review.cuts.filter(c=>c.rowId===input.id):review.cuts,overall=input.id?'':review.overall;if(!overall&&!cuts.length)throw new Error('EMPTY_CORRECTION');
        const targets=overall?all:all.filter(r=>cuts.some(c=>c.rowId===r.id));
        inputBusy=true;
        try{
          await production.saveReview({...review,sourceRevision:session.revision()});const baseline=session.revision(),images=[];
          for(const row of targets){const image=production.cutImage(row);if(image)images.push({id:row.id,bytes:await production.readAsset(image.file),mimeType:/\.png$/.test(image.file)?'image/png':/\.webp$/.test(image.file)?'image/webp':'image/jpeg'});}
          const rows=targets.map(r=>({id:r.id,caption:r.caption,speech:r.speech,...(production.status().visuals?.[r.id]||{title:r.scene||session.status().title,points:[]})})),edits=await session.prepareCorrections({rows,cuts,overall,images});
          if(cuts.some(c=>!edits.some(e=>e.id===c.rowId)))throw new Error('INVALID_CORRECTION_RESULT');if(session.revision()!==baseline)throw new Error('STALE_REVISION');
          const proposed=all.map(r=>edits.find(e=>e.id===r.id)||r),brief={...production.status().brief,script:proposed.map(r=>r.caption).join('\n')};delete brief.readings;delete brief.storyboard;if(proposed.every(r=>isHiraganaReading(r.speech)))brief.readings=proposed.map(({caption,speech})=>({caption,speech}));normalizeBrief(brief);
          for(const e of edits)if(e.image)validateAsset('修正画像.'+e.image.extension,e.image.bytes);
          const visuals={...(production.status().visuals||{})};
          for(const e of edits){if(e.image){await production.addAsset('修正画像-'+e.id+'.'+e.image.extension,e.image.bytes);const image=production.status().assets.find(a=>a.file.startsWith(createHash('sha256').update(e.image.bytes).digest('hex')+'.'));await production.assignCutImage(all.find(r=>r.id===e.id),image.file);}visuals[e.id]={title:e.title,points:e.points};await production.reopenCut(e.id);}
          await production.saveVisuals(visuals,all);await session.applyCorrectionRows(edits,baseline);
          const current=session.status();await production.saveBrief(brief);
          await production.saveReview({...review,sourceRevision:current.revision,overall:input.id?review.overall:'',cuts:review.cuts.filter(c=>!edits.some(e=>e.id===c.rowId))});return json(res,200,{...status(),correctionResult:{ids:edits.map(e=>e.id),images:edits.filter(e=>e.image).length,textChanged:edits.filter(e=>{const r=all.find(r=>r.id===e.id);return r.caption!==e.caption||r.speech!==e.speech;}).length}});
        }finally{inputBusy=false;}
      }
      if(route==='/api/production'){if(session.busy)throw new Error('BUSY');if(input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');inputBusy=true;try{await production.saveBrief(input);}finally{inputBusy=false;}}
      else if(route==='/api/review'){if(session.busy)throw new Error('BUSY');if(input.expectedRevision!==session.revision())throw new Error('STALE_REVISION');if(!Array.isArray(input.review?.cuts)||input.review.cuts.some(c=>!session.status().rows.some(r=>r.id===c.rowId)))throw new Error('INVALID_REVIEW_CUT');inputBusy=true;try{await production.saveReview({...input.review,sourceRevision:session.revision()});}finally{inputBusy=false;}}
      else if(route==='/api/append-script'){
        if(input.replace!==undefined&&typeof input.replace!=='boolean')throw new Error('INVALID_SCRIPT');if(input.replace===true){production.assertNoCorrections();if(input.revision!==session.revision()||input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');}
        const brief=production.status().brief,plan=brief.script===input.script?brief.storyboard:undefined;
        if(plan&&plan.scenes.some(s=>s.imageFile&&!production.status().assets.some(a=>a.file===s.imageFile)))throw new Error('INVALID_CUT_IMAGE');
        const existing=session.status().rows,captions=input.script.split(/\r?\n+/).map(v=>v.trim()).filter(Boolean);let start=plan?existing.findIndex((_,i)=>captions.every((caption,j)=>existing[i+j]?.caption===caption)):-1;
        const suppliedReadings=input.readings??(brief.script===input.script?brief.readings:undefined);
        if(input.replace===true){const preserveIds=production.status().bookends?[production.status().bookends.titleRowId]:[];await session.appendScript(input.script,{readings:suppliedReadings,consent:false,replace:true,expectedRevision:input.revision,preserveIds});start=preserveIds.length;}else if(start<0){start=existing.length;await session.appendScript(input.script,{readings:suppliedReadings,consent:false});}
        if(plan){await production.applyStoryboard(plan,session.status().rows.slice(start,start+captions.length));if(brief.autoDirection!==false)await session.setPresentation({...session.status().presentation,motion:plan.motion});}
      }
      else if(route==='/api/key'){if(input.clear)session.clearKey();else session.setKey(input.key);}
      else if(route==='/api/job'){
        if(input.sessionId!==session.status().sessionId)throw new Error('SESSION_MISMATCH');
        await session.replaceJob(input.job,{confirmReplace:input.confirmReplace===true,expectedRevision:input.expectedRevision,sessionId:input.sessionId});
      }
      else if(route==='/api/settings'){const {candidate,...config}=input;if(candidate!==undefined&&typeof candidate!=='boolean')throw new Error('INVALID_VOICE_CONFIRMATION');const fingerprint=previewFingerprint(config);production.assertWritable();await session.configure(config);await production.saveVoiceConfirmation(candidate===true?null:fingerprint);}
      else if(route==='/api/title')await session.setTitle(input.title);
      else if(route==='/api/presentation'){if(input.presentation){if(input.revision!==session.revision())throw new Error('STALE_REVISION');await session.setPresentation(input.presentation);}else await session.setTheme(input.theme);}
      else if(route==='/api/append-row'){assertAdopted();if(!isHiraganaReading(input.speech))throw new Error('HIRAGANA_READING_REQUIRED');await session.appendRow(input);const brief=production.status().brief,rows=session.status().rows.filter(r=>r.id!==production.status().bookends?.titleRowId);await production.saveBrief({...brief,script:rows.map(r=>r.caption).join('\n'),readings:undefined,storyboard:undefined,scriptEdited:true});}
      else if(route==='/api/row'){
 const before=session.status().rows.filter(r=>r.id!==production.status().bookends?.titleRowId).map(r=>r.caption).join('\n'),brief=production.status().brief;
 await session.updateRow(input.id,input);
 if(parseScriptParts(brief.script).join('\n')===before){const rows=session.status().rows.filter(r=>r.id!==production.status().bookends?.titleRowId);await production.saveBrief({...brief,script:rows.map(r=>r.caption).join('\n'),readings:undefined,storyboard:undefined,scriptEdited:true});}
}
      else if(route==='/api/dictionary')await session.dictionary(input.items);
      else if(route==='/api/apply-dictionary')await session.applyDictionaryToRows();
      else if(route==='/api/approve')await session.approve(input.id,input.revision);
      else if(route==='/api/unapprove')await session.revokeReadingApprovals(input.revision);
      else if(route==='/api/listened')await session.markListened(input.id,input.revision);
      else if(route==='/api/confirm-cut'){if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');const row=session.status().rows.find(r=>r.id===input.id);if(!row)throw new Error('ROW_NOT_FOUND');inputBusy=true;try{await production.confirmCut(row,input.fingerprint);await session.markListened(input.id,input.revision);}finally{inputBusy=false;}}
      else if(route==='/api/reopen-cut'){if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');if(!session.status().rows.some(r=>r.id===input.id))throw new Error('ROW_NOT_FOUND');inputBusy=true;try{await production.reopenCut(input.id);await session.reopenListening(input.id);}finally{inputBusy=false;}}
      else if(route==='/api/finalize'){assertAdopted();if(input.confirmIrreversible!==true)throw new Error('FINAL_CONFIRMATION_REQUIRED');if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');inputBusy=true;try{await production.finalize(session.status());}finally{inputBusy=false;}}
      else if(route==='/api/cancel'){bankCanceled=true;narrationCanceled=true;draftCanceled=true;session.cancel();video.cancel();}
      else if(route==='/api/generate'){
        if(input.productionRevision!==undefined&&input.productionRevision!==production.finalInputsHash())throw new Error('STALE_REVISION');
        assertAdopted();if(!status().voiceConfirmed)throw new Error('VOICE_CONFIRMATION_REQUIRED');production.assertNoCorrections();
        if(input.consent!==true)return json(res,409,{error:'GENERATION_CONSENT_REQUIRED'});
        if(input.revision!==undefined&&input.revision!==session.revision())throw new Error('STALE_REVISION');
        const withMusic=input.createMusic===true;
        if(withMusic&&production.status().musicEnabled!==true)throw new Error('MUSIC_DISABLED');
        if(input.createMusic!==undefined&&typeof input.createMusic!=='boolean')throw new Error('INVALID_MUSIC_PREFERENCE');
        if(!Array.isArray(input.ids)||(!input.ids.length&&!withMusic))throw new Error('INVALID_SELECTION');
        if(input.ids.length)session.validateGeneration(input.ids,{regenerate:input.regenerate===true});
        else musicTimeline(session.status());
        if(withMusic)await musicDependency();
        inputBusy=true;narrationError=null;narrationCanceled=false;narrationStage=input.ids.length?'ナレーションを作成しています…':'BGMを作成しています…';
        (async()=>{try{
          if(input.ids.length)await session.generate(input.ids,{regenerate:input.regenerate===true});
          if(session.status().error)throw new Error(session.status().error);
          if(narrationCanceled)throw new Error('CANCELED');
          if(withMusic){narrationStage='BGMを作成しています…';await createMusic(input.musicDirection);}
        }catch(error){narrationError=/^[A-Z][A-Z_]+$/.test(error.message)?error.message:'REQUEST_FAILED';}finally{inputBusy=false;narrationStage=null;}})();
        return json(res,202,{started:true});
      }else return json(res,404,{error:'NOT_FOUND'});
      return json(res,200,status());
    }catch(error){
      // Only known local codes leave the server. Raw exceptions and keys never do.
      const message=String(error.message||'');const safe=/^[A-Z][A-Z_]+(?:: HTTP \d{3})?$/.test(message)?message:'REQUEST_FAILED';
      return json(res,safe==='ROW_NOT_FOUND'?404:409,{error:safe});
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  url='http://127.0.0.1:'+server.address().port;
  return {url,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);const value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  try{
    const outputDir=value('--output');if(!outputDir)throw new Error('OUTPUT_DIRECTORY_REQUIRED');
    await mkdir(outputDir,{recursive:true});const session=await NarrationSession.open({outputDir});
    if(value('--job')){if(session.status().rows.length)throw new Error('EXISTING_JOB_USE_IMPORT_UI');await session.replaceJob(JSON.parse(await readFile(value('--job'),'utf8')));}
    const service=await startServer({session,port:Number(value('--port')||6181),videoRendererRoot:value('--renderer-root')});
    console.log('NARRATION_STUDIO_READY '+service.url);
  }catch(error){console.error('NARRATION_STUDIO_START_FAILED '+(error.code||(/^[A-Z_]+$/.test(error.message)?error.message:'CHECK_OUTPUT_AND_PORT')));process.exitCode=1;}
}

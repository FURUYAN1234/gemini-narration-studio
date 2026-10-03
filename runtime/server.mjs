import http from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,realpath,mkdir,readdir,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {NarrationSession,SAMPLE_SETTINGS,VOICE_GENDERS} from './core.mjs';
import {themeTokens,THEME_NAMES} from './themes.mjs';
import {ProductionInputs,MAX_ASSET_BYTES,isHiraganaReading,normalizeReview,normalizeBrief,validateAsset} from './production.mjs';
import {VoiceSamples} from './samples.mjs';
import {StudioVideo,findRendererRoot,mediaRange} from './video.mjs';
import {VIDEO_TEMPLATES} from './designs.mjs';
import {atomicWrite} from './atomic-write.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function body(req){let bytes=0,parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2_000_000)throw new Error('BODY_TOO_LARGE');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
export async function startServer({session,port=6181,sampleDir=path.join(session.outputDir,'..','voice-samples'),bundledSampleDir=path.join(here,'vendor','voice-samples'),videoRendererRoot,downloadsDir,videoRunner,launcherStatus}) {
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
  let video=await StudioVideo.open({sourceDir:session.outputDir,rendererRoot,downloadsDir,runner:videoRunner});
  const samples=await new VoiceSamples([sampleDir,bundledSampleDir]).load();let inputBusy=false,sampleProgress=null,bankCanceled=false,bankError=null;
  let token=randomBytes(32).toString('hex'),instanceId=randomBytes(16).toString('hex'),url;
  const status=()=>{const current=session.status();Object.assign(projects.find(p=>p.id===projectId),{title:current.title,finalized:!!production.status().finalization});return {...current,projectId,projects:projects.map(p=>({...p})),video:video.status(current.revision),voiceGenders:VOICE_GENDERS,sampleSettings:SAMPLE_SETTINGS,rows:current.rows.map(row=>({...row,...production.cutInfo(row)})),busy:session.busy||inputBusy,error:bankError||session.error,instanceId,production:production.status(),samples:samples.status(),sampleProgress,sampleLibraryTotal:SAMPLE_SETTINGS.length};};
  const switchProject=async(id,{fresh=false}={})=>{
    const outputDir=await projectPath(id),next=await session.openRelated(outputDir,{fresh});
    const nextProduction=await ProductionInputs.open(outputDir),nextVideo=await StudioVideo.open({sourceDir:outputDir,rendererRoot,downloadsDir,runner:videoRunner});
    await atomicWrite(pointer,JSON.stringify({id}));session=next;production=nextProduction;video=nextVideo;projectId=id;bankError=null;sampleProgress=null;
    token=randomBytes(32).toString('hex');instanceId=randomBytes(16).toString('hex');
  };
  const reviewedManifest=async()=>{if(session.busy||inputBusy)throw new Error('BUSY');production.assertNoCorrections();production.assertCutsConfirmed(session.status().rows);production.assertFinalization(session.status());return session.exportManifest();};
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
        const assets={'/':'index.html','/app.mjs':'app.mjs','/style.css':'style.css'};
        if(assets[route]){res.setHeader('Content-Type',route==='/'?'text/html; charset=utf-8':route.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');return res.end(await readFile(path.join(here,'ui',assets[route])));}
        if(/^\/samples\/[a-f0-9]{64}\.wav$/.test(route)){res.setHeader('Content-Type','audio/wav');return res.end(await samples.read(route.slice(9,-4)));}
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
      if(inputBusy&&route!=='/api/cancel')throw new Error('BUSY');
      if(!['/api/key','/api/cancel','/api/preview','/api/prepare-samples','/api/render-video','/api/new-project','/api/project','/api/revision-project'].includes(route))production.assertWritable();
      if(route==='/api/material'){
        if(session.busy)throw new Error('BUSY');inputBusy=true;
        try{const parts=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_ASSET_BYTES)throw new Error('ASSET_TOO_LARGE');parts.push(chunk);}await production.addAsset(new URL(req.url,url).searchParams.get('name'),Buffer.concat(parts));return json(res,200,status());}finally{inputBusy=false;}
      }
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'JSON_REQUIRED'});
      const input=await body(req);
      const currentToken=Buffer.from(token);if(supplied.length!==currentToken.length||!timingSafeEqual(supplied,currentToken))return json(res,403,{error:'CSRF_TOKEN_REQUIRED'});
      if(inputBusy&&route!=='/api/cancel')throw new Error('BUSY');
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
            await atomicWrite(path.join(destination,'production.json'),JSON.stringify({...production.status(),cutConfirmations:[],finalization:null,requiresFinalization:true},null,2));
            try{await atomicWrite(path.join(destination,'video-scenes.json'),await readFile(path.join(source,'video-scenes.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
          }
          projects.push({id,title:'新しい動画'});
        }await switchProject(id,{fresh:route==='/api/new-project'});}finally{inputBusy=false;}
        return json(res,200,status());
      }
      if(!['/api/key','/api/cancel','/api/preview','/api/prepare-samples','/api/render-video'].includes(route))production.assertWritable();
      if(route==='/api/cut-image'){
        if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');const row=session.status().rows.find(r=>r.id===input.id);if(!row)throw new Error('ROW_NOT_FOUND');await production.assignCutImage(row,input.file);return json(res,200,status());
      }
      if(route==='/api/cut-visuals'){if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');await production.saveVisuals(input.visuals,session.status().rows);return json(res,200,status());}
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
      if(route==='/api/draft'){
        if(input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');
        const draft=await session.draftScript(input.brief,production.status().assets);return json(res,200,{...draft,model:'gemini-3.5-flash'});
      }
      if(route==='/api/design-draft'){
        if(input.consent!==true)throw new Error('GENERATION_CONSENT_REQUIRED');
        if(input.revision!==session.revision())throw new Error('STALE_REVISION');
        await session.draftDesign(input.instructions);return json(res,200,status());
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
          const proposed=all.map(r=>edits.find(e=>e.id===r.id)||r),brief={...production.status().brief,script:proposed.map(r=>r.caption).join('\n')};delete brief.readings;if(proposed.every(r=>isHiraganaReading(r.speech)))brief.readings=proposed.map(({caption,speech})=>({caption,speech}));normalizeBrief(brief);
          for(const e of edits)if(e.image)validateAsset('修正画像.'+e.image.extension,e.image.bytes);
          const visuals={...(production.status().visuals||{})};
          for(const e of edits){if(e.image){await production.addAsset('修正画像-'+e.id+'.'+e.image.extension,e.image.bytes);const image=production.status().assets.find(a=>a.file.startsWith(createHash('sha256').update(e.image.bytes).digest('hex')+'.'));await production.assignCutImage(all.find(r=>r.id===e.id),image.file);}visuals[e.id]={title:e.title,points:e.points};await production.reopenCut(e.id);}
          await production.saveVisuals(visuals,all);await session.applyCorrectionRows(edits,baseline);
          const current=session.status();await production.saveBrief(brief);
          await production.saveReview({...review,sourceRevision:current.revision,overall:input.id?review.overall:'',cuts:review.cuts.filter(c=>!edits.some(e=>e.id===c.rowId))});return json(res,200,{...status(),correctionResult:{ids:edits.map(e=>e.id),images:edits.filter(e=>e.image).length,textChanged:edits.filter(e=>{const r=all.find(r=>r.id===e.id);return r.caption!==e.caption||r.speech!==e.speech;}).length}});
        }finally{inputBusy=false;}
      }
      if(route==='/api/production'){if(session.busy)throw new Error('BUSY');inputBusy=true;try{await production.saveBrief(input);}finally{inputBusy=false;}}
      else if(route==='/api/review'){if(session.busy)throw new Error('BUSY');if(input.expectedRevision!==session.revision())throw new Error('STALE_REVISION');if(!Array.isArray(input.review?.cuts)||input.review.cuts.some(c=>!session.status().rows.some(r=>r.id===c.rowId)))throw new Error('INVALID_REVIEW_CUT');inputBusy=true;try{await production.saveReview({...input.review,sourceRevision:session.revision()});}finally{inputBusy=false;}}
      else if(route==='/api/append-script')await session.appendScript(input.script,{readings:input.readings??production.status().brief.readings,consent:input.consent});
      else if(route==='/api/key'){if(input.clear)session.clearKey();else session.setKey(input.key);}
      else if(route==='/api/job'){
        if(input.sessionId!==session.status().sessionId)throw new Error('SESSION_MISMATCH');
        await session.replaceJob(input.job,{confirmReplace:input.confirmReplace===true,expectedRevision:input.expectedRevision,sessionId:input.sessionId});
      }
      else if(route==='/api/settings')await session.configure(input);
      else if(route==='/api/title')await session.setTitle(input.title);
      else if(route==='/api/presentation'){if(input.presentation){if(input.revision!==session.revision())throw new Error('STALE_REVISION');await session.setPresentation(input.presentation);}else await session.setTheme(input.theme);}
      else if(route==='/api/append-row'){if(!isHiraganaReading(input.speech))throw new Error('HIRAGANA_READING_REQUIRED');await session.appendRow(input);}
      else if(route==='/api/row')await session.updateRow(input.id,input);
      else if(route==='/api/dictionary')await session.dictionary(input.items);
      else if(route==='/api/apply-dictionary')await session.applyDictionaryToRows();
      else if(route==='/api/approve')await session.approve(input.id,input.revision);
      else if(route==='/api/unapprove')await session.revokeReadingApprovals(input.revision);
      else if(route==='/api/listened')await session.markListened(input.id,input.revision);
      else if(route==='/api/confirm-cut'){if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');const row=session.status().rows.find(r=>r.id===input.id);if(!row)throw new Error('ROW_NOT_FOUND');inputBusy=true;try{await production.confirmCut(row,input.fingerprint);await session.markListened(input.id,input.revision);}finally{inputBusy=false;}}
      else if(route==='/api/reopen-cut'){if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');if(!session.status().rows.some(r=>r.id===input.id))throw new Error('ROW_NOT_FOUND');inputBusy=true;try{await production.reopenCut(input.id);await session.reopenListening(input.id);}finally{inputBusy=false;}}
      else if(route==='/api/finalize'){if(input.confirmIrreversible!==true)throw new Error('FINAL_CONFIRMATION_REQUIRED');if(session.busy)throw new Error('BUSY');if(input.revision!==session.revision())throw new Error('STALE_REVISION');inputBusy=true;try{await production.finalize(session.status());}finally{inputBusy=false;}}
      else if(route==='/api/cancel'){bankCanceled=true;session.cancel();video.cancel();}
      else if(route==='/api/generate'){
        if(input.consent!==true)return json(res,409,{error:'GENERATION_CONSENT_REQUIRED'});
        session.validateGeneration(input.ids,{regenerate:input.regenerate===true});
        session.generate(input.ids,{regenerate:input.regenerate===true}).catch(()=>{});
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

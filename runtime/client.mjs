import {readFile,writeFile,mkdir,copyFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {wavInfo} from './core.mjs';
import {ProductionInputs} from './production.mjs';
import {createHash} from 'node:crypto';
import {buildSubtitleCues} from './subtitles.mjs';
export async function getStudioStatus(base='http://127.0.0.1:6181'){
  const url=new URL(base);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw new Error('LOCAL_STUDIO_REQUIRED');
  const response=await fetch(url.origin+'/api/status');if(!response.ok)throw new Error('STUDIO_UNAVAILABLE');return response.json();
}
export async function importJob(file,base='http://127.0.0.1:6181',{sessionId,replace=false}={}) {
  const state=await getStudioStatus(base);if(!sessionId||sessionId!==state.sessionId)throw new Error('SESSION_MISMATCH');if(state.rows.length&&!replace)throw new Error('JOB_REPLACE_CONFIRM_REQUIRED');const job=JSON.parse(await readFile(file,'utf8'));
  const {token}=await (await fetch(base+'/api/bootstrap')).json();
  const result=await fetch(base+'/api/job',{method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},body:JSON.stringify({job,sessionId,expectedRevision:state.revision,confirmReplace:replace})});
  const value=await result.json();if(!result.ok)throw new Error(value.error);return value;
}
export async function prepareReviewedAudio({sourceDir,publicDir,fps=30,gapFrames}) {
  if(!Number.isInteger(fps)||fps<1||fps>120)throw new Error('INVALID_TIMING');
  const production=await ProductionInputs.open(sourceDir);production.assertNoCorrections();
  const storedPause=production.status().pauseSeconds,storedGap=storedPause===undefined?7:Math.round(storedPause*fps);if(gapFrames===undefined)gapFrames=storedGap;if(!Number.isInteger(gapFrames)||gapFrames<0||(storedPause!==undefined&&gapFrames!==storedGap))throw new Error('INVALID_TIMING');
  const manifest=JSON.parse(await readFile(path.join(sourceDir,'narration-manifest.json'),'utf8'));
  // Re-open the current persisted job; an old manifest cannot bypass later edits.
  const {NarrationSession}=await import('./core.mjs');
  const session=await NarrationSession.open({outputDir:sourceDir});const current=await session.exportManifest({persist:false});
  production.assertCutsConfirmed(session.status().rows);
  production.assertFinalization(session.status());
  production.assertMusicCurrent(session.status());
  // The first studio version had no presentation field. Accept only that exact
  // default-theme migration; all reading/audio guards above still apply.
  const legacyJob={...session.job};delete legacyJob.presentation;
  const legacyRevision=createHash('sha256').update(JSON.stringify(legacyJob)).digest('hex');
  const migrated=!manifest.presentation&&current.presentation.theme==='moon'&&manifest.revision===legacyRevision;
  if(manifest.revision!==current.revision&&!migrated)throw new Error('STALE_AUDIO_MANIFEST');
  const root=await realpath(sourceDir);let from=0;
  const rows=[];await mkdir(path.join(publicDir,'narration'),{recursive:true});
  for(const row of current.rows){
    if(!/^audio\/[a-f0-9]{64}\.wav$/.test(row.file))throw new Error('INVALID_AUDIO_PATH');
    const source=await realpath(path.join(root,row.file));if(path.dirname(source)!==path.join(root,'audio'))throw new Error('INVALID_AUDIO_PATH');
    const bytes=await readFile(source);const contentHash=createHash('sha256').update(JSON.stringify(bytes.toString('base64'))).digest('hex');
    if(contentHash!==row.contentHash)throw new Error('AUDIO_HASH_MISMATCH');
    const info=wavInfo(bytes),frames=Math.ceil(info.durationSeconds*fps),src='narration/'+path.basename(source);
    const subtitles=buildSubtitleCues({caption:row.caption,speech:row.speech,bytes,fps,frames});
    await copyFile(source,path.join(publicDir,src));rows.push({...row,src,from,frames,subtitles});from+=frames+gapFrames;
  }
  const bookends=production.ending();const ending=bookends?{...bookends,from,frames:Math.round(bookends.endSeconds*fps)}:undefined;const result={...current,title:bookends?.titleRowId===rows[0]?.id?rows[0].caption:current.title,fps,gapFrames,durationInFrames:from+(ending?.frames||0),rows,...(ending?{bookends:ending}:{})};await writeFile(path.join(publicDir,'narration.json'),JSON.stringify(result,null,2),'utf8');return result;
}

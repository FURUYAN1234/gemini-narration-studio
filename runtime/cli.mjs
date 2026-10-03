import {getStudioStatus,importJob,prepareReviewedAudio} from './client.mjs';
import {writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {themeTokens} from './themes.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
try{
  if(args[0]==='status'){
    const s=await getStudioStatus(option('--url'));console.log(JSON.stringify({sessionId:s.sessionId,title:s.title,keyConfigured:s.keyConfigured,busy:s.busy,error:s.error,rows:s.rows.length,reviewed:s.rows.filter(r=>r.reviewed).length,listened:s.rows.filter(r=>r.audioCurrent&&r.listenedCurrent).length}));
  }else if(args[0]==='brief'){
    const s=await getStudioStatus(option('--url'));console.log(JSON.stringify({sessionId:s.sessionId,production:s.production},null,2));
  }else if(args[0]==='import'){
    if(!option('--job'))throw new Error('JOB_FILE_REQUIRED');const s=await importJob(option('--job'),option('--url'),{sessionId:option('--session'),replace:args.includes('--replace')});console.log('IMPORTED '+s.rows.length+' rows; reading review required');
  }else if(args[0]==='prepare'){
    const sourceDir=option('--source'),publicDir=option('--public');if(!sourceDir||!publicDir)throw new Error('SOURCE_AND_PUBLIC_REQUIRED');
    const data=await prepareReviewedAudio({sourceDir,publicDir});const theme=await themeTokens(option('--theme')||data.presentation.theme);await writeFile(path.join(publicDir,'presentation-theme.json'),JSON.stringify(theme,null,2));
    for(const name of ['NotoSansJP.ttf','NotoSansJP-OFL.txt'])await copyFile(new URL('./vendor/'+name,import.meta.url),path.join(publicDir,'narration',name));
    const stamp=frames=>{const ms=Math.round(frames/data.fps*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
    await mkdir(path.join(publicDir,'narration'),{recursive:true});await writeFile(path.join(publicDir,'narration','subtitles.srt'),data.rows.map((r,i)=>`${i+1}\n${stamp(r.from)} --> ${stamp(r.from+r.frames)}\n${r.caption}\n`).join('\n'),'utf8');
    console.log('REVIEWED_NARRATION_READY '+data.rows.length+' rows / '+data.durationInFrames+' frames');
  }else throw new Error('USE_STATUS_IMPORT_OR_PREPARE');
}catch(error){console.error('NARRATION_NOT_READY '+(/^[A-Z][A-Z_]+$/.test(error.message)?error.message:error.code||'CHECK_STUDIO_AND_FILES'));process.exitCode=1;}

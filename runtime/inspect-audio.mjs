import {readFile,open,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {inspectAudioFile,prepareInspectionAudio,requestStudioInspection} from './audio-inspection.mjs';

const args=process.argv.slice(2),flag=name=>args.includes(name),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const help='node inspect-audio.mjs --audio <WAV/MP3/M4A/FLAC/MP4> --out <new-report.json> [--expected <UTF-8-text-file>] [--semantic --allow-paid --url http://127.0.0.1:6181] [--ffmpeg <exe> --ffprobe <exe>]';
let report,reportFile;
try{
  if(flag('--help')){console.log(help);}else{
    const allowed=['--audio','--out','--expected','--semantic','--allow-paid','--url','--ffmpeg','--ffprobe'];
    for(let i=0;i<args.length;i++){if(!allowed.includes(args[i]))throw new Error('INVALID_ARGUMENT');if(!['--semantic','--allow-paid'].includes(args[i])&&(!args[++i]||args[i].startsWith('--')))throw new Error('INVALID_ARGUMENT');}
    if(!option('--audio')||!option('--out'))throw new Error('AUDIO_AND_REPORT_REQUIRED');
    if(flag('--semantic')&&!flag('--allow-paid'))throw new Error('INSPECTION_CONSENT_REQUIRED');
    const options={...(option('--ffmpeg')?{ffmpeg:option('--ffmpeg')} : {}),...(option('--ffprobe')?{ffprobe:option('--ffprobe')} : {})};
    const out=path.resolve(option('--out'));await mkdir(path.dirname(out),{recursive:true});
    // Reserve a new report before any paid request. Existing reports and source
    // files cannot be replaced; the open handle also avoids a later path race.
    reportFile=await open(out,'wx');
    const prepared=flag('--semantic')?await prepareInspectionAudio(option('--audio'),options):null;
    report=prepared?{version:1,inspectedAt:new Date().toISOString(),source:prepared.source,technical:prepared.technical,semantic:{status:'not_run'}}:await inspectAudioFile(option('--audio'),options);
    if(flag('--semantic')){
      report.semantic={status:'failed',reason:'INSPECTION_NOT_COMPLETED'};
      try{const expectedText=option('--expected')?await readFile(option('--expected'),'utf8'):'';report.semantic=await requestStudioInspection({...prepared,expectedText},{url:option('--url'),consent:true});}
      catch(e){report.semantic={status:'failed',reason:/^[A-Z_]+(?:: HTTP \d{3})?$/.test(e.message)?e.message:'INSPECTION_REQUEST_FAILED',requestCount:'unknown; do not retry automatically'};process.exitCode=1;}
    }
    await reportFile.writeFile(JSON.stringify(report,null,2)+'\n');
    const apiUi=flag('--semantic')?{required:true,view:report.semantic.status==='completed'?'result':report.semantic.reason==='API_KEY_REQUIRED'?'connection':'diagnostic',report:out}:{required:false,view:'none'};
    console.log(JSON.stringify({report:out,technical:report.technical.status,semantic:report.semantic.status,verdict:report.semantic.verdict||'unverified',paidRequests:report.semantic.requestCount||0,apiUi}));
    if(report.technical.status==='failed'||report.semantic.verdict==='needs_review')process.exitCode=1;
  }
}catch(e){
  const error=/^[A-Z_]+(?:: HTTP \d{3})?$/.test(e.message)?e.message:e.code==='EEXIST'?'REPORT_ALREADY_EXISTS':e.code==='ENOENT'?'INPUT_FILE_REQUIRED':'CHECK_AUDIO_AND_RUNTIME';
  if(reportFile&&!report)await reportFile.writeFile(JSON.stringify({version:1,status:'failed',error})+'\n');
  console.error('AUDIO_INSPECTION_FAILED '+error);process.exitCode=1;
}finally{await reportFile?.close();}

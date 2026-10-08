import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {wavInfo} from './core.mjs';

export function narrationSignature(current,pauseSeconds){return createHash('sha256').update(JSON.stringify([current.revision,pauseSeconds,current.rows.map(r=>[r.id,r.reviewed,r.audioCurrent,r.audio?.file,r.audio?.contentHash])])).digest('hex');}
// Concatenate the existing PCM samples, with the same frame rounding and pauses
// as the renderer. No provider call, resynthesis, or listening approval occurs.
export async function fullNarration(current,sourceDir,pauseSeconds){
  if(!current.rows.length||current.rows.some(r=>!r.reviewed||!r.audioCurrent))throw new Error('AUDIO_REQUIRED');
  const gap=pauseSeconds===undefined?7:Math.round(pauseSeconds*30);
  if(!Number.isInteger(gap)||gap<0||gap>90)throw new Error('INVALID_TIMING');
  const root=await realpath(path.join(sourceDir,'audio')),chunks=[];let rate=0,total=0;
  for(const row of current.rows){
    if(!/^[a-f0-9]{64}\.wav$/.test(row.audio.file))throw new Error('INVALID_AUDIO_PATH');
    const file=await realpath(path.join(root,row.audio.file));if(path.dirname(file)!==root)throw new Error('INVALID_AUDIO_PATH');
    const bytes=await readFile(file);wavInfo(bytes);
    if(createHash('sha256').update(JSON.stringify(bytes.toString('base64'))).digest('hex')!==row.audio.contentHash)throw new Error('AUDIO_HASH_MISMATCH');
    let sampleRate=0;const pcm=[];
    for(let p=12;p+8<=bytes.length;){const size=bytes.readUInt32LE(p+4),kind=bytes.toString('ascii',p,p+4);if(kind==='fmt ')sampleRate=bytes.readUInt32LE(p+12);if(kind==='data')pcm.push(bytes.subarray(p+8,p+8+size));p+=8+size+(size%2);}
    if(!sampleRate||(rate&&rate!==sampleRate))throw new Error('UNSUPPORTED_WAV');rate=sampleRate;
    const data=Buffer.concat(pcm),frames=Math.ceil(data.length/(rate*2)*30),length=Math.round((frames+gap)*rate/30)*2;
    total+=length;if(total>512*1024*1024)throw new Error('AUDIO_SIZE_LIMIT');
    chunks.push(data,Buffer.alloc(length-data.length));
  }
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(total+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(total,40);return Buffer.concat([header,...chunks]);
}

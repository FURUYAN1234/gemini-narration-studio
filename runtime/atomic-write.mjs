import {writeFile,rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
// Windows indexers can briefly lock the destination. Keep the old file intact
// and retry only this local atomic rename; never retry a provider request.
export async function atomicWrite(file,data,{renameFile=rename,wait=delay}={}) {
  await writeFile(file+'.tmp',data,'utf8');
  for(let attempt=0;attempt<6;attempt++){
    try{await renameFile(file+'.tmp',file);return;}
    catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt===5)throw error;await wait(25*2**attempt);}
  }
}

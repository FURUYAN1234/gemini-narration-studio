import {mkdir,readFile,readdir,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {previewFingerprint,wavInfo} from './core.mjs';
import {atomicWrite} from './atomic-write.mjs';

export class VoiceSamples {
  constructor(dirs){this.dirs=dirs.map(d=>path.resolve(d));this.items=[];}
  async load(){this.items=[];for(const dir of this.dirs){await mkdir(dir,{recursive:true});for(const file of await readdir(dir)){if(!/^[a-f0-9]{64}\.json$/.test(file))continue;try{const item=JSON.parse(await readFile(path.join(dir,file),'utf8'));if(item.id!==previewFingerprint(item.settings)||file!==item.id+'.json'||item.file!==item.id+'.wav')continue;const root=await realpath(dir),audio=await realpath(path.join(root,item.file));if(path.dirname(audio)!==root)continue;wavInfo(await readFile(audio));if(!this.items.some(i=>i.id===item.id))this.items.push({...item,dir});}catch{}}}return this;}
  status(){return this.items.map(({dir,...item})=>item);}
  find(config){return this.items.find(i=>i.id===previewFingerprint(config));}
  async save({bytes,settings}){const id=previewFingerprint(settings);const item={id,file:id+'.wav',settings,source:'Gemini TTS',createdAt:new Date().toISOString(),...wavInfo(bytes)};await writeFile(path.join(this.dirs[0],item.file),bytes);await atomicWrite(path.join(this.dirs[0],id+'.json'),JSON.stringify(item,null,2));this.items=this.items.filter(i=>i.id!==id);this.items.push({...item,dir:this.dirs[0]});return item;}
  async read(id){const item=this.items.find(i=>i.id===id);if(!item)throw new Error('SAMPLE_NOT_FOUND');const root=await realpath(item.dir),target=await realpath(path.join(root,item.file));if(path.dirname(target)!==root)throw new Error('SAMPLE_NOT_FOUND');return readFile(target);}
}

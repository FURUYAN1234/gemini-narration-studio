import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProductionInputs} from '../production.mjs';
import {normalizeRecording} from '../demo-recording.mjs';
import {recordingCuts,recordingEditRequest,recordingMetadata} from '../recording-edits.mjs';

const metadata={duration:6,events:[
  {action:'fill',target:'Project name',startMs:800,endMs:880,text:'Sample field content'},
  {action:'click',target:'Show Preview',startMs:1650,endMs:1700},
  {action:'click',target:'Show Preview',startMs:4800,endMs:4900}
]};
test('recording accepts a scoped loopback URL and declarative steps only',()=>{
  const input={url:'http://127.0.0.1:6088/demo',steps:[{action:'click',target:'開始'}]};
  assert.equal(normalizeRecording(input).url.port,'6088');
  for(const url of ['https://127.0.0.1:6088/','http://127.0.0.1/','http://localhost:6088/','http://127.0.0.1:6088/?key=example','http://user@127.0.0.1:6088/']){
    assert.throws(()=>normalizeRecording({...input,url}),/INVALID_RECORDING_URL/);
  }
  assert.throws(()=>normalizeRecording({...input,steps:[{action:'run',target:'開始'}]}),/INVALID_RECORDING_STEPS/);
});
test('AI input omits values and media, and an edit can skip redundant input',()=>{
  const request=JSON.stringify(recordingEditRequest(metadata));
  assert.match(request,/Project name/);
  assert.doesNotMatch(request,/Sample field content|inlineData|https?:/);
  const file='a'.repeat(64)+'.mp4';
  const cuts=recordingCuts({cuts:[{first:0,last:1,title:'確認',caption:'表示する'}]},metadata,file);
  assert.equal(cuts[0].image,file);
  assert.ok(cuts[0].startFrame+cuts[0].frames<Math.floor(4.8*30));
  assert.throws(()=>recordingCuts({cuts:[{first:1,last:2,title:'A',caption:''},{first:2,last:2,title:'B',caption:''}]},metadata,file),/INVALID_RECORDING_EDIT/);
  assert.throws(()=>recordingMetadata({...metadata,duration:2}),/INVALID_RECORDING_METADATA/);
});
test('saved operation recordings reopen with timing and preserve original bytes',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'narration-recording-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const p=await ProductionInputs.open(dir),fixture=Buffer.from('xxxxftyp fixture only');
  await p.addAsset('操作録画.mp4',fixture,{origin:'operation-recording',recording:metadata});
  const restored=await ProductionInputs.open(dir),[asset]=restored.status().assets;
  assert.deepEqual(asset.recording,recordingMetadata(metadata));
  assert.deepEqual(await restored.readAsset(asset.file),fixture);
});

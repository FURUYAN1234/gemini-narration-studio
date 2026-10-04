import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMotion,sceneDirection,motionFrame,fitText,pointSchedule,normalizeImageFocus,focusFrame,IMAGE_FOCUS_SCHEMA} from '../motion.mjs';
import {normalizePresentation,normalizeDesign,VIDEO_TEMPLATES,presentationMotion} from '../designs.mjs';

const motion={version:1,style:'cinematic',intensity:'standard'};
test('image focus accepts bounded declarative coordinates and plain labels only',()=>{
 const focus={x:.2,y:.75,zoom:1.8,label:'図の注目部分'};
 assert.deepEqual(normalizeImageFocus(focus),focus);assert.equal(IMAGE_FOCUS_SCHEMA.additionalProperties,false);
 for(const input of [null,[],{}, {...focus,x:-.01},{...focus,y:1.01},{...focus,x:NaN},{...focus,zoom:Infinity},{...focus,zoom:.9},{...focus,zoom:2.1},{...focus,x:'0.5'},{...focus,label:5},{...focus,label:'長'.repeat(81)},{...focus,label:'<script>x</script>'},{...focus,label:'改行\n注釈'},{...focus,label:'向き\u202e'},{...focus,url:'https://example.com'},{...focus,script:'alert(1)'}])assert.throws(()=>normalizeImageFocus(input),/INVALID_IMAGE_FOCUS/);
 for(const x of [0,.5,1])for(const y of [0,.5,1])for(const zoom of [1,2])assert.doesNotThrow(()=>normalizeImageFocus({x,y,zoom,label:''}));
 assert.throws(()=>normalizeImageFocus(Object.assign(Object.create({x:.2}),{y:.75,zoom:1.8,label:'図',extra:true})),/INVALID_IMAGE_FOCUS/);
});
test('image focus holds the complete image, moves toward its target, then holds deterministically',()=>{
 const focus={x:.25,y:.75,zoom:2,label:'注目'},input={frames:241,focus};
 assert.deepEqual(focusFrame({...input,frame:0}),{scale:1,x:0,y:0,locatorX:.25,locatorY:.75,highlight:0});
 assert.equal(focusFrame({...input,frame:30}).scale,1);
 const middle=focusFrame({...input,frame:100}),last=focusFrame({...input,frame:240});
 assert.ok(middle.scale>1&&middle.scale<2);assert.ok(middle.x>0&&middle.y<0);
 assert.equal(last.scale,2);assert.equal(last.locatorX,.5);assert.equal(last.locatorY,.5);
 assert.deepEqual(focusFrame({...input,frame:170}),last);
 assert.deepEqual(focusFrame({...input,frame:100}),middle);
});
test('focus movement keeps image edges covered and corner locators on image, including short cuts',()=>{
 for(const frames of [1,2,8,240])for(const frame of [-1,0,frames/2,frames-1,frames+20])for(const x of [0,.25,.5,.75,1])for(const y of [0,.5,1]){
  const state=focusFrame({frame,frames,focus:{x,y,zoom:2,label:''}}),limit=(state.scale-1)/2;
  assert.ok(Object.values(state).every(Number.isFinite));assert.ok(state.scale>=1&&state.scale<=2);
  assert.ok(Math.abs(state.x)<=limit&&Math.abs(state.y)<=limit);
  assert.ok(state.locatorX>=0&&state.locatorX<=1&&state.locatorY>=0&&state.locatorY<=1);
 }
 for(const edit of [{frames:0},{frames:1.5},{frame:NaN},{frame:Infinity}])assert.throws(()=>focusFrame({frame:0,frames:30,focus:{x:.5,y:.5,zoom:1,label:''},...edit}),/INVALID_MOTION_TIMING/);
});
test('versioned local motion rejects code, URLs, unsupported values and nonobjects',()=>{
 assert.deepEqual(normalizeMotion(motion),motion);
 for(const value of [null,[],{...motion,version:2},{...motion,style:'https://example.com'},{...motion,intensity:99},{...motion,script:'alert(1)'}])assert.throws(()=>normalizeMotion(value),/INVALID_MOTION/);
 for(const style of ['cinematic','kinetic','editorial'])for(const intensity of ['subtle','standard','bold'])assert.doesNotThrow(()=>normalizeMotion({...motion,style,intensity}));
});
test('legacy presentation is byte-shape compatible; motion survives template and custom normalization',()=>{
 assert.deepEqual(normalizePresentation({theme:'moon'}),{theme:'moon'});
 assert.equal(presentationMotion({theme:'moon'}),null);
 const p={theme:'moon',mode:'template',template:'clean',motion};assert.deepEqual(normalizePresentation(p),p);
 const design={...VIDEO_TEMPLATES[0].design,motion};assert.deepEqual(normalizeDesign(design),design);
 assert.deepEqual(presentationMotion({theme:'moon',mode:'ai',design}),motion);
 assert.equal(presentationMotion({theme:'moon',mode:'ai',design,motion:null}),null);
 assert.throws(()=>normalizePresentation({...p,motion:{...motion,script:'x'}}),/INVALID_MOTION/);
});
test('direction responds to content and sequence, never names or example phrases',()=>{
 assert.equal(sceneDirection({row:{image:'cut.png',points:[]},index:0,count:4,motion}).layout,'hero');
 assert.equal(sceneDirection({row:{points:['A','B','C']},index:1,count:4,motion}).layout,'sequence');
 assert.equal(sceneDirection({row:{image:'cut.png'},index:2,count:4,motion}).layout,'image');
 assert.equal(sceneDirection({row:{},index:3,count:4,motion}).layout,'closing');
 assert.equal(sceneDirection({row:{},index:1,count:4,motion}).layout,'statement');
});
test('motion is deterministic, finite on short cuts, and keeps a sustained legible hold',()=>{
 for(const frames of [1,8,30,240,1500])for(const f of [0,frames/2,frames-1]){
  const input={frame:f,frames,fps:30,motion};const a=motionFrame(input);assert.deepEqual(a,motionFrame(input));
  for(const value of Object.values(a))assert.ok(Number.isFinite(value));
  assert.ok(a.reveal>=0&&a.reveal<=1);assert.ok(a.scale>=1&&a.scale<=1.1);
 }
 assert.equal(motionFrame({frame:90,frames:240,fps:30,motion}).reveal,1);
 assert.notEqual(motionFrame({frame:80,frames:240,fps:30,motion}).pan,motionFrame({frame:170,frames:240,fps:30,motion}).pan);
 assert.throws(()=>motionFrame({frame:0,frames:0,fps:30,motion}),/INVALID_MOTION_TIMING/);
});
test('text fitting preserves every character including long Japanese and emoji without truncation',()=>{
 for(const text of ['短い見出し','説明が長い場合にも文字を切り捨てずすべて読み取れる必要があります。'.repeat(5),'ABC'.repeat(80),'🌱新しい発見']){
  const fit=fitText(text,{width:900,height:540,maxSize:116});
  assert.equal(fit.lines.join(''),text);assert.ok(fit.size>0&&fit.size<=116);assert.ok(fit.lines.length*fit.size*1.2<=540+.01);
 }
});
test('points use existing sentence cue boundaries, fit short cuts and retain all points',()=>{
 const row={frames:240,subtitles:[{from:0,to:80},{from:80,to:160},{from:160,to:240}]};
 assert.deepEqual(pointSchedule(row,3,30),[0,80,160]);
 const times=pointSchedule({frames:8},6,30);assert.equal(times.length,6);assert.ok(times.every(t=>t>=0&&t<8));
});

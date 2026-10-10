import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMotion,sceneDirection,motionFrame,fitText,pointSchedule,normalizeImageFocus,focusFrame,IMAGE_FOCUS_SCHEMA} from '../motion.mjs';
test('continuous Japanese compounds stay together in narrow previews and rendered headings',()=>{
 for(const text of ['自分で行う！発信者情報開示請求','知っておきたい個人情報保護制度','使いやすい画像生成機能'])for(const width of [180,560,820]){
  const fit=fitText(text,{width,height:250,maxSize:72,lineHeight:1.4,balance:true});
  assert.equal(fit.lines.join(''),text);
  for(const compound of text.match(/[\p{Script=Han}]{2,}/gu)||[])assert.ok(fit.lines.some(line=>line.includes(compound)),compound+' split across lines');
  assert.ok(fit.lines.length*fit.size*1.4<=250);
  assert.ok(fit.lines.every(line=>[...line].length*fit.size<=width));
 }
 const ordinary=fitText('道具を選んで、楽しく作る。',{width:400,height:250,maxSize:72,balance:true});assert.equal(ordinary.lines.join(''),'道具を選んで、楽しく作る。');assert.ok(ordinary.lines.length>1);
});
test('headlines wrap at Japanese word boundaries and keep ordinary alternative titles readable',()=>{
 assert.deepEqual(fitText('3つの小さな工夫',{width:800,height:300,maxSize:112,balance:true}).lines,['3つの','小さな工夫']);
 for(const text of ['3つの小さな工夫','お気に入りの1冊','手軽な準備で楽しむ']){
  const fit=fitText(text,{width:560,height:250,maxSize:118,balance:true});
  assert.equal(fit.lines.join(''),text);
  for(const word of [...new Intl.Segmenter('ja',{granularity:'word'}).segment(text)].filter(s=>s.isWordLike&&s.segment.length>1))assert.ok(fit.lines.some(line=>line.includes(word.segment)),word.segment+' split across lines');
  assert.ok(fit.lines.every(line=>! /^[のにをがはへとでやもな]/.test(line)));
  assert.ok(fit.lines.length*fit.size*1.2<=250);
 }
 const plain=fitText('静かな場所で読書を楽しむ',{width:900,height:540,maxSize:116});assert.equal(plain.lines.join(''),'静かな場所で読書を楽しむ');
 const english=fitText('Creative presentation workflow',{width:560,height:250,maxSize:118,balance:true});assert.ok(english.lines.some(line=>line.includes('presentation')));
 const punctuation=fitText('「使いやすい道具」を選ぶ。',{width:560,height:250,maxSize:118,balance:true});assert.equal(punctuation.lines.join(''),'「使いやすい道具」を選ぶ。');assert.ok(punctuation.lines.every(line=>! /^[」）。、]/.test(line)&&!/[「（]$/.test(line)));
});
import {normalizePresentation,normalizeDesign,VIDEO_TEMPLATES,presentationMotion} from '../designs.mjs';

const motion={version:1,style:'cinematic',intensity:'standard'};
test('transition surfaces preserve AI choices and use the actual palette or next image instead of one accent',async()=>{
 const {transitionPlan,transitionSurface,TRANSITION_TONES}=await import('../motion.mjs');
 const palette={background:'#14161e',accent:'#a9c6ff',heading:'#ffffff'},rows=[{id:'a',image:'cuts/a.jpg'},{id:'b',image:'cuts/b.jpg'},{id:'c',image:'cuts/c.jpg'},{id:'d'}];
 const plan=transitionPlan({rows,motion});assert.deepEqual(plan.slice(0,2).map(t=>t.tone),['image','background']);
 assert.deepEqual(transitionSurface(plan[0],{palette,image:rows[1].image}),{color:palette.background,image:'cuts/b.jpg'});
 assert.deepEqual(transitionSurface(plan[1],{palette,image:rows[2].image}),{color:palette.background});
 const ai={...motion,transitions:['wipe','iris','diagonal'],transitionTones:['heading','accent','image']};
 assert.deepEqual(normalizeMotion(ai),ai);assert.deepEqual(normalizePresentation({theme:'moon',motion:ai}).motion,ai);
 const chosen=transitionPlan({rows,motion:ai});assert.deepEqual(chosen.map(t=>t.tone),['heading','accent','background']);
 assert.equal(transitionSurface(chosen[0],{palette}).color,palette.heading);
 const textOnly=transitionPlan({rows:Array.from({length:8},()=>({})),motion});assert.ok(new Set(textOnly.map(t=>transitionSurface(t,{palette}).color)).size>=2);
 const repeated=transitionPlan({rows,motion:{...motion,transitionTones:['accent','accent','accent']}});assert.notEqual(repeated[0].tone,repeated[1].tone);
 assert.deepEqual(transitionSurface({tone:'image'},{palette}),{color:palette.background});
 for(const transitionTones of [[],['red'],['url(https://example.com)'],Array(31).fill('image'),'image',[1]])assert.throws(()=>normalizeMotion({...motion,transitionTones}),/INVALID_MOTION/);
 assert.deepEqual(TRANSITION_TONES,['image','background','accent','heading']);
 for(const image of ['https://example.com/a.jpg','../private.jpg','cuts/../../secret','data:image/png;base64,x'])assert.throws(()=>transitionSurface({tone:'image'},{palette,image}),/INVALID_TRANSITION/);
 assert.throws(()=>transitionSurface({tone:'code'},{palette}),/INVALID_TRANSITION/);
 assert.throws(()=>transitionSurface({tone:'accent'},{palette:{...palette,accent:'url(secret)'}}),/INVALID_TRANSITION/);
 assert.equal(transitionSurface({tone:'accent'},{palette:{background:'#fdf6e3',accent:'#cb4b16',heading:'#657b83'}}).color,'#cb4b16');
});
test('transition catalogue and AI choices stay bounded, compatible and deterministic',async()=>{
 const {TRANSITION_FAMILIES,transitionPlan,transitionLayers,transitionFrame}=await import('../motion.mjs');
 assert.equal(TRANSITION_FAMILIES.length,13);
 const planned={...motion,transitions:['iris','diagonal','blinds']};
 assert.deepEqual(normalizePresentation({theme:'moon',motion:planned}).motion,planned);
 const rows=Array.from({length:50},(_,i)=>({id:'cut-'+i,frames:240,points:i%3===0?['A','B']:[]}));
 const plan=transitionPlan({rows,motion:planned});assert.deepEqual(plan,transitionPlan({rows,motion:planned}));
 assert.deepEqual(plan.slice(0,3).map(t=>t.family),planned.transitions);
 const seen=new Set();
 for(const style of ['cinematic','kinetic','editorial']){
  const choices=transitionPlan({rows,motion:{...motion,style}});
  for(let i=0;i<choices.length;i++){const t=choices[i];seen.add(t.family+':'+t.variant);if(i)assert.notEqual(t.family,choices[i-1].family);}
 }
 assert.equal(seen.size,35);
 const repeated=transitionPlan({rows,motion:{...motion,transitions:['wipe','wipe','wipe']}});
 assert.notEqual(repeated[0].family,repeated[1].family);
 for(const transitions of [[],['invented'],['https://example.com'],Array(31).fill('fade'),'iris',[1]])assert.throws(()=>normalizeMotion({...motion,transitions}),/INVALID_MOTION/);
 assert.throws(()=>normalizeMotion({...motion,transitions:['iris'],code:'x'}),/INVALID_MOTION/);
 for(const t of [...seen].map(key=>{const [family,variant]=key.split(':');return {family,variant:Number(variant)};})){
  assert.deepEqual(transitionLayers(t,0,'#123456'),[]);
  assert.deepEqual(transitionLayers(t,1,'#123456'),[{inset:0,background:'#123456'}]);
  for(const coverage of [.1,.5,.9]){const layers=transitionLayers(t,coverage,'#123456');assert.ok(layers.length>0&&layers.length<=24);assert.doesNotMatch(JSON.stringify(layers),/NaN|Infinity|undefined/);}
 }
 for(const frames of [1,2,8,30,240])for(const frame of [-1,0,frames/2,frames-1,frames+20]){
  const state=transitionFrame({frame,frames,fps:30,motion});assert.ok(state.incoming>=0&&state.incoming<=1);assert.ok(state.outgoing>=0&&state.outgoing<=1);
  if(frames<8)assert.deepEqual(state,{incoming:0,outgoing:0});
 }
 assert.deepEqual(transitionFrame({frame:120,frames:240,fps:30,motion}),{incoming:0,outgoing:0});
 assert.equal(transitionFrame({frame:0,frames:240,fps:30,motion}).incoming,1);
 assert.equal(transitionFrame({frame:239,frames:240,fps:30,motion}).outgoing,1);
 for(const input of [{frame:NaN},{frames:0},{fps:0}])assert.throws(()=>transitionFrame({frame:0,frames:240,fps:30,motion,...input}),/INVALID_MOTION_TIMING/);
 assert.throws(()=>transitionLayers({family:'code',variant:0},.5,'#123456'),/INVALID_TRANSITION/);
 assert.throws(()=>transitionLayers({family:'wipe',variant:99},.5,'#123456'),/INVALID_TRANSITION/);
});
test('new template geometries differ and reserve captions for every supported point count',async()=>{
 const {templateGeometry}=await import('../motion.mjs');
 assert.equal(typeof templateGeometry,'function');
 const shapes=[];
 for(const layout of ['poster','gallery','rail','stack'])for(const hasImage of [true,false])for(const pointCount of [0,1,3,6]){
  const geometry=templateGeometry(layout,{hasImage,pointCount});
  assert.deepEqual(geometry,templateGeometry(layout,{hasImage,pointCount}));
  assert.equal(geometry.points.length,pointCount);
  const boxes=[geometry.heading,...geometry.points,...(geometry.image?[geometry.image]:[])];
  for(const b of boxes){assert.ok(Object.values(b).every(Number.isFinite));assert.ok(b.w>0&&b.h>0);assert.ok(b.x>=85&&b.x+b.w<=1835);assert.ok(b.y>=150&&b.y+b.h<=865);}
  const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.equal(overlaps(boxes[i],boxes[j]),false,layout+' text/image regions overlap');
  if(hasImage&&pointCount===3)shapes.push(JSON.stringify(geometry));
 }
 assert.equal(new Set(shapes).size,4);
 for(const args of [['unknown',{}],['rail',{pointCount:7}],['rail',{pointCount:-1}],['rail',{pointCount:1.5}],['rail',{hasImage:'yes'}]])assert.throws(()=>templateGeometry(...args),/INVALID_TEMPLATE_GEOMETRY/);
});
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

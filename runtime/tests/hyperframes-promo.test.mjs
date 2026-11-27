import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {preparePromo} from '../promo.mjs';
import {promoHtml} from '../hyperframes-promo.mjs';
import {VIDEO_TEMPLATES} from '../designs.mjs';

test('auto uses available HyperFrames, distinguishes cut effects, and respects an explicit renderer', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hyperframes-promo-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const bytes = Buffer.from('staged image bytes');
  const image = createHash('sha256').update(bytes).digest('hex') + '.png';
  const production = {status: () => ({assets: [{file: image}]}), readAsset: async () => bytes};
  const basic = {image, title: 'レイアウト', seconds: 3};
  const steps = {...basic, steps: ['素材を選択', '出力を確認']};
  const focus = {...basic, focus: {x: 10, y: 20, width: 30, height: 15, label: '追加'}};
  const comparison = {...basic, comparison: [{label: '字幕', value: '3行'}, {label: '素材', value: '2点'}]};
  const request = (input, installed) => preparePromo(dir, {title: '動作確認', planConsent:true,soundEnabled:false,...input}, production, null, installed, {planDirection:async script=>{
    assert.equal(script.split('\n').length,input.cuts.length);
    return {title:'動作確認',template:'steps',motion:null,layouts:input.cuts.map(()=> 'steps')};
  }});
  const draft = () => readFile(path.join(dir, 'promo.json'), 'utf8').then(JSON.parse);

  assert.equal((await request({cuts: [basic, steps, focus, comparison]}, true)).renderer, 'hyperframes');
  assert.deepEqual((await draft()).cuts.map(cut => cut.effect), ['reveal', 'steps', 'focus', 'comparison']);
  assert.equal((await request({cuts: [basic], renderer: 'remotion'}, true)).renderer, 'remotion');
  assert.equal((await request({cuts: [basic]}, false)).renderer, 'remotion');
  const narration = image.replace(/\.png$/, '.wav');
  const narrated = {...production,status:()=>({assets:[{file:image},{file:narration}]})};
  await assert.rejects(preparePromo(dir,{title:'動作確認',cuts:[basic],narration},narrated,null,true),/PROMO_TITLE_CALL_REQUIRED/);
  assert.equal((await request({cuts: [{...steps, effect: 'reveal'}]}, true)).renderer, 'hyperframes');
  assert.equal((await draft()).cuts[0].effect, 'reveal');
  await request({cuts: [{image, title:'秒単位に丸めないカット', frames:102}]},true);
  assert.equal((await draft()).cuts[0].frames,102);
  await assert.rejects(request({cuts: [{...basic, holdFrames:10}]},true), /INVALID_PROMO_VIDEO_RANGE/);
  await assert.rejects(request({cuts: [basic], renderer: 'hyperframes'}, false), /HYPERFRAMES_INSTALL_REQUIRED/);
  await assert.rejects(request({cuts: [steps]}, false), /HYPERFRAMES_EFFECT_REQUIRES_RENDERER/);
  await assert.rejects(request({cuts: [{...focus, focus: {...focus.focus, x: 80}}]}, true), /INVALID_PROMO_EFFECT/);
  await assert.rejects(request({cuts: [{...basic, effect: 'comparison'}]}, true), /INVALID_PROMO_EFFECT/);
  await assert.rejects(request({cuts: [{...steps, focus: focus.focus}]}, true), /INVALID_PROMO_EFFECT/);
});

test('long Japanese titles and captions are wrapped at sensible boundaries', () => {
  const title='ナレーション動画メーカー｜HyperFramesで操作デモ';
  const caption='録画した操作を見せたい順に並べ、伝わりやすいように字幕と読みを確かめます。';
  const html=promoHtml({title,fps:30,durationInFrames:310,promoOpening:{src:'shots/title.wav',seconds:2,frames:70},rows:[{title,caption,image:'shots/a.png',from:70,frames:120}],bookends:{from:190,frames:120,tools:['HyperFrames'],owner:'Creator',endUrl:'https://example.com',creationYear:2026}});
  const ending=html.match(/<section class="clip end" id="ending"[^>]*>.*?<\/section>/)?.[0];
  assert.ok(ending);
  assert.match(ending, /制作クレジット/);
  assert.doesNotMatch(ending, /HyperFramesで操作デモ/);
  assert.match(ending, /@2026\/Creator/);
  assert.match(html, /<span>ナレーション動画メーカー<\/span><span>｜HyperFramesで操作デモ<\/span>/);
  assert.doesNotMatch(html, /<span>[モ。]<\/span>/);
  assert.match(html, /class="caption fitted-text"/);
});

test('the renderer can decode local video frames without opening page network access', () => {
  const result = promoHtml({
    title: '<script>unexpected()</script>', fps: 30, durationInFrames: 240,
    rows: [
      {id:'cut-0', title:'素材', image:'shots/a.png', from:0, frames:90},
      {id:'cut-1', title:'録画', video:'shots/b.mp4', videoStart:15, from:90, frames:30},
    ],
    bookends: {from:120,frames:120,tools:['HyperFrames'],watermarkEnabled:false},
  });
  assert.match(result, /img-src &apos;self&apos; data:/);
  assert.match(result, /connect-src &apos;none&apos;/);
  assert.doesNotMatch(result, /<script>unexpected/);
  assert.match(result, /<\/section><video[^>]+data-start="3"[^>]+data-media-start="0.5" muted/);
  assert.match(result, /class="left-credit"><strong>動画制作環境/);
  assert.doesNotMatch(result, /class="right-credit"/);
});

test('short promos follow selected layouts and only use optional sound at relevant boundaries', async () => {
  const {promoSceneDirection}=await import('../motion.mjs');
  const {promoSound}=await import('../promo-sound.mjs');
  const base={id:'cut-0',image:'shots/a.png',from:0,frames:90};
  const design=id=>VIDEO_TEMPLATES.find(template=>template.id===id).design;
  const quiet={...base,title:'静かな朝',caption:'ゆっくりと光が差します。',promoStyle:'cinematic',promoDesign:design('gallery'),designLayout:'gallery'};
  const tutorial={...base,title:'操作手順',caption:'画面のボタンをクリックします。',promoStyle:'editorial',promoDesign:design('flow'),designLayout:'steps'};
  const compare={...base,title:'違いを比べる',caption:'変換した二つの原稿を比較。',promoStyle:'editorial',promoDesign:design('steps'),effect:'comparison',comparison:[]};
  assert.deepEqual([quiet,tutorial,compare].map(row=>promoSceneDirection(row).id),['quiet','procedure','comparison']);
  assert.equal(promoSceneDirection({...compare,effect:'steps'}).id,'procedure');
  const visual=row=>promoHtml({title:'紹介',fps:30,durationInFrames:210,rows:[row],
    bookends:{from:90,frames:120,tools:['HyperFrames']}});
  assert.match(visual(quiet),/--paper:#152b29/);
  assert.match(visual(tutorial),/--paper:#f0f6f5/);
  assert.match(visual(compare),/--paper:#fbf5e9/);
  assert.doesNotMatch(visual(quiet),/class="meter"/);
  assert.equal(promoSceneDirection(quiet).stacked,true);
  assert.equal(promoSceneDirection(tutorial).stage.x,76);
  const staticAudio=promoSound([quiet],7,30);
  assert.ok(staticAudio.subarray(44).every(byte=>byte===0));
  const activeAudio=promoSound([quiet,{...tutorial,from:90,promoTransition:{family:'wipe'}}],7,30);
  assert.ok(activeAudio.subarray(44).some(byte=>byte!==0));
});

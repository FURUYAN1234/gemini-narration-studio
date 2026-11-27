import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hyperframesInstallation} from './hyperframes-runtime.mjs';
import {fitText,promoSceneDirection,transitionLayers,transitionSurface,videoBackground} from './motion.mjs';

const font = fileURLToPath(new URL('./vendor/NotoSansJP.ttf', import.meta.url));
const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
const seconds = (frames, fps) => +(frames / fps).toFixed(8);
const clock = (id, from, duration, track) =>
  'id="' + id + '" data-start="' + from + '" data-duration="' + duration + '" data-track-index="' + track + '"';
function textBlock(tag, classes, text, limits) {
  const {size, lines} = fitText(text, {...limits, balance:true});
  return '<' + tag + ' class="' + classes + '" style="font-size:' + size + 'px">' +
    lines.map(line => '<span>' + escape(line.trim()) + '</span>').join('') + '</' + tag + '>';
}

function effectMarkup(row) {
  switch (row.effect) {
    case 'focus':
      return '<p class="focus-label animated">' + escape(row.focus.label) + '</p>';
    case 'steps':
      return '<ol class="steps">' + row.steps.map(text => '<li class="animated">' + escape(text) + '</li>').join('') + '</ol>';
    case 'comparison':
      return '<dl class="comparison">' + row.comparison.map(item =>
        '<div class="animated"><dt>' + escape(item.label) + '</dt><dd>' + escape(item.value) + '</dd></div>'
      ).join('') + '</dl>';
    default:
      return '';
  }
}

const position = ({x,y,w,h}) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

function mediaMarkup(row, index, fps, stage) {
  if (row.video) {
    const videoFrames = row.videoFrames ?? row.frames;
    const attrs = clock('video-' + index, seconds(row.from, fps), seconds(videoFrames, fps), 1);
    const stageStyle = ' style="' + position(stage) + '" ';
    const hold = row.holdImage ? '<img class="clip media video-stage" alt="" ' + stageStyle +
      clock('hold-' + index, seconds(row.from + videoFrames, fps), seconds(row.frames - videoFrames, fps), 1) +
      ' src="' + escape(row.holdImage) + '">' : '';
    return '<video class="media video-stage" ' + stageStyle + attrs + ' src="' + escape(row.video) +
      '" data-media-start="' + seconds(row.videoStart, fps) + '" muted playsinline></video>' + hold;
  }
  return '<img class="media" src="' + escape(row.image) + '" alt="">';
}

export function promoHtml(data) {
  const {rows, fps, bookends, durationInFrames, promoAudio, promoNarration, promoNarrationSeconds, promoOpening,music} = data;
  const duration = seconds(durationInFrames, fps);
  const palette = promoSceneDirection({promoDesign:data.design});
  const background=videoBackground(data.design||palette);
  const scenes = rows.map((row, index) => {
    const attrs = clock('scene-' + index, seconds(row.from, fps), seconds(row.frames, fps), 0);
    const direction = promoSceneDirection(row);
    const {stage,copy} = direction;
    const heading = textBlock('h1', 'fitted-text', row.title, {width:copy.w,height:Math.min(copy.h,210),maxSize:direction.stacked?55:48,lineHeight:1.26});
    const caption = row.caption ? textBlock('p', 'caption fitted-text', row.caption, {width:1652,height:125,maxSize:35,lineHeight:1.18}) : '';
    const box = row.focus
      ? '<div class="target" style="' + position({x:stage.x+row.focus.x*stage.w/100,y:stage.y+row.focus.y*stage.h/100,
        w:row.focus.width*stage.w/100,h:row.focus.height*stage.h/100}) + '"></div>'
      : '';
    return '<section class="clip scene" style="--paper:'+direction.background+';--heading:'+direction.heading+
      ';--text:'+direction.foreground+';--accent:'+direction.accent+'" ' + attrs + '><div class="identity">' + escape(data.title) +
      '</div><div class="stage" style="' + position(stage) + '">' + (row.video?'':mediaMarkup(row,index,fps,stage)) +
      '</div>' + box + '<div class="copy" style="' + position(copy) + '">' + heading +
      effectMarkup(row) + '</div>' + caption + '</section>' + (row.video?mediaMarkup(row,index,fps,stage):'') +
      (direction.reveal>0?'<div class="clip transition" '+clock('transition-'+index,seconds(row.from,fps),seconds(row.frames,fps),4)+'></div>':'');
  }).join('');
  const end = '<section class="clip end" ' + clock('ending', seconds(bookends.from, fps), seconds(bookends.frames, fps), 0)
    + '><div class="end-inner"><h1>制作クレジット</h1></div>'
    + '<div class="left-credit"><strong>動画制作環境</strong><br>' + bookends.tools.map(escape).join('<br>') + '</div>'
    + (bookends.watermarkEnabled !== false && (bookends.endLabel || bookends.endUrl || bookends.owner) ? '<div class="right-credit"><strong>' + escape(bookends.endLabel) + '</strong><br>' + escape(bookends.endUrl) +
       (bookends.owner ? '<br>@' + escape(bookends.creationYear) + '/' + escape(bookends.owner) : '') + '</div>' : '') + '</section>';
  const opening = promoOpening ? '<section class="clip end" ' + clock('opening', 0, seconds(promoOpening.frames, fps), 0)
    + '><div class="end-inner">' + textBlock('h1', 'fitted-text', data.title, {width:1470,height:220,maxSize:78,lineHeight:1.28}) + '</div></section>' : '';
  const audio = (id, source, length, track, volume, from=0) => '<audio ' + clock(id, from, length, track) +
    ' src="' + escape(source) + '" data-volume="' + volume + '"></audio>';
  const timings = JSON.stringify(rows.map(row => {
    const direction = promoSceneDirection(row);
    const transitionFrames = Math.max(1,Math.floor(Math.min(direction.reveal*fps,row.frames/4)));
    const surface = direction.reveal>0?transitionSurface(row.promoTransition,{palette:direction,image:row.image}):null;
    const frames = surface?Array.from({length:transitionFrames},(_,i)=>transitionLayers(row.promoTransition,1-i/transitionFrames,surface.color)):null;
    return [seconds(row.from,fps),seconds(row.frames,fps),row.stepStarts,frames,surface?.image];
  }));
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;; img-src &apos;self&apos; data:; script-src &apos;self&apos; &apos;unsafe-inline&apos;; style-src &apos;unsafe-inline&apos;; connect-src &apos;none&apos;; object-src &apos;none&apos;; base-uri &apos;none&apos;">' +
    '<title>' + escape(data.title) + '</title><style>' + style + '</style><script src="./gsap.min.js"></script></head><body>' +
    '<main data-composition-id="studio-promo" data-start="0" data-duration="' + duration +
    '" data-width="1920" data-height="1080" data-fps="' + fps + '" style="--paper:'+palette.background+';--heading:'+palette.heading+
    ';--text:'+palette.foreground+';--accent:'+palette.accent+';--paper-pattern:'+(background.backgroundImage||'none')+
    ';--paper-size:'+(background.backgroundSize||'auto')+'">' + opening + scenes + end +
    (music?audio('music',music.src,Math.min(duration,music.durationSeconds),5,music.level):'') +
    (promoAudio ? audio('effects', promoAudio, duration, 2, promoNarration || promoOpening ? .42 : 1) : '') +
    (promoOpening ? audio('opening-voice', promoOpening.src, promoOpening.seconds, 3, .93) : '') +
    (promoNarration ? audio('narration', promoNarration, promoNarrationSeconds, 3, .93, seconds(promoOpening?.frames??0, fps)) : '') +
    '</main><script>' +
    'const tl = gsap.timeline({paused: true});\n' +
    timings + '.forEach(([from, length, steps, transition, image], i) => {\n' +
    '  const s = "#scene-" + i;\n' +
    '  if (transition) {\n' +
    '    const target = document.querySelector("#transition-" + i);\n' +
    '    transition.forEach((layers,j)=>{\n' +
    '      const frame = document.createElement("div"); frame.className="transition-frame"; frame.style.visibility="hidden";\n' +
    '      for (const style of layers) { const layer=document.createElement("i"); Object.assign(layer.style,style); frame.append(layer);\n' +
    '        if (image) { const picture=document.createElement("img"); picture.src=image; picture.alt=""; picture.style.left=-(parseFloat(style.left||0)*19.2)+"px"; picture.style.top=-(parseFloat(style.top||0)*8.95)+"px"; if(String(style.background).startsWith("conic-gradient")) layer.style.maskImage=style.background; if(style.transform) picture.style.transform=style.transform; layer.append(picture); }\n' +
    '      }\n' +
    '      target.append(frame); if(layers.length) { tl.set(frame,{visibility:"visible"},from+j/'+fps+'); tl.set(frame,{visibility:"hidden"},from+(j+1)/'+fps+'); }\n' +
    '    });\n' +
    '  }\n' +
    '  if (steps) document.querySelectorAll(s+" .steps li").forEach((item,j) => {\n' +
    '    const start = Math.min(steps[j], Math.max(0,length-1/30));\n' +
    '    item.style.opacity="0"; tl.set(item,{opacity:1},from+start);\n' +
    '  });\n' +
    '});\n' +
    'window.__timelines = {"studio-promo": tl};</script></body></html>';
}

const style = '\
@font-face{font-family:StudioJP;src:url("./StudioJP.ttf");font-display:block}\
*{box-sizing:border-box}html,body,main{width:1920px;height:1080px;margin:0;overflow:hidden}\
main{position:relative;background:var(--paper);color:var(--text);font-family:StudioJP,sans-serif}\
.clip{position:absolute;inset:0;overflow:hidden}\
.scene,.end{background-color:var(--paper);background-image:var(--paper-pattern);background-size:var(--paper-size)}\
.scene{padding:58px 76px}\
.identity{height:66px;font-size:31px;line-height:1.3;color:var(--accent);font-weight:700;max-width:1740px}\
.stage{position:absolute;border-radius:26px;background:var(--paper);overflow:hidden;}\
.media{display:block;width:100%;height:100%;object-fit:contain}\
.video-stage{position:absolute;border-radius:26px;background:var(--paper);z-index:2}\
.copy{position:absolute;display:flex;flex-direction:column;justify-content:center;overflow-wrap:anywhere}\
h1{font-size:52px;line-height:1.28;margin:0;color:var(--heading);overflow-wrap:anywhere;max-height:8em}\
.copy h1{line-height:1.26;text-wrap:balance}\
.fitted-text span{display:block;line-break:strict;word-break:normal}\
\
.target{position:absolute;border:6px solid var(--accent);box-shadow:0 0 0 2px #142e4b;border-radius:8px;pointer-events:none;z-index:3}\
.focus-label,.steps li,.comparison div{margin:16px 0 0;padding:15px 19px;border-left:5px solid var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--paper));border-radius:0 10px 10px 0;font-size:28px;line-height:1.3;overflow-wrap:anywhere}\
.focus-label{border-color:var(--accent)}\
.steps{margin:9px 0 0;padding-left:46px}\
.steps li::marker{font-weight:bold;color:var(--accent)}\
.comparison{margin:9px 0 0;display:grid;gap:9px}.comparison div{margin:0}\
.comparison dt{color:var(--accent);font-size:24px}.comparison dd{font-weight:700;margin:6px 0 0}\
.caption{position:absolute;left:76px;right:76px;bottom:43px;margin:0;height:143px;display:grid;align-content:center;padding:9px 43px;background:var(--paper);color:var(--text);border-radius:18px;font-size:35px;line-height:1.18;overflow-wrap:anywhere}\
.end{color:var(--text);display:grid;place-items:center;text-align:center}\
.end-inner{width:1550px}.end h1{color:var(--heading);margin:0 0 39px;font-size:65px;text-wrap:balance}.transition{bottom:185px;z-index:4}.transition-frame{position:absolute;inset:0}.transition-frame i{position:absolute;overflow:hidden}.transition-frame img{position:absolute;width:1920px;height:895px;object-fit:contain}.left-credit,.right-credit{position:absolute;bottom:72px;font-size:31px;line-height:1.5}.left-credit{left:76px;text-align:left}.right-credit{right:76px;text-align:right}';

export async function renderHyperframesPromo({data, project, output, browser, signal, report}) {
  const runtime = await hyperframesInstallation();
  if (!runtime) throw new Error('HYPERFRAMES_INSTALL_REQUIRED');
  await mkdir(project, {recursive: true});
  for (const [index,row] of data.rows.entries()) {
    if (!row.video || row.videoFrames === undefined) continue;
    const endFrame = row.videoStart + row.videoFrames - 1;
    row.holdImage = 'hold-' + index + '.png';
    await promisify(execFile)(runtime.ffmpeg, [
      '-nostdin','-v','error','-y','-ss',String(seconds(endFrame,data.fps)),'-i',path.join(project,row.video),
      '-frames:v','1',path.join(project,row.holdImage),
    ], {signal,windowsHide:true,timeout:30_000});
  }
  await Promise.all([
    copyFile(runtime.gsap, path.join(project, 'gsap.min.js')),
    copyFile(font, path.join(project, 'StudioJP.ttf')),
    writeFile(path.join(project, 'index.html'), promoHtml(data)),
  ]);
  signal.throwIfAborted();
  report({stage:'rendering', progress:0, totalFrames:data.durationInFrames});
  await new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|COMSPEC|PATHEXT)$/i.test(name)));
    Object.assign(env, {PUPPETEER_EXECUTABLE_PATH:browser, HYPERFRAMES_FFMPEG_PATH:runtime.ffmpeg, HYPERFRAMES_FFPROBE_PATH:runtime.ffprobe,
      HYPERFRAMES_CHROME_SANDBOX:'1', PRODUCER_RESTRICT_PAGE_NETWORK:'1', HYPERFRAMES_NO_TELEMETRY:'1', DO_NOT_TRACK:'1', FORCE_COLOR:'0'});
    const args = ['render', '.', '--output', output, '--fps', String(data.fps), '--workers', '2',
      '--strict', '--no-best-effort', '--video-frame-format', 'png', '--crf', '19'];
    const child = spawn(process.execPath, [runtime.cli, ...args], {cwd:project, env, windowsHide:true, stdio:['ignore','pipe','pipe']});
    let diagnostic = '', progress = 0, partial = '';
    const retain = value => { diagnostic = (diagnostic + value).slice(-10000); };
    child.stdout.setEncoding('utf8').on('data', chunk => {
      retain(chunk);
      const lines = (partial + chunk).split('\n');
      partial = lines.pop().slice(-16000);
      for (const line of lines) {
        if (!line.startsWith('@hf-progress ')) continue;
        let payload;
        try { payload = JSON.parse(line.slice(13)); } catch { continue; }
        if (!Number.isFinite(payload.pct)) continue;
        progress = Math.max(progress, Math.min(.99, payload.pct / 100));
        report({stage:'rendering',progress,totalFrames:data.durationInFrames});
      }
    });
    child.stderr.setEncoding('utf8').on('data', retain);
    const cancel = () => {
      if (process.platform === 'win32' && child.pid) {
        spawn(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'}).on('error', () => child.kill());
      } else child.kill();
    };
    signal.addEventListener('abort', cancel, {once:true});
    child.once('error', error => reject(new Error('HYPERFRAMES_RENDER_UNAVAILABLE', {cause:error})));
    child.once('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new Error('HYPERFRAMES_RENDER_FAILED\n' + diagnostic));
    });
  });
  return {width:1920,height:1080,fps:data.fps,durationInFrames:data.durationInFrames};
}

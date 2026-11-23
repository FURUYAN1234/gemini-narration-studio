import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hyperframesInstallation} from './hyperframes-runtime.mjs';
import {fitText} from './motion.mjs';

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

function mediaMarkup(row, index, fps) {
  if (row.video) {
    const videoFrames = row.videoFrames ?? row.frames;
    const attrs = clock('video-' + index, seconds(row.from, fps), seconds(videoFrames, fps), 1);
    const hold = row.holdImage ? '<img class="clip media video-stage" alt="" ' +
      clock('hold-' + index, seconds(row.from + videoFrames, fps), seconds(row.frames - videoFrames, fps), 1) +
      ' src="' + escape(row.holdImage) + '">' : '';
    return '<video class="media video-stage" ' + attrs + ' src="' + escape(row.video) +
      '" data-media-start="' + seconds(row.videoStart, fps) + '" muted playsinline></video>' + hold;
  }
  return '<img class="media" src="' + escape(row.image) + '" alt="">';
}

export function promoHtml(data) {
  const {rows, fps, bookends, durationInFrames, promoAudio, promoNarration, promoNarrationSeconds} = data;
  const duration = seconds(durationInFrames, fps);
  const scenes = rows.map((row, index) => {
    const attrs = clock('scene-' + index, seconds(row.from, fps), seconds(row.frames, fps), 0);
    const heading = textBlock('h1', 'animated fitted-text', row.title, {width:473,height:210,maxSize:46,lineHeight:1.26});
    const caption = row.caption ? textBlock('p', 'caption fitted-text', row.caption, {width:1652,height:125,maxSize:35,lineHeight:1.18}) : '';
    const box = row.focus
      ? '<div class="target animated" style="left:' + (76+row.focus.x*12.16) + 'px;top:' + (164+row.focus.y*6.84) +
        'px;width:' + row.focus.width*12.16 + 'px;height:' + row.focus.height*6.84 + 'px"></div>'
      : '';
    return '<section class="clip scene" ' + attrs + '><div class="identity">' + escape(data.title) +
      '</div><div class="stage">' + (row.video?'':mediaMarkup(row, index, fps)) +
      '</div>' + box + '<div class="copy">' + heading +
      effectMarkup(row) + '</div>' + caption +
      '<div class="meter"><i></i></div></section>' + (row.video?mediaMarkup(row, index, fps):'');
  }).join('');
  const end = '<section class="clip end" ' + clock('ending', seconds(bookends.from, fps), seconds(bookends.frames, fps), 0)
    + '><div class="end-inner">' + textBlock('h1', 'fitted-text', data.title, {width:1470,height:220,maxSize:65,lineHeight:1.28}) +
      '<p>' + bookends.tools.map(escape).join(' · ') + '</p>'
    + (bookends.watermarkEnabled ? '<small>' + escape(bookends.endLabel) + '<br>' + escape(bookends.endUrl) +
       '<br>@' + escape(bookends.creationYear) + '/' + escape(bookends.owner) + '</small>' : '') + '</div></section>';
  const audio = (id, source, length, track, volume) => '<audio ' + clock(id, 0, length, track) +
    ' src="' + escape(source) + '" data-volume="' + volume + '"></audio>';
  const timings = JSON.stringify(rows.map(row => [seconds(row.from, fps), seconds(row.frames, fps), row.stepStarts]));
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;; img-src &apos;self&apos; data:; script-src &apos;self&apos; &apos;unsafe-inline&apos;; style-src &apos;unsafe-inline&apos;; connect-src &apos;none&apos;; object-src &apos;none&apos;; base-uri &apos;none&apos;">' +
    '<title>' + escape(data.title) + '</title><style>' + style + '</style><script src="./gsap.min.js"></script></head><body>' +
    '<main data-composition-id="studio-promo" data-start="0" data-duration="' + duration +
    '" data-width="1920" data-height="1080" data-fps="' + fps + '">' + scenes + end +
    (promoAudio ? audio('music', promoAudio, duration, 2, promoNarration ? .42 : 1) : '') +
    (promoNarration ? audio('narration', promoNarration, promoNarrationSeconds, 3, .93) : '') +
    '</main><script>' +
    'const tl = gsap.timeline({paused: true});\n' +
    timings + '.forEach(([from, length, steps], i) => {\n' +
    '  const s = "#scene-" + i;\n' +
    '  const reveal = Math.min(.32, length / 4);\n' +
    '  tl.fromTo(s + " .stage", {opacity:.3, y:20}, {opacity:1,y:0,duration:reveal,ease:"power2.out",immediateRender:false}, from);\n' +
    '  const within = Math.min(.22, length/7);\n' +
    '  tl.to(s + (steps ? " .animated:not(li)" : " .animated"), {opacity:1,y:0,duration:reveal,stagger:Math.min(.25,length/12),ease:"power2.out"}, from + within);\n' +
    '  if (steps) document.querySelectorAll(s+" .steps li").forEach((item,j) => {\n' +
    '    const start = Math.min(steps[j], Math.max(0,length-1/30));\n' +
    '    tl.to(item,{opacity:1,y:0,duration:Math.min(reveal,length-start),ease:"power2.out"},from+start);\n' +
    '  });\n' +
    '  tl.to(s + " .meter i", {scaleX:1,duration:length,ease:"none"}, from);\n' +
    '});\n' +
    'tl.fromTo(".end-inner",{opacity:0,y:16},{opacity:1,y:0,ease:"power2.out",duration:.42,immediateRender:false},' +
     seconds(bookends.from, fps) + ');\n' +
    'window.__timelines = {"studio-promo": tl};</script></body></html>';
}

const style = '\
@font-face{font-family:StudioJP;src:url("./StudioJP.ttf");font-display:block}\
*{box-sizing:border-box}html,body,main{width:1920px;height:1080px;margin:0;overflow:hidden}\
main{position:relative;background:#eaf2fb;color:#11263e;font-family:StudioJP,sans-serif}\
.clip{position:absolute;inset:0;overflow:hidden}\
.scene{background:linear-gradient(135deg,#f9fbff,#d4e4f7);padding:58px 76px}\
.identity{height:66px;font-size:31px;line-height:1.3;color:#274a6d;font-weight:700;max-width:1740px}\
.stage{position:absolute;left:76px;top:164px;width:1216px;height:684px;border-radius:26px;background:#162e49;overflow:hidden;outline:2px solid #b8cfe8;box-shadow:0 22px 48px #172d492b}\
.media{display:block;width:100%;height:100%;object-fit:contain}\
.video-stage{position:absolute;left:76px;top:164px;width:1216px;height:684px;border-radius:26px;background:#162e49;z-index:2}\
.copy{position:absolute;left:1348px;top:177px;right:76px;bottom:234px;display:flex;flex-direction:column;justify-content:center;overflow-wrap:anywhere}\
h1{font-size:52px;line-height:1.28;margin:0;color:#142e4b;overflow-wrap:anywhere;max-height:8em}\
.copy h1{line-height:1.26;text-wrap:balance}\
.fitted-text span{display:block;line-break:strict;word-break:normal}\
.animated{opacity:0;transform:translateY(12px)}\
.target{position:absolute;border:6px solid #ffb947;box-shadow:0 0 0 2px #142e4b;border-radius:8px;pointer-events:none;z-index:3}\
.focus-label,.steps li,.comparison div{margin:16px 0 0;padding:15px 19px;border-left:5px solid #416b9b;background:#f9fcff;border-radius:0 10px 10px 0;font-size:28px;line-height:1.3;overflow-wrap:anywhere}\
.focus-label{border-color:#c87918}\
.steps{margin:9px 0 0;padding-left:46px}\
.steps li::marker{font-weight:bold;color:#345d8e}\
.comparison{margin:9px 0 0;display:grid;gap:9px}.comparison div{margin:0}\
.comparison dt{color:#31577f;font-size:24px}.comparison dd{font-weight:700;margin:6px 0 0}\
.caption{position:absolute;left:76px;right:76px;bottom:43px;margin:0;height:143px;display:grid;align-content:center;padding:9px 43px;background:#102840;color:#fff;border-radius:18px;font-size:35px;line-height:1.18;overflow-wrap:anywhere}\
.meter{position:absolute;bottom:27px;left:76px;right:76px;height:4px;background:#b8cfe8;border-radius:2px}\
.meter i{display:block;width:100%;height:100%;transform:scaleX(0);transform-origin:left;background:#416b9b}\
.end{background:linear-gradient(135deg,#112940,#26496e);color:#dceafb;display:grid;place-items:center;text-align:center}\
.end-inner{width:1550px}.end h1{color:#fff;margin:0 0 39px;font-size:65px;text-wrap:balance}.end p{font-size:31px;line-height:1.42}.end small{display:block;margin-top:44px;font-size:25px;line-height:1.5}';

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

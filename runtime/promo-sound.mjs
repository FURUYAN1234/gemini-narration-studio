import {promoSceneDirection} from './motion.mjs';

const SAMPLE_RATE = 48000;
const TAU = 2 * Math.PI;
export function promoSound(rows, durationSeconds, fps) {
  const frames = Math.round(durationSeconds * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  function add(start, seconds, pan, sample) {
    const first = Math.round(start * SAMPLE_RATE);
    const end = Math.min(frames, first + Math.round(seconds * SAMPLE_RATE));
    for (let i = Math.max(0, first); i < end; i++) {
      const value = sample((i - first) / SAMPLE_RATE);
      left[i] += value * Math.sqrt((1 - pan) / 2);
      right[i] += value * Math.sqrt((1 + pan) / 2);
    }
  }
  for(const [index,row] of rows.entries()){
    const start=row.from/fps,end=(row.from+row.frames)/fps;
    const direction=promoSceneDirection(row);
    if(index>0&&row.promoTransition&&row.promoTransition.family!=='cut'&&direction.id!=='quiet'){
      const span=Math.min(.28,(end-start)*.24);
      add(start,span,0,t=>.12*Math.sin(Math.PI*t/span)*Math.sin(TAU*((direction.id==='procedure'?390:530)*t+210*t*t)));
    }
  }

  const wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(1, i / (0.025 * SAMPLE_RATE), (frames - 1 - i) / (0.55 * SAMPLE_RATE));
    wav.writeInt16LE(Math.round(Math.tanh(left[i] * 1.65) * fade * 30000), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.tanh(right[i] * 1.65) * fade * 30000), 46 + i * 4);
  }
  return wav;
}

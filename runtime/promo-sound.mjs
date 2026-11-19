const SAMPLE_RATE = 48000;
const BEAT = 0.5;
const TAU = 2 * Math.PI;
const CHORDS = [[57, 64, 67, 71], [53, 60, 64, 67], [60, 67, 71, 74], [55, 62, 65, 69]];
const ARPEGGIO = [1, 2, 3, 2, 1, 2, 3, 1];
const frequency = midi => 440 * 2 ** ((midi - 69) / 12);

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
  const note = (start, midi, pan, gain, decay) => {
    const omega = TAU * frequency(midi);
    add(start, 1.5, pan, t => gain * Math.min(1, t / 0.014) * Math.exp(-t * decay) *
      (Math.sin(omega * t) + 0.24 * Math.sin(2 * omega * t) + 0.08 * Math.sin(3 * omega * t)));
  };
  const lastCut = rows.at(-1);
  const endCard = (lastCut.from + lastCut.frames) / fps;
  for (let step = 0; step * BEAT / 2 < endCard; step++) {
    const time = step * BEAT / 2;
    const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];
    note(time, chord[ARPEGGIO[step % ARPEGGIO.length]] + 12, step % 2 ? 0.38 : -0.38, 0.085, 5.1);
    if (step % 4 === 0) note(time, chord[0] - 12, 0, 0.13, 3.6);
    if (step % 2 === 0) add(time, 0.23, 0, t => 0.085 * Math.min(1, t / 0.007) *
      Math.exp(-t * 19) * Math.sin(TAU * (53 * t + 2.9 * (1 - Math.exp(-20 * t)))));
  }
  for (const [index, row] of rows.entries()) {
    const start = row.from / fps;
    add(start, 0.48, 0, t => 0.24 * Math.sin(Math.PI * t / 0.48) *
      (Math.sin(TAU * (170 * t + 350 * t * t)) + 0.19 * Math.sin(TAU * 1140 * t)));
    note(start + 0.14, 76 + index % 3 * 2, 0.42, 0.1, 8);
  }
  for (const [index, midi] of [57, 64, 69, 72].entries()) note(endCard + index * 0.11, midi, (index - 1.5) * 0.23, 0.14, 1.6);
  for (const [index, midi] of [57, 64, 72].entries()) {
    const omega = TAU * frequency(midi);
    add(endCard, durationSeconds - endCard, (index - 1) * 0.4,
      t => 0.036 * Math.min(1, t / 0.36) * Math.exp(-t * 0.5) * Math.sin(omega * t));
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

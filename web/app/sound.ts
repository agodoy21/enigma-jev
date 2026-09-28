/** Key clicks, rotor ticks, the lid's thump and the unlock chime, synthesised with WebAudio. */
import { $ } from '../shared/dom.js';

let audio: AudioContext | null = null,
  soundOn = true;
/** A short filtered noise burst: a key's clack, a rotor's tick, the lid's thump. */
export function click(kind: 'key' | 'step' | 'lid' = 'key') {
  if (!soundOn) return;
  try {
    audio ??= new AudioContext();
    const len = kind === 'lid' ? 0.25 : 0.045;
    const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * len), audio.sampleRate),
      d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** (kind === 'lid' ? 2 : 6);
    const src = audio.createBufferSource(),
      f = audio.createBiquadFilter(),
      g = audio.createGain();
    src.buffer = buf;
    f.type = 'bandpass';
    f.frequency.value = kind === 'key' ? 2400 : kind === 'step' ? 4200 : 600;
    f.Q.value = 1.2;
    g.gain.value = kind === 'lid' ? 0.25 : kind === 'step' ? 0.1 : 0.32;
    src.connect(f).connect(g).connect(audio.destination);
    src.start();
  } catch {
    /* sound is decoration */
  }
}

/** A two-note chime: the lock giving way. */
export function chime() {
  if (!soundOn) return;
  try {
    audio ??= new AudioContext();
    [
      [880, 0],
      [1318.5, 0.09],
    ].forEach(([f, t]) => {
      const o = audio!.createOscillator(),
        g = audio!.createGain(),
        at = audio!.currentTime + t;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.08, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      o.connect(g).connect(audio!.destination);
      o.start(at);
      o.stop(at + 0.55);
    });
  } catch {
    /* sound is decoration */
  }
}

/** The header's sound switch. */
export function initSoundToggle() {
  $('sound').onclick = () => {
    soundOn = !soundOn;
    $('sound').setAttribute('aria-pressed', String(soundOn));
  };
}

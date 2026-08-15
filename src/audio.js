import { save } from './save.js';

let ctx = null;

function context() {
  if (!save.settings.sound) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function beep(freq = 440, duration = 0.08, type = 'square', gain = 0.05) {
  const ac = context();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(gain, ac.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
}

export const sfx = {
  move: () => beep(220, 0.04, 'square', 0.02),
  confirm: () => beep(660, 0.09, 'square', 0.04),
  hit: () => beep(140, 0.12, 'sawtooth', 0.05),
  parry: () => beep(980, 0.1, 'triangle', 0.05),
  ability: () => beep(520, 0.12, 'triangle', 0.04),
  glitch: () => beep(90, 0.5, 'sawtooth', 0.05),
  achievement: () => {
    beep(740, 0.1, 'triangle', 0.05);
    setTimeout(() => beep(1108, 0.16, 'triangle', 0.05), 110);
  },
};

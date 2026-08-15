import { sfx } from './audio.js';

const toasts = [];

export function pushToast(title, subtitle = '', kind = 'info') {
  toasts.push({ title, subtitle, kind, life: 3.4 });
  if (kind === 'achievement') sfx.achievement();
}

export function updateToasts(dt) {
  for (let i = toasts.length - 1; i >= 0; i--) {
    toasts[i].life -= dt;
    if (toasts[i].life <= 0) toasts.splice(i, 1);
  }
}

export function drawToasts(g) {
  let y = 24;
  for (const t of toasts) {
    const alpha = Math.min(1, t.life / 0.4);
    g.save();
    g.globalAlpha = alpha;
    const w = 340;
    const x = 960 - w - 24;
    g.fillStyle = 'rgba(10,12,20,0.92)';
    g.fillRect(x, y, w, t.subtitle ? 62 : 40);
    g.strokeStyle = t.kind === 'achievement' ? '#ffd76b' : '#3a4560';
    g.lineWidth = 2;
    g.strokeRect(x, y, w, t.subtitle ? 62 : 40);
    g.fillStyle = t.kind === 'achievement' ? '#ffd76b' : '#cfd6e4';
    g.font = 'bold 17px sans-serif';
    g.fillText(t.title, x + 14, y + 26);
    if (t.subtitle) {
      g.fillStyle = '#93a0b8';
      g.font = '13px sans-serif';
      g.fillText(t.subtitle, x + 14, y + 48);
    }
    g.restore();
    y += (t.subtitle ? 62 : 40) + 10;
  }
}

export function drawCenteredText(g, text, x, y, font, color) {
  g.save();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.fillText(text, x, y);
  g.restore();
}

export function drawBar(g, x, y, w, h, ratio, color, bg = '#1a2130') {
  g.fillStyle = bg;
  g.fillRect(x, y, w, h);
  g.fillStyle = color;
  g.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
  g.strokeStyle = '#2c3546';
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

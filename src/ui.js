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

// 発光するHP/EPバー
export function drawGlowBar(g, x, y, w, h, ratio, color, glow = color) {
  const r = Math.max(0, Math.min(1, ratio));
  g.save();
  g.fillStyle = 'rgba(8,10,16,0.75)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(150,168,196,0.28)';
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (r > 0) {
    g.shadowColor = glow;
    g.shadowBlur = 12;
    g.fillStyle = color;
    g.fillRect(x + 1, y + 1, (w - 2) * r, h - 2);
  }
  g.restore();
}

// 四隅にブラケットを付けた枠
export function drawPanel(g, x, y, w, h, opts = {}) {
  const border = opts.border || 'rgba(150,168,196,0.35)';
  g.save();
  g.fillStyle = opts.fill || 'rgba(8,11,18,0.72)';
  g.fillRect(x, y, w, h);
  if (opts.glow) {
    g.shadowColor = opts.glow;
    g.shadowBlur = opts.glowBlur || 16;
  }
  g.strokeStyle = border;
  g.lineWidth = opts.lineWidth || 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.restore();

  if (opts.corners !== false) {
    const c = opts.cornerSize || 9;
    g.save();
    g.strokeStyle = opts.cornerColor || border;
    g.lineWidth = 2;
    const pts = [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ];
    for (const [px, py, sx, sy] of pts) {
      g.beginPath();
      g.moveTo(px + sx * c, py);
      g.lineTo(px, py);
      g.lineTo(px, py + sy * c);
      g.stroke();
    }
    g.restore();
  }
}

// キーボードのキー表示
export function drawKeyCap(g, x, y, label, opts = {}) {
  g.save();
  g.font = opts.font || '12px sans-serif';
  const w = Math.max(22, g.measureText(label).width + 12);
  const h = opts.height || 20;
  g.fillStyle = 'rgba(16,20,30,0.85)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = opts.border || 'rgba(170,188,214,0.5)';
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle = opts.color || '#cfd6e4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + h / 2 + 0.5);
  g.restore();
  return w;
}

// 字間を空けたテキスト（ロゴ・サブタイトル用）
export function drawSpacedText(g, text, cx, y, font, color, spacing, align = 'center') {
  g.save();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'left';
  const chars = [...text];
  const total = chars.reduce((s, ch) => s + g.measureText(ch).width + spacing, -spacing);
  let x = align === 'center' ? cx - total / 2 : cx;
  for (const ch of chars) {
    g.fillText(ch, x, y);
    x += g.measureText(ch).width + spacing;
  }
  g.restore();
  return total;
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

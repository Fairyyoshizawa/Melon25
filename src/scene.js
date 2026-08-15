// 雨の屋上シーン。静的な部分はオフスクリーンにキャッシュし、雨だけ毎フレーム描く。

const W = 960;
const H = 540;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildingLayer(g, rnd, opts) {
  const { baseY, minH, maxH, color, windowChance, windowAlpha } = opts;
  let x = -40;
  while (x < W + 40) {
    const w = 40 + rnd() * 70;
    const h = minH + rnd() * (maxH - minH);
    const top = baseY - h;
    g.fillStyle = color;
    g.fillRect(x, top, w, h);

    for (let wy = top + 10; wy < baseY - 8; wy += 13) {
      for (let wx = x + 6; wx < x + w - 8; wx += 12) {
        if (rnd() < windowChance) {
          g.fillStyle = `rgba(255, 206, 128, ${windowAlpha * (0.45 + rnd() * 0.55)})`;
          g.fillRect(wx, wy, 5, 7);
        }
      }
    }
    x += w + 4 + rnd() * 10;
  }
}

function fence(g, y, h) {
  g.save();
  g.strokeStyle = 'rgba(150,168,196,0.16)';
  g.lineWidth = 1;
  for (let x = -h; x < W + h; x += 11) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + h, y + h);
    g.stroke();
    g.beginPath();
    g.moveTo(x + h, y);
    g.lineTo(x, y + h);
    g.stroke();
  }
  g.strokeStyle = 'rgba(170,188,214,0.3)';
  g.lineWidth = 3;
  for (let x = 60; x < W; x += 150) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + h);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, y + 1.5);
  g.lineTo(W, y + 1.5);
  g.stroke();
  g.restore();
}

function streetLight(g, x, y) {
  g.strokeStyle = 'rgba(120,138,166,0.5)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - 78);
  g.quadraticCurveTo(x, y - 92, x + 22, y - 92);
  g.stroke();

  const glow = g.createRadialGradient(x + 26, y - 90, 2, x + 26, y - 90, 60);
  glow.addColorStop(0, 'rgba(255,226,168,0.75)');
  glow.addColorStop(1, 'rgba(255,226,168,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(x + 26, y - 90, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,240,205,0.95)';
  g.fillRect(x + 20, y - 93, 14, 5);
}

function acUnit(g, x, y, w, h) {
  g.fillStyle = 'rgba(26,32,44,0.95)';
  g.fillRect(x, y - h, w, h);
  g.strokeStyle = 'rgba(120,138,166,0.22)';
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y - h + 0.5, w - 1, h - 1);
  g.beginPath();
  g.arc(x + w / 2, y - h / 2, h * 0.3, 0, Math.PI * 2);
  g.stroke();
}

function renderStatic(horizon, withProps) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rnd = mulberry32(20240817);

  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#0a0d14');
  sky.addColorStop(0.55, '#121722');
  sky.addColorStop(1, '#1b2130');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, horizon);

  // 雲
  for (let i = 0; i < 26; i++) {
    const cx = rnd() * W;
    const cy = rnd() * horizon * 0.7;
    const r = 60 + rnd() * 140;
    const cloud = g.createRadialGradient(cx, cy, 4, cx, cy, r);
    cloud.addColorStop(0, `rgba(58,68,88,${0.05 + rnd() * 0.07})`);
    cloud.addColorStop(1, 'rgba(58,68,88,0)');
    g.fillStyle = cloud;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  }

  buildingLayer(g, rnd, {
    baseY: horizon - 6,
    minH: 90,
    maxH: 230,
    color: '#0d111a',
    windowChance: 0.1,
    windowAlpha: 0.35,
  });
  buildingLayer(g, rnd, {
    baseY: horizon,
    minH: 60,
    maxH: 160,
    color: '#080b12',
    windowChance: 0.16,
    windowAlpha: 0.7,
  });

  // 屋上の床
  const floor = g.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, '#10141d');
  floor.addColorStop(1, '#05070b');
  g.fillStyle = floor;
  g.fillRect(0, horizon, W, H - horizon);

  // 濡れた床のタイル（パース）
  g.strokeStyle = 'rgba(120,140,172,0.07)';
  g.lineWidth = 1;
  for (let i = -14; i <= 14; i++) {
    g.beginPath();
    g.moveTo(W / 2 + i * 34, horizon);
    g.lineTo(W / 2 + i * 190, H);
    g.stroke();
  }
  let step = 6;
  for (let y = horizon + step; y < H; y += step) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
    step *= 1.28;
  }

  // ビルの灯りの映り込み
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    const y = horizon + rnd() * (H - horizon) * 0.75;
    const len = 8 + rnd() * 46;
    g.fillStyle = `rgba(255,206,128,${0.02 + rnd() * 0.05})`;
    g.fillRect(x, y, 2 + rnd() * 2, len);
  }

  fence(g, horizon - 54, 54);

  if (withProps) {
    acUnit(g, 46, horizon + 26, 78, 44);
    acUnit(g, 828, horizon + 30, 86, 48);
    streetLight(g, 300, horizon + 4);
    streetLight(g, 700, horizon + 4);
  }

  // ビネット
  const vig = g.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 620);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);

  return c;
}

let menuScene = null;
let battleScene = null;

// メニュー系画面で共有する背景
export function getMenuScene() {
  if (!menuScene) menuScene = new Scene({ horizon: 336, props: false });
  return menuScene;
}

// 戦闘用の背景（室外機・街灯あり）
export function getBattleScene() {
  if (!battleScene) battleScene = new Scene({ horizon: 318, props: true });
  return battleScene;
}

// 剣を持った人影。x=足元中心, groundY=足元, h=身長
export function drawSilhouette(g, x, groundY, h, opts = {}) {
  const dir = opts.dir || 1;
  const fill = opts.fill || '#04060a';
  const rim = opts.rim || 'rgba(150,175,210,0.5)';
  const u = h / 100;
  const top = groundY - h;

  g.save();
  g.translate(x, top);
  g.scale(dir, 1);
  g.fillStyle = fill;

  // 脚
  g.beginPath();
  g.moveTo(-6.5 * u, 52 * u);
  g.lineTo(-1 * u, 52 * u);
  g.lineTo(-1.5 * u, 100 * u);
  g.lineTo(-7 * u, 100 * u);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(1 * u, 52 * u);
  g.lineTo(6.5 * u, 52 * u);
  g.lineTo(7 * u, 100 * u);
  g.lineTo(1.5 * u, 100 * u);
  g.closePath();
  g.fill();

  // 胴（パーカー）
  g.beginPath();
  g.moveTo(-8 * u, 20 * u);
  g.quadraticCurveTo(0, 16 * u, 8 * u, 20 * u);
  g.lineTo(9 * u, 40 * u);
  g.quadraticCurveTo(9.5 * u, 54 * u, 7 * u, 55 * u);
  g.lineTo(-7 * u, 55 * u);
  g.quadraticCurveTo(-9.5 * u, 54 * u, -9 * u, 40 * u);
  g.closePath();
  g.fill();

  // 腕
  g.beginPath();
  g.moveTo(8 * u, 21 * u);
  g.lineTo(11.5 * u, 24 * u);
  g.lineTo(11 * u, 48 * u);
  g.lineTo(7.5 * u, 47 * u);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-8 * u, 21 * u);
  g.lineTo(-11.5 * u, 24 * u);
  g.lineTo(-11 * u, 48 * u);
  g.lineTo(-7.5 * u, 47 * u);
  g.closePath();
  g.fill();

  // 首と頭
  g.fillRect(-2.5 * u, 15 * u, 5 * u, 6 * u);
  g.beginPath();
  g.ellipse(0, 9 * u, 6 * u, 8 * u, 0, 0, Math.PI * 2);
  g.fill();
  // 髪
  g.beginPath();
  g.moveTo(-6.5 * u, 8 * u);
  g.quadraticCurveTo(-5 * u, -2 * u, 1 * u, 0.5 * u);
  g.quadraticCurveTo(6 * u, 1 * u, 6.5 * u, 9 * u);
  g.quadraticCurveTo(3 * u, 3 * u, -6.5 * u, 8 * u);
  g.closePath();
  g.fill();

  // 刀
  g.strokeStyle = opts.blade || 'rgba(190,210,240,0.55)';
  g.lineWidth = Math.max(1, 1.5 * u);
  g.beginPath();
  if (opts.raise) {
    g.moveTo(10 * u, 46 * u);
    g.lineTo(24 * u, 8 * u);
  } else {
    g.moveTo(10 * u, 46 * u);
    g.lineTo(34 * u, 84 * u);
  }
  g.stroke();

  // リムライト
  g.strokeStyle = rim;
  g.lineWidth = Math.max(1, 1.1 * u);
  g.beginPath();
  g.moveTo(-8 * u, 22 * u);
  g.lineTo(-9 * u, 40 * u);
  g.lineTo(-7 * u, 55 * u);
  g.stroke();
  g.beginPath();
  g.ellipse(0, 9 * u, 6 * u, 8 * u, 0, Math.PI * 0.7, Math.PI * 1.4);
  g.stroke();

  g.restore();
}

export class Scene {
  constructor(opts = {}) {
    this.horizon = opts.horizon || 330;
    this.canvas = renderStatic(this.horizon, opts.props !== false);
    this.time = 0;
    const rnd = mulberry32(7);
    this.drops = [];
    for (let i = 0; i < 260; i++) {
      this.drops.push({
        x: rnd() * (W + 200) - 100,
        y: rnd() * H,
        len: 12 + rnd() * 26,
        speed: 620 + rnd() * 520,
        alpha: 0.06 + rnd() * 0.18,
      });
    }
  }

  update(dt) {
    this.time += dt;
    for (const d of this.drops) {
      d.y += d.speed * dt;
      d.x += d.speed * dt * 0.18;
      if (d.y > H) {
        d.y = -d.len;
        d.x = Math.random() * (W + 200) - 100;
      }
    }
  }

  draw(g) {
    g.drawImage(this.canvas, 0, 0);

    g.save();
    g.strokeStyle = 'rgba(190,210,240,0.5)';
    g.lineWidth = 1;
    for (const d of this.drops) {
      g.globalAlpha = d.alpha;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x - d.len * 0.18, d.y + d.len);
      g.stroke();
    }
    g.restore();
  }
}

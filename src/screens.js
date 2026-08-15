import { ACHIEVEMENTS } from './achievements.js';
import { save, isUnlocked, unlockedCount, persist, resetSave } from './save.js';
import { wasPressed, pressCount } from './input.js';
import { sfx } from './audio.js';
import { drawCenteredText, drawPanel, drawKeyCap, drawSpacedText } from './ui.js';
import { getMenuScene, drawSilhouette } from './scene.js';
import { DEBUG_ENABLED } from './debug.js';

const MENU_X = 64;
const MENU_W = 372;
const MENU_H = 44;
const MENU_GAP = 10;

function backdrop(g, opts = {}) {
  getMenuScene().draw(g);
  if (opts.figure !== false) {
    drawSilhouette(g, 742, 516, 296, { dir: 1, rim: 'rgba(150,175,210,0.35)' });
  }
  g.fillStyle = 'rgba(4,6,10,0.45)';
  g.fillRect(0, 0, 960, 540);
  if (opts.hint) {
    g.save();
    drawKeyCap(g, 862, 16, 'Enter');
    g.fillStyle = '#8fa0bd';
    g.font = '12px sans-serif';
    g.textBaseline = 'middle';
    g.fillText('決定', 914, 27);
    g.restore();
  }
}

function drawLogo(g, cx, y, glitch, time) {
  const jitter = glitch > 0 ? (Math.random() - 0.5) * 16 : 0;
  g.save();
  g.translate(jitter, 0);
  if (glitch > 0) {
    drawSpacedText(g, 'ECHO', cx + 7, y, 'bold 76px sans-serif', 'rgba(158,92,255,0.75)', 14);
    drawSpacedText(g, 'ECHO', cx - 7, y, 'bold 76px sans-serif', 'rgba(127,231,255,0.55)', 14);
  }
  g.shadowColor = 'rgba(200,220,255,0.25)';
  g.shadowBlur = 24;
  drawSpacedText(g, 'ECHO', cx, y, 'bold 76px sans-serif', '#e8eefc', 14);
  g.restore();

  // ロゴを横切るスキャンライン（かすれ表現）
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const rnd = () => Math.random();
  for (let i = 0; i < 5; i++) {
    const ly = y - 60 + rnd() * 66;
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(cx - 190 + rnd() * 60, ly, 60 + rnd() * 220, 1 + rnd() * 2);
  }
  g.restore();

  drawSpacedText(g, '昨日の自分を超えろ', cx - 6, y + 40, '17px sans-serif', '#8fa0bd', 6);
  if (glitch > 0) {
    g.fillStyle = 'rgba(158,92,255,0.12)';
    g.fillRect(0, Math.random() * 540, 960, 2 + Math.random() * 26);
  }
  void time;
}

function drawMenuItem(g, item, x, y, selected, time) {
  const accent = item.accent;
  const pulse = 0.55 + 0.45 * Math.sin(time * 3);
  drawPanel(g, x, y, MENU_W, MENU_H, {
    fill: accent
      ? `rgba(78,32,140,${(selected ? 0.46 : 0.3) + pulse * 0.18})`
      : selected
      ? 'rgba(230,238,252,0.14)'
      : 'rgba(8,11,18,0.5)',
    border: accent
      ? `rgba(${selected ? '226,208,255' : '176,120,255'},${0.7 + pulse * 0.3})`
      : selected
      ? 'rgba(220,232,252,0.75)'
      : 'rgba(150,168,196,0.3)',
    lineWidth: selected ? 2 : 1,
    glow: accent ? '#9e5cff' : null,
    glowBlur: 14 + pulse * 18,
    corners: false,
  });

  // 選択カーソル（強調項目でも位置が分かるように必ず描く）
  if (selected) {
    g.save();
    g.fillStyle = accent ? '#e2d0ff' : '#ffffff';
    g.beginPath();
    g.moveTo(x - 16, y + MENU_H / 2 - 6);
    g.lineTo(x - 6, y + MENU_H / 2);
    g.lineTo(x - 16, y + MENU_H / 2 + 6);
    g.closePath();
    g.fill();
    g.restore();
  }

  g.save();
  if (accent) {
    g.shadowColor = '#c48bff';
    g.shadowBlur = 12 + pulse * 12;
    g.fillStyle = selected ? '#f2e6ff' : '#d7b3ff';
  } else {
    g.fillStyle = selected ? '#ffffff' : '#93a0b8';
  }
  g.font = '22px sans-serif';
  g.textBaseline = 'middle';
  g.fillText(item.icon, x + 18, y + MENU_H / 2 + 1);
  g.font = selected || accent ? 'bold 21px sans-serif' : '21px sans-serif';
  g.fillText(item.label, x + 52, y + MENU_H / 2 + 1);
  g.restore();
}

class Menu {
  constructor(items) {
    this.items = items;
    this.index = 0;
  }

  update() {
    if (!this.items.length) return null;
    const moves = pressCount('down') - pressCount('up');
    if (moves !== 0) {
      const n = this.items.length;
      this.index = (((this.index + moves) % n) + n) % n;
      sfx.move();
    }
    if (wasPressed('confirm')) {
      sfx.confirm();
      return this.items[this.index].key;
    }
    return null;
  }
}

export class TitleScreen {
  constructor(game, opts = {}) {
    this.game = game;
    this.time = 0;
    this.glitch = opts.glitch ? 1.9 : 0;
    this.menu = new Menu(this.buildItems());
    if (opts.selectKey) {
      const i = this.menu.items.findIndex((it) => it.key === opts.selectKey);
      if (i >= 0) this.menu.index = i;
    }
    if (this.glitch > 0) sfx.glitch();
  }

  buildItems() {
    const items = [{ key: 'play', icon: '▶', label: 'PLAY' }];
    if (save.endlessUnlocked) {
      items.push({ key: 'endless', icon: '∞', label: 'ENDLESS MODE', accent: '#9e5cff' });
      items.push({ key: 'achievements', icon: '🏆', label: '実績' });
    }
    items.push({ key: 'settings', icon: '⚙', label: '設定' });
    return items;
  }

  update(dt) {
    this.time += dt;
    if (this.glitch > 0) {
      this.glitch -= dt;
      this.game.setNoise(this.glitch > 0);
      if (this.glitch <= 0) this.game.setNoise(false);
      return;
    }
    if (DEBUG_ENABLED && wasPressed('debug')) {
      sfx.confirm();
      this.game.showDebug();
      return;
    }
    const choice = this.menu.update();
    if (choice === 'play') this.game.startStory();
    else if (choice === 'endless') this.game.startEndless();
    else if (choice === 'achievements') this.game.showAchievements();
    else if (choice === 'settings') this.game.showSettings();
  }

  draw(g) {
    backdrop(g, { hint: true });
    drawLogo(g, 250, 150, this.glitch, this.time);

    const startY = 268;
    this.menu.items.forEach((item, i) => {
      drawMenuItem(g, item, MENU_X, startY + i * (MENU_H + MENU_GAP), i === this.menu.index, this.time);
    });

    g.save();
    g.fillStyle = '#3d4760';
    g.font = '13px sans-serif';
    g.fillText(DEBUG_ENABLED ? 'ver.1.0.0　　Ctrl+Shift+D: DEBUG MENU' : 'ver.1.0.0', 24, 522);
    g.restore();

    if (save.endlessUnlocked) {
      g.save();
      g.fillStyle = '#4b5670';
      g.font = '13px sans-serif';
      g.textAlign = 'right';
      g.fillText(`最高記録 ${save.bestDay} 日　実績 ${unlockedCount()} / ${ACHIEVEMENTS.length}`, 936, 522);
      g.restore();
    }
  }
}

export class AchievementsScreen {
  constructor(game) {
    this.game = game;
    this.scroll = 0;
  }

  update() {
    if (wasPressed('back') || wasPressed('confirm')) {
      sfx.confirm();
      this.game.showTitle({ selectKey: 'achievements' });
      return;
    }
    if (wasPressed('down')) this.scroll = Math.min(this.scroll + 1, Math.max(0, ACHIEVEMENTS.length - 9));
    if (wasPressed('up')) this.scroll = Math.max(0, this.scroll - 1);
  }

  draw(g) {
    backdrop(g, { figure: false });
    g.fillStyle = 'rgba(4,6,10,0.5)';
    g.fillRect(0, 0, 960, 540);

    drawSpacedText(g, '実績 — ENDLESS MODE', 480, 56, 'bold 26px sans-serif', '#e8eefc', 4);
    drawCenteredText(
      g,
      `解除 ${unlockedCount()} / ${ACHIEVEMENTS.length}　　最高記録 ${save.bestDay} 日`,
      480,
      82,
      '14px sans-serif',
      '#7b8aa5'
    );

    const visible = ACHIEVEMENTS.slice(this.scroll, this.scroll + 9);
    visible.forEach((a, i) => {
      const unlocked = isUnlocked(a.id);
      const hide = a.hidden && !unlocked;
      const y = 110 + i * 42;
      drawPanel(g, 110, y, 740, 36, {
        fill: unlocked ? 'rgba(255,215,107,0.08)' : 'rgba(10,14,22,0.6)',
        border: unlocked ? 'rgba(255,215,107,0.75)' : 'rgba(150,168,196,0.22)',
        glow: unlocked ? '#ffd76b' : null,
        glowBlur: 10,
        corners: false,
      });

      g.save();
      g.textBaseline = 'middle';
      g.font = 'bold 16px sans-serif';
      g.fillStyle = unlocked ? '#ffd76b' : '#66738d';
      g.fillText(unlocked ? `🏆 ${a.name}` : hide ? '？？？' : `　${a.name}`, 130, y + 19);
      g.font = '13px sans-serif';
      g.fillStyle = unlocked ? '#cfd6e4' : '#4b5670';
      g.textAlign = 'right';
      g.fillText(hide ? '条件は隠されている' : a.desc, 832, y + 19);
      g.restore();
    });

    drawCenteredText(g, '↑↓ スクロール / Esc で戻る', 480, 522, '12px sans-serif', '#4b5670');
  }
}

export class SettingsScreen {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.menu = new Menu([{ key: 'sound' }, { key: 'shake' }, { key: 'reset' }, { key: 'back' }]);
    this.resetArmed = false;
  }

  update(dt) {
    this.time += dt;
    if (wasPressed('back')) {
      sfx.confirm();
      this.game.showTitle({ selectKey: 'settings' });
      return;
    }
    const choice = this.menu.update();
    if (!choice) return;
    if (choice === 'sound') {
      save.settings.sound = !save.settings.sound;
      persist();
    } else if (choice === 'shake') {
      save.settings.shake = !save.settings.shake;
      persist();
    } else if (choice === 'reset') {
      if (this.resetArmed) {
        resetSave();
        this.resetArmed = false;
      } else {
        this.resetArmed = true;
      }
    } else if (choice === 'back') {
      this.game.showTitle({ selectKey: 'settings' });
    }
  }

  draw(g) {
    backdrop(g);
    drawSpacedText(g, '設定', 250, 120, 'bold 34px sans-serif', '#e8eefc', 8);

    const items = [
      { icon: '♪', label: `サウンド　　　${save.settings.sound ? 'ON' : 'OFF'}` },
      { icon: '▦', label: `画面シェイク　${save.settings.shake ? 'ON' : 'OFF'}` },
      { icon: '🗑', label: this.resetArmed ? 'セーブデータ削除（もう一度Enterで確定）' : 'セーブデータ削除' },
      { icon: '←', label: '戻る' },
    ];
    items.forEach((item, i) => {
      drawMenuItem(g, item, MENU_X, 200 + i * (MENU_H + MENU_GAP), i === this.menu.index, this.time);
    });

    drawCenteredText(g, 'Enter で決定 / Esc で戻る', 480, 522, '12px sans-serif', '#4b5670');
  }
}

export class StealChoiceScreen {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.menu = new Menu([
      { key: 'steal', icon: '◆', label: '《能力を奪う》', accent: '#9e5cff' },
      { key: 'spare', icon: '◇', label: '《見逃す》' },
    ]);
  }

  update(dt) {
    this.time += dt;
    const choice = this.menu.update();
    if (choice === 'steal') this.game.stealPower();
    else if (choice === 'spare') this.game.showTitle({ selectKey: 'play' });
  }

  draw(g) {
    backdrop(g, { figure: false });
    drawSilhouette(g, 700, 512, 200, { dir: -1, raise: true, rim: 'rgba(196,107,255,0.45)' });
    g.fillStyle = 'rgba(4,6,10,0.4)';
    g.fillRect(0, 0, 960, 540);

    drawSpacedText(g, 'PERFECT ECHO 撃破', 250, 140, 'bold 34px sans-serif', '#e8eefc', 4);
    g.save();
    g.fillStyle = '#7b8aa5';
    g.font = '15px sans-serif';
    g.fillText('倒れた「昨日の自分」が、こちらを見ている。', 64, 176);
    g.restore();

    this.menu.items.forEach((item, i) => {
      drawMenuItem(g, item, MENU_X, 250 + i * (MENU_H + MENU_GAP), i === this.menu.index, this.time);
    });
  }
}

export class ResultScreen {
  constructor(game, opts) {
    this.game = game;
    this.time = 0;
    this.title = opts.title;
    this.lines = opts.lines || [];
    this.menu = new Menu(opts.items);
    this.onSelect = opts.onSelect;
  }

  update(dt) {
    this.time += dt;
    const choice = this.menu.update();
    if (choice) this.onSelect(choice);
  }

  draw(g) {
    backdrop(g);
    drawSpacedText(g, this.title, 250, 130, 'bold 36px sans-serif', '#e8eefc', 4);
    g.save();
    g.fillStyle = '#8fa0bd';
    g.font = '15px sans-serif';
    this.lines.forEach((line, i) => g.fillText(line, 64, 168 + i * 24));
    g.restore();

    this.menu.items.forEach((item, i) => {
      drawMenuItem(g, { icon: '▶', label: item.label }, MENU_X, 250 + i * (MENU_H + MENU_GAP), i === this.menu.index, this.time);
    });
  }
}

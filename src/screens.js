import { ACHIEVEMENTS } from './achievements.js';
import { save, isUnlocked, unlockedCount, persist, resetSave } from './save.js';
import { wasPressed } from './input.js';
import { sfx } from './audio.js';
import { drawCenteredText } from './ui.js';

class Menu {
  constructor(items) {
    this.items = items;
    this.index = 0;
  }

  update() {
    if (!this.items.length) return null;
    if (wasPressed('up')) {
      this.index = (this.index - 1 + this.items.length) % this.items.length;
      sfx.move();
    }
    if (wasPressed('down')) {
      this.index = (this.index + 1) % this.items.length;
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
    const items = [{ key: 'play', label: '▶ PLAY' }];
    if (save.endlessUnlocked) {
      items.push({ key: 'endless', label: '🟣 ENDLESS MODE', accent: '#9e5cff' });
      items.push({ key: 'achievements', label: '🏆 実績' });
    }
    items.push({ key: 'settings', label: '⚙ 設定' });
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
    const choice = this.menu.update();
    if (choice === 'play') this.game.startStory();
    else if (choice === 'endless') this.game.startEndless();
    else if (choice === 'achievements') this.game.showAchievements();
    else if (choice === 'settings') this.game.showSettings();
  }

  draw(g) {
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, 960, 540);

    const jitter = this.glitch > 0 ? (Math.random() - 0.5) * 14 : 0;
    g.save();
    g.translate(jitter, 0);
    drawCenteredText(g, 'ECHO', 480, 168, 'bold 92px sans-serif', '#e8eefc');
    if (this.glitch > 0) {
      drawCenteredText(g, 'ECHO', 480 + 6, 168, 'bold 92px sans-serif', 'rgba(158,92,255,0.7)');
      drawCenteredText(g, 'ECHO', 480 - 6, 168, 'bold 92px sans-serif', 'rgba(127,231,255,0.5)');
    }
    g.restore();
    drawCenteredText(g, '昨日の自分を超えろ', 480, 206, '18px sans-serif', '#7b8aa5');

    const startY = 300;
    this.menu.items.forEach((item, i) => {
      const selected = i === this.menu.index;
      const y = startY + i * 48;
      g.save();
      if (item.accent) {
        const pulse = 0.55 + 0.45 * Math.sin(this.time * 3);
        g.shadowColor = item.accent;
        g.shadowBlur = 18 + pulse * 16;
        g.fillStyle = item.accent;
      } else {
        g.fillStyle = selected ? '#e8eefc' : '#66738d';
      }
      g.font = selected ? 'bold 28px sans-serif' : '24px sans-serif';
      g.textAlign = 'center';
      g.fillText(item.label, 480, y);
      g.restore();
      if (selected) {
        drawCenteredText(g, '◆', 480 - 190, y, '18px sans-serif', '#9e5cff');
      }
    });

    if (save.endlessUnlocked) {
      drawCenteredText(
        g,
        `最高記録 ${save.bestDay} 日 / 実績 ${unlockedCount()} / ${ACHIEVEMENTS.length}`,
        480,
        512,
        '13px sans-serif',
        '#4b5670'
      );
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
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, 960, 540);
    drawCenteredText(g, '🏆 実績 — ENDLESS MODE', 480, 60, 'bold 30px sans-serif', '#e8eefc');
    drawCenteredText(
      g,
      `解除 ${unlockedCount()} / ${ACHIEVEMENTS.length}　　最高記録 ${save.bestDay} 日`,
      480,
      88,
      '14px sans-serif',
      '#7b8aa5'
    );

    const visible = ACHIEVEMENTS.slice(this.scroll, this.scroll + 9);
    visible.forEach((a, i) => {
      const unlocked = isUnlocked(a.id);
      const hide = a.hidden && !unlocked;
      const y = 120 + i * 42;
      g.fillStyle = unlocked ? 'rgba(255,215,107,0.08)' : 'rgba(20,25,38,0.6)';
      g.fillRect(120, y, 720, 36);
      g.strokeStyle = unlocked ? '#ffd76b' : '#232c3d';
      g.lineWidth = 1;
      g.strokeRect(120.5, y + 0.5, 719, 35);

      g.font = 'bold 16px sans-serif';
      g.fillStyle = unlocked ? '#ffd76b' : '#66738d';
      g.fillText(unlocked ? `🏆 ${a.name}` : hide ? '？？？' : `　${a.name}`, 140, y + 23);

      g.font = '13px sans-serif';
      g.fillStyle = unlocked ? '#cfd6e4' : '#4b5670';
      g.textAlign = 'right';
      g.fillText(hide ? '条件は隠されている' : a.desc, 824, y + 23);
      g.textAlign = 'left';
    });

    drawCenteredText(g, '↑↓ スクロール / Esc で戻る', 480, 522, '12px sans-serif', '#4b5670');
  }
}

export class SettingsScreen {
  constructor(game) {
    this.game = game;
    this.menu = new Menu([
      { key: 'sound', label: '' },
      { key: 'shake', label: '' },
      { key: 'reset', label: '' },
      { key: 'back', label: '戻る' },
    ]);
    this.resetArmed = false;
  }

  update() {
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
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, 960, 540);
    drawCenteredText(g, '⚙ 設定', 480, 120, 'bold 34px sans-serif', '#e8eefc');

    const labels = [
      `サウンド　　　${save.settings.sound ? 'ON' : 'OFF'}`,
      `画面シェイク　${save.settings.shake ? 'ON' : 'OFF'}`,
      this.resetArmed ? 'セーブデータ削除（もう一度Enterで確定）' : 'セーブデータ削除',
      '戻る',
    ];
    labels.forEach((label, i) => {
      const selected = i === this.menu.index;
      drawCenteredText(
        g,
        label,
        480,
        230 + i * 48,
        selected ? 'bold 24px sans-serif' : '22px sans-serif',
        selected ? '#e8eefc' : '#66738d'
      );
    });
    drawCenteredText(g, 'Enter で決定 / Esc で戻る', 480, 500, '12px sans-serif', '#4b5670');
  }
}

export class StealChoiceScreen {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.menu = new Menu([
      { key: 'steal', label: '《能力を奪う》' },
      { key: 'spare', label: '《見逃す》' },
    ]);
  }

  update(dt) {
    this.time += dt;
    const choice = this.menu.update();
    if (choice === 'steal') this.game.stealPower();
    else if (choice === 'spare') this.game.showTitle({ selectKey: 'play' });
  }

  draw(g) {
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, 960, 540);
    drawCenteredText(g, 'PERFECT ECHO 撃破', 480, 150, 'bold 40px sans-serif', '#e8eefc');
    drawCenteredText(g, '倒れた「昨日の自分」が、こちらを見ている。', 480, 200, '16px sans-serif', '#7b8aa5');

    this.menu.items.forEach((item, i) => {
      const selected = i === this.menu.index;
      const accent = item.key === 'steal' ? '#9e5cff' : '#66738d';
      g.save();
      if (selected) {
        g.shadowColor = accent;
        g.shadowBlur = 20;
      }
      drawCenteredText(
        g,
        item.label,
        480,
        300 + i * 60,
        selected ? 'bold 30px sans-serif' : '26px sans-serif',
        selected ? accent : '#4b5670'
      );
      g.restore();
    });
  }
}

export class ResultScreen {
  constructor(game, opts) {
    this.game = game;
    this.title = opts.title;
    this.lines = opts.lines || [];
    this.menu = new Menu(opts.items);
    this.onSelect = opts.onSelect;
  }

  update() {
    const choice = this.menu.update();
    if (choice) this.onSelect(choice);
  }

  draw(g) {
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, 960, 540);
    drawCenteredText(g, this.title, 480, 160, 'bold 42px sans-serif', '#e8eefc');
    this.lines.forEach((line, i) => {
      drawCenteredText(g, line, 480, 215 + i * 26, '16px sans-serif', '#8fa0bd');
    });
    this.menu.items.forEach((item, i) => {
      const selected = i === this.menu.index;
      drawCenteredText(
        g,
        item.label,
        480,
        340 + i * 46,
        selected ? 'bold 26px sans-serif' : '22px sans-serif',
        selected ? '#e8eefc' : '#66738d'
      );
    });
  }
}

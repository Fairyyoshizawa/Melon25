import { ABILITIES } from './abilities.js';
import { ACHIEVEMENTS } from './achievements.js';
import { save, persist, unlockAchievement } from './save.js';
import { wasPressed, pressCount } from './input.js';
import { sfx } from './audio.js';
import { drawCenteredText, drawPanel, drawSpacedText } from './ui.js';

// 製品版にするときはここを false にすると Ctrl+Shift+D のメニューごと無効になる。
export const DEBUG_ENABLED = true;

const ABILITY_MODES = ['default', 'all', 'none'];
const ABILITY_LABELS = { default: 'DAY 相当', all: '全解放', none: 'なし' };
const GHOST_MODES = ['default', 'sample', 'none'];
const GHOST_LABELS = { default: '自動（前日の記録）', sample: 'サンプル記録', none: '記録なし（通常AI）' };

export const debug = {
  god: false,
  echoHp: 0, // 0 = 既定値
  playerAbilities: 'default',
  echoAbilities: 'default',
  ghost: 'default',
};

export function debugActive() {
  return (
    DEBUG_ENABLED &&
    (debug.god ||
      debug.echoHp > 0 ||
      debug.playerAbilities !== 'default' ||
      debug.echoAbilities !== 'default' ||
      debug.ghost !== 'default')
  );
}

const allAbilities = () => ABILITIES.map((a, i) => i);

// 能力設定を戦闘の初期値に適用する
export function debugAbilities(mode, fallback) {
  if (!DEBUG_ENABLED) return fallback;
  if (mode === 'all') return allAbilities();
  if (mode === 'none') return [];
  return fallback;
}

// 「適当な過去行動データ」。前日をプレイしなくても記憶再生を確認できる。
export function sampleGhost() {
  const frames = [];
  const push = (t, o) => frames.push({ t, dt: 1 / 60, vx: 0, attack: false, parry: false, ability: -1, ...o });
  let t = 0.8;
  for (let round = 0; round < 6; round++) {
    push((t += 1.2), { attack: true });
    push((t += 0.9), { attack: true });
    push((t += 0.9), { attack: true });
    push((t += 1.4), { parry: true });
    push((t += 1.0), { ability: round % ABILITIES.length });
    push((t += 1.3), { attack: true });
  }
  return frames;
}

export function debugGhost(fallback) {
  if (!DEBUG_ENABLED) return fallback;
  if (debug.ghost === 'sample') return sampleGhost();
  if (debug.ghost === 'none') return null;
  return fallback;
}

export function debugEchoHp(fallback) {
  if (!DEBUG_ENABLED || debug.echoHp <= 0) return fallback;
  return debug.echoHp;
}

function cycle(list, value, step) {
  const i = list.indexOf(value);
  const n = list.length;
  return list[(((i + step) % n) + n) % n];
}

export class DebugScreen {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.index = 0;
    this.day = 10;
    this.endlessDay = 1;
  }

  items() {
    const hp = debug.echoHp > 0 ? `${debug.echoHp}` : '既定';
    return [
      { key: 'perfect', label: 'PERFECT ECHO TEST（DAY 10・両者5能力・記録あり）', accent: true },
      { key: 'ending', label: 'ボス撃破状態から開始（エンディング直行）', accent: true },
      { key: 'story', label: `ストーリー DAY ${this.day} を開始`, value: '← → で DAY 変更' },
      { key: 'endless', label: `ENDLESS DAY ${this.endlessDay} を開始`, value: '← → で DAY 変更' },
      { key: 'god', label: '無敵', value: debug.god ? 'ON' : 'OFF' },
      { key: 'hp', label: 'エコーHP', value: hp },
      { key: 'pab', label: 'プレイヤー能力', value: ABILITY_LABELS[debug.playerAbilities] },
      { key: 'eab', label: 'エコー能力', value: ABILITY_LABELS[debug.echoAbilities] },
      { key: 'ghost', label: '昨日の行動データ', value: GHOST_LABELS[debug.ghost] },
      { key: 'endless_unlock', label: 'エンドレス解放', value: save.endlessUnlocked ? '解放済み' : '未解放' },
      { key: 'ach', label: '実績', value: `${Object.keys(save.achievements).length} / ${ACHIEVEMENTS.length}` },
      { key: 'back', label: '閉じる（Esc）' },
    ];
  }

  adjust(key, step) {
    if (key === 'story') this.day = ((this.day - 1 + step + 10) % 10) + 1;
    else if (key === 'endless') this.endlessDay = Math.max(1, this.endlessDay + step);
    else if (key === 'god') debug.god = !debug.god;
    else if (key === 'hp') debug.echoHp = cycle([0, 1, 30, 200], debug.echoHp, step);
    else if (key === 'pab') debug.playerAbilities = cycle(ABILITY_MODES, debug.playerAbilities, step);
    else if (key === 'eab') debug.echoAbilities = cycle(ABILITY_MODES, debug.echoAbilities, step);
    else if (key === 'ghost') debug.ghost = cycle(GHOST_MODES, debug.ghost, step);
    else if (key === 'endless_unlock') {
      save.endlessUnlocked = !save.endlessUnlocked;
      save.perfectEchoCleared = save.endlessUnlocked;
      persist();
    } else if (key === 'ach') {
      if (Object.keys(save.achievements).length) {
        save.achievements = {};
        persist();
      } else {
        for (const a of ACHIEVEMENTS) unlockAchievement(a.id);
      }
    } else return false;
    return true;
  }

  confirm(key) {
    if (key === 'perfect') {
      debug.playerAbilities = 'all';
      debug.echoAbilities = 'all';
      if (debug.ghost === 'default') debug.ghost = 'sample';
      this.game.startStory(9);
    } else if (key === 'ending') {
      this.game.showEndingChoice();
    } else if (key === 'story') {
      this.game.startStory(this.day - 1);
    } else if (key === 'endless') {
      this.game.startEndless(this.endlessDay);
    } else if (key === 'back') {
      this.game.showTitle();
    } else {
      this.adjust(key, 1);
    }
  }

  update(dt) {
    this.time += dt;
    if (wasPressed('back') || wasPressed('debug')) {
      sfx.confirm();
      this.game.showTitle();
      return;
    }
    const items = this.items();
    const moves = pressCount('down') - pressCount('up');
    if (moves !== 0) {
      const n = items.length;
      this.index = (((this.index + moves) % n) + n) % n;
      sfx.move();
    }
    const step = pressCount('right') - pressCount('left');
    if (step !== 0 && this.adjust(items[this.index].key, step)) sfx.move();
    if (wasPressed('confirm')) {
      sfx.confirm();
      this.confirm(items[this.index].key);
    }
  }

  draw(g) {
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, 960, 540);
    drawSpacedText(g, 'DEBUG MENU', 480, 52, 'bold 26px sans-serif', '#8fffc4', 6);
    drawCenteredText(g, '開発用。製品版では DEBUG_ENABLED を false にする', 480, 76, '12px sans-serif', '#4b5670');

    this.items().forEach((item, i) => {
      const y = 100 + i * 34;
      const selected = i === this.index;
      drawPanel(g, 120, y, 720, 30, {
        fill: selected ? 'rgba(143,255,196,0.12)' : 'rgba(10,14,22,0.6)',
        border: selected ? 'rgba(143,255,196,0.8)' : 'rgba(150,168,196,0.2)',
        corners: false,
      });
      g.save();
      g.textBaseline = 'middle';
      g.font = item.accent ? 'bold 15px sans-serif' : '15px sans-serif';
      g.fillStyle = item.accent ? '#8fffc4' : selected ? '#ffffff' : '#93a0b8';
      g.fillText(item.label, 138, y + 16);
      if (item.value) {
        g.textAlign = 'right';
        g.fillStyle = selected ? '#e8eefc' : '#66738d';
        g.fillText(item.value, 822, y + 16);
      }
      g.restore();
    });

    drawCenteredText(
      g,
      '↑↓ 選択 / ←→ 変更 / Enter 決定 / Esc・Ctrl+Shift+D で閉じる　　戦闘中: Ctrl+Shift+K でエコーHPを1に',
      480,
      522,
      '12px sans-serif',
      '#4b5670',
    );
  }
}

import { initInput, endFrame } from './input.js';
import { Battle } from './battle.js';
import { TitleScreen, AchievementsScreen, SettingsScreen, EndingChoiceScreen, ResultScreen } from './screens.js';
import { save, unlockEndless, unlockAchievement, recordDay, persist } from './save.js';
import { getAchievement, SURVIVAL_THRESHOLDS } from './achievements.js';
import { pushToast, updateToasts, drawToasts } from './ui.js';
import { getMenuScene } from './scene.js';
import { ABILITIES } from './abilities.js';
import { DEBUG_ENABLED, DebugScreen, debugAbilities, debugEchoHp, debugGhost, debug } from './debug.js';

// 能力は初期状態では封印されていて、エコーを 1 体倒すごとに 1 つずつ解放される。
function abilitiesUpTo(count) {
  return ABILITIES.slice(0, Math.max(0, Math.min(ABILITIES.length, count))).map((a, i) => i);
}

function announceAbility(count) {
  const ab = ABILITIES[count - 1];
  if (ab) pushToast(`${ab.icon} ${ab.name} 解放`, '倒した昨日の自分から能力を取り戻した', 'achievement');
}

const STORY_DAYS = 10;

// DAY n のエコーは「DAY n-1 のプレイヤー」なので、能力も前日のプレイヤーと同じだけ持つ。
function storyStage(day) {
  const last = day === STORY_DAYS;
  return {
    label: last ? `DAY ${day} — PERFECT ECHO` : `DAY ${day} — 昨日の自分`,
    echoName: last ? 'PERFECT ECHO' : day >= 6 ? 'ECHO+' : 'ECHO',
    echoHp: last ? 170 : 60 + day * 9,
    echoDamage: 7 + day * 0.6,
    echoSpeed: Math.min(210, 150 + day * 6),
    echoAbilities: last ? abilitiesUpTo(ABILITIES.length) : abilitiesUpTo(day - 2),
    echoColor: last ? '#c46bff' : undefined,
    aiReaction: Math.max(0.26, 0.55 - day * 0.03),
  };
}

class Game {
  constructor(canvas, noiseEl) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.noiseEl = noiseEl;
    this.screen = new TitleScreen(this);
    this.endlessProfile = [0, 0, 0, 0, 0];
    this.storyGhosts = []; // stageIndex -> その日のエコーが再生する前日の操作記録
    this.endlessGhost = null;
    this.last = performance.now();
  }

  setNoise(on) {
    this.noiseEl.classList.toggle('hidden', !on);
  }

  showTitle(opts = {}) {
    this.setNoise(false);
    this.screen = new TitleScreen(this, opts);
  }

  showAchievements() {
    this.screen = new AchievementsScreen(this);
  }

  showSettings() {
    this.screen = new SettingsScreen(this);
  }

  showDebug() {
    if (!DEBUG_ENABLED) return;
    this.setNoise(false);
    this.screen = new DebugScreen(this);
  }

  showEndingChoice() {
    this.screen = new EndingChoiceScreen(this);
  }

  // ---------- ストーリー ----------

  startStory(stageIndex = 0) {
    this.storyStage = stageIndex;
    if (stageIndex === 0) this.storyGhosts = [];
    const stage = storyStage(stageIndex + 1);
    this.storyLabel = stage.label;
    this.screen = new Battle({
      mode: 'story',
      day: stageIndex + 1,
      label: stage.label,
      echoName: stage.echoName,
      echoHp: debugEchoHp(stage.echoHp),
      echoDamage: stage.echoDamage,
      echoSpeed: stage.echoSpeed,
      echoAbilities: debugAbilities(debug.echoAbilities, stage.echoAbilities),
      echoColor: stage.echoColor,
      playerAbilities: debugAbilities(debug.playerAbilities, abilitiesUpTo(stageIndex)),
      ghost: debugGhost(this.storyGhosts[stageIndex]),
      aiReaction: stage.aiReaction,
      aiWeights: [1, 1, 1, 1, 1],
      onEnd: (e) => this.onStoryEnd(e),
    });
  }

  onStoryEnd({ result, battle }) {
    if (result === 'quit') {
      this.showTitle({ selectKey: 'play' });
      return;
    }
    if (result === 'lose') {
      this.screen = new ResultScreen(this, {
        title: '昨日に負けた',
        lines: [this.storyLabel],
        items: [
          { key: 'retry', label: 'もう一度' },
          { key: 'title', label: 'タイトルへ' },
        ],
        onSelect: (key) => (key === 'retry' ? this.startStory(this.storyStage) : this.showTitle({ selectKey: 'play' })),
      });
      return;
    }
    if (this.storyStage < STORY_DAYS - 1) {
      // 今日の自分が、明日のエコーになる
      this.storyGhosts[this.storyStage + 1] = battle.recording;
      announceAbility(this.storyStage + 1);
      this.startStory(this.storyStage + 1);
    } else {
      this.showEndingChoice();
    }
  }

  chooseEnding(key) {
    unlockEndless();
    if (key === 'steal') {
      this.setNoise(true);
      this.showTitleWithGlitch();
      return;
    }
    if (key === 'erase') {
      // 昨日の自分のデータごと消すので、次の周回に持ち越す記録が無くなる
      this.storyGhosts = [];
      save.bestDay = 0;
      persist();
    }
    this.setNoise(false);
    this.screen = new ResultScreen(this, {
      title: key === 'destroy' ? 'ECHO 消滅' : '記録 消去',
      lines:
        key === 'destroy'
          ? ['昨日の自分は、二度と現れない。', '手元に残ったのは、剣だけだった。']
          : ['積み上げた 10 日ぶんの記録が消えた。', 'まねされるものは、もう何も無い。'],
      items: [{ key: 'title', label: 'タイトルへ' }],
      onSelect: () => this.showTitle({ selectKey: 'endless' }),
    });
  }

  showTitleWithGlitch() {
    this.screen = new TitleScreen(this, { glitch: true, selectKey: 'endless' });
    this.setNoise(true);
  }

  // ---------- エンドレス ----------

  startEndless(day = 1) {
    if (day === 1) {
      this.endlessProfile = [0, 0, 0, 0, 0];
      this.endlessGhost = null;
    }
    this.endlessDay = day;
    const hp = Math.min(420, 80 + day * 6);
    const damage = 8 + day * 0.3;
    const speed = Math.min(260, 190 + day * 2);
    this.screen = new Battle({
      mode: 'endless',
      day,
      label: `DAY ${day}`,
      echoName: 'ECHO',
      echoHp: debugEchoHp(hp),
      echoDamage: damage,
      echoSpeed: speed,
      echoAbilities: debugAbilities(debug.echoAbilities, [0, 1, 2, 3, 4]),
      echoColor: '#ff6b8a',
      playerAbilities: debugAbilities(debug.playerAbilities, abilitiesUpTo(ABILITIES.length)),
      ghost: debugGhost(this.endlessGhost),
      aiReaction: Math.max(0.2, 0.5 - day * 0.008),
      aiWeights: this.endlessProfile.map((c) => 1 + c * 1.5),
      onEnd: (e) => this.onEndlessEnd(e),
    });
    this.screen.aiThink = Math.max(0.45, 0.9 - day * 0.008);
  }

  onEndlessEnd({ result, battle }) {
    // 昨日の自分＝前日のプレイヤーの能力使用傾向を学習する
    this.endlessProfile = battle.playerAbilityCounts.slice();

    if (result === 'quit') {
      this.showTitle({ selectKey: 'endless' });
      return;
    }
    if (result === 'win') {
      recordDay(this.endlessDay);
      this.grantEndlessAchievements(battle, this.endlessDay);
      this.endlessGhost = battle.recording;
      this.startEndless(this.endlessDay + 1);
      return;
    }
    const day = this.endlessDay;
    this.screen = new ResultScreen(this, {
      title: `DAY ${day} で倒れた`,
      lines: [`生存日数 ${day - 1} 日`, `最高記録 ${save.bestDay} 日`],
      items: [
        { key: 'retry', label: 'DAY 1 から再挑戦' },
        { key: 'achievements', label: '🏆 実績を見る' },
        { key: 'title', label: 'タイトルへ' },
      ],
      onSelect: (key) => {
        if (key === 'retry') this.startEndless(1);
        else if (key === 'achievements') this.showAchievements();
        else this.showTitle({ selectKey: 'endless' });
      },
    });
  }

  grantEndlessAchievements(battle, day) {
    const ids = [...battle.pendingUnlocks];
    for (const t of SURVIVAL_THRESHOLDS) {
      if (day >= t.days) ids.push(t.id);
    }
    if (!battle.playerTookDamage) ids.push('noDamage');
    if (!battle.playerUsedAbility) ids.push('noAbility');
    if (battle.lastEchoDamageSource === 'reflect') ids.push('reflectKill');
    if (battle.lastEchoDamageSource === 'flame') ids.push('flameKill');
    if (battle.timestopKill) ids.push('timestopKill');
    if (battle.mirrorAfterimage) ids.push('mirrorAfterimage');
    if (battle.echo.usedAbilities.size >= 5) ids.push('allFive');

    for (const id of ids) {
      if (unlockAchievement(id)) {
        const a = getAchievement(id);
        if (a) pushToast(`🏆 ${a.name}`, a.desc, 'achievement');
      }
    }
  }

  // ---------- ループ ----------

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.screen.update(dt);
    if (!(this.screen instanceof Battle)) getMenuScene().update(dt);
    updateToasts(dt);
    this.screen.draw(this.g);
    drawToasts(this.g);
    endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  start() {
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
    });
  }
}

initInput(window);
const game = new Game(document.getElementById('game'), document.getElementById('noise'));
window.echoGame = game; // デバッグ・動作確認用
window.echoDebug = debug;
game.start();

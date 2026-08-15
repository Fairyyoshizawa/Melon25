import { initInput, endFrame } from './input.js';
import { Battle } from './battle.js';
import { TitleScreen, AchievementsScreen, SettingsScreen, StealChoiceScreen, ResultScreen } from './screens.js';
import { save, unlockEndless, unlockAchievement, recordDay } from './save.js';
import { getAchievement, SURVIVAL_THRESHOLDS } from './achievements.js';
import { pushToast, updateToasts, drawToasts } from './ui.js';
import { getMenuScene } from './scene.js';

const STORY_STAGES = [
  {
    label: 'DAY 1 — 昨日の自分',
    echoName: 'ECHO',
    echoHp: 70,
    echoDamage: 8,
    echoSpeed: 165,
    echoAbilities: [],
    aiReaction: 0.5,
  },
  {
    label: 'DAY 2 — 一昨日より速い自分',
    echoName: 'ECHO+',
    echoHp: 95,
    echoDamage: 10,
    echoSpeed: 200,
    echoAbilities: [0, 4],
    aiReaction: 0.4,
  },
  {
    label: 'PERFECT ECHO',
    echoName: 'PERFECT ECHO',
    echoHp: 150,
    echoDamage: 12,
    echoSpeed: 235,
    echoAbilities: [0, 1, 2, 3, 4],
    echoColor: '#c46bff',
    aiReaction: 0.28,
  },
];

class Game {
  constructor(canvas, noiseEl) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.noiseEl = noiseEl;
    this.screen = new TitleScreen(this);
    this.endlessProfile = [0, 0, 0, 0, 0];
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

  // ---------- ストーリー ----------

  startStory(stageIndex = 0) {
    this.storyStage = stageIndex;
    const stage = STORY_STAGES[stageIndex];
    this.screen = new Battle({
      mode: 'story',
      day: stageIndex + 1,
      label: stage.label,
      echoName: stage.echoName,
      echoHp: stage.echoHp,
      echoDamage: stage.echoDamage,
      echoSpeed: stage.echoSpeed,
      echoAbilities: stage.echoAbilities,
      echoColor: stage.echoColor,
      aiReaction: stage.aiReaction,
      aiWeights: [1, 1, 1, 1, 1],
      onEnd: (e) => this.onStoryEnd(e),
    });
  }

  onStoryEnd({ result }) {
    if (result === 'quit') {
      this.showTitle({ selectKey: 'play' });
      return;
    }
    if (result === 'lose') {
      this.screen = new ResultScreen(this, {
        title: '昨日に負けた',
        lines: [STORY_STAGES[this.storyStage].label],
        items: [
          { key: 'retry', label: 'もう一度' },
          { key: 'title', label: 'タイトルへ' },
        ],
        onSelect: (key) => (key === 'retry' ? this.startStory(this.storyStage) : this.showTitle({ selectKey: 'play' })),
      });
      return;
    }
    if (this.storyStage < STORY_STAGES.length - 1) {
      this.startStory(this.storyStage + 1);
    } else {
      this.screen = new StealChoiceScreen(this);
    }
  }

  stealPower() {
    unlockEndless();
    this.setNoise(true);
    this.showTitleWithGlitch();
  }

  showTitleWithGlitch() {
    this.screen = new TitleScreen(this, { glitch: true, selectKey: 'endless' });
    this.setNoise(true);
  }

  // ---------- エンドレス ----------

  startEndless(day = 1) {
    if (day === 1) this.endlessProfile = [0, 0, 0, 0, 0];
    this.endlessDay = day;
    const hp = Math.min(420, 80 + day * 6);
    const damage = 8 + day * 0.3;
    const speed = Math.min(310, 200 + day * 2);
    this.screen = new Battle({
      mode: 'endless',
      day,
      label: `DAY ${day}`,
      echoName: 'ECHO',
      echoHp: hp,
      echoDamage: damage,
      echoSpeed: speed,
      echoAbilities: [0, 1, 2, 3, 4],
      echoColor: '#ff6b8a',
      aiReaction: Math.max(0.12, 0.42 - day * 0.008),
      aiWeights: this.endlessProfile.map((c) => 1 + c * 1.5),
      onEnd: (e) => this.onEndlessEnd(e),
    });
    this.screen.aiThink = Math.max(0.14, 0.45 - day * 0.008);
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
game.start();

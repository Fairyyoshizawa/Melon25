import { initInput, endFrame } from './input.js';
import { Battle } from './battle.js';
import {
  TitleScreen,
  AchievementsScreen,
  SettingsScreen,
  EndingChoiceScreen,
  EndingScreen,
  ResultScreen,
} from './screens.js';
import { initSave, save, unlockEndless, unlockAchievement, recordDay, persist } from './save.js';
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
  // DAY 1 には昨日が無いので、まねる記録を持たない ZERO ECHO が相手になる
  const zero = day === 1;
  return {
    label: last ? `DAY ${day} — PERFECT ECHO` : zero ? `DAY ${day} — ZERO ECHO` : `DAY ${day} — 昨日の自分`,
    echoName: last ? 'PERFECT ECHO' : zero ? 'ZERO ECHO' : day >= 6 ? 'ECHO+' : 'ECHO',
    echoHp: last ? 170 : 60 + day * 9,
    echoDamage: 7 + day * 0.6,
    echoSpeed: Math.min(210, 150 + day * 6),
    echoAbilities: last ? abilitiesUpTo(ABILITIES.length) : abilitiesUpTo(day - 2),
    echoColor: last ? '#c46bff' : undefined,
    aiReaction: Math.max(0.26, 0.55 - day * 0.03),
  };
}

// PERFECT ECHO は DAY 1〜9 のプレイヤーの能力の使い方をそのまま身につけている。
// 多用した能力ほど選ばれやすく、そもそも能力に頼っていたなら発動の間隔も短くなる。
function perfectEchoProfile(counts, days) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0 || days <= 0) {
    // 剣だけで来た相手の記憶なので、エコーもほとんど能力を使わない
    return { weights: [0.12, 0.12, 0.12, 0.12, 0.12], think: 1.7, topIdx: -1 };
  }
  const perDay = total / days;
  // どの能力を選ぶかは使った割合、そもそも能力を出すかどうかは 1 日あたりの回数で決まる
  const lean = Math.min(1, 0.15 + perDay * 0.28);
  const weights = counts.map((c) => lean * (0.3 + 3.4 * (c / total)));
  const think = Math.max(0.4, Math.min(1.7, 1.35 - perDay * 0.11));
  let topIdx = 0;
  counts.forEach((c, i) => {
    if (c > counts[topIdx]) topIdx = i;
  });
  return { weights, think, topIdx };
}

function announcePerfectEchoProfile(profile, counts) {
  if (profile.topIdx === -1) {
    pushToast('PERFECT ECHO', '能力を使わなかった 9 日間を覚えている。剣で来る', 'achievement');
    return;
  }
  const ab = ABILITIES[profile.topIdx];
  pushToast(`PERFECT ECHO`, `${ab.icon} ${ab.name} を ${counts[profile.topIdx]} 回使った昨日を覚えている`, 'achievement');
}

class Game {
  constructor(canvas, noiseEl) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.noiseEl = noiseEl;
    this.screen = new TitleScreen(this);
    this.endlessProfile = [0, 0, 0, 0, 0];
    this.storyGhosts = []; // stageIndex -> その日のエコーが再生する前日の操作記録
    this.storyAbilityCounts = [0, 0, 0, 0, 0]; // DAY 1〜9 でプレイヤーが能力を使った回数
    this.storyAbilityDays = 0;
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
    if (stageIndex === 0) {
      this.storyGhosts = [];
      this.storyAbilityCounts = [0, 0, 0, 0, 0];
      this.storyAbilityDays = 0;
    }
    const stage = storyStage(stageIndex + 1);
    this.storyLabel = stage.label;
    const isPerfect = stageIndex + 1 === STORY_DAYS;
    const profile = isPerfect
      ? perfectEchoProfile(this.storyAbilityCounts, this.storyAbilityDays)
      : { weights: [1, 1, 1, 1, 1], think: 0.8, topIdx: -1 };
    if (isPerfect) announcePerfectEchoProfile(profile, this.storyAbilityCounts);
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
      aiWeights: profile.weights,
      aiThink: profile.think,
      onEnd: (e) => this.onStoryEnd(e),
    });
  }

  // デバッグから DAY 10 だけを始めるとき用に、9 日ぶんの能力使用傾向を差し込む
  setStoryAbilityProfile(counts, days) {
    this.storyAbilityCounts = counts.slice();
    this.storyAbilityDays = days;
  }

  onStoryEnd({ result, battle }) {
    if (result === 'quit') {
      this.showTitle({ selectKey: 'play' });
      return;
    }
    if (result === 'lose') {
      this.screen = new ResultScreen(this, {
        title: '昨日の自分に負けた',
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
      // 能力の使い方は日をまたいで積み上がり、最終日の PERFECT ECHO が受け継ぐ
      battle.playerAbilityCounts.forEach((c, i) => {
        this.storyAbilityCounts[i] += c;
      });
      this.storyAbilityDays++;
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
    if (key === 'destroy') {
      this.setNoise(true);
      this.showBadEnd();
      return;
    }
    // 記録も能力も残さないので、0 時にコピーされる「昨日」が存在しない
    this.storyGhosts = [];
    this.storyAbilityCounts = [0, 0, 0, 0, 0];
    this.storyAbilityDays = 0;
    save.bestDay = 0;
    persist();
    this.setNoise(false);
    this.showTrueEnd();
  }

  showBadEnd() {
    this.screen = new EndingScreen(this, {
      beats: [
        {
          figure: true,
          rim: 'rgba(196,107,255,0.45)',
          heading: 'エコーを破壊する',
          lines: [
            'PERFECT ECHO は砕けた。',
            '砕けた破片の向こうに、誰かが立っている。',
            'たった今 PERFECT ECHO を倒した、主人公自身だ。',
          ],
        },
        {
          dark: true,
          heading: ['エコーを何体斬っても', '意味がない'],
          lines: [
            '原因はエコーではなかった。',
            '昨日を記録してしまう、この世界のほうだ。',
          ],
        },
        {
          dark: true,
          clock: true,
          heading: 'DAY 12',
          lines: [
            'また目を覚ます。時計は 0:00:00 のまま動かない。',
            '今度のエコーは、PERFECT ECHO を倒した経験まで持っている。',
            'BAD END — ループは終わらない。',
          ],
        },
      ],
      onDone: () => this.showTitle({ selectKey: 'endless' }),
    });
  }

  showTrueEnd() {
    this.screen = new EndingScreen(this, {
      beats: [
        {
          heading: '記録を消す',
          lines: [
            '10 日ぶんの戦闘記録を消した。',
            '5 つの能力も、すべて手放した。',
            '残ったのは、何も覚えていない自分だけ。',
          ],
        },
        {
          dark: true,
          clock: true,
          heading: '0 時',
          lines: ['コピーする「昨日」が、どこにも存在しない。'],
        },
        {
          dark: true,
          clock: true,
          tick: true,
          heading: 'TRUE END — ループ終了',
          lines: [
            '初めて時間が進んだ。',
            '明日は、まだ誰の記録でもない。',
          ],
        },
      ],
      onDone: () => this.showTitle({ selectKey: 'endless' }),
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
await initSave();
const game = new Game(document.getElementById('game'), document.getElementById('noise'));
window.echoGame = game; // デバッグ・動作確認用
window.echoDebug = debug;
game.start();

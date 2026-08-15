import {
  ABILITIES,
  DASH_DISTANCE,
  DASH_IFRAME,
  REFLECT_DURATION,
  TIMESTOP_DURATION,
  AFTERIMAGE_DURATION,
  FLAME_CHARGES,
  FLAME_BONUS,
} from './abilities.js';
import { isDown, wasPressed } from './input.js';
import { sfx } from './audio.js';
import { drawCenteredText, drawGlowBar, drawPanel, drawKeyCap, drawSpacedText } from './ui.js';
import { save } from './save.js';
import { getBattleScene, drawSilhouette } from './scene.js';
import { DEBUG_ENABLED, debug, debugActive } from './debug.js';

const FOOT_Y = 448;
const FIGURE_H = 116;
const ARENA_L = 200;
const ARENA_R = 800;
const BODY_W = 40;

// 反射神経ではなく「見てから判断する」テンポ。
// プレイヤーもエコーも同じ振りかぶりで、読み合いの条件を揃える。
const ATTACK_WINDUP = 0.4;
const ATTACK_ACTIVE = 0.12;
const ATTACK_RECOVER = 0.42;
const COMBO_LIMIT = 3; // 連撃は 3 撃まで
const COMBO_WINDOW = 0.9; // これ以内に続けて振れば連撃扱い
const COMBO_RECOVER = 0.9; // 3 撃振り切ったあとの大きな隙
const CAST_TIME = 0.35; // 能力の発動予告（紫の光）
const ACTION_GAP = 0.16; // 行動を終えてから次の行動を出せるまでの間
const ATTACK_RANGE = 82;
const PARRY_ACTIVE = 0.24;
const PARRY_RECOVER = 0.34;
const HITSTUN = 0.3;
const PARRY_STAGGER = 0.6;
const BASE_DAMAGE = 14; // 振りが遅くなったぶん一撃を重く
const MP_REGEN = 9;

const MEMORY_FLASH = 0.5; // 記憶再現中に走る紫ノイズの長さ
const FEINT_TIME = 0.4;
const APPROACH_RATE = 0.5; // ジリジリ間合いを詰める速度倍率
const REACH = ATTACK_RANGE - 10;
const COMBO_GAP = 0.9; // これ以内に続く斬撃は同じコンボ扱い

// 記録フレームから「判断」だけを抜き出す。座標や移動は捨て、
// 攻撃／パリィ／能力の順番と間合いだけを昨日の自分から受け継ぐ。
function ghostActionsFrom(frames) {
  const acts = [];
  let last = 0;
  for (const f of frames) {
    if (f.ability >= 0) {
      acts.push({ type: 'ability', idx: f.ability, gap: f.t - last });
      last = f.t;
    }
    if (f.attack) {
      acts.push({ type: 'attack', gap: f.t - last });
      last = f.t;
    } else if (f.parry) {
      acts.push({ type: 'parry', gap: f.t - last });
      last = f.t;
    }
  }
  return acts;
}

function recoverOf(f) {
  return f.comboCount >= COMBO_LIMIT ? COMBO_RECOVER : ATTACK_RECOVER;
}

function makeFighter(opts) {
  return {
    name: opts.name,
    x: opts.x,
    dir: opts.dir,
    maxHp: opts.maxHp,
    hp: opts.maxHp,
    maxMp: 100,
    mp: 100,
    speed: opts.speed,
    color: opts.color,
    damage: opts.damage,
    isEcho: !!opts.isEcho,
    abilitySet: opts.abilitySet,
    state: 'idle',
    stateTime: 0,
    swingHit: false,
    swingIsDash: false,
    cd: [0, 0, 0, 0, 0],
    fx: {
      iframe: 0,
      reflect: 0,
      afterimage: 0,
      afterimageX: 0,
      frozen: 0,
      timestopSelf: 0,
      flame: 0,
      dashTrail: 0,
      memory: 0,
      telegraph: 0,
    },
    comboCount: 0,
    lastSwingAt: -99,
    castIdx: -1,
    usedAbilities: new Set(),
    lastAfterimageAt: -99,
    dashArmed: 0,
    actLock: 0,
  };
}

export class Battle {
  constructor(config) {
    this.mode = config.mode; // 'story' | 'endless'
    this.day = config.day || 1;
    this.label = config.label || `DAY ${this.day}`;
    this.onEnd = config.onEnd;
    this.time = 0;
    this.introTimer = 1.6;
    this.outroTimer = 0;
    this.result = null;
    this.shake = 0;
    this.hitFlash = 0;

    this.player = makeFighter({
      name: 'YOU',
      x: 300,
      dir: 1,
      maxHp: 100,
      speed: 235,
      color: '#7fe7ff',
      damage: BASE_DAMAGE,
      abilitySet: config.playerAbilities || [],
    });

    this.echo = makeFighter({
      name: config.echoName || 'ECHO',
      x: 660,
      dir: -1,
      maxHp: config.echoHp,
      speed: config.echoSpeed,
      color: config.echoColor || '#ff6b8a',
      damage: config.echoDamage,
      isEcho: true,
      abilitySet: config.echoAbilities || [],
    });

    this.aiWeights = config.aiWeights || [1, 1, 1, 1, 1];
    this.aiReaction = config.aiReaction || 0.35;
    this.aiThink = 0.8;
    this.aiTimer = 0;

    // 実績・戦績トラッキング
    this.playerTookDamage = false;
    this.playerUsedAbility = false;
    this.playerAbilityCounts = [0, 0, 0, 0, 0];
    this.parryStreak = 0;
    this.dodgeDashStreak = 0;
    this.lastEchoDamageSource = 'melee';
    this.timestopKill = false;
    this.mirrorAfterimage = false;
    this.pendingUnlocks = [];

    // 昨日の自分＝前回の戦闘で記録したプレイヤーの操作。
    // 座標ではなく判断を再生するので、間合いが無ければ攻撃せず近づく。
    this.recording = [];
    this.ghost = config.ghost && config.ghost.length ? config.ghost : null;
    this.ghostActions = this.ghost ? ghostActionsFrom(this.ghost) : null;
    this.ghostIndex = 0;
    this.ghostWait = 0;
    this.ghostHold = 0;
    this.comboCut = false;
    this.echoWhiffAt = -99;
    this.baitCount = 0; // 空振り待ち→反撃をされた回数
    this.feintCd = 0;
    this.fightTime = 0;
  }

  finish(result) {
    if (this.result) return;
    this.result = result;
    this.outroTimer = result === 'win' ? 1.4 : 1.8;
  }

  update(dt) {
    this.time += dt;
    getBattleScene().update(dt);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    // 開発用: エコーを瀕死にして撃破後の流れだけ確認する（Ctrl+Shift+K）
    if (DEBUG_ENABLED && wasPressed('debugKill') && !this.result) {
      this.echo.hp = Math.min(this.echo.hp, 1);
    }

    if (wasPressed('back') && !this.result) {
      this.onEnd({ result: 'quit', battle: this });
      return;
    }

    if (this.introTimer > 0) {
      this.introTimer -= dt;
      return;
    }

    if (this.result) {
      this.outroTimer -= dt;
      this.stepFighter(this.player, this.echo, dt, false);
      if (this.outroTimer <= 0) this.onEnd({ result: this.result, battle: this });
      return;
    }

    this.fightTime += dt;
    this.handlePlayer(dt);
    this.handleEcho(dt);
    this.stepFighter(this.player, this.echo, dt, true);
    this.stepFighter(this.echo, this.player, dt, true);
    this.separate();

    if (this.echo.hp <= 0) {
      this.timestopKill = this.player.fx.timestopSelf > 0;
      this.echo.state = 'dead';
      this.finish('win');
    } else if (this.player.hp <= 0) {
      this.player.state = 'dead';
      this.finish('lose');
    }
  }

  canAct(f) {
    return f.fx.frozen <= 0 && f.state !== 'hitstun' && f.state !== 'dead';
  }

  handlePlayer(dt) {
    const p = this.player;
    const frame = {
      t: this.fightTime,
      dt,
      vx: (isDown('left') ? -1 : 0) + (isDown('right') ? 1 : 0),
      attack: wasPressed('attack'),
      parry: wasPressed('parry'),
      ability: -1,
    };
    for (let i = 0; i < 5; i++) {
      if (wasPressed(`ability${i + 1}`)) frame.ability = i;
    }
    this.recording.push(frame);

    if (!this.canAct(p)) return;
    if (p.state === 'idle') {
      let vx = 0;
      if (isDown('left')) vx -= 1;
      if (isDown('right')) vx += 1;
      if (vx !== 0) {
        p.x += vx * p.speed * dt;
        p.dir = vx > 0 ? 1 : -1;
      }
      // 1 フレームに出せる行動は 1 つだけ（攻撃しながら能力は出せない）
      if (wasPressed('attack')) this.startAttack(p);
      else if (wasPressed('parry')) this.startParry(p);
      else {
        for (let i = 0; i < 5; i++) {
          if (wasPressed(`ability${i + 1}`)) {
            this.useAbility(p, this.echo, i);
            break;
          }
        }
      }
    }
  }

  handleEcho(dt) {
    const e = this.echo;
    if (this.feintCd > 0) this.feintCd -= dt;
    if (!this.canAct(e)) return;
    const p = this.player;
    const dist = Math.abs(p.x - e.x);
    e.dir = p.x > e.x ? 1 : -1;

    if (this.ghostActions && this.ghostIndex < this.ghostActions.length) {
      this.stepGhost(dt, dist);
      return;
    }
    this.ghost = null;
    this.runAi(dt, dist);
  }

  runAi(dt, dist) {
    const e = this.echo;
    const p = this.player;

    this.aiTimer -= dt;
    if (e.state === 'idle') {
      if (e.actLock > 0) {
        // 前の行動が抜けきるまでは間合いを取るだけ
        if (dist > ATTACK_RANGE - 8) e.x += e.dir * e.speed * dt * APPROACH_RATE;
        return;
      }
      // 相手の攻撃に反応してパリィ／回避
      if (p.state === 'attack' && p.stateTime < ATTACK_WINDUP && dist < ATTACK_RANGE + 20) {
        if (Math.random() < 0.01 / this.aiReaction + this.day * 0.002) {
          this.startParry(e);
          return;
        }
      }
      if (this.aiTimer <= 0) {
        this.aiTimer = this.aiThink * (0.6 + Math.random() * 0.8);
        const abilityIdx = this.pickAbility(e, dist);
        if (abilityIdx !== -1) {
          this.useAbility(e, p, abilityIdx);
          if (abilityIdx === 0) e.dashArmed = 0.8;
          return;
        }
      }
      if (dist <= ATTACK_RANGE - 8) {
        if (Math.random() < 0.35) this.startAttack(e);
        else e.x -= e.dir * e.speed * dt * 0.5;
      } else {
        e.x += e.dir * e.speed * dt * 0.7;
      }
    }
  }

  // 昨日の判断を今の状況に合わせて再生する。
  // 射程外なら攻撃を出さずに近づき、空振りしそうならコンボを中断して追う。
  stepGhost(dt, dist) {
    const e = this.echo;
    if (e.state !== 'idle') {
      if (
        e.state === 'attack' &&
        !e.swingHit &&
        !this.comboCut &&
        e.stateTime >= ATTACK_WINDUP + ATTACK_ACTIVE &&
        dist > ATTACK_RANGE + 30
      ) {
        this.cutGhostCombo();
      }
      return;
    }

    if (e.actLock > 0) {
      this.approach(dt, dist);
      return;
    }

    if (this.reactNow(dist)) return;

    this.ghostWait -= dt;
    if (this.ghostWait > 0) {
      this.approach(dt, dist);
      return;
    }

    const act = this.ghostActions[this.ghostIndex];
    if (!this.actionFits(act, dist)) {
      // 間合いが合わないので今は出さない。詰めながら少しだけ待つ。
      this.approach(dt, dist);
      this.maybeFeint(act, dist);
      this.ghostHold += dt;
      if (this.ghostHold > 1.4) this.consumeGhost(); // 出せないまま固まらないよう捨てる
      return;
    }

    this.consumeGhost();
    e.fx.memory = MEMORY_FLASH;
    if (act.type === 'attack') this.startAttack(e);
    else if (act.type === 'parry') this.startParry(e);
    else {
      this.useAbility(e, this.player, act.idx);
      if (act.idx === 0) e.dashArmed = 0.8;
    }
  }

  actionFits(act, dist) {
    if (act.type === 'attack') return dist <= REACH;
    if (act.type === 'parry') return this.player.state === 'attack' && dist < ATTACK_RANGE + 30;
    const ab = ABILITIES[act.idx];
    const e = this.echo;
    if (!e.abilitySet.includes(act.idx) || e.cd[act.idx] > 0 || e.mp < ab.cost) return false;
    if (act.idx === 0) return dist > 160; // 瞬歩は距離を潰すために使う
    if (act.idx === 1 || act.idx === 2) return dist < 200;
    if (act.idx === 4) return dist < 240;
    return true;
  }

  consumeGhost() {
    this.ghostIndex++;
    this.ghostHold = 0;
    const next = this.ghostActions[this.ghostIndex];
    // 連打にならないよう、行動と行動の間に必ず間を取る
    this.ghostWait = next ? clamp(next.gap, 0.3, 1.4) : 0;
  }

  // 空振りが確定した連撃は最後まで振らずに切り上げる
  cutGhostCombo() {
    this.comboCut = true;
    while (this.ghostIndex < this.ghostActions.length) {
      const a = this.ghostActions[this.ghostIndex];
      if (a.type !== 'attack' || a.gap > COMBO_GAP) break;
      this.ghostIndex++;
    }
    this.ghostHold = 0;
    this.ghostWait = 0.2;
  }

  // 記憶どおりではなく、今のプレイヤーに反応する分（およそ 3 割）
  reactNow(dist) {
    const e = this.echo;
    const p = this.player;
    if (p.state === 'attack' && p.stateTime < ATTACK_WINDUP && dist < ATTACK_RANGE + 20) {
      if (Math.random() < 0.02 / this.aiReaction) {
        this.startParry(e);
        return true;
      }
    }
    if (dist <= REACH && Math.random() < 0.006) {
      this.startAttack(e);
      return true;
    }
    return false;
  }

  approach(dt, dist) {
    const e = this.echo;
    if (dist <= REACH) {
      e.x -= e.dir * e.speed * dt * 0.25; // 密着しすぎたら少し引く
      return;
    }
    e.x += e.dir * e.speed * dt * APPROACH_RATE;
  }

  // 空振り待ち→反撃を 2 回やられたら、振るふりをして止まる
  maybeFeint(act, dist) {
    if (act.type !== 'attack') return;
    if (this.baitCount < 2 || this.feintCd > 0) return;
    if (dist <= REACH || dist > 260) return;
    if (Math.random() > 0.03) return;
    const e = this.echo;
    e.state = 'feint';
    e.stateTime = 0;
    this.feintCd = 3.5;
  }

  pickAbility(e, dist) {
    const candidates = [];
    for (const idx of e.abilitySet) {
      const ab = ABILITIES[idx];
      if (e.cd[idx] > 0 || e.mp < ab.cost) continue;
      let w = this.aiWeights[idx];
      if (idx === 0) w *= dist > 200 ? 2.2 : 0.5; // 瞬歩は離れているとき
      if (idx === 1) w *= dist < 140 ? 1.6 : 0.4; // 反射は接近戦
      if (idx === 2) w *= dist < 160 ? 1.4 : 0.6;
      if (idx === 3) w *= 1.0;
      if (idx === 4) w *= dist < 200 ? 1.5 : 0.6;
      if (w > 0) candidates.push({ idx, w });
    }
    if (!candidates.length) return -1;
    const total = candidates.reduce((s, c) => s + c.w, 0);
    // 発動しない選択肢も混ぜて連発を防ぐ
    let roll = Math.random() * (total + 2.5);
    for (const c of candidates) {
      roll -= c.w;
      if (roll <= 0) return c.idx;
    }
    return -1;
  }

  startAttack(f) {
    if (f.actLock > 0) return;
    if (this.time - f.lastSwingAt > COMBO_WINDOW) f.comboCount = 0;
    f.comboCount++;
    f.lastSwingAt = this.time;
    f.state = 'attack';
    f.stateTime = 0;
    f.swingHit = false;
    if (f.isEcho) this.comboCut = false;
    f.swingIsDash = f.dashArmed > 0;
    f.dashArmed = 0;
  }

  startParry(f) {
    if (f.actLock > 0) return;
    f.state = 'parry';
    f.stateTime = 0;
  }

  useAbility(f, other, idx) {
    if (!this.canAct(f)) return;
    if (!f.abilitySet.includes(idx)) return;
    // 人間には無理なので、剣を振りながら能力を重ねて出せない
    if (f.state !== 'idle' || f.actLock > 0) return;
    const ab = ABILITIES[idx];
    if (f.cd[idx] > 0 || f.mp < ab.cost) return;

    f.mp -= ab.cost;
    f.cd[idx] = ab.cooldown;
    f.usedAbilities.add(idx);
    sfx.ability();

    if (f === this.player) {
      this.playerUsedAbility = true;
      this.playerAbilityCounts[idx]++;
    }

    // 紫の光と音で予告してから発動する
    f.state = 'cast';
    f.stateTime = 0;
    f.castIdx = idx;
    f.fx.telegraph = CAST_TIME;
  }

  applyAbility(f, other, idx) {
    switch (idx) {
      case 0: // 瞬歩
        f.x = clamp(f.x + f.dir * DASH_DISTANCE, ARENA_L, ARENA_R);
        // 相手を追い越したら振り向く（背後を取ったまま背中を向けない）
        if (other.x !== f.x) f.dir = other.x > f.x ? 1 : -1;
        f.fx.iframe = DASH_IFRAME;
        f.fx.dashTrail = 0.25;
        if (f.isEcho) f.dashArmed = 0.8;
        break;
      case 1: // 反射
        f.fx.reflect = REFLECT_DURATION;
        break;
      case 2: // 時止め
        f.fx.timestopSelf = TIMESTOP_DURATION;
        other.fx.frozen = TIMESTOP_DURATION;
        break;
      case 3: // 残像
        f.fx.afterimage = AFTERIMAGE_DURATION;
        f.fx.afterimageX = f.x;
        f.lastAfterimageAt = this.time;
        if (
          this.player.lastAfterimageAt >= 0 &&
          this.echo.lastAfterimageAt >= 0 &&
          Math.abs(this.player.lastAfterimageAt - this.echo.lastAfterimageAt) <= 0.4
        ) {
          this.mirrorAfterimage = true;
        }
        break;
      case 4: // 炎刃
        f.fx.flame = FLAME_CHARGES;
        break;
      default:
        break;
    }
  }

  stepFighter(f, other, dt, active) {
    for (const key of ['iframe', 'reflect', 'afterimage', 'frozen', 'timestopSelf', 'dashTrail', 'memory', 'telegraph']) {
      if (f.fx[key] > 0) f.fx[key] = Math.max(0, f.fx[key] - dt);
    }
    for (let i = 0; i < f.cd.length; i++) {
      if (f.cd[i] > 0) f.cd[i] = Math.max(0, f.cd[i] - dt);
    }
    if (f.dashArmed > 0) f.dashArmed = Math.max(0, f.dashArmed - dt);
    if (f.actLock > 0) f.actLock = Math.max(0, f.actLock - dt);
    f.mp = Math.min(f.maxMp, f.mp + MP_REGEN * dt);
    f.x = clamp(f.x, ARENA_L, ARENA_R);
    if (!active || f.state === 'dead') return;
    if (f.fx.frozen > 0) return;

    f.stateTime += dt;
    if (f.state === 'attack') {
      const t = f.stateTime;
      const w = ATTACK_WINDUP;
      if (t >= w && t < w + ATTACK_ACTIVE && !f.swingHit) {
        const dist = Math.abs(other.x - f.x);
        const facing = Math.sign(other.x - f.x) === f.dir || dist < 20;
        if (dist <= ATTACK_RANGE && facing) {
          f.swingHit = true;
          this.resolveHit(f, other);
        }
      }
      if (t >= w + ATTACK_ACTIVE + recoverOf(f)) {
        if (f.isEcho && !f.swingHit) this.echoWhiffAt = this.time;
        if (f.isEcho && f.swingIsDash && !f.swingHit) {
          this.dodgeDashStreak++;
          this.checkDodgeStreak();
        }
        f.state = 'idle';
        f.stateTime = 0;
        f.actLock = ACTION_GAP;
        f.swingIsDash = false;
      }
    } else if (f.state === 'cast') {
      if (f.stateTime >= CAST_TIME) {
        const idx = f.castIdx;
        f.castIdx = -1;
        f.state = 'idle';
        f.stateTime = 0;
        f.actLock = ACTION_GAP;
        if (idx >= 0) this.applyAbility(f, other, idx);
      }
    } else if (f.state === 'feint') {
      if (f.stateTime >= FEINT_TIME) {
        f.state = 'idle';
        f.stateTime = 0;
      }
    } else if (f.state === 'parry') {
      if (f.stateTime >= PARRY_ACTIVE + PARRY_RECOVER) {
        f.state = 'idle';
        f.stateTime = 0;
        f.actLock = ACTION_GAP;
      }
    } else if (f.state === 'hitstun') {
      if (f.stateTime >= f.hitstunTime) {
        f.state = 'idle';
        f.stateTime = 0;
      }
    }
  }

  resolveHit(attacker, defender) {
    let damage = attacker.damage;
    let source = 'melee';
    if (attacker.fx.flame > 0) {
      attacker.fx.flame -= 1;
      damage += FLAME_BONUS;
      source = 'flame';
    }

    // 残像が身代わりになる
    if (defender.fx.afterimage > 0) {
      defender.fx.afterimage = 0;
      sfx.parry();
      if (attacker.isEcho && attacker.swingIsDash) {
        attacker.swingIsDash = false;
        this.dodgeDashStreak++;
        this.checkDodgeStreak();
      }
      return;
    }

    // パリィ
    if (defender.state === 'parry' && defender.stateTime <= PARRY_ACTIVE) {
      sfx.parry();
      this.shake = 0.5;
      attacker.state = 'hitstun';
      attacker.stateTime = 0;
      attacker.hitstunTime = PARRY_STAGGER;
      if (defender === this.player) {
        this.parryStreak++;
        if (this.parryStreak >= 5) this.queueUnlock('parry5');
        if (attacker.swingIsDash) {
          attacker.swingIsDash = false;
          this.dodgeDashStreak++;
          this.checkDodgeStreak();
        }
      }
      return;
    }

    // 瞬歩の無敵
    if (defender.fx.iframe > 0) {
      if (attacker.isEcho && attacker.swingIsDash) {
        attacker.swingIsDash = false;
        this.dodgeDashStreak++;
        this.checkDodgeStreak();
      }
      return;
    }

    // 反射
    if (defender.fx.reflect > 0) {
      defender.fx.reflect = 0;
      this.applyDamage(defender, attacker, damage, 'reflect');
      if (attacker.isEcho && attacker.swingIsDash) {
        attacker.swingIsDash = false;
        this.dodgeDashStreak++;
        this.checkDodgeStreak();
      }
      return;
    }

    this.applyDamage(attacker, defender, damage, source);
  }

  applyDamage(attacker, defender, damage, source) {
    if (DEBUG_ENABLED && debug.god && defender === this.player) damage = 0;
    defender.hp = Math.max(0, defender.hp - damage);
    defender.state = 'hitstun';
    defender.stateTime = 0;
    defender.hitstunTime = HITSTUN;
    defender.x = clamp(defender.x + Math.sign(defender.x - attacker.x || 1) * 26, ARENA_L, ARENA_R);
    this.shake = 0.6;
    this.hitFlash = 0.5;
    sfx.hit();

    if (defender === this.player) {
      this.playerTookDamage = true;
      this.parryStreak = 0;
      if (attacker.isEcho && attacker.swingIsDash) {
        attacker.swingIsDash = false;
        this.dodgeDashStreak = 0;
      }
    } else {
      this.lastEchoDamageSource = source;
      // 空振りを待ってから殴られた＝ハメられている
      if (this.time - this.echoWhiffAt < 1.5) this.baitCount++;
    }
  }

  checkDodgeStreak() {
    if (this.dodgeDashStreak >= 3) this.queueUnlock('dodgeDash3');
  }

  queueUnlock(id) {
    if (!this.pendingUnlocks.includes(id)) this.pendingUnlocks.push(id);
  }

  separate() {
    const p = this.player;
    const e = this.echo;
    const dist = e.x - p.x;
    const min = BODY_W;
    if (Math.abs(dist) < min) {
      const push = (min - Math.abs(dist)) / 2;
      const s = dist >= 0 ? 1 : -1;
      p.x = clamp(p.x - s * push, ARENA_L, ARENA_R);
      e.x = clamp(e.x + s * push, ARENA_L, ARENA_R);
    }
  }

  // ---------- 描画 ----------

  draw(g) {
    g.save();
    if (this.shake > 0 && save.settings.shake) {
      g.translate((Math.random() - 0.5) * this.shake * 12, (Math.random() - 0.5) * this.shake * 8);
    }
    this.drawBackground(g);
    this.drawFighter(g, this.echo);
    this.drawFighter(g, this.player);
    g.restore();
    this.drawHud(g);

    if (this.introTimer > 0) {
      g.fillStyle = 'rgba(3,4,8,0.72)';
      g.fillRect(0, 0, 960, 540);
      drawSpacedText(g, this.label, 480, 260, 'bold 48px sans-serif', '#e8eefc', 6);
      drawCenteredText(g, this.mode === 'endless' ? '昨日の自分が来る' : '', 480, 300, '18px sans-serif', '#8fa0bd');
    } else if (this.result === 'win') {
      drawSpacedText(g, 'ECHO 撃破', 480, 250, 'bold 44px sans-serif', '#8fffc4', 6);
    } else if (this.result === 'lose') {
      drawSpacedText(g, '昨日に負けた', 480, 250, 'bold 44px sans-serif', '#ff6b8a', 6);
    }
  }

  drawBackground(g) {
    getBattleScene().draw(g);

    if (this.player.fx.timestopSelf > 0 || this.echo.fx.timestopSelf > 0) {
      g.fillStyle = 'rgba(255,232,107,0.06)';
      g.fillRect(0, 0, 960, 540);
    }
    if (this.hitFlash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.hitFlash * 0.12})`;
      g.fillRect(0, 0, 960, 540);
    }
  }

  drawFighter(g, f) {
    const rim = f.state === 'hitstun' ? '#ffffff' : f.color;
    const figure = (x, alpha, opts = {}) => {
      g.save();
      g.globalAlpha = alpha;
      if (opts.glow !== false) {
        g.shadowColor = rim;
        g.shadowBlur = 14;
      }
      drawSilhouette(g, x, FOOT_Y, FIGURE_H, {
        fill: '#070a11',
        dir: f.dir,
        rim,
        blade: f.fx.flame > 0 ? 'rgba(255,140,70,0.85)' : 'rgba(190,210,240,0.6)',
        raise: opts.raise,
      });
      g.restore();
    };

    // 足元の影と映り込み
    g.save();
    g.globalAlpha = 0.5;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.ellipse(f.x, FOOT_Y + 3, 26, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    if (f.fx.afterimage > 0) figure(f.fx.afterimageX, 0.3);
    if (f.fx.dashTrail > 0) figure(f.x - f.dir * 60, Math.min(0.5, f.fx.dashTrail * 1.6));

    const attacking = f.state === 'attack';
    const w = ATTACK_WINDUP;
    const active = attacking && f.stateTime >= w && f.stateTime < w + ATTACK_ACTIVE;
    figure(f.x, f.fx.frozen > 0 ? 0.6 : 1, { raise: (attacking && !active) || f.state === 'feint' });

    // 昨日の行動を再現している間だけ、身体に紫のノイズが走る
    if (f.fx.memory > 0) {
      const a = f.fx.memory / MEMORY_FLASH;
      g.save();
      g.globalAlpha = 0.65 * a;
      g.fillStyle = '#c46bff';
      g.shadowColor = '#c46bff';
      g.shadowBlur = 12;
      for (let i = 0; i < 7; i++) {
        const yy = FOOT_Y - Math.random() * FIGURE_H;
        g.fillRect(f.x - 26 + (Math.random() - 0.5) * 10, yy, 52, 2);
      }
      g.restore();
    }

    g.save();
    const cy = FOOT_Y - FIGURE_H * 0.5;
    if (f.fx.flame > 0) {
      g.shadowColor = '#ff7a3c';
      g.shadowBlur = 18;
      g.strokeStyle = 'rgba(255,122,60,0.9)';
      g.lineWidth = 2;
      g.strokeRect(f.x - 22, FOOT_Y - FIGURE_H - 6, 44, FIGURE_H + 12);
      g.shadowBlur = 0;
    }
    if (f.fx.reflect > 0) {
      g.strokeStyle = '#9e5cff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(f.x, cy, 58, 0, Math.PI * 2);
      g.stroke();
    }
    if (f.fx.iframe > 0) {
      g.strokeStyle = '#7fe7ff';
      g.lineWidth = 2;
      g.strokeRect(f.x - 26, FOOT_Y - FIGURE_H - 10, 52, FIGURE_H + 20);
    }
    if (attacking) {
      // 振りかぶりの進み具合をアークの太さと大きさで見せる（構えを見て判断できるように）
      const prog = Math.min(1, f.stateTime / w);
      g.strokeStyle = active
        ? f.fx.flame > 0
          ? '#ff7a3c'
          : '#ffffff'
        : f.isEcho
          ? `rgba(196,107,255,${0.25 + prog * 0.55})`
          : `rgba(255,255,255,${0.18 + prog * 0.3})`;
      g.lineWidth = active ? 6 : 2 + prog * 2.5;
      g.beginPath();
      g.arc(
        f.x,
        cy,
        ATTACK_RANGE * (active ? 1 : 0.45 + prog * 0.5),
        f.dir > 0 ? -0.8 : Math.PI - 0.8,
        f.dir > 0 ? 0.8 : Math.PI + 0.8,
      );
      g.stroke();
    }
    if (f.fx.telegraph > 0) {
      // 能力の発動予告。紫の輪が縮んで、消えた瞬間に効果が出る。
      const t = f.fx.telegraph / CAST_TIME;
      g.save();
      g.globalAlpha = 0.85;
      g.shadowColor = '#c46bff';
      g.shadowBlur = 20;
      g.strokeStyle = '#c46bff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(f.x, cy, 30 + t * 46, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    if (f.state === 'parry' && f.stateTime <= PARRY_ACTIVE) {
      g.shadowColor = '#ffe86b';
      g.shadowBlur = 16;
      g.strokeStyle = '#ffe86b';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(f.x + f.dir * 26, cy, 32, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  drawHud(g) {
    const p = this.player;
    const e = this.echo;

    // デバッグ設定を有効にしたまま素の手触りを判定しないよう明示する
    if (debugActive()) {
      g.save();
      g.fillStyle = '#8fffc4';
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'center';
      g.fillText(`DEBUG${debug.god ? ' / 無敵' : ''}`, 480, 76);
      g.restore();
    }

    // 左上: HP / EP
    g.save();
    g.textBaseline = 'middle';
    g.font = '13px sans-serif';
    g.fillStyle = '#cfd6e4';
    g.fillText(`HP ${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`, 24, 24);
    g.fillText(`EP ${Math.ceil(p.mp)} / ${p.maxMp}`, 24, 60);
    g.restore();
    drawGlowBar(g, 24, 32, 300, 10, p.hp / p.maxHp, '#e5344a', '#ff5566');
    drawGlowBar(g, 24, 68, 300, 8, p.mp / p.maxMp, '#3f7bff', '#6da3ff');

    // 右上: エコー
    g.save();
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.font = '13px sans-serif';
    g.fillStyle = '#cfd6e4';
    g.fillText(e.name, 936, 24);
    g.fillText(`HP ${Math.max(0, Math.ceil(e.hp))} / ${e.maxHp}`, 936, 62);
    g.restore();
    drawGlowBar(g, 636, 32, 300, 10, e.hp / e.maxHp, '#7a3cff', '#9e5cff');

    // 中央上: 経過時間と DAY
    const total = Math.floor(this.time);
    const clock = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    drawSpacedText(g, clock, 480, 34, '30px sans-serif', '#e8eefc', 3);
    drawCenteredText(g, '経過時間', 480, 54, '11px sans-serif', '#66738d');
    drawSpacedText(g, `DAY ${this.day}`, 480, 108, 'bold 34px sans-serif', '#e8eefc', 5);
    drawCenteredText(g, this.subtitle(), 480, 132, '13px sans-serif', '#8fa0bd');

    this.drawAbilityList(g);
    this.drawAbilityRing(g);
    this.drawObjective(g);
    this.drawControls(g);

    drawPanel(g, 300, 500, 360, 30, { fill: 'rgba(6,9,15,0.8)', corners: false });
    drawCenteredText(g, this.hintText(), 480, 519, '12px sans-serif', '#93a0b8');
  }

  subtitle() {
    return this.mode === 'endless' ? '昨日の自分' : this.label;
  }

  hintText() {
    if (this.mode === 'endless') {
      return `連続パリィ ${this.parryStreak} / 瞬歩回避 ${this.dodgeDashStreak}`;
    }
    return 'ヒント：紫に光った時、エコーは昨日のあなたの行動を再現している。';
  }

  drawAbilityList(g) {
    const p = this.player;
    for (let i = 0; i < 5; i++) {
      const ab = ABILITIES[i];
      const y = 100 + i * 38;
      const owned = p.abilitySet.includes(i);
      if (!owned) {
        drawPanel(g, 24, y, 210, 32, {
          fill: 'rgba(6,9,15,0.5)',
          border: 'rgba(150,168,196,0.1)',
          corners: false,
        });
        g.save();
        g.textBaseline = 'middle';
        g.strokeStyle = 'rgba(150,168,196,0.14)';
        g.lineWidth = 1;
        g.strokeRect(30.5, y + 4.5, 23, 23);
        g.fillStyle = '#2d3549';
        g.textAlign = 'center';
        g.font = '13px sans-serif';
        g.fillText('🔒', 42, y + 17);
        g.textAlign = 'left';
        g.font = '15px sans-serif';
        g.fillText('？？？', 62, y + 17);
        g.restore();
        continue;
      }
      const ready = p.cd[i] <= 0 && p.mp >= ab.cost;
      drawPanel(g, 24, y, 210, 32, {
        fill: 'rgba(6,9,15,0.72)',
        border: ready ? `${ab.color}` : 'rgba(150,168,196,0.18)',
        glow: ready ? ab.color : null,
        glowBlur: 8,
        corners: false,
      });
      // アイコン枠
      g.save();
      g.strokeStyle = ready ? ab.color : 'rgba(150,168,196,0.25)';
      g.lineWidth = 1;
      g.strokeRect(30.5, y + 4.5, 23, 23);
      g.fillStyle = ready ? ab.color : '#3d4760';
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.font = '13px sans-serif';
      g.fillText(ab.icon, 42, y + 17);
      g.textAlign = 'left';
      g.fillStyle = ready ? '#e8eefc' : '#55617a';
      g.font = '15px sans-serif';
      g.fillText(ab.name, 62, y + 17);
      g.font = '11px sans-serif';
      g.fillStyle = '#66738d';
      g.fillText(p.cd[i] > 0 ? `${p.cd[i].toFixed(1)}s` : `EP ${ab.cost}`, 130, y + 17);
      g.restore();
      drawKeyCap(g, 204, y + 6, String(i + 1), { height: 20 });
    }
  }

  drawAbilityRing(g) {
    const p = this.player;
    const cx = 872;
    const cy = 452;
    const r = 58;
    const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (let i = 0; i < 5; i++) {
      const ab = ABILITIES[i];
      const owned = p.abilitySet.includes(i);
      const ready = owned && p.cd[i] <= 0 && p.mp >= ab.cost;
      const x = i === 4 ? cx : cx + Math.cos(angles[i]) * r;
      const y = i === 4 ? cy : cy + Math.sin(angles[i]) * r;
      const s = i === 4 ? 17 : 22;

      g.save();
      g.translate(x, y);
      g.rotate(Math.PI / 4);
      if (ready) {
        g.shadowColor = ab.color;
        g.shadowBlur = 14;
      }
      g.fillStyle = ready ? 'rgba(12,16,26,0.92)' : 'rgba(8,10,16,0.8)';
      g.fillRect(-s, -s, s * 2, s * 2);
      g.strokeStyle = ready ? ab.color : owned ? 'rgba(150,168,196,0.25)' : 'rgba(150,168,196,0.12)';
      g.lineWidth = 2;
      g.strokeRect(-s, -s, s * 2, s * 2);
      g.restore();

      g.save();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = ready ? ab.color : owned ? '#3d4760' : '#2d3549';
      g.font = `${i === 4 ? 13 : 16}px sans-serif`;
      g.fillText(owned ? ab.icon : '🔒', x, y - 3);
      g.fillStyle = ready ? '#cfd6e4' : '#3d4760';
      g.font = '10px sans-serif';
      g.fillText(String(i + 1), x, y + s - 4);
      g.restore();
    }
  }

  drawObjective(g) {
    const x = 762;
    const y = 96;
    drawPanel(g, x, y, 174, 62, { fill: 'rgba(6,9,15,0.78)' });
    g.save();
    g.textBaseline = 'middle';
    g.fillStyle = '#8fa0bd';
    g.font = '12px sans-serif';
    g.fillText('目標', x + 14, y + 18);
    g.fillStyle = '#e8eefc';
    g.font = '14px sans-serif';
    g.fillText(this.mode === 'endless' ? `DAY ${this.day} を生き残る` : '昨日の自分を倒す', x + 14, y + 44);
    g.restore();
  }

  drawControls(g) {
    const rows = [
      ['J', '攻撃'],
      ['K', 'ガード'],
      ...(this.player.abilitySet.length ? [['1-5', '能力']] : []),
      ['← →', '移動'],
      ['Esc', 'リタイア'],
    ];
    g.save();
    g.textBaseline = 'middle';
    rows.forEach(([key, label], i) => {
      const y = 352 + i * 30;
      const w = drawKeyCap(g, 24, y - 10, key);
      g.fillStyle = '#8fa0bd';
      g.font = '13px sans-serif';
      g.fillText(label, 24 + w + 10, y);
    });
    g.restore();
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

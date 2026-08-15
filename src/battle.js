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
import { drawBar, drawCenteredText } from './ui.js';
import { save } from './save.js';

const GROUND_Y = 372;
const ARENA_L = 70;
const ARENA_R = 890;
const BODY_W = 34;
const BODY_H = 64;

const ATTACK_WINDUP = 0.13;
const ATTACK_ACTIVE = 0.09;
const ATTACK_RECOVER = 0.2;
const ATTACK_RANGE = 82;
const PARRY_ACTIVE = 0.18;
const PARRY_RECOVER = 0.34;
const HITSTUN = 0.26;
const PARRY_STAGGER = 0.6;
const BASE_DAMAGE = 11;
const MP_REGEN = 9;

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
    },
    usedAbilities: new Set(),
    lastAfterimageAt: -99,
    dashArmed: 0,
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
      abilitySet: [0, 1, 2, 3, 4],
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
    this.aiThink = 0.4;
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
  }

  finish(result) {
    if (this.result) return;
    this.result = result;
    this.outroTimer = result === 'win' ? 1.4 : 1.8;
  }

  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 3);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

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
    if (!this.canAct(p)) return;
    if (p.state === 'idle') {
      let vx = 0;
      if (isDown('left')) vx -= 1;
      if (isDown('right')) vx += 1;
      if (vx !== 0) {
        p.x += vx * p.speed * dt;
        p.dir = vx > 0 ? 1 : -1;
      }
      if (wasPressed('attack')) this.startAttack(p);
      else if (wasPressed('parry')) this.startParry(p);
    }
    for (let i = 0; i < 5; i++) {
      if (wasPressed(`ability${i + 1}`)) this.useAbility(p, this.echo, i);
    }
  }

  handleEcho(dt) {
    const e = this.echo;
    if (!this.canAct(e)) return;
    const p = this.player;
    const dist = Math.abs(p.x - e.x);
    e.dir = p.x > e.x ? 1 : -1;

    this.aiTimer -= dt;
    if (e.state === 'idle') {
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
        if (Math.random() < 0.5) this.startAttack(e);
        else e.x -= e.dir * e.speed * dt * 0.6;
      } else {
        e.x += e.dir * e.speed * dt;
      }
    }
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
    f.state = 'attack';
    f.stateTime = 0;
    f.swingHit = false;
    f.swingIsDash = f.dashArmed > 0;
    f.dashArmed = 0;
  }

  startParry(f) {
    f.state = 'parry';
    f.stateTime = 0;
  }

  useAbility(f, other, idx) {
    if (!this.canAct(f)) return;
    if (!f.abilitySet.includes(idx)) return;
    if (f.state !== 'idle' && !(f.state === 'attack' && idx === 0)) return;
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

    switch (idx) {
      case 0: // 瞬歩
        f.x = clamp(f.x + f.dir * DASH_DISTANCE, ARENA_L, ARENA_R);
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
    for (const key of ['iframe', 'reflect', 'afterimage', 'frozen', 'timestopSelf', 'dashTrail']) {
      if (f.fx[key] > 0) f.fx[key] = Math.max(0, f.fx[key] - dt);
    }
    for (let i = 0; i < f.cd.length; i++) {
      if (f.cd[i] > 0) f.cd[i] = Math.max(0, f.cd[i] - dt);
    }
    if (f.dashArmed > 0) f.dashArmed = Math.max(0, f.dashArmed - dt);
    f.mp = Math.min(f.maxMp, f.mp + MP_REGEN * dt);
    f.x = clamp(f.x, ARENA_L, ARENA_R);
    if (!active || f.state === 'dead') return;
    if (f.fx.frozen > 0) return;

    f.stateTime += dt;
    if (f.state === 'attack') {
      const t = f.stateTime;
      if (t >= ATTACK_WINDUP && t < ATTACK_WINDUP + ATTACK_ACTIVE && !f.swingHit) {
        const dist = Math.abs(other.x - f.x);
        const facing = Math.sign(other.x - f.x) === f.dir || dist < 20;
        if (dist <= ATTACK_RANGE && facing) {
          f.swingHit = true;
          this.resolveHit(f, other);
        }
      }
      if (t >= ATTACK_WINDUP + ATTACK_ACTIVE + ATTACK_RECOVER) {
        if (f.isEcho && f.swingIsDash && !f.swingHit) {
          this.dodgeDashStreak++;
          this.checkDodgeStreak();
        }
        f.state = 'idle';
        f.stateTime = 0;
        f.swingIsDash = false;
      }
    } else if (f.state === 'parry') {
      if (f.stateTime >= PARRY_ACTIVE + PARRY_RECOVER) {
        f.state = 'idle';
        f.stateTime = 0;
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
      drawCenteredText(g, this.label, 480, 260, 'bold 54px sans-serif', '#e8eefc');
      drawCenteredText(g, this.mode === 'endless' ? '昨日の自分が来る' : '', 480, 306, '18px sans-serif', '#8fa0bd');
    } else if (this.result === 'win') {
      drawCenteredText(g, 'ECHO 撃破', 480, 250, 'bold 46px sans-serif', '#8fffc4');
    } else if (this.result === 'lose') {
      drawCenteredText(g, '昨日に負けた', 480, 250, 'bold 46px sans-serif', '#ff6b8a');
    }
  }

  drawBackground(g) {
    const grd = g.createLinearGradient(0, 0, 0, 540);
    grd.addColorStop(0, '#0a0f1c');
    grd.addColorStop(1, '#05060a');
    g.fillStyle = grd;
    g.fillRect(0, 0, 960, 540);

    if (this.player.fx.timestopSelf > 0 || this.echo.fx.timestopSelf > 0) {
      g.fillStyle = 'rgba(255,232,107,0.06)';
      g.fillRect(0, 0, 960, 540);
    }
    if (this.hitFlash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.hitFlash * 0.12})`;
      g.fillRect(0, 0, 960, 540);
    }

    g.strokeStyle = '#1b2333';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, GROUND_Y + BODY_H);
    g.lineTo(960, GROUND_Y + BODY_H);
    g.stroke();

    g.strokeStyle = '#121a29';
    g.lineWidth = 1;
    for (let x = 0; x < 960; x += 48) {
      g.beginPath();
      g.moveTo(x, GROUND_Y + BODY_H);
      g.lineTo(x - 60, 540);
      g.stroke();
    }
  }

  drawFighter(g, f) {
    const y = GROUND_Y;
    if (f.fx.afterimage > 0) {
      g.save();
      g.globalAlpha = 0.35;
      g.fillStyle = f.color;
      g.fillRect(f.fx.afterimageX - BODY_W / 2, y, BODY_W, BODY_H);
      g.restore();
    }
    if (f.fx.dashTrail > 0) {
      g.save();
      g.globalAlpha = f.fx.dashTrail * 1.6;
      g.fillStyle = f.color;
      g.fillRect(f.x - f.dir * 60 - BODY_W / 2, y, BODY_W, BODY_H);
      g.restore();
    }

    g.save();
    if (f.fx.frozen > 0) g.globalAlpha = 0.65;
    g.fillStyle = f.state === 'hitstun' ? '#ffffff' : f.color;
    g.fillRect(f.x - BODY_W / 2, y, BODY_W, BODY_H);

    // 目
    g.fillStyle = '#05060a';
    g.fillRect(f.x - 6 + f.dir * 6, y + 14, 10, 5);

    if (f.fx.flame > 0) {
      g.strokeStyle = '#ff7a3c';
      g.lineWidth = 3;
      g.strokeRect(f.x - BODY_W / 2 - 3, y - 3, BODY_W + 6, BODY_H + 6);
    }
    if (f.fx.reflect > 0) {
      g.strokeStyle = '#9e5cff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(f.x, y + BODY_H / 2, 52, 0, Math.PI * 2);
      g.stroke();
    }
    if (f.fx.iframe > 0) {
      g.strokeStyle = '#7fe7ff';
      g.lineWidth = 2;
      g.strokeRect(f.x - BODY_W / 2 - 6, y - 6, BODY_W + 12, BODY_H + 12);
    }

    if (f.state === 'attack') {
      const t = f.stateTime;
      const active = t >= ATTACK_WINDUP && t < ATTACK_WINDUP + ATTACK_ACTIVE;
      g.strokeStyle = active ? (f.fx.flame > 0 ? '#ff7a3c' : '#ffffff') : 'rgba(255,255,255,0.25)';
      g.lineWidth = active ? 6 : 2;
      g.beginPath();
      g.arc(f.x, y + BODY_H / 2, ATTACK_RANGE * (active ? 1 : 0.7), f.dir > 0 ? -0.8 : Math.PI - 0.8, f.dir > 0 ? 0.8 : Math.PI + 0.8);
      g.stroke();
    }
    if (f.state === 'parry' && f.stateTime <= PARRY_ACTIVE) {
      g.strokeStyle = '#ffe86b';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(f.x + f.dir * 26, y + BODY_H / 2, 30, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  drawHud(g) {
    const p = this.player;
    const e = this.echo;
    drawBar(g, 40, 34, 340, 18, p.hp / p.maxHp, '#7fe7ff');
    drawBar(g, 40, 58, 260, 8, p.mp / p.maxMp, '#4d7dff');
    drawBar(g, 580, 34, 340, 18, e.hp / e.maxHp, '#ff6b8a');

    g.fillStyle = '#93a0b8';
    g.font = '13px sans-serif';
    g.fillText('YOU', 40, 28);
    g.textAlign = 'right';
    g.fillText(e.name, 920, 28);
    g.textAlign = 'left';

    drawCenteredText(g, this.label, 480, 40, 'bold 20px sans-serif', '#cfd6e4');
    if (this.mode === 'endless') {
      drawCenteredText(g, `連続パリィ ${this.parryStreak} / 瞬歩回避 ${this.dodgeDashStreak}`, 480, 62, '12px sans-serif', '#55617a');
    }

    // 能力スロット
    const slotW = 92;
    const startX = 480 - (slotW * 5 + 40) / 2;
    for (let i = 0; i < 5; i++) {
      const ab = ABILITIES[i];
      const x = startX + i * (slotW + 10);
      const y = 470;
      const ready = p.cd[i] <= 0 && p.mp >= ab.cost;
      g.fillStyle = 'rgba(12,16,26,0.9)';
      g.fillRect(x, y, slotW, 44);
      g.strokeStyle = ready ? ab.color : '#2c3546';
      g.lineWidth = 2;
      g.strokeRect(x, y, slotW, 44);
      g.fillStyle = ready ? '#e8eefc' : '#55617a';
      g.font = 'bold 15px sans-serif';
      g.fillText(`${i + 1} ${ab.name}`, x + 10, y + 22);
      g.font = '11px sans-serif';
      g.fillStyle = '#7b8aa5';
      g.fillText(p.cd[i] > 0 ? `${p.cd[i].toFixed(1)}s` : `MP ${ab.cost}`, x + 10, y + 37);
    }
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

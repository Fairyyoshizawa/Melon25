// 5つの能力。エコーもプレイヤーも同じ定義を使う。
export const ABILITIES = [
  { id: 'shunpo', name: '瞬歩', icon: '⚡', cost: 12, cooldown: 1.2, color: '#7fe7ff' },
  { id: 'reflect', name: '反射', icon: '✳', cost: 22, cooldown: 4.0, color: '#9e5cff' },
  { id: 'timestop', name: '時止め', icon: '◷', cost: 38, cooldown: 8.0, color: '#ffe86b' },
  { id: 'afterimage', name: '残像', icon: '⧉', cost: 18, cooldown: 3.5, color: '#8fffc4' },
  { id: 'flame', name: '炎刃', icon: '🔥', cost: 26, cooldown: 5.0, color: '#ff7a3c' },
];

export const ABILITY_INDEX = ABILITIES.reduce((acc, a, i) => {
  acc[a.id] = i;
  return acc;
}, {});

export const DASH_DISTANCE = 170;
export const DASH_IFRAME = 0.22;
export const REFLECT_DURATION = 1.2;
export const TIMESTOP_DURATION = 1.4;
export const AFTERIMAGE_DURATION = 2.2;
export const FLAME_CHARGES = 3;
export const FLAME_BONUS = 10;

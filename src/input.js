const down = new Set();
const pressedThisFrame = new Map();

const CODE_ALIASES = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  KeyJ: 'attack',
  KeyK: 'parry',
  Space: 'attack',
  Enter: 'confirm',
  Escape: 'back',
  Digit1: 'ability1',
  Digit2: 'ability2',
  Digit3: 'ability3',
  Digit4: 'ability4',
  Digit5: 'ability5',
  F1: 'debug',
  F2: 'debugKill',
};

function nameOf(code) {
  return CODE_ALIASES[code] || null;
}

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    const name = nameOf(e.code);
    if (!name) return;
    e.preventDefault();
    if (!down.has(name)) pressedThisFrame.set(name, (pressedThisFrame.get(name) || 0) + 1);
    down.add(name);
  });
  target.addEventListener('keyup', (e) => {
    const name = nameOf(e.code);
    if (!name) return;
    e.preventDefault();
    down.delete(name);
  });
  target.addEventListener('blur', () => {
    down.clear();
    pressedThisFrame.clear();
  });
}

export function isDown(name) {
  return down.has(name);
}

export function wasPressed(name) {
  return (pressedThisFrame.get(name) || 0) > 0;
}

// 1フレーム中に複数回押された入力も取りこぼさない
export function pressCount(name) {
  return pressedThisFrame.get(name) || 0;
}

export function endFrame() {
  pressedThisFrame.clear();
}

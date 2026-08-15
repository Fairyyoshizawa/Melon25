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
};

// ブラウザのショートカットと衝突しない組み合わせだけをデバッグ用に割り当てる
const DEBUG_CHORDS = {
  KeyD: 'debug', // Ctrl+Shift+D: デバッグメニュー
  KeyK: 'debugKill', // Ctrl+Shift+K: エコーの HP を 1 に
};

function nameOf(e) {
  if (e.ctrlKey && e.shiftKey) return DEBUG_CHORDS[e.code] || null;
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  return CODE_ALIASES[e.code] || null;
}

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    const name = nameOf(e);
    if (!name) return;
    e.preventDefault();
    if (!down.has(name)) pressedThisFrame.set(name, (pressedThisFrame.get(name) || 0) + 1);
    down.add(name);
  });
  target.addEventListener('keyup', (e) => {
    const name = nameOf(e);
    if (!name) {
      // 修飾キーを離した瞬間に押しっぱなし扱いが残らないようにする
      down.delete(CODE_ALIASES[e.code]);
      return;
    }
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

const down = new Set();
const pressedThisFrame = new Set();

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

function nameOf(code) {
  return CODE_ALIASES[code] || null;
}

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    const name = nameOf(e.code);
    if (!name) return;
    e.preventDefault();
    if (!down.has(name)) pressedThisFrame.add(name);
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
  return pressedThisFrame.has(name);
}

export function endFrame() {
  pressedThisFrame.clear();
}

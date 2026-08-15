import { ACHIEVEMENTS } from './achievements.js';

const KEY = 'echo.save.v1';

const DEFAULT_SAVE = {
  endlessUnlocked: false,
  perfectEchoCleared: false,
  bestDay: 0,
  achievements: {},
  settings: { sound: true, shake: true },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const save = load();

function load() {
  const data = clone(DEFAULT_SAVE);
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    return data;
  }
  if (!raw) return data;
  try {
    const parsed = JSON.parse(raw);
    data.endlessUnlocked = !!parsed.endlessUnlocked;
    data.perfectEchoCleared = !!parsed.perfectEchoCleared;
    data.bestDay = Number(parsed.bestDay) || 0;
    if (parsed.achievements && typeof parsed.achievements === 'object') {
      for (const a of ACHIEVEMENTS) {
        if (parsed.achievements[a.id]) data.achievements[a.id] = parsed.achievements[a.id];
      }
    }
    if (parsed.settings) {
      data.settings.sound = parsed.settings.sound !== false;
      data.settings.shake = parsed.settings.shake !== false;
    }
  } catch (e) {
    return clone(DEFAULT_SAVE);
  }
  return data;
}

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch (e) {
    /* localStorage 不可の環境ではセッション内のみ保持 */
  }
}

export function unlockEndless() {
  save.endlessUnlocked = true;
  save.perfectEchoCleared = true;
  persist();
}

export function isUnlocked(id) {
  return !!save.achievements[id];
}

export function unlockAchievement(id) {
  if (save.achievements[id]) return false;
  save.achievements[id] = Date.now();
  persist();
  return true;
}

export function recordDay(day) {
  if (day > save.bestDay) {
    save.bestDay = day;
    persist();
  }
}

export function unlockedCount() {
  return ACHIEVEMENTS.filter((a) => isUnlocked(a.id)).length;
}

export function resetSave() {
  const fresh = clone(DEFAULT_SAVE);
  Object.assign(save, fresh);
  persist();
}

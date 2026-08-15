import { ACHIEVEMENTS } from './achievements.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LEGACY_KEY = 'echo.save.v1';
const DEVICE_ID_KEY = 'echo.device.v1';

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

let createClientFn = null;
let supabase = null;
let deviceId = null;
let fallback = false;
let persistQueued = false;

export const save = clone(DEFAULT_SAVE);

function makeDeviceId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function getDeviceId() {
  if (deviceId) return deviceId;
  let id = null;
  try {
    id = localStorage.getItem(DEVICE_ID_KEY);
  } catch (e) {
    // localStorage unavailable (e.g. file://)
  }
  if (!id) {
    id = makeDeviceId();
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch (e) {
      // ignore
    }
  }
  deviceId = id;
  return id;
}

async function loadClient() {
  if (createClientFn) return;
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  createClientFn = mod.createClient;
}

async function ensureClient() {
  if (supabase) return;
  await loadClient();
  const id = getDeviceId();
  supabase = createClientFn(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-device-id': id } },
  });
}

function fromRow(row) {
  const data = clone(DEFAULT_SAVE);
  data.endlessUnlocked = !!row.endless_unlocked;
  data.perfectEchoCleared = !!row.perfect_echo_cleared;
  data.bestDay = Number(row.best_day) || 0;
  if (row.achievements && typeof row.achievements === 'object') {
    for (const a of ACHIEVEMENTS) {
      if (row.achievements[a.id]) data.achievements[a.id] = row.achievements[a.id];
    }
  }
  if (row.settings) {
    data.settings.sound = row.settings.sound !== false;
    data.settings.shake = row.settings.shake !== false;
  }
  return data;
}

function toRow(data) {
  return {
    device_id: deviceId,
    endless_unlocked: !!data.endlessUnlocked,
    perfect_echo_cleared: !!data.perfectEchoCleared,
    best_day: Number(data.bestDay) || 0,
    achievements: clone(data.achievements),
    settings: clone(data.settings),
    updated_at: new Date().toISOString(),
  };
}

function loadLegacy() {
  const data = clone(DEFAULT_SAVE);
  let raw = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
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
    return null;
  }
  return data;
}

function storeLegacy() {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(save));
  } catch (e) {
    // ignore
  }
}

export async function initSave() {
  try {
    await ensureClient();
    const { data, error } = await supabase.from('saves').select('*').eq('device_id', deviceId).maybeSingle();
    if (error) throw error;
    if (data) {
      Object.assign(save, fromRow(data));
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch (e) {
        // ignore
      }
      return;
    }
    const legacy = loadLegacy();
    if (legacy) Object.assign(save, legacy);
    const { error: insertError } = await supabase.from('saves').insert(toRow(save));
    if (insertError) throw insertError;
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      // ignore
    }
  } catch (e) {
    fallback = true;
    const legacy = loadLegacy();
    if (legacy) Object.assign(save, legacy);
  }
}

async function doPersist() {
  if (fallback) {
    storeLegacy();
    return;
  }
  try {
    await ensureClient();
    const { error } = await supabase.from('saves').upsert(toRow(save), { onConflict: 'device_id' });
    if (error) throw error;
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      // ignore
    }
  } catch (e) {
    fallback = true;
    storeLegacy();
  }
}

export function persist() {
  if (persistQueued) return;
  persistQueued = true;
  const flush = () => {
    persistQueued = false;
    doPersist();
  };
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(flush);
  } else {
    Promise.resolve().then(flush);
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

export async function resetSave() {
  const fresh = clone(DEFAULT_SAVE);
  Object.assign(save, fresh);
  await persist();
}

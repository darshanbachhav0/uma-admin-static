/**
 * Per-browser console preferences (no personal data — safe for localStorage).
 */
const KEY = 'uma.prefs';

const DEFAULTS = {
  /** Mask national IDs in tables by default; reveal per row on demand. */
  maskDni: true,
  /** Rows per page in the registrations and users tables. */
  pageSize: 50,
};

let cache = null;

function read() {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(cache, JSON.parse(raw));
  } catch (error) {
    console.warn('[prefs] no se pudieron leer las preferencias', error);
  }
  return cache;
}

export function getPref(name) {
  const prefs = read();
  return name in prefs ? prefs[name] : DEFAULTS[name];
}

export function setPref(name, value) {
  const prefs = read();
  prefs[name] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn('[prefs] no se pudieron guardar las preferencias', error);
  }
  return value;
}

export function allPrefs() {
  return { ...read() };
}

/**
 * Appearance: theme (claro/oscuro/sistema), sidebar layout and interface
 * density. All three are per-browser preferences stored in `localStorage` and
 * applied as attributes on `<html>`, which the stylesheets key off of.
 *
 * `index.html` runs a small inline script before any stylesheet loads that
 * mirrors `resolveTheme()` below, so the correct theme is already in place on
 * first paint — there is no flash of the light theme before this module runs.
 */

const THEME_KEY = 'uma.theme';
const DENSITY_KEY = 'uma.density';
const COLLAPSE_KEY = 'uma.sidebar.collapsed';

export const THEMES = Object.freeze({ LIGHT: 'light', DARK: 'dark', SYSTEM: 'system' });
export const DENSITIES = Object.freeze({ COMFORTABLE: 'comfortable', COMPACT: 'compact' });

const systemQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let systemListenerAttached = false;

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable (private mode, etc.) */ }
}

/** Stored theme preference: 'light' | 'dark' | 'system'. Defaults to 'system'. */
export function getThemePreference() {
  const stored = safeGet(THEME_KEY);
  return stored === THEMES.LIGHT || stored === THEMES.DARK ? stored : THEMES.SYSTEM;
}

/** Resolve 'system' to the OS/browser preference; otherwise pass through. */
function resolveTheme(preference) {
  if (preference === THEMES.SYSTEM) {
    return systemQuery && systemQuery.matches ? THEMES.DARK : THEMES.LIGHT;
  }
  return preference;
}

/** Apply a theme preference immediately and persist it. */
export function setThemePreference(preference) {
  const value = [THEMES.LIGHT, THEMES.DARK, THEMES.SYSTEM].includes(preference) ? preference : THEMES.SYSTEM;
  safeSet(THEME_KEY, value);
  applyResolvedTheme(resolveTheme(value));
  ensureSystemListener();
  return value;
}

function applyResolvedTheme(resolved) {
  document.documentElement.setAttribute('data-theme', resolved);
}

function ensureSystemListener() {
  if (systemListenerAttached || !systemQuery) return;
  systemListenerAttached = true;
  const onChange = () => {
    if (getThemePreference() === THEMES.SYSTEM) applyResolvedTheme(resolveTheme(THEMES.SYSTEM));
  };
  if (typeof systemQuery.addEventListener === 'function') systemQuery.addEventListener('change', onChange);
  else if (typeof systemQuery.addListener === 'function') systemQuery.addListener(onChange); // Safari < 14
}

/** Stored density preference: 'comfortable' | 'compact'. */
export function getDensityPreference() {
  return safeGet(DENSITY_KEY) === DENSITIES.COMPACT ? DENSITIES.COMPACT : DENSITIES.COMFORTABLE;
}

export function setDensityPreference(preference) {
  const value = preference === DENSITIES.COMPACT ? DENSITIES.COMPACT : DENSITIES.COMFORTABLE;
  safeSet(DENSITY_KEY, value);
  if (value === DENSITIES.COMPACT) document.documentElement.setAttribute('data-density', 'compact');
  else document.documentElement.removeAttribute('data-density');
  return value;
}

/** Stored sidebar-collapsed preference, shared with `core/shell.js`. */
export function getSidebarCollapsed() {
  return safeGet(COLLAPSE_KEY) === '1';
}

export function setSidebarCollapsed(collapsed) {
  safeSet(COLLAPSE_KEY, collapsed ? '1' : '0');
  document.dispatchEvent(new CustomEvent('uma:sidebar-collapse-change', { detail: { collapsed } }));
  return collapsed;
}

/**
 * Apply every stored appearance preference. Called once from `main.js` after
 * the inline bootstrap script has already set the initial attributes, so this
 * mainly wires up the live "sistema" listener for the rest of the session.
 */
export function initTheme() {
  applyResolvedTheme(resolveTheme(getThemePreference()));
  ensureSystemListener();
  if (getDensityPreference() === DENSITIES.COMPACT) document.documentElement.setAttribute('data-density', 'compact');
}

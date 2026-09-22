/**
 * Hash router.
 *
 * Hash routes keep the app deployable as a plain static site (Render) with no
 * server rewrite rules. Each route module exports `mount(container, context)`
 * and returns an optional cleanup function that the router calls on exit —
 * that is where database listeners are released.
 */
import { closeAllOverlays } from '../ui/overlay.js';
import { closeOpenMenu } from '../ui/menu.js';

const routes = new Map();
let container = null;
let currentRoute = null;
let currentCleanup = null;
let onRouteChange = null;
let started = false;

/**
 * @param {string} path e.g. '/eventos'
 * @param {{title:string, subtitle?:string, load:() => Promise<{mount:Function}>}} definition
 */
export function registerRoute(path, definition) {
  routes.set(path, definition);
}

export function getRoutes() {
  return [...routes.entries()].map(([path, definition]) => ({ path, ...definition }));
}

export function getCurrentPath() {
  return currentRoute ? currentRoute.path : null;
}

/** Parse `#/eventos?filtro=x` into a path and query params. */
export function parseHash(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return {
    path: normalized.replace(/\/+$/, '') || '/',
    params: new URLSearchParams(queryString),
  };
}

/** Navigate, optionally with query params. */
export function navigate(path, params) {
  const query = params ? new URLSearchParams(params).toString() : '';
  const target = `#${path}${query ? `?${query}` : ''}`;
  if (window.location.hash === target) {
    handleRoute();
    return;
  }
  window.location.hash = target;
}

export function start({ mountPoint, fallback = '/', onChange }) {
  container = mountPoint;
  onRouteChange = onChange;
  if (!started) {
    window.addEventListener('hashchange', handleRoute);
    started = true;
  }
  const { path } = parseHash();
  if (!routes.has(path)) {
    navigate(fallback);
    return;
  }
  handleRoute();
}

export function stop() {
  runCleanup();
  currentRoute = null;
}

function runCleanup() {
  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (error) { console.error('[router] error al desmontar la vista', error); }
  }
  currentCleanup = null;
}

let mountToken = 0;

async function handleRoute() {
  if (!container) return;
  const { path, params } = parseHash();
  const definition = routes.get(path);

  if (!definition) {
    navigate('/');
    return;
  }

  const token = ++mountToken;
  closeOpenMenu();
  closeAllOverlays();
  runCleanup();

  currentRoute = { path, ...definition };
  if (typeof onRouteChange === 'function') onRouteChange(currentRoute, params);

  container.textContent = '';
  container.scrollIntoView?.({ block: 'start' });
  window.scrollTo({ top: 0, behavior: 'auto' });

  try {
    const module = await definition.load();
    if (token !== mountToken) return; // A newer navigation won.
    currentCleanup = module.mount(container, { params, path, navigate }) || null;
  } catch (error) {
    if (token !== mountToken) return;
    console.error(`[router] no se pudo cargar la vista ${path}`, error);
    const { errorState } = await import('../ui/states.js');
    container.textContent = '';
    container.appendChild(errorState({
      title: 'No se pudo abrir esta sección',
      text: 'Recarga la página. Si el problema continúa, contacta al equipo de sistemas.',
    }));
  }
}

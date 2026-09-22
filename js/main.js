/**
 * Entry point.
 *
 * Owns the top-level screen state (booting / login / no access / console) so
 * protected content is only ever built once the administrator's role has been
 * resolved — there is no flash of admin UI while auth is still loading.
 */
import { h, replaceChildren } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { button } from './ui/controls.js';
import { notify } from './ui/toast.js';
import { closeAllOverlays } from './ui/overlay.js';
import { configError } from './core/firebase.js';
import { startSession, onSession, signOut } from './core/session.js';
import { renderShell, syncActiveNav, destroyShell } from './core/shell.js';
import { registerRoute, start as startRouter, stop as stopRouter } from './core/router.js';
import { renderLogin } from './pages/login.js';

const ROUTES = [
  { path: '/', title: 'Dashboard', subtitle: 'Resumen de eventos e inscripciones', load: () => import('./pages/dashboard.js') },
  { path: '/eventos', title: 'Eventos', subtitle: 'Crea y administra los eventos institucionales', load: () => import('./pages/events.js') },
  { path: '/inscripciones', title: 'Inscripciones', subtitle: 'Inscritos de todos los eventos', load: () => import('./pages/registrations.js') },
];

ROUTES.forEach(({ path, ...definition }) => registerRoute(path, definition));

const root = document.getElementById('app');
let screen = null;
let routerRunning = false;

function showScreen(name, render) {
  if (screen === name && name !== 'app') return;
  screen = name;
  closeAllOverlays();
  if (name !== 'app' && routerRunning) {
    stopRouter();
    destroyShell();
    routerRunning = false;
  }
  render();
}

function renderBoot() {
  replaceChildren(root, h('div', { class: 'boot', role: 'status', 'aria-live': 'polite' },
    h('img', { class: 'boot__logo', src: 'assets/uma-logo.jpg', alt: 'Universidad María Auxiliadora' }),
    h('span', { class: 'spinner', style: { color: 'var(--text-tertiary)' } }),
    h('p', { class: 'boot__text', text: 'Verificando tu sesión…' })));
  document.title = 'UMA Admin';
}

function renderConfigError(message) {
  document.title = 'Configuración incompleta · UMA Admin';
  replaceChildren(root, h('div', { class: 'denied' },
    h('section', { class: 'card denied__card' },
      h('span', { class: 'overlay__icon overlay__icon--danger', style: { margin: '0 auto 16px' } },
        icon('alert-triangle', { size: 22 })),
      h('h1', { style: { 'font-size': 'var(--text-xl)', 'margin-bottom': '8px' }, text: 'Configuración incompleta' }),
      h('p', { class: 'text-secondary', text: message }))));
}

function renderNoAccess(session) {
  const email = (session.user && session.user.email) || '';
  document.title = 'Sin acceso · UMA Admin';
  replaceChildren(root, h('div', { class: 'denied' },
    h('section', { class: 'card denied__card' },
      h('span', { class: 'overlay__icon overlay__icon--warning', style: { margin: '0 auto 16px' } },
        icon('shield', { size: 22 })),
      h('h1', { style: { 'font-size': 'var(--text-xl)', 'margin-bottom': '8px' }, text: 'No tienes acceso' }),
      h('p', { class: 'text-secondary', style: { 'margin-bottom': '8px' } },
        'Tu cuenta no tiene el rol de administrador de la consola UMA. ',
        'Si crees que se trata de un error, contacta al equipo de sistemas.'),
      email ? h('p', { class: 'text-sm text-tertiary', style: { 'margin-bottom': '24px' }, text: `Sesión iniciada como ${email}` }) : null,
      session.error ? h('p', { class: 'alert', style: { 'margin-bottom': '16px' } }, session.error) : null,
      // A non-admin must always be able to leave this screen.
      button({
        label: 'Cerrar sesión',
        variant: 'primary',
        icon: 'log-out',
        block: true,
        onClick: async () => {
          try { await signOut(); } catch (error) {
            console.error('[main] cierre de sesión fallido', error);
            notify.error('No se pudo cerrar la sesión. Recarga la página e inténtalo de nuevo.');
          }
        },
      }))));
}

function renderApp(session) {
  const shell = renderShell(root);
  shell.setProfile(session);

  if (!routerRunning) {
    routerRunning = true;
    startRouter({
      mountPoint: shell.content,
      fallback: '/',
      onChange: (route) => {
        shell.setActions([]);
        shell.setTitle(route.title, route.subtitle || '');
        shell.setActive(route.path);
      },
    });
  }
  syncActiveNav();
}

function boot() {
  if (configError) {
    renderConfigError(configError);
    return;
  }

  renderBoot();
  startSession();

  onSession((session) => {
    if (session.status === 'loading') {
      if (screen !== 'app') showScreen('boot', renderBoot);
      return;
    }
    if (session.status === 'signed-out') {
      showScreen('login', () => renderLogin(root));
      return;
    }
    if (session.status === 'unauthorized') {
      showScreen('denied', () => renderNoAccess(session));
      return;
    }
    if (screen === 'app') {
      renderShell(root).setProfile(session);
      return;
    }
    showScreen('app', () => renderApp(session));
  });
}

// Deep links such as `#/eventos` typed while signed out are honoured after the
// administrator signs in, because the router reads the hash when it mounts.
boot();

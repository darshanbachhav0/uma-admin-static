/**
 * Application shell: collapsible sidebar, top bar and content region.
 *
 * On desktop the sidebar can be collapsed to icons; below 1000px it becomes an
 * accessible off-canvas drawer with a scrim, Escape support and focus return.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { attachMenu } from '../ui/menu.js';
import { parseHash } from './router.js';
import { getSession, signOut } from './session.js';
import { initials } from '../utils/format.js';
import { notify } from '../ui/toast.js';

const COLLAPSE_KEY = 'uma.sidebar.collapsed';

export const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: 'layout-dashboard' },
  { path: '/eventos', label: 'Eventos', icon: 'calendar-days' },
  { path: '/inscripciones', label: 'Inscripciones', icon: 'clipboard-list' },
];

let shell = null;

/** Build the shell once and return its parts. */
export function renderShell(root) {
  if (shell) return shell;

  const navLinks = new Map();
  const nav = h('nav', { class: 'sidebar__nav', 'aria-label': 'Navegación principal' });

  for (const item of NAV_ITEMS) {
    const link = h('a', {
      class: 'sidebar__link',
      href: `#${item.path}`,
      title: item.label,
    },
      icon(item.icon, { size: 18 }),
      h('span', { class: 'sidebar__link-label', text: item.label }));
    navLinks.set(item.path, link);
    nav.appendChild(link);
  }

  const collapseBtn = h('button', {
    class: 'sidebar__collapse',
    type: 'button',
    'aria-label': 'Contraer menú lateral',
    title: 'Contraer menú',
  }, icon('panel-left', { size: 18 }));

  const profileName = h('span', { class: 'sidebar__profile-name', text: '' });
  const profileAvatar = h('span', { class: 'avatar avatar--sm', 'aria-hidden': 'true', text: '' });
  const profileBtn = h('button', {
    class: 'sidebar__profile',
    type: 'button',
  },
    profileAvatar,
    h('span', { class: 'sidebar__profile-text' },
      profileName,
      h('span', { class: 'sidebar__profile-role', text: 'Administrador' })),
    icon('chevron-up', { size: 16 }));

  attachMenu(profileBtn, () => {
    const { user } = getSession();
    return [
      { heading: user && user.email ? user.email : 'Sesión' },
      {
        label: 'Cerrar sesión',
        icon: 'log-out',
        danger: true,
        onSelect: async () => {
          try { await signOut(); } catch (error) {
            console.error('[shell] cierre de sesión fallido', error);
            notify.error('No se pudo cerrar la sesión. Inténtalo de nuevo.');
          }
        },
      },
    ];
  });

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'sidebar__head' },
      h('div', { class: 'brand-lockup' },
        h('img', {
          class: 'brand-logo',
          src: 'assets/uma-logo.jpg',
          alt: 'Universidad María Auxiliadora',
        }),
        h('span', { class: 'brand-mark brand-mark--compact', 'aria-hidden': 'true', text: 'UMA' })),
      collapseBtn),
    nav,
    h('div', { class: 'sidebar__foot' }, profileBtn));

  const menuBtn = h('button', {
    class: 'btn btn--ghost btn--icon topbar__menu-btn',
    type: 'button',
    'aria-label': 'Abrir menú de navegación',
    'aria-controls': 'sidebar',
    'aria-expanded': 'false',
  }, icon('menu', { size: 20 }));

  const titleEl = h('h1', { class: 'topbar__title', text: 'Dashboard' });
  const subtitleEl = h('p', { class: 'topbar__subtitle', text: '' });
  const actionsEl = h('div', { class: 'topbar__actions' });

  const topbar = h('header', { class: 'topbar' },
    menuBtn,
    h('div', { class: 'topbar__titles' }, titleEl, subtitleEl),
    actionsEl);

  const content = h('main', { class: 'page', id: 'main-content', tabindex: '-1' });

  const main = h('div', { class: 'app-main' },
    topbar,
    content,
    h('footer', { class: 'app-footer' },
      h('span', { text: 'Universidad María Auxiliadora · Consola de administración' })));

  const appShell = h('div', { class: 'app-shell' }, sidebar, main);

  replaceChildren(root,
    h('a', {
      href: '#main-content',
      class: 'visually-hidden',
      onfocus: (event) => event.target.classList.remove('visually-hidden'),
      onblur: (event) => event.target.classList.add('visually-hidden'),
      text: 'Saltar al contenido',
    }),
    appShell);

  // ---- Drawer behaviour ------------------------------------------------
  let scrim = null;

  function openDrawer() {
    if (appShell.classList.contains('is-drawer-open')) return;
    appShell.classList.add('is-drawer-open');
    menuBtn.setAttribute('aria-expanded', 'true');
    scrim = h('div', { class: 'scrim', onclick: closeDrawer });
    document.body.appendChild(scrim);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onDrawerKeydown, true);
    const firstLink = nav.querySelector('a');
    if (firstLink) firstLink.focus();
  }

  function closeDrawer() {
    if (!appShell.classList.contains('is-drawer-open')) return;
    appShell.classList.remove('is-drawer-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    if (scrim) { scrim.remove(); scrim = null; }
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onDrawerKeydown, true);
  }

  function onDrawerKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      menuBtn.focus();
    }
  }

  menuBtn.addEventListener('click', () => {
    if (appShell.classList.contains('is-drawer-open')) closeDrawer();
    else openDrawer();
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeDrawer();
  });

  const desktopQuery = window.matchMedia('(min-width: 1000px)');
  desktopQuery.addEventListener('change', (event) => { if (event.matches) closeDrawer(); });

  // ---- Collapse (desktop) ----------------------------------------------
  function applyCollapsed(collapsed) {
    appShell.classList.toggle('is-collapsed', collapsed);
    collapseBtn.setAttribute('aria-label', collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral');
    collapseBtn.title = collapsed ? 'Expandir menú' : 'Contraer menú';
  }

  let collapsed = false;
  try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { collapsed = false; }
  applyCollapsed(collapsed);

  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    applyCollapsed(collapsed);
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  });

  shell = {
    root: appShell,
    content,
    setActive(path) {
      navLinks.forEach((link, linkPath) => {
        if (linkPath === path) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    },
    setTitle(title, subtitle = '') {
      titleEl.textContent = title;
      subtitleEl.textContent = subtitle;
      document.title = `${title} · UMA Admin`;
    },
    setActions(nodes = []) {
      replaceChildren(actionsEl, nodes);
    },
    setProfile(session) {
      const email = (session.user && session.user.email) || '';
      profileName.textContent = email || 'Administrador';
      profileBtn.setAttribute('aria-label', `Cuenta: ${email || 'administrador'}`);
      profileAvatar.textContent = initials(email);
    },
    closeDrawer,
  };

  return shell;
}

/** Contextual actions for the current page (called from page modules). */
export function setPageActions(nodes) {
  if (shell) shell.setActions(nodes);
}

export function setPageTitle(title, subtitle) {
  if (shell) shell.setTitle(title, subtitle);
}

/** Highlight the nav entry matching the current hash. */
export function syncActiveNav() {
  if (!shell) return;
  shell.setActive(parseHash().path);
}

export function destroyShell() {
  shell = null;
}

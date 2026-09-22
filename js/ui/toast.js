/**
 * Toast notifications.
 *
 * Toasts stack in a polite/assertive live region anchored to the top-right on
 * desktop and the bottom on mobile, so they never cover the primary actions.
 */
import { h } from './dom.js';
import { icon } from './icons.js';

const ICONS = {
  success: 'circle-check',
  error: 'alert-circle',
  warning: 'alert-triangle',
  info: 'info',
};

const TITLES = {
  success: 'Listo',
  error: 'Error',
  warning: 'Atención',
  info: 'Información',
};

const MAX_VISIBLE = 4;

let region = null;

function ensureRegion() {
  if (region && region.isConnected) return region;
  region = h('div', {
    class: 'toast-region',
    role: 'region',
    'aria-label': 'Notificaciones',
  });
  document.body.appendChild(region);
  return region;
}

/**
 * Show a toast.
 * @param {{type?:'success'|'error'|'warning'|'info', title?:string, message?:string, duration?:number}} options
 */
export function toast({ type = 'info', title, message, duration } = {}) {
  const root = ensureRegion();
  const variant = ICONS[type] ? type : 'info';
  const timeout = duration ?? (variant === 'error' ? 8000 : 4500);

  const node = h('div', {
    class: ['toast', `toast--${variant}`],
    role: variant === 'error' ? 'alert' : 'status',
    'aria-live': variant === 'error' ? 'assertive' : 'polite',
  },
    h('span', { class: 'toast__icon' }, icon(ICONS[variant], { size: 18 })),
    h('div', { class: 'toast__content' },
      h('p', { class: 'toast__title', text: title || TITLES[variant] }),
      message ? h('p', { class: 'toast__message', text: message }) : null),
    h('button', {
      class: 'toast__close',
      type: 'button',
      'aria-label': 'Cerrar notificación',
      onclick: () => dismiss(node),
    }, icon('x', { size: 16 })));

  root.appendChild(node);

  while (root.children.length > MAX_VISIBLE) dismiss(root.firstElementChild, true);

  if (timeout > 0) {
    const timer = setTimeout(() => dismiss(node), timeout);
    node.addEventListener('mouseenter', () => clearTimeout(timer));
  }
  return node;
}

function dismiss(node, immediate = false) {
  if (!node || !node.isConnected) return;
  if (immediate) { node.remove(); return; }
  node.classList.add('is-leaving');
  setTimeout(() => node.remove(), 200);
}

export const notify = {
  success: (message, title) => toast({ type: 'success', message, title }),
  error: (message, title) => toast({ type: 'error', message, title }),
  warning: (message, title) => toast({ type: 'warning', message, title }),
  info: (message, title) => toast({ type: 'info', message, title }),
};

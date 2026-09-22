/**
 * Accessible modal and drawer primitive.
 *
 * Provides: scrim, Escape to close, click-outside to close, focus trapping,
 * focus restoration, body scroll locking and stacked overlays.
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

const stack = [];

function lockScroll() {
  if (stack.length === 1) document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  if (!stack.length) document.body.style.overflow = '';
}

function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (node) => node.offsetParent !== null || node === document.activeElement);
}

/**
 * Open an overlay.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {'modal'|'drawer'} [options.variant='modal']
 * @param {''|'lg'|'xl'} [options.size]
 * @param {Node|Node[]} options.body
 * @param {Node[]} [options.footer]
 * @param {Node} [options.headerIcon]
 * @param {boolean} [options.dismissible=true]
 * @param {(reason:string)=>void} [options.onClose]
 * @returns {{root:HTMLElement, panel:HTMLElement, body:HTMLElement, footer:HTMLElement, close:(reason?:string)=>void, setBusy:(busy:boolean)=>void}}
 */
export function openOverlay(options) {
  const {
    title,
    subtitle,
    variant = 'modal',
    size = '',
    body,
    footer = [],
    headerIcon = null,
    dismissible = true,
    onClose,
    labelledBy,
  } = options;

  const titleId = labelledBy || uid('overlay-title');
  const previouslyFocused = document.activeElement;

  const bodyEl = h('div', { class: 'overlay__body' }, body);
  const footerEl = h('div', { class: ['overlay__footer', footer.length ? '' : 'hidden'] }, footer);

  const closeBtn = h('button', {
    class: 'btn btn--ghost btn--icon btn--sm',
    type: 'button',
    'aria-label': 'Cerrar',
    onclick: () => close('close-button'),
  }, icon('x', { size: 18 }));

  const panel = h('div', {
    class: ['overlay', `overlay--${variant}`, size ? `overlay--${size}` : ''],
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
  },
    h('div', { class: 'overlay__header' },
      headerIcon,
      h('div', { class: 'overlay__heading' },
        h('h2', { class: 'overlay__title', id: titleId, text: title }),
        subtitle ? h('p', { class: 'overlay__subtitle', text: subtitle }) : null),
      dismissible ? closeBtn : null),
    bodyEl,
    footerEl);

  const root = h('div', {
    class: ['overlay-scrim', variant === 'drawer' ? 'overlay-scrim--right' : 'overlay-scrim--center'],
    onmousedown: (event) => {
      if (event.target === root && dismissible && !entry.busy) close('scrim');
    },
  }, panel);

  const entry = { root, panel, busy: false, close };
  stack.push(entry);
  document.body.appendChild(root);
  lockScroll();

  document.addEventListener('keydown', onKeydown, true);

  // Focus the first meaningful control, preferring a text input over the close button.
  requestAnimationFrame(() => {
    const candidates = focusables(panel);
    const preferred = candidates.find((node) => !node.classList.contains('btn--icon'));
    (preferred || candidates[0] || panel).focus();
  });

  function onKeydown(event) {
    if (stack[stack.length - 1] !== entry) return;

    if (event.key === 'Escape') {
      if (!dismissible || entry.busy) return;
      event.preventDefault();
      event.stopPropagation();
      close('escape');
      return;
    }

    if (event.key === 'Tab') {
      const items = focusables(panel);
      if (!items.length) { event.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function close(reason = 'programmatic') {
    const index = stack.indexOf(entry);
    if (index === -1) return;
    stack.splice(index, 1);
    document.removeEventListener('keydown', onKeydown, true);
    root.remove();
    unlockScroll();
    if (previouslyFocused && previouslyFocused.isConnected && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
    if (typeof onClose === 'function') onClose(reason);
  }

  return {
    root,
    panel,
    body: bodyEl,
    footer: footerEl,
    close,
    setBusy(busy) {
      entry.busy = busy;
      closeBtn.disabled = busy;
    },
    setFooter(...nodes) {
      footerEl.textContent = '';
      nodes.flat().filter(Boolean).forEach((node) => footerEl.appendChild(node));
      footerEl.classList.toggle('hidden', !footerEl.childElementCount);
    },
  };
}

/** Close every open overlay (used when the router navigates away). */
export function closeAllOverlays() {
  while (stack.length) stack[stack.length - 1].close('navigation');
}

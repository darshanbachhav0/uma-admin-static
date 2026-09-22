/**
 * Dropdown action menu.
 *
 * Secondary/destructive actions live here instead of being rendered as rows of
 * buttons, which keeps list and table rows uncluttered.
 */
import { h } from './dom.js';
import { icon } from './icons.js';

let openMenu = null;

function closeOpenMenu() {
  if (!openMenu) return;
  const { node, trigger, dispose } = openMenu;
  openMenu = null;
  dispose();
  node.remove();
  if (trigger && trigger.isConnected) trigger.setAttribute('aria-expanded', 'false');
}

/**
 * Attach a dropdown to a trigger button.
 *
 * @param {HTMLElement} trigger
 * @param {() => Array<{label?:string, icon?:string, onSelect?:Function, danger?:boolean, disabled?:boolean, separator?:boolean, heading?:string}>} buildItems
 */
export function attachMenu(trigger, buildItems) {
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (openMenu && openMenu.trigger === trigger) { closeOpenMenu(); return; }
    closeOpenMenu();
    openAt(trigger, buildItems());
  });
}

function openAt(trigger, items) {
  const node = h('div', { class: 'menu', role: 'menu' });

  const buttons = [];
  for (const item of items) {
    if (!item) continue;
    if (item.separator) { node.appendChild(h('div', { class: 'menu__separator', role: 'separator' })); continue; }
    if (item.heading) { node.appendChild(h('p', { class: 'menu__label', text: item.heading })); continue; }

    const btn = h('button', {
      class: ['menu__item', item.danger ? 'menu__item--danger' : ''],
      type: 'button',
      role: 'menuitem',
      disabled: item.disabled === true,
    },
      item.icon ? icon(item.icon, { size: 16 }) : null,
      h('span', { text: item.label }));

    btn.addEventListener('click', () => {
      closeOpenMenu();
      if (typeof item.onSelect === 'function') item.onSelect();
    });
    buttons.push(btn);
    node.appendChild(btn);
  }

  document.body.appendChild(node);
  position(node, trigger);
  trigger.setAttribute('aria-expanded', 'true');

  const onDocPointer = (event) => {
    if (!node.contains(event.target) && event.target !== trigger) closeOpenMenu();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeOpenMenu();
      trigger.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const enabled = buttons.filter((b) => !b.disabled);
      if (!enabled.length) return;
      const current = enabled.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown'
        ? (current + 1) % enabled.length
        : (current - 1 + enabled.length) % enabled.length;
      enabled[next].focus();
    }
  };
  const onScrollOrResize = () => closeOpenMenu();

  document.addEventListener('pointerdown', onDocPointer, true);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('scroll', onScrollOrResize, true);

  openMenu = {
    node,
    trigger,
    dispose() {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    },
  };

  const first = buttons.find((b) => !b.disabled);
  if (first) first.focus();
}

function position(node, trigger) {
  const rect = trigger.getBoundingClientRect();
  const { width, height } = node.getBoundingClientRect();
  const margin = 8;

  let left = rect.right - width;
  if (left < margin) left = Math.min(rect.left, window.innerWidth - width - margin);
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - height - 4);
  }

  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

/** Standard "more actions" trigger. */
export function menuTrigger({ label = 'Más acciones', items }) {
  const trigger = h('button', {
    class: 'btn btn--ghost btn--icon btn--sm',
    type: 'button',
    'aria-label': label,
    title: label,
  }, icon('more-vertical', { size: 18 }));
  attachMenu(trigger, items);
  return trigger;
}

export { closeOpenMenu };

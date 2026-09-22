/** Loading, empty and error states so no section is ever blank while working. */
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {{title:string, text?:string, icon?:string, actions?:Node[], inline?:boolean}} options
 */
export function emptyState({ title, text, icon: iconName = 'inbox', actions = [], inline = false }) {
  return h('div', { class: ['state', inline ? 'state--inline' : ''] },
    h('span', { class: 'state__icon' }, icon(iconName, { size: 22 })),
    h('p', { class: 'state__title', text: title }),
    text ? h('p', { class: 'state__text', text }) : null,
    actions.length ? h('div', { class: 'row-2', style: { 'margin-top': '8px' } }, actions) : null);
}

/**
 * @param {{title?:string, text?:string, actions?:Node[], inline?:boolean}} options
 */
export function errorState({ title = 'No se pudieron cargar los datos', text, actions = [], inline = false }) {
  return h('div', { class: ['state', inline ? 'state--inline' : ''], role: 'alert' },
    h('span', { class: 'state__icon state__icon--danger' }, icon('alert-triangle', { size: 22 })),
    h('p', { class: 'state__title', text: title }),
    text ? h('p', { class: 'state__text', text }) : null,
    actions.length ? h('div', { class: 'row-2', style: { 'margin-top': '8px' } }, actions) : null);
}

/** Centred spinner with an accessible status message. */
export function loadingState(message = 'Cargando…', { inline = false } = {}) {
  return h('div', { class: ['state', inline ? 'state--inline' : ''], role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'spinner spinner--lg', style: { color: 'var(--text-tertiary)' } }),
    h('p', { class: 'state__text', text: message }));
}

/** Skeleton rows matching a table layout. */
export function skeletonTable(columns = 5, rows = 6) {
  const body = h('tbody');
  for (let r = 0; r < rows; r += 1) {
    const tr = h('tr');
    for (let c = 0; c < columns; c += 1) {
      tr.appendChild(h('td', h('div', {
        class: 'skeleton skeleton--text',
        style: { width: c === 0 ? '70%' : `${40 + ((r + c) % 3) * 15}%` },
      })));
    }
    body.appendChild(tr);
  }
  return h('table', { class: 'table', 'aria-hidden': 'true' }, body);
}

/** Skeleton grid used while event cards load. */
export function skeletonCards(count = 6) {
  return h('div', { class: 'events-grid', 'aria-hidden': 'true' },
    ...Array.from({ length: count }, () => h('div', { class: 'card' },
      h('div', { class: 'skeleton', style: { height: '150px', 'border-radius': '12px 12px 0 0' } }),
      h('div', { class: 'card__body stack-2' },
        h('div', { class: 'skeleton skeleton--line', style: { width: '75%' } }),
        h('div', { class: 'skeleton skeleton--text', style: { width: '55%' } }),
        h('div', { class: 'skeleton skeleton--text', style: { width: '40%' } })))));
}

/** Skeleton KPI row. */
export function skeletonKpis(count = 4) {
  return h('div', { class: 'kpi-grid', 'aria-hidden': 'true' },
    ...Array.from({ length: count }, () => h('div', { class: 'kpi' },
      h('div', { class: 'skeleton', style: { width: '40px', height: '40px', 'border-radius': '10px' } }),
      h('div', { class: 'kpi__body', style: { width: '100%' } },
        h('div', { class: 'skeleton skeleton--text', style: { width: '60%' } }),
        h('div', { class: 'skeleton skeleton--line', style: { width: '40%', 'margin-top': '6px' } })))));
}

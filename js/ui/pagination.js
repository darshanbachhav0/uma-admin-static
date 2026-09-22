/** Pagination control for large tables. */
import { h } from './dom.js';
import { icon } from './icons.js';
import { formatNumber } from '../utils/format.js';

/**
 * @param {object} options
 * @param {number} options.total     Total rows after filtering.
 * @param {number} options.page      1-based current page.
 * @param {number} options.pageSize
 * @param {(page:number)=>void} options.onChange
 * @param {(size:number)=>void} [options.onPageSizeChange]
 * @param {string} [options.noun]
 * @returns {HTMLElement|null} null when everything fits on one page.
 */
export function pagination({ total, page, pageSize, onChange, onPageSizeChange, noun = 'registros' }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  const controls = h('div', { class: 'pagination__controls' });

  const navBtn = (iconName, label, targetPage, disabled) => {
    const btn = h('button', {
      class: 'pagination__page',
      type: 'button',
      'aria-label': label,
      title: label,
      disabled,
    }, icon(iconName, { size: 15 }));
    if (!disabled) btn.addEventListener('click', () => onChange(targetPage));
    return btn;
  };

  controls.appendChild(navBtn('chevrons-left', 'Primera página', 1, current === 1));
  controls.appendChild(navBtn('chevron-left', 'Página anterior', current - 1, current === 1));

  for (const p of pageWindow(current, pageCount)) {
    if (p === '…') {
      controls.appendChild(h('span', { class: 'pagination__page', 'aria-hidden': 'true', text: '…' }));
      continue;
    }
    const btn = h('button', {
      class: 'pagination__page',
      type: 'button',
      text: String(p),
      'aria-label': `Página ${p}`,
    });
    if (p === current) btn.setAttribute('aria-current', 'page');
    else btn.addEventListener('click', () => onChange(p));
    controls.appendChild(btn);
  }

  controls.appendChild(navBtn('chevron-right', 'Página siguiente', current + 1, current === pageCount));
  controls.appendChild(navBtn('chevrons-right', 'Última página', pageCount, current === pageCount));

  const info = h('p', {
    class: 'pagination__info',
    text: total === 0
      ? `Sin ${noun}`
      : `Mostrando ${formatNumber(from)}–${formatNumber(to)} de ${formatNumber(total)} ${noun}`,
  });

  const left = h('div', { class: 'row-2' }, info);
  if (typeof onPageSizeChange === 'function') {
    const sizeSelect = h('select', {
      class: 'select',
      style: { width: 'auto', height: '32px', 'font-size': 'var(--text-sm)' },
      'aria-label': 'Filas por página',
    },
      ...[25, 50, 100, 200].map((size) => h('option', { value: String(size), text: `${size} / pág.` })));
    sizeSelect.value = String(pageSize);
    sizeSelect.addEventListener('change', () => onPageSizeChange(Number(sizeSelect.value)));
    left.appendChild(sizeSelect);
  }

  return h('nav', { class: 'pagination', 'aria-label': 'Paginación' }, left, controls);
}

/** Page numbers with ellipses, e.g. 1 … 7 [8] 9 … 42 */
function pageWindow(current, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set([1, pageCount, current, current - 1, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= pageCount - 2) { pages.add(pageCount - 1); pages.add(pageCount - 2); pages.add(pageCount - 3); }

  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push('…');
    out.push(p);
    previous = p;
  }
  return out;
}

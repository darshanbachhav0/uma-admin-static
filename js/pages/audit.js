/**
 * Audit log.
 *
 * Shows the most recent event management actions performed from the console:
 * creation, edits, deletions and duplicates.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { badge, button, searchInput, select } from '../ui/controls.js';
import { emptyState, errorState, skeletonTable } from '../ui/states.js';
import { pagination } from '../ui/pagination.js';
import { openOverlay } from '../ui/overlay.js';
import { notify } from '../ui/toast.js';
import { auditStore } from '../core/store.js';
import { setPageActions } from '../core/shell.js';
import { getPref, setPref } from '../core/prefs.js';
import { AUDIT_ACTIONS, describeAction, actionIcon, actionTone } from '../services/audit.js';
import { toCsv, downloadFile, exportFilename } from '../utils/csv.js';
import { describeError } from '../utils/validate.js';
import { formatDateTime, formatNumber, formatRelative, pluralize, startOfDay, EM_DASH } from '../utils/format.js';

const ANY = '__all__';

const ACTION_FILTERS = [
  { value: ANY, label: 'Todas las acciones' },
  ...Object.values(AUDIT_ACTIONS).map((action) => ({ value: action, label: describeAction(action) })),
];

const TARGET_FILTERS = [
  { value: ANY, label: 'Todos los objetos' },
  { value: 'event', label: 'Eventos' },
];

export function mount(container) {
  const filters = { search: '', action: ANY, target: ANY, from: '', to: '' };
  let storeState = auditStore.state;
  let rows = [];
  let page = 1;
  let pageSize = getPref('pageSize');

  const search = searchInput({
    placeholder: 'Buscar por administrador u objeto',
    ariaLabel: 'Buscar en la auditoría',
    onInput: (value) => { filters.search = value; page = 1; render(); },
  });

  const actionSelect = select({ options: ACTION_FILTERS, 'aria-label': 'Filtrar por acción' });
  actionSelect.addEventListener('change', () => { filters.action = actionSelect.value; page = 1; render(); });

  const targetSelect = select({ options: TARGET_FILTERS, 'aria-label': 'Filtrar por tipo de objeto' });
  targetSelect.addEventListener('change', () => { filters.target = targetSelect.value; page = 1; render(); });

  const fromInput = h('input', { class: 'input', type: 'date', 'aria-label': 'Desde' });
  const toInput = h('input', { class: 'input', type: 'date', 'aria-label': 'Hasta' });
  fromInput.addEventListener('change', () => { filters.from = fromInput.value; page = 1; render(); });
  toInput.addEventListener('change', () => { filters.to = toInput.value; page = 1; render(); });

  const clearBtn = button({
    label: 'Limpiar filtros',
    variant: 'ghost',
    size: 'sm',
    icon: 'filter-x',
    onClick: () => {
      Object.assign(filters, { search: '', action: ANY, target: ANY, from: '', to: '' });
      search.input.value = '';
      actionSelect.value = ANY;
      targetSelect.value = ANY;
      fromInput.value = '';
      toInput.value = '';
      page = 1;
      render();
    },
  });

  const countEl = h('p', { class: 'table-toolbar__meta', role: 'status', 'aria-live': 'polite' });

  const toolbar = h('div', { class: 'table-toolbar' },
    h('div', { class: 'table-toolbar__search' }, search),
    h('div', { class: 'table-toolbar__filters' },
      actionSelect, targetSelect,
      h('div', { class: 'date-range' },
        h('span', { class: 'date-range__label', text: 'Del' }), fromInput,
        h('span', { class: 'date-range__label', text: 'al' }), toInput),
      clearBtn),
    h('div', { class: 'spacer' }),
    countEl);

  const tableSlot = h('div');
  const paginationSlot = h('div');

  replaceChildren(container,
    h('p', { class: 'alert alert--info' },
      icon('info', { size: 18 }),
      h('span', { text: 'Se conservan las últimas 500 acciones sobre eventos. Nunca se registran contraseñas ni credenciales.' })),
    h('section', { class: 'card' }, toolbar, tableSlot, paginationSlot));

  setPageActions([
    button({ label: 'Refrescar', variant: 'ghost', icon: 'refresh', onClick: () => auditStore.refresh() }),
    button({ label: 'Exportar CSV', variant: 'secondary', icon: 'download', onClick: exportCsv }),
  ]);

  const unsubscribe = auditStore.subscribe((next) => { storeState = next; render(); });

  function applyFilters(all) {
    const query = filters.search.trim().toLowerCase();
    const fromTs = filters.from ? startOfDay(new Date(`${filters.from}T00:00:00`)) : null;
    const toTs = filters.to ? startOfDay(new Date(`${filters.to}T00:00:00`)) + 86400000 : null;

    return all.filter((entry) => {
      if (filters.action !== ANY && entry.action !== filters.action) return false;
      if (filters.target !== ANY && entry.targetType !== filters.target) return false;
      if (fromTs !== null && entry.at < fromTs) return false;
      if (toTs !== null && entry.at >= toTs) return false;
      if (query) {
        const haystack = [entry.actorEmail, entry.actorUid, entry.targetLabel, entry.targetId, describeAction(entry.action)]
          .join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function render() {
    const active = Boolean(filters.search) || filters.action !== ANY || filters.target !== ANY || filters.from || filters.to;
    clearBtn.classList.toggle('hidden', !active);

    if (storeState.status === 'error') {
      countEl.textContent = '';
      replaceChildren(tableSlot, errorState({
        title: 'No se pudo cargar la auditoría',
        text: describeError(storeState.error, 'Verifica que las reglas permitan leer /auditLogs a los administradores.'),
        actions: [button({ label: 'Reintentar', icon: 'refresh', onClick: () => auditStore.refresh() })],
      }));
      replaceChildren(paginationSlot);
      return;
    }

    if ((storeState.status === 'loading' || storeState.status === 'idle') && !storeState.items.length) {
      countEl.textContent = '';
      replaceChildren(tableSlot, h('div', { class: 'table-scroll' }, skeletonTable(5, 8)));
      replaceChildren(paginationSlot);
      return;
    }

    rows = applyFilters(storeState.items);
    countEl.textContent = rows.length === storeState.items.length
      ? pluralize(rows.length, 'registro', 'registros')
      : `${formatNumber(rows.length)} de ${pluralize(storeState.items.length, 'registro', 'registros')}`;

    if (!storeState.items.length) {
      replaceChildren(tableSlot, emptyState({
        title: 'Sin acciones registradas',
        text: 'Cuando se creen, editen o eliminen eventos, la actividad aparecerá aquí.',
        icon: 'scroll-text',
      }));
      replaceChildren(paginationSlot);
      return;
    }

    if (!rows.length) {
      replaceChildren(tableSlot, emptyState({
        title: 'Sin resultados',
        text: 'Ningún registro coincide con los filtros aplicados.',
        icon: 'search',
        actions: [button({ label: 'Limpiar filtros', icon: 'filter-x', onClick: () => clearBtn.click() })],
      }));
      replaceChildren(paginationSlot);
      return;
    }

    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > pageCount) page = pageCount;
    const visible = rows.slice((page - 1) * pageSize, page * pageSize);

    replaceChildren(tableSlot, h('div', { class: 'table-scroll' }, buildTable(visible)));
    replaceChildren(paginationSlot, pagination({
      total: rows.length,
      page,
      pageSize,
      noun: 'registros',
      onChange: (next) => { page = next; render(); },
      onPageSizeChange: (size) => { pageSize = setPref('pageSize', size); page = 1; render(); },
    }));
  }

  function buildTable(visible) {
    const head = h('thead', h('tr',
      h('th', { text: 'Acción' }),
      h('th', { text: 'Objeto' }),
      h('th', { class: 'prio-2', text: 'Administrador' }),
      h('th', { class: 'prio-3', text: 'Origen' }),
      h('th', { text: 'Fecha' }),
      h('th', { class: 'cell-actions' }, h('span', { class: 'visually-hidden', text: 'Detalle' }))));

    const body = h('tbody');
    for (const entry of visible) {
      body.appendChild(h('tr',
        h('td', h('div', { class: 'row-2' },
          h('span', { class: ['activity__icon', actionTone(entry.action) ? `activity__icon--${actionTone(entry.action)}` : ''] },
            icon(actionIcon(entry.action), { size: 15 })),
          h('span', { class: 'cell-primary', text: describeAction(entry.action) }))),
        h('td', h('div', { class: 'cell-stack' },
          h('span', { text: entry.targetLabel || EM_DASH }),
          h('span', { class: 'cell-stack__sub text-mono', text: entry.targetId || '' }))),
        h('td', { class: 'prio-2', text: entry.actorEmail || entry.actorUid || EM_DASH }),
        h('td', { class: 'prio-3' }, entry.source === 'server'
          ? badge('Servidor', 'success', { iconName: 'server' })
          : badge('Consola', 'neutral', { dot: false })),
        h('td', { class: 'text-nowrap' }, h('div', { class: 'cell-stack' },
          h('span', { text: formatDateTime(entry.at) }),
          h('span', { class: 'cell-stack__sub', text: formatRelative(entry.at) }))),
        h('td', { class: 'cell-actions' },
          button({ icon: 'eye', title: 'Ver detalle', variant: 'ghost', size: 'sm', onClick: () => openDetail(entry) }))));
    }

    return h('table', { class: 'table' }, head, body);
  }

  function openDetail(entry) {
    const metaRows = [];
    if (entry.meta) {
      for (const [key, value] of Object.entries(entry.meta)) {
        metaRows.push(h('dt', { text: key }));
        metaRows.push(h('dd', { text: Array.isArray(value) ? value.join(', ') : String(value) }));
      }
    }

    openOverlay({
      title: describeAction(entry.action),
      subtitle: formatDateTime(entry.at),
      variant: 'drawer',
      body: h('div', { class: 'stack' },
        h('dl', { class: 'detail-list' },
          h('dt', { text: 'Administrador' }), h('dd', { text: entry.actorEmail || EM_DASH }),
          h('dt', { text: 'UID del administrador' }), h('dd', h('code', { class: 'text-mono', text: entry.actorUid || EM_DASH })),
          h('dt', { text: 'Tipo de objeto' }), h('dd', { text: entry.targetType || EM_DASH }),
          h('dt', { text: 'Objeto' }), h('dd', { text: entry.targetLabel || EM_DASH }),
          h('dt', { text: 'Identificador' }), h('dd', h('code', { class: 'text-mono', text: entry.targetId || EM_DASH })),
          h('dt', { text: 'Origen' }), h('dd', { text: entry.source === 'server' ? 'Servidor' : 'Consola web' }),
          ...metaRows)),
    });
  }

  function exportCsv() {
    if (!rows.length) {
      notify.warning('No hay registros que exportar con los filtros actuales.');
      return;
    }
    downloadFile(exportFilename('auditoria'), toCsv([
      { key: 'at', label: 'fecha', value: (row) => new Date(row.at).toISOString() },
      { key: 'action', label: 'accion' },
      { key: 'actionLabel', label: 'accionDescripcion', value: (row) => describeAction(row.action) },
      { key: 'actorEmail', label: 'administrador' },
      { key: 'actorUid', label: 'administradorUid' },
      { key: 'targetType', label: 'tipoObjeto' },
      { key: 'targetLabel', label: 'objeto' },
      { key: 'targetId', label: 'objetoId' },
      { key: 'source', label: 'origen' },
    ], rows));
    notify.success(`Se exportaron ${formatNumber(rows.length)} registros.`);
  }

  render();

  return () => {
    unsubscribe();
    setPageActions([]);
  };
}

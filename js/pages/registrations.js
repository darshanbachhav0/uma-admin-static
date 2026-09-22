/**
 * Registrations.
 *
 * Aggregates `/events/{eventId}/registrations/{key}` from every event into a
 * single filterable table. The database layout is untouched — this is a
 * read-side projection so the student app keeps writing where it always has.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { badge, button, searchInput, select } from '../ui/controls.js';
import { emptyState, errorState, skeletonTable } from '../ui/states.js';
import { pagination } from '../ui/pagination.js';
import { openOverlay } from '../ui/overlay.js';
import { notify } from '../ui/toast.js';
import { eventsStore, flattenRegistrations } from '../core/store.js';
import { setPageActions } from '../core/shell.js';
import { getPref, setPref } from '../core/prefs.js';
import { toCsv, downloadFile, exportFilename } from '../utils/csv.js';
import { describeError, isEmail } from '../utils/validate.js';
import {
  formatDateTime, formatDate, formatNumber, maskDni, pluralize, startOfDay, EM_DASH,
} from '../utils/format.js';

const ANY = '__all__';

const CSV_COLUMNS = [
  { key: 'name', label: 'Estudiante' },
  { key: 'code', label: 'Código' },
  { key: 'dni', label: 'DNI' },
  { key: 'facultyName', label: 'Facultad' },
  { key: 'specialtyName', label: 'Programa' },
  { key: 'semester', label: 'Semestre' },
  { key: 'mode', label: 'Modalidad' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'eventTitle', label: 'Evento' },
  { key: 'registeredAt', label: 'Fecha de inscripción', value: (row) => (row.registeredAt ? new Date(row.registeredAt).toISOString() : '') },
];

export function mount(container, context) {
  const preselectedEvent = context.params.get('evento') || ANY;

  const filters = {
    search: '',
    event: preselectedEvent,
    faculty: ANY,
    program: ANY,
    semester: ANY,
    mode: ANY,
    from: '',
    to: '',
  };

  let storeState = eventsStore.state;
  let rows = [];
  let page = 1;
  let pageSize = getPref('pageSize');
  let maskIds = getPref('maskDni');

  const search = searchInput({
    placeholder: 'Buscar por nombre, código, DNI o email',
    ariaLabel: 'Buscar inscripciones',
    onInput: (value) => { filters.search = value; page = 1; render(); },
  });

  const eventSelect = filterSelect('Filtrar por evento', (value) => { filters.event = value; page = 1; render(); });
  const facultySelect = filterSelect('Filtrar por facultad', (value) => { filters.faculty = value; page = 1; render(); });
  const programSelect = filterSelect('Filtrar por programa', (value) => { filters.program = value; page = 1; render(); });
  const semesterSelect = filterSelect('Filtrar por semestre', (value) => { filters.semester = value; page = 1; render(); });
  const modeSelect = filterSelect('Filtrar por modalidad', (value) => { filters.mode = value; page = 1; render(); });

  const fromInput = h('input', { class: 'input', type: 'date', 'aria-label': 'Inscritos desde' });
  const toInput = h('input', { class: 'input', type: 'date', 'aria-label': 'Inscritos hasta' });
  fromInput.addEventListener('change', () => { filters.from = fromInput.value; page = 1; render(); });
  toInput.addEventListener('change', () => { filters.to = toInput.value; page = 1; render(); });

  const clearBtn = button({
    label: 'Limpiar filtros',
    variant: 'ghost',
    size: 'sm',
    icon: 'filter-x',
    onClick: () => {
      Object.assign(filters, {
        search: '', event: ANY, faculty: ANY, program: ANY, semester: ANY, mode: ANY, from: '', to: '',
      });
      search.input.value = '';
      fromInput.value = '';
      toInput.value = '';
      page = 1;
      render();
    },
  });

  const maskBtn = button({
    label: maskIds ? 'Mostrar DNI' : 'Ocultar DNI',
    variant: 'ghost',
    size: 'sm',
    icon: maskIds ? 'eye' : 'eye-off',
    onClick: () => {
      maskIds = setPref('maskDni', !maskIds);
      render();
    },
  });

  const countEl = h('p', { class: 'table-toolbar__meta', role: 'status', 'aria-live': 'polite' });

  const toolbar = h('div', { class: 'table-toolbar' },
    h('div', { class: 'table-toolbar__search' }, search),
    h('div', { class: 'table-toolbar__filters' },
      eventSelect, facultySelect, programSelect, semesterSelect, modeSelect,
      h('div', { class: 'date-range' },
        h('span', { class: 'date-range__label', text: 'Del' }), fromInput,
        h('span', { class: 'date-range__label', text: 'al' }), toInput),
      clearBtn, maskBtn),
    h('div', { class: 'spacer' }),
    countEl);

  const tableSlot = h('div');
  const paginationSlot = h('div');

  replaceChildren(container, h('section', { class: 'card' }, toolbar, tableSlot, paginationSlot));

  setPageActions([
    button({ label: 'Refrescar', variant: 'ghost', icon: 'refresh', onClick: () => eventsStore.refresh() }),
    button({ label: 'Exportar CSV', variant: 'secondary', icon: 'download', onClick: exportCsv }),
  ]);

  const unsubscribe = eventsStore.subscribe((next) => { storeState = next; render(); });

  function filterSelect(ariaLabel, onChange) {
    const node = select({ options: [], 'aria-label': ariaLabel });
    node.addEventListener('change', () => onChange(node.value));
    return node;
  }

  function fillSelect(node, label, values, current) {
    const options = [{ value: ANY, label }, ...values.map((value) => ({ value, label: value }))];
    replaceChildren(node, ...options.map((opt) => h('option', { value: opt.value, text: opt.label })));
    node.value = options.some((opt) => opt.value === current) ? current : ANY;
    if (node.value !== current) {
      // The previously selected value disappeared from the data.
      return ANY;
    }
    return current;
  }

  function uniqueValues(list, key) {
    return [...new Set(list.map((row) => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  }

  function applyFilters(all) {
    const query = filters.search.trim().toLowerCase();
    const fromTs = filters.from ? startOfDay(new Date(`${filters.from}T00:00:00`)) : null;
    const toTs = filters.to ? startOfDay(new Date(`${filters.to}T00:00:00`)) + 86400000 : null;

    return all.filter((row) => {
      if (filters.event !== ANY && row.eventId !== filters.event) return false;
      if (filters.faculty !== ANY && row.facultyName !== filters.faculty) return false;
      if (filters.program !== ANY && row.specialtyName !== filters.program) return false;
      if (filters.semester !== ANY && row.semester !== filters.semester) return false;
      if (filters.mode !== ANY && row.mode !== filters.mode) return false;
      if (fromTs !== null && (!row.registeredAt || row.registeredAt < fromTs)) return false;
      if (toTs !== null && (!row.registeredAt || row.registeredAt >= toTs)) return false;

      if (query) {
        const haystack = [row.name, row.code, row.dni, row.email, row.phone, row.eventTitle]
          .join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function hasActiveFilters() {
    return Boolean(filters.search) || filters.event !== ANY || filters.faculty !== ANY
      || filters.program !== ANY || filters.semester !== ANY || filters.mode !== ANY
      || filters.from || filters.to;
  }

  function render() {
    clearBtn.classList.toggle('hidden', !hasActiveFilters());
    maskBtn.querySelector('.btn__label').textContent = maskIds ? 'Mostrar DNI' : 'Ocultar DNI';

    if (storeState.status === 'error') {
      countEl.textContent = '';
      replaceChildren(tableSlot, errorState({
        title: 'No se pudieron cargar las inscripciones',
        text: describeError(storeState.error, 'Revisa los permisos de lectura sobre /events.'),
        actions: [button({ label: 'Reintentar', icon: 'refresh', onClick: () => eventsStore.refresh() })],
      }));
      replaceChildren(paginationSlot);
      return;
    }

    if ((storeState.status === 'loading' || storeState.status === 'idle') && !storeState.items.length) {
      countEl.textContent = '';
      replaceChildren(tableSlot, h('div', { class: 'table-scroll' }, skeletonTable(7, 8)));
      replaceChildren(paginationSlot);
      return;
    }

    const all = flattenRegistrations(storeState.items);

    // Event options come from every event so an event with zero registrations
    // can still be selected (and show its empty state).
    const eventOptions = storeState.items.map((event) => ({
      value: event.id,
      label: `${event.title || '(Sin título)'} · ${formatNumber(event.registrationCount)}`,
    }));
    replaceChildren(eventSelect,
      h('option', { value: ANY, text: 'Todos los eventos' }),
      ...eventOptions.map((opt) => h('option', { value: opt.value, text: opt.label })));
    eventSelect.value = eventOptions.some((opt) => opt.value === filters.event) ? filters.event : ANY;
    filters.event = eventSelect.value;

    filters.faculty = fillSelect(facultySelect, 'Todas las facultades', uniqueValues(all, 'facultyName'), filters.faculty);
    filters.program = fillSelect(programSelect, 'Todos los programas', uniqueValues(all, 'specialtyName'), filters.program);
    filters.semester = fillSelect(semesterSelect, 'Todos los semestres', uniqueValues(all, 'semester'), filters.semester);
    filters.mode = fillSelect(modeSelect, 'Todas las modalidades', uniqueValues(all, 'mode'), filters.mode);

    rows = applyFilters(all);
    countEl.textContent = rows.length === all.length
      ? pluralize(rows.length, 'inscripción', 'inscripciones')
      : `${formatNumber(rows.length)} de ${pluralize(all.length, 'inscripción', 'inscripciones')}`;

    if (!all.length) {
      replaceChildren(tableSlot, emptyState({
        title: 'Aún no hay inscripciones',
        text: 'Las inscripciones aparecerán aquí en cuanto los estudiantes se registren en un evento.',
        icon: 'clipboard-list',
      }));
      replaceChildren(paginationSlot);
      return;
    }

    if (!rows.length) {
      replaceChildren(tableSlot, emptyState({
        title: 'Sin resultados',
        text: 'Ninguna inscripción coincide con los filtros aplicados.',
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
      noun: 'inscripciones',
      onChange: (next) => { page = next; render(); },
      onPageSizeChange: (size) => { pageSize = setPref('pageSize', size); page = 1; render(); },
    }));
  }

  function buildTable(visible) {
    const head = h('thead', h('tr',
      h('th', { text: 'Estudiante' }),
      h('th', { class: 'prio-2', text: 'Código' }),
      h('th', { class: 'prio-4', text: 'DNI' }),
      h('th', { class: 'prio-3', text: 'Facultad' }),
      h('th', { class: 'prio-4', text: 'Programa' }),
      h('th', { class: 'prio-5', text: 'Semestre' }),
      h('th', { class: 'prio-5', text: 'Modalidad' }),
      h('th', { text: 'Evento' }),
      h('th', { class: 'prio-3', text: 'Inscripción' }),
      h('th', { class: 'cell-actions' }, h('span', { class: 'visually-hidden', text: 'Acciones' }))));

    const body = h('tbody');
    for (const row of visible) {
      const tr = h('tr', { class: 'is-clickable', tabindex: '0', role: 'button' },
        h('td', h('div', { class: 'cell-stack' },
          h('span', { class: 'cell-primary', text: row.name || '(Sin nombre)' }),
          h('span', { class: 'cell-stack__sub', text: row.email || EM_DASH }))),
        h('td', { class: 'prio-2 text-mono', text: row.code || EM_DASH }),
        h('td', { class: 'prio-4 text-mono', text: row.dni ? (maskIds ? maskDni(row.dni) : row.dni) : EM_DASH }),
        h('td', { class: 'prio-3', text: row.facultyName || EM_DASH }),
        h('td', { class: 'prio-4', text: row.specialtyName || EM_DASH }),
        h('td', { class: 'prio-5', text: row.semester || EM_DASH }),
        h('td', { class: 'prio-5' }, row.mode ? badge(row.mode, 'info', { dot: false }) : EM_DASH),
        h('td', { text: row.eventTitle || EM_DASH }),
        h('td', { class: 'prio-3 text-nowrap', text: row.registeredAt ? formatDate(row.registeredAt) : EM_DASH }),
        h('td', { class: 'cell-actions' },
          button({ icon: 'eye', title: 'Ver detalle', variant: 'ghost', size: 'sm', onClick: () => openDetail(row) })));

      tr.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        openDetail(row);
      });
      tr.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(row); }
      });
      body.appendChild(tr);
    }

    return h('table', { class: 'table' }, head, body);
  }

  function openDetail(row) {
    const focusEventBtn = button({
      label: 'Ver solo este evento',
      variant: 'secondary',
      icon: 'filter',
      onClick: () => {
        filters.event = row.eventId;
        page = 1;
        detail.close('filter');
        render();
      },
    });

    const detail = openOverlay({
      title: row.name || '(Sin nombre)',
      subtitle: row.eventTitle || 'Inscripción',
      variant: 'drawer',
      body: h('div', { class: 'stack' },
        h('div', { class: 'row-2 row-wrap' },
          row.mode ? badge(row.mode, 'info', { dot: false }) : null,
          row.semester ? badge(`Semestre ${row.semester}`, 'neutral', { dot: false }) : null),
        h('dl', { class: 'detail-list' },
          h('dt', { text: 'Código de estudiante' }), h('dd', { class: 'text-mono', text: row.code || EM_DASH }),
          h('dt', { text: 'DNI' }), h('dd', { class: 'text-mono', text: row.dni || EM_DASH }),
          h('dt', { text: 'Facultad' }), h('dd', { text: row.facultyName || EM_DASH }),
          h('dt', { text: 'Programa' }), h('dd', { text: row.specialtyName || EM_DASH }),
          h('dt', { text: 'Semestre' }), h('dd', { text: row.semester || EM_DASH }),
          h('dt', { text: 'Modalidad' }), h('dd', { text: row.mode || EM_DASH }),
          h('dt', { text: 'Correo' }),
          h('dd', isEmail(row.email) ? h('a', { href: `mailto:${row.email}`, text: row.email }) : (row.email || EM_DASH)),
          h('dt', { text: 'Teléfono' }), h('dd', { text: row.phone || EM_DASH }),
          h('dt', { text: 'Evento' }), h('dd', { text: row.eventTitle || EM_DASH }),
          h('dt', { text: 'Fecha de inscripción' }), h('dd', { text: formatDateTime(row.registeredAt) }))),
      footer: [focusEventBtn],
    });
  }

  function exportCsv() {
    if (!rows.length) {
      notify.warning('No hay inscripciones que exportar con los filtros actuales.');
      return;
    }
    downloadFile(exportFilename('inscripciones'), toCsv(CSV_COLUMNS, rows));
    notify.success(`Se exportaron ${formatNumber(rows.length)} inscripciones.`);
  }

  if (preselectedEvent !== ANY) {
    notify.info('Mostrando las inscripciones del evento seleccionado.');
  }

  render();

  return () => {
    unsubscribe();
    setPageActions([]);
  };
}

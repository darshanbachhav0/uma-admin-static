/**
 * Events list.
 *
 * Search, status/date filters, sorting, a result count and a responsive card
 * grid. Each card exposes one primary action (Editar) and keeps the secondary
 * and destructive actions inside an overflow menu.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { badge, button, searchInput, select, tag } from '../ui/controls.js';
import { menuTrigger } from '../ui/menu.js';
import { emptyState, errorState, skeletonCards } from '../ui/states.js';
import { notify } from '../ui/toast.js';
import { confirmDelete } from '../ui/confirm.js';
import { openOverlay } from '../ui/overlay.js';
import { eventsStore } from '../core/store.js';
import { setPageActions } from '../core/shell.js';
import { navigate } from '../core/router.js';
import { openEventEditor } from './event-editor.js';
import {
  deleteEvent, duplicateEvent, statusLabel, statusVariant, timing,
} from '../services/events.js';
import { describeError, safeUrl } from '../utils/validate.js';
import { formatDateTime, formatNumber, pluralize, EM_DASH } from '../utils/format.js';

const DATE_FILTERS = [
  { value: 'all', label: 'Cualquier fecha' },
  { value: 'future', label: 'Próximos' },
  { value: 'today', label: 'Hoy' },
  { value: 'past', label: 'Finalizados' },
  { value: 'undated', label: 'Sin fecha' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'upcoming', label: 'Próximo' },
  { value: 'ongoing', label: 'En curso' },
];

const SORTS = [
  { value: 'date-asc', label: 'Fecha: más próximos' },
  { value: 'date-desc', label: 'Fecha: más recientes' },
  { value: 'title', label: 'Título (A–Z)' },
  { value: 'registrations', label: 'Más inscritos' },
];

const DEFAULTS = { search: '', status: 'all', date: 'all', sort: 'date-asc' };

export function mount(container, context) {
  const filters = { ...DEFAULTS };
  let storeState = eventsStore.state;

  const search = searchInput({
    placeholder: 'Buscar por título, lugar o etiqueta',
    ariaLabel: 'Buscar eventos',
    onInput: (value) => { filters.search = value; render(); },
  });

  const statusSelect = select({
    options: STATUS_FILTERS,
    'aria-label': 'Filtrar por estado',
    onchange: (event) => { filters.status = event.target.value; render(); },
  });

  const dateSelect = select({
    options: DATE_FILTERS,
    'aria-label': 'Filtrar por fecha',
    onchange: (event) => { filters.date = event.target.value; render(); },
  });

  const sortSelect = select({
    options: SORTS,
    'aria-label': 'Ordenar eventos',
    onchange: (event) => { filters.sort = event.target.value; render(); },
  });

  const clearBtn = button({
    label: 'Limpiar filtros',
    variant: 'ghost',
    size: 'sm',
    icon: 'filter-x',
    onClick: () => {
      Object.assign(filters, DEFAULTS);
      search.input.value = '';
      statusSelect.value = DEFAULTS.status;
      dateSelect.value = DEFAULTS.date;
      sortSelect.value = DEFAULTS.sort;
      render();
    },
  });

  const countEl = h('p', { class: 'table-toolbar__meta', role: 'status', 'aria-live': 'polite' });

  const toolbar = h('div', { class: 'card' },
    h('div', { class: 'table-toolbar', style: { 'border-bottom': 'none' } },
      h('div', { class: 'table-toolbar__search' }, search),
      h('div', { class: 'table-toolbar__filters' }, statusSelect, dateSelect, sortSelect, clearBtn),
      h('div', { class: 'spacer' }),
      countEl));

  const listEl = h('div');

  replaceChildren(container, toolbar, listEl);

  setPageActions([
    button({ label: 'Refrescar', variant: 'ghost', icon: 'refresh', onClick: () => eventsStore.refresh() }),
    button({ label: 'Nuevo evento', variant: 'primary', icon: 'plus', onClick: () => openEditor(null) }),
  ]);

  const unsubscribe = eventsStore.subscribe((next) => { storeState = next; render(); });

  function openEditor(event) {
    openEventEditor(event, () => { /* live listener refreshes the grid */ });
  }

  function applyFilters(events) {
    const now = Date.now();
    const query = filters.search.trim().toLowerCase();

    let rows = events.filter((event) => {
      if (filters.status !== 'all' && event.status !== filters.status) return false;

      if (filters.date !== 'all') {
        const when = timing(event, now);
        if (filters.date === 'future' && when.key !== 'future') return false;
        if (filters.date === 'today' && when.key !== 'today') return false;
        if (filters.date === 'past' && when.key !== 'past') return false;
        if (filters.date === 'undated' && when.key !== 'undated') return false;
      }

      if (query) {
        const haystack = [event.title, event.location, ...(event.tags || [])].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    rows = rows.slice();
    switch (filters.sort) {
      case 'date-desc':
        rows.sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
        break;
      case 'title':
        rows.sort((a, b) => a.title.localeCompare(b.title, 'es'));
        break;
      case 'registrations':
        rows.sort((a, b) => b.registrationCount - a.registrationCount);
        break;
      default:
        rows.sort((a, b) => {
          if (!a.startAt && !b.startAt) return 0;
          if (!a.startAt) return 1;
          if (!b.startAt) return -1;
          return a.startAt - b.startAt;
        });
    }
    return rows;
  }

  function hasActiveFilters() {
    return filters.search !== DEFAULTS.search
      || filters.status !== DEFAULTS.status
      || filters.date !== DEFAULTS.date;
  }

  function render() {
    clearBtn.classList.toggle('hidden', !hasActiveFilters());

    if (storeState.status === 'error') {
      countEl.textContent = '';
      replaceChildren(listEl, h('div', { class: 'card' }, errorState({
        title: 'No se pudieron cargar los eventos',
        text: describeError(storeState.error, 'Revisa tu conexión y los permisos de lectura sobre /events.'),
        actions: [button({ label: 'Reintentar', icon: 'refresh', onClick: () => eventsStore.refresh() })],
      })));
      return;
    }

    if ((storeState.status === 'loading' || storeState.status === 'idle') && !storeState.items.length) {
      countEl.textContent = '';
      replaceChildren(listEl, skeletonCards(6));
      return;
    }

    const rows = applyFilters(storeState.items);
    countEl.textContent = rows.length === storeState.items.length
      ? pluralize(rows.length, 'evento', 'eventos')
      : `${formatNumber(rows.length)} de ${pluralize(storeState.items.length, 'evento', 'eventos')}`;

    if (!storeState.items.length) {
      replaceChildren(listEl, h('div', { class: 'card' }, emptyState({
        title: 'Todavía no hay eventos',
        text: 'Crea el primer evento institucional para publicarlo en la aplicación de estudiantes.',
        icon: 'calendar-days',
        actions: [button({ label: 'Crear evento', variant: 'primary', icon: 'plus', onClick: () => openEditor(null) })],
      })));
      return;
    }

    if (!rows.length) {
      replaceChildren(listEl, h('div', { class: 'card' }, emptyState({
        title: 'Sin resultados',
        text: 'Ningún evento coincide con los filtros aplicados.',
        icon: 'search',
        actions: [button({ label: 'Limpiar filtros', icon: 'filter-x', onClick: () => clearBtn.click() })],
      })));
      return;
    }

    replaceChildren(listEl, h('div', { class: 'events-grid' }, ...rows.map(renderCard)));
  }

  function renderCard(event) {
    const when = timing(event);
    const media = h('div', { class: 'event-card__media' });
    const cover = safeUrl(event.imageUrl);

    if (cover) {
      const img = h('img', { src: cover, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => {
        img.remove();
        media.appendChild(h('div', { class: 'stack-2', style: { 'align-items': 'center', color: 'var(--text-tertiary)' } },
          icon('image', { size: 22 }),
          h('span', { class: 'text-xs', text: 'Imagen no disponible' })));
      });
      media.appendChild(img);
    } else {
      media.appendChild(icon('image', { size: 24 }));
    }
    media.appendChild(h('span', { class: 'event-card__media-badge' },
      badge(statusLabel(event.status), statusVariant(event.status))));

    return h('article', { class: 'event-card' },
      media,
      h('div', { class: 'event-card__body' },
        h('h3', { class: 'event-card__title', text: event.title || '(Sin título)' }),
        h('div', { class: 'event-card__meta' },
          h('div', { class: 'event-card__meta-row' },
            icon('calendar', { size: 15 }),
            h('span', { text: event.startAt ? formatDateTime(event.startAt) : 'Sin fecha programada' })),
          h('div', { class: 'event-card__meta-row' },
            icon('map-pin', { size: 15 }),
            h('span', { text: event.location || 'Sin ubicación' }))),
        event.tags.length
          ? h('div', { class: 'event-card__tags' }, ...event.tags.slice(0, 4).map(tag))
          : null),
      h('div', { class: 'event-card__foot' },
        badge(when.label, when.variant),
        h('span', {
          class: 'badge',
          title: 'Inscritos',
        }, icon('users', { size: 12 }), h('span', { text: formatNumber(event.registrationCount) })),
        h('span', { class: 'spacer' }),
        button({ label: 'Editar', variant: 'secondary', size: 'sm', icon: 'pencil', onClick: () => openEditor(event) }),
        menuTrigger({
          label: `Más acciones para ${event.title || 'el evento'}`,
          items: () => [
            { label: 'Ver detalle', icon: 'eye', onSelect: () => openDetail(event) },
            { label: 'Ver inscripciones', icon: 'clipboard-list', onSelect: () => navigate('/inscripciones', { evento: event.id }) },
            { label: 'Duplicar', icon: 'copy', onSelect: () => handleDuplicate(event) },
            { separator: true },
            { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => handleDelete(event) },
          ],
        })));
  }

  function openDetail(event) {
    const when = timing(event);
    const cover = safeUrl(event.imageUrl);

    const body = h('div', { class: 'stack' },
      cover ? h('img', {
        src: cover,
        alt: '',
        style: { 'border-radius': 'var(--radius-lg)', width: '100%', 'aspect-ratio': '16/9', 'object-fit': 'cover' },
      }) : null,
      h('div', { class: 'row-2 row-wrap' },
        badge(statusLabel(event.status), statusVariant(event.status)),
        badge(when.label, when.variant),
        badge(pluralize(event.registrationCount, 'inscrito', 'inscritos'), 'neutral', { dot: false })),
      h('dl', { class: 'detail-list' },
        h('dt', { text: 'Fecha y hora' }),
        h('dd', { text: event.startAt ? formatDateTime(event.startAt) : 'Sin fecha programada' }),
        h('dt', { text: 'Ubicación' }),
        h('dd', { text: event.location || EM_DASH }),
        h('dt', { text: 'Etiquetas' }),
        h('dd', event.tags.length ? h('div', { class: 'row-2 row-wrap' }, ...event.tags.map(tag)) : EM_DASH),
        h('dt', { text: 'Descripción' }),
        h('dd', { style: { 'white-space': 'pre-wrap' }, text: event.description || EM_DASH }),
        h('dt', { text: 'Identificador' }),
        h('dd', h('code', { class: 'text-mono', text: event.id }))));

    const overlay = openOverlay({
      title: event.title || '(Sin título)',
      subtitle: 'Detalle del evento',
      variant: 'drawer',
      body,
      footer: [
        button({
          label: 'Ver inscripciones',
          variant: 'secondary',
          icon: 'clipboard-list',
          onClick: () => { overlay.close('navigate'); navigate('/inscripciones', { evento: event.id }); },
        }),
        button({
          label: 'Editar',
          variant: 'primary',
          icon: 'pencil',
          onClick: () => { overlay.close('edit'); openEditor(event); },
        }),
      ],
    });
  }

  async function handleDuplicate(event) {
    try {
      await duplicateEvent(event);
      notify.success('Evento duplicado. La copia se creó sin fecha ni inscripciones.');
    } catch (error) {
      console.error('[events] no se pudo duplicar el evento', error);
      notify.error(describeError(error, 'No se pudo duplicar el evento.'));
    }
  }

  async function handleDelete(event) {
    const registrations = event.registrationCount;
    await confirmDelete({
      itemLabel: event.title || '(Sin título)',
      message: registrations
        ? `Se eliminará el evento y sus ${formatNumber(registrations)} inscripciones. Esta acción no se puede deshacer.`
        : 'Se eliminará el evento de forma permanente. Esta acción no se puede deshacer.',
      confirmationPhrase: registrations >= 10 ? 'ELIMINAR' : '',
      onConfirm: async () => {
        try {
          await deleteEvent(event);
          notify.success('Evento eliminado.');
        } catch (error) {
          console.error('[events] no se pudo eliminar el evento', error);
          notify.error(describeError(error, 'No se pudo eliminar el evento.'));
          throw error;
        }
      },
    });
  }

  // Deep links: `#/eventos?nuevo=1` and `#/eventos?editar=<id>`
  const params = context.params;
  if (params.get('nuevo') === '1') {
    openEditor(null);
  } else if (params.get('editar')) {
    const id = params.get('editar');
    let stopWaiting = null;
    let handled = false;

    const openWhenReady = (next) => {
      if (handled || next.status !== 'ready') return;
      handled = true;
      const target = next.items.find((item) => item.id === id);
      if (target) openEditor(target);
      else notify.warning('El evento indicado ya no existe.');
      if (stopWaiting) stopWaiting();
    };

    stopWaiting = eventsStore.subscribe(openWhenReady);
    // `subscribe` emits synchronously when the cache is already warm.
    if (handled) stopWaiting();
  }

  render();

  return () => {
    unsubscribe();
    setPageActions([]);
  };
}

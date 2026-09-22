/**
 * Dashboard.
 *
 * Every figure on this page is derived from live Realtime Database data.
 * When a collection is empty the section shows a polished empty state instead
 * of fabricated numbers.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, card, kpi, badge } from '../ui/controls.js';
import { emptyState, errorState, skeletonKpis, loadingState } from '../ui/states.js';
import { barChart, distribution } from '../ui/chart.js';
import { eventsStore, flattenRegistrations } from '../core/store.js';
import { setPageActions } from '../core/shell.js';
import { navigate } from '../core/router.js';
import { summarizeEvents, statusLabel, statusVariant, timing } from '../services/events.js';
import {
  formatNumber, formatDateTime, formatRelative, formatMonth,
  startOfMonth, addMonths, pluralize,
} from '../utils/format.js';

const MONTHS_IN_CHART = 6;

export function mount(container) {
  const kpiSection = h('section', { 'aria-label': 'Indicadores' }, skeletonKpis(6));
  const upcomingSlot = h('div');
  const recentSlot = h('div');
  const analyticsSlot = h('div');
  const statusSlot = h('div');

  replaceChildren(container,
    kpiSection,
    h('div', { class: 'dash-grid' }, analyticsSlot, statusSlot),
    h('div', { class: 'dash-grid' }, upcomingSlot, recentSlot));

  setPageActions([
    button({
      label: 'Crear evento',
      variant: 'primary',
      icon: 'plus',
      onClick: () => navigate('/eventos', { nuevo: '1' }),
    }),
  ]);

  const state = {
    events: eventsStore.state,
  };

  const unsubscribes = [
    eventsStore.subscribe((next) => { state.events = next; render(); }),
  ];

  function render() {
    renderKpis();
    renderAnalytics();
    renderStatus();
    renderUpcoming();
    renderRecent();
  }

  function renderKpis() {
    if (state.events.status === 'loading' && !state.events.items.length) {
      replaceChildren(kpiSection, skeletonKpis(6));
      return;
    }
    if (state.events.status === 'error') {
      replaceChildren(kpiSection, h('div', { class: 'card' }, errorState({
        title: 'No se pudieron cargar los indicadores',
        text: 'Revisa tu conexión y los permisos de lectura de la base de datos.',
        actions: [button({ label: 'Reintentar', icon: 'refresh', onClick: () => eventsStore.refresh() })],
        inline: true,
      })));
      return;
    }

    const events = state.events.items;
    const summary = summarizeEvents(events);
    const registrations = flattenRegistrations(events);
    const monthStart = startOfMonth();
    const thisMonth = registrations.filter((r) => r.registeredAt >= monthStart).length;

    replaceChildren(kpiSection, h('div', { class: 'kpi-grid' },
      kpi({ label: 'Eventos totales', value: formatNumber(summary.total), icon: 'calendar-days', tone: 'brand' }),
      kpi({ label: 'Próximos eventos', value: formatNumber(summary.upcoming), icon: 'clock', tone: 'info', hint: summary.undated ? `${pluralize(summary.undated, 'evento sin fecha', 'eventos sin fecha')}` : null }),
      kpi({ label: 'Eventos en curso', value: formatNumber(summary.ongoing), icon: 'activity', tone: 'success' }),
      kpi({ label: 'Eventos completados', value: formatNumber(summary.past), icon: 'circle-check', tone: 'warning' }),
      kpi({ label: 'Inscripciones totales', value: formatNumber(registrations.length), icon: 'clipboard-list' }),
      kpi({ label: 'Inscripciones este mes', value: formatNumber(thisMonth), icon: 'trending-up', hint: formatMonth(Date.now()) })));
  }

  function renderAnalytics() {
    const events = state.events.items;
    const registrations = flattenRegistrations(events);
    const dated = registrations.filter((r) => r.registeredAt > 0);

    let body;
    if (state.events.status === 'loading' && !events.length) {
      body = loadingState('Cargando inscripciones…', { inline: true });
    } else if (!dated.length) {
      body = emptyState({
        title: 'Aún no hay inscripciones',
        text: 'Cuando los estudiantes se inscriban a un evento, verás aquí la evolución mensual.',
        icon: 'trending-up',
        inline: true,
      });
    } else {
      const buckets = monthBuckets(MONTHS_IN_CHART);
      for (const registration of dated) {
        const bucket = buckets.find((b) => registration.registeredAt >= b.from && registration.registeredAt < b.to);
        if (bucket) bucket.value += 1;
      }
      body = h('div', { class: 'stack' },
        barChart({
          data: buckets.map((b) => ({ label: b.label, value: b.value })),
          ariaLabel: 'Inscripciones por mes',
        }),
        h('p', { class: 'text-sm text-secondary', text: `Últimos ${MONTHS_IN_CHART} meses · ${formatNumber(dated.length)} inscripciones con fecha registrada` }));
    }

    replaceChildren(analyticsSlot, card({
      title: 'Inscripciones por mes',
      subtitle: 'Evolución de las inscripciones registradas',
      body,
    }));
  }

  function renderStatus() {
    const events = state.events.items;
    const summary = summarizeEvents(events);

    const body = events.length
      ? h('div', { class: 'stack' },
        distribution({
          segments: [
            { label: 'En curso', value: summary.ongoing, color: 'var(--success)' },
            { label: 'Próximos (con fecha futura)', value: summary.upcoming, color: 'var(--info)' },
            { label: 'Finalizados', value: summary.past, color: 'var(--text-tertiary)' },
            { label: 'Sin fecha', value: summary.undated, color: 'var(--border-strong)' },
          ],
        }),
        h('p', { class: 'text-sm text-secondary', text: `${pluralize(summary.registrations, 'inscripción', 'inscripciones')} en ${pluralize(summary.total, 'evento', 'eventos')}` }))
      : emptyState({
        title: 'Sin eventos todavía',
        text: 'Crea el primer evento para ver aquí su distribución.',
        icon: 'calendar-days',
        inline: true,
        actions: [button({ label: 'Crear evento', variant: 'primary', icon: 'plus', onClick: () => navigate('/eventos', { nuevo: '1' }) })],
      });

    replaceChildren(statusSlot, card({ title: 'Estado de los eventos', body }));
  }

  function renderUpcoming() {
    const now = Date.now();
    const upcoming = state.events.items
      .filter((event) => event.startAt >= now || event.status === 'ongoing')
      .slice(0, 5);

    let body;
    if (state.events.status === 'loading' && !state.events.items.length) {
      body = loadingState('Cargando eventos…', { inline: true });
    } else if (!upcoming.length) {
      body = emptyState({
        title: 'No hay eventos próximos',
        text: 'Programa un nuevo evento para que aparezca en esta lista.',
        icon: 'calendar-days',
        inline: true,
        actions: [button({ label: 'Crear evento', variant: 'primary', icon: 'plus', onClick: () => navigate('/eventos', { nuevo: '1' }) })],
      });
    } else {
      body = h('div', { class: 'activity' }, ...upcoming.map((event) => {
        const when = timing(event, now);
        return h('article', { class: 'activity__item' },
          h('span', { class: 'activity__icon activity__icon--info' }, icon('calendar-days', { size: 16 })),
          h('div', { class: 'activity__body' },
            h('p', { class: 'activity__text cell-primary', text: event.title || '(Sin título)' }),
            h('p', { class: 'activity__meta' },
              event.startAt ? formatDateTime(event.startAt) : 'Sin fecha programada',
              event.location ? ` · ${event.location}` : '')),
          h('div', { class: 'row-2' },
            badge(when.label, when.variant),
            badge(pluralize(event.registrationCount, 'inscrito', 'inscritos'), 'neutral', { dot: false })));
      }));
    }

    replaceChildren(upcomingSlot, card({
      title: 'Próximos eventos',
      subtitle: 'Eventos en curso y programados',
      flush: true,
      actions: [button({ label: 'Ver todos', variant: 'ghost', size: 'sm', onClick: () => navigate('/eventos') })],
      body,
    }));
  }

  function renderRecent() {
    const recent = [...state.events.items]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 6);

    let body;
    if (state.events.status === 'loading' && !state.events.items.length) {
      body = loadingState('Cargando eventos…', { inline: true });
    } else if (!recent.length) {
      body = emptyState({
        title: 'Sin eventos recientes',
        text: 'Los eventos que crees aparecerán aquí, con los más nuevos primero.',
        icon: 'calendar-days',
        inline: true,
      });
    } else {
      body = h('div', { class: 'activity' }, ...recent.map((event) => h('article', { class: 'activity__item' },
        h('span', { class: 'activity__icon' }, icon('calendar-days', { size: 16 })),
        h('div', { class: 'activity__body' },
          h('p', { class: 'activity__text cell-primary', text: event.title || '(Sin título)' }),
          h('p', { class: 'activity__meta', text: `Creado ${formatRelative(event.createdAt)}` })),
        badge(statusLabel(event.status), statusVariant(event.status)))));
    }

    replaceChildren(recentSlot, card({
      title: 'Eventos recientes',
      subtitle: 'Últimos eventos creados',
      flush: true,
      actions: [button({ label: 'Ver todos', variant: 'ghost', size: 'sm', onClick: () => navigate('/eventos') })],
      body,
    }));
  }

  render();

  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    setPageActions([]);
  };
}

/** Last `count` months as [{from, to, label, value}] in chronological order. */
function monthBuckets(count) {
  const current = startOfMonth();
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const from = addMonths(current, -i);
    const to = addMonths(from, 1);
    buckets.push({ from, to, label: formatMonth(from), value: 0 });
  }
  return buckets;
}

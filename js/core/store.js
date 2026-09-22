/**
 * Reference-counted Realtime Database collections.
 *
 * Every page reads through this module instead of calling `ref().on()` itself.
 * That gives us:
 *   - exactly one listener per path no matter how many views need it,
 *   - automatic detach when the last subscriber goes away,
 *   - a shared cache so navigating between pages does not refetch,
 *   - a "Refrescar" action that re-reads once instead of re-subscribing.
 */
import { db, DB_PATHS } from './firebase.js';

function createCollection(name, { query, normalize }) {
  const listeners = new Set();
  let state = { status: 'idle', items: [], error: null, updatedAt: 0 };
  let ref = null;
  let handler = null;

  function emit(patch) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  }

  function attach() {
    if (ref) return;
    ref = query(db);
    emit({ status: 'loading', error: null });
    handler = ref.on('value',
      (snapshot) => emit({
        status: 'ready',
        items: normalize(snapshot.val() || {}),
        error: null,
        updatedAt: Date.now(),
      }),
      (error) => {
        console.error(`[store:${name}] suscripción fallida`, error);
        emit({ status: 'error', error });
      });
  }

  function detach() {
    if (!ref) return;
    ref.off('value', handler);
    ref = null;
    handler = null;
    // Keep the last snapshot cached for an instant re-render on return.
    emit({ status: state.items.length ? 'stale' : 'idle' });
  }

  return {
    name,
    get state() { return state; },

    /** Subscribe and attach the underlying listener if needed. */
    subscribe(listener) {
      listeners.add(listener);
      attach();
      listener(state);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) detach();
      };
    },

    /** One-off re-read; does not touch the live listener. */
    async refresh() {
      if (!ref) { attach(); return; }
      emit({ status: 'refreshing' });
      try {
        const snapshot = await ref.get();
        emit({ status: 'ready', items: normalize(snapshot.val() || {}), error: null, updatedAt: Date.now() });
      } catch (error) {
        console.error(`[store:${name}] refresco fallido`, error);
        emit({ status: 'error', error });
      }
    },
  };
}

/** Events, sorted by start date (soonest first, undated last). */
export const eventsStore = createCollection('events', {
  query: (database) => database.ref(DB_PATHS.events),
  normalize: (data) => Object.entries(data)
    .filter(([, value]) => value && typeof value === 'object')
    .map(([id, value]) => normalizeEvent(id, value))
    .sort(byStartAt),
});

function normalizeEvent(id, value) {
  const registrations = value.registrations && typeof value.registrations === 'object' ? value.registrations : {};
  return {
    id,
    title: typeof value.title === 'string' ? value.title : '',
    description: typeof value.description === 'string' ? value.description : '',
    location: typeof value.location === 'string' ? value.location : '',
    status: value.status === 'ongoing' ? 'ongoing' : 'upcoming',
    startAt: Number(value.startAt) || 0,
    imageUrl: typeof value.imageUrl === 'string' ? value.imageUrl : '',
    imageCredit: value.imageCredit && typeof value.imageCredit === 'object' ? value.imageCredit : null,
    tags: Array.isArray(value.tags) ? value.tags.filter((t) => typeof t === 'string') : [],
    createdBy: typeof value.createdBy === 'string' ? value.createdBy : '',
    createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || 0,
    registrationCount: Object.keys(registrations).length,
    registrations,
  };
}

function byStartAt(a, b) {
  if (!a.startAt && !b.startAt) return (b.createdAt || 0) - (a.createdAt || 0);
  if (!a.startAt) return 1;
  if (!b.startAt) return -1;
  return a.startAt - b.startAt;
}

/**
 * Flatten `/events/{id}/registrations/{key}` into a single list.
 * The existing database layout is preserved — this is a read-side projection.
 */
export function flattenRegistrations(events) {
  const rows = [];
  for (const event of events) {
    for (const [key, value] of Object.entries(event.registrations || {})) {
      if (!value || typeof value !== 'object') continue;
      rows.push({
        key,
        eventId: event.id,
        eventTitle: event.title,
        eventStartAt: event.startAt,
        name: text(value.name),
        code: text(value.code),
        dni: text(value.dni),
        facultyName: text(value.facultyName),
        specialtyName: text(value.specialtyName),
        semester: text(value.semester),
        mode: text(value.mode),
        email: text(value.email),
        phone: text(value.phone),
        uid: text(value.uid),
        registeredAt: Number(value.registeredAt) || 0,
      });
    }
  }
  return rows.sort((a, b) => b.registeredAt - a.registeredAt);
}

function text(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

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

/** Raw `/events` snapshot; `eventsStore` below adds registration details. */
const rawEventsStore = createCollection('events', {
  query: (database) => database.ref(DB_PATHS.events),
  normalize: (data) => data,
});

/**
 * Events, sorted by start date (soonest first, undated last).
 *
 * The student app writes each registration twice:
 *   /events/{eventId}/registrations/{code}      { uid, code, registeredAt }
 *   /eventRegistrations/{eventId}/{code}        { …, name, dni, email, phone,
 *                                                 facultyName, specialtyName,
 *                                                 semester, mode }
 * Administrators may read `/eventRegistrations/{eventId}` one event at a time
 * (not the whole path), so this store keeps one live listener per event and
 * merges both sources by student code. A registration found in either place
 * is listed; the detailed copy fills in the name and the other fields.
 */
export const eventsStore = createEventsStore();

function createEventsStore() {
  const listeners = new Set();
  let state = { status: 'idle', items: [], error: null, updatedAt: 0 };
  let rawEvents = {};
  const details = new Map();      // eventId -> { code: registration }
  const detailRefs = new Map();   // eventId -> { ref, handler }
  // Student profiles (/users/{uid}: dni, email) used to fill in registrations
  // that have no detailed copy. Read once per student, not live.
  const profiles = new Map();     // uid -> { dni, email } | null while loading
  let stopRaw = null;

  function emit(patch) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  }

  function rebuild(patch = {}) {
    const items = Object.entries(rawEvents || {})
      .filter(([, value]) => value && typeof value === 'object')
      .map(([id, value]) => normalizeEvent(id, value, details.get(id), profiles))
      .sort(byStartAt);
    emit({ ...patch, items });
    loadMissingProfiles(items);
  }

  /** Fetch the profile of students whose registration lacks DNI or email. */
  function loadMissingProfiles(items) {
    const wanted = new Set();
    for (const event of items) {
      for (const registration of Object.values(event.registrations)) {
        const uid = typeof registration.uid === 'string' ? registration.uid : '';
        if (!uid || profiles.has(uid) || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) continue;
        if (!registration.dni || !registration.email) wanted.add(uid);
      }
    }
    if (!wanted.size) return;
    for (const uid of wanted) profiles.set(uid, null);
    Promise.all([...wanted].map(async (uid) => {
      try {
        const value = (await db.ref(DB_PATHS.users).child(uid).get()).val() || {};
        profiles.set(uid, {
          dni: typeof value.dni === 'string' ? value.dni : '',
          email: typeof value.email === 'string' ? value.email : '',
        });
      } catch (error) {
        console.warn('[store:events] no se pudo leer el perfil del estudiante', error);
        profiles.set(uid, { dni: '', email: '' });
      }
    })).then(() => { if (stopRaw) rebuild(); });
  }

  function syncDetailListeners() {
    const ids = new Set(Object.keys(rawEvents || {}));
    for (const [id, entry] of detailRefs) {
      if (ids.has(id)) continue;
      entry.ref.off('value', entry.handler);
      detailRefs.delete(id);
      details.delete(id);
    }
    for (const id of ids) {
      if (detailRefs.has(id)) continue;
      const ref = db.ref(DB_PATHS.eventRegistrations).child(id);
      const handler = ref.on('value',
        (snapshot) => {
          const value = snapshot.val();
          details.set(id, value && typeof value === 'object' ? value : {});
          rebuild();
        },
        (error) => {
          // Not fatal: the event still lists the registrations in /events.
          console.warn(`[store:events] sin acceso a los datos de inscripción de ${id}`, error);
          details.delete(id);
        });
      detailRefs.set(id, { ref, handler });
    }
  }

  function detachDetails() {
    for (const { ref, handler } of detailRefs.values()) ref.off('value', handler);
    detailRefs.clear();
    details.clear();
    profiles.clear();
  }

  function onRaw(rawState) {
    const { items, ...rest } = rawState;
    if (items && !Array.isArray(items)) rawEvents = items;
    if (rawState.status === 'ready') syncDetailListeners();
    rebuild(rest);
  }

  return {
    name: 'events',
    get state() { return state; },

    subscribe(listener) {
      listeners.add(listener);
      if (!stopRaw) stopRaw = rawEventsStore.subscribe(onRaw);
      else listener(state);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && stopRaw) {
          stopRaw();
          stopRaw = null;
          detachDetails();
        }
      };
    },

    refresh() {
      return rawEventsStore.refresh();
    },
  };
}

/**
 * Fill a missing DNI or email from the student's profile. The name, faculty
 * and program are not stored in the profile, so they stay empty until the
 * app saves the detailed copy of the registration.
 */
function fillFromProfiles(registrations, profiles) {
  if (!profiles || !profiles.size) return registrations;
  const filled = {};
  for (const [code, registration] of Object.entries(registrations)) {
    const profile = profiles.get(registration.uid);
    filled[code] = profile
      ? { ...registration, dni: registration.dni || profile.dni, email: registration.email || profile.email }
      : registration;
  }
  return filled;
}

/** Merge the short and the detailed copy of each registration by code. */
function mergeRegistrations(short, detailed) {
  const merged = {};
  const add = (source) => {
    for (const [code, value] of Object.entries(source || {})) {
      if (!value || typeof value !== 'object') continue;
      const current = merged[code] || {};
      const next = { ...current };
      for (const [field, fieldValue] of Object.entries(value)) {
        // Never replace a filled-in value with an empty one.
        if (fieldValue !== '' && fieldValue !== null && fieldValue !== undefined) next[field] = fieldValue;
      }
      merged[code] = next;
    }
  };
  add(short);
  add(detailed);
  return merged;
}

function normalizeEvent(id, value, detailedRegistrations, profiles) {
  const short = value.registrations && typeof value.registrations === 'object' ? value.registrations : {};
  const registrations = fillFromProfiles(mergeRegistrations(short, detailedRegistrations), profiles);
  return {
    id,
    title: typeof value.title === 'string' ? value.title : '',
    description: typeof value.description === 'string' ? value.description : '',
    location: typeof value.location === 'string' ? value.location : '',
    locationUrl: typeof value.locationUrl === 'string' ? value.locationUrl : '',
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
    documentsUrl: typeof value.documentsUrl === 'string' ? value.documentsUrl : '',
    documentCount: Number(value.documentCount) || 0,
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

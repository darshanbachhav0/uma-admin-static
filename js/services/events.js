/**
 * Event read/write operations against `/events`.
 *
 * The stored shape is unchanged from the previous version of this application
 * so the student-facing app keeps working:
 *   { id, title, description, location, tags[], status, startAt, imageUrl,
 *     imageCredit?, createdBy, createdAt, registrations? }
 *
 * `updatedAt` is the only added field and is additive/optional.
 * `status` keeps its two legacy values: 'upcoming' and 'ongoing'.
 */
import { db, DB_PATHS } from '../core/firebase.js';
import { getSession } from '../core/session.js';
import { recordAudit, AUDIT_ACTIONS } from './audit.js';
import { cleanText, parseTags, safeUrl } from '../utils/validate.js';
import { startOfDay } from '../utils/format.js';

export const EVENT_STATUSES = Object.freeze([
  { value: 'upcoming', label: 'Próximo' },
  { value: 'ongoing', label: 'En curso' },
]);

export function statusLabel(status) {
  const match = EVENT_STATUSES.find((s) => s.value === status);
  return match ? match.label : 'Próximo';
}

export function statusVariant(status) {
  return status === 'ongoing' ? 'success' : 'info';
}

/**
 * Timing derived from `startAt` — presented alongside the stored status so
 * administrators can see at a glance what has already happened, without
 * introducing a third stored status value.
 */
export function timing(event, now = Date.now()) {
  if (!event.startAt) return { key: 'undated', label: 'Sin fecha', variant: 'neutral' };
  const today = startOfDay(now);
  const eventDay = startOfDay(event.startAt);
  if (eventDay === today) return { key: 'today', label: 'Hoy', variant: 'warning' };
  if (event.startAt < now) return { key: 'past', label: 'Finalizado', variant: 'neutral' };
  return { key: 'future', label: 'Programado', variant: 'info' };
}

/**
 * Validate the event form payload.
 * @returns {{values?:object, errors:Record<string,string>}}
 */
export function validateEvent(input) {
  const errors = {};
  const title = cleanText(input.title, 160);
  if (!title) errors.title = 'El título es obligatorio.';
  else if (title.length < 3) errors.title = 'El título debe tener al menos 3 caracteres.';

  const location = cleanText(input.location, 160);
  const description = cleanText(input.description, 4000);

  if (input.time && !input.date) errors.date = 'Indica la fecha del evento.';
  if (input.date && input.startAt === null) {
    errors.date = 'La fecha o la hora no son válidas.';
  }

  const values = {
    title,
    description,
    location,
    status: input.status === 'ongoing' ? 'ongoing' : 'upcoming',
    startAt: input.startAt || 0,
    tags: parseTags(input.tags),
    imageUrl: safeUrl(input.imageUrl),
    imageCredit: input.imageCredit || null,
  };
  return { values, errors };
}

/** Create or update an event. Returns the event id. */
export async function saveEvent(eventId, values) {
  const { user } = getSession();
  if (!user) throw new Error('Sesión no válida.');

  const isNew = !eventId;
  const id = eventId || db.ref(DB_PATHS.events).push().key;
  if (!id) throw new Error('No se pudo generar el identificador del evento.');

  const ref = db.ref(DB_PATHS.events).child(id);

  let createdBy = user.uid;
  let createdAt = Date.now();
  if (!isNew) {
    const snapshot = await ref.get();
    const existing = snapshot.val() || {};
    if (existing.createdBy) createdBy = existing.createdBy;
    if (existing.createdAt) createdAt = existing.createdAt;
  }

  const payload = {
    id,
    title: values.title,
    description: values.description,
    location: values.location,
    tags: values.tags,
    status: values.status,
    startAt: values.startAt,
    imageUrl: values.imageUrl,
    createdBy,
    createdAt,
    updatedAt: Date.now(),
  };
  if (values.imageCredit) payload.imageCredit = values.imageCredit;

  // `update` keeps the `registrations` child intact; `set` would delete it.
  await ref.update(payload);

  await recordAudit({
    action: isNew ? AUDIT_ACTIONS.EVENT_CREATED : AUDIT_ACTIONS.EVENT_UPDATED,
    targetType: 'event',
    targetId: id,
    targetLabel: values.title,
    meta: { status: values.status, startAt: values.startAt || null },
  });

  return id;
}

/** Delete an event and its registrations. */
export async function deleteEvent(event) {
  await db.ref(DB_PATHS.events).child(event.id).remove();
  await recordAudit({
    action: AUDIT_ACTIONS.EVENT_DELETED,
    targetType: 'event',
    targetId: event.id,
    targetLabel: event.title,
    meta: { registrations: event.registrationCount || 0 },
  });
}

/**
 * Duplicate an event. The copy starts as a draft: same content, no
 * registrations, status reset to 'upcoming' and no date, so nobody publishes a
 * copy with the original's schedule by accident.
 */
export async function duplicateEvent(event) {
  const { user } = getSession();
  const id = db.ref(DB_PATHS.events).push().key;
  const title = `${event.title} (copia)`.slice(0, 160);

  await db.ref(DB_PATHS.events).child(id).set({
    id,
    title,
    description: event.description,
    location: event.location,
    tags: event.tags,
    status: 'upcoming',
    startAt: 0,
    imageUrl: safeUrl(event.imageUrl),
    ...(event.imageCredit ? { imageCredit: event.imageCredit } : {}),
    createdBy: user ? user.uid : '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  await recordAudit({
    action: AUDIT_ACTIONS.EVENT_DUPLICATED,
    targetType: 'event',
    targetId: id,
    targetLabel: title,
    meta: { sourceEventId: event.id },
  });

  return id;
}

/** Statistics used by the dashboard, computed from live data only. */
export function summarizeEvents(events, now = Date.now()) {
  const summary = {
    total: events.length,
    upcoming: 0,
    ongoing: 0,
    past: 0,
    undated: 0,
    registrations: 0,
  };
  for (const event of events) {
    summary.registrations += event.registrationCount;
    if (event.status === 'ongoing') summary.ongoing += 1;
    if (!event.startAt) summary.undated += 1;
    else if (event.startAt >= now) summary.upcoming += 1;
    else summary.past += 1;
  }
  return summary;
}

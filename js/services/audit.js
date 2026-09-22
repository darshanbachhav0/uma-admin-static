/**
 * Audit trail for event management.
 *
 * Records event content changes performed from the console, so administrators
 * can see who created, edited, deleted or duplicated an event and when.
 *
 * Passwords, tokens and secrets are never written to this log.
 */
import { db, DB_PATHS } from '../core/firebase.js';
import { getSession } from '../core/session.js';

export const AUDIT_ACTIONS = Object.freeze({
  EVENT_CREATED: 'event.created',
  EVENT_UPDATED: 'event.updated',
  EVENT_DELETED: 'event.deleted',
  EVENT_DUPLICATED: 'event.duplicated',
});

const LABELS = {
  [AUDIT_ACTIONS.EVENT_CREATED]: 'Evento creado',
  [AUDIT_ACTIONS.EVENT_UPDATED]: 'Evento editado',
  [AUDIT_ACTIONS.EVENT_DELETED]: 'Evento eliminado',
  [AUDIT_ACTIONS.EVENT_DUPLICATED]: 'Evento duplicado',
};

const TONES = {
  [AUDIT_ACTIONS.EVENT_CREATED]: 'success',
  [AUDIT_ACTIONS.EVENT_DELETED]: 'danger',
  [AUDIT_ACTIONS.EVENT_DUPLICATED]: 'info',
};

const ICONS = {
  [AUDIT_ACTIONS.EVENT_CREATED]: 'plus',
  [AUDIT_ACTIONS.EVENT_UPDATED]: 'pencil',
  [AUDIT_ACTIONS.EVENT_DELETED]: 'trash',
  [AUDIT_ACTIONS.EVENT_DUPLICATED]: 'copy',
};

export function describeAction(action) {
  return LABELS[action] || action || 'Acción';
}

export function actionTone(action) {
  return TONES[action] || '';
}

export function actionIcon(action) {
  return ICONS[action] || 'calendar-days';
}

/**
 * Append an audit entry. Failures are logged but never block the operation the
 * administrator actually requested.
 *
 * @param {{action:string, targetType:string, targetId?:string, targetLabel?:string, meta?:object}} entry
 */
export async function recordAudit(entry) {
  const { user } = getSession();
  if (!user || !db) return;

  const payload = {
    at: Date.now(),
    action: String(entry.action || ''),
    actorUid: user.uid,
    actorEmail: user.email || '',
    targetType: String(entry.targetType || ''),
    targetId: String(entry.targetId || ''),
    targetLabel: String(entry.targetLabel || '').slice(0, 200),
    source: 'client',
  };
  const meta = sanitizeMeta(entry.meta);
  if (meta) payload.meta = meta;

  try {
    await db.ref(DB_PATHS.auditLogs).push(payload);
  } catch (error) {
    console.warn('[audit] no se pudo registrar la acción', entry.action, error);
  }
}

const FORBIDDEN_META_KEYS = /pass|password|secret|token|credential|apikey|api_key/i;

/** Drop anything that looks like a credential and keep the payload small. */
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (FORBIDDEN_META_KEYS.test(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map((v) => String(v).slice(0, 60));
  }
  return Object.keys(out).length ? out : null;
}

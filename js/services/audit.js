/**
 * Audit trail.
 *
 * Entries for privileged Firebase Authentication operations are written by the
 * Cloud Functions backend (`source: 'server'`) so they cannot be forged or
 * skipped by a client. Event content changes, which the client performs
 * directly against the database, are recorded here (`source: 'client'`).
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
  USER_CREATED: 'user.created',
  USER_DELETED: 'user.deleted',
  USER_DISABLED: 'user.disabled',
  USER_ENABLED: 'user.enabled',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_BULK_IMPORT: 'user.bulk_import',
});

const LABELS = {
  [AUDIT_ACTIONS.EVENT_CREATED]: 'Evento creado',
  [AUDIT_ACTIONS.EVENT_UPDATED]: 'Evento editado',
  [AUDIT_ACTIONS.EVENT_DELETED]: 'Evento eliminado',
  [AUDIT_ACTIONS.EVENT_DUPLICATED]: 'Evento duplicado',
  [AUDIT_ACTIONS.USER_CREATED]: 'Usuario creado',
  [AUDIT_ACTIONS.USER_DELETED]: 'Usuario eliminado',
  [AUDIT_ACTIONS.USER_DISABLED]: 'Cuenta deshabilitada',
  [AUDIT_ACTIONS.USER_ENABLED]: 'Cuenta habilitada',
  [AUDIT_ACTIONS.USER_PASSWORD_RESET]: 'Restablecimiento de contraseña',
  [AUDIT_ACTIONS.USER_ROLE_CHANGED]: 'Rol modificado',
  [AUDIT_ACTIONS.USER_BULK_IMPORT]: 'Importación masiva',
};

const TONES = {
  [AUDIT_ACTIONS.EVENT_CREATED]: 'success',
  [AUDIT_ACTIONS.EVENT_DELETED]: 'danger',
  [AUDIT_ACTIONS.USER_CREATED]: 'success',
  [AUDIT_ACTIONS.USER_DELETED]: 'danger',
  [AUDIT_ACTIONS.USER_DISABLED]: 'danger',
  [AUDIT_ACTIONS.USER_ENABLED]: 'success',
  [AUDIT_ACTIONS.USER_BULK_IMPORT]: 'info',
};

const ICONS = {
  [AUDIT_ACTIONS.EVENT_CREATED]: 'plus',
  [AUDIT_ACTIONS.EVENT_UPDATED]: 'pencil',
  [AUDIT_ACTIONS.EVENT_DELETED]: 'trash',
  [AUDIT_ACTIONS.EVENT_DUPLICATED]: 'copy',
  [AUDIT_ACTIONS.USER_CREATED]: 'user-plus',
  [AUDIT_ACTIONS.USER_DELETED]: 'trash',
  [AUDIT_ACTIONS.USER_DISABLED]: 'ban',
  [AUDIT_ACTIONS.USER_ENABLED]: 'circle-check',
  [AUDIT_ACTIONS.USER_PASSWORD_RESET]: 'key',
  [AUDIT_ACTIONS.USER_ROLE_CHANGED]: 'shield',
  [AUDIT_ACTIONS.USER_BULK_IMPORT]: 'upload',
};

export function describeAction(action) {
  return LABELS[action] || action || 'Acción';
}

export function actionTone(action) {
  return TONES[action] || '';
}

export function actionIcon(action) {
  return ICONS[action] || 'activity';
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

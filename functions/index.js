/**
 * UMA Admin — privileged backend.
 *
 * Every Firebase Authentication operation that needs elevated privileges lives
 * here, behind HTTPS callable functions. The browser only ever sends its ID
 * token; this code independently verifies that the caller is an authorised
 * administrator before doing anything, and writes the audit entry itself so it
 * cannot be skipped or forged by a client.
 *
 * Service-account credentials are provided by the Cloud Functions runtime and
 * never leave the server.
 */
'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const REGION = process.env.FUNCTIONS_REGION || 'us-central1';
setGlobalOptions({ region: REGION, maxInstances: 10 });

const auth = admin.auth();
const db = admin.database();

const USERS_PATH = 'users';
const AUDIT_PATH = 'auditLogs';

const MAX_LIST_USERS = 3000;
const MAX_BULK_USERS = 50;

/* ------------------------------------------------------------------------ */
/*  Authorisation                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Verify the caller is an administrator.
 *
 * Two accepted sources, in order of preference:
 *   1. the `admin: true` custom claim;
 *   2. `/users/{uid}/role === 'admin'` in the Realtime Database, which keeps
 *      the administrators that existed before custom claims were introduced
 *      working. The first time such an administrator calls the backend the
 *      claim is granted so subsequent checks are token-only.
 *
 * @returns {Promise<{uid: string, email: string}>}
 */
async function requireAdmin(request) {
  const callerAuth = request.auth;
  if (!callerAuth || !callerAuth.uid) {
    throw new HttpsError('unauthenticated', 'Inicia sesión para realizar esta operación.');
  }

  const uid = callerAuth.uid;
  const email = (callerAuth.token && callerAuth.token.email) || '';

  if (callerAuth.token && callerAuth.token.admin === true) {
    return { uid, email };
  }

  const snapshot = await db.ref(`${USERS_PATH}/${uid}/role`).get();
  const role = String(snapshot.val() || '').trim().toLowerCase();
  if (role !== 'admin') {
    logger.warn('Intento de operación privilegiada sin permisos', { uid, email });
    throw new HttpsError('permission-denied', 'Tu cuenta no tiene permisos de administrador.');
  }

  // Promote the legacy database role to a custom claim (idempotent).
  try {
    await auth.setCustomUserClaims(uid, { admin: true });
    logger.info('Custom claim de administrador otorgado desde el rol heredado', { uid });
  } catch (error) {
    logger.warn('No se pudo otorgar el custom claim de administrador', { uid, error: error.message });
  }

  return { uid, email };
}

/* ------------------------------------------------------------------------ */
/*  Audit                                                                    */
/* ------------------------------------------------------------------------ */

const FORBIDDEN_META_KEYS = /pass|password|secret|token|credential|apikey|api_key/i;

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (FORBIDDEN_META_KEYS.test(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** Append a server-authored audit entry. Never contains credentials. */
async function recordAudit(actor, entry) {
  const payload = {
    at: Date.now(),
    action: entry.action,
    actorUid: actor.uid,
    actorEmail: actor.email || '',
    targetType: entry.targetType || '',
    targetId: entry.targetId || '',
    targetLabel: String(entry.targetLabel || '').slice(0, 200),
    source: 'server',
  };
  const meta = sanitizeMeta(entry.meta);
  if (meta) payload.meta = meta;

  try {
    await db.ref(AUDIT_PATH).push(payload);
  } catch (error) {
    logger.error('No se pudo escribir la entrada de auditoría', { action: entry.action, error: error.message });
  }
}

/* ------------------------------------------------------------------------ */
/*  Validation                                                               */
/* ------------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DNI_RE = /^\d{8,12}$/;
const ST_CODE_RE = /^[A-Za-z0-9._-]{3,32}$/;

function parseUserInput(input) {
  const email = String((input && input.email) || '').trim().toLowerCase();
  const dni = String((input && input.dni) || '').trim();
  const stCode = String((input && input.stCode) || '').trim();
  const role = String((input && input.role) || 'student').trim().toLowerCase() === 'admin' ? 'admin' : 'student';

  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'El correo electrónico no es válido.');
  if (!DNI_RE.test(dni)) throw new HttpsError('invalid-argument', 'El DNI debe tener entre 8 y 12 dígitos.');
  if (!ST_CODE_RE.test(stCode)) throw new HttpsError('invalid-argument', 'El código de estudiante no es válido.');

  return { email, dni, stCode, role };
}

function requireUid(input) {
  const uid = String((input && input.uid) || '').trim();
  if (!uid || uid.length > 128) throw new HttpsError('invalid-argument', 'Identificador de usuario no válido.');
  return uid;
}

function toMillis(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function describeUser(record) {
  return {
    uid: record.uid,
    email: record.email || '',
    disabled: Boolean(record.disabled),
    emailVerified: Boolean(record.emailVerified),
    admin: Boolean(record.customClaims && record.customClaims.admin === true),
    createdAt: toMillis(record.metadata && record.metadata.creationTime),
    lastSignInAt: toMillis(record.metadata && record.metadata.lastSignInTime),
  };
}

/* ------------------------------------------------------------------------ */
/*  Callable functions                                                       */
/* ------------------------------------------------------------------------ */

/** Health check used by the console to detect whether this backend is live. */
exports.adminPing = onCall(async (request) => {
  const actor = await requireAdmin(request);
  return { ok: true, region: REGION, at: Date.now(), caller: actor.uid };
});

/**
 * Firebase Auth metadata for the console's user table.
 * Pass `uids` to fetch specific accounts; omit it to list the project's users.
 */
exports.adminListUsers = onCall(async (request) => {
  await requireAdmin(request);
  const uids = Array.isArray(request.data && request.data.uids) ? request.data.uids.filter(Boolean) : null;

  if (uids && uids.length) {
    const users = [];
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100).map((uid) => ({ uid: String(uid) }));
      // eslint-disable-next-line no-await-in-loop
      const result = await auth.getUsers(chunk);
      users.push(...result.users.map(describeUser));
    }
    return { users, truncated: false };
  }

  const users = [];
  let pageToken;
  let truncated = false;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users.map(describeUser));
    pageToken = page.pageToken;
    if (users.length >= MAX_LIST_USERS) { truncated = Boolean(pageToken); break; }
  } while (pageToken);

  return { users, truncated };
});

/**
 * Create an Auth account and its `/users/{uid}` record.
 *
 * COMPATIBILITY NOTE: the initial password is the student's DNI because the
 * student-facing application (not part of this repository) authenticates with
 * email + DNI. The DNI is stored in the database as an identifier used for
 * searching, exactly as before; no password is ever written there. See
 * docs/SECURITY.md for the migration that removes this coupling.
 */
exports.adminCreateUser = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const { email, dni, stCode, role } = parseUserInput(request.data);

  let record;
  try {
    record = await auth.createUser({ email, password: dni, emailVerified: false, disabled: false });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Ya existe una cuenta con ese correo electrónico.');
    }
    if (error.code === 'auth/invalid-password') {
      throw new HttpsError('invalid-argument', 'El DNI no cumple el mínimo de 6 caracteres exigido por Firebase.');
    }
    logger.error('No se pudo crear la cuenta', { email, error: error.message });
    throw new HttpsError('internal', 'No se pudo crear la cuenta de acceso.');
  }

  const profile = {
    email,
    dni,
    stCode,
    createdAt: Date.now(),
    createdBy: actor.uid,
  };
  if (role === 'admin') profile.role = 'admin';

  await db.ref(`${USERS_PATH}/${record.uid}`).set(profile);
  if (role === 'admin') await auth.setCustomUserClaims(record.uid, { admin: true });

  await recordAudit(actor, {
    action: 'user.created',
    targetType: 'user',
    targetId: record.uid,
    targetLabel: email,
    meta: { stCode, role },
  });

  return { uid: record.uid, email };
});

/** Delete an Auth account and its database record. */
exports.adminDeleteUser = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const uid = requireUid(request.data);

  if (uid === actor.uid) {
    throw new HttpsError('failed-precondition', 'No puedes eliminar tu propia cuenta.');
  }

  const snapshot = await db.ref(`${USERS_PATH}/${uid}`).get();
  const profile = snapshot.val() || {};

  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      logger.error('No se pudo eliminar la cuenta', { uid, error: error.message });
      throw new HttpsError('internal', 'No se pudo eliminar la cuenta de acceso.');
    }
    logger.warn('La cuenta ya no existía en Auth; se elimina solo la ficha', { uid });
  }

  await db.ref(`${USERS_PATH}/${uid}`).remove();

  await recordAudit(actor, {
    action: 'user.deleted',
    targetType: 'user',
    targetId: uid,
    targetLabel: profile.email || uid,
    meta: { stCode: profile.stCode || '' },
  });

  return { uid };
});

/** Disable or re-enable an account without touching its data. */
exports.adminSetUserDisabled = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const uid = requireUid(request.data);
  const disabled = Boolean(request.data && request.data.disabled);

  if (uid === actor.uid && disabled) {
    throw new HttpsError('failed-precondition', 'No puedes deshabilitar tu propia cuenta.');
  }

  let record;
  try {
    record = await auth.updateUser(uid, { disabled });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'La cuenta indicada no existe.');
    }
    logger.error('No se pudo cambiar el estado de la cuenta', { uid, error: error.message });
    throw new HttpsError('internal', 'No se pudo cambiar el estado de la cuenta.');
  }

  await recordAudit(actor, {
    action: disabled ? 'user.disabled' : 'user.enabled',
    targetType: 'user',
    targetId: uid,
    targetLabel: record.email || uid,
  });

  return { uid, disabled };
});

/** Grant or revoke administrator access (custom claim + database role). */
exports.adminSetUserRole = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const uid = requireUid(request.data);
  const role = String((request.data && request.data.role) || '').trim().toLowerCase() === 'admin' ? 'admin' : 'student';

  if (uid === actor.uid && role !== 'admin') {
    throw new HttpsError('failed-precondition', 'No puedes retirarte tu propio rol de administrador.');
  }

  let record;
  try {
    record = await auth.getUser(uid);
  } catch (error) {
    throw new HttpsError('not-found', 'La cuenta indicada no existe.');
  }

  await auth.setCustomUserClaims(uid, role === 'admin' ? { admin: true } : { admin: false });

  const roleRef = db.ref(`${USERS_PATH}/${uid}/role`);
  if (role === 'admin') await roleRef.set('admin');
  else await roleRef.remove();

  await recordAudit(actor, {
    action: 'user.role_changed',
    targetType: 'user',
    targetId: uid,
    targetLabel: record.email || uid,
    meta: { role },
  });

  return { uid, role };
});

/**
 * Validate that an account exists and record the password-reset request.
 *
 * The reset email itself is delivered by Firebase Authentication in response to
 * the console's `sendPasswordResetEmail` call. That operation is unprivileged by
 * design (anyone may request a reset for their own address), so it stays on the
 * client while the audit trail is produced here, where it cannot be skipped.
 */
exports.adminSendPasswordReset = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const email = String((request.data && request.data.email) || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'El correo electrónico no es válido.');

  let record;
  try {
    record = await auth.getUserByEmail(email);
  } catch (error) {
    throw new HttpsError('not-found', 'No existe una cuenta con ese correo electrónico.');
  }

  await recordAudit(actor, {
    action: 'user.password_reset',
    targetType: 'user',
    targetId: record.uid,
    targetLabel: email,
  });

  return { uid: record.uid, email };
});

/** Create several accounts in one call (used by the CSV importer). */
exports.adminBulkCreateUsers = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const input = Array.isArray(request.data && request.data.users) ? request.data.users : [];

  if (!input.length) throw new HttpsError('invalid-argument', 'No se recibió ninguna fila para importar.');
  if (input.length > MAX_BULK_USERS) {
    throw new HttpsError('invalid-argument', `Envía como máximo ${MAX_BULK_USERS} usuarios por solicitud.`);
  }

  const created = [];
  const failed = [];

  for (const raw of input) {
    let values;
    try {
      values = parseUserInput(raw);
    } catch (error) {
      failed.push({ email: String((raw && raw.email) || ''), reason: error.message });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const record = await auth.createUser({
        email: values.email,
        password: values.dni,
        emailVerified: false,
        disabled: false,
      });

      const profile = {
        email: values.email,
        dni: values.dni,
        stCode: values.stCode,
        createdAt: Date.now(),
        createdBy: actor.uid,
      };
      if (values.role === 'admin') profile.role = 'admin';

      // eslint-disable-next-line no-await-in-loop
      await db.ref(`${USERS_PATH}/${record.uid}`).set(profile);
      if (values.role === 'admin') {
        // eslint-disable-next-line no-await-in-loop
        await auth.setCustomUserClaims(record.uid, { admin: true });
      }

      created.push({ uid: record.uid, email: values.email });
    } catch (error) {
      const reason = error.code === 'auth/email-already-exists'
        ? 'ya existe una cuenta con ese correo'
        : error.code === 'auth/invalid-password'
          ? 'el DNI no cumple el mínimo de 6 caracteres de Firebase'
          : 'no se pudo crear la cuenta';
      logger.warn('Fila omitida durante la importación', { email: values.email, code: error.code });
      failed.push({ email: values.email, reason });
    }
  }

  await recordAudit(actor, {
    action: 'user.bulk_import',
    targetType: 'user',
    targetLabel: `${created.length} cuentas creadas`,
    meta: { created: created.length, failed: failed.length, requested: input.length },
  });

  return { created, failed };
});

/**
 * Client for the privileged admin backend (Cloud Functions, see /functions).
 *
 * The browser never touches the Firebase Admin SDK. It calls HTTPS callable
 * functions with the administrator's ID token; the backend re-verifies that the
 * caller is an authorised administrator before doing anything, and writes the
 * audit entry itself.
 *
 * If the backend has not been deployed yet, `available()` reports false and the
 * UI degrades to read-only user management with an explanatory banner instead
 * of failing with an opaque error.
 */
import { functions } from '../core/firebase.js';
import { sendPasswordReset as sessionSendPasswordReset } from '../core/session.js';

const NAMES = {
  ping: 'adminPing',
  listUsers: 'adminListUsers',
  createUser: 'adminCreateUser',
  deleteUser: 'adminDeleteUser',
  setDisabled: 'adminSetUserDisabled',
  setRole: 'adminSetUserRole',
  sendPasswordReset: 'adminSendPasswordReset',
  bulkCreateUsers: 'adminBulkCreateUsers',
};

/** null = unknown, true/false = probed result. */
let backendStatus = null;

export function isBackendConfigured() {
  return functions() !== null;
}

export function backendKnownState() {
  return backendStatus;
}

async function call(name, payload = {}) {
  const fns = functions();
  if (!fns) {
    throw Object.assign(new Error('El backend de administración no está disponible en esta compilación.'), {
      code: 'not-found',
    });
  }
  try {
    const result = await fns.httpsCallable(name, { timeout: 120000 })(payload);
    backendStatus = true;
    return result.data;
  } catch (error) {
    if (error && (error.code === 'functions/not-found' || error.code === 'not-found')) backendStatus = false;
    console.error(`[adminApi] ${name} falló`, error);
    throw error;
  }
}

/** Health check; also used by the settings page. */
export async function ping() {
  const data = await call(NAMES.ping, {});
  return data;
}

/** Probe once, cache the answer. */
export async function available() {
  if (backendStatus !== null) return backendStatus;
  if (!isBackendConfigured()) { backendStatus = false; return false; }
  try {
    await ping();
    backendStatus = true;
  } catch {
    backendStatus = false;
  }
  return backendStatus;
}

/**
 * Firebase Auth metadata for the given uids (or all users when omitted).
 * @returns {Promise<{users: Array<{uid:string, email:string, disabled:boolean, emailVerified:boolean, createdAt:number, lastSignInAt:number, admin:boolean}>}>}
 */
export function listUsers(uids) {
  return call(NAMES.listUsers, Array.isArray(uids) && uids.length ? { uids } : {});
}

/**
 * Create an Auth account plus its `/users/{uid}` record.
 * The initial password is generated server-side (see functions/index.js).
 */
export function createUser({ email, dni, stCode, role }) {
  return call(NAMES.createUser, { email, dni, stCode, role });
}

export function deleteUser(uid) {
  return call(NAMES.deleteUser, { uid });
}

export function setUserDisabled(uid, disabled) {
  return call(NAMES.setDisabled, { uid, disabled });
}

export function setUserRole(uid, role) {
  return call(NAMES.setRole, { uid, role });
}

/**
 * Ask Firebase to email a password-reset link.
 *
 * The backend verifies the caller is an administrator, checks the account
 * exists and writes the audit entry; Firebase Authentication then delivers the
 * email in response to the unprivileged `sendPasswordResetEmail` call. The
 * administrator never sees or needs the person's password.
 */
export async function sendPasswordReset(email) {
  const result = await call(NAMES.sendPasswordReset, { email });
  await sessionSendPasswordReset(email);
  return result;
}

/** @param {Array<{email:string, dni:string, stCode:string, role?:string}>} users */
export function bulkCreateUsers(users) {
  return call(NAMES.bulkCreateUsers, { users });
}

export const BACKEND_UNAVAILABLE_MESSAGE =
  'Las operaciones de cuentas requieren el backend de administración (Cloud Functions). '
  + 'Despliega las funciones con "firebase deploy --only functions" para habilitarlas.';

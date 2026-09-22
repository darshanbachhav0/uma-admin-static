/**
 * Authentication session and admin authorisation.
 *
 * Persistence is LOCAL: administrators stay signed in across reloads, which is
 * the expected behaviour for an internal console. The previous implementation
 * forced `Persistence.NONE` and signed everybody out on every page load.
 *
 * Authorisation is resolved from two sources:
 *   1. the `admin` custom claim, when one has been set manually on the
 *      account (e.g. via the Firebase Admin SDK) — preferred;
 *   2. `/users/{uid}/role === 'admin'` in the Realtime Database — the normal
 *      path, since administrator accounts are managed directly in Firebase
 *      Console and this database record.
 */
import { auth, db, configError, DB_PATHS } from './firebase.js';

const listeners = new Set();

const state = {
  status: 'loading', // 'loading' | 'signed-out' | 'authorized' | 'unauthorized'
  user: null,
  isAdmin: false,
  hasAdminClaim: false,
  roleSource: null, // 'claim' | 'database' | null
  error: null,
};

export function getSession() {
  return { ...state };
}

/** Subscribe to session changes. Returns an unsubscribe function. */
export function onSession(listener) {
  listeners.add(listener);
  listener(getSession());
  return () => listeners.delete(listener);
}

function emit(patch) {
  Object.assign(state, patch);
  const snapshot = getSession();
  listeners.forEach((listener) => listener(snapshot));
}

/** Start observing Firebase auth. Called once from main.js. */
export function startSession() {
  if (configError) {
    emit({ status: 'signed-out', error: configError });
    return;
  }

  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch((error) => console.warn('[session] no se pudo fijar la persistencia LOCAL', error));

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      emit({ status: 'signed-out', user: null, isAdmin: false, hasAdminClaim: false, roleSource: null, error: null });
      return;
    }

    emit({ status: 'loading', user, error: null });

    try {
      const authorization = await resolveAuthorization(user);
      emit({
        status: authorization.isAdmin ? 'authorized' : 'unauthorized',
        user,
        isAdmin: authorization.isAdmin,
        hasAdminClaim: authorization.hasAdminClaim,
        roleSource: authorization.source,
        error: null,
      });
    } catch (error) {
      console.error('[session] no se pudo verificar el rol de administrador', error);
      emit({
        status: 'unauthorized',
        user,
        isAdmin: false,
        hasAdminClaim: false,
        roleSource: null,
        error: 'No se pudo verificar tus permisos. Revisa tu conexión o las reglas de la base de datos.',
      });
    }
  });
}

async function resolveAuthorization(user) {
  const token = await user.getIdTokenResult(true);
  const hasAdminClaim = token.claims && token.claims.admin === true;
  if (hasAdminClaim) return { isAdmin: true, hasAdminClaim: true, source: 'claim' };

  const snapshot = await db.ref(DB_PATHS.users).child(user.uid).child('role').get();
  const role = String(snapshot.val() || '').trim().toLowerCase();
  return { isAdmin: role === 'admin', hasAdminClaim: false, source: role === 'admin' ? 'database' : null };
}

/** Refresh the ID token so a newly granted `admin` claim takes effect. */
export async function refreshAuthorization() {
  const user = auth && auth.currentUser;
  if (!user) return getSession();
  const authorization = await resolveAuthorization(user);
  emit({
    status: authorization.isAdmin ? 'authorized' : 'unauthorized',
    isAdmin: authorization.isAdmin,
    hasAdminClaim: authorization.hasAdminClaim,
    roleSource: authorization.source,
  });
  return getSession();
}

export function signIn(email, password) {
  return auth.signInWithEmailAndPassword(String(email).trim(), password);
}

/**
 * Sign out. Always available — including from the "no tienes acceso" screen,
 * which previously trapped non-admin users with no way back.
 */
export function signOut() {
  return auth ? auth.signOut() : Promise.resolve();
}

export function currentUid() {
  return state.user ? state.user.uid : null;
}

export function currentEmail() {
  return state.user ? state.user.email || '' : '';
}

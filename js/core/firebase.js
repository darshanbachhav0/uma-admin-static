/**
 * Firebase bootstrap (compat SDK v10).
 *
 * `window.umaConfig` is produced at build time by `render-build.sh` from
 * environment variables. The web API key and database URL it contains are
 * public by design; no service-account credential is ever shipped to the
 * browser. This app talks to Firebase Authentication and Realtime Database
 * directly from the client — there is no privileged backend.
 */

const config = window.umaConfig || {};
const firebaseConfig = config.firebase || null;

export const configError = (() => {
  if (!window.firebase) return 'No se pudo cargar el SDK de Firebase. Revisa tu conexión a internet.';
  if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('${')) {
    return 'La configuración de Firebase no está disponible. Genera config.js ejecutando render-build.sh con las variables de entorno del proyecto.';
  }
  if (!firebaseConfig.databaseURL) {
    return 'Falta FIREBASE_DATABASE_URL en la configuración generada.';
  }
  return null;
})();

export const app = configError ? null : firebase.initializeApp(firebaseConfig);
export const auth = configError ? null : firebase.auth();
export const db = configError ? null : firebase.database();

export const UNSPLASH_ACCESS_KEY = (() => {
  const key = config.unsplashAccessKey;
  return key && !String(key).startsWith('${') ? String(key) : '';
})();

export const DB_PATHS = Object.freeze({
  events: 'events',
  users: 'users',
  auditLogs: 'auditLogs',
});

/** Database URL shown on the settings page (never a secret). */
export const DATABASE_URL = firebaseConfig ? firebaseConfig.databaseURL || '' : '';
export const PROJECT_ID = firebaseConfig ? firebaseConfig.projectId || '' : '';

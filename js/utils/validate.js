/** Input validation and sanitisation shared by every form in the console. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

/**
 * Strip invisible control characters from free text.
 *
 * Single-line fields (titles, locations, tags) turn line breaks and tabs into
 * spaces so pasted text never glues words together. Multi-line fields
 * (descriptions) keep their line breaks and blank lines, so lists and
 * paragraphs stay as the administrator wrote them.
 */
export function cleanText(value, maxLength = 2000, { multiline = false } = {}) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n');
  if (multiline) {
    text = text
      // Remove control characters except tab (\x09) and line break (\x0A).
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
      .replace(/[ \t]+$/gm, '')     // trailing spaces on each line
      .replace(/\n{3,}/g, '\n\n');  // at most one empty line in a row
  } else {
    text = text
      .replace(/[\t\n]+/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, '');
  }
  return text.trim().slice(0, maxLength);
}

/** Normalise a comma separated tag list into unique, trimmed, lowercase tags. */
export function parseTags(value, { max = 12, maxLength = 32 } = {}) {
  const seen = new Set();
  const tags = [];
  for (const raw of String(value || '').split(',')) {
    const tag = cleanText(raw, maxLength).toLowerCase();
    if (!tag) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= max) break;
  }
  return tags;
}

/**
 * Only allow absolute http(s) URLs. Returns '' for anything else, which blocks
 * `javascript:` and `data:` URLs from ever reaching an `src`/`href`.
 */
export function safeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
}

/**
 * Translate a Firebase error into a message an administrator can act on.
 * The raw error is still logged to the console for debugging.
 */
const FIREBASE_MESSAGES = {
  'auth/invalid-email': 'El correo electrónico no tiene un formato válido.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada. Contacta al equipo de sistemas.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/too-many-requests': 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.',
  'auth/requires-recent-login': 'Por seguridad, vuelve a iniciar sesión antes de realizar esta acción.',
  'auth/missing-password': 'Escribe tu contraseña.',
  PERMISSION_DENIED: 'No tienes permisos para realizar esta operación.',
  'permission-denied': 'No tienes permisos para realizar esta operación.',
};

export function describeError(error, fallback = 'Ocurrió un error inesperado. Inténtalo de nuevo.') {
  if (!error) return fallback;
  const code = error.code || error.name;
  if (code && FIREBASE_MESSAGES[code]) return FIREBASE_MESSAGES[code];
  if (error.message && !/firebase|https?:\/\//i.test(error.message)) return error.message;
  return fallback;
}

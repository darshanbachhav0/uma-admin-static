/**
 * Unsplash image suggestions for event covers.
 *
 * Only the public Access Key is used, and only from the browser; the Secret Key
 * must never be part of the client configuration. When no key is configured the
 * legacy keyless endpoint is attempted and, if it fails, the administrator is
 * told to paste an image URL manually instead of being left with a broken card.
 */
import { UNSPLASH_ACCESS_KEY } from '../core/firebase.js';
import { safeUrl } from '../utils/validate.js';

export const hasUnsplashKey = Boolean(UNSPLASH_ACCESS_KEY);

export class UnsplashError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'UnsplashError';
    this.cause = cause;
  }
}

/**
 * Suggest a landscape photo for the given query.
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<{imageUrl:string, credit:object|null}>}
 */
export async function suggestImage(query, signal) {
  const term = buildQuery(query);
  if (UNSPLASH_ACCESS_KEY) return viaApi(term, signal);
  return viaKeylessEndpoint(term, signal);
}

function buildQuery(query) {
  const cleaned = String(query || '').trim().replace(/\s+/g, ' ');
  return cleaned || 'university event';
}

async function viaApi(query, signal) {
  const url = 'https://api.unsplash.com/photos/random'
    + '?count=1&orientation=landscape&content_filter=high'
    + `&query=${encodeURIComponent(query)}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new UnsplashError('No hay conexión con Unsplash.', error);
  }

  if (response.status === 401 || response.status === 403) {
    throw new UnsplashError('La clave de Unsplash no es válida o alcanzó su límite de uso.');
  }
  if (response.status === 404) {
    throw new UnsplashError(`Unsplash no encontró imágenes para "${query}".`);
  }
  if (!response.ok) {
    throw new UnsplashError(`Unsplash respondió con un error (${response.status}).`);
  }

  const data = await response.json();
  const photo = Array.isArray(data) ? data[0] : data;
  if (!photo) throw new UnsplashError(`Unsplash no encontró imágenes para "${query}".`);

  const imageUrl = safeUrl(photo.urls && (photo.urls.regular || photo.urls.full || photo.urls.small));
  if (!imageUrl) throw new UnsplashError('Unsplash devolvió una imagen no válida.');

  // Download tracking required by the Unsplash API guidelines. Best effort:
  // a failure here must not prevent the administrator from using the image.
  const downloadLocation = photo.links && photo.links.download_location;
  if (downloadLocation) {
    fetch(downloadLocation, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } })
      .catch((error) => console.warn('[unsplash] no se pudo notificar la descarga', error));
  }

  return {
    imageUrl,
    credit: {
      source: 'Unsplash',
      photoId: String(photo.id || ''),
      authorName: String((photo.user && photo.user.name) || ''),
      authorLink: safeUrl(photo.user && photo.user.links && photo.user.links.html),
      photoLink: safeUrl(photo.links && photo.links.html),
    },
  };
}

async function viaKeylessEndpoint(query, signal) {
  const url = `https://source.unsplash.com/featured/1200x800?${encodeURIComponent(query)}&sig=${Date.now()}`;
  let response;
  try {
    response = await fetch(url, { redirect: 'follow', cache: 'no-store', signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new UnsplashError(
      'No se pudo obtener una imagen automáticamente. Configura UNSPLASH_ACCESS_KEY o pega la URL de una imagen.',
      error);
  }
  const imageUrl = safeUrl(response.url);
  if (!response.ok || !imageUrl) {
    throw new UnsplashError(
      'No se pudo obtener una imagen automáticamente. Configura UNSPLASH_ACCESS_KEY o pega la URL de una imagen.');
  }
  return { imageUrl, credit: { source: 'Unsplash' } };
}

/** Human-readable attribution line, or null when there is nothing to credit. */
export function creditText(credit) {
  if (!credit) return null;
  if (credit.authorName) return `Foto de ${credit.authorName} en ${credit.source || 'Unsplash'}`;
  return `Imagen de ${credit.source || 'Unsplash'}`;
}

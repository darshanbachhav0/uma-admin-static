/**
 * Event cover image upload.
 *
 * 1. `prepareEventImage(file)` resizes the picture in the browser to a 16:9
 *    JPEG (1600 × 900 at most), the shape used by the event cards:
 *      - pictures that are already close to 16:9 are centre-cropped;
 *      - posters, flyers and other tall or very wide pictures are shown whole,
 *        centred on a blurred copy of themselves, so no text is cut off.
 * 2. `uploadEventImage(blob)` stores the result in Firebase Storage under
 *    `eventImages/` and returns its https download address, which goes in the
 *    event's existing `imageUrl` field. The student app needs no change.
 *
 * Storage security rules: see storage.rules.event-images and
 * docs/DEPLOYMENT.md.
 */
import { storage } from '../core/firebase.js';

export const TARGET_WIDTH = 1600;
export const TARGET_HEIGHT = 900;
const MIN_WIDTH = 640;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 900 * 1024;
// Pictures whose shape is within 20 % of 16:9 are cropped; others are fitted.
const CROP_TOLERANCE = 0.2;

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'];
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',');

export class ImageUploadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

const STORAGE_FOLDER = 'eventImages';

/** True when Firebase Storage is available (bucket configured, SDK loaded). */
export function isImageUploadConfigured() {
  return Boolean(storage);
}

function checkFile(file) {
  if (!file) throw new ImageUploadError('No se seleccionó ninguna imagen.');
  const name = String(file.name || '').toLowerCase();
  if (/\.(heic|heif)$/.test(name) || /heic|heif/.test(file.type)) {
    throw new ImageUploadError('Las fotos HEIC del iPhone no son compatibles. Guárdala como JPG o PNG e inténtalo de nuevo.');
  }
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageUploadError('Formato no compatible. Usa una imagen JPG, PNG o WebP.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageUploadError('La imagen pesa más de 15 MB. Usa una imagen más liviana.');
  }
  if (file.size === 0) throw new ImageUploadError('El archivo está vacío.');
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // Applies the photo's EXIF rotation, so phone pictures are upright.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall back to <img> below (older Safari rejects the options object).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new ImageUploadError('No se pudo leer la imagen. Puede estar dañada o en un formato no compatible.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(source) {
  return {
    width: source.naturalWidth || source.width || 0,
    height: source.naturalHeight || source.height || 0,
  };
}

/**
 * Work out the output size and how to place the picture in it.
 * Exported for tests.
 */
export function planLayout(width, height) {
  if (!width || !height) throw new ImageUploadError('La imagen no tiene dimensiones válidas.');
  const target = TARGET_WIDTH / TARGET_HEIGHT;
  const ratio = width / height;
  const mode = Math.abs(ratio / target - 1) <= CROP_TOLERANCE ? 'crop' : 'fit';

  // Do not enlarge small pictures more than needed: the output is never wider
  // than the part of the picture that is shown, but at least MIN_WIDTH.
  const shownWidth = mode === 'crop' ? Math.min(width, height * target) : Math.max(width, height * target);
  const outWidth = Math.round(Math.min(TARGET_WIDTH, Math.max(MIN_WIDTH, shownWidth)));
  const outHeight = Math.round(outWidth / target);

  // Rectangle (in output pixels) where the picture is drawn.
  let scale;
  if (mode === 'crop') scale = Math.max(outWidth / width, outHeight / height);
  else scale = Math.min(outWidth / width, outHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    mode,
    width: outWidth,
    height: outHeight,
    draw: {
      x: (outWidth - drawWidth) / 2,
      y: (outHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    },
  };
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A soft, blurred copy of the picture that fills the whole frame. */
function drawBlurredBackground(ctx, source, width, height, layout) {
  // Shrinking to a tiny canvas and stretching it back is a blur that works in
  // every browser (canvas `filter` is not available in all of them).
  const small = canvasOf(32, 18);
  const sctx = small.getContext('2d');
  const { width: sw, height: sh } = sizeOf(source);
  const cover = Math.max(32 / sw, 18 / sh);
  sctx.drawImage(source, (32 - sw * cover) / 2, (18 - sh * cover) / 2, sw * cover, sh * cover);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, -width * 0.05, -height * 0.05, width * 1.1, height * 1.1);
  // Darken slightly so the picture in front stands out.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(0, 0, layout.width, layout.height);
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageUploadError('No se pudo procesar la imagen.'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Resize and reshape a picture for an event cover.
 * @returns {Promise<{blob:Blob, width:number, height:number, mode:'crop'|'fit',
 *                    original:{width:number,height:number}}>}
 */
export async function prepareEventImage(file) {
  checkFile(file);
  const source = await decode(file);
  try {
    const original = sizeOf(source);
    const layout = planLayout(original.width, original.height);
    const canvas = canvasOf(layout.width, layout.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageUploadError('Este navegador no puede procesar imágenes.');

    // White first, so transparent PNGs do not turn black in the JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, layout.width, layout.height);
    if (layout.mode === 'fit') drawBlurredBackground(ctx, source, layout.width, layout.height, layout);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const { x, y, width, height } = layout.draw;
    ctx.drawImage(source, x, y, width, height);

    let blob = null;
    for (const quality of [0.86, 0.78, 0.7, 0.6]) {
      blob = await toBlob(canvas, quality);
      if (blob.size <= MAX_OUTPUT_BYTES) break;
    }
    return { blob, width: layout.width, height: layout.height, mode: layout.mode, original };
  } finally {
    if (typeof source.close === 'function') source.close();
  }
}

function randomId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function describeStorageError(error) {
  const code = error && error.code ? String(error.code) : '';
  if (code === 'storage/unauthorized') {
    return 'No tienes permiso para subir imágenes. Revisa que las reglas de Storage (storage.rules.event-images) estén publicadas e incluyan tu cuenta.';
  }
  if (code === 'storage/quota-exceeded') return 'Se superó la cuota de Firebase Storage.';
  if (code === 'storage/retry-limit-exceeded') return 'La conexión es inestable. Inténtalo de nuevo.';
  if (code === 'storage/unauthenticated') return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (code === 'storage/bucket-not-found' || code === 'storage/project-not-found') {
    return 'Firebase Storage no está activado en el proyecto o FIREBASE_STORAGE_BUCKET no es correcto.';
  }
  return 'No se pudo subir la imagen. Inténtalo de nuevo.';
}

/**
 * Upload a prepared JPEG to Firebase Storage.
 * @param {Blob} blob
 * @param {{signal?:AbortSignal, onProgress?:(percent:number)=>void, folder?:string}} [options]
 * @returns {Promise<string>} The https download address of the image.
 */
export async function uploadEventImage(blob, { signal, onProgress, folder } = {}) {
  if (!storage) {
    throw new ImageUploadError('Firebase Storage no está disponible. Revisa FIREBASE_STORAGE_BUCKET en Render.');
  }
  const safeFolder = /^[A-Za-z0-9_-]{1,64}$/.test(folder || '') ? folder : 'nuevos';
  const path = `${STORAGE_FOLDER}/${safeFolder}/${Date.now()}-${randomId()}.jpg`;
  const ref = storage.ref(path);
  const task = ref.put(blob, {
    contentType: 'image/jpeg',
    cacheControl: 'public, max-age=31536000, immutable',
  });

  const onAbort = () => task.cancel();
  if (signal) {
    if (signal.aborted) task.cancel();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    await new Promise((resolve, reject) => {
      task.on('state_changed',
        (snapshot) => {
          if (typeof onProgress === 'function' && snapshot.totalBytes) {
            onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
          }
        },
        reject,
        resolve);
    });
  } catch (error) {
    if (error && error.code === 'storage/canceled') {
      throw Object.assign(new Error('Subida cancelada'), { name: 'AbortError' });
    }
    console.error('[imagenes] Firebase Storage', error);
    throw new ImageUploadError(describeStorageError(error));
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  const url = String(await ref.getDownloadURL());
  if (!/^https:\/\//.test(url)) throw new ImageUploadError('Firebase Storage no devolvió un enlace válido.');
  return url;
}

/** True when `url` is an image this console uploaded to the project's bucket. */
export function isUploadedEventImage(url) {
  if (!storage || typeof url !== 'string') return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  const bucket = storage.app.options.storageBucket;
  const inBucket = parsed.hostname === 'firebasestorage.googleapis.com'
    && parsed.pathname.startsWith(`/v0/b/${bucket}/o/`);
  if (!inBucket) return false;
  const objectPath = decodeURIComponent(parsed.pathname.slice(`/v0/b/${bucket}/o/`.length));
  return objectPath.startsWith(`${STORAGE_FOLDER}/`);
}

/**
 * Delete an uploaded image. Never throws: a leftover file is harmless, so a
 * failed clean-up must not block saving or deleting an event.
 */
export async function deleteUploadedEventImage(url) {
  if (!isUploadedEventImage(url)) return;
  try {
    await storage.refFromURL(url).delete();
  } catch (error) {
    if (error && error.code === 'storage/object-not-found') return;
    console.warn('[imagenes] no se pudo borrar la imagen anterior', error);
  }
}

/**
 * Event cover image upload.
 *
 * 1. `prepareEventImage(file)` resizes the picture in the browser to a 16:9
 *    JPEG (1600 × 900 at most), the shape used by the event cards:
 *      - pictures that are already close to 16:9 are centre-cropped;
 *      - posters, flyers and other tall or very wide pictures are shown whole,
 *        centred on a blurred copy of themselves, so no text is cut off.
 * 2. `uploadEventImage(blob)` sends the result to Cloudinary with an
 *    *unsigned upload preset* and returns its https address, which is stored
 *    in the event's existing `imageUrl` field. The student app needs no change.
 *
 * Cloudinary is used because Firebase Storage requires the paid Blaze plan.
 * Only the public cloud name and preset name are in the browser; there is no
 * secret key (see docs/DEPLOYMENT.md).
 */

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

function readConfig() {
  const raw = (window.umaConfig && window.umaConfig.imageUpload) || {};
  const clean = (value) => {
    const text = String(value || '').trim();
    // An unreplaced "${VAR}" placeholder means the variable was not set.
    return /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
  };
  return { cloudName: clean(raw.cloudName), uploadPreset: clean(raw.uploadPreset) };
}

/** True when the Cloudinary cloud name and upload preset are configured. */
export function isImageUploadConfigured() {
  const { cloudName, uploadPreset } = readConfig();
  return Boolean(cloudName && uploadPreset);
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

/**
 * Upload a prepared JPEG to Cloudinary.
 * @returns {Promise<string>} The https address of the uploaded image.
 */
export async function uploadEventImage(blob, { signal } = {}) {
  const { cloudName, uploadPreset } = readConfig();
  if (!cloudName || !uploadPreset) {
    throw new ImageUploadError('La subida de imágenes no está configurada. Revisa CLOUDINARY_CLOUD_NAME y CLOUDINARY_UPLOAD_PRESET en Render.');
  }

  const form = new FormData();
  form.append('file', blob, 'evento.jpg');
  form.append('upload_preset', uploadPreset);

  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
      method: 'POST',
      body: form,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ImageUploadError('No hay conexión con el servicio de imágenes. Revisa tu red e inténtalo de nuevo.');
  }

  let data = {};
  try { data = await response.json(); } catch { /* handled below */ }

  if (!response.ok) {
    const detail = data && data.error && data.error.message ? String(data.error.message) : '';
    console.error('[imagenes] Cloudinary respondió', response.status, detail);
    if (/preset/i.test(detail)) {
      throw new ImageUploadError('El «upload preset» de Cloudinary no existe o no es de tipo Unsigned. Revisa la configuración.');
    }
    if (/cloud name|unknown api key|invalid cloud/i.test(detail) || response.status === 401) {
      throw new ImageUploadError('El nombre de la cuenta de Cloudinary (cloud name) no es correcto.');
    }
    throw new ImageUploadError('No se pudo subir la imagen. Inténtalo de nuevo.');
  }

  const url = String((data && data.secure_url) || '');
  if (!/^https:\/\//.test(url)) throw new ImageUploadError('El servicio de imágenes no devolvió un enlace válido.');
  return url;
}

/**
 * Downloadable documents attached to an event (e.g. forms and schedules).
 *
 * Files are stored in the Realtime Database, deliberately OUTSIDE `/events`, so
 * the student app's normal event listing never downloads them:
 *
 *   /eventDocuments/{eventId}                       public index (small)
 *     { eventTitle, updatedAt, documents: { {docId}: { title, order, files: {
 *         pdf|docx|doc: { fileName, contentType, size, uploadedAt } } } } }
 *
 *   /eventDocumentData/{eventId}/{docId}/{format}   base64 file contents
 *
 *   /events/{eventId}/documentsUrl                  link the app opens
 *   /events/{eventId}/documentCount                 number of documents
 *
 * Both document paths are publicly readable one event / one file at a time,
 * so the public download page (documentos.html) works without a login.
 */
import { db, DB_PATHS } from '../core/firebase.js';

export const DOC_PATHS = Object.freeze({
  index: 'eventDocuments',
  data: 'eventDocumentData',
});

/** 5 MB per file keeps the base64 payload (~6.7 MB) under the 7 MB rule limit. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const FORMATS = Object.freeze({
  pdf: {
    label: 'PDF',
    extensions: ['pdf'],
    contentTypes: ['application/pdf'],
    accept: '.pdf,application/pdf',
  },
  word: {
    label: 'Word',
    extensions: ['docx', 'doc'],
    contentTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ],
    accept: '.docx,.doc,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
});

const CONTENT_TYPE_BY_EXT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

/** Storage key for a file: 'pdf', 'docx' or 'doc' (the extension). */
export function fileFormat(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ? ext : null;
}

/** Which slot ('pdf' or 'word') a stored format belongs to. */
export function slotForFormat(format) {
  return format === 'pdf' ? 'pdf' : 'word';
}

/**
 * Validate a picked file against a slot.
 * @returns {string|null} An error message, or null when the file is acceptable.
 */
export function validateFile(file, slot) {
  if (!file) return 'No se seleccionó ningún archivo.';
  const format = fileFormat(file.name);
  const expected = FORMATS[slot];
  if (!format || !expected.extensions.includes(format)) {
    return slot === 'pdf'
      ? 'Selecciona un archivo PDF (.pdf).'
      : 'Selecciona un documento de Word (.docx o .doc).';
  }
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > MAX_FILE_BYTES) return 'El archivo supera el máximo de 5 MB.';
  return null;
}

/** A new, unique document id (a database push key). */
export function newDocumentId() {
  return db.ref(DOC_PATHS.index).push().key;
}

/** Public URL of the download page for an event, on the site serving the console. */
export function documentsPageUrl(eventId) {
  return new URL(`documentos.html?evento=${encodeURIComponent(eventId)}`, window.location.href).href;
}

/** Read a File as a base64 string (without the `data:` prefix). */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Load the document index of an event.
 * @returns {Promise<Array<{id:string, title:string, order:number, files:Object}>>}
 */
export async function loadEventDocuments(eventId) {
  const snapshot = await db.ref(DOC_PATHS.index).child(eventId).child('documents').get();
  const value = snapshot.val() || {};
  return Object.entries(value)
    .filter(([, doc]) => doc && typeof doc === 'object')
    .map(([id, doc]) => ({
      id,
      title: typeof doc.title === 'string' ? doc.title : '',
      order: Number(doc.order) || 0,
      files: doc.files && typeof doc.files === 'object' ? doc.files : {},
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * Persist the documents of an event.
 *
 * @param {object} params
 * @param {string} params.eventId
 * @param {string} params.eventTitle
 * @param {Array<{id?:string, title:string, files:Object<string,{file?:File, meta?:Object}>}>} params.documents
 *        Desired final state. Each slot ('pdf', 'word') holds either a newly
 *        picked `file` or the existing stored `meta` ({ format, fileName, … }).
 * @param {Array} params.previous The index as loaded before editing.
 * @param {(message:string)=>void} [params.onProgress]
 */
export async function saveEventDocuments({ eventId, eventTitle, documents, previous, onProgress }) {
  const dataRef = db.ref(DOC_PATHS.data).child(eventId);
  const now = Date.now();

  const uploads = [];
  const nextIndex = {};
  const kept = new Set(); // "docId/format" pairs that remain stored

  documents.forEach((doc, order) => {
    const docId = doc.id || newDocumentId();
    const files = {};

    for (const slot of Object.keys(FORMATS)) {
      const entry = doc.files[slot];
      if (!entry) continue;

      if (entry.file) {
        const format = fileFormat(entry.file.name);
        files[format] = {
          fileName: entry.file.name,
          contentType: CONTENT_TYPE_BY_EXT[format],
          size: entry.file.size,
          uploadedAt: now,
        };
        uploads.push({ docId, format, file: entry.file });
        kept.add(`${docId}/${format}`);
      } else if (entry.meta) {
        files[entry.meta.format] = {
          fileName: entry.meta.fileName,
          contentType: entry.meta.contentType,
          size: entry.meta.size,
          uploadedAt: entry.meta.uploadedAt,
        };
        kept.add(`${docId}/${entry.meta.format}`);
      }
    }

    nextIndex[docId] = { title: doc.title, order, files };
  });

  // 1. Upload new file contents one by one (keeps each write small).
  for (let i = 0; i < uploads.length; i += 1) {
    const { docId, format, file } = uploads[i];
    if (onProgress) onProgress(`Subiendo documentos (${i + 1} de ${uploads.length})…`);
    // eslint-disable-next-line no-await-in-loop
    const base64 = await readAsBase64(file);
    // eslint-disable-next-line no-await-in-loop
    await dataRef.child(docId).child(format).set(base64);
  }

  // 2. Swap the index and the event's link in one atomic update, and drop
  //    the contents of any file that was removed or replaced.
  const update = {};
  for (const doc of previous) {
    for (const format of Object.keys(doc.files)) {
      if (!kept.has(`${doc.id}/${format}`)) update[`${DOC_PATHS.data}/${eventId}/${doc.id}/${format}`] = null;
    }
  }

  const count = documents.length;
  if (count) {
    update[`${DOC_PATHS.index}/${eventId}`] = { eventTitle, updatedAt: now, documents: nextIndex };
    update[`${DB_PATHS.events}/${eventId}/documentsUrl`] = documentsPageUrl(eventId);
    update[`${DB_PATHS.events}/${eventId}/documentCount`] = count;
  } else {
    update[`${DOC_PATHS.index}/${eventId}`] = null;
    update[`${DOC_PATHS.data}/${eventId}`] = null;
    update[`${DB_PATHS.events}/${eventId}/documentsUrl`] = null;
    update[`${DB_PATHS.events}/${eventId}/documentCount`] = null;
  }

  if (onProgress) onProgress('Guardando documentos…');
  await db.ref().update(update);
}

/** Multi-path update fragment that removes every document of an event. */
export function documentsDeletionUpdate(eventId) {
  return {
    [`${DOC_PATHS.index}/${eventId}`]: null,
    [`${DOC_PATHS.data}/${eventId}`]: null,
  };
}

/** Human-readable size, e.g. "365 KB" or "1,2 MB". */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`;
}

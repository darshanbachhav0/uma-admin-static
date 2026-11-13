/**
 * Public download page for an event's documents: documentos.html?evento=<id>
 *
 * Opened by the student app from an event's `documentsUrl`. Reads the public
 * document index and file contents through the Realtime Database REST API, so
 * it needs neither a login nor the Firebase SDK.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const root = document.getElementById('documents-root');
const databaseURL = String((window.umaConfig && window.umaConfig.firebase && window.umaConfig.firebase.databaseURL) || '')
  .replace(/\/+$/, '');
const eventId = new URLSearchParams(window.location.search).get('evento') || '';

const FORMAT_INFO = {
  pdf: { label: 'PDF', order: 0 },
  docx: { label: 'Word', order: 1 },
  doc: { label: 'Word', order: 2 },
};

function dbUrl(path) {
  return `${databaseURL}/${path.map(encodeURIComponent).join('/')}.json`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`;
}

function showState(title, text, tone = 'info') {
  replaceChildren(root, h('div', { class: ['public-state', tone === 'error' ? 'public-state--error' : ''], role: 'alert' },
    h('span', { class: 'public-state__icon' }, icon(tone === 'error' ? 'alert-triangle' : 'file-text', { size: 24 })),
    h('h1', { class: 'public-state__title', text: title }),
    text ? h('p', { class: 'public-state__text', text }) : null));
}

async function fetchJson(path) {
  const response = await fetch(dbUrl(path), { cache: 'no-store' });
  if (response.status === 401 || response.status === 403) {
    const error = new Error('denied');
    error.denied = true;
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Decode base64 into a Blob and hand it to the browser as a download. */
function saveBase64(base64, fileName, contentType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType || 'application/octet-stream' }));
  const link = h('a', { href: url, download: fileName || 'documento' });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadButton(docId, format, file, primary) {
  const info = FORMAT_INFO[format];
  const label = h('span', { text: `Descargar ${info.label}` });
  const btn = h('button', {
    class: ['btn', primary ? 'btn--primary' : 'btn--secondary'],
    type: 'button',
  },
    h('span', { class: 'btn__spinner' }, h('span', { class: 'spinner' })),
    h('span', { class: 'btn__icon', style: { display: 'inline-flex' } }, icon('download', { size: 16 })),
    label,
    h('span', { class: 'doc-card__size', text: `· ${formatBytes(file.size)}` }));

  btn.addEventListener('click', async () => {
    if (btn.classList.contains('is-loading')) return;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    label.textContent = 'Descargando…';
    try {
      const base64 = await fetchJson(['eventDocumentData', eventId, docId, format]);
      if (typeof base64 !== 'string' || !base64) throw new Error('missing');
      saveBase64(base64, file.fileName, file.contentType);
      label.textContent = `Descargar ${info.label}`;
    } catch (error) {
      console.error('[documentos] descarga fallida', error);
      label.textContent = 'No se pudo descargar. Reintentar';
    } finally {
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
    }
  });
  return btn;
}

function render(index) {
  const documents = Object.entries(index.documents || {})
    .filter(([, doc]) => doc && doc.files && Object.keys(doc.files).length)
    .sort(([, a], [, b]) => (Number(a.order) || 0) - (Number(b.order) || 0));

  if (!documents.length) {
    showState('Sin documentos', 'Este evento no tiene documentos disponibles para descargar.');
    return;
  }

  const eventTitle = typeof index.eventTitle === 'string' && index.eventTitle ? index.eventTitle : 'Documentos del evento';
  document.title = `${eventTitle} · Documentos · Universidad María Auxiliadora`;

  const cards = documents.map(([docId, doc]) => {
    const formats = Object.keys(doc.files)
      .filter((format) => FORMAT_INFO[format])
      .sort((a, b) => FORMAT_INFO[a].order - FORMAT_INFO[b].order);

    return h('article', { class: 'doc-card' },
      h('div', { class: 'doc-card__head' },
        h('span', { class: 'doc-card__icon', 'aria-hidden': 'true' }, icon('file-text', { size: 22 })),
        h('div', { class: 'doc-card__text' },
          h('h3', { class: 'doc-card__title', text: doc.title || 'Documento' }),
          h('p', { class: 'doc-card__desc', text: `Disponible en ${formats.map((f) => FORMAT_INFO[f].label).join(' y ')}.` }))),
      h('div', { class: 'doc-card__actions' },
        ...formats.map((format, i) => downloadButton(docId, format, doc.files[format], i === 0))));
  });

  replaceChildren(root,
    h('section', { class: 'public-hero', 'aria-labelledby': 'page-title' },
      h('span', { class: 'public-hero__eyebrow', text: 'Documentos del evento' }),
      h('h1', { class: 'public-hero__title', id: 'page-title', text: eventTitle }),
      h('p', { class: 'public-hero__text', text: 'Descarga los documentos de este evento.' })),
    h('section', { class: 'public-section', 'aria-label': 'Documentos' },
      h('div', { class: 'doc-list' }, ...cards)));
}

async function init() {
  if (!eventId) {
    showState('Enlace no válido', 'Este enlace no indica a qué evento pertenecen los documentos.', 'error');
    return;
  }
  if (!databaseURL || databaseURL.includes('${')) {
    showState('Documentos no disponibles', 'El sitio no está configurado correctamente. Inténtalo más tarde.', 'error');
    return;
  }
  try {
    const index = await fetchJson(['eventDocuments', eventId]);
    if (!index) {
      showState('Sin documentos', 'Este evento no tiene documentos disponibles para descargar.');
      return;
    }
    render(index);
  } catch (error) {
    console.error('[documentos] no se pudo cargar el índice', error);
    showState(
      'Documentos no disponibles',
      error.denied
        ? 'Los documentos de este evento todavía no están publicados. Inténtalo más tarde.'
        : 'No se pudieron cargar los documentos. Revisa tu conexión e inténtalo de nuevo.',
      'error',
    );
  }
}

init();

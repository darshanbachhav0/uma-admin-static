/**
 * "Documentos para estudiantes" section of the event editor.
 *
 * Optional. Each document has a title and a PDF and/or Word file. Nothing is
 * written while editing: the editor calls `getDocuments()` after the event
 * itself has been saved and hands the result to `saveEventDocuments()`.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button } from '../ui/controls.js';
import {
  FORMATS, MAX_FILE_BYTES, formatBytes, loadEventDocuments, newDocumentId, slotForFormat, validateFile,
} from '../services/documents.js';

const MAX_DOCUMENTS = 10;

/** "FORMATO 1_FICHA_2027-I.pdf" -> "FORMATO 1 FICHA 2027-I" */
function titleFromFileName(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * @param {{eventId?: string}} options
 */
export function createDocumentsField({ eventId } = {}) {
  let previous = [];
  let status = eventId ? 'loading' : 'ready'; // loading | ready | error
  const rows = [];

  const list = h('div', { class: 'doc-editor__list' });
  const body = h('div', { class: 'doc-editor__body' });

  const addBtn = button({
    label: 'Agregar documento',
    icon: 'plus',
    variant: 'secondary',
    size: 'sm',
    onClick: () => {
      const row = addRow();
      row.titleInput.focus();
    },
  });

  const node = h('div', { class: 'doc-editor' },
    h('p', { class: 'doc-editor__hint' },
      'Los estudiantes podrán descargarlos al inscribirse en el evento. ',
      `PDF o Word, máximo ${formatBytes(MAX_FILE_BYTES)} por archivo.`),
    body);

  function render() {
    if (status === 'loading') {
      replaceChildren(body, h('div', { class: 'doc-editor__state', role: 'status' },
        h('span', { class: 'spinner' }), h('span', { text: 'Cargando documentos…' })));
      return;
    }
    if (status === 'error') {
      replaceChildren(body, h('div', { class: 'doc-editor__state doc-editor__state--error', role: 'alert' },
        icon('alert-triangle', { size: 16 }),
        h('span', { text: 'No se pudieron cargar los documentos. Los documentos actuales no se modificarán al guardar.' }),
        button({ label: 'Reintentar', icon: 'refresh', variant: 'ghost', size: 'sm', onClick: load })));
      return;
    }
    replaceChildren(body, list, rows.length >= MAX_DOCUMENTS ? null : addBtn);
    replaceChildren(list, ...rows.map((row) => row.element));
    if (!rows.length) {
      list.appendChild(h('p', { class: 'doc-editor__empty', text: 'Este evento no tiene documentos.' }));
    }
  }

  function addRow(initial = null) {
    const titleInput = h('input', {
      class: 'input',
      type: 'text',
      maxlength: 120,
      placeholder: 'Ej.: Ficha de evaluación socioeconómica',
      'aria-label': 'Título del documento',
      value: initial ? initial.title : '',
    });
    const error = h('p', { class: 'doc-row__error', role: 'alert' });
    const slotsEl = h('div', { class: 'doc-row__slots' });

    const row = {
      id: initial ? initial.id : null,
      titleInput,
      slots: { pdf: null, word: null },
      element: null,
      setError(message) {
        error.textContent = message || '';
        row.element.classList.toggle('is-invalid', Boolean(message));
      },
    };

    if (initial) {
      for (const [format, meta] of Object.entries(initial.files)) {
        row.slots[slotForFormat(format)] = { meta: { ...meta, format } };
      }
    }

    const removeBtn = h('button', {
      class: 'btn btn--ghost btn--icon btn--sm',
      type: 'button',
      title: 'Quitar documento',
      'aria-label': 'Quitar documento',
      onclick: () => {
        rows.splice(rows.indexOf(row), 1);
        render();
      },
    }, icon('trash', { size: 16 }));

    titleInput.addEventListener('input', () => row.setError(''));

    row.element = h('div', { class: 'doc-row' },
      h('div', { class: 'doc-row__head' }, titleInput, removeBtn),
      slotsEl,
      error);

    row.renderSlots = () => {
      replaceChildren(slotsEl, ...Object.keys(FORMATS).map((slot) => renderSlot(row, slot)));
    };
    row.renderSlots();

    rows.push(row);
    render();
    return row;
  }

  function renderSlot(row, slot) {
    const spec = FORMATS[slot];
    const entry = row.slots[slot];

    const input = h('input', { type: 'file', accept: spec.accept, class: 'visually-hidden', tabindex: '-1' });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const problem = validateFile(file, slot);
      if (problem) { row.setError(problem); return; }
      row.slots[slot] = { file };
      if (!row.titleInput.value.trim()) row.titleInput.value = titleFromFileName(file.name);
      row.setError('');
      row.renderSlots();
    });

    if (!entry) {
      return h('div', { class: 'doc-slot doc-slot--empty' },
        input,
        h('button', {
          class: 'doc-slot__pick',
          type: 'button',
          onclick: () => input.click(),
        }, icon('upload', { size: 16 }), h('span', { text: `Subir ${spec.label}` })));
    }

    const name = entry.file ? entry.file.name : entry.meta.fileName;
    const size = entry.file ? entry.file.size : entry.meta.size;

    return h('div', { class: 'doc-slot' },
      input,
      h('span', { class: 'doc-slot__badge', text: spec.label }),
      h('div', { class: 'doc-slot__info' },
        h('span', { class: 'doc-slot__name', text: name, title: name }),
        h('span', { class: 'doc-slot__meta', text: entry.file ? `${formatBytes(size)} · nuevo` : formatBytes(size) })),
      h('button', {
        class: 'btn btn--ghost btn--icon btn--sm',
        type: 'button',
        title: `Reemplazar ${spec.label}`,
        'aria-label': `Reemplazar ${spec.label}`,
        onclick: () => input.click(),
      }, icon('refresh', { size: 15 })),
      h('button', {
        class: 'btn btn--ghost btn--icon btn--sm',
        type: 'button',
        title: `Quitar ${spec.label}`,
        'aria-label': `Quitar ${spec.label}`,
        onclick: () => { row.slots[slot] = null; row.renderSlots(); },
      }, icon('x', { size: 15 })));
  }

  async function load() {
    status = 'loading';
    render();
    try {
      previous = await loadEventDocuments(eventId);
      rows.length = 0;
      status = 'ready';
      previous.forEach((doc) => addRow(doc));
      render();
    } catch (error) {
      console.error('[documents] no se pudieron cargar los documentos', error);
      status = 'error';
      render();
    }
  }

  if (eventId) load();
  else render();

  return {
    node,

    /** True when there is something to write (or remove). */
    shouldSave() {
      return status === 'ready' && (previous.length > 0 || rows.length > 0);
    },

    /** Mark invalid rows; returns false when the section blocks saving. */
    validate() {
      if (status === 'loading') return false;
      let valid = true;
      for (const row of rows) {
        const hasFile = Object.values(row.slots).some(Boolean);
        if (!row.titleInput.value.trim()) { row.setError('Escribe el título del documento.'); valid = false; }
        else if (!hasFile) { row.setError('Sube al menos un archivo PDF o Word.'); valid = false; }
      }
      return valid;
    },

    isLoading() { return status === 'loading'; },

    getDocuments() {
      return rows.map((row) => {
        // Assign the id once so a retried save overwrites the same files.
        if (!row.id) row.id = newDocumentId();
        return {
          id: row.id,
          title: row.titleInput.value.trim().slice(0, 120),
          files: row.slots,
        };
      });
    },

    getPrevious() { return previous; },
  };
}

/**
 * Event create/edit drawer.
 *
 * Grouped into logical sections, validates before saving, keeps the Save button
 * in a loading state (which also prevents double submissions) and surfaces
 * explicit loading/error states for the Unsplash image suggestion.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, field, select, setButtonLoading, textArea, textInput } from '../ui/controls.js';
import { openOverlay } from '../ui/overlay.js';
import { notify } from '../ui/toast.js';
import { EVENT_STATUSES, isImageInUse, saveEvent, validateEvent } from '../services/events.js';
import { eventsStore } from '../core/store.js';
import { saveEventDocuments } from '../services/documents.js';
import { suggestImage, creditText, hasUnsplashKey, UnsplashError } from '../services/unsplash.js';
import {
  ACCEPT_ATTRIBUTE, ImageUploadError, deleteUploadedEventImage, isImageUploadConfigured, prepareEventImage,
  uploadEventImage,
} from '../services/image-upload.js';
import { describeError, safeUrl } from '../utils/validate.js';
import { fromDateTimeInputs, toDateInputValue, toTimeInputValue } from '../utils/format.js';
import { createDocumentsField } from './event-documents-field.js';

/**
 * @param {object|null} event Existing event, or null to create one.
 * @param {(eventId:string)=>void} [onSaved]
 */
export function openEventEditor(event, onSaved) {
  const isEdit = Boolean(event && event.id);
  // Set once the event exists, so a retry after a failed document upload
  // updates the same event instead of creating a second one.
  let savedEventId = isEdit ? event.id : null;

  const documentsField = createDocumentsField({ eventId: savedEventId });

  const titleInput = textInput({ maxlength: 120, placeholder: 'Feria de salud universitaria' });
  const titleField = field({ label: 'Título del evento', control: titleInput, required: true, span: true });

  const descInput = textArea({ maxlength: 4000, rows: 10, placeholder: 'Describe el evento, el público objetivo y los detalles de participación.' });
  const descField = field({
    label: 'Descripción',
    control: descInput,
    hint: 'Se respetan los saltos de línea y los enlaces (https://…) se pueden abrir. Los asteriscos de negrita (**) y los # de títulos se quitan al guardar, porque la app muestra texto simple.',
    span: true,
  });

  const statusSelect = select({ options: EVENT_STATUSES });
  const statusField = field({
    label: 'Estado',
    control: statusSelect,
    hint: 'Visible para los estudiantes en la aplicación.',
  });

  const dateInput = textInput({ type: 'date' });
  const dateField = field({ label: 'Fecha', control: dateInput });

  const timeInput = textInput({ type: 'time' });
  const timeField = field({ label: 'Hora', control: timeInput, hint: 'Hora local.' });

  const locationInput = textInput({ maxlength: 300, placeholder: 'Auditorio principal, Pabellón B · Virtual vía Zoom' });
  const locationField = field({ label: 'Ubicación', control: locationInput, span: true });

  const locationUrlInput = textInput({
    type: 'url',
    maxlength: 2000,
    placeholder: 'https://uma-edu-pe.zoom.us/j/…',
    autocomplete: 'off',
  });
  const locationUrlField = field({
    label: 'Enlace de la ubicación (opcional)',
    control: locationUrlInput,
    hint: 'Zoom, Google Meet o Google Maps. Los estudiantes lo abren con un toque. Si pegas el enlace en «Ubicación», se usa automáticamente.',
    span: true,
  });

  const tagsInput = textInput({ maxlength: 200, placeholder: 'salud, charla, feria' });
  const tagsField = field({
    label: 'Etiquetas',
    control: tagsInput,
    hint: 'Separadas por comas. También se usan para buscar la imagen sugerida.',
    span: true,
  });

  // ---- Image -----------------------------------------------------------
  let imageUrl = event ? safeUrl(event.imageUrl) : '';
  let imageCredit = event && event.imageCredit ? event.imageCredit : null;
  let suggestController = null;

  const previewImg = h('img', { alt: '', loading: 'lazy' });
  const frame = h('div', { class: 'image-picker__frame' });
  const creditLine = h('p', { class: 'image-picker__credit' });

  const suggestBtn = button({
    label: 'Sugerir desde Unsplash',
    icon: 'image',
    variant: 'secondary',
    size: 'sm',
    onClick: () => runSuggestion(),
  });

  const urlInput = textInput({ type: 'url', placeholder: 'https://…' });
  const urlField = field({
    label: 'O pega la URL de una imagen',
    control: urlInput,
    hint: 'Solo se aceptan enlaces http(s).',
    span: true,
  });
  urlInput.addEventListener('change', () => {
    const value = urlInput.value.trim();
    if (!value) return;
    const safe = safeUrl(value);
    if (!safe) { urlField.setError('El enlace debe empezar con http:// o https://'); return; }
    if (uploadController) uploadController.abort();
    imageUrl = safe;
    imageCredit = null;
    uploadedNote = '';
    urlInput.value = '';
    renderImage();
  });

  const removeBtn = button({
    label: 'Quitar imagen',
    icon: 'x',
    variant: 'ghost',
    size: 'sm',
    onClick: () => {
      if (uploadController) uploadController.abort();
      imageUrl = '';
      imageCredit = null;
      uploadedNote = '';
      renderImage();
    },
  });

  // ---- Upload from the computer ----------------------------------------
  let uploadController = null;
  let uploadedNote = '';
  // Clean-up bookkeeping: images uploaded while this editor is open, and the
  // image currently stored in the database for this event.
  const originalImageUrl = imageUrl;
  let persistedImageUrl = imageUrl;
  const sessionUploads = [];
  const canUpload = isImageUploadConfigured();
  const fileInput = h('input', {
    type: 'file',
    accept: ACCEPT_ATTRIBUTE,
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) runUpload(file);
  });

  const uploadBtn = button({
    label: 'Subir imagen',
    icon: 'upload',
    variant: 'secondary',
    size: 'sm',
    onClick: () => {
      if (!canUpload) {
        notify.warning('La subida de imágenes no está disponible: falta configurar Firebase Storage (FIREBASE_STORAGE_BUCKET).');
        return;
      }
      fileInput.click();
    },
  });

  // Drag and drop an image onto the preview.
  frame.addEventListener('dragover', (dragEvent) => {
    if (!canUpload) return;
    dragEvent.preventDefault();
    frame.classList.add('is-dragover');
  });
  frame.addEventListener('dragleave', () => frame.classList.remove('is-dragover'));
  frame.addEventListener('drop', (dropEvent) => {
    frame.classList.remove('is-dragover');
    if (!canUpload) return;
    dropEvent.preventDefault();
    const file = dropEvent.dataTransfer && dropEvent.dataTransfer.files[0];
    if (file) runUpload(file);
  });

  const imageActions = h('div', { class: 'image-picker__actions' }, uploadBtn, suggestBtn, removeBtn, fileInput);

  const uploadHint = h('p', {
    class: 'field__hint',
    text: canUpload
      ? 'Sube una imagen JPG, PNG o WebP (máx. 15 MB) o arrástrala aquí. Se ajusta automáticamente a 1600 × 900 px (16:9): las fotos se recortan al centro y los afiches se muestran completos.'
      : 'Subida de imágenes no disponible: revisa FIREBASE_STORAGE_BUCKET en Render (ver docs/DEPLOYMENT.md).',
  });

  const imagePicker = h('div', { class: 'image-picker' }, frame, creditLine, imageActions, uploadHint, urlField);

  async function runUpload(file) {
    if (uploadController) uploadController.abort();
    if (suggestController) suggestController.abort();
    const controller = new AbortController();
    uploadController = controller;
    const previous = { imageUrl, imageCredit, uploadedNote };
    let previewUrl = '';

    try {
      renderImage({ loading: 'Ajustando la imagen…' });
      const prepared = await prepareEventImage(file);
      if (controller.signal.aborted) return;

      // Show the adjusted picture straight away while it uploads.
      previewUrl = URL.createObjectURL(prepared.blob);
      renderImage({ loading: 'Subiendo imagen…', previewUrl });

      const url = await uploadEventImage(prepared.blob, {
        signal: controller.signal,
        folder: savedEventId || 'nuevos',
        onProgress: (percent) => {
          if (uploadController === controller) renderImage({ loading: `Subiendo imagen… ${percent} %`, previewUrl });
        },
      });
      sessionUploads.push(url);
      if (controller.signal.aborted) return;
      imageUrl = url;
      imageCredit = null;
      uploadedNote = `Imagen subida · ${prepared.width} × ${prepared.height} px · ${prepared.mode === 'crop' ? 'recortada al centro' : 'completa, con fondo difuminado'}`;
      renderImage();
      notify.success('Imagen subida y ajustada.');
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('[events] subida de imagen fallida', error);
      ({ imageUrl, imageCredit, uploadedNote } = previous);
      const message = error instanceof ImageUploadError ? error.message : 'No se pudo subir la imagen. Inténtalo de nuevo.';
      renderImage({ error: message });
      notify.error(message);
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (uploadController === controller) uploadController = null;
    }
  }

  function renderImage({ loading = false, error = '', previewUrl = '' } = {}) {
    frame.textContent = '';
    const shown = previewUrl || imageUrl;

    if (shown) {
      previewImg.src = shown;
      previewImg.onerror = () => {
        frame.textContent = '';
        frame.appendChild(h('div', { class: 'stack-2', style: { 'align-items': 'center' } },
          icon('alert-triangle', { size: 22 }),
          h('p', { class: 'text-sm', text: 'La imagen no se pudo cargar. Prueba con otra sugerencia o con otra URL.' })));
      };
      frame.appendChild(previewImg);
    } else if (!loading && !error) {
      frame.appendChild(h('div', { class: 'stack-2', style: { 'align-items': 'center' } },
        icon('image', { size: 22 }),
        h('p', { class: 'text-sm', text: canUpload
          ? 'Sin imagen. Sube una, arrástrala aquí, sugiere una desde Unsplash o pega una URL.'
          : 'Sin imagen. Sugiere una desde Unsplash o pega una URL.' })));
    }

    if (loading) {
      frame.appendChild(h('div', { class: 'image-picker__overlay', role: 'status' },
        h('span', { class: 'spinner' }),
        h('span', { text: typeof loading === 'string' ? loading : 'Buscando imagen en Unsplash…' })));
    } else if (error) {
      frame.appendChild(h('div', { class: 'image-picker__overlay', role: 'alert' },
        icon('alert-triangle', { size: 20 }),
        h('span', { style: { 'max-width': '36ch', 'text-align': 'center' }, text: error })));
    }

    const credit = creditText(imageCredit);
    creditLine.textContent = '';
    if (uploadedNote && imageUrl && !imageCredit) creditLine.appendChild(h('span', { text: uploadedNote }));
    if (credit && imageUrl) {
      const link = imageCredit && safeUrl(imageCredit.photoLink);
      creditLine.appendChild(h('span', { text: credit }));
      if (link) {
        creditLine.appendChild(document.createTextNode(' · '));
        creditLine.appendChild(h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Ver original' }));
      }
    }

    removeBtn.classList.toggle('hidden', !imageUrl);
    uploadBtn.querySelector('.btn__label').textContent = imageUrl ? 'Subir otra imagen' : 'Subir imagen';
    suggestBtn.querySelector('.btn__label').textContent = imageUrl ? 'Otra sugerencia de Unsplash' : 'Sugerir desde Unsplash';
  }

  async function runSuggestion() {
    const query = tagsInput.value.trim() || titleInput.value.trim();
    if (!query) {
      tagsField.setError('Escribe el título o algunas etiquetas para buscar una imagen.');
      tagsInput.focus();
      return;
    }
    if (suggestController) suggestController.abort();
    if (uploadController) uploadController.abort();
    suggestController = new AbortController();

    renderImage({ loading: true });
    try {
      const result = await suggestImage(query, suggestController.signal);
      imageUrl = result.imageUrl;
      imageCredit = result.credit;
      uploadedNote = '';
      renderImage();
      notify.success('Imagen sugerida desde Unsplash.');
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('[events] sugerencia de imagen fallida', error);
      const message = error instanceof UnsplashError
        ? error.message
        : 'No se pudo obtener una imagen de Unsplash.';
      renderImage({ error: message });
      notify.error(message);
    } finally {
      suggestController = null;
    }
  }

  // ---- Prefill ---------------------------------------------------------
  if (event) {
    titleInput.value = event.title || '';
    descInput.value = event.description || '';
    locationInput.value = event.location || '';
    locationUrlInput.value = event.locationUrl || '';
    tagsInput.value = (event.tags || []).join(', ');
    statusSelect.value = event.status || 'upcoming';
    dateInput.value = toDateInputValue(event.startAt);
    timeInput.value = toTimeInputValue(event.startAt);
  }
  renderImage();

  if (!hasUnsplashKey) {
    imageActions.appendChild(h('span', {
      class: 'text-xs text-tertiary',
      style: { 'align-self': 'center' },
      text: 'UNSPLASH_ACCESS_KEY no configurada',
    }));
  }

  // ---- Form ------------------------------------------------------------
  const form = h('form', { class: 'stack-6', novalidate: true },
    h('section', { class: 'form-section' },
      h('h3', { class: 'form-section__title', text: 'Información general' }),
      h('div', { class: 'form-grid' }, titleField, statusField, descField)),

    h('section', { class: 'form-section' },
      h('h3', { class: 'form-section__title', text: 'Programación' }),
      h('div', { class: 'form-grid' }, dateField, timeField, locationField, locationUrlField)),

    h('section', { class: 'form-section' },
      h('h3', { class: 'form-section__title', text: 'Clasificación e imagen' }),
      h('div', { class: 'form-grid' }, tagsField, h('div', { class: 'span-2' }, imagePicker))),

    h('section', { class: 'form-section' },
      h('h3', { class: 'form-section__title', text: 'Documentos para estudiantes (opcional)' }),
      documentsField.node));

  form.addEventListener('submit', (submitEvent) => {
    submitEvent.preventDefault();
    handleSave();
  });

  const saveBtn = button({ label: isEdit ? 'Guardar cambios' : 'Crear evento', variant: 'primary', type: 'submit' });
  saveBtn.addEventListener('click', (clickEvent) => {
    clickEvent.preventDefault();
    handleSave();
  });

  const cancelBtn = button({ label: 'Cancelar', variant: 'secondary', onClick: () => overlay.close('cancel') });

  const overlay = openOverlay({
    title: isEdit ? 'Editar evento' : 'Crear evento',
    subtitle: isEdit ? event.title : 'Completa la información del nuevo evento',
    variant: 'drawer',
    size: 'lg',
    body: form,
    footer: [cancelBtn, saveBtn],
    onClose: () => {
      if (suggestController) suggestController.abort();
      if (uploadController) uploadController.abort();
      cleanUpImages();
    },
  });

  /**
   * Delete uploaded images that no event uses any more: uploads from this
   * session that were not kept, and the event's previous uploaded image if it
   * was replaced and no copy of the event still shows it. Runs in the
   * background; failures only leave an unused file behind.
   */
  function cleanUpImages() {
    const unused = sessionUploads.filter((url) => url !== persistedImageUrl);
    if (originalImageUrl && originalImageUrl !== persistedImageUrl
      && !isImageInUse(originalImageUrl, eventsStore.state.items, savedEventId)) {
      unused.push(originalImageUrl);
    }
    unused.forEach((url) => { deleteUploadedEventImage(url); });
  }

  async function handleSave() {
    if (saveBtn.dataset.busy === '1') return;

    [titleField, dateField, timeField, locationUrlField, tagsField, urlField].forEach((f) => f.clearError());

    const startAt = dateInput.value ? fromDateTimeInputs(dateInput.value, timeInput.value) : 0;
    const { values, errors } = validateEvent({
      title: titleInput.value,
      description: descInput.value,
      location: locationInput.value,
      locationUrl: locationUrlInput.value,
      status: statusSelect.value,
      tags: tagsInput.value,
      date: dateInput.value,
      time: timeInput.value,
      startAt,
      imageUrl,
      imageCredit,
    });

    if (uploadController) {
      notify.warning('Espera a que termine de subirse la imagen.');
      return;
    }

    if (documentsField.isLoading()) {
      notify.warning('Espera a que terminen de cargar los documentos.');
      return;
    }
    const documentsValid = documentsField.validate();

    if (Object.keys(errors).length || !documentsValid) {
      if (errors.title) titleField.setError(errors.title);
      if (errors.date) dateField.setError(errors.date);
      if (errors.locationUrl) locationUrlField.setError(errors.locationUrl);
      const firstInvalid = form.querySelector('.field.is-invalid .input, .field.is-invalid .select, .doc-row.is-invalid .input');
      if (firstInvalid) firstInvalid.focus();
      notify.warning('Revisa los campos marcados antes de guardar.');
      return;
    }

    const saveLabel = saveBtn.querySelector('.btn__label');
    const originalLabel = saveLabel.textContent;
    const finish = () => {
      saveLabel.textContent = originalLabel;
      setButtonLoading(saveBtn, false);
      cancelBtn.disabled = false;
      overlay.setBusy(false);
    };

    setButtonLoading(saveBtn, true);
    cancelBtn.disabled = true;
    overlay.setBusy(true);

    try {
      savedEventId = await saveEvent(savedEventId, values);
      persistedImageUrl = values.imageUrl;
    } catch (error) {
      console.error('[events] no se pudo guardar el evento', error);
      notify.error(describeError(error, 'No se pudo guardar el evento. Inténtalo de nuevo.'));
      finish();
      return;
    }

    if (documentsField.shouldSave()) {
      try {
        await saveEventDocuments({
          eventId: savedEventId,
          eventTitle: values.title,
          documents: documentsField.getDocuments(),
          previous: documentsField.getPrevious(),
          onProgress: (message) => { saveLabel.textContent = message; },
        });
      } catch (error) {
        // The event itself is saved; keep the drawer open so the documents
        // can be retried. `savedEventId` makes the retry update this event.
        console.error('[events] no se pudieron guardar los documentos', error);
        notify.error(
          describeError(error, 'Inténtalo de nuevo. Si persiste, verifica que las reglas de la base de datos estén desplegadas.'),
          'El evento se guardó, pero no sus documentos',
        );
        finish();
        return;
      }
    }

    notify.success(isEdit ? 'Evento actualizado correctamente.' : 'Evento creado correctamente.');
    overlay.setBusy(false);
    overlay.close('saved');
    if (typeof onSaved === 'function') onSaved(savedEventId);
  }

  return overlay;
}

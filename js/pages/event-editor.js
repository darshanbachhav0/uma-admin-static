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
import { EVENT_STATUSES, saveEvent, validateEvent } from '../services/events.js';
import { suggestImage, creditText, hasUnsplashKey, UnsplashError } from '../services/unsplash.js';
import { describeError, safeUrl } from '../utils/validate.js';
import { fromDateTimeInputs, toDateInputValue, toTimeInputValue } from '../utils/format.js';

/**
 * @param {object|null} event Existing event, or null to create one.
 * @param {(eventId:string)=>void} [onSaved]
 */
export function openEventEditor(event, onSaved) {
  const isEdit = Boolean(event && event.id);

  const titleInput = textInput({ maxlength: 160, placeholder: 'Feria de salud universitaria' });
  const titleField = field({ label: 'Título del evento', control: titleInput, required: true, span: true });

  const descInput = textArea({ maxlength: 4000, rows: 5, placeholder: 'Describe el evento, el público objetivo y los detalles de participación.' });
  const descField = field({ label: 'Descripción', control: descInput, span: true });

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

  const locationInput = textInput({ maxlength: 160, placeholder: 'Auditorio principal, Pabellón B' });
  const locationField = field({ label: 'Ubicación', control: locationInput, span: true });

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
    imageUrl = safe;
    imageCredit = null;
    urlInput.value = '';
    renderImage();
  });

  const removeBtn = button({
    label: 'Quitar imagen',
    icon: 'x',
    variant: 'ghost',
    size: 'sm',
    onClick: () => { imageUrl = ''; imageCredit = null; renderImage(); },
  });

  const imageActions = h('div', { class: 'image-picker__actions' }, suggestBtn, removeBtn);

  const imagePicker = h('div', { class: 'image-picker' }, frame, creditLine, imageActions, urlField);

  function renderImage({ loading = false, error = '' } = {}) {
    frame.textContent = '';

    if (imageUrl) {
      previewImg.src = imageUrl;
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
        h('p', { class: 'text-sm', text: 'Sin imagen. Sugiere una desde Unsplash o pega una URL.' })));
    }

    if (loading) {
      frame.appendChild(h('div', { class: 'image-picker__overlay', role: 'status' },
        h('span', { class: 'spinner' }),
        h('span', { text: 'Buscando imagen en Unsplash…' })));
    } else if (error) {
      frame.appendChild(h('div', { class: 'image-picker__overlay', role: 'alert' },
        icon('alert-triangle', { size: 20 }),
        h('span', { style: { 'max-width': '36ch', 'text-align': 'center' }, text: error })));
    }

    const credit = creditText(imageCredit);
    creditLine.textContent = '';
    if (credit && imageUrl) {
      const link = imageCredit && safeUrl(imageCredit.photoLink);
      creditLine.appendChild(h('span', { text: credit }));
      if (link) {
        creditLine.appendChild(document.createTextNode(' · '));
        creditLine.appendChild(h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Ver original' }));
      }
    }

    removeBtn.classList.toggle('hidden', !imageUrl);
    suggestBtn.querySelector('.btn__label').textContent = imageUrl ? 'Reemplazar imagen' : 'Sugerir desde Unsplash';
  }

  async function runSuggestion() {
    const query = tagsInput.value.trim() || titleInput.value.trim();
    if (!query) {
      tagsField.setError('Escribe el título o algunas etiquetas para buscar una imagen.');
      tagsInput.focus();
      return;
    }
    if (suggestController) suggestController.abort();
    suggestController = new AbortController();

    renderImage({ loading: true });
    try {
      const result = await suggestImage(query, suggestController.signal);
      imageUrl = result.imageUrl;
      imageCredit = result.credit;
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
      h('div', { class: 'form-grid' }, dateField, timeField, locationField)),

    h('section', { class: 'form-section' },
      h('h3', { class: 'form-section__title', text: 'Clasificación e imagen' }),
      h('div', { class: 'form-grid' }, tagsField, h('div', { class: 'span-2' }, imagePicker))));

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
    onClose: () => { if (suggestController) suggestController.abort(); },
  });

  async function handleSave() {
    if (saveBtn.dataset.busy === '1') return;

    [titleField, dateField, timeField, tagsField, urlField].forEach((f) => f.clearError());

    const startAt = dateInput.value ? fromDateTimeInputs(dateInput.value, timeInput.value) : 0;
    const { values, errors } = validateEvent({
      title: titleInput.value,
      description: descInput.value,
      location: locationInput.value,
      status: statusSelect.value,
      tags: tagsInput.value,
      date: dateInput.value,
      time: timeInput.value,
      startAt,
      imageUrl,
      imageCredit,
    });

    if (Object.keys(errors).length) {
      if (errors.title) titleField.setError(errors.title);
      if (errors.date) dateField.setError(errors.date);
      const firstInvalid = form.querySelector('.field.is-invalid .input, .field.is-invalid .select');
      if (firstInvalid) firstInvalid.focus();
      notify.warning('Revisa los campos marcados antes de guardar.');
      return;
    }

    setButtonLoading(saveBtn, true);
    cancelBtn.disabled = true;
    overlay.setBusy(true);

    try {
      const id = await saveEvent(isEdit ? event.id : null, values);
      notify.success(isEdit ? 'Evento actualizado correctamente.' : 'Evento creado correctamente.');
      overlay.setBusy(false);
      overlay.close('saved');
      if (typeof onSaved === 'function') onSaved(id);
    } catch (error) {
      console.error('[events] no se pudo guardar el evento', error);
      notify.error(describeError(error, 'No se pudo guardar el evento. Inténtalo de nuevo.'));
      setButtonLoading(saveBtn, false);
      cancelBtn.disabled = false;
      overlay.setBusy(false);
    }
  }

  return overlay;
}

/**
 * Create-user dialog and CSV bulk importer.
 *
 * Both call the Cloud Functions backend; the browser never creates Firebase
 * Auth accounts itself and never needs to know anybody's password.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, field, select, setButtonLoading, textInput } from '../ui/controls.js';
import { openOverlay } from '../ui/overlay.js';
import { notify } from '../ui/toast.js';
import * as adminApi from '../services/adminApi.js';
import { describeError, isDni, isEmail, isStudentCode } from '../utils/validate.js';
import { parseCsvObjects, toCsv, downloadFile, readFileAsText } from '../utils/csv.js';
import { formatNumber } from '../utils/format.js';

const ROLE_OPTIONS = [
  { value: 'student', label: 'Estudiante' },
  { value: 'admin', label: 'Administrador' },
];

const TEMPLATE_COLUMNS = [
  { key: 'email', label: 'email' },
  { key: 'dni', label: 'dni' },
  { key: 'stCode', label: 'stCode' },
  { key: 'role', label: 'role' },
];

/** Download the CSV template administrators should fill in. */
export function downloadTemplate() {
  const sample = [
    { email: 'estudiante@uma.edu.pe', dni: '12345678', stCode: '2024001', role: 'student' },
  ];
  downloadFile('plantilla-usuarios-uma.csv', toCsv(TEMPLATE_COLUMNS, sample));
}

/**
 * @param {{existingUsers: Array, onDone: Function}} options
 */
export function openCreateUserDialog({ existingUsers, onDone }) {
  const emailInput = textInput({ type: 'email', autocomplete: 'off', placeholder: 'estudiante@uma.edu.pe' });
  const emailField = field({ label: 'Correo electrónico', control: emailInput, required: true, span: true });

  const dniInput = textInput({ inputmode: 'numeric', autocomplete: 'off', maxlength: 12, placeholder: '12345678' });
  const dniField = field({
    label: 'DNI',
    control: dniInput,
    required: true,
    hint: 'Se usa como contraseña inicial para mantener la compatibilidad con la app de estudiantes.',
  });

  const codeInput = textInput({ autocomplete: 'off', maxlength: 32, placeholder: '2024001' });
  const codeField = field({ label: 'Código de estudiante', control: codeInput, required: true });

  const roleSelect = select({ options: ROLE_OPTIONS, value: 'student' });
  const roleField = field({
    label: 'Rol',
    control: roleSelect,
    hint: 'Los administradores pueden entrar a esta consola.',
    span: true,
  });

  const form = h('form', { class: 'form-grid', novalidate: true }, emailField, h('div'), dniField, codeField, roleField);

  const createBtn = button({ label: 'Crear usuario', variant: 'primary', type: 'submit' });
  const cancelBtn = button({ label: 'Cancelar', variant: 'secondary', onClick: () => overlay.close('cancel') });

  form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
  createBtn.addEventListener('click', (event) => { event.preventDefault(); submit(); });

  const overlay = openOverlay({
    title: 'Crear usuario',
    subtitle: 'Se creará la cuenta de acceso y su ficha en la base de datos.',
    size: 'lg',
    body: form,
    footer: [cancelBtn, createBtn],
  });

  function validate() {
    let valid = true;
    [emailField, dniField, codeField].forEach((f) => f.clearError());

    const email = emailInput.value.trim().toLowerCase();
    const dni = dniInput.value.trim();
    const stCode = codeInput.value.trim();

    if (!isEmail(email)) { emailField.setError('Escribe un correo electrónico válido.'); valid = false; }
    else if (existingUsers.some((user) => (user.email || '').toLowerCase() === email)) {
      emailField.setError('Ya existe un usuario con este correo.');
      valid = false;
    }

    if (!isDni(dni)) { dniField.setError('El DNI debe tener entre 8 y 12 dígitos.'); valid = false; }

    if (!isStudentCode(stCode)) { codeField.setError('El código debe tener entre 3 y 32 caracteres alfanuméricos.'); valid = false; }
    else if (existingUsers.some((user) => user.stCode === stCode)) {
      codeField.setError('Ya existe un usuario con este código.');
      valid = false;
    }

    return valid ? { email, dni, stCode, role: roleSelect.value } : null;
  }

  async function submit() {
    if (createBtn.dataset.busy === '1') return;
    const values = validate();
    if (!values) {
      const firstInvalid = form.querySelector('.field.is-invalid .input');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    setButtonLoading(createBtn, true);
    cancelBtn.disabled = true;
    overlay.setBusy(true);
    try {
      await adminApi.createUser(values);
      notify.success(`Usuario ${values.email} creado correctamente.`);
      overlay.setBusy(false);
      overlay.close('created');
      if (typeof onDone === 'function') onDone();
    } catch (error) {
      notify.error(describeError(error, 'No se pudo crear el usuario.'));
      setButtonLoading(createBtn, false);
      cancelBtn.disabled = false;
      overlay.setBusy(false);
    }
  }
}

/* ========================================================================= */
/*  CSV import                                                               */
/* ========================================================================= */

const IMPORT_CHUNK = 25;

/**
 * @param {{existingUsers: Array, onDone: Function}} options
 */
export function openImportUsersDialog({ existingUsers, onDone }) {
  let analysis = null;

  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', class: 'visually-hidden' });
  const dropzone = h('div', {
    class: 'dropzone',
    role: 'button',
    tabindex: '0',
  },
    icon('upload', { size: 24 }),
    h('p', { class: 'dropzone__title', text: 'Selecciona o arrastra un archivo CSV' }),
    h('p', { class: 'dropzone__hint', text: 'Columnas requeridas: email, dni, stCode. Opcional: role.' }));

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-over');
  }));
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  const resultSlot = h('div');

  const body = h('div', { class: 'import-steps' },
    h('div', { class: 'stack-2' },
      h('p', { class: 'text-secondary text-sm', text: 'Importa varias cuentas a la vez. Antes de crear nada verás cuántas filas son válidas, cuáles están duplicadas y qué errores hay.' }),
      h('div', { class: 'row-2' },
        button({ label: 'Descargar plantilla CSV', variant: 'ghost', size: 'sm', icon: 'download', onClick: downloadTemplate }))),
    dropzone,
    fileInput,
    resultSlot);

  const importBtn = button({ label: 'Importar', variant: 'primary', disabled: true });
  const cancelBtn = button({ label: 'Cancelar', variant: 'secondary', onClick: () => overlay.close('cancel') });

  importBtn.addEventListener('click', () => runImport());

  const overlay = openOverlay({
    title: 'Importar usuarios desde CSV',
    size: 'xl',
    body,
    footer: [cancelBtn, importBtn],
  });

  async function handleFile(file) {
    replaceChildren(resultSlot, h('div', { class: 'row-2' }, h('span', { class: 'spinner' }), h('span', { text: 'Analizando archivo…' })));
    importBtn.disabled = true;
    try {
      const text = await readFileAsText(file);
      analysis = analyzeCsv(text, existingUsers);
      renderAnalysis(file.name);
    } catch (error) {
      console.error('[users] no se pudo leer el CSV', error);
      analysis = null;
      replaceChildren(resultSlot, h('p', { class: 'alert' }, icon('alert-circle', { size: 16 }),
        h('span', { text: 'No se pudo leer el archivo. Verifica que sea un CSV con codificación UTF-8.' })));
    }
  }

  function renderAnalysis(fileName) {
    if (!analysis) return;
    const { valid, invalid, duplicates, errors, missingColumns } = analysis;

    if (missingColumns.length) {
      importBtn.disabled = true;
      replaceChildren(resultSlot, h('p', { class: 'alert' }, icon('alert-circle', { size: 16 }),
        h('span', { text: `Faltan columnas obligatorias en el CSV: ${missingColumns.join(', ')}.` })));
      return;
    }

    importBtn.disabled = valid.length === 0;

    const preview = h('table', { class: 'table' },
      h('thead', h('tr',
        h('th', { text: 'Fila' }),
        h('th', { text: 'Email' }),
        h('th', { text: 'DNI' }),
        h('th', { text: 'Código' }),
        h('th', { text: 'Rol' }))),
      h('tbody', ...valid.slice(0, 50).map((row) => h('tr',
        h('td', { class: 'text-mono', text: String(row.index) }),
        h('td', { text: row.email }),
        h('td', { class: 'text-mono', text: row.dni }),
        h('td', { class: 'text-mono', text: row.stCode }),
        h('td', { text: row.role === 'admin' ? 'Administrador' : 'Estudiante' })))));

    replaceChildren(resultSlot, h('div', { class: 'stack' },
      h('p', { class: 'text-sm text-secondary', text: `Archivo: ${fileName}` }),
      h('div', { class: 'import-summary' },
        summaryItem('Filas válidas', valid.length, 'ok'),
        summaryItem('Duplicadas', duplicates.length, 'warn'),
        summaryItem('Con errores', invalid.length, 'bad'),
        summaryItem('Total leídas', analysis.totalRows, '')),
      errors.length
        ? h('div', { class: 'stack-2' },
          h('p', { class: 'form-section__title', text: 'Errores de validación' }),
          h('div', { class: 'error-list' }, ...errors.slice(0, 100).map((entry) => h('p', { class: 'error-list__item' },
            h('span', { class: 'error-list__row', text: `Fila ${entry.index}:` }),
            h('span', { text: entry.message })))))
        : null,
      valid.length
        ? h('div', { class: 'stack-2' },
          h('p', { class: 'form-section__title', text: `Vista previa (${formatNumber(Math.min(valid.length, 50))} de ${formatNumber(valid.length)})` }),
          h('div', { class: 'preview-scroll' }, preview))
        : h('p', { class: 'alert alert--warning' }, icon('alert-triangle', { size: 16 }),
          h('span', { text: 'No hay filas válidas para importar.' }))));

    importBtn.querySelector('.btn__label').textContent = valid.length
      ? `Importar ${formatNumber(valid.length)} usuarios`
      : 'Importar';
  }

  function summaryItem(label, value, tone) {
    return h('div', { class: ['import-summary__item', tone ? `import-summary__item--${tone}` : ''] },
      h('p', { class: 'import-summary__value', text: formatNumber(value) }),
      h('p', { class: 'import-summary__label', text: label }));
  }

  async function runImport() {
    if (!analysis || !analysis.valid.length || importBtn.dataset.busy === '1') return;

    const { confirmDialog } = await import('../ui/confirm.js');
    const confirmed = await confirmDialog({
      title: 'Confirmar importación',
      tone: 'warning',
      message: `Se crearán ${formatNumber(analysis.valid.length)} cuentas de acceso. Las filas con errores o duplicadas se omitirán.`,
      confirmLabel: 'Sí, importar',
    });
    if (!confirmed) return;

    setButtonLoading(importBtn, true);
    cancelBtn.disabled = true;
    overlay.setBusy(true);

    const progress = h('p', { class: 'text-sm text-secondary', role: 'status', 'aria-live': 'polite' });
    replaceChildren(resultSlot, h('div', { class: 'stack-2' },
      h('div', { class: 'row-2' }, h('span', { class: 'spinner' }), h('span', { text: 'Importando usuarios…' })),
      progress));

    const created = [];
    const failed = [];

    try {
      for (let i = 0; i < analysis.valid.length; i += IMPORT_CHUNK) {
        const chunk = analysis.valid.slice(i, i + IMPORT_CHUNK);
        progress.textContent = `Procesando ${formatNumber(Math.min(i + chunk.length, analysis.valid.length))} de ${formatNumber(analysis.valid.length)}…`;
        // eslint-disable-next-line no-await-in-loop
        const response = await adminApi.bulkCreateUsers(chunk.map(({ email, dni, stCode, role }) => ({ email, dni, stCode, role })));
        created.push(...(response.created || []));
        failed.push(...(response.failed || []));
      }

      renderImportResult(created, failed);
      if (created.length) notify.success(`Se crearon ${formatNumber(created.length)} usuarios.`);
      if (failed.length) notify.warning(`${formatNumber(failed.length)} filas no se pudieron importar.`);
      if (typeof onDone === 'function') onDone();
    } catch (error) {
      console.error('[users] importación fallida', error);
      notify.error(describeError(error, 'La importación no se pudo completar.'));
      renderImportResult(created, failed);
    } finally {
      setButtonLoading(importBtn, false);
      importBtn.disabled = true;
      cancelBtn.disabled = false;
      cancelBtn.querySelector('.btn__label').textContent = 'Cerrar';
      overlay.setBusy(false);
    }
  }

  function renderImportResult(created, failed) {
    replaceChildren(resultSlot, h('div', { class: 'stack' },
      h('div', { class: 'import-summary' },
        summaryItem('Creados', created.length, 'ok'),
        summaryItem('No creados', failed.length, failed.length ? 'bad' : '')),
      failed.length
        ? h('div', { class: 'stack-2' },
          h('p', { class: 'form-section__title', text: 'Filas no importadas' }),
          h('div', { class: 'error-list' }, ...failed.slice(0, 100).map((entry) => h('p', { class: 'error-list__item' },
            h('span', { class: 'error-list__row', text: `${entry.email || 'fila'}:` }),
            h('span', { text: entry.reason || 'Error desconocido' })))))
        : null));
  }
}

/**
 * Validate a CSV payload against the existing user list.
 * @returns {{valid:Array, invalid:Array, duplicates:Array, errors:Array, totalRows:number, missingColumns:string[]}}
 */
export function analyzeCsv(text, existingUsers) {
  const { headers, rows } = parseCsvObjects(text);
  const required = ['email', 'dni', 'stcode'];
  const missingColumns = required.filter((column) => !headers.includes(column))
    .map((column) => (column === 'stcode' ? 'stCode' : column));

  const result = { valid: [], invalid: [], duplicates: [], errors: [], totalRows: rows.length, missingColumns };
  if (missingColumns.length) return result;

  const existingEmails = new Set(existingUsers.map((user) => (user.email || '').toLowerCase()).filter(Boolean));
  const existingCodes = new Set(existingUsers.map((user) => user.stCode).filter(Boolean));
  const seenEmails = new Set();
  const seenCodes = new Set();

  for (const row of rows) {
    const email = String(row.values.email || '').trim().toLowerCase();
    const dni = String(row.values.dni || '').trim();
    const stCode = String(row.values.stcode || '').trim();
    const roleRaw = String(row.values.role || '').trim().toLowerCase();
    const role = roleRaw === 'admin' ? 'admin' : 'student';

    const problems = [];
    if (!isEmail(email)) problems.push('correo electrónico no válido');
    if (!isDni(dni)) problems.push('DNI no válido (8 a 12 dígitos)');
    if (!isStudentCode(stCode)) problems.push('código de estudiante no válido');

    if (problems.length) {
      result.invalid.push({ ...row, email });
      result.errors.push({ index: row.index, message: problems.join(', ') });
      continue;
    }

    if (existingEmails.has(email) || existingCodes.has(stCode)) {
      result.duplicates.push({ index: row.index, email, stCode });
      result.errors.push({ index: row.index, message: 'ya existe un usuario con ese correo o código' });
      continue;
    }
    if (seenEmails.has(email) || seenCodes.has(stCode)) {
      result.duplicates.push({ index: row.index, email, stCode });
      result.errors.push({ index: row.index, message: 'fila duplicada dentro del mismo archivo' });
      continue;
    }

    seenEmails.add(email);
    seenCodes.add(stCode);
    result.valid.push({ index: row.index, email, dni, stCode, role });
  }

  return result;
}

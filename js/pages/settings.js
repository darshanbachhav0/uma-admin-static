/**
 * Settings.
 *
 * Account details, a live check of the services the console depends on, display
 * preferences and data exports. No placeholder controls: everything here does
 * something.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { avatar, badge, button, card } from '../ui/controls.js';
import { notify } from '../ui/toast.js';
import { getSession, refreshAuthorization, signOut } from '../core/session.js';
import { setPageActions } from '../core/shell.js';
import { DATABASE_URL, PROJECT_ID, FUNCTIONS_REGION } from '../core/firebase.js';
import { eventsStore, usersStore, flattenRegistrations } from '../core/store.js';
import { getPref, setPref } from '../core/prefs.js';
import * as adminApi from '../services/adminApi.js';
import { hasUnsplashKey } from '../services/unsplash.js';
import { downloadTemplate } from './user-dialogs.js';
import { toCsv, downloadFile, exportFilename } from '../utils/csv.js';
import { describeError } from '../utils/validate.js';
import { formatDateTime, formatNumber, initials, EM_DASH } from '../utils/format.js';

export function mount(container) {
  const session = getSession();
  const backendStatusSlot = h('span');
  let backendChecked = false;

  const accountCard = card({
    title: 'Tu cuenta',
    body: h('div', { class: 'stack' },
      h('div', { class: 'row' },
        avatar(initials(session.user ? session.user.email : '')),
        h('div', { class: 'cell-stack' },
          h('span', { class: 'cell-primary', text: session.user ? session.user.email || 'Administrador' : EM_DASH }),
          h('span', { class: 'cell-stack__sub', text: 'Administrador de la consola UMA' }))),
      h('div', null,
        row('UID', h('code', { class: 'text-mono', text: session.user ? session.user.uid : EM_DASH })),
        row('Origen del permiso', session.roleSource === 'claim'
          ? badge('Custom claim (recomendado)', 'success', { iconName: 'shield-check' })
          : badge('Rol en la base de datos', 'warning', { iconName: 'database' })),
        row('Último acceso', h('span', {
          text: session.user && session.user.metadata && session.user.metadata.lastSignInTime
            ? formatDateTime(session.user.metadata.lastSignInTime)
            : EM_DASH,
        })))),
    footer: h('div', { class: 'row-2 row-wrap' },
      button({
        label: 'Actualizar permisos',
        icon: 'refresh',
        onClick: async () => {
          try {
            await refreshAuthorization();
            notify.success('Permisos actualizados.');
          } catch (error) {
            notify.error(describeError(error, 'No se pudieron actualizar los permisos.'));
          }
        },
      }),
      button({
        label: 'Cerrar sesión',
        variant: 'danger-soft',
        icon: 'log-out',
        onClick: async () => {
          try { await signOut(); } catch (error) {
            notify.error(describeError(error, 'No se pudo cerrar la sesión.'));
          }
        },
      })),
  });

  const systemCard = card({
    title: 'Estado del sistema',
    subtitle: 'Servicios de los que depende la consola',
    body: h('div', null,
      row('Proyecto de Firebase', h('span', { class: 'text-mono', text: PROJECT_ID || EM_DASH })),
      row('Realtime Database', h('span', { class: 'text-mono', text: DATABASE_URL || EM_DASH })),
      row('Región de Cloud Functions', h('span', { class: 'text-mono', text: FUNCTIONS_REGION })),
      row('Backend de administración', backendStatusSlot),
      row('Imágenes de Unsplash', hasUnsplashKey
        ? badge('Clave configurada', 'success', { iconName: 'circle-check' })
        : badge('Sin clave (modo limitado)', 'warning', { iconName: 'alert-triangle' }))),
    footer: button({
      label: 'Comprobar backend',
      icon: 'server',
      onClick: () => checkBackend(),
    }),
  });

  const maskCheckbox = h('input', { type: 'checkbox', checked: getPref('maskDni') });
  maskCheckbox.addEventListener('change', () => {
    setPref('maskDni', maskCheckbox.checked);
    notify.success(maskCheckbox.checked ? 'Los DNI se mostrarán enmascarados.' : 'Los DNI se mostrarán completos.');
  });

  const pageSizeSelect = h('select', { class: 'select', style: { width: 'auto' }, 'aria-label': 'Filas por página' },
    ...[25, 50, 100, 200].map((size) => h('option', { value: String(size), text: `${size} filas` })));
  pageSizeSelect.value = String(getPref('pageSize'));
  pageSizeSelect.addEventListener('change', () => {
    setPref('pageSize', Number(pageSizeSelect.value));
    notify.success('Preferencia guardada.');
  });

  const preferencesCard = card({
    title: 'Preferencias de visualización',
    subtitle: 'Se guardan solo en este navegador',
    body: h('div', { class: 'stack' },
      h('label', { class: 'checkbox' },
        maskCheckbox,
        h('span', null,
          h('span', { style: { display: 'block', 'font-weight': 'var(--weight-medium)' }, text: 'Enmascarar el DNI en las tablas' }),
          h('span', { class: 'text-sm text-secondary', text: 'Muestra solo los últimos 3 dígitos. Puedes revelarlo cuando lo necesites.' }))),
      h('div', { class: 'row' },
        h('span', { class: 'status-row__label', text: 'Filas por página' }),
        h('span', { class: 'spacer' }),
        pageSizeSelect)),
  });

  const dataCard = card({
    title: 'Datos',
    subtitle: 'Exporta la información de la consola',
    body: h('div', { class: 'stack-2' },
      h('p', { class: 'text-sm text-secondary', text: 'Los archivos se generan en tu navegador con los datos que ya tienes cargados.' }),
      h('div', { class: 'row-2 row-wrap' },
        button({ label: 'Exportar eventos', icon: 'download', onClick: exportEvents }),
        button({ label: 'Exportar inscripciones', icon: 'download', onClick: exportRegistrations }),
        button({ label: 'Exportar usuarios', icon: 'download', onClick: exportUsers }),
        button({ label: 'Plantilla de importación', icon: 'file-text', onClick: downloadTemplate }))),
  });

  const securityCard = card({
    title: 'Seguridad',
    body: h('div', { class: 'stack-2' },
      h('p', { class: 'text-sm text-secondary' },
        'Las operaciones sobre cuentas (crear, deshabilitar, eliminar, cambiar rol) se ejecutan en Cloud Functions ',
        'con el SDK de Firebase Admin. La consola nunca inicia sesión en la cuenta de otra persona ni necesita su contraseña.'),
      h('ul', { class: 'stack-2' },
        securityItem('Las credenciales de servicio nunca salen del servidor.'),
        securityItem('El backend verifica de forma independiente que quien llama sea administrador.'),
        securityItem('Las acciones sobre cuentas se registran en la auditoría desde el servidor.'),
        securityItem('Los valores de la base de datos se insertan como texto, nunca como HTML.'))),
  });

  replaceChildren(container,
    h('div', { class: 'settings-grid' }, accountCard, systemCard),
    h('div', { class: 'settings-grid' }, preferencesCard, dataCard),
    securityCard);

  setPageActions([]);
  renderBackendStatus('unknown');
  checkBackend();

  function renderBackendStatus(status) {
    let node;
    if (status === 'checking') node = h('span', { class: 'row-2' }, h('span', { class: 'spinner' }), h('span', { class: 'text-sm', text: 'Comprobando…' }));
    else if (status === 'ready') node = badge('Disponible', 'success', { iconName: 'circle-check' });
    else if (status === 'unavailable') node = badge('No desplegado', 'danger', { iconName: 'alert-triangle' });
    else node = badge('Sin comprobar', 'neutral', { dot: false });
    replaceChildren(backendStatusSlot, node);
  }

  async function checkBackend() {
    renderBackendStatus('checking');
    try {
      await adminApi.ping();
      renderBackendStatus('ready');
      if (backendChecked) notify.success('El backend de administración responde correctamente.');
    } catch (error) {
      renderBackendStatus('unavailable');
      if (backendChecked) notify.error(describeError(error, adminApi.BACKEND_UNAVAILABLE_MESSAGE));
    } finally {
      backendChecked = true;
    }
  }

  function exportEvents() {
    const events = eventsStore.state.items;
    if (!events.length) { notify.warning('No hay eventos cargados para exportar.'); return; }
    downloadFile(exportFilename('eventos'), toCsv([
      { key: 'id', label: 'id' },
      { key: 'title', label: 'titulo' },
      { key: 'status', label: 'estado' },
      { key: 'startAt', label: 'fechaInicio', value: (row) => (row.startAt ? new Date(row.startAt).toISOString() : '') },
      { key: 'location', label: 'ubicacion' },
      { key: 'tags', label: 'etiquetas', value: (row) => row.tags.join(' | ') },
      { key: 'registrationCount', label: 'inscritos' },
    ], events));
    notify.success(`Se exportaron ${formatNumber(events.length)} eventos.`);
  }

  function exportRegistrations() {
    const rows = flattenRegistrations(eventsStore.state.items);
    if (!rows.length) { notify.warning('No hay inscripciones cargadas para exportar.'); return; }
    downloadFile(exportFilename('inscripciones'), toCsv([
      { key: 'name', label: 'Estudiante' },
      { key: 'code', label: 'Código' },
      { key: 'dni', label: 'DNI' },
      { key: 'facultyName', label: 'Facultad' },
      { key: 'specialtyName', label: 'Programa' },
      { key: 'semester', label: 'Semestre' },
      { key: 'mode', label: 'Modalidad' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Teléfono' },
      { key: 'eventTitle', label: 'Evento' },
      { key: 'registeredAt', label: 'Fecha', value: (row) => (row.registeredAt ? new Date(row.registeredAt).toISOString() : '') },
    ], rows));
    notify.success(`Se exportaron ${formatNumber(rows.length)} inscripciones.`);
  }

  function exportUsers() {
    const users = usersStore.state.items;
    if (!users.length) { notify.warning('No hay usuarios cargados para exportar.'); return; }
    downloadFile(exportFilename('usuarios'), toCsv([
      { key: 'email', label: 'email' },
      { key: 'dni', label: 'dni' },
      { key: 'stCode', label: 'stCode' },
      { key: 'role', label: 'role' },
      { key: 'uid', label: 'uid' },
    ], users));
    notify.success(`Se exportaron ${formatNumber(users.length)} usuarios.`);
  }

  // The settings page reads cached data; it subscribes so the exports reflect
  // the latest snapshot even when the console opens directly on this route.
  const unsubscribes = [
    eventsStore.subscribe(() => {}),
    usersStore.subscribe(() => {}),
  ];

  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    setPageActions([]);
  };
}

function row(label, valueNode) {
  return h('div', { class: 'status-row' },
    h('span', { class: 'status-row__label', text: label }),
    h('span', { class: 'status-row__value' }, valueNode));
}

function securityItem(text) {
  return h('li', { class: 'row-2', style: { 'align-items': 'flex-start' } },
    icon('check', { size: 16 }),
    h('span', { class: 'text-sm', text }));
}

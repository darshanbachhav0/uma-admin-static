/**
 * Configuración.
 *
 * Cuenta del administrador, apariencia de la consola (tema, barra lateral,
 * densidad), estado de los servicios de los que depende la app, y exportación
 * de los datos de eventos e inscripciones. Cada control aquí funciona de
 * verdad — no hay controles de relleno.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { avatar, badge, button, card, segmentedControl } from '../ui/controls.js';
import { notify } from '../ui/toast.js';
import { getSession, refreshAuthorization, signOut } from '../core/session.js';
import { setPageActions } from '../core/shell.js';
import { DATABASE_URL, PROJECT_ID } from '../core/firebase.js';
import { eventsStore, flattenRegistrations } from '../core/store.js';
import {
  THEMES, DENSITIES, getThemePreference, setThemePreference,
  getDensityPreference, setDensityPreference, getSidebarCollapsed, setSidebarCollapsed,
} from '../core/theme.js';
import { hasUnsplashKey } from '../services/unsplash.js';
import { toCsv, downloadFile, exportFilename } from '../utils/csv.js';
import { describeError } from '../utils/validate.js';
import { formatDateTime, formatNumber, initials, EM_DASH } from '../utils/format.js';

const THEME_OPTIONS = [
  { value: THEMES.LIGHT, label: 'Claro', icon: 'circle-check' },
  { value: THEMES.DARK, label: 'Oscuro', icon: 'ban' },
  { value: THEMES.SYSTEM, label: 'Sistema', icon: 'settings' },
];

const SIDEBAR_OPTIONS = [
  { value: 'expanded', label: 'Expandido', icon: 'panel-left' },
  { value: 'collapsed', label: 'Colapsado', icon: 'chevrons-right' },
];

const DENSITY_OPTIONS = [
  { value: DENSITIES.COMFORTABLE, label: 'Cómodo' },
  { value: DENSITIES.COMPACT, label: 'Compacto' },
];

export function mount(container) {
  const session = getSession();

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
          ? badge('Custom claim', 'success', { iconName: 'shield-check' })
          : badge('Rol en la base de datos', 'info', { iconName: 'database' })),
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

  // ---- Apariencia --------------------------------------------------------
  const themeControl = segmentedControl({
    options: THEME_OPTIONS,
    value: getThemePreference(),
    ariaLabel: 'Tema de la consola',
    onChange: (value) => {
      setThemePreference(value);
      notify.success(`Tema ${THEME_OPTIONS.find((o) => o.value === value).label.toLowerCase()} aplicado.`);
    },
  });

  const sidebarControl = segmentedControl({
    options: SIDEBAR_OPTIONS,
    value: getSidebarCollapsed() ? 'collapsed' : 'expanded',
    ariaLabel: 'Estado de la barra lateral',
    onChange: (value) => {
      setSidebarCollapsed(value === 'collapsed');
    },
  });

  const densityControl = segmentedControl({
    options: DENSITY_OPTIONS,
    value: getDensityPreference(),
    ariaLabel: 'Densidad de la interfaz',
    onChange: (value) => {
      setDensityPreference(value);
      notify.success(value === DENSITIES.COMPACT ? 'Densidad compacta aplicada.' : 'Densidad cómoda aplicada.');
    },
  });

  const appearanceCard = card({
    title: 'Apariencia',
    subtitle: 'Se guarda solo en este navegador',
    body: h('div', { class: 'stack' },
      appearanceRow('Tema', 'Claro, oscuro o según el sistema operativo.', themeControl),
      appearanceRow('Barra lateral', 'Expandida con etiquetas, o colapsada a solo íconos.', sidebarControl),
      appearanceRow('Densidad', 'Compacto reduce el alto de filas, botones y campos.', densityControl)),
  });

  // ---- Sistema ------------------------------------------------------------
  const systemCard = card({
    title: 'Estado del sistema',
    subtitle: 'Servicios de los que depende la consola',
    body: h('div', null,
      row('Proyecto de Firebase', h('span', { class: 'text-mono', text: PROJECT_ID || EM_DASH })),
      row('Realtime Database', h('span', { class: 'text-mono', text: DATABASE_URL || EM_DASH })),
      row('Imágenes de Unsplash', hasUnsplashKey
        ? badge('Clave configurada', 'success', { iconName: 'circle-check' })
        : badge('Sin clave (modo limitado)', 'warning', { iconName: 'alert-triangle' }))),
  });

  // ---- Datos ---------------------------------------------------------------
  const dataCard = card({
    title: 'Datos',
    subtitle: 'Exporta la información de eventos e inscripciones',
    body: h('div', { class: 'stack-2' },
      h('p', { class: 'text-sm text-secondary', text: 'Los archivos se generan en tu navegador con los datos que ya tienes cargados.' }),
      h('div', { class: 'row-2 row-wrap' },
        button({ label: 'Exportar eventos', icon: 'download', onClick: exportEvents }),
        button({ label: 'Exportar inscripciones', icon: 'download', onClick: exportRegistrations }))),
  });

  replaceChildren(container,
    h('div', { class: 'settings-grid' }, accountCard, appearanceCard),
    h('div', { class: 'settings-grid' }, systemCard, dataCard));

  setPageActions([]);

  // Keep the Apariencia controls in sync if the sidebar toggle in the shell
  // is used while this page is open.
  function onExternalCollapseChange(event) {
    sidebarControl.setValue(event.detail.collapsed ? 'collapsed' : 'expanded');
  }
  document.addEventListener('uma:sidebar-collapse-change', onExternalCollapseChange);

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

  // The settings page reads cached data; it subscribes so the exports reflect
  // the latest snapshot even when the console opens directly on this route.
  const unsubscribeEvents = eventsStore.subscribe(() => {});

  return () => {
    unsubscribeEvents();
    document.removeEventListener('uma:sidebar-collapse-change', onExternalCollapseChange);
    setPageActions([]);
  };
}

function row(label, valueNode) {
  return h('div', { class: 'status-row' },
    h('span', { class: 'status-row__label', text: label }),
    h('span', { class: 'status-row__value' }, valueNode));
}

function appearanceRow(label, hint, control) {
  return h('div', { class: 'appearance-row' },
    h('div', { class: 'appearance-row__text' },
      h('span', { class: 'appearance-row__label', text: label }),
      h('span', { class: 'appearance-row__hint', text: hint })),
    control);
}

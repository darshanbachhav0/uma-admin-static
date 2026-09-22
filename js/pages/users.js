/**
 * User management.
 *
 * Reads `/users` from the database and enriches each row with Firebase Auth
 * metadata (email, disabled, created, last sign-in) fetched from the Cloud
 * Functions backend. Every privileged action is a callable function — the
 * console never signs into anybody's account and never needs their password.
 */
import { h, replaceChildren } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { avatar, badge, button, searchInput, select } from '../ui/controls.js';
import { menuTrigger } from '../ui/menu.js';
import { emptyState, errorState, skeletonTable } from '../ui/states.js';
import { pagination } from '../ui/pagination.js';
import { openOverlay } from '../ui/overlay.js';
import { notify } from '../ui/toast.js';
import { confirmDelete, confirmDialog } from '../ui/confirm.js';
import { usersStore } from '../core/store.js';
import { setPageActions } from '../core/shell.js';
import { getSession } from '../core/session.js';
import { getPref, setPref } from '../core/prefs.js';
import * as adminApi from '../services/adminApi.js';
import { openCreateUserDialog, openImportUsersDialog } from './user-dialogs.js';
import { describeError } from '../utils/validate.js';
import { toCsv, downloadFile, exportFilename } from '../utils/csv.js';
import { formatDateTime, formatNumber, maskDni, pluralize, EM_DASH } from '../utils/format.js';

const ANY = '__all__';

const ROLE_FILTERS = [
  { value: ANY, label: 'Todos los roles' },
  { value: 'admin', label: 'Administradores' },
  { value: 'student', label: 'Estudiantes' },
];

const STATUS_FILTERS = [
  { value: ANY, label: 'Cualquier estado' },
  { value: 'active', label: 'Activas' },
  { value: 'disabled', label: 'Deshabilitadas' },
];

export function mount(container) {
  const session = getSession();

  const filters = { search: '', role: ANY, status: ANY };
  let storeState = usersStore.state;
  /** uid -> auth metadata from the backend. */
  let authInfo = new Map();
  let authStatus = 'idle'; // idle | loading | ready | unavailable | error
  let page = 1;
  let pageSize = getPref('pageSize');
  let maskIds = getPref('maskDni');
  let rows = [];

  const search = searchInput({
    placeholder: 'Buscar por correo, código o DNI',
    ariaLabel: 'Buscar usuarios',
    onInput: (value) => { filters.search = value; page = 1; render(); },
  });

  const roleSelect = select({ options: ROLE_FILTERS, 'aria-label': 'Filtrar por rol' });
  roleSelect.addEventListener('change', () => { filters.role = roleSelect.value; page = 1; render(); });

  const statusSelect = select({ options: STATUS_FILTERS, 'aria-label': 'Filtrar por estado de la cuenta' });
  statusSelect.addEventListener('change', () => { filters.status = statusSelect.value; page = 1; render(); });

  const clearBtn = button({
    label: 'Limpiar filtros',
    variant: 'ghost',
    size: 'sm',
    icon: 'filter-x',
    onClick: () => {
      Object.assign(filters, { search: '', role: ANY, status: ANY });
      search.input.value = '';
      roleSelect.value = ANY;
      statusSelect.value = ANY;
      page = 1;
      render();
    },
  });

  const maskBtn = button({
    label: 'Mostrar DNI',
    variant: 'ghost',
    size: 'sm',
    icon: 'eye',
    onClick: () => { maskIds = setPref('maskDni', !maskIds); render(); },
  });

  const countEl = h('p', { class: 'table-toolbar__meta', role: 'status', 'aria-live': 'polite' });

  const bannerSlot = h('div');
  const tableSlot = h('div');
  const paginationSlot = h('div');

  const toolbar = h('div', { class: 'table-toolbar' },
    h('div', { class: 'table-toolbar__search' }, search),
    h('div', { class: 'table-toolbar__filters' }, roleSelect, statusSelect, clearBtn, maskBtn),
    h('div', { class: 'spacer' }),
    countEl);

  replaceChildren(container, bannerSlot, h('section', { class: 'card' }, toolbar, tableSlot, paginationSlot));

  setPageActions([
    button({ label: 'Importar CSV', variant: 'ghost', icon: 'upload', onClick: () => openImport() }),
    button({ label: 'Exportar CSV', variant: 'ghost', icon: 'download', onClick: exportCsv }),
    button({ label: 'Nuevo usuario', variant: 'primary', icon: 'user-plus', onClick: () => openCreate() }),
  ]);

  const unsubscribe = usersStore.subscribe((next) => {
    storeState = next;
    render();
    if (next.status === 'ready') loadAuthInfo();
  });

  let authRequest = null;

  async function loadAuthInfo(force = false) {
    if (authRequest && !force) return authRequest;
    if (!force && (authStatus === 'ready' || authStatus === 'unavailable')) return null;

    authStatus = 'loading';
    render();

    authRequest = (async () => {
      try {
        const data = await adminApi.listUsers();
        const next = new Map();
        for (const entry of data.users || []) next.set(entry.uid, entry);
        authInfo = next;
        authStatus = 'ready';
      } catch (error) {
        const code = String((error && error.code) || '');
        authStatus = code.includes('not-found') || code.includes('unavailable') ? 'unavailable' : 'error';
        if (authStatus === 'error') {
          console.error('[users] no se pudo leer la información de las cuentas', error);
        }
      } finally {
        authRequest = null;
        render();
      }
    })();

    return authRequest;
  }

  function backendReady() {
    return authStatus === 'ready';
  }

  function combine() {
    return storeState.items.map((user) => {
      const info = authInfo.get(user.uid) || null;
      const role = info && info.admin ? 'admin' : (user.role === 'admin' ? 'admin' : 'student');
      return {
        ...user,
        role,
        email: user.email || (info ? info.email : ''),
        disabled: info ? Boolean(info.disabled) : false,
        hasAuthInfo: Boolean(info),
        authCreatedAt: info ? info.createdAt || 0 : 0,
        lastSignInAt: info ? info.lastSignInAt || 0 : 0,
        emailVerified: info ? Boolean(info.emailVerified) : false,
      };
    });
  }

  function applyFilters(all) {
    const query = filters.search.trim().toLowerCase();
    return all.filter((user) => {
      if (filters.role !== ANY && user.role !== filters.role) return false;
      if (filters.status !== ANY) {
        if (filters.status === 'active' && user.disabled) return false;
        if (filters.status === 'disabled' && !user.disabled) return false;
      }
      if (query) {
        const haystack = [user.email, user.stCode, user.dni, user.uid].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function render() {
    clearBtn.classList.toggle('hidden', !(filters.search || filters.role !== ANY || filters.status !== ANY));
    maskBtn.querySelector('.btn__label').textContent = maskIds ? 'Mostrar DNI' : 'Ocultar DNI';
    statusSelect.disabled = authStatus !== 'ready';

    renderBanner();

    if (storeState.status === 'error') {
      countEl.textContent = '';
      replaceChildren(tableSlot, errorState({
        title: 'No se pudieron cargar los usuarios',
        text: describeError(storeState.error, 'Revisa los permisos de lectura sobre /users.'),
        actions: [button({ label: 'Reintentar', icon: 'refresh', onClick: () => usersStore.refresh() })],
      }));
      replaceChildren(paginationSlot);
      return;
    }

    if ((storeState.status === 'loading' || storeState.status === 'idle') && !storeState.items.length) {
      countEl.textContent = '';
      replaceChildren(tableSlot, h('div', { class: 'table-scroll' }, skeletonTable(6, 8)));
      replaceChildren(paginationSlot);
      return;
    }

    const all = combine();
    rows = applyFilters(all);

    countEl.textContent = rows.length === all.length
      ? pluralize(rows.length, 'usuario', 'usuarios')
      : `${formatNumber(rows.length)} de ${pluralize(all.length, 'usuario', 'usuarios')}`;

    if (!all.length) {
      replaceChildren(tableSlot, emptyState({
        title: 'No hay usuarios registrados',
        text: 'Crea el primer usuario o importa un archivo CSV con las cuentas de los estudiantes.',
        icon: 'users',
        actions: [
          button({ label: 'Nuevo usuario', variant: 'primary', icon: 'user-plus', onClick: () => openCreate() }),
          button({ label: 'Importar CSV', icon: 'upload', onClick: () => openImport() }),
        ],
      }));
      replaceChildren(paginationSlot);
      return;
    }

    if (!rows.length) {
      replaceChildren(tableSlot, emptyState({
        title: 'Sin resultados',
        text: 'Ningún usuario coincide con los filtros aplicados.',
        icon: 'search',
        actions: [button({ label: 'Limpiar filtros', icon: 'filter-x', onClick: () => clearBtn.click() })],
      }));
      replaceChildren(paginationSlot);
      return;
    }

    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > pageCount) page = pageCount;
    const visible = rows.slice((page - 1) * pageSize, page * pageSize);

    replaceChildren(tableSlot, h('div', { class: 'table-scroll' }, buildTable(visible)));
    replaceChildren(paginationSlot, pagination({
      total: rows.length,
      page,
      pageSize,
      noun: 'usuarios',
      onChange: (next) => { page = next; render(); },
      onPageSizeChange: (size) => { pageSize = setPref('pageSize', size); page = 1; render(); },
    }));
  }

  function renderBanner() {
    if (authStatus === 'unavailable') {
      replaceChildren(bannerSlot, h('div', { class: 'alert alert--warning' },
        icon('server', { size: 18 }),
        h('span', null,
          h('strong', { text: 'Backend de administración no desplegado. ' }),
          adminApi.BACKEND_UNAVAILABLE_MESSAGE,
          ' Mientras tanto puedes consultar y exportar los usuarios, pero no crear, deshabilitar ni eliminar cuentas.')));
      return;
    }
    if (authStatus === 'error') {
      replaceChildren(bannerSlot, h('div', { class: 'alert' },
        icon('alert-circle', { size: 18 }),
        h('span', null,
          'No se pudo consultar el estado de las cuentas. ',
          h('button', {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            text: 'Reintentar',
            onclick: () => loadAuthInfo(true),
          }))));
      return;
    }
    replaceChildren(bannerSlot);
  }

  function buildTable(visible) {
    const head = h('thead', h('tr',
      h('th', { text: 'Usuario' }),
      h('th', { class: 'prio-2', text: 'Código' }),
      h('th', { class: 'prio-4', text: 'DNI' }),
      h('th', { text: 'Rol' }),
      h('th', { class: 'prio-3', text: 'Estado' }),
      h('th', { class: 'prio-4', text: 'Creada' }),
      h('th', { class: 'prio-5', text: 'Último acceso' }),
      h('th', { class: 'cell-actions' }, h('span', { class: 'visually-hidden', text: 'Acciones' }))));

    const body = h('tbody');
    for (const user of visible) {
      body.appendChild(h('tr',
        h('td', h('div', { class: 'row-2' },
          avatar(initialsFor(user), { small: true }),
          h('div', { class: 'cell-stack' },
            h('span', { class: 'cell-primary', text: user.email || '(Sin correo)' }),
            h('span', { class: 'cell-stack__sub text-mono', text: user.uid })))),
        h('td', { class: 'prio-2 text-mono', text: user.stCode || EM_DASH }),
        h('td', { class: 'prio-4 text-mono', text: user.dni ? (maskIds ? maskDni(user.dni) : user.dni) : EM_DASH }),
        h('td', user.role === 'admin'
          ? badge('Administrador', 'brand', { iconName: 'shield' })
          : badge('Estudiante', 'neutral', { dot: false })),
        h('td', { class: 'prio-3' }, statusCell(user)),
        h('td', { class: 'prio-4 text-nowrap', text: user.authCreatedAt ? formatDateTime(user.authCreatedAt) : (user.createdAt ? formatDateTime(user.createdAt) : EM_DASH) }),
        h('td', { class: 'prio-5 text-nowrap', text: user.lastSignInAt ? formatDateTime(user.lastSignInAt) : EM_DASH }),
        h('td', { class: 'cell-actions' }, rowMenu(user))));
    }

    return h('table', { class: 'table' }, head, body);
  }

  function statusCell(user) {
    if (!user.hasAuthInfo) {
      return badge('Sin datos', 'neutral', { dot: false, iconName: 'alert-circle' });
    }
    return user.disabled
      ? badge('Deshabilitada', 'danger', { iconName: 'ban' })
      : badge('Activa', 'success', { iconName: 'circle-check' });
  }

  function rowMenu(user) {
    const isSelf = session.user && session.user.uid === user.uid;
    return menuTrigger({
      label: `Acciones para ${user.email || user.uid}`,
      items: () => [
        { label: 'Ver detalle', icon: 'eye', onSelect: () => openDetail(user) },
        { separator: true },
        {
          label: user.disabled ? 'Habilitar cuenta' : 'Deshabilitar cuenta',
          icon: user.disabled ? 'circle-check' : 'ban',
          disabled: !backendReady() || isSelf,
          onSelect: () => toggleDisabled(user),
        },
        {
          label: 'Enviar restablecimiento de contraseña',
          icon: 'key',
          disabled: !backendReady() || !user.email,
          onSelect: () => resetPassword(user),
        },
        {
          label: user.role === 'admin' ? 'Quitar rol de administrador' : 'Convertir en administrador',
          icon: 'shield',
          disabled: !backendReady() || isSelf,
          onSelect: () => changeRole(user),
        },
        { separator: true },
        {
          label: 'Eliminar usuario',
          icon: 'trash',
          danger: true,
          disabled: !backendReady() || isSelf,
          onSelect: () => removeUser(user),
        },
      ],
    });
  }

  function openDetail(user) {
    openOverlay({
      title: user.email || '(Sin correo)',
      subtitle: user.role === 'admin' ? 'Administrador' : 'Estudiante',
      variant: 'drawer',
      body: h('div', { class: 'stack' },
        h('div', { class: 'row-2 row-wrap' },
          statusCell(user),
          user.emailVerified ? badge('Correo verificado', 'success', { dot: false }) : null),
        h('dl', { class: 'detail-list' },
          h('dt', { text: 'UID' }), h('dd', h('code', { class: 'text-mono', text: user.uid })),
          h('dt', { text: 'Código de estudiante' }), h('dd', { class: 'text-mono', text: user.stCode || EM_DASH }),
          h('dt', { text: 'DNI' }), h('dd', { class: 'text-mono', text: user.dni || EM_DASH }),
          h('dt', { text: 'Rol' }), h('dd', { text: user.role === 'admin' ? 'Administrador' : 'Estudiante' }),
          h('dt', { text: 'Cuenta creada' }),
          h('dd', { text: user.authCreatedAt ? formatDateTime(user.authCreatedAt) : (user.createdAt ? formatDateTime(user.createdAt) : EM_DASH) }),
          h('dt', { text: 'Último acceso' }), h('dd', { text: user.lastSignInAt ? formatDateTime(user.lastSignInAt) : EM_DASH })),
        !user.hasAuthInfo
          ? h('p', { class: 'alert alert--warning' }, icon('alert-triangle', { size: 16 }),
            h('span', { text: 'Esta ficha no tiene una cuenta de acceso asociada, o el backend de administración no está disponible.' }))
          : null),
    });
  }

  async function toggleDisabled(user) {
    const disable = !user.disabled;
    const confirmed = await confirmDialog({
      title: disable ? '¿Deshabilitar esta cuenta?' : '¿Habilitar esta cuenta?',
      tone: disable ? 'danger' : 'info',
      itemLabel: user.email || user.uid,
      message: disable
        ? 'La persona no podrá iniciar sesión hasta que vuelvas a habilitar la cuenta. Sus datos se conservan.'
        : 'La persona podrá volver a iniciar sesión con sus credenciales actuales.',
      confirmLabel: disable ? 'Deshabilitar' : 'Habilitar',
      onConfirm: async () => {
        try {
          await adminApi.setUserDisabled(user.uid, disable);
        } catch (error) {
          notify.error(describeError(error, 'No se pudo cambiar el estado de la cuenta.'));
          throw error;
        }
      },
    });
    if (confirmed) {
      notify.success(disable ? 'Cuenta deshabilitada.' : 'Cuenta habilitada.');
      await loadAuthInfo(true);
    }
  }

  async function resetPassword(user) {
    const confirmed = await confirmDialog({
      title: 'Enviar restablecimiento de contraseña',
      tone: 'info',
      itemLabel: user.email,
      message: 'Se enviará un correo con un enlace para que la persona defina una nueva contraseña. Tú no verás ni necesitarás su contraseña.',
      confirmLabel: 'Enviar correo',
      onConfirm: async () => {
        try {
          await adminApi.sendPasswordReset(user.email);
        } catch (error) {
          notify.error(describeError(error, 'No se pudo enviar el correo de restablecimiento.'));
          throw error;
        }
      },
    });
    if (confirmed) notify.success(`Se envió el enlace de restablecimiento a ${user.email}.`);
  }

  async function changeRole(user) {
    const makeAdmin = user.role !== 'admin';
    const confirmed = await confirmDialog({
      title: makeAdmin ? '¿Conceder acceso de administrador?' : '¿Quitar el acceso de administrador?',
      tone: makeAdmin ? 'warning' : 'danger',
      itemLabel: user.email || user.uid,
      message: makeAdmin
        ? 'Esta persona podrá entrar a la consola y administrar eventos, inscripciones y cuentas.'
        : 'Esta persona dejará de tener acceso a la consola de administración.',
      confirmLabel: makeAdmin ? 'Conceder acceso' : 'Quitar acceso',
      onConfirm: async () => {
        try {
          await adminApi.setUserRole(user.uid, makeAdmin ? 'admin' : 'student');
        } catch (error) {
          notify.error(describeError(error, 'No se pudo cambiar el rol.'));
          throw error;
        }
      },
    });
    if (confirmed) {
      notify.success(makeAdmin ? 'Rol de administrador concedido.' : 'Rol de administrador retirado.');
      await loadAuthInfo(true);
    }
  }

  async function removeUser(user) {
    const confirmed = await confirmDelete({
      itemLabel: user.email || user.uid,
      message: 'Se eliminará la cuenta de acceso y su ficha en la base de datos. Las inscripciones que ya haya realizado se conservan. Esta acción no se puede deshacer.',
      confirmationPhrase: user.role === 'admin' ? 'ELIMINAR' : '',
      onConfirm: async () => {
        try {
          await adminApi.deleteUser(user.uid);
        } catch (error) {
          notify.error(describeError(error, 'No se pudo eliminar el usuario.'));
          throw error;
        }
      },
    });
    if (confirmed) {
      notify.success('Usuario eliminado.');
      await loadAuthInfo(true);
    }
  }

  async function openCreate() {
    if (!(await requireBackend())) return;
    openCreateUserDialog({
      existingUsers: combine(),
      onDone: () => loadAuthInfo(true),
    });
  }

  async function openImport() {
    if (!(await requireBackend())) return;
    openImportUsersDialog({
      existingUsers: combine(),
      onDone: () => loadAuthInfo(true),
    });
  }

  async function requireBackend() {
    if (authStatus === 'ready') return true;
    if (authStatus === 'loading') { await authRequest; }
    if (authStatus === 'ready') return true;
    notify.error(adminApi.BACKEND_UNAVAILABLE_MESSAGE, 'Backend no disponible');
    return false;
  }

  function exportCsv() {
    if (!rows.length) {
      notify.warning('No hay usuarios que exportar con los filtros actuales.');
      return;
    }
    downloadFile(exportFilename('usuarios'), toCsv([
      { key: 'email', label: 'email' },
      { key: 'dni', label: 'dni' },
      { key: 'stCode', label: 'stCode' },
      { key: 'role', label: 'role' },
      { key: 'uid', label: 'uid' },
      { key: 'disabled', label: 'deshabilitada', value: (row) => (row.hasAuthInfo ? (row.disabled ? 'si' : 'no') : '') },
      { key: 'lastSignInAt', label: 'ultimoAcceso', value: (row) => (row.lastSignInAt ? new Date(row.lastSignInAt).toISOString() : '') },
    ], rows));
    notify.success(`Se exportaron ${formatNumber(rows.length)} usuarios.`);
  }

  function initialsFor(user) {
    const source = user.email || user.stCode || user.uid;
    return String(source).slice(0, 2).toUpperCase();
  }

  render();
  loadAuthInfo();

  return () => {
    unsubscribe();
    setPageActions([]);
  };
}

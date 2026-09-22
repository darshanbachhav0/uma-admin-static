# UMA Admin

Consola de administración de la Universidad María Auxiliadora: eventos,
inscripciones, usuarios y auditoría.

Sitio estático (HTML + CSS + JavaScript con módulos ES, sin framework ni paso de
compilación) sobre Firebase Authentication y Realtime Database, con un backend
privilegiado en Cloud Functions.

---

## Estructura

```
index.html                     Shell de la aplicación
config.template.js             Plantilla de configuración pública (envsubst)
render-build.sh                Genera config.js a partir de variables de entorno

styles/
  tokens.css                   Design tokens (color, tipografía, espaciado, radios…)
  base.css                     Reset, tipografía y utilidades
  components.css               Botones, campos, tablas, modales, toasts, menús…
  layout.css                   Login, sidebar, barra superior, shell
  pages.css                    Composición de dashboard, eventos e importador

js/
  main.js                      Punto de entrada y estados de pantalla
  core/
    firebase.js                Inicialización del SDK y configuración
    session.js                 Sesión, rol de administrador, cierre de sesión
    store.js                   Suscripciones a la base de datos con recuento de referencias
    router.js                  Enrutador por hash con montaje/desmontaje
    shell.js                   Sidebar, barra superior, perfil
    prefs.js                   Preferencias locales de visualización
  ui/                          Componentes reutilizables (dom, icons, controls,
                               overlay, confirm, menu, toast, states, pagination, chart)
  services/                    events, registrations (vía store), users (adminApi),
                               audit, unsplash
  pages/                       login, dashboard, events, event-editor,
                               registrations, users, user-dialogs, audit, settings
  utils/                       format, validate, csv

functions/                     Cloud Functions (Firebase Admin SDK)
database.rules.json            Reglas de seguridad — perfil de compatibilidad
database.rules.hardened.json   Reglas endurecidas — requiere migración
firebase.json                  Configuración de despliegue
docs/DEPLOYMENT.md             Pasos de despliegue
docs/SECURITY.md               Modelo de seguridad y migraciones pendientes
```

## Desarrollo local

El proyecto usa módulos ES, por lo que debe servirse por HTTP (abrir
`index.html` con `file://` no funciona).

```bash
FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=... FIREBASE_DATABASE_URL=... \
FIREBASE_PROJECT_ID=... FIREBASE_STORAGE_BUCKET=... FIREBASE_MESSAGING_SENDER_ID=... \
FIREBASE_APP_ID=... FIREBASE_MEASUREMENT_ID=... ./render-build.sh
```

```bash
npx serve . -l 5173
```

## Secciones

| Sección       | Ruta               | Contenido |
|---------------|--------------------|-----------|
| Dashboard     | `#/`               | KPIs, inscripciones por mes, estado de eventos, próximos eventos, actividad reciente |
| Eventos       | `#/eventos`        | Búsqueda, filtros, orden, tarjetas, editor en panel lateral |
| Inscripciones | `#/inscripciones`  | Tabla agregada de todos los eventos, filtros, exportación CSV |
| Usuarios      | `#/usuarios`       | Tabla de cuentas, alta individual, importación CSV, acciones privilegiadas |
| Auditoría     | `#/auditoria`      | Registro de acciones administrativas |
| Ajustes       | `#/ajustes`        | Cuenta, estado del sistema, preferencias, exportaciones |

Enlaces profundos admitidos: `#/eventos?nuevo=1`, `#/eventos?editar=<id>`,
`#/inscripciones?evento=<id>`.

## Modelo de datos

La forma almacenada no cambió respecto de la versión anterior, para no romper la
aplicación de estudiantes:

```
/events/{eventId}
  id, title, description, location, tags[], status, startAt, imageUrl,
  imageCredit?, createdBy, createdAt, updatedAt (nuevo, opcional)
  /registrations/{key}
    name, code, dni, facultyName, specialtyName, semester, mode, email,
    phone, registeredAt, uid

/users/{uid}
  dni, stCode, role?, email (nuevo, opcional), createdAt?, createdBy?

/auditLogs/{entryId}          (nuevo)
  at, action, actorUid, actorEmail, targetType, targetId, targetLabel,
  source, meta?
```

`status` conserva sus dos valores históricos: `upcoming` y `ongoing`. El estado
temporal que se ve en la interfaz (Programado / Hoy / Finalizado) se deriva de
`startAt` y no se almacena.

## Seguridad

Las operaciones privilegiadas sobre cuentas se ejecutan en Cloud Functions con
el SDK de Firebase Admin. Consulta [docs/SECURITY.md](docs/SECURITY.md).

## Despliegue

Consulta [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

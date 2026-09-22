# UMA Admin

Panel administrativo de eventos de la Universidad María Auxiliadora: eventos,
inscripciones y auditoría.

Sitio estático (HTML + CSS + JavaScript con módulos ES, sin framework ni paso de
compilación) sobre Firebase Authentication y Realtime Database. No tiene
backend propio: administra sesiones y datos directamente desde el navegador.

---

## Estructura

```
index.html                     Shell de la aplicación
config.template.js             Plantilla de configuración pública (envsubst)
render-build.sh                Genera config.js a partir de variables de entorno
assets/uma-logo.jpg            Logo oficial de la Universidad María Auxiliadora

styles/
  tokens.css                   Design tokens (color, tipografía, espaciado, radios,
                               temas claro/oscuro, densidad cómoda/compacta)
  base.css                     Reset, tipografía y utilidades
  components.css               Botones, campos, tablas, modales, toasts, menús…
  layout.css                   Login, sidebar, barra superior, shell
  pages.css                    Composición de dashboard, eventos y configuración

js/
  main.js                      Punto de entrada y estados de pantalla
  core/
    firebase.js                Inicialización del SDK y configuración
    session.js                 Sesión, rol de administrador, cierre de sesión
    store.js                   Suscripciones a la base de datos con recuento de referencias
    router.js                  Enrutador por hash con montaje/desmontaje
    shell.js                   Sidebar, barra superior, perfil
    theme.js                   Tema, densidad y estado de la barra lateral (localStorage)
    prefs.js                   Preferencias locales de visualización
  ui/                          Componentes reutilizables (dom, icons, controls,
                               overlay, confirm, menu, toast, states, pagination, chart)
  services/                    events, registrations (vía store), audit, unsplash
  pages/                       login, dashboard, events, event-editor,
                               registrations, audit, settings
  utils/                       format, validate, csv

database.rules.json            Reglas de seguridad — perfil de compatibilidad
firebase.json                  Configuración de despliegue
docs/DEPLOYMENT.md             Pasos de despliegue
docs/SECURITY.md               Modelo de seguridad
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
| Dashboard     | `#/`               | KPIs de eventos e inscripciones, gráfico mensual, estado de eventos, próximos eventos, actividad reciente |
| Eventos       | `#/eventos`        | Búsqueda, filtros, orden, tarjetas, editor en panel lateral |
| Inscripciones | `#/inscripciones`  | Tabla agregada de todos los eventos, filtros, exportación CSV |
| Auditoría     | `#/auditoria`      | Registro de acciones sobre eventos (creado, editado, eliminado, duplicado) |
| Configuración | `#/configuracion`  | Cuenta, apariencia (tema, barra lateral, densidad), estado del sistema, exportaciones |

Enlaces profundos admitidos: `#/eventos?nuevo=1`, `#/eventos?editar=<id>`,
`#/inscripciones?evento=<id>`.

## Apariencia

La sección **Configuración → Apariencia** controla tres preferencias, guardadas
en `localStorage` de ese navegador:

- **Tema**: claro, oscuro o según el sistema operativo (se actualiza en vivo si
  cambia la preferencia del sistema).
- **Barra lateral**: expandida o colapsada a solo íconos; el mismo control que
  el botón de la barra lateral.
- **Densidad**: cómoda o compacta (reduce el alto de botones, campos y filas de
  tabla).

## Modelo de datos

La forma almacenada no cambió respecto de versiones anteriores, para no romper
la aplicación de estudiantes:

```
/events/{eventId}
  id, title, description, location, tags[], status, startAt, imageUrl,
  imageCredit?, createdBy, createdAt, updatedAt (opcional)
  /registrations/{key}
    name, code, dni, facultyName, specialtyName, semester, mode, email,
    phone, registeredAt, uid

/users/{uid}
  dni, stCode, role?, email?, createdAt?, createdBy?

/auditLogs/{entryId}
  at, action, actorUid, actorEmail, targetType, targetId, targetLabel,
  source, meta?
```

`status` conserva sus dos valores históricos: `upcoming` y `ongoing`. El estado
temporal que se ve en la interfaz (Programado / Hoy / Finalizado) se deriva de
`startAt` y no se almacena.

La consola **no** crea, edita ni elimina cuentas en `/users` — solo lee el rol
de la persona que inició sesión. La administración de cuentas se hace
directamente en Firebase Console.

## Seguridad

Consulta [docs/SECURITY.md](docs/SECURITY.md).

## Despliegue

Consulta [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

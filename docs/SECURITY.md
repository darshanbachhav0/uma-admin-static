# Modelo de seguridad

Este documento describe las decisiones de seguridad tomadas en la consola y lo
que queda pendiente de tu lado. La consola es intencionalmente de solo lectura
respecto a las cuentas de usuario: no crea, edita, deshabilita ni elimina
cuentas. Esa administración se hace directamente desde Firebase Console.

---

## 1. Alcance: sin gestión de usuarios en la consola

Una versión anterior de esta consola incluía una pantalla de administración de
usuarios (crear, deshabilitar, eliminar cuentas, importación masiva por CSV)
respaldada por Cloud Functions con el SDK de Firebase Admin. Esa funcionalidad
se retiró por completo a pedido, para mantener la consola enfocada en su
función principal: **gestión de eventos**.

Se eliminó:

- la pantalla y los diálogos de usuarios (`js/pages/users.js`, `js/pages/user-dialogs.js`),
- el cliente de la API administrativa (`js/services/adminApi.js`),
- el backend de Cloud Functions (`/functions`),
- las acciones de auditoría relacionadas con cuentas (creación, baja,
  deshabilitación, restablecimiento de contraseña, importación masiva).

**Lo que se conserva:** la consola sigue leyendo `/users/{uid}/role` para
decidir si la persona que inició sesión es administradora — eso es
autenticación, no administración de usuarios, y no se tocó.

Si en el futuro se necesita administrar cuentas desde la consola, esa
funcionalidad debe reconstruirse detrás de un backend con el SDK de Firebase
Admin (Cloud Functions u otro servidor de confianza) que verifique de forma
independiente que quien llama es administrador — nunca confiando solo en una
comprobación del lado del cliente, y nunca haciendo que la consola inicie
sesión en la cuenta de otra persona para administrarla (ese era el problema
del diseño original que se corrigió).

---

## 2. Reglas de la base de datos

`database.rules.json` es el único perfil de reglas que se entrega, pensado
para no romper la aplicación de estudiantes (que no forma parte de este
repositorio):

- `/events`: lectura para cualquier usuario autenticado; escritura solo para
  administradores, con validación de tipos y longitudes.
- `/events/{id}/registrations/{key}`: un usuario autenticado puede **crear**
  su inscripción; solo un administrador puede modificarla o eliminarla.
- `/users`: solo los administradores pueden listar el directorio; cada
  persona puede leer su propia ficha (necesario para resolver su rol). Los
  campos `password` y `pass` están explícitamente prohibidos por validación.
- `/auditLogs`: lectura solo para administradores; escritura solo de entradas
  nuevas (append-only) y con `actorUid` obligatoriamente igual a `auth.uid`.
- Todo lo demás queda denegado por defecto.

**Limitación conocida.** Las inscripciones cuelgan de
`/events/{id}/registrations`, y en Realtime Database los permisos descienden
en cascada: conceder lectura sobre `/events` concede también lectura sobre
las inscripciones, que contienen nombre, DNI, correo y teléfono. Con este
perfil, cualquier usuario autenticado puede leer las inscripciones de todos
los eventos.

No se endureció automáticamente porque no se puede determinar desde este
repositorio si la app de estudiantes lee `/events` como colección completa;
una regla más estricta podría romperla en producción. Si más adelante quieres
cerrar esta brecha, la solución es mover las inscripciones a una rama propia
(por ejemplo `/eventRegistrations/{eventId}/{registrationId}`) con reglas que
solo dejen leer a los administradores y al propio estudiante, migrar los
datos existentes con el Admin SDK, y actualizar `flattenRegistrations()` en
`js/core/store.js` para leer de la nueva ruta. Eso requiere coordinarlo con
quien mantiene la app de estudiantes, ya que también debe escribir en la
ruta nueva.

Si la app de estudiantes lista los eventos **sin iniciar sesión**, cambia
`/events/.read` a `true` y prioriza la migración anterior, porque de lo
contrario las inscripciones quedarían accesibles sin autenticación alguna.

---

## 3. Otras correcciones de seguridad

### Inyección de HTML (XSS)

El código construye toda la interfaz con `createElement` + `textContent`
(`js/ui/dom.js`). No existe ninguna ruta de datos hacia `innerHTML`: el único
sitio que asigna marcado es `js/ui/icons.js`, con cadenas estáticas escritas
en este repositorio. Verificado con títulos, ubicaciones, etiquetas y nombres
de inscritos que contienen etiquetas HTML: se muestran como texto literal, no
se ejecutan.

### URLs no confiables

`safeUrl()` (`js/utils/validate.js`) acepta únicamente `http:` y `https:`, de
modo que un `imageUrl` con `javascript:` o `data:` no puede llegar a un `src`
ni a un `href`. Se aplica a las imágenes de portada de eventos y a los
enlaces de atribución de Unsplash.

### Sesión

- La persistencia es `LOCAL`: los administradores no se desconectan en cada
  recarga.
- Un usuario autenticado **sin** rol de administrador puede cerrar sesión: la
  pantalla «No tienes acceso» tiene su propio botón. No queda atrapado.
- No hay destello de contenido protegido: la consola solo se construye
  cuando el rol ya está resuelto.

### Auditoría

`/auditLogs` registra la creación, edición, eliminación y duplicado de
eventos desde la consola. El cliente filtra cualquier clave de metadatos que
coincida con `pass`, `password`, `secret`, `token`, `credential` o `apikey`,
de modo que nunca se registran credenciales.

### Configuración

`config.js` contiene solo configuración web pública de Firebase y la Access
Key pública de Unsplash. Ninguna credencial de cuenta de servicio ni
secreto verdadero se incluye en el frontend.

---

## 4. Resumen de lo que requiere tu acción

| # | Acción | Urgencia |
|---|---|---|
| 1 | Revisar y desplegar `database.rules.json` (`firebase deploy --only database`) | Alta |
| 2 | Confirmar si la app de estudiantes lee `/events` autenticada o anónimamente, y ajustar `/events/.read` en consecuencia | Alta |
| 3 | Si administras cuentas manualmente, hazlo desde Firebase Console → Authentication | Informativo |
| 4 | Planificar, si hace falta, la migración de las inscripciones fuera del árbol de eventos (sección 2) | Media |
| 5 | Configurar `UNSPLASH_ACCESS_KEY` si quieres sugerencias de imagen completas | Baja |

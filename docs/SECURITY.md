# Modelo de seguridad y migraciones pendientes

Este documento describe qué se corrigió, qué decisiones se tomaron para no
romper la aplicación de estudiantes (que **no** forma parte de este
repositorio) y qué queda pendiente de tu lado.

---

## 1. Administración de cuentas: qué cambió

### Antes

Para eliminar un usuario, la consola:

1. pedía por `prompt()` el correo del usuario,
2. leía su DNI desde `/users/{uid}/dni`,
3. **iniciaba sesión en la cuenta de esa persona** con su correo y su DNI usando
   una instancia secundaria del SDK,
4. llamaba a `user.delete()`.

Eso significaba que la contraseña de cada estudiante era efectivamente conocida
por la consola, que un administrador tenía que poder autenticarse como otra
persona para administrarla, y que la operación fallaba en cuanto alguien
cambiaba su contraseña. Crear usuarios tenía el mismo problema al revés.

### Ahora

Todas las operaciones privilegiadas viven en Cloud Functions (`/functions`) con
el SDK de Firebase Admin:

| Operación | Función |
|---|---|
| Listar metadatos de cuentas | `adminListUsers` |
| Crear cuenta | `adminCreateUser` |
| Eliminar cuenta | `adminDeleteUser` |
| Deshabilitar / habilitar | `adminSetUserDisabled` |
| Conceder / retirar rol de administrador | `adminSetUserRole` |
| Restablecer contraseña | `adminSendPasswordReset` |
| Importación masiva | `adminBulkCreateUsers` |
| Comprobación de salud | `adminPing` |

Garantías:

- El navegador nunca recibe credenciales de servicio; las obtiene el runtime.
- El backend **vuelve a verificar por su cuenta** que quien llama es
  administrador. Nunca confía en la comprobación del frontend.
- Ningún administrador necesita conocer ni usar la contraseña de otra persona.
- La entrada de auditoría la escribe el servidor, no el cliente, por lo que no
  se puede omitir ni falsificar.
- Guardas explícitas: no puedes eliminarte, deshabilitarte ni retirarte a ti
  mismo el rol de administrador.

### Autorización

Se acepta como administrador a quien cumpla una de estas dos condiciones:

1. tiene el custom claim `admin: true` (mecanismo preferido), o
2. tiene `/users/{uid}/role === "admin"` (mecanismo heredado).

La primera vez que un administrador heredado llama al backend, este le concede
el custom claim de forma idempotente. Con el tiempo todos los administradores
quedan cubiertos por el claim y la comprobación pasa a ser solo de token.

---

## 2. Contraseña = DNI: compatibilidad y migración pendiente

**Estado actual:** al crear una cuenta, el backend sigue usando el DNI como
contraseña inicial.

**Por qué:** la aplicación de estudiantes, que no está en este repositorio,
autentica con correo + DNI. Cambiar la contraseña inicial aquí dejaría fuera a
los estudiantes nuevos sin previo aviso.

**Qué sí cambió:**

- La consola ya no necesita el DNI para administrar cuentas.
- El DNI se guarda en `/users/{uid}/dni` como identificador de búsqueda, igual
  que antes. **No se guarda ninguna contraseña en la base de datos**, y las
  reglas rechazan explícitamente cualquier campo `password` o `pass`.
- En las tablas el DNI aparece enmascarado por defecto (`*****456`); se puede
  revelar cuando hace falta.
- Los administradores pueden enviar un enlace de restablecimiento sin conocer
  ninguna contraseña.

### Migración recomendada (requiere tocar la app de estudiantes)

1. En la app de estudiantes, sustituye el inicio de sesión con DNI por
   contraseña propia + enlace de restablecimiento de Firebase.
2. Cuando esté desplegada, cambia en `functions/index.js` la línea
   `password: dni` de `adminCreateUser` y `adminBulkCreateUsers` por una
   contraseña aleatoria, y envía al estudiante un enlace de definición de
   contraseña con `auth.generatePasswordResetLink()`.
3. Fuerza un restablecimiento para las cuentas ya existentes.

Hasta que se haga el paso 1, cualquiera que conozca el correo y el DNI de un
estudiante puede entrar con su cuenta. **Esta es la deuda de seguridad más
importante que queda abierta y no se puede cerrar desde este repositorio.**

---

## 3. Reglas de la base de datos

Se entregan dos perfiles.

### `database.rules.json` — perfil de compatibilidad (el que se despliega)

- `/events`: lectura para cualquier usuario autenticado; escritura solo para
  administradores, con validación de tipos y longitudes.
- `/events/{id}/registrations/{key}`: un usuario autenticado puede **crear** su
  inscripción; solo un administrador puede modificarla o eliminarla.
- `/users`: solo los administradores pueden listar el directorio; cada persona
  puede leer su propia ficha. Los campos `password` y `pass` están prohibidos.
- `/auditLogs`: lectura solo para administradores; escritura solo de entradas
  nuevas (append-only) y con `actorUid` obligatoriamente igual a `auth.uid`.
- Todo lo demás queda denegado por defecto.

**Limitación conocida y deliberada.** Las inscripciones cuelgan de
`/events/{id}/registrations`, y en Realtime Database los permisos descienden en
cascada: conceder lectura sobre `/events` concede también lectura sobre las
inscripciones, que contienen nombre, DNI, correo y teléfono. Por tanto, con este
perfil **cualquier usuario autenticado puede leer las inscripciones de todos**.

No se endureció automáticamente porque no se puede determinar desde este
repositorio si la app de estudiantes lee `/events` como colección completa; una
regla más estricta la rompería en producción.

Si la app de estudiantes lista los eventos **sin iniciar sesión**, el perfil de
compatibilidad tampoco le sirve: cambia `/events/.read` a `true` y despliega el
perfil endurecido cuanto antes, porque de lo contrario las inscripciones
quedarían accesibles sin autenticación.

### `database.rules.hardened.json` — perfil recomendado (NO desplegar todavía)

Mueve las inscripciones a `/eventRegistrations/{eventId}/{registrationId}`, con
lo cual:

- `/events` puede ser público sin exponer datos personales;
- las inscripciones solo las leen los administradores (y cada estudiante la
  suya).

Requiere tres cambios coordinados:

1. **App de estudiantes:** escribir en `/eventRegistrations/{eventId}/{id}`
   incluyendo `uid` y `registeredAt`.
2. **Migración de datos** (una sola vez, con el Admin SDK):

   ```js
   const admin = require('firebase-admin');
   admin.initializeApp({ databaseURL: '<FIREBASE_DATABASE_URL>' });
   const db = admin.database();

   (async () => {
     const snap = await db.ref('events').get();
     const updates = {};
     snap.forEach((event) => {
       const regs = event.child('registrations').val();
       if (!regs) return;
       for (const [key, value] of Object.entries(regs)) {
         updates[`eventRegistrations/${event.key}/${key}`] = value;
       }
     });
     await db.ref().update(updates);
     console.log(`Copiadas ${Object.keys(updates).length} inscripciones`);
   })();
   ```

   Copia, no mueve: los datos originales siguen ahí hasta que verifiques la
   migración y decidas borrarlos.

3. **Consola:** en `js/core/store.js`, sustituir la lectura de
   `event.registrations` por una suscripción a `/eventRegistrations` y ajustar
   `flattenRegistrations()`.

Haz los tres cambios en la misma ventana de despliegue.

---

## 4. Otras correcciones de seguridad

### Inyección de HTML (XSS)

El código anterior construía las tarjetas de eventos por interpolación de
plantillas y `innerHTML`, sin escapar el título, la ubicación ni las etiquetas.
Un título como `<img src=x onerror=...>` guardado en la base de datos se
ejecutaba en el navegador del administrador.

Ahora toda la interfaz se construye con `createElement` + `textContent`
(`js/ui/dom.js`). No existe ninguna ruta de datos hacia `innerHTML`: el único
sitio que asigna marcado es `js/ui/icons.js`, con cadenas estáticas escritas en
este repositorio.

Verificado con títulos, ubicaciones, etiquetas y nombres de inscritos que
contienen etiquetas HTML: se muestran como texto literal.

### URLs no confiables

`safeUrl()` (`js/utils/validate.js`) acepta únicamente `http:` y `https:`, de
modo que un `imageUrl` con `javascript:` o `data:` no puede llegar a un `src` ni
a un `href`. Se aplica a las imágenes de portada y a los enlaces de atribución
de Unsplash.

### Sesión

- La persistencia pasó de `NONE` a `LOCAL`: los administradores ya no se
  desconectan en cada recarga. `NONE` no aportaba seguridad real y obligaba a
  reautenticarse continuamente.
- Un usuario autenticado **sin** rol de administrador ya puede cerrar sesión: la
  pantalla «No tienes acceso» tiene su propio botón. Antes quedaba atrapado.
- No hay destello de contenido protegido: la consola solo se construye cuando el
  rol ya está resuelto.

### Auditoría

`/auditLogs` registra creación, edición, eliminación y duplicado de eventos
(desde la consola) y todas las operaciones sobre cuentas (desde el servidor).
Tanto el cliente como el servidor filtran cualquier clave de metadatos que
coincida con `pass`, `password`, `secret`, `token`, `credential` o `apikey`, de
modo que nunca se registran credenciales.

### Configuración

`config.js` contiene solo configuración web pública de Firebase y la Access Key
pública de Unsplash. La Secret Key de Unsplash y las credenciales de cuenta de
servicio no aparecen en ningún archivo del frontend; `functions/.gitignore`
además bloquea los archivos `*serviceAccount*.json`.

---

## 5. Resumen de lo que requiere tu acción

| # | Acción | Urgencia |
|---|---|---|
| 1 | Desplegar las Cloud Functions (`firebase deploy --only functions`); requiere plan Blaze | Alta — sin esto no hay administración de cuentas |
| 2 | Revisar y desplegar `database.rules.json` | Alta |
| 3 | Confirmar si la app de estudiantes lee `/events` autenticada o anónimamente, y ajustar `/events/.read` en consecuencia | Alta |
| 4 | Planificar la migración al perfil endurecido (inscripciones fuera del árbol de eventos) | Media |
| 5 | Eliminar el acoplamiento contraseña = DNI en la app de estudiantes | Media-alta |
| 6 | Configurar `UNSPLASH_ACCESS_KEY` si quieres sugerencias de imagen completas | Baja |

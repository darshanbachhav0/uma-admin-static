# Despliegue

Dos piezas independientes: el sitio estático y las reglas de la base de datos.
La consola no tiene backend propio — habla directamente con Firebase
Authentication y Realtime Database desde el navegador.

---

## 1. Variables de entorno

Todas las variables de esta tabla se usan **solo en tiempo de compilación** del
sitio estático y terminan en `config.js`, que es público por diseño.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `FIREBASE_API_KEY` | sí | Clave web del proyecto |
| `FIREBASE_AUTH_DOMAIN` | sí | `<proyecto>.firebaseapp.com` |
| `FIREBASE_DATABASE_URL` | sí | URL de Realtime Database |
| `FIREBASE_PROJECT_ID` | sí | ID del proyecto |
| `FIREBASE_STORAGE_BUCKET` | sí | Bucket de Firebase Storage (por ejemplo `uma-erp.firebasestorage.app`). Se usa para las imágenes que se suben desde el editor de eventos. |
| `FIREBASE_MESSAGING_SENDER_ID` | sí | Sender ID |
| `FIREBASE_APP_ID` | sí | App ID |
| `FIREBASE_MEASUREMENT_ID` | sí | Measurement ID |
| `UNSPLASH_ACCESS_KEY` | no | Access Key **pública** de Unsplash. Sin ella, la sugerencia de imágenes funciona en modo limitado y el administrador puede pegar una URL manualmente. |

Nunca pongas aquí la Secret Key de Unsplash ni una clave de cuenta de servicio:
todo lo que entra en `config.js` es visible para cualquiera que abra el sitio.

## 2. Sitio estático (Render)

Sin cambios respecto de la configuración actual:

- **Build command:** `./render-build.sh`
- **Publish directory:** la raíz del repositorio

El script valida las variables obligatorias y genera `config.js` junto a
`index.html`.

> El proyecto usa módulos ES (`<script type="module">`). Render los sirve
> correctamente. Si cambias de hosting, asegúrate de que los `.js` se sirvan con
> `Content-Type: text/javascript` o `application/javascript`.

## 3. Reglas de seguridad de la base de datos

> **Obligatorio para los documentos de eventos.** La página pública
> `documentos.html` lee `/eventDocuments` y `/eventDocumentData` sin iniciar
> sesión; sin estas reglas desplegadas, los estudiantes verán «Documentos no
> disponibles» y la consola no podrá guardar documentos.

> ⚠️ **No ejecutes `firebase deploy --only database` sobre `uma-erp`.** Ese
> comando **reemplaza todas** las reglas del proyecto por `database.rules.json`,
> y la base de datos `uma-erp` también sirve a otras partes de la app de
> estudiantes (por ejemplo, Horario). Las reglas de este repositorio niegan
> todo lo que no listan, así que esas funciones podrían dejar de funcionar.

Para habilitar los documentos de eventos, **agrega** solo las secciones nuevas
a las reglas existentes:

1. Inicia sesión en <https://console.firebase.google.com> con una cuenta que
   tenga rol de **Propietario** o **Editor** en el proyecto `uma-erp`.
2. Abre **Realtime Database → Reglas**.
3. Copia `eventDocuments` y `eventDocumentData` desde
   `database.rules.event-documents.json` y pégalos dentro de `"rules": { … }`,
   junto a las demás rutas de primer nivel, sin borrar nada de lo existente.
4. Pulsa **Publicar**.

Comprobación: abre en el navegador
`https://uma-erp-default-rtdb.firebaseio.com/eventDocuments/prueba.json`. Antes
de publicar responde `Permission denied`; después debe responder `null`.

Para probar reglas sin afectar producción, usa el simulador de reglas en
Firebase Console → Realtime Database → Reglas → Simulador, o el emulador:

```bash
firebase emulators:start --only database,auth
```

## Imágenes de eventos (Firebase Storage)

El editor de eventos puede subir una imagen desde la computadora. Antes de
subirla, el navegador la ajusta a **1600 × 900 px (16:9) en JPEG**: las fotos
con forma cercana a 16:9 se recortan al centro y los afiches o imágenes
verticales se muestran completos sobre un fondo difuminado, para no cortar el
texto. La imagen se guarda en Firebase Storage (`eventImages/…`) y su enlace
`https://firebasestorage.googleapis.com/…` va en el campo `imageUrl` del
evento, así que **la app de estudiantes no necesita cambios**.

Las imágenes que se reemplazan o cuyo evento se elimina se borran de Storage
(salvo que otro evento, por ejemplo una copia duplicada, use la misma).

Requisitos (una sola vez):

1. Firebase Console → **Storage**: debe estar activado (requiere el plan
   Blaze). Copia el nombre del bucket (`gs://…`, sin `gs://`) y verifica que
   coincide con `FIREBASE_STORAGE_BUCKET` en Render.
2. Firebase Console → Storage → **Reglas**: agrega el bloque
   `match /eventImages/{folder}/{fileName}` y la función `isEventAdmin()` de
   [`storage.rules.event-images`](../storage.rules.event-images) dentro de
   `match /b/{bucket}/o { … }`, **sin borrar las reglas que ya existan** (la
   app puede usarlas), cambia `ADMIN_EMAIL@uma.edu.pe` por el correo de la
   cuenta de la consola y haz clic en **Publicar**.
   - Para varios administradores, agrega sus correos a la lista.
   - Las reglas de Storage no pueden leer `users/{uid}/role` de la base de
     datos; por eso se usa la lista de correos (o un *custom claim* `admin`).

No uses `firebase deploy --only storage` con este archivo: reemplazaría todas
las reglas de Storage del proyecto.

## 4. Administración de cuentas

La consola no crea, edita ni elimina cuentas de administrador o de estudiante:
eso se hace directamente en **Firebase Console → Authentication**. Para dar
acceso de administrador a una cuenta, agrega en Realtime Database:

```
/users/<uid-del-administrador>/role = "admin"
```

Esa persona podrá iniciar sesión en la consola en cuanto ese valor exista.

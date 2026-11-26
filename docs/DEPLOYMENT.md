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
| `FIREBASE_STORAGE_BUCKET` | sí | Bucket (no se usa, pero el SDK lo espera) |
| `FIREBASE_MESSAGING_SENDER_ID` | sí | Sender ID |
| `FIREBASE_APP_ID` | sí | App ID |
| `FIREBASE_MEASUREMENT_ID` | sí | Measurement ID |
| `UNSPLASH_ACCESS_KEY` | no | Access Key **pública** de Unsplash. Sin ella, la sugerencia de imágenes funciona en modo limitado y el administrador puede pegar una URL manualmente. |
| `CLOUDINARY_CLOUD_NAME` | no | Nombre de la cuenta de Cloudinary (*cloud name*). Activa el botón **Subir imagen** del editor de eventos. |
| `CLOUDINARY_UPLOAD_PRESET` | no | Nombre del *upload preset* **Unsigned** de Cloudinary. Ver «Subida de imágenes» abajo. |

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

## Subida de imágenes de eventos (Cloudinary)

El editor de eventos puede subir una imagen desde la computadora. Antes de
subirla, el navegador la ajusta a **1600 × 900 px (16:9) en JPEG**: las fotos
con forma cercana a 16:9 se recortan al centro y los afiches o imágenes
verticales se muestran completos sobre un fondo difuminado, para no cortar el
texto. La imagen se guarda en Cloudinary y su enlace `https://` va en el campo
`imageUrl` del evento, así que **la app de estudiantes no necesita cambios**.

Se usa Cloudinary porque Firebase Storage exige el plan de pago Blaze. El plan
gratuito de Cloudinary es suficiente para las imágenes de eventos.

Configuración (una sola vez):

1. Crea una cuenta gratuita en <https://cloudinary.com> (puede ser con el
   correo del área). En el panel (*Dashboard*) copia el **Cloud name**.
2. Ve a **Settings → Upload → Upload presets → Add upload preset**:
   - *Signing mode*: **Unsigned**.
   - *Asset folder*: `uma-eventos`.
   - *Allowed formats*: `jpg` (el editor siempre sube JPEG).
   - En *Upload Manipulations → Incoming transformation* puedes poner un
     límite de tamaño, por ejemplo `c_limit,w_1600,h_900`.
   - Guarda y copia el **nombre del preset**.
3. En Render → tu sitio → **Environment**, agrega
   `CLOUDINARY_CLOUD_NAME` y `CLOUDINARY_UPLOAD_PRESET` y vuelve a desplegar
   (*Manual Deploy → Deploy latest commit*).

Ambos valores son públicos (no son claves secretas). Nunca pongas el
*API Secret* de Cloudinary en Render ni en el código. Como un preset Unsigned
permite subir imágenes a quien conozca su nombre, limita los formatos y la
carpeta como se indica arriba y revisa de vez en cuando la carpeta
`uma-eventos` en Cloudinary.

Sin estas variables, el botón **Subir imagen** muestra un aviso y todo lo
demás (Unsplash, pegar una URL) sigue funcionando igual.

## 4. Administración de cuentas

La consola no crea, edita ni elimina cuentas de administrador o de estudiante:
eso se hace directamente en **Firebase Console → Authentication**. Para dar
acceso de administrador a una cuenta, agrega en Realtime Database:

```
/users/<uid-del-administrador>/role = "admin"
```

Esa persona podrá iniciar sesión en la consola en cuanto ese valor exista.

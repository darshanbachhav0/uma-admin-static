# Despliegue

Tres piezas independientes: el sitio estático, las Cloud Functions y las reglas
de la base de datos.

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
| `FUNCTIONS_REGION` | no | Región de las Cloud Functions. Por defecto `us-central1`. **Debe coincidir con la región donde se desplegaron.** |
| `UNSPLASH_ACCESS_KEY` | no | Access Key **pública** de Unsplash. Sin ella, la sugerencia de imágenes funciona en modo limitado y el administrador puede pegar una URL manualmente. |

Nunca pongas aquí la Secret Key de Unsplash ni una clave de cuenta de servicio:
todo lo que entra en `config.js` es visible para cualquiera que abra el sitio.

Las Cloud Functions no necesitan variables de entorno: obtienen sus credenciales
del runtime de Firebase.

## 2. Sitio estático (Render)

Sin cambios respecto de la configuración actual:

- **Build command:** `./render-build.sh`
- **Publish directory:** la raíz del repositorio

El script valida las variables obligatorias y genera `config.js` junto a
`index.html`.

> El proyecto usa módulos ES (`<script type="module">`). Render los sirve
> correctamente. Si cambias de hosting, asegúrate de que los `.js` se sirvan con
> `Content-Type: text/javascript` o `application/javascript`.

## 3. Cloud Functions

Requiere Node.js 20 y el plan **Blaze** del proyecto de Firebase (las funciones
de 2ª generación lo exigen).

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
firebase use <PROJECT_ID>
```

```bash
cd functions && npm install
```

```bash
firebase deploy --only functions
```

Esto publica: `adminPing`, `adminListUsers`, `adminCreateUser`,
`adminDeleteUser`, `adminSetUserDisabled`, `adminSetUserRole`,
`adminSendPasswordReset` y `adminBulkCreateUsers`.

Para desplegar en otra región, exporta `FUNCTIONS_REGION` antes del deploy y
configura la misma variable en el build del sitio estático.

Verificación: entra en la consola, abre **Ajustes** y pulsa **Comprobar
backend**. Debe mostrar «Disponible».

Mientras las funciones no estén desplegadas, la consola sigue funcionando en
modo lectura para usuarios y muestra un aviso explicando qué falta; el resto de
las secciones no se ve afectado.

## 4. Reglas de seguridad de la base de datos

**Lee [SECURITY.md](SECURITY.md) antes de desplegar.** El archivo por defecto es
el perfil de compatibilidad, pensado para no romper la aplicación de
estudiantes.

```bash
firebase deploy --only database
```

Para probarlas primero sin afectar producción, usa el simulador de reglas en
Firebase Console → Realtime Database → Reglas → Simulador, o los emuladores:

```bash
firebase emulators:start --only database,functions
```

## 5. Primer administrador

Si ya existe al menos un usuario con `role: "admin"` en `/users/{uid}`, no hay
nada que hacer: ese administrador puede entrar, y la primera vez que llame al
backend recibirá automáticamente el custom claim `admin`.

Desde ese momento puede conceder o retirar el rol a otras cuentas desde
**Usuarios → menú de la fila → Convertir en administrador**.

Si no existe ningún administrador, crea el nodo manualmente una sola vez en
Firebase Console:

```
/users/<uid-del-administrador>/role = "admin"
```

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

**Lee [SECURITY.md](SECURITY.md) antes de desplegar.** El archivo `database.rules.json`
es el perfil de compatibilidad, pensado para no romper la aplicación de
estudiantes.

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
firebase deploy --only database
```

Para probarlas primero sin afectar producción, usa el simulador de reglas en
Firebase Console → Realtime Database → Reglas → Simulador, o el emulador:

```bash
firebase emulators:start --only database,auth
```

## 4. Administración de cuentas

La consola no crea, edita ni elimina cuentas de administrador o de estudiante:
eso se hace directamente en **Firebase Console → Authentication**. Para dar
acceso de administrador a una cuenta, agrega en Realtime Database:

```
/users/<uid-del-administrador>/role = "admin"
```

Esa persona podrá iniciar sesión en la consola en cuanto ese valor exista.

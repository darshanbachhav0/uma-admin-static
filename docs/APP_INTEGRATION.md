# Integración con la app de estudiantes: documentos de eventos

La consola de administración permite adjuntar documentos (PDF y Word) a un
evento. Para que los estudiantes los vean desde la app, la app solo necesita
leer **dos campos nuevos y opcionales** del evento y abrir un enlace.

## Contrato de datos

En `/events/{eventId}`, solo cuando el evento tiene documentos:

| Campo | Tipo | Ejemplo |
|---|---|---|
| `documentsUrl` | string (https) | `https://uma-admin-static.onrender.com/documentos.html?evento=-Nabc123` |
| `documentCount` | number (1–10) | `2` |

Si el evento no tiene documentos, **ninguno de los dos campos existe**. Todos
los demás campos del evento y la forma de las inscripciones no cambian.

La URL abre una página pública (sin inicio de sesión) con botones para
descargar cada documento en PDF y/o Word.

## Prompt para el desarrollador de la app

Copia y pega lo siguiente en el asistente de IA que use el proyecto de la app:

```text
En esta app de estudiantes de la Universidad María Auxiliadora (UMA) hay una
pantalla de Eventos con tarjetas que muestran imagen, título, fecha y un botón
"Inscribirme". Al inscribirse, el botón cambia a "Inscrito" y queda
deshabilitado. Los eventos se leen de Firebase Realtime Database en
/events/{eventId}.

Necesito que los eventos puedan mostrar documentos descargables. La consola de
administración ya escribe dos campos OPCIONALES en cada evento que tiene
documentos:

  - documentsUrl: string, una URL https que abre una página web pública con
    botones para descargar los documentos (PDF y Word).
  - documentCount: number, cantidad de documentos (1 a 10).

Si un evento no tiene documentos, esos campos NO existen.

Implementa lo siguiente:

1. Primero inspecciona el proyecto: identifica el framework (React Native/Expo,
   Flutter, Kotlin, Swift, etc.), el modelo/tipo de evento, dónde se leen los
   eventos de Firebase, el componente de la tarjeta de evento y la lógica del
   botón "Inscribirme"/"Inscrito". No cambies nada antes de entender ese flujo.

2. Agrega documentsUrl (string opcional) y documentCount (número opcional) al
   modelo del evento y a su lectura desde Firebase. Si faltan o tienen un tipo
   incorrecto, trátalos como ausentes. Un evento "tiene documentos" solo si
   documentsUrl empieza con "https://" y documentCount es mayor que 0.

3. Botón "Inscribirme": mantén EXACTAMENTE la lógica actual de inscripción
   (misma ruta y mismos datos escritos en Firebase). Solo cuando la inscripción
   termine con éxito y el evento tenga documentos, abre documentsUrl en el
   navegador del sistema.

4. Botón "Inscrito": hoy está deshabilitado. Si el evento tiene documentos,
   hazlo pulsable (sin volver a inscribir al estudiante) y que abra
   documentsUrl. Mantén el texto "Inscrito" y agrega un ícono de descarga o
   documento para indicar que se puede tocar; usa un estilo visualmente
   activo, no el estilo deshabilitado. Si el evento NO tiene documentos, el
   botón "Inscrito" se comporta exactamente como ahora.

5. En la tarjeta del evento, si tiene documentos, muestra una indicación
   discreta, por ejemplo un ícono de clip con "2 documentos" (en español,
   singular/plural correcto). No cambies el resto del diseño de la tarjeta.

6. Abre la URL SIEMPRE en el navegador externo del sistema, no en un WebView
   dentro de la app (las descargas dentro de WebViews no son confiables):
   - React Native/Expo: Linking.openURL(url)
   - Flutter: url_launcher con launchUrl(uri, mode: LaunchMode.externalApplication)
   - Android nativo: Intent(Intent.ACTION_VIEW, Uri.parse(url))
   - iOS nativo: UIApplication.shared.open(url)
   En Android 11+ declara en el AndroidManifest la consulta (<queries>) para
   abrir URLs https si la librería lo requiere. Si no se puede abrir la URL,
   muestra un mensaje en español: "No se pudo abrir los documentos. Inténtalo
   de nuevo."

7. Seguridad: nunca abras una URL que no empiece con "https://".

8. No cambies nada más: ni el registro, ni la estructura de datos, ni otras
   pantallas. Los eventos sin documentos deben funcionar igual que antes.

9. Al terminar, explícame los archivos modificados y cómo probarlo. Para
   probar: en la consola de administración, edita un evento de prueba, agrega
   un documento en "Documentos para estudiantes (opcional)" y guarda; luego en
   la app verifica (a) inscribirse abre la página de documentos, (b) tocar
   "Inscrito" la vuelve a abrir, (c) un evento sin documentos se comporta
   igual que antes.
```

## Probar sin la app

Abre la URL de `documentsUrl` (visible en el detalle del evento en la consola,
**Ver detalle → Documentos**) en el navegador del teléfono.

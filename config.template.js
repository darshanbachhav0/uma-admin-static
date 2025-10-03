// config.template.js — generated at build from environment variables
// NOTE: These are injected during the Render build; they are PUBLIC in the client bundle.
window.umaConfig = {
  firebase: {
    apiKey: "${FIREBASE_API_KEY}",
    authDomain: "${FIREBASE_AUTH_DOMAIN}",
    databaseURL: "${FIREBASE_DATABASE_URL}",
    projectId: "${FIREBASE_PROJECT_ID}",
    storageBucket: "${FIREBASE_STORAGE_BUCKET}",
    messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID}",
    appId: "${FIREBASE_APP_ID}",
    measurementId: "${FIREBASE_MEASUREMENT_ID}"
  },
  // Backend (Admin API) base URL — no trailing slash
  apiBase: "${API_BASE_URL}"
};

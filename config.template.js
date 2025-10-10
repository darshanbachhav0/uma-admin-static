// config.template.js — generated at build from environment variables
// NOTE: These values end up PUBLIC in the final JS bundle (client app).
window.umaConfig = {
  firebase: {
    apiKey:            "${FIREBASE_API_KEY}",
    authDomain:        "${FIREBASE_AUTH_DOMAIN}",
    databaseURL:       "${FIREBASE_DATABASE_URL}",
    projectId:         "${FIREBASE_PROJECT_ID}",
    storageBucket:     "${FIREBASE_STORAGE_BUCKET}",
    messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID}",
    appId:             "${FIREBASE_APP_ID}",
    measurementId:     "${FIREBASE_MEASUREMENT_ID}"
  },
  // Unsplash (public) Access Key — keep Secret Key on server only.
  // If unset, the app will fall back to the no-key Source endpoint.
  unsplashAccessKey:  "${UNSPLASH_ACCESS_KEY}"
};

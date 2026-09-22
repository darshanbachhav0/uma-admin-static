// config.template.js — turned into config.js at build time by render-build.sh.
//
// Everything in this file is PUBLIC: it is served to the browser as part of the
// static bundle. Firebase web configuration is designed to be public and is
// protected by Realtime Database security rules and Cloud Functions checks.
//
// NEVER put a service-account key, the Unsplash Secret Key, or any other true
// secret in here.
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

  // Region where the admin Cloud Functions are deployed (see /functions).
  functionsRegion: "${FUNCTIONS_REGION}",

  // Unsplash public Access Key. The Secret Key must stay on the server.
  // Without it the event image suggestion falls back to a limited, keyless
  // endpoint and administrators can still paste an image URL manually.
  unsplashAccessKey: "${UNSPLASH_ACCESS_KEY}"
};

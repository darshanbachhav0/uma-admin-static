#!/usr/bin/env bash
# Build script for the UMA Admin static site (Render).
#
# Generates config.js next to index.html from environment variables. Only
# public browser configuration is written; service credentials must never be
# referenced here.
set -euo pipefail

if [ ! -f "index.html" ]; then
  echo "index.html not found at the publish root."
  echo "If the files live in a subfolder, set Render's 'Publish directory' to that folder."
  exit 1
fi

required_vars=(
  FIREBASE_API_KEY
  FIREBASE_AUTH_DOMAIN
  FIREBASE_DATABASE_URL
  FIREBASE_PROJECT_ID
  FIREBASE_STORAGE_BUCKET
  FIREBASE_MESSAGING_SENDER_ID
  FIREBASE_APP_ID
  FIREBASE_MEASUREMENT_ID
)

missing=0
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "Missing required environment variable: $var"
    missing=1
  fi
done
if [ "$missing" = "1" ]; then
  exit 2
fi

if [ -z "${UNSPLASH_ACCESS_KEY:-}" ]; then
  echo "UNSPLASH_ACCESS_KEY not set — event image suggestions will run in limited mode."
  export UNSPLASH_ACCESS_KEY=""
fi

if command -v envsubst >/dev/null 2>&1 && [ -f "config.template.js" ]; then
  echo "Generating config.js with envsubst"
  envsubst < config.template.js > config.js
else
  echo "Generating config.js with the heredoc fallback"
  cat > config.js <<EOF
// Generated at build time. Public browser configuration only.
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
  unsplashAccessKey: "${UNSPLASH_ACCESS_KEY}"
};
EOF
fi

# The template is not needed in the published output.
rm -f config.template.js || true

echo "Generated config.js"

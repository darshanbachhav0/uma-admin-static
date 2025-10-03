#!/usr/bin/env bash
# Root-level build script for Render Static Site
# Generates config.js from environment variables NEXT TO index.html
set -euo pipefail

TARGET_DIR="."

if [ ! -f "$TARGET_DIR/index.html" ]; then
  echo "⚠️ index.html not found at repo root. If your files live in a subfolder, either:"
  echo "   1) Move this script into that folder, or"
  echo "   2) Change Render's 'Publish Directory' to that folder, or"
  echo "   3) Edit TARGET_DIR to point to that folder."
fi

cat > "$TARGET_DIR/config.js" <<EOF
// generated at build time
window.umaConfig = {
  firebase: {
    apiKey: "${FIREBASE_API_KEY:-}",
    authDomain: "${FIREBASE_AUTH_DOMAIN:-}",
    databaseURL: "${FIREBASE_DATABASE_URL:-}",
    projectId: "${FIREBASE_PROJECT_ID:-}",
    storageBucket: "${FIREBASE_STORAGE_BUCKET:-}",
    messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID:-}",
    appId: "${FIREBASE_APP_ID:-}",
    measurementId: "${FIREBASE_MEASUREMENT_ID:-}"
  }
};
EOF

echo "✅ Generated $TARGET_DIR/config.js"

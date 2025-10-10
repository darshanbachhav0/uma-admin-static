#!/usr/bin/env bash
# Robust root-level build script for Render Static Site
# - Validates required env vars
# - Generates config.js next to index.html (from config.template.js via envsubst)
# - Strips CRLF if the file was edited on Windows
set -euo pipefail

# Normalize line endings for this script if needed
if file "$0" | grep -qi "CRLF"; then
  sed -i 's/\r$//' "$0"
fi

# Ensure index.html exists at repo root
if [ ! -f "index.html" ]; then
  echo "❌ index.html not found at repo root."
  echo "   If your files live in a subfolder, set Render 'Publish directory' to that folder."
  exit 1
fi

# Required env vars (web Firebase config is expected to be public post-build)
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

for v in "${required_vars[@]}"; do
  if [ -z "${!v:-}" ]; then
    echo "❌ Missing required env var: $v"
    MISSING=1
  fi
done
if [ "${MISSING:-0}" = "1" ]; then
  exit 2
fi

# Optional Unsplash key (warn only)
if [ -z "${UNSPLASH_ACCESS_KEY:-}" ]; then
  echo "ℹ️  UNSPLASH_ACCESS_KEY not provided — app will use no-key fallback (source.unsplash.com)."
fi

# Prefer envsubst with template if available
if command -v envsubst >/dev/null 2>&1 && [ -f "config.template.js" ]; then
  echo "ℹ️ Using envsubst on config.template.js"
  envsubst < config.template.js > config.js
else
  echo "ℹ️ Generating config.js via heredoc fallback"
  cat > config.js <<EOF
// generated at build time
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
  unsplashAccessKey:  "${UNSPLASH_ACCESS_KEY:-}"
};
EOF
fi

# Optionally remove the template from the published output (keeps repo clean at runtime)
if [ -f "config.template.js" ]; then
  rm -f config.template.js || true
fi

echo "✅ Generated config.js"

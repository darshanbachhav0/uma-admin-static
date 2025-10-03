#!/usr/bin/env bash
set -euo pipefail

# Ensure index.html exists at repo root
if [ ! -f "index.html" ]; then
  echo "❌ index.html not found at repo root."
  exit 1
fi

# Required Firebase vars
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
  if [ -z "${!v:-}" ]; then echo "❌ Missing env var: $v"; MISSING=1; fi
done
if [ "${MISSING:-0}" = "1" ]; then exit 2; fi

# Prefer envsubst on the template
if command -v envsubst >/dev/null 2>&1 && [ -f "config.template.js" ]; then
  echo "ℹ️ Using envsubst on config.template.js"
  envsubst < config.template.js > config.js
else
  echo "ℹ️ Generating config.js via heredoc fallback"
  cat > config.js <<'EOF'
// generated at build time
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
  apiBase: "${API_BASE_URL:-}"
};
EOF
fi

# Keep the template out of the published output
[ -f "config.template.js" ] && rm -f config.template.js || true

echo "✅ Generated config.js"

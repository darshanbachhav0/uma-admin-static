#!/usr/bin/env bash
# exit on error
set -euo pipefail

# If your static assets live in a subfolder, cd into it
# Adjust this if your repo layout is different
cd uma-admin-static

# Create config.js from environment variables
# You can add 'envsubst' via your build image (Render has it in the default image).
envsubst < config.template.js > config.js

echo "✅ Generated config.js from environment variables"

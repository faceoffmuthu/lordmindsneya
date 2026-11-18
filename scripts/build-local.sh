#!/bin/sh
set -eu

PROJECT_DIR="/Users/kamalesh/Downloads/lordminds"

npm run build --prefix "$PROJECT_DIR/web"
mkdir -p "$PROJECT_DIR/server/public/assets"
cp "$PROJECT_DIR/web/dist/index.html" "$PROJECT_DIR/server/public/index.html"
cp -R "$PROJECT_DIR/web/dist/assets/." "$PROJECT_DIR/server/public/assets/"

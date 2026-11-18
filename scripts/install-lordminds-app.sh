#!/bin/sh
set -eu

PROJECT_DIR="/Users/kamalesh/Downloads/lordminds"
APP_DIR="$HOME/Applications/Lord Minds.app"
CONTENTS="$APP_DIR/Contents"

mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources" "$HOME/Applications"
swiftc -parse-as-library "$PROJECT_DIR/scripts/LordMindsApp.swift" -framework Cocoa -framework WebKit \
  -o "$CONTENTS/MacOS/LordMinds"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Lord Minds</string>
  <key>CFBundleDisplayName</key><string>Lord Minds</string>
  <key>CFBundleIdentifier</key><string>com.lordminds.desktop</string>
  <key>CFBundleExecutable</key><string>LordMinds</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$APP_DIR"
open "$APP_DIR"
printf 'Installed and opened: %s\n' "$APP_DIR"

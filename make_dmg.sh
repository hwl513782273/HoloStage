#!/bin/bash
# HoloStage DMG 打包 — 命名: 12-HoloStage-<版本>-universal.dmg（additive-only）
set -e
cd "$(dirname "$0")"
APP=HoloStage
VER=$(python3 -c "import plistlib;print(plistlib.load(open('build/$APP.app/Contents/Info.plist','rb'))['CFBundleShortVersionString'])")
DMG="/Users/banqiu/WorkBuddy/DMG/12-${APP}-${VER}-universal.dmg"
[ -d "build/$APP.app" ] || { echo "先跑 ./build.sh"; exit 1; }

STAGING=staging
rm -rf "$STAGING"; mkdir -p "$STAGING"
cp -R "build/$APP.app" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

hdiutil create -volname "$APP" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
echo "==> DMG: $DMG"

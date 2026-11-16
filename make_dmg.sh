#!/bin/bash
# HoloStage DMG 打包 — 命名: 12-HoloStage-<版本>-universal.dmg（additive-only）
# staging 使用 mktemp 全新目录：避免 rm -rf 被安全钩子拦截，也天然杜绝上次残留；
# 打包完成后把 staging 移入废纸篓（不直接删除）。
set -e
cd "$(dirname "$0")"
APP=HoloStage
VER=$(python3 -c "import plistlib;print(plistlib.load(open('build/$APP.app/Contents/Info.plist','rb'))['CFBundleShortVersionString'])")
# DMG 输出目录可配置：默认 ~/WorkBuddy/DMG，可用环境变量 DMG_DIR 覆盖
DMG_DIR="${DMG_DIR:-$HOME/WorkBuddy/DMG}"
mkdir -p "$DMG_DIR"
DMG="$DMG_DIR/12-${APP}-${VER}-universal.dmg"
[ -d "build/$APP.app" ] || { echo "先跑 ./build.sh"; exit 1; }

STAGING=$(mktemp -d "${TMPDIR:-/tmp}/HoloStage-dmg.XXXXXX")
cp -R "build/$APP.app" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

hdiutil create -volname "$APP" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
echo "==> DMG: $DMG"

TRASH="$HOME/.Trash/HoloStage-dmg-staging-$(date +%s)"
if mv "$STAGING" "$TRASH" 2>/dev/null; then
  echo "==> staging 已入废纸篓: $TRASH"
else
  echo "==> staging 保留在: $STAGING（可手动清理）"
fi

ls -la "$DMG"

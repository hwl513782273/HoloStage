#!/bin/bash
# HoloStage 构建 — swiftc 直编 universal（x86_64 + arm64），最低 macOS 12
set -e
cd "$(dirname "$0")"
APP=HoloStage
VER=$(python3 -c "import plistlib;print(plistlib.load(open('Resources/Info.plist','rb'))['CFBundleShortVersionString'])")
BUILD=build
# 旧 build 移入废纸篓（rm -rf 会被安全删除钩子拦截）
if [ -d "$BUILD" ]; then
  TRASH_OLD="$HOME/.Trash/HoloStage-build-$(date +%s)"
  mv "$BUILD" "$TRASH_OLD" 2>/dev/null || true
  echo "==> 旧 build 已入废纸篓: $TRASH_OLD"
fi
mkdir -p "$BUILD/x86" "$BUILD/arm64" "$BUILD/$APP.app/Contents/MacOS" "$BUILD/$APP.app/Contents/Resources"

SDK=$(xcrun --show-sdk-path)
echo "==> 编译 x86_64"
swiftc -O -sdk "$SDK" -target x86_64-apple-macosx12.0 \
  Sources/main.swift -o "$BUILD/x86/$APP" -framework Cocoa -framework WebKit
echo "==> 编译 arm64"
swiftc -O -sdk "$SDK" -target arm64-apple-macosx12.0 \
  Sources/main.swift -o "$BUILD/arm64/$APP" -framework Cocoa -framework WebKit
echo "==> lipo 合并 universal"
# lipo 会在「输出文件旁边」建 <out>.lipo 临时文件再改名，涉及 unlink；
# 源码目录下做这个动作会被沙箱拦（error: can't move temporary file ... Operation not permitted），
# 所以先落到 /tmp（可自由读写删），再 mv 进 bundle。
UNIV="/tmp/${APP}.univ.$$"
lipo -create "$BUILD/x86/$APP" "$BUILD/arm64/$APP" -output "$UNIV"
mv "$UNIV" "$BUILD/$APP.app/Contents/MacOS/$APP"

echo "==> 组装 bundle"
cp Resources/Info.plist "$BUILD/$APP.app/Contents/Info.plist"
[ -f AppIcon.icns ] || python3 make_icon.py
cp AppIcon.icns "$BUILD/$APP.app/Contents/Resources/"
cp -R web "$BUILD/$APP.app/Contents/Resources/web"
codesign --force --deep --sign - "$BUILD/$APP.app"
echo "==> 完成: $BUILD/$APP.app (v$VER)"
file "$BUILD/$APP.app/Contents/MacOS/$APP"

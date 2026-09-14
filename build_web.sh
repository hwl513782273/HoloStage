#!/bin/bash
# HoloStage web 层打包 — esbuild 把 three + addons + tinyusdz loader 打成 IIFE
set -e
cd "$(dirname "$0")"
NODE=/Users/banqiu/.workbuddy/binaries/node/versions/22.22.2/bin/node
ESBUILD=/Users/banqiu/.workbuddy/binaries/node/workspace/node_modules/.bin/esbuild
SRC=web/src
LIB=web/lib

echo "==> 打包 tinyusdz 胶水（独立，失败不影响主程序）"
# esbuild 从源码目录向上找 node_modules 找不到 → 在源码目录放一个软链
LNK=web/src/node_modules
[ -L "$LNK" ] || ln -s /Users/banqiu/.workbuddy/binaries/node/workspace/node_modules "$LNK"
"$ESBUILD" "$SRC/tinyusdz-glue-entry.js" \
  --bundle --format=iife --target=es2020 --minify \
  --outfile="$LIB/tinyusdz-glue.js"

echo "==> 打包主程序（three 0.186 + loaders + tinyusdz three 适配层）"
"$ESBUILD" "$SRC/app.module.js" \
  --bundle --format=iife --target=es2020 --minify \
  --alias:tinyusdz-glue="$(pwd)/$SRC/tinyusdz-glue.js" \
  --outfile="$LIB/bundle.js"

echo "==> 打包导出网页查看器（1.2.5，内嵌进单文件 HTML）"
"$ESBUILD" "$SRC/viewer.module.js" \
  --bundle --format=iife --target=es2020 --minify \
  --outfile="$LIB/viewer.js"

echo "==> 拷贝 tinyusdz.wasm"
cp /Users/banqiu/.workbuddy/binaries/node/workspace/node_modules/tinyusdz/tinyusdz.wasm "$LIB/tinyusdz.wasm"

echo "==> 完成"
ls -la "$LIB/tinyusdz-glue.js" "$LIB/bundle.js" "$LIB/viewer.js"

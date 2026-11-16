#!/bin/bash
# HoloStage web 层打包 — esbuild 把 three + addons + tinyusdz loader 打成 IIFE
set -e
cd "$(dirname "$0")"
# 构建依赖可配置：默认从 PATH 找 node / esbuild，本机有专用安装时用环境变量覆盖
NODE="${NODE_BIN:-$(command -v node)}"
ESBUILD="${ESBUILD_BIN:-$(command -v esbuild)}"
# tinyusdz 所在的 node_modules 目录，可用 WORKSPACE_NM 环境变量覆盖
WORKSPACE_NM="${WORKSPACE_NM:-$(dirname "$(dirname "$ESBUILD")")/node_modules}"
SRC=web/src
LIB=web/lib

echo "==> 打包 tinyusdz 胶水（独立，失败不影响主程序）"
# esbuild 从源码目录向上找 node_modules 找不到 → 在源码目录放一个软链
LNK=web/src/node_modules
[ -L "$LNK" ] || ln -s "$WORKSPACE_NM" "$LNK"
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
cp "$WORKSPACE_NM/tinyusdz/tinyusdz.wasm" "$LIB/tinyusdz.wasm"

echo "==> 完成"
ls -la "$LIB/tinyusdz-glue.js" "$LIB/bundle.js" "$LIB/viewer.js"

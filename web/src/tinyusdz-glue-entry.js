// 独立打包入口：把 tinyusdz emscripten 胶水挂到 window 上
import init from "./vendor/tinyusdz.esm.js";
window.__TinyUSDZNativeInit = init;

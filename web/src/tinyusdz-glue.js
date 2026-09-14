// 主 bundle 内使用：运行时从 tinyusdz-glue.js（独立打包的 emscripten 胶水）取初始化函数
export default (typeof window !== "undefined" && window.__TinyUSDZNativeInit) || null;

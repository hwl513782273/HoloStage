/* HoloStage 1.2 — 3D 模型 → 线框全息加载动画（ES module 版，esbuild 打包）
 * 1.1: USDZ（tinyusdz usdc/usda）+ GLB + ZIP（原生解压后进入）
 * 1.2: 模型 XYZ 位移 / 画面比例 / 导出分辨率 / 帧率 / 配色下拉 / 三环独立变换
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader.js";
import { TinyUSDZLoader } from "./vendor/TinyUSDZLoader.js";
import { TinyUSDZLoaderUtils } from "./vendor/TinyUSDZLoaderUtils.js";
import initTinyUSDZNative from "./tinyusdz-glue.js";

(function () {
  "use strict";

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("gl"), statusEl = $("status"), errEl = $("err");
  var titleEl = $("title"), barsEl = $("bars"), stageEl = $("stage");

  /* ---------- 原生层状态回调 ---------- */
  window.holoNativeStatus = function (msg, isErr) {
    if (isErr) { showError(msg); } else { statusEl.textContent = msg; }
  };

  /* ---------- 颜色预设 ---------- */
  var PRESETS = {
    cyan: { main: 0x3fb9ff, css: "#3fb9ff", g1: 0x2b6ea6, g2: 0x16344f },
    green: { main: 0x51ff7e, css: "#51ff7e", g1: 0x2ba64f, g2: 0x163f24 },
    red:   { main: 0xff4d5e, css: "#ff4d5e", g1: 0xa62b36, g2: 0x4f1620 },
    gold:  { main: 0xffc94d, css: "#ffc94d", g1: 0xa6852b, g2: 0x4f3d16 },
    ice:   { main: 0xbfe9ff, css: "#bfe9ff", g1: 0x6fa6c4, g2: 0x2c4658 }
  };
  var currentPreset = "cyan";

  /* ---------- three 场景 ---------- */
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.055);

  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1.7, 4.8);
  camera.lookAt(0, 0.85, 0);

  var composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  var bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 1.1, 0.6, 0.0);
  composer.addPass(bloom);

  /* ---------- 网格地台 ---------- */
  var gridGroup = new THREE.Group();
  scene.add(gridGroup);
  function buildGrids(p) {
    while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
    var g1 = new THREE.GridHelper(26, 52, p.g1, p.g1);
    g1.material.transparent = true; g1.material.opacity = 0.55;
    var g2 = new THREE.GridHelper(26, 13, p.g1, p.g1);
    g2.material.transparent = true; g2.material.opacity = 0.9;
    gridGroup.add(g1); gridGroup.add(g2);
  }
  buildGrids(PRESETS[currentPreset]);

  /* ---------- 模型容器 ---------- */
  var modelRoot = new THREE.Group();
  var wireGroup = new THREE.Group();
  modelRoot.add(wireGroup);
  scene.add(modelRoot);

  var srcMeshes = [];
  var state = {
    speed: 0.5, mode: "wire", angle: 32, scale: 1.0, zup: false,
    gridOn: true, hudOn: true, fileName: "", modelName: "HOLOSTAGE",
    pos: { x: 0, y: 0, z: 0 },          // 模型位移（世界单位）
    delay: 100,                          // GIF 每帧延时 ms
    rings: [                             // 三环独立变换
      { x: 0, y: 0, s: 100, p: 0, r: 0 },
      { x: 0, y: 0, s: 100, p: 0, r: 0 },
      { x: 0, y: 0, s: 86,  p: 18, r: -12 }
    ]
  };

  /* ---------- 线框构建 ---------- */
  function buildWireframe() {
    while (wireGroup.children.length) {
      var c = wireGroup.children[0];
      wireGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
    }
    var mat = new THREE.LineBasicMaterial({
      color: PRESETS[currentPreset].main,
      transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var totalTris = 0, totalSegs = 0;
    srcMeshes.forEach(function (item) {
      var g = item.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      totalTris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      var wg;
      try {
        wg = (state.mode === "edges")
          ? new THREE.EdgesGeometry(g, state.angle)
          : new THREE.WireframeGeometry(g);
      } catch (e) { return; }
      totalSegs += wg.attributes.position.count / 2;
      var line = new THREE.LineSegments(wg, mat);
      line.applyMatrix4(item.matrix);
      wireGroup.add(line);
    });
    return { tris: Math.round(totalTris), segs: Math.round(totalSegs) };
  }

  function normalizeModel() {
    var tmp = new THREE.Group();
    srcMeshes.forEach(function (item) {
      var proxy = new THREE.Mesh(item.geometry);
      proxy.applyMatrix4(item.matrix);
      tmp.add(proxy);
    });
    if (state.zup) tmp.rotation.x = -Math.PI / 2;
    tmp.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(tmp);
    if (box.isEmpty()) return;
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var s = 2.2 / maxDim * state.scale;

    modelRoot.rotation.set(0, 0, 0);
    modelRoot.position.set(0, 0, 0);
    modelRoot.scale.setScalar(s);
    modelRoot.rotation.x = state.zup ? -Math.PI / 2 : 0;
    var off = new THREE.Vector3(-center.x, -box.min.y, -center.z);
    off.multiplyScalar(s);
    modelRoot.position.copy(off);
    if (state.zup) {
      modelRoot.position.set(0, 0, 0);
      modelRoot.updateMatrixWorld(true);
      var box2 = new THREE.Box3().setFromObject(modelRoot);
      modelRoot.position.y = -box2.min.y;
      var c2 = box2.getCenter(new THREE.Vector3());
      modelRoot.position.x = -c2.x; modelRoot.position.z = -c2.z;
    }
    // 用户位移（1.2）
    modelRoot.position.x += state.pos.x;
    modelRoot.position.y += state.pos.y;
    modelRoot.position.z += state.pos.z;
  }

  /* ---------- USDZ（tinyusdz WASM） ---------- */
  var usdzLoader = null;
  function libBaseURL() {
    var dir = decodeURI(location.pathname).replace(/[^/]*$/, ""); // /…/web/
    if (window.webkit && window.webkit.messageHandlers.holo) {
      return "holo://f/" + encodeURI(dir + "lib/").replace(/#/g, "%23").replace(/\?/g, "%3F");
    }
    return dir + "lib/"; // 浏览器调试
  }
  function ensureUSDZ() {
    if (!usdzLoader) {
      usdzLoader = new TinyUSDZLoader();
      return initTinyUSDZNative({ locateFile: function (p) { return libBaseURL() + p; } })
        .then(function (native) { usdzLoader.native_ = native; return usdzLoader; });
    }
    return Promise.resolve(usdzLoader);
  }
  function loadUSDZ(url, name, fail, done) {
    ensureUSDZ().then(function (loader) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error("holo fetch " + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        loader.parse(new Uint8Array(buf), url, function (usd) {
          var root = usd.getDefaultRootNode();
          var mtl = TinyUSDZLoaderUtils.createDefaultMaterial();
          var obj = TinyUSDZLoaderUtils.buildThreeNode(root, mtl, usd, { overrideMaterial: true });
          done(obj);
        }, fail);
      });
    }).catch(fail);
  }

  /* ---------- 加载器分发 ---------- */
  var EXT_MAP = {
    stl: "stl", obj: "obj", ply: "ply",
    gltf: "gltf", glb: "gltf",
    fbx: "fbx", pmx: "mmd", pmd: "mmd",
    usdz: "usdz", usd: "usdz"
  };

  function loadModel(url, name) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    var kind = EXT_MAP[ext];
    if (!kind) { showError("不支持的格式: ." + ext + "（支持 STL/OBJ/glTF/GLB/PLY/FBX/PMX/USDZ 或 ZIP 包）"); return; }
    hideError();
    statusEl.textContent = "LOADING " + name.toUpperCase() + " ...";
    var isScheme = /^holo:\/\//i.test(url);
    var enc;
    if (isScheme) enc = url;
    else if (/^(https?|file):\/\//i.test(url)) enc = encodeURI(url).replace(/#/g, "%23").replace(/\?/g, "%3F");
    else if (url.charAt(0) === "/") enc = url; // http 调试环境的相对/绝对 URL
    else enc = encodeURI("file://" + url).replace(/#/g, "%23").replace(/\?/g, "%3F");
    function done(object3DorGeom) {
      srcMeshes = [];
      if (object3DorGeom.isBufferGeometry) {
        srcMeshes.push({ geometry: object3DorGeom, matrix: new THREE.Matrix4() });
      } else {
        object3DorGeom.updateMatrixWorld(true);
        object3DorGeom.traverse(function (o) {
          if (o.isMesh && o.geometry) {
            srcMeshes.push({ geometry: o.geometry, matrix: o.matrixWorld.clone() });
          }
        });
      }
      if (!srcMeshes.length) { showError("文件中未找到网格数据"); return; }
      var res = buildWireframe();
      normalizeModel();
      var base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").toUpperCase();
      state.fileName = name;
      $("inpTitle").value = base;
      titleEl.textContent = base;
      statusEl.textContent = name.toUpperCase() + " — " + res.tris.toLocaleString() + " TRIS — " + res.segs.toLocaleString() + " WIREFRAME SEGS";
    }
    function fail(err) { showError("载入失败: " + (err && err.message ? err.message : err)); }
    try {
      switch (kind) {
        case "stl":  new STLLoader().load(enc, function (g) { done(g); }, undefined, fail); break;
        case "ply":  new PLYLoader().load(enc, function (g) { done(g); }, undefined, fail); break;
        case "obj":  new OBJLoader().load(enc, function (o) { done(o); }, undefined, fail); break;
        case "gltf": new GLTFLoader().load(enc, function (g) { done(g.scene || g.scenes[0]); }, undefined, fail); break;
        case "fbx":  new FBXLoader().load(enc, function (o) { done(o); }, undefined, fail); break;
        case "mmd":  new MMDLoader().load(enc, function (o) { done(o); }, undefined, fail); break;
        case "usdz": loadUSDZ(enc, name, fail, done); break;
      }
    } catch (e) { fail(e); }
  }
  window.holoLoadFile = loadModel;

  function showError(msg) { errEl.textContent = msg; errEl.style.display = "block"; }
  function hideError() { errEl.style.display = "none"; }

  /* ---------- HUD：三环 + 底部进度条 ---------- */
  var ringWraps = [$("ringWrap1"), $("ringWrap2"), $("ringWrap3")];
  (function buildHUD() {
    var NS = "http://www.w3.org/2000/svg";
    function mk(tag, attrs) {
      var el = document.createElementNS(NS, tag);
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    }
    // ① 分段弧环
    var svgA = mk("svg", { viewBox: "0 0 600 600", "class": "ringSpin" });
    var cx = 300, R1 = 272, R2 = 232;
    var segs = 22;
    for (var i = 0; i < segs; i++) {
      var a0 = (i / segs) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / segs) * 0.62;
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      var p = mk("path", {
        d: "M " + (cx + R1 * Math.cos(a0)) + " " + (cx + R1 * Math.sin(a0)) +
           " A " + R1 + " " + R1 + " 0 " + large + " 1 " + (cx + R1 * Math.cos(a1)) + " " + (cx + R1 * Math.sin(a1)) +
           " L " + (cx + R2 * Math.cos(a1)) + " " + (cx + R2 * Math.sin(a1)) +
           " A " + R2 + " " + R2 + " 0 " + large + " 0 " + (cx + R2 * Math.cos(a0)) + " " + (cx + R2 * Math.sin(a0)) + " Z",
        fill: "currentColor", opacity: 0.16
      });
      svgA.appendChild(p);
    }
    ringWraps[0].appendChild(svgA);
    // ② 刻度环
    var svgB = mk("svg", { viewBox: "0 0 600 600", "class": "ringSpinRev" });
    svgB.appendChild(mk("circle", { cx: cx, cy: cx, r: 210, fill: "none",
      stroke: "currentColor", "stroke-width": 1.5, "stroke-opacity": 0.35 }));
    for (var t = 0; t < 60; t++) {
      var ta = (t / 60) * Math.PI * 2, r0 = 196, r1 = t % 5 === 0 ? 182 : 189;
      svgB.appendChild(mk("line", {
        x1: cx + r0 * Math.cos(ta), y1: cx + r0 * Math.sin(ta),
        x2: cx + r1 * Math.cos(ta), y2: cx + r1 * Math.sin(ta),
        stroke: "currentColor", "stroke-width": t % 5 === 0 ? 2.5 : 1, "stroke-opacity": 0.4
      }));
    }
    svgB.appendChild(mk("circle", { cx: cx, cy: cx, r: 3, fill: "currentColor", opacity: 0.7 }));
    ringWraps[1].appendChild(svgB);
    // ③ 虚线环（1.2 新增）
    var svgC = mk("svg", { viewBox: "0 0 600 600", "class": "ringSpinSlow" });
    svgC.appendChild(mk("circle", { cx: cx, cy: cx, r: 250, fill: "none",
      stroke: "currentColor", "stroke-width": 2, "stroke-opacity": 0.5, "stroke-dasharray": "18 12" }));
    svgC.appendChild(mk("circle", { cx: cx, cy: cx, r: 262, fill: "none",
      stroke: "currentColor", "stroke-width": 1, "stroke-opacity": 0.22, "stroke-dasharray": "4 8" }));
    for (var q = 0; q < 4; q++) {
      var qa = (q / 4) * Math.PI * 2 + Math.PI / 4;
      svgC.appendChild(mk("rect", {
        x: cx + 250 * Math.cos(qa) - 5, y: cx + 250 * Math.sin(qa) - 5,
        width: 10, height: 10, fill: "currentColor", opacity: 0.55,
        transform: "rotate(" + (qa * 180 / Math.PI + 45) + " " + (cx + 250 * Math.cos(qa)) + " " + (cx + 250 * Math.sin(qa)) + ")"
      }));
    }
    ringWraps[2].appendChild(svgC);
    // 底部进度条
    for (var b = 0; b < 22; b++) {
      var sp = document.createElement("span");
      sp.style.height = (6 + (b % 4) * 5) + "px";
      sp.style.animationDelay = (b * 0.08) + "s";
      barsEl.appendChild(sp);
    }
  })();

  function applyRings() {
    var base = Math.min(stageW, stageH) * 0.94;
    state.rings.forEach(function (rg, i) {
      var wrap = ringWraps[i];
      var size = base * rg.s / 100;
      wrap.style.width = size + "px";
      wrap.style.height = size + "px";
      wrap.style.transform = "translate(calc(-50% + " + rg.x + "px), calc(-50% + " + rg.y + "px))" +
        " rotateX(" + rg.p + "deg) rotateZ(" + rg.r + "deg)";
    });
  }

  /* ---------- 配色（下拉框，1.2） ---------- */
  function applyPreset(name) {
    currentPreset = name;
    var p = PRESETS[name];
    document.documentElement.style.setProperty("--holo", p.css);
    document.documentElement.style.setProperty("--holo-dim", p.css + "73");
    document.documentElement.style.setProperty("--holo-faint", p.css + "2e");
    buildGrids(p);
    wireGroup.children.forEach(function (line) {
      line.material.color.setHex(p.main);
    });
  }

  /* ---------- 舞台尺寸（按比例 + 避让面板，1.2） ---------- */
  var stageW = 960, stageH = 640;
  var PANEL_W = 249; // 与 #panel 宽 248px + 1px 边线一致
  function currentRatio() {
    var v = $("selRatio").value;
    if (v === "custom") {
      var w = Math.max(1, Math.round(+$("ratioW").value || 1));
      var h = Math.max(1, Math.round(+$("ratioH").value || 1));
      return [w, h];
    }
    var seg = v.split(":");
    return [+seg[0], +seg[1]];
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function resize() {
    var r = currentRatio();
    var W = window.innerWidth, H = window.innerHeight;
    var panelVisible = !$("panel").classList.contains("hidden");
    var viewW = panelVisible ? Math.max(64, W - PANEL_W) : W; // 画面区避开右侧面板
    var s = Math.min(viewW / r[0], H / r[1]);
    stageW = Math.max(64, Math.floor(s * r[0]));
    stageH = Math.max(64, Math.floor(s * r[1]));
    stageEl.style.left = (viewW / 2) + "px"; // 在画面区内居中（覆盖 CSS 的 50%）
    stageEl.style.width = stageW + "px";
    stageEl.style.height = stageH + "px";
    renderer.setSize(stageW, stageH, false);
    composer.setSize(stageW, stageH);
    camera.aspect = stageW / stageH;
    camera.updateProjectionMatrix();
    applyRings();
  }

  /* ---------- 控制面板事件 ---------- */
  $("btnOpen").onclick = function () {
    if (window.webkit && window.webkit.messageHandlers.holo) {
      window.webkit.messageHandlers.holo.postMessage({ type: "openFile" });
    } else { $("fileInput").click(); }
  };
  $("fileInput").onchange = function () {
    if (this.files && this.files[0]) {
      var f = this.files[0];
      loadModel(f instanceof File ? ("file://" + f.name) : f, f.name);
    }
  };
  $("inpTitle").oninput = function () { titleEl.textContent = this.value || " "; };
  $("btnMode").onclick = function () {
    state.mode = state.mode === "edges" ? "wire" : "edges";
    $("valMode").textContent = state.mode === "edges" ? "边缘" : "全网格";
    buildWireframe();
  };
  $("inpAngle").oninput = function () {
    state.angle = +this.value; $("valAngle").textContent = this.value + "°";
    if (state.mode === "edges") buildWireframe();
  };
  $("inpBloom").oninput = function () {
    bloom.strength = +this.value / 10; $("valBloom").textContent = (+this.value / 10).toFixed(1);
  };
  $("inpScale").oninput = function () {
    state.scale = +this.value / 100; $("valScale").textContent = (+this.value / 100).toFixed(1);
    if (srcMeshes.length) normalizeModel();
  };
  $("inpZup").onchange = function () {
    state.zup = this.checked;
    if (srcMeshes.length) { normalizeModel(); buildWireframe(); }
  };
  $("inpSpeed").oninput = function () {
    state.speed = +this.value / 10; $("valSpeed").textContent = (+this.value / 10).toFixed(1);
  };
  $("inpGrid").onchange = function () { gridGroup.visible = this.checked; };
  $("inpHud").onchange = function () {
    $("hud").style.display = this.checked ? "" : "none";
  };
  // 模型位移（1.2）
  ["PX", "PY", "PZ"].forEach(function (k) {
    $("inp" + k).oninput = function () {
      var axis = k.charAt(1).toLowerCase();
      state.pos[axis] = +this.value / 100;
      $("valP" + k.charAt(1)).textContent = state.pos[axis].toFixed(2);
      if (srcMeshes.length) normalizeModel();
    };
  });
  // 配色下拉（1.2）
  $("selPreset").onchange = function () { applyPreset(this.value); };
  // 三环控制（1.2）
  Array.prototype.forEach.call(document.querySelectorAll(".ringCtl"), function (el) {
    el.oninput = function () {
      var n = +this.dataset.ring, k = this.dataset.k;
      state.rings[n - 1][k] = +this.value;
      var idMap = { x: "valR" + n + "X", y: "valR" + n + "Y", s: "valR" + n + "S", p: "valR" + n + "P", r: "valR" + n + "R" };
      $(idMap[k]).textContent = (k === "p" || k === "r") ? this.value + "°" : this.value;
      applyRings();
    };
  });
  // 画面比例 / 导出分辨率（1.2）
  $("selRatio").onchange = function () {
    $("ratioCustom").style.display = this.value === "custom" ? "flex" : "none";
    resize();
  };
  ["ratioW", "ratioH"].forEach(function (id) {
    $(id).oninput = function () { if ($("selRatio").value === "custom") resize(); };
  });
  $("selRes").onchange = function () {
    $("resCustom").style.display = this.value === "custom" ? "flex" : "none";
  };
  // 导出参数（1.2）
  $("inpFrames").oninput = function () { $("valFrames").textContent = this.value; };
  $("inpDelay").oninput = function () { state.delay = +this.value; $("valDelay").textContent = this.value; };
  document.getElementById("panelToggle").onclick = function () {
    document.getElementById("panel").classList.remove("hidden");
    resize();
  };
  $("btnHide").onclick = function () {
    $("panel").classList.add("hidden");
    resize();
  };

  /* ---------- 拖放 ---------- */
  var dropHint = $("dropHint");
  ["dragenter", "dragover"].forEach(function (ev) {
    window.addEventListener(ev, function (e) { e.preventDefault(); dropHint.classList.add("on"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    window.addEventListener(ev, function (e) { e.preventDefault(); dropHint.classList.remove("on"); });
  });
  window.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.path) loadModel("file://" + f.path, f.name);
    else if (window.webkit && window.webkit.messageHandlers.holo) {
      window.webkit.messageHandlers.holo.postMessage({ type: "droppedFile", name: f ? f.name : "" });
    }
  });

  /* ---------- 帧捕获 ---------- */
  var bridge = (window.webkit && window.webkit.messageHandlers.holo)
    ? window.webkit.messageHandlers.holo : null;

  function captureFrames(count, onFrame, onDone) {
    var base = modelRoot.rotation.y;
    var i = 0;
    var step = (Math.PI * 2) / count;
    (function next() {
      if (i >= count) { onDone(); return; }
      modelRoot.rotation.y = base + i * step;
      composer.render();
      onFrame(i, canvas);
      i++;
      setTimeout(next, 16);
    })();
  }

  /* ---------- 导出尺寸（分辨率 + 比例，1.2） ---------- */
  function exportSize() {
    var rv = $("selRes").value;
    if (rv === "custom") {
      var w = clamp(Math.round(+$("resW").value || 1920), 64, 7680);
      var h = clamp(Math.round(+$("resH").value || 1080), 64, 7680);
      return [w, h];
    }
    var h = +rv, r = currentRatio();
    var ew = Math.max(64, Math.round(h * r[0] / r[1] / 2) * 2);
    return [ew, h];
  }
  function withExportSize(w, h, work) {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    work(function () { resize(); }); // 恢复
  }

  /* ---------- 导出 GIF ---------- */
  function bundleWorkerPath() {
    return location.pathname.replace(/[^/]*$/, "") + "lib/gif.worker.js";
  }
  var exporting = false;
  $("btnGif").onclick = function () {
    if (exporting || !srcMeshes.length) return;
    exporting = true; this.disabled = true; this.textContent = "GIF 生成中...";
    statusEl.textContent = "EXPORTING GIF ...";
    var count = +$("inpFrames").value;
    var es = exportSize();
    var workerSrc = bridge ? "holo://f/" + encodeURI(bundleWorkerPath()).replace(/#/g, "%23") : "lib/gif.worker.js";
    fetch(workerSrc).then(function (r) { return r.text(); }).then(function (code) {
      var workerUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
      withExportSize(es[0], es[1], function (restore) {
        var gif = new GIF({ workers: 1, quality: 8, width: es[0], height: es[1], workerScript: workerUrl });
        captureFrames(count, function (i, cnv) {
          gif.addFrame(cnv, { copy: true, delay: state.delay });
        }, function () {
          gif.on("finished", function (blob) {
            restore();
            var reader = new FileReader();
            reader.onload = function () {
              var b64 = reader.result.split(",")[1];
              var name = (state.fileName.replace(/\.[^.]+$/, "") || "holo") + "_holo.gif";
              if (bridge) bridge.postMessage({ type: "saveGif", data: b64, name: name });
              else downloadData(reader.result, name);
              finishExport("GIF 已导出: " + name + " (" + es[0] + "×" + es[1] + ")");
            };
            reader.readAsDataURL(blob);
          });
          gif.render();
        });
      });
    });
  };
  function finishExport(msg) {
    exporting = false;
    var b = $("btnGif"); b.disabled = false; b.textContent = "导出 GIF 动画";
    statusEl.textContent = msg;
  }

  /* ---------- 导出 PNG 序列 ---------- */
  $("btnSeq").onclick = function () {
    if (exporting || !srcMeshes.length) return;
    exporting = true; statusEl.textContent = "EXPORTING PNG SEQ ...";
    var count = +$("inpFrames").value;
    var es = exportSize();
    withExportSize(es[0], es[1], function (restore) {
      var frames = [];
      captureFrames(count, function (i, cnv) {
        frames.push(cnv.toDataURL("image/png").split(",")[1]);
      }, function () {
        restore();
        var name = state.fileName.replace(/\.[^.]+$/, "") || "holo";
        if (bridge) bridge.postMessage({ type: "savePngSeq", frames: frames, name: name });
        else frames.forEach(function (d, i) { downloadData("data:image/png;base64," + d, name + "_f" + String(i).padStart(2, "0") + ".png"); });
        exporting = false; statusEl.textContent = "PNG 序列已导出: " + name + "_f00..f" + (count - 1) + " (" + es[0] + "×" + es[1] + ")";
      });
    });
  };

  /* ---------- 导出当前帧 PNG ---------- */
  $("btnShot").onclick = function () {
    if (!srcMeshes.length) return;
    var es = exportSize();
    withExportSize(es[0], es[1], function (restore) {
      composer.render();
      var d = canvas.toDataURL("image/png");
      restore();
      var name = (state.fileName.replace(/\.[^.]+$/, "") || "holo") + "_frame.png";
      if (bridge) bridge.postMessage({ type: "savePng", data: d.split(",")[1], name: name });
      else downloadData(d, name);
      statusEl.textContent = "PNG 已导出: " + name + " (" + es[0] + "×" + es[1] + ")";
    });
  };

  function downloadData(url, name) {
    var a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  }

  /* ---------- 尺寸与主循环 ---------- */
  window.addEventListener("resize", resize);
  resize();

  var last = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (!exporting) modelRoot.rotation.y += state.speed * dt;
    composer.render();
  })(last);

  statusEl.textContent = "READY — 拖入 STL / OBJ / glTF / GLB / PLY / FBX / PMX / USDZ / ZIP";
})();

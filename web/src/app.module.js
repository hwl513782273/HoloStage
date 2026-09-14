/* HoloStage 1.1 — 3D 模型 → 线框全息加载动画（ES module 版，esbuild 打包）
 * 新增：USDZ（tinyusdz WASM，支持 usda/usdc）、GLB、ZIP 由原生层解压后进入本文件
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
  var titleEl = $("title"), barsEl = $("bars"), ringWrap = $("ringWrap");

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
    gridOn: true, hudOn: true, fileName: "", modelName: "HOLOSTAGE"
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

  /* ---------- HUD ---------- */
  (function buildHUD() {
    var NS = "http://www.w3.org/2000/svg";
    function mk(tag, attrs) {
      var el = document.createElementNS(NS, tag);
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    }
    var svgA = mk("svg", { id: "ringA", viewBox: "0 0 600 600", width: "100%" });
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
        fill: "rgba(63,185,255,0.16)"
      });
      svgA.appendChild(p);
    }
    ringWrap.appendChild(svgA);
    var svgB = mk("svg", { id: "ringB", viewBox: "0 0 600 600", width: "100%",
      style: "position:absolute;left:0;top:0" });
    svgB.appendChild(mk("circle", { cx: cx, cy: cx, r: 210, fill: "none",
      stroke: "rgba(63,185,255,0.35)", "stroke-width": 1.5 }));
    for (var t = 0; t < 60; t++) {
      var ta = (t / 60) * Math.PI * 2, r0 = 196, r1 = t % 5 === 0 ? 182 : 189;
      svgB.appendChild(mk("line", {
        x1: cx + r0 * Math.cos(ta), y1: cx + r0 * Math.sin(ta),
        x2: cx + r1 * Math.cos(ta), y2: cx + r1 * Math.sin(ta),
        stroke: "rgba(63,185,255,0.4)", "stroke-width": t % 5 === 0 ? 2.5 : 1
      }));
    }
    svgB.appendChild(mk("circle", { cx: cx, cy: cx, r: 3, fill: "rgba(63,185,255,0.7)" }));
    ringWrap.appendChild(svgB);
    for (var b = 0; b < 22; b++) {
      var sp = document.createElement("span");
      sp.style.height = (6 + (b % 4) * 5) + "px";
      sp.style.animationDelay = (b * 0.08) + "s";
      barsEl.appendChild(sp);
    }
  })();

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
    Array.prototype.forEach.call(document.querySelectorAll(".sw"), function (el) {
      el.classList.toggle("on", el.dataset.p === name);
    });
  }
  (function buildSwatches() {
    var wrap = $("swatches");
    Object.keys(PRESETS).forEach(function (k) {
      var d = document.createElement("div");
      d.className = "sw" + (k === currentPreset ? " on" : "");
      d.dataset.p = k;
      d.style.background = PRESETS[k].css;
      d.title = k;
      d.onclick = function () { applyPreset(k); };
      wrap.appendChild(d);
    });
  })();

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
  document.getElementById("panelToggle").onclick = function () {
    document.getElementById("panel").classList.remove("hidden");
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
    var scale = Math.min(1, 560 / canvas.clientWidth);
    var w = Math.round(canvas.clientWidth * scale), h = Math.round(canvas.clientHeight * scale);
    var workerSrc = bridge ? "holo://f/" + encodeURI(bundleWorkerPath()).replace(/#/g, "%23") : "lib/gif.worker.js";
    fetch(workerSrc).then(function (r) { return r.text(); }).then(function (code) {
      var workerUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
      var gif = new GIF({ workers: 1, quality: 8, width: w, height: h, workerScript: workerUrl });
      captureFrames(count, function (i, cnv) {
        gif.addFrame(cnv, { copy: true, delay: 100 });
      }, function () {
        gif.on("finished", function (blob) {
          var reader = new FileReader();
          reader.onload = function () {
            var b64 = reader.result.split(",")[1];
            var name = (state.fileName.replace(/\.[^.]+$/, "") || "holo") + "_holo.gif";
            if (bridge) bridge.postMessage({ type: "saveGif", data: b64, name: name });
            else downloadData(reader.result, name);
            finishExport("GIF 已导出: " + name);
          };
          reader.readAsDataURL(blob);
        });
        gif.render();
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
    var frames = [];
    captureFrames(count, function (i, cnv) {
      frames.push(cnv.toDataURL("image/png").split(",")[1]);
    }, function () {
      var name = state.fileName.replace(/\.[^.]+$/, "") || "holo";
      if (bridge) bridge.postMessage({ type: "savePngSeq", frames: frames, name: name });
      else frames.forEach(function (d, i) { downloadData("data:image/png;base64," + d, name + "_f" + String(i).padStart(2, "0") + ".png"); });
      exporting = false; statusEl.textContent = "PNG 序列已导出: " + name + "_f00..f" + (count - 1);
    });
  };

  /* ---------- 导出当前帧 ---------- */
  $("btnShot").onclick = function () {
    if (!srcMeshes.length) return;
    var d = canvas.toDataURL("image/png");
    var name = (state.fileName.replace(/\.[^.]+$/, "") || "holo") + "_frame.png";
    if (bridge) bridge.postMessage({ type: "savePng", data: d.split(",")[1], name: name });
    else downloadData(d, name);
  };

  function downloadData(url, name) {
    var a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  }

  /* ---------- 尺寸与主循环 ---------- */
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    var ring = Math.min(w, h) * 0.94;
    ringWrap.style.width = ring + "px";
    ringWrap.style.height = ring + "px";
  }
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

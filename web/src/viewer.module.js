/* HoloStage 1.2.6 — 导出网页查看器（被 App 导出时内嵌进单文件 HTML）
 * 读取 window.HOLO_EXPORT（设置）+ window.HOLO_GLB（模型 base64）还原画面：
 * 配色 / 线框或全彩 / 网格地台 / HUD 三环（含样式与环模式）/ 标题 / 进度条 / 扫描线 / 转速 / 呼吸 / 视差 / 脉冲 / 辉光 / 动画
 * 1.2.6: 环模式（经典 1.0）+ 相机控制（滚轮缩放 / 左键拖动视角 / 右键复位）
 * 1.3.2: 环三轴位移 + Z 轴朝上躺平；⌘/⌥ 拖拽 360° 自由视角
 * 1.3.3: WASD 平移 / QE 推拉；程序化科技背景（bg.js，或导出时内嵌的自定义图）
 * 1.3.4: 背景改为 bgfx.js 动态层（数字雨下落 / 扫描带 / 辉光呼吸 / 六边形与圆盘旋转），
 *        动效开关与速度随导出配置还原；自定义图仍走内嵌副本
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildRingSVG } from "./rings.js";
import { drawRingCanvas, ring3dSpin, RING3D_SIZE } from "./rings3d.js";
import { createBackgroundLayer } from "./bgfx.js";
import { collectSkeleton, createSkeletonView } from "./skeleton.js";

(function () {
  "use strict";
  var CFG = window.HOLO_EXPORT || {};
  var GLB_B64 = window.HOLO_GLB || "";
  var preset = CFG.preset || { css: "#3fb9ff", main: 0x3fb9ff, g1: 0x2b6ea6 };

  function hexToRgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function shadeHex(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    var g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    var b = Math.min(255, Math.round((n & 255) * f));
    return (r << 16) | (g << 8) | b;
  }
  function partColor(id) { return (CFG.ui && CFG.ui[id]) ? CFG.ui[id] : preset.css; }

  /* ---------- 样式 ---------- */
  var css = [
    "html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;font-family:'SF Mono',Menlo,monospace}",
    "#stage{position:absolute;inset:0;background:#000}",
    "#gl{position:absolute;inset:0;width:100%;height:100%;display:block}",
    "#hud{position:absolute;inset:0;pointer-events:none;perspective:1400px}",
    ".ringWrap{position:absolute;left:50%;top:50%;transform-style:preserve-3d;color:" + preset.css + "}",
    ".ringWrap svg{display:block;width:100%;height:100%;overflow:visible}",
    ".ringSpin{animation:hspin 24s linear infinite}",
    ".ringSpinRev{animation:hspin 40s linear infinite reverse}",
    ".ringSpinSlow{animation:hspin 56s linear infinite}",
    "@keyframes hspin{to{transform:rotate(360deg)}}",
    "#title{position:absolute;right:26px;bottom:40px;font-size:26px;font-weight:800;font-style:italic;letter-spacing:.22em;color:" + preset.css + ";text-shadow:0 0 12px " + hexToRgba(preset.css, .45) + ";white-space:nowrap;max-width:70%;overflow:hidden}",
    "#titleRule{position:absolute;right:26px;bottom:34px;width:260px;height:2px;background:linear-gradient(90deg," + preset.css + ",transparent);box-shadow:0 0 8px " + hexToRgba(preset.css, .45) + "}",
    "#bars{position:absolute;right:26px;bottom:12px;display:flex;gap:3px;align-items:flex-end}",
    "#bars span{width:7px;background:" + preset.css + ";box-shadow:0 0 6px " + hexToRgba(preset.css, .45) + ";animation:hbar 1.6s ease-in-out infinite}",
    "@keyframes hbar{0%,100%{opacity:.25}50%{opacity:1}}",
    ".corner{position:absolute;width:34px;height:34px;border:2px solid " + hexToRgba(partColor("corner"), .45) + "}",
    "#c-tl{left:14px;top:14px;border-right:0;border-bottom:0}",
    "#c-tr{right:14px;top:14px;border-left:0;border-bottom:0}",
    "#c-bl{left:14px;bottom:14px;border-right:0;border-top:0}",
    "#c-br{right:14px;bottom:14px;border-left:0;border-top:0}",
    "#scanline{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 3px," + hexToRgba(partColor("scan"), .02) + " 3px 4px)}",
    "#hint{position:absolute;left:26px;bottom:14px;font-size:12px;letter-spacing:.12em;color:" + hexToRgba(partColor("status"), .6) + "}"
  ].join("");
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------- DOM ---------- */
  document.body.insertAdjacentHTML("beforeend",
    '<div id="stage"><canvas id="gl"></canvas><div id="hud">' +
    '<div class="ringWrap" id="rw1"></div><div class="ringWrap" id="rw2"></div><div class="ringWrap" id="rw3"></div>' +
    '<div id="title"></div><div id="titleRule"></div><div id="bars"></div>' +
    '<div class="corner" id="c-tl"></div><div class="corner" id="c-tr"></div>' +
    '<div class="corner" id="c-bl"></div><div class="corner" id="c-br"></div>' +
    '<div id="scanline"></div></div></div>' +
    '<div id="hint">HOLOSTAGE EXPORT — 滚轮缩放 · 拖动视角 · WASD 平移 / QE 推拉 · ⌘/⌥+拖动 = 360° 自由视角 · 右键复位</div>');
  var stageEl = document.getElementById("stage");
  var canvas = document.getElementById("gl");
  var hudEl = document.getElementById("hud");
  document.getElementById("title").textContent = CFG.title || "HOLOSTAGE";
  document.getElementById("title").style.color = partColor("title");
  for (var b = 0; b < 22; b++) {
    var sp = document.createElement("span");
    sp.style.height = (6 + (b % 4) * 5) + "px";
    sp.style.animationDelay = (b * 0.08) + "s";
    sp.style.background = partColor("bars");
    document.getElementById("bars").appendChild(sp);
  }
  if (!CFG.hud) hudEl.style.display = "none";

  /* ---------- 三环 ---------- */
  var wraps = [1, 2, 3].map(function (n) { return document.getElementById("rw" + n); });
  var rings = CFG.rings || [{ style: "seg", x: 0, y: 0, z: 0, s: 100, p: 0, r: 0, w: 0, zu: false }, { style: "dial", x: 0, y: 0, z: 0, s: 100, p: 0, r: 0, w: 0, zu: false }, { style: "dash", x: 0, y: 0, z: 0, s: 86, p: 18, r: -12, w: 0, zu: false }];
  rings.forEach(function (rg, i) {
    wraps[i].innerHTML = buildRingSVG(rg.style, i + 1, CFG.hideDot, rg);
    wraps[i].style.color = partColor("ring" + (i + 1));
  });
  function applyRings() {
    var base = Math.min(window.innerWidth, window.innerHeight) * 0.94;
    var classic = CFG.ringMode === "classic"; // 1.2.7: 经典 = 3D 场景环（环心=世界中心，随相机透视）
    if (ring3dGroup) ring3dGroup.visible = classic && CFG.hud !== false;
    rings.forEach(function (rg, i) {
      if (classic) { wraps[i].style.display = "none"; return; } // 3D 环接管，CSS 环全隐藏
      wraps[i].style.display = "";
      var size = base * rg.s / 100;
      wraps[i].style.width = size + "px";
      wraps[i].style.height = size + "px";
      wraps[i].style.transform = "translate(calc(-50% + " + rg.x + "px), calc(-50% + " + rg.y + "px))" +
        " translateZ(" + (rg.z || 0) + "px)" +
        " rotateX(" + (rg.p + (rg.zu ? -90 : 0)) + "deg) rotateY(" + rg.w + "deg) rotateZ(" + rg.r + "deg)";
    });
  }

  /* ---------- three 场景 ---------- */
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);
  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.055);
  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1.7, 4.8);
  camera.lookAt(0, 0.85, 0);
  /* 相机轨道控制（1.2.6）：滚轮缩放 / 左键拖动视角 / 右键复位 */
  var CAM_TARGET = new THREE.Vector3(0, 0.85, 0);
  var CAM_HOME = { yaw: 0, pitch: Math.asin(0.85 / Math.sqrt(0.85 * 0.85 + 4.8 * 4.8)), dist: Math.sqrt(0.85 * 0.85 + 4.8 * 4.8) };
  var camYaw = CAM_HOME.yaw, camPitch = CAM_HOME.pitch, camDist = CAM_HOME.dist, camDrag = null;
  /* 1.3.2: 与 App 端同构 —— ⌘ / ⌥ + 拖拽 = 自由视角（360°，无地面限制） */
  var camFree = false;
  var WORLD_UP = new THREE.Vector3(0, 1, 0);
  var _orbOff = new THREE.Vector3(), _orbQ = new THREE.Quaternion(), _orbAxis = new THREE.Vector3();
  function updateCamera() {
    camera.position.set(
      CAM_TARGET.x + camDist * Math.cos(camPitch) * Math.sin(camYaw),
      CAM_TARGET.y + camDist * Math.sin(camPitch),
      CAM_TARGET.z + camDist * Math.cos(camPitch) * Math.cos(camYaw)
    );
    camera.lookAt(CAM_TARGET);
  }
  function syncSpherical() {
    _orbOff.copy(camera.position).sub(CAM_TARGET);
    var len = _orbOff.length();
    if (len > 1e-6) {
      camDist = len;
      camYaw = Math.atan2(_orbOff.x, _orbOff.z);
      camPitch = Math.asin(Math.max(-1, Math.min(1, _orbOff.y / len)));
    }
  }
  function orbitFree(dx, dy) {
    _orbOff.copy(camera.position).sub(CAM_TARGET);
    _orbQ.setFromAxisAngle(WORLD_UP, -dx * 0.005);
    _orbOff.applyQuaternion(_orbQ);
    camera.up.applyQuaternion(_orbQ);
    _orbAxis.crossVectors(_orbOff, camera.up);
    if (_orbAxis.lengthSq() > 1e-8) {
      _orbAxis.normalize();
      _orbQ.setFromAxisAngle(_orbAxis, -dy * 0.005);
      _orbOff.applyQuaternion(_orbQ);
      camera.up.applyQuaternion(_orbQ);
    }
    camera.up.normalize();
    camDist = _orbOff.length();
    camera.position.copy(CAM_TARGET).add(_orbOff);
    camera.lookAt(CAM_TARGET);
    camFree = true;
    syncSpherical();
  }
  updateCamera();

  /* 键盘移动镜头（1.3.3）：与 App 端同构 —— W/S 上下、A/D 左右平移观察目标点，Q/E 沿视线推拉 */
  var camKeys = {};
  var CAM_TARGET_HOME = CAM_TARGET.clone();
  var _camRight = new THREE.Vector3(), _camUp = new THREE.Vector3();
  function clampNum(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    var k = e.code;
    if (k === "KeyW" || k === "KeyA" || k === "KeyS" || k === "KeyD" || k === "KeyQ" || k === "KeyE") {
      camKeys[k] = true; e.preventDefault();
    }
  });
  window.addEventListener("keyup", function (e) { delete camKeys[e.code]; });
  window.addEventListener("blur", function () { camKeys = {}; }); // 切窗清空，防"卡键"
  function updateCamKeys(dt) {
    var kx = (camKeys.KeyD ? 1 : 0) - (camKeys.KeyA ? 1 : 0);
    var ky = (camKeys.KeyW ? 1 : 0) - (camKeys.KeyS ? 1 : 0);
    var kz = (camKeys.KeyE ? 1 : 0) - (camKeys.KeyQ ? 1 : 0);
    if (!kx && !ky && !kz) return;
    camera.updateMatrixWorld();
    _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    var s = 2.6 * dt * (camDist / CAM_HOME.dist);
    CAM_TARGET.addScaledVector(_camRight, kx * s).addScaledVector(_camUp, ky * s);
    CAM_TARGET.x = clampNum(CAM_TARGET.x, -24, 24);
    CAM_TARGET.y = clampNum(CAM_TARGET.y, -12, 12);
    CAM_TARGET.z = clampNum(CAM_TARGET.z, -24, 24);
    if (kz) camDist = clampNum(camDist * (1 + kz * 0.9 * dt), 1.2, 14);
    updateCamera();
  }

  /* 3D 全息环（1.2.7 经典模式）：环心固定在世界中心，随相机透视 */
  var ring3dGroup = new THREE.Group();
  ring3dGroup.position.copy(CAM_TARGET);
  scene.add(ring3dGroup);
  var ring3dMeshes = [];
  function rebuildRing3D() {
    ring3dMeshes.forEach(function (m) {
      m.material.map.dispose(); m.material.dispose(); m.geometry.dispose();
      ring3dGroup.remove(m);
    });
    ring3dMeshes = [];
    rings.forEach(function (rg, i) {
      var made = drawRingCanvas(rg.style, partColor("ring" + (i + 1)), CFG.hideDot, rg);
      var tex = new THREE.CanvasTexture(made.canvas);
      tex.anisotropy = 4;
      var mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(RING3D_SIZE, RING3D_SIZE),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      mesh.userData.spin = made.spin;
      ring3dGroup.add(mesh);
      ring3dMeshes.push(mesh);
    });
    applyRings();
  }

  /* 1.2.8: 经典模式每帧更新 —— 与 App 端同构（环心模型中点/世界中心 + 六参数跟手映射） */
  var _vRight = new THREE.Vector3(), _vUp = new THREE.Vector3(), _vNear = new THREE.Vector3();
  var modelMidY = CAM_TARGET.y; // 模型包围盒竖直中点（GLTF 加载后实测）
  function updateRings3D(dt) {
    if (!ring3dGroup.visible) return;
    camera.updateMatrixWorld();
    _vRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _vUp.setFromMatrixColumn(camera.matrixWorld, 1);
    _vNear.setFromMatrixColumn(camera.matrixWorld, 2); // 相机后向 → +Z 即"朝观察者"（1.3.2）
    if (CFG.ringAnchor !== "world") {
      ring3dGroup.position.set(0, modelMidY + (root.position.y || 0), 0); // 跟随模型（含呼吸）
    } else {
      ring3dGroup.position.copy(CAM_TARGET); // 世界中心（1.2.7 行为）
    }
    var worldPerPx = 2 * camDist * Math.tan(camera.fov * Math.PI / 360) / window.innerHeight;
    var DEG = Math.PI / 180;
    rings.forEach(function (rg, i) {
      var m = ring3dMeshes[i];
      if (!m) return;
      m.position.set(0, 0, 0)
        .addScaledVector(_vRight, rg.x * worldPerPx)
        .addScaledVector(_vUp, -rg.y * worldPerPx) // 屏幕 Y 向下，取负
        .addScaledVector(_vNear, (rg.z || 0) * worldPerPx); // 1.3.2: 深度位移
      m.scale.setScalar(Math.max(0.05, rg.s / 100));
      m.userData.spinAcc = (m.userData.spinAcc || 0) + m.userData.spin * dt;
      m.rotation.set((rg.p + (rg.zu ? -90 : 0)) * DEG, rg.w * DEG, rg.r * DEG + m.userData.spinAcc); // 1.3.2: zu 躺平
    });
  }

  /* 相机交互（1.2.6）：滚轮缩放 / 左键拖动视角 / 右键复位
   * 1.3.2: ⌘ 或 ⌥ + 拖拽 = 自由视角（360°），修饰键直接从鼠标事件读取，免疫"卡键" */
  stageEl.addEventListener("wheel", function (e) {
    e.preventDefault();
    var f = (e.deltaY > 0 ? 1.08 : 1 / 1.08);
    if (camFree) {
      // 自由翻滚姿态：沿当前视线推拉，保持姿态，不跳回球坐标
      _orbOff.copy(camera.position).sub(CAM_TARGET).normalize();
      camDist = Math.max(1.2, Math.min(14, camDist * f));
      camera.position.copy(CAM_TARGET).addScaledVector(_orbOff, camDist);
      syncSpherical();
      camera.lookAt(CAM_TARGET);
    } else {
      camDist = Math.max(1.2, Math.min(14, camDist * f));
      updateCamera();
    }
  }, { passive: false });
  stageEl.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    camDrag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("mousemove", function (e) {
    if (!camDrag) return;
    var dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
    camDrag = { x: e.clientX, y: e.clientY };
    if (e.metaKey || e.altKey) { orbitFree(dx, dy); return; } // 1.3.2: 自由视角，不夹取
    camYaw -= dx * 0.005;
    camPitch = Math.max(-1.2, Math.min(1.45, camPitch + dy * 0.005));
    camFree = false; camera.up.set(0, 1, 0); // 受限视角的 up 恒为世界 up
    updateCamera();
  });
  window.addEventListener("mouseup", function () { camDrag = null; });
  stageEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    camYaw = CAM_HOME.yaw; camPitch = CAM_HOME.pitch; camDist = CAM_HOME.dist;
    CAM_TARGET.copy(CAM_TARGET_HOME); // 1.3.3: WASD 平移过也要一并回家
    camFree = false; camera.up.set(0, 1, 0); // 1.3.2: 自由翻滚后一并复位 up，否则画面保持倒置
    updateCamera();
  });
  var composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  var bloomBase = (typeof CFG.bloom === "number") ? CFG.bloom : 0.9;
  var bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 1.1, 0.6, 0.0);
  composer.addPass(bloom);
  function applyAtmo() {
    var atmo = (CFG.mode === "full") ? (CFG.atmo !== false) : true;
    bloom.strength = atmo ? bloomBase : 0;
    scene.fog.density = atmo ? 0.055 : 0;
  }
  applyAtmo();

  /* 网格地台 */
  var gridGroup = new THREE.Group();
  scene.add(gridGroup);
  var gcol = shadeHex(partColor("grid"), 0.62);
  var g1 = new THREE.GridHelper(26, 52, gcol, gcol);
  g1.material.transparent = true; g1.material.opacity = 0.55;
  var g2 = new THREE.GridHelper(26, 13, gcol, gcol);
  g2.material.transparent = true; g2.material.opacity = 0.9;
  gridGroup.add(g1); gridGroup.add(g2);
  gridGroup.visible = CFG.grid !== false;

  /* 背景（1.3.4）：与 App 端同一个 bgfx.js 动态层；若导出时用的是自定义图则内嵌副本还原 */
  var bgLayer = null;
  function bgEnsure() {
    if (bgLayer) return bgLayer;
    bgLayer = createBackgroundLayer({
      mainHex: preset.css,
      bright: (CFG.bg && typeof CFG.bg.bright === "number") ? CFG.bg.bright : 1,
      speed: (CFG.bg && typeof CFG.bg.speed === "number") ? CFG.bg.speed : 1,
      motion: !(CFG.bg && CFG.bg.motion === false)
    });
    scene.add(bgLayer.mesh);
    return bgLayer;
  }
  function bgDrawSize() {
    var v = new THREE.Vector2();
    renderer.getDrawingBufferSize(v);
    return [Math.max(2, Math.round(v.x)), Math.max(2, Math.round(v.y))];
  }
  function applyBackground() {
    var cfg = CFG.bg;
    var useImage = !!(cfg && cfg.img);
    var useFx = !!(cfg && !cfg.img);
    var L = bgEnsure();
    L.mesh.visible = useFx;
    L.setMain(preset.css);
    if (useFx) {
      var d = bgDrawSize();
      L.setSize(d[0], d[1]);
    }
    if (scene.background && scene.background.isTexture) scene.background.dispose();
    scene.background = null;
    if (!useImage) return;
    var W = window.innerWidth, H = window.innerHeight;
    var im = new Image();
    im.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var cx = cv.getContext("2d");
      var s = Math.max(W / im.width, H / im.height);
      cx.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s);
      var t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      scene.background = t;
    };
    im.src = cfg.img;
  }

  /* 灯光（全彩模式用） */
  var hemiLight = new THREE.HemisphereLight(0xffffff, 0x334455, 1.1);
  var dirLight = new THREE.DirectionalLight(0xffffff, 1.6); dirLight.position.set(2.5, 4, 3);
  var ambLight = new THREE.AmbientLight(0xffffff, 0.55);
  var backLight = new THREE.DirectionalLight(0xdde8ff, 0.8); backLight.position.set(-2, 1.5, -3);
  scene.add(hemiLight); scene.add(dirLight); scene.add(ambLight); scene.add(backLight);

  /* ---------- 模型 ---------- */
  var root = new THREE.Group();
  scene.add(root);
  var mixer = null;
  var skelView = null; // 1.3.5: 骨架叠加层（查看器只做「看得见」，不提供编辑）
  function b64ToBuf(s) {
    var bin = atob(s), len = bin.length, buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  if (GLB_B64) {
    new GLTFLoader().parse(b64ToBuf(GLB_B64), "", function (gltf) {
      root.add(gltf.scene);
      gltf.scene.updateMatrixWorld(true); // 1.2.8: 实测模型包围盒竖直中点（环心用）
      var bb = new THREE.Box3().setFromObject(gltf.scene);
      if (!bb.isEmpty()) modelMidY = (bb.min.y + bb.max.y) / 2;
      if (CFG.mode === "wire") {
        gltf.scene.updateMatrixWorld(true);
        var mat = new THREE.LineBasicMaterial({
          color: preset.main, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false
        });
        var items = [];
        gltf.scene.traverse(function (o) { if (o.isMesh && o.geometry) items.push({ g: o.geometry, m: o.matrixWorld.clone() }); });
        items.forEach(function (it) {
          try {
            var wg = new THREE.WireframeGeometry(it.g);
            var ln = new THREE.LineSegments(wg, mat);
            ln.applyMatrix4(it.m);
            root.add(ln);
          } catch (e) { }
        });
        gltf.scene.visible = false;
      }
      if (CFG.anim && gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        mixer.clipAction(gltf.animations[0]).play();
      }
      // 1.3.5: 骨架叠加（八面体、穿透显示）。线框模式下蒙皮网格被隐藏也不影响 —— 骨架是独立层
      if (CFG.skel && CFG.skel.show) {
        var sv = null;
        try { sv = collectSkeleton(gltf.scene); } catch (e) { sv = null; }
        if (sv) {
          skelView = createSkeletonView(sv, { color: preset.main, selectedColor: 0xffffff });
          scene.add(skelView.mesh);
          skelView.update();
        }
      }
    }, function (err) {
      document.getElementById("hint").textContent = "模型解析失败: " + (err && err.message ? err.message : err);
    });
  }

  /* ---------- 交互（鼠标视差） ---------- */
  var mousePar = { x: 0, y: 0 };
  if (CFG.parallax) {
    window.addEventListener("mousemove", function (e) {
      mousePar.x = Math.max(-1, Math.min(1, (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2)));
      mousePar.y = Math.max(-1, Math.min(1, (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2)));
    });
  }

  /* ---------- 尺寸与主循环 ---------- */
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applyRings();
    applyBackground();
  }
  window.addEventListener("resize", resize);
  resize();
  rebuildRing3D(); // 1.2.7: 首次构建 3D 全息环

  var last = performance.now(), tAcc = 0, spin = 0;
  (function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min((now - last) / 1000, 0.1); last = now;
    tAcc += dt;
    if (bgLayer) bgLayer.tick(dt); // 1.3.4: 动态背景层
    if (mixer) mixer.update(dt);
    if (skelView) skelView.update(); // 1.3.5: 骨架跟随当前姿态（放在 mixer 之后读到本帧姿态）
    updateCamKeys(dt); // 1.3.3: WASD / QE 移动镜头
    spin += (CFG.speed || 0.5) * dt;
    root.rotation.y = spin + (CFG.parallax ? mousePar.x * 0.22 : 0) +
      (CFG.swayOn ? Math.sin(tAcc * 0.8) * 0.06 * (CFG.swayAmp || 1) : 0); // 1.2.10 摆动
    root.rotation.z = (CFG.parallax ? mousePar.y * 0.1 : 0) +
      (CFG.swayOn ? Math.sin(tAcc * 0.6) * 0.035 * (CFG.swayAmp || 1) : 0);
    root.position.y = CFG.bobOn ? Math.sin(tAcc * 1.7) * 0.055 * (CFG.bobAmp || 1) : 0;
    updateRings3D(dt); // 1.2.8: 环心跟随 + 六参数跟手映射 + 平面内自转
    if (CFG.pulse) bloom.strength = bloomBase * (1 + 0.22 * Math.sin(tAcc * 2.3));
    composer.render();
  })(last);
})();

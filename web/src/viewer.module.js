/* HoloStage 1.2.6 — 导出网页查看器（被 App 导出时内嵌进单文件 HTML）
 * 读取 window.HOLO_EXPORT（设置）+ window.HOLO_GLB（模型 base64）还原画面：
 * 配色 / 线框或全彩 / 网格地台 / HUD 三环（含样式与环模式）/ 标题 / 进度条 / 扫描线 / 转速 / 呼吸 / 视差 / 脉冲 / 辉光 / 动画
 * 1.2.6: 环模式（经典 1.0）+ 相机控制（滚轮缩放 / 左键拖动视角 / 右键复位）
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildRingSVG } from "./rings.js";

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
    '<div id="hint">HOLOSTAGE EXPORT — 滚轮缩放 · 左键拖动视角 · 右键复位</div>');
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
  var rings = CFG.rings || [{ style: "seg", x: 0, y: 0, s: 100, p: 0, r: 0, w: 0 }, { style: "dial", x: 0, y: 0, s: 100, p: 0, r: 0, w: 0 }, { style: "dash", x: 0, y: 0, s: 86, p: 18, r: -12, w: 0 }];
  rings.forEach(function (rg, i) {
    wraps[i].innerHTML = buildRingSVG(rg.style, i + 1);
    wraps[i].style.color = partColor("ring" + (i + 1));
  });
  function applyRings() {
    var base = Math.min(window.innerWidth, window.innerHeight) * 0.94;
    var classic = CFG.ringMode === "classic"; // 1.2.6: 经典 1.0 — 锚定中心平转，忽略独立变换，隐藏③号环
    rings.forEach(function (rg, i) {
      if (classic) {
        wraps[i].style.display = (i === 2) ? "none" : "";
        wraps[i].style.width = base + "px";
        wraps[i].style.height = base + "px";
        wraps[i].style.transform = "translate(-50%, -50%)";
        return;
      }
      wraps[i].style.display = "";
      var size = base * rg.s / 100;
      wraps[i].style.width = size + "px";
      wraps[i].style.height = size + "px";
      wraps[i].style.transform = "translate(calc(-50% + " + rg.x + "px), calc(-50% + " + rg.y + "px))" +
        " rotateX(" + rg.p + "deg) rotateY(" + rg.w + "deg) rotateZ(" + rg.r + "deg)";
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
  function updateCamera() {
    camera.position.set(
      CAM_TARGET.x + camDist * Math.cos(camPitch) * Math.sin(camYaw),
      CAM_TARGET.y + camDist * Math.sin(camPitch),
      CAM_TARGET.z + camDist * Math.cos(camPitch) * Math.cos(camYaw)
    );
    camera.lookAt(CAM_TARGET);
  }
  updateCamera();
  stageEl.addEventListener("wheel", function (e) {
    e.preventDefault();
    camDist *= (e.deltaY > 0 ? 1.08 : 1 / 1.08);
    camDist = Math.max(1.2, Math.min(14, camDist));
    updateCamera();
  }, { passive: false });
  stageEl.addEventListener("mousedown", function (e) {
    if (e.button === 0) camDrag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("mousemove", function (e) {
    if (!camDrag) return;
    var dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
    camDrag = { x: e.clientX, y: e.clientY };
    camYaw -= dx * 0.005;
    camPitch = Math.max(-1.2, Math.min(1.45, camPitch + dy * 0.005));
    updateCamera();
  });
  window.addEventListener("mouseup", function () { camDrag = null; });
  stageEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    camYaw = CAM_HOME.yaw; camPitch = CAM_HOME.pitch; camDist = CAM_HOME.dist;
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
  function b64ToBuf(s) {
    var bin = atob(s), len = bin.length, buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  if (GLB_B64) {
    new GLTFLoader().parse(b64ToBuf(GLB_B64), "", function (gltf) {
      root.add(gltf.scene);
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
  }
  window.addEventListener("resize", resize);
  resize();

  var last = performance.now(), tAcc = 0, spin = 0;
  (function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min((now - last) / 1000, 0.1); last = now;
    tAcc += dt;
    if (mixer) mixer.update(dt);
    spin += (CFG.speed || 0.5) * dt;
    root.rotation.y = spin + (CFG.parallax ? mousePar.x * 0.22 : 0);
    root.rotation.z = CFG.parallax ? mousePar.y * 0.1 : 0;
    root.position.y = CFG.bobOn ? Math.sin(tAcc * 1.7) * 0.055 * (CFG.bobAmp || 1) : 0;
    if (CFG.pulse) bloom.strength = bloomBase * (1 + 0.22 * Math.sin(tAcc * 2.3));
    composer.render();
  })(last);
})();

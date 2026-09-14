/* HoloStage 1.2 — 3D 模型 → 线框全息加载动画（ES module 版，esbuild 打包）
 * 1.1: USDZ（tinyusdz usdc/usda）+ GLB + ZIP（原生解压后进入）
 * 1.2: 模型 XYZ 位移 / 画面比例 / 导出分辨率 / 帧率 / 配色下拉 / 三环独立变换
 * 1.2.2: 配色只作用于画面内（面板固定青蓝）；新增全彩（原材质）渲染 + 全彩氛围开关
 * 1.2.3: 缩放上限 10×；重置变换按钮；界面部件逐个 #RRGGBB 配色（auto=跟随配色下拉）
 * 1.2.4: 面板可读性提升；舞台底部比例/分辨率快捷切换条；悬浮呼吸/鼠标视差/辉光脉冲；
 *        glTF/GLB/FBX 骨骼动画播放（播放/暂停/进度/速度/循环/多片段切换）
 * 1.2.5: 全息环样式库（分段弧/刻度盘/虚线环/魔法阵/数据弧，每环独立切换）+ 偏航角；
 *        环组/场景组重置按钮；界面配色折叠；导出单文件网页 HTML（完整还原画面）
 * 1.2.6: 环模式（自由变换 / 经典 1.0 绕中点平转）；相机控制（滚轮缩放 / 左键拖动视角 / 右键复位）
 * 1.2.7: 经典模式升级为真 3D 场景环（rings3d.js Canvas 纹理）：环心固定世界中心、随相机透视环绕，
 *        GIF/PNG 帧导出也包含环；导出网页查看器同步
 * 1.3.0: PMX/PMD 真正动起来 —— VMD 动作（拖入 .vmd 自动挂载）+ ammo.js 物理（头发/裙摆/胸）
 *        MMDAnimationHelper 接管 IK/grant/物理，物理开关 + 重力/强度可调
 * 1.3.1: 修复导出裁切：导出期间像素比压到 1，canvas 缓冲区 = 导出尺寸，
 *        解决 Retina(×2) 下 gif.js 只取左上 1/4 导致「GIF 显示不全」；
 *        PNG 序列/单帧 PNG 的实际像素也随之回到标称分辨率
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader.js";
import { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper.js";
import { TinyUSDZLoader } from "./vendor/TinyUSDZLoader.js";
import { TinyUSDZLoaderUtils } from "./vendor/TinyUSDZLoaderUtils.js";
import { buildRingSVG, RING_STYLES } from "./rings.js";
import { drawRingCanvas, ring3dSpin, RING3D_SIZE } from "./rings3d.js";
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
  var uiColors = {}; // 1.2.3: 界面部件自定义色 { partId: "#rrggbb" }，缺省=跟随预设
  var uiRowEls = {}; // 1.2.3: 配色行 DOM { partId: { text, swatch } }

  function shadeHex(hex, f) { // "#rrggbb" → 各通道乘系数（地台压暗用）
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    var g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    var b = Math.min(255, Math.round((n & 255) * f));
    return (r << 16) | (g << 8) | b;
  }
  function hexToRgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  /* ---------- three 场景 ---------- */
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
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
  var camYaw = CAM_HOME.yaw, camPitch = CAM_HOME.pitch, camDist = CAM_HOME.dist;
  function updateCamera() {
    camera.position.set(
      CAM_TARGET.x + camDist * Math.cos(camPitch) * Math.sin(camYaw),
      CAM_TARGET.y + camDist * Math.sin(camPitch),
      CAM_TARGET.z + camDist * Math.cos(camPitch) * Math.cos(camYaw)
    );
    camera.lookAt(CAM_TARGET);
  }
  updateCamera();

  var composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  var bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 1.1, 0.6, 0.0);
  composer.addPass(bloom);

  /* ---------- 网格地台 ---------- */
  var gridGroup = new THREE.Group();
  scene.add(gridGroup);
  function buildGrids() {
    while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
    // 1.2.3: 地台色可被界面配色覆盖（custom → 主色压暗 0.62；auto → 用预设派生色）
    var gcol = uiColors.grid ? shadeHex(uiColors.grid, 0.62) : PRESETS[currentPreset].g1;
    var g1 = new THREE.GridHelper(26, 52, gcol, gcol);
    g1.material.transparent = true; g1.material.opacity = 0.55;
    var g2 = new THREE.GridHelper(26, 13, gcol, gcol);
    g2.material.transparent = true; g2.material.opacity = 0.9;
    gridGroup.add(g1); gridGroup.add(g2);
  }
  buildGrids();

  /* ---------- 模型容器 ---------- */
  var modelRoot = new THREE.Group();
  var wireGroup = new THREE.Group();
  var fullGroup = new THREE.Group();   // 1.2.2: 全彩（原材质）渲染容器
  modelRoot.add(wireGroup);
  modelRoot.add(fullGroup);
  scene.add(modelRoot);

  // 灯光（只影响全彩模式的 PBR/Phong 材质；线框 LineBasicMaterial 与 GridHelper 不受影响）
  var hemiLight = new THREE.HemisphereLight(0xffffff, 0x334455, 1.1);
  var dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
  dirLight.position.set(2.5, 4, 3);
  var ambLight = new THREE.AmbientLight(0xffffff, 0.55);
  var backLight = new THREE.DirectionalLight(0xdde8ff, 0.8); // 背光：避免金属 PBR 材质背光面全黑
  backLight.position.set(-2, 1.5, -3);
  scene.add(hemiLight); scene.add(dirLight); scene.add(ambLight); scene.add(backLight);

  /* ---------- 3D 全息环（1.2.7 经典模式）：环心固定在世界中心，随相机透视 ---------- */
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
    state.rings.forEach(function (rg, i) {
      var made = drawRingCanvas(rg.style, partColor("ring" + (i + 1)), state.hideCenterDot);
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

  /* 1.2.8: 经典模式每帧更新 —— 环心（模型中点/世界中心）+ 六参数跟手映射
   * 跟手映射：X/Y 沿相机右/上方向位移（1px 屏幕 = worldPerPx 世界单位，与自由模式手感一致）；
   * 大小% 缩放环直径；俯仰/偏航/滚转转环面（欧拉序 XYZ，与 CSS rotateX/Y/Z 同构）；
   * 平面内自转累计在 spinAcc，避免覆盖滚转角。 */
  var _vRight = new THREE.Vector3(), _vUp = new THREE.Vector3();
  function updateRings3D(dt) {
    if (!ring3dGroup.visible) return;
    camera.updateMatrixWorld();
    _vRight.setFromMatrixColumn(camera.matrixWorld, 0); // 相机右 = 屏幕右
    _vUp.setFromMatrixColumn(camera.matrixWorld, 1);    // 相机上 = 屏幕上
    if (state.ringAnchor === "model") {
      // 模型中点：跟随模型水平位移与呼吸浮动（modelRoot.position.y - modelBaseY = 呼吸增量）
      ring3dGroup.position.set(modelRoot.position.x,
        modelMidY + (modelRoot.position.y - modelBaseY),
        modelRoot.position.z);
    } else {
      ring3dGroup.position.copy(CAM_TARGET); // 世界中心（1.2.7 行为）
    }
    var worldPerPx = 2 * camDist * Math.tan(camera.fov * Math.PI / 360) / stageH;
    var DEG = Math.PI / 180;
    state.rings.forEach(function (rg, i) {
      var m = ring3dMeshes[i];
      if (!m) return;
      m.position.set(0, 0, 0)
        .addScaledVector(_vRight, rg.x * worldPerPx)
        .addScaledVector(_vUp, -rg.y * worldPerPx); // 屏幕 Y 向下，取负
      m.scale.setScalar(Math.max(0.05, rg.s / 100));
      m.userData.spinAcc = (m.userData.spinAcc || 0) + m.userData.spin * dt;
      m.rotation.set(rg.p * DEG, rg.w * DEG, rg.r * DEG + m.userData.spinAcc);
    });
  }
  var srcMeshes = [];
  var modelBaseY = 0; // 1.2.4: 悬浮呼吸的基准高度（normalizeModel 后记录）
  var modelMidY = 0.85; // 1.2.8: 模型包围盒竖直中点（经典模式"模型中点"环心）
  var state = {
    speed: 0.5, mode: "wire", angle: 32, scale: 1.0, zup: false,
    render: "wire",                     // 1.2.2: wire | full
    atmo: true,                         // 1.2.2: 全彩氛围（辉光+雾）
    smoothNormals: true, lastLoad: null, // 1.2.9: 全彩平滑法线（切换时重载模型生效）
    bobOn: true, bobAmp: 1.0,           // 1.2.4: 悬浮呼吸
    parallaxOn: false,                  // 1.2.4: 鼠标视差
    pulseOn: false,                     // 1.2.4: 辉光脉冲
    swayOn: false, swayAmp: 1.0,        // 1.2.10: 待机摆动（轻微摇摆/倾斜）
    hideCenterDot: false,               // 1.2.10: 隐藏刻度盘/魔法阵中央圆点
    customColor: null,                  // 1.2.10: 自定义配色 #rrggbb（存入 PRESETS.custom）
    physOn: false, physGravity: 1.0, physStrength: 1.0, // 1.3.0: ammo.js 物理（PMX/PMD）
    vmdUrl: "", vmdName: "",            // 1.3.0: 拖入的 VMD 动作文件
    gridOn: true, hudOn: true, fileName: "", modelName: "HOLOSTAGE",
    pos: { x: 0, y: 0, z: 0 },          // 模型位移（世界单位）
    delay: 100,                          // GIF 每帧延时 ms
    ringMode: "free",                    // 1.2.6: free=自由变换 | classic=经典 1.0（绕中点平转）
    ringAnchor: "model",                 // 1.2.8: 经典模式环心 model=模型中点（跟随模型）| world=世界中心
    rings: [                             // 三环独立变换（w=偏航角，style=环样式 1.2.5）
      { x: 0, y: 0, s: 100, p: 0, r: 0, w: 0, style: "seg" },
      { x: 0, y: 0, s: 100, p: 0, r: 0, w: 0, style: "dial" },
      { x: 0, y: 0, s: 86,  p: 18, r: -12, w: 0, style: "dash" }
    ]
  };
  var RING_DEFAULTS = [
    { x: 0, y: 0, s: 100, p: 0, r: 0, w: 0 },
    { x: 0, y: 0, s: 100, p: 0, r: 0, w: 0 },
    { x: 0, y: 0, s: 86,  p: 18, r: -12, w: 0 }
  ];

  /* ---------- 全彩：保留原始对象树 / 释放 ---------- */
  function disposeObject(root) {
    root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      var mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      mats.forEach(function (m) {
        for (var k in m) {
          var v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      });
    });
  }
  function setFullObject(obj) {
    while (fullGroup.children.length) {
      var c = fullGroup.children[0];
      fullGroup.remove(c);
      disposeObject(c);
    }
    if (obj.isBufferGeometry) {
      var mesh = new THREE.Mesh(obj, new THREE.MeshStandardMaterial({ color: 0xbfc8d0, metalness: 0.1, roughness: 0.75 }));
      fullGroup.add(mesh);
    } else {
      fullGroup.add(obj);
    }
  }

  /* ---------- 全彩平滑法线（1.2.9）----------
   * STL/PLY（及部分 OBJ）是"三角汤"：顶点不共享、法线逐面平坦 → 全彩渲染出块状棱角。
   * needsSmoothing：抽样比较同位置顶点的法线，夹角 > ~20° 判定为平坦着色；
   * smoothGeometry：按位置精确合并顶点（保留 uv/颜色首现值），重算面积加权平滑法线。
   * 已有平滑法线的模型（GLB/FBX/PMX 等）检测后直接跳过，不做任何改动。 */
  function needsSmoothing(g) {
    var pos = g.attributes.position, nor = g.attributes.normal;
    if (!nor) return true;
    var seen = {}, cap = Math.min(pos.count, 120000);
    for (var i = 0; i < cap; i++) {
      var key = pos.getX(i) + "," + pos.getY(i) + "," + pos.getZ(i);
      if (seen[key] !== undefined) {
        var j = seen[key];
        var dot = nor.getX(i) * nor.getX(j) + nor.getY(i) * nor.getY(j) + nor.getZ(i) * nor.getZ(j);
        if (dot < 0.94) return true; // 同位置法线夹角 > 20° → 平面着色
      } else seen[key] = i;
    }
    return false;
  }
  function smoothGeometry(g) {
    var pos = g.attributes.position, count = pos.count;
    var hasUV = !!g.attributes.uv, hasCol = !!g.attributes.color;
    var map = {}, verts = [], uvs = hasUV ? [] : null, cols = hasCol ? [] : null, nv = 0;
    var idx = new Uint32Array(count);
    for (var i = 0; i < count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var key = x + "," + y + "," + z, id = map[key];
      if (id === undefined) {
        id = nv++; map[key] = id;
        verts.push(x, y, z);
        if (hasUV) uvs.push(g.attributes.uv.getX(i), g.attributes.uv.getY(i));
        if (hasCol) cols.push(g.attributes.color.getX(i), g.attributes.color.getY(i), g.attributes.color.getZ(i));
      }
      idx[i] = id;
    }
    var ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    if (hasUV) ng.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    if (hasCol) ng.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    ng.setIndex(new THREE.BufferAttribute(idx, 1));
    ng.computeVertexNormals(); // 面积加权平均 → 曲面圆润
    return ng;
  }
  function smoothPass(g) {
    if (!g || !g.attributes || !g.attributes.position) return g;
    if (g.index) return g;                                    // 已索引 = 建模时拓扑完好
    if (g.attributes.skinIndex || g.attributes.skinWeight) return g; // 蒙皮网格不动
    return needsSmoothing(g) ? smoothGeometry(g) : g;
  }

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
    modelRoot.updateMatrixWorld(true); // 1.2.8: 记录模型包围盒竖直中点（环心用）
    var wb = new THREE.Box3().setFromObject(modelRoot);
    if (!wb.isEmpty()) modelMidY = (wb.min.y + wb.max.y) / 2;
    modelBaseY = modelRoot.position.y; // 1.2.4
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
          // 1.2.2: overrideMaterial=false → 保留 USD 原材质（全彩模式用），缺材质处回落 defaultMtl
          var obj = TinyUSDZLoaderUtils.buildThreeNode(root, mtl, usd, { overrideMaterial: false });
          done(obj);
        }, fail);
      });
    }).catch(fail);
  }

  /* ---------- OBJ + MTL（1.2.2: 全彩模式需要原材质/贴图） ---------- */
  function tryOBJMaterials(url, cb) {
    fetch(url).then(function (r) { return r.ok ? r.text() : null; }).then(function (text) {
      if (!text) { cb(null); return; }
      var m = text.match(/^\s*mtllib\s+(.+)$/m);
      if (!m) { cb(null); return; }
      var mtlName = m[1].trim().replace(/^"+|"+$/g, "");
      var dir = url.substring(0, url.lastIndexOf("/") + 1);
      var mtlUrl = dir + encodeURI(mtlName).replace(/#/g, "%23").replace(/\?/g, "%3F");
      new MTLLoader().load(mtlUrl, function (mats) { mats.preload(); cb(mats); }, undefined, function () { cb(null); });
    }).catch(function () { cb(null); });
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
    function done(object3DorGeom, anims) {
      state.lastLoad = { url: url, name: name }; // 1.2.9: 平滑法线开关切换时重载用
      // 1.2.9: 全彩平滑法线（三角汤检测 + 按位置合并顶点重算）
      if (state.smoothNormals) {
        if (object3DorGeom.isBufferGeometry) object3DorGeom = smoothPass(object3DorGeom);
        else object3DorGeom.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry = smoothPass(o.geometry); });
      }
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
      setFullObject(object3DorGeom.isBufferGeometry ? object3DorGeom : object3DorGeom);
      var res = buildWireframe();
      normalizeModel();
      setupAnimations(object3DorGeom.isBufferGeometry ? null : object3DorGeom, anims || [], kind);
      var base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").toUpperCase();
      state.fileName = name;
      $("inpTitle").value = base;
      titleEl.textContent = base;
      var animNote = (anims && anims.length) ? " — " + anims.length + " 动画片段（全彩模式可见）" : "";
      statusEl.textContent = name.toUpperCase() + " — " + res.tris.toLocaleString() + " TRIS — " + res.segs.toLocaleString() + " WIREFRAME SEGS" + animNote;
    }
    function fail(err) { showError("载入失败: " + (err && err.message ? err.message : err)); }
    try {
      switch (kind) {
        case "stl":  new STLLoader().load(enc, function (g) { done(g); }, undefined, fail); break;
        case "ply":  new PLYLoader().load(enc, function (g) { done(g); }, undefined, fail); break;
        case "obj": tryOBJMaterials(enc, function (mats) {
          var l = new OBJLoader();
          if (mats) l.setMaterials(mats);
          l.load(enc, function (o) { done(o); }, undefined, fail);
        }); break;
        case "gltf": new GLTFLoader().load(enc, function (g) { done(g.scene || g.scenes[0], g.animations); }, undefined, fail); break;
        case "fbx":  new FBXLoader().load(enc, function (o) { done(o, o.animations); }, undefined, fail); break;
        case "mmd":  new MMDLoader().load(enc, function (o) { done(o, o.animations); }, undefined, fail); break;
        case "usdz": loadUSDZ(enc, name, fail, done); break;
      }
    } catch (e) { fail(e); }
  }
  window.holoLoadFile = loadModel;

  function showError(msg) { errEl.textContent = msg; errEl.style.display = "block"; }
  function hideError() { errEl.style.display = "none"; }

  /* ---------- HUD：三环（样式库 1.2.5）+ 底部进度条 ---------- */
  var ringWraps = [$("ringWrap1"), $("ringWrap2"), $("ringWrap3")];
  (function buildHUD() {
    // 1.2.5: 环内容由 rings.js 样式库生成（每环可独立切换样式）
    ringWraps.forEach(function (wrap, i) {
      wrap.innerHTML = buildRingSVG(state.rings[i].style, i + 1, state.hideCenterDot);
    });
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
    var classic = state.ringMode === "classic"; // 1.2.7: 经典 = 3D 场景环（环心=世界中心，随相机透视）
    var hudOn = $("inpHud") ? $("inpHud").checked : true;
    ring3dGroup.visible = classic && hudOn;
    state.rings.forEach(function (rg, i) {
      var wrap = ringWraps[i];
      if (classic) { wrap.style.display = "none"; return; } // 3D 环接管，CSS 环全隐藏
      wrap.style.display = "";
      var size = base * rg.s / 100;
      wrap.style.width = size + "px";
      wrap.style.height = size + "px";
      wrap.style.transform = "translate(calc(-50% + " + rg.x + "px), calc(-50% + " + rg.y + "px))" +
        " rotateX(" + rg.p + "deg) rotateY(" + rg.w + "deg) rotateZ(" + rg.r + "deg)";
    });
  }

  /* ---------- 配色（下拉框，1.2；界面部件逐个配色，1.2.3） ---------- */
  var UI_PARTS = [
    { id: "ring1",  label: "① 号环" },
    { id: "ring2",  label: "② 号环" },
    { id: "ring3",  label: "③ 号环" },
    { id: "title",  label: "标题文字" },
    { id: "bars",   label: "底部进度条" },
    { id: "corner", label: "四角框" },
    { id: "grid",   label: "网格地台" },
    { id: "scan",   label: "扫描线" },
    { id: "status", label: "状态条" },
    { id: "panel",  label: "控制面板" }
  ];
  function partColor(id) { return uiColors[id] || PRESETS[currentPreset].css; }
  var scanEl = $("scanline"), titleRuleEl = $("titleRule");
  function applyUIColors() {
    // 三环（SVG 用 currentColor）
    ringWraps.forEach(function (w, i) { w.style.color = partColor("ring" + (i + 1)); });
    // 3D 全息环（1.2.7）：换色即重建纹理
    if (ring3dMeshes.length) rebuildRing3D();
    // 标题 + 标题下划线
    var ct = partColor("title");
    titleEl.style.color = ct;
    titleEl.style.textShadow = "0 0 12px " + hexToRgba(ct, 0.45);
    titleRuleEl.style.background = "linear-gradient(90deg, " + ct + ", transparent)";
    titleRuleEl.style.boxShadow = "0 0 8px " + hexToRgba(ct, 0.45);
    // 底部进度条
    var cb = partColor("bars");
    Array.prototype.forEach.call(barsEl.children, function (s) {
      s.style.background = cb;
      s.style.boxShadow = "0 0 6px " + hexToRgba(cb, 0.45);
    });
    // 四角框
    var cc = hexToRgba(partColor("corner"), 0.45);
    Array.prototype.forEach.call(document.querySelectorAll(".corner"), function (el) {
      el.style.borderColor = cc;
    });
    // 网格地台（需重建）
    buildGrids();
    // 扫描线
    scanEl.style.background = "repeating-linear-gradient(0deg, transparent 0 3px, " +
      hexToRgba(partColor("scan"), 0.02) + " 3px 4px)";
    // 状态条
    var cst = partColor("status");
    statusEl.style.color = hexToRgba(cst, 0.45);
    statusEl.style.textShadow = "0 0 8px " + hexToRgba(cst, 0.18);
    // 控制面板（覆盖 --ui 系变量：面板/输入框/拖放提示等 App 界面）
    var cp = partColor("panel");
    var rootStyle = document.documentElement.style;
    rootStyle.setProperty("--ui", cp);
    rootStyle.setProperty("--ui-dim", hexToRgba(cp, 0.8));   // 1.2.4: 0.45 → 0.8 提可读性
    rootStyle.setProperty("--ui-faint", hexToRgba(cp, 0.18));
    rootStyle.setProperty("--ui-line", hexToRgba(cp, 0.4));
    // auto 部件的色块预览跟随当前生效色
    UI_PARTS.forEach(function (part) {
      var els = uiRowEls[part.id];
      if (els && !uiColors[part.id]) els.swatch.value = partColor(part.id);
    });
  }

  function applyPreset(name) {
    if (name === "custom" && !PRESETS.custom) return; // 自定义色尚未设置
    currentPreset = name;
    var p = PRESETS[name];
    // 1.2.2: --holo 系只作用于舞台内 HUD（环/标题/进度条/四角）；面板用固定 --ui 不受影响
    document.documentElement.style.setProperty("--holo", p.css);
    document.documentElement.style.setProperty("--holo-dim", p.css + "73");
    document.documentElement.style.setProperty("--holo-faint", p.css + "2e");
    // 模型线框跟随预设（1.2.3: 与界面部件配色相互独立）
    wireGroup.children.forEach(function (line) {
      line.material.color.setHex(p.main);
    });
    // 1.2.3: 自定义了颜色的部件保持不变，auto 部件跟随预设
    applyUIColors();
  }

  /* ---------- 界面配色面板（1.2.3） ---------- */
  (function buildUIColors() {
    var list = $("uiColorList");
    UI_PARTS.forEach(function (part) {
      var row = document.createElement("div");
      row.className = "uc-row";
      row.innerHTML = '<label>' + part.label + '</label>' +
        '<span class="uc-head"><input type="color" class="uc-swatch" data-part="' + part.id + '" value="' + PRESETS.cyan.css + '"></span>';
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "uc-inp";
      inp.placeholder = "auto 或 #3fb9ff";
      inp.dataset.part = part.id;
      list.appendChild(row);
      list.appendChild(inp);
      uiRowEls[part.id] = { text: inp, swatch: row.querySelector(".uc-swatch") };
    });
    function validHex(v) {
      v = (v || "").trim();
      if (!v || v.toLowerCase() === "auto") return "";
      return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null; // null=非法
    }
    function commit(partId, v) {
      var hex = validHex(v);
      var el = uiRowEls[partId];
      el.text.classList.toggle("bad", hex === null);
      if (hex === null) return;
      if (hex) { uiColors[partId] = hex; el.text.value = hex; }
      else { delete uiColors[partId]; if (!v) el.text.value = ""; } // auto/空 → 清自定义
      el.swatch.value = partColor(partId);
      applyUIColors();
    }
    Object.keys(uiRowEls).forEach(function (id) {
      uiRowEls[id].text.oninput = function () { commit(id, this.value); };
      uiRowEls[id].swatch.oninput = function () {
        uiColors[id] = this.value;
        uiRowEls[id].text.value = this.value;
        uiRowEls[id].text.classList.remove("bad");
        applyUIColors();
      };
    });
    $("btnUIColorReset").onclick = function () {
      uiColors = {};
      Object.keys(uiRowEls).forEach(function (id) {
        uiRowEls[id].text.value = "";
        uiRowEls[id].text.classList.remove("bad");
        uiRowEls[id].swatch.value = PRESETS[currentPreset].css;
      });
      applyUIColors();
    };
  })();

  /* ---------- 渲染方式 / 全彩氛围（1.2.2） ---------- */
  var bloomBase = 0.9; // 辉光滑杆值（氛围关时暂存）
  function refreshAtmo() {
    var atmo = (state.render === "full") ? state.atmo : true;
    bloom.strength = atmo ? bloomBase : 0;
    scene.fog.density = atmo ? 0.055 : 0;
  }
  function applyRender() {
    wireGroup.visible = (state.render === "wire");
    fullGroup.visible = (state.render === "full");
    $("wireOnly").style.display = (state.render === "wire") ? "" : "none";
    $("fullOnly").style.display = (state.render === "full") ? "" : "none";
    refreshAtmo();
  }

  /* ---------- ammo.js（1.3.0：MMD 物理） ---------- */
  var ammoReady = false, ammoPromise = null;
  function ensureAmmo() {
    if (ammoReady) return Promise.resolve(true);
    if (ammoPromise) return ammoPromise;
    if (typeof window.Ammo !== "function") return Promise.resolve(false); // script 未加载
    // WKWebView 禁止 fetch(file://)，wasm 字节经 holo:// 自定义 scheme 取回
    var wasmURL = libBaseURL() + "ammo.wasm.wasm";
    ammoPromise = fetch(wasmURL)
      .then(function (r) { if (!r.ok) throw new Error("ammo wasm " + r.status); return r.arrayBuffer(); })
      // 注意：bundle 内是严格模式，裸调 Ammo() 的 this 为 undefined；
      // 必须写成 window.Ammo(...) 让 emscripten 内部的 this.Ammo = instance 能挂上全局
      .then(function (buf) { return window.Ammo({ wasmBinary: new Uint8Array(buf) }); })
      .then(function () {
        ammoReady = !!(window.Ammo && window.Ammo.btVector3);
        var cb = $("inpPhys");
        if (cb) { cb.disabled = !ammoReady; if (!ammoReady) cb.checked = false; }
        // 就绪提示：用户据此判断「物理模拟」开关为何可用 / 不可用
        if (ammoReady && !state.fileName) {
          statusEl.textContent = "READY — 物理引擎已就绪（ammo.js）— 拖入 PMX / PMD 后可开启物理";
        }
        return ammoReady;
      })
      .catch(function () {
        ammoReady = false;
        var cb = $("inpPhys");
        if (cb) { cb.disabled = true; cb.checked = false; }
        return false;
      });
    return ammoPromise;
  }

  /* ---------- PMX/PMD：MMDAnimationHelper 接管 IK + grant + 物理（1.3.0） ---------- */
  var mmdHelper = null, mmdMesh = null, mmdVmdClip = null, mmdVmdName = "";
  var pendingVmdUrl = "", pendingVmdName = ""; // 模型尚未载入时先记住拖入的 .vmd

  function mmdObjects() {
    if (!mmdHelper || !mmdMesh) return null;
    var o = mmdHelper.objects.get(mmdMesh);
    return (o && o.physics) ? o : null;
  }
  function applyPhysicsParams() {
    var o = mmdObjects();
    if (!o) return;
    o.physics.setGravity(new THREE.Vector3(0, -9.8 * 10 * state.physGravity, 0));
    // 强度：步长越细 + 子步越多 → 模拟越硬、越贵
    o.physics.unitStep = (1 / 65) / state.physStrength;
    o.physics.maxStepNum = Math.max(1, Math.round(3 * state.physStrength));
  }
  function applyPhysics() {
    if (!mmdHelper) return;
    mmdHelper.enable("physics", !!(state.physOn && ammoReady));
    applyPhysicsParams();
  }
  /** 按当前 state 重建 helper（切换物理开关 / 挂上新 VMD 时调用） */
  function rebuildMMD() {
    if (mmdHelper && mmdMesh) { try { mmdHelper.remove(mmdMesh); } catch (e) { /* 忽略 */ } }
    mmdHelper = null; mixer = null; animAction = null;
    if (!mmdMesh) return;
    var usePhys = !!(state.physOn && ammoReady);
    var helper = new MMDAnimationHelper({ sync: false, resetPhysicsOnLoop: true });
    var p = { physics: usePhys };
    if (usePhys) p.warmup = 10; // 默认 60 步首帧会明显顿一下
    if (mmdVmdClip) p.animation = mmdVmdClip;
    helper.add(mmdMesh, p);
    mmdHelper = helper;
    var objs = helper.objects.get(mmdMesh);
    mixer = objs ? objs.mixer : null;
    animClips = mmdVmdClip ? [mmdVmdClip] : [];
    animClipIdx = 0; animAction = null;
    refreshAnimUI();
    applyPhysicsParams();
  }
  /** 载入 VMD 动作（由原生层拖入 .vmd 时调用） */
  function loadVMD(url, name) {
    if (!mmdMesh) {
      // 还没有 PMX/PMD：先排队，模型载入后自动套用
      pendingVmdUrl = url; pendingVmdName = name || "";
      hideError();
      statusEl.textContent = "VMD 已排队（" + String(name || "").toUpperCase() + "）—— 拖入 PMX / PMD 后自动套用";
      return;
    }
    hideError();
    statusEl.textContent = "LOADING VMD " + String(name || "").toUpperCase() + " ...";
    new MMDLoader().loadAnimation(url, mmdMesh, function (clip) {
      mmdVmdClip = clip; mmdVmdName = name || "";
      state.vmdUrl = url; state.vmdName = mmdVmdName;
      rebuildMMD();
      var el = $("mmdHint");
      if (el) el.textContent = "动作已套用：" + mmdVmdName + (mmdVmdClip.duration ? "（" + mmdVmdClip.duration.toFixed(1) + "s）" : "");
      statusEl.textContent = "VMD " + String(name || "").toUpperCase() + " — 已套用（" + animClips.length + " 段）";
    }, undefined, function (e) {
      showError("VMD 载入失败: " + (e && e.message ? e.message : e));
    });
  }
  window.holoLoadVMD = loadVMD;

  /* ---------- 骨骼动画播放（1.2.4：GLB/glTF/FBX 自带动画） ---------- */
  var mixer = null, animClips = [], animAction = null, animClipIdx = 0;
  var anim = { paused: false, speed: 1, loop: "repeat", scrubbing: false };
  /** 按 animClips 刷新动画面板（普通模型与 PMX 共用） */
  function refreshAnimUI() {
    var ui = $("animUI"), hint = $("animHint"), mmd = $("mmdUI");
    var isMMD = !!mmdMesh;
    if (mmd) mmd.style.display = isMMD ? "" : "none";
    if (!animClips.length) {
      ui.style.display = "none";
      if (hint) {
        hint.style.display = "";
        hint.textContent = isMMD
          ? "当前 PMX 无动作数据 —— 拖入 .vmd 文件即可播放"
          : "当前模型无动画数据";
      }
      return;
    }
    var sel = $("selClip");
    sel.innerHTML = "";
    animClips.forEach(function (c, i) {
      var op = document.createElement("option");
      op.value = i;
      op.textContent = ((c.name || (isMMD ? "VMD " + mmdVmdName : "clip " + (i + 1))) + "").substring(0, 28);
      sel.appendChild(op);
    });
    sel.onchange = function () { playAnimClip(+this.value); };
    anim.paused = false; anim.speed = 1; anim.loop = "repeat";
    $("inpASpeed").value = 100; $("valASpeed").textContent = "1.0";
    $("inpAProg").value = 0; $("valAProg").textContent = "0%";
    $("valLoop").textContent = "循环";
    $("btnPlay").textContent = "暂停";
    ui.style.display = ""; hint.style.display = "none";
    playAnimClip(0);
  }
  var LOOP_MODES = [
    ["repeat", "循环", THREE.LoopRepeat],
    ["once", "单次", THREE.LoopOnce],
    ["pingpong", "往返", THREE.LoopPingPong]
  ];
  function setupAnimations(object3D, clips, kind) {
    mmdHelper = null; mixer = null; animClips = []; animAction = null; animClipIdx = 0;
    if (kind === "mmd" && object3D && object3D.isSkinnedMesh) {
      // PMX/PMD：交给 MMDAnimationHelper（IK / grant / 物理），动作来源于拖入的 .vmd
      mmdMesh = object3D;
      mmdVmdClip = null; mmdVmdName = ""; state.vmdUrl = ""; state.vmdName = "";
      rebuildMMD();
      var mh = $("mmdHint");
      if (mh) mh.textContent = "拖入 .vmd 文件可套用动作（MikuMikuDance 动作数据）";
      if (pendingVmdUrl) { // 排队中的动作立即套用
        var pu = pendingVmdUrl, pn = pendingVmdName;
        pendingVmdUrl = ""; pendingVmdName = "";
        loadVMD(pu, pn);
      }
      // 首次加载时 ammo 可能仍在预热；就绪后补上物理（已有物理对象则跳过，避免重置进度）
      if (!ammoReady) ensureAmmo().then(function () {
        if (mmdMesh && state.physOn && !mmdObjects()) rebuildMMD();
      });
      return;
    }
    mmdMesh = null; mmdVmdClip = null; mmdVmdName = "";
    if (!object3D || !clips || !clips.length) { refreshAnimUI(); return; }
    mixer = new THREE.AnimationMixer(object3D);
    animClips = clips;
    refreshAnimUI();
  }
  function playAnimClip(idx) {
    if (!mixer || !animClips[idx]) return;
    mixer.stopAllAction();
    animClipIdx = idx;
    var clip = animClips[idx];
    var modeDef = LOOP_MODES.filter(function (m) { return m[0] === anim.loop; })[0] || LOOP_MODES[0];
    var a = mixer.clipAction(clip);
    a.setLoop(modeDef[2], modeDef[0] === "once" ? 1 : Infinity);
    a.clampWhenFinished = true;
    a.enabled = true;
    a.paused = anim.paused;
    a.play();
    animAction = a;
    $("valClip").textContent = (idx + 1) + "/" + animClips.length;
  }
  $("btnPlay").onclick = function () {
    anim.paused = !anim.paused;
    this.textContent = anim.paused ? "播放" : "暂停";
    if (animAction) animAction.paused = anim.paused;
  };
  $("inpASpeed").oninput = function () {
    anim.speed = +this.value / 100;
    $("valASpeed").textContent = anim.speed.toFixed(1);
    if (mixer) mixer.timeScale = anim.speed;
  };
  $("btnLoop").onclick = function () {
    var i = 0;
    LOOP_MODES.forEach(function (m, k) { if (m[0] === anim.loop) i = k; });
    var next = LOOP_MODES[(i + 1) % LOOP_MODES.length];
    anim.loop = next[0];
    $("valLoop").textContent = next[1];
    playAnimClip(animClipIdx);
  };
  $("inpAProg").oninput = function () {
    anim.scrubbing = true;
    if (!mixer || !animAction) return;
    var clip = animClips[animClipIdx];
    animAction.time = (+this.value / 1000) * clip.duration;
    if (mmdHelper) mmdHelper.update(0);       // 1.3.0：PMX 需经 helper 应用 IK/物理
    else if (anim.paused) mixer.update(0); // 暂停时手动采样一帧应用姿态
  };
  $("inpAProg").onchange = function () { anim.scrubbing = false; };

  /* ---------- 舞台快捷切换条（1.2.4） ---------- */
  var QUICK_RATIOS = ["16:9", "3:2", "4:3", "1:1", "9:16"];
  var QUICK_RESS = [["720", "720p"], ["1080", "1080p"], ["1440", "2K"], ["2160", "4K"]];
  (function buildQuickBar() {
    var qr = $("qRatios"), qn = $("qRes");
    function mkChip(parent, v, label) {
      var s = document.createElement("span");
      s.className = "qChip"; s.dataset.v = v; s.textContent = label;
      s.onclick = function () {
        if (parent === qr) { $("selRatio").value = v; $("ratioCustom").style.display = "none"; $("selRatio").dispatchEvent(new Event("change")); }
        else { $("selRes").value = v; $("resCustom").style.display = "none"; $("selRes").dispatchEvent(new Event("change")); }
        syncQuickBar();
      };
      parent.appendChild(s);
    }
    QUICK_RATIOS.forEach(function (r) { mkChip(qr, r, r); });
    QUICK_RESS.forEach(function (r) { mkChip(qn, r[0], r[1]); });
  })();
  function syncQuickBar() {
    var rv = $("selRatio").value, nv = $("selRes").value;
    Array.prototype.forEach.call(document.querySelectorAll("#qRatios .qChip"), function (c) {
      c.classList.toggle("on", c.dataset.v === rv);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#qRes .qChip"), function (c) {
      c.classList.toggle("on", c.dataset.v === nv);
    });
  }
  var quickBar = $("quickBar"), qTimer = null;
  function pokeQuickBar(ms) {
    quickBar.classList.remove("off");
    if (qTimer) clearTimeout(qTimer);
    qTimer = setTimeout(function () { quickBar.classList.add("off"); }, ms || 2000);
  }
  stageEl.addEventListener("mousemove", function () { pokeQuickBar(2000); });
  stageEl.addEventListener("mouseleave", function () { pokeQuickBar(700); });
  quickBar.addEventListener("mouseenter", function () { if (qTimer) clearTimeout(qTimer); quickBar.classList.remove("off"); });
  quickBar.addEventListener("mouseleave", function () { pokeQuickBar(900); });
  syncQuickBar();

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
    bloomBase = +this.value / 10; $("valBloom").textContent = bloomBase.toFixed(1);
    refreshAtmo();
  };
  $("inpScale").oninput = function () {
    state.scale = +this.value / 100; $("valScale").textContent = (+this.value / 100).toFixed(1);
    if (srcMeshes.length) normalizeModel();
  };
  $("inpZup").onchange = function () {
    state.zup = this.checked;
    if (srcMeshes.length) { normalizeModel(); buildWireframe(); }
  };
  // 重置变换（1.2.3）：缩放/位移/Z 轴朝上/自转角度归零，滑杆同步回弹
  $("btnReset").onclick = function () {
    state.scale = 1; state.pos = { x: 0, y: 0, z: 0 };
    state.zup = false;
    modelRoot.rotation.y = 0;
    $("inpScale").value = 100; $("valScale").textContent = "1.0";
    ["PX", "PY", "PZ"].forEach(function (k) {
      $("inp" + k).value = 0;
      $("valP" + k.charAt(1)).textContent = "0.00";
    });
    $("inpZup").checked = false;
    if (srcMeshes.length) normalizeModel();
    statusEl.textContent = "TRANSFORM RESET";
  };
  $("inpSpeed").oninput = function () {
    state.speed = +this.value / 10; $("valSpeed").textContent = (+this.value / 10).toFixed(1);
  };
  $("inpGrid").onchange = function () { gridGroup.visible = this.checked; };
  // 程序化动作（1.2.4）
  $("inpBob").onchange = function () {
    state.bobOn = this.checked;
    if (!state.bobOn) modelRoot.position.y = modelBaseY;
  };
  $("inpBobAmp").oninput = function () {
    state.bobAmp = +this.value / 100;
    $("valBobAmp").textContent = state.bobAmp.toFixed(1);
  };
  $("inpParallax").onchange = function () {
    state.parallaxOn = this.checked;
    if (!state.parallaxOn) modelRoot.rotation.z = 0;
  };
  // 待机摆动（1.2.10）：轻微左右摇摆/倾斜，可与其他动作叠加
  $("inpSway").onchange = function () { state.swayOn = this.checked; };
  $("inpSwayAmp").oninput = function () {
    state.swayAmp = +this.value / 100;
    $("valSwayAmp").textContent = state.swayAmp.toFixed(1);
  };
  // 物理（1.3.0）：仅 PMX/PMD 有效；Ammo 未就绪时复选框禁用
  $("inpPhys").disabled = true;
  $("inpPhys").onchange = function () {
    state.physOn = this.checked;
    if (!mmdMesh) return;
    // 首次开启需重建 helper 才会创建物理对象；之后仅需切换 enabled，动画进度不重置
    if (state.physOn && ammoReady && !mmdObjects()) rebuildMMD();
    else applyPhysics();
  };
  $("inpPhysG").oninput = function () {
    state.physGravity = +this.value / 100;
    $("valPhysG").textContent = state.physGravity.toFixed(1);
    applyPhysicsParams();
  };
  $("inpPhysS").oninput = function () {
    state.physStrength = +this.value / 100;
    $("valPhysS").textContent = state.physStrength.toFixed(1);
    applyPhysicsParams();
  };
  ensureAmmo(); // 启动即预热，PMX 载入时通常已就绪
  // 隐藏环中心点（1.2.10）：刻度盘/魔法阵中央圆点，自由(SVG)+经典(3D)均生效
  $("inpHideDot").onchange = function () {
    state.hideCenterDot = this.checked;
    ringWraps.forEach(function (wrap, i) {
      wrap.innerHTML = buildRingSVG(state.rings[i].style, i + 1, state.hideCenterDot);
    });
    rebuildRing3D();
  };
  $("inpPulse").onchange = function () {
    state.pulseOn = this.checked;
    if (!state.pulseOn) refreshAtmo();
  };
  $("inpHud").onchange = function () {
    $("hud").style.display = this.checked ? "" : "none";
    applyRings(); // 1.2.7: 同步 3D 环可见性
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
  // 配色下拉（1.2；1.2.10 加自定义 #RRGGBB）
  $("selPreset").onchange = function () {
    $("customColorRow").style.display = this.value === "custom" ? "" : "none";
    applyPreset(this.value);
  };
  function applyCustomColor(hex) {
    hex = (hex || "").trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) { statusEl.textContent = "无效颜色（需 #RRGGBB 格式）"; return; }
    state.customColor = hex;
    $("inpCustomPick").value = hex;
    $("inpCustomHex").value = hex;
    PRESETS.custom = { main: parseInt(hex.slice(1), 16), css: hex,
      g1: shadeHex(hex, 0.62), g2: shadeHex(hex, 0.30) };
    applyPreset("custom");
    statusEl.textContent = "配色: CUSTOM " + hex.toUpperCase();
  }
  $("inpCustomHex").onchange = function () { applyCustomColor(this.value); };
  $("inpCustomPick").oninput = function () { applyCustomColor(this.value); };
  // 渲染方式 / 全彩氛围（1.2.2）
  $("selRender").onchange = function () { state.render = this.value; applyRender(); };
  $("inpAtmo").onchange = function () { state.atmo = this.checked; refreshAtmo(); };
  // 平滑法线（1.2.9）：几何处理发生在载入时，切换后重载当前模型立即生效
  $("inpSmooth").checked = state.smoothNormals;
  $("inpSmooth").onchange = function () {
    state.smoothNormals = this.checked;
    if (state.lastLoad && srcMeshes.length) {
      statusEl.textContent = "RELOADING WITH " + (this.checked ? "SMOOTH" : "FLAT") + " NORMALS ...";
      loadModel(state.lastLoad.url, state.lastLoad.name);
    }
  };
  // 三环控制（1.2；1.2.5 加偏航角 w 与样式切换）
  Array.prototype.forEach.call(document.querySelectorAll(".ringCtl"), function (el) {
    el.oninput = function () {
      var n = +this.dataset.ring, k = this.dataset.k;
      state.rings[n - 1][k] = +this.value;
      var idMap = { x: "valR" + n + "X", y: "valR" + n + "Y", s: "valR" + n + "S", p: "valR" + n + "P", r: "valR" + n + "R", w: "valR" + n + "W" };
      $(idMap[k]).textContent = (k === "p" || k === "r" || k === "w") ? this.value + "°" : this.value;
      applyRings();
    };
  });
  // 环样式下拉（1.2.5）
  Array.prototype.forEach.call(document.querySelectorAll(".ringStyle"), function (sel) {
    RING_STYLES().forEach(function (s) {
      var op = document.createElement("option");
      op.value = s[0]; op.textContent = s[1];
      sel.appendChild(op);
    });
    sel.value = state.rings[+sel.dataset.ring - 1].style;
    sel.onchange = function () {
      var n = +this.dataset.ring;
      state.rings[n - 1].style = this.value;
      ringWraps[n - 1].innerHTML = buildRingSVG(this.value, n, state.hideCenterDot);
      rebuildRing3D(); // 1.2.7: 经典模式下换样式要重建 3D 环纹理
    };
  });
  // 环模式（1.2.7）：自由变换 / 经典 1.0（3D 场景环）
  $("selRingMode").value = state.ringMode;
  $("selRingMode").onchange = function () {
    state.ringMode = this.value;
    rebuildRing3D();
    statusEl.textContent = (this.value === "classic") ? "RING MODE: CLASSIC 1.0 (3D)" : "RING MODE: FREE";
  };
  // 环心（1.2.8）：模型中点 / 世界中心（仅经典模式生效）
  $("selRingAnchor").value = state.ringAnchor;
  $("selRingAnchor").onchange = function () {
    state.ringAnchor = this.value;
    statusEl.textContent = (this.value === "model") ? "RING ANCHOR: MODEL MID" : "RING ANCHOR: WORLD";
  };
  // 环组重置（1.2.5）：位置/大小/俯仰/偏航/滚转回默认（保留样式）
  Array.prototype.forEach.call(document.querySelectorAll(".rstRing"), function (btn) {
    btn.onclick = function (e) {
      e.preventDefault(); e.stopPropagation(); // 阻止 details 折叠
      var n = +this.dataset.ring;
      var def = RING_DEFAULTS[n - 1];
      ["x", "y", "s", "p", "r", "w"].forEach(function (k) {
        state.rings[n - 1][k] = def[k];
        var inp = document.querySelector('.ringCtl[data-ring="' + n + '"][data-k="' + k + '"]');
        if (inp) inp.value = def[k];
        var idMap = { x: "valR" + n + "X", y: "valR" + n + "Y", s: "valR" + n + "S", p: "valR" + n + "P", r: "valR" + n + "R", w: "valR" + n + "W" };
        $(idMap[k]).textContent = (k === "p" || k === "r" || k === "w") ? def[k] + "°" : def[k];
      });
      applyRings();
      statusEl.textContent = "RING " + n + " RESET";
    };
  });
  // 场景组重置（1.2.5）
  $("btnSceneReset").onclick = function () {
    state.speed = 0.5; $("inpSpeed").value = 5; $("valSpeed").textContent = "0.5";
    state.bobOn = true; $("inpBob").checked = true;
    state.bobAmp = 1.0; $("inpBobAmp").value = 100; $("valBobAmp").textContent = "1.0";
    state.parallaxOn = false; $("inpParallax").checked = false; modelRoot.rotation.z = 0;
    state.swayOn = false; $("inpSway").checked = false;
    state.swayAmp = 1.0; $("inpSwayAmp").value = 100; $("valSwayAmp").textContent = "1.0";
    // 物理（1.3.0）回到默认：关闭 + 重力/强度 100%
    state.physOn = false; $("inpPhys").checked = false;
    state.physGravity = 1.0; $("inpPhysG").value = 100; $("valPhysG").textContent = "1.0";
    state.physStrength = 1.0; $("inpPhysS").value = 100; $("valPhysS").textContent = "1.0";
    applyPhysics();
    state.pulseOn = false; $("inpPulse").checked = false; refreshAtmo();
    gridGroup.visible = true; $("inpGrid").checked = true;
    $("hud").style.display = ""; $("inpHud").checked = true;
    applyRings();
    statusEl.textContent = "SCENE RESET";
  };
  // 画面比例 / 导出分辨率（1.2）
  $("selRatio").onchange = function () {
    $("ratioCustom").style.display = this.value === "custom" ? "flex" : "none";
    resize();
    syncQuickBar();
  };
  ["ratioW", "ratioH"].forEach(function (id) {
    $(id).oninput = function () { if ($("selRatio").value === "custom") resize(); };
  });
  $("selRes").onchange = function () {
    $("resCustom").style.display = this.value === "custom" ? "flex" : "none";
    syncQuickBar();
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
    // 1.3.1 修复：导出期间把像素比压到 1，让 canvas 缓冲区严格等于导出尺寸。
    // 原实现沿用屏幕像素比（Retina = 2），缓冲区变成 2×；而 gif.js 的取像素逻辑是
    // getImageData(0, 0, options.width, options.height)，只截左上 1/(pr²) 区域 → GIF 显示不全。
    // 压到 1 后 gif 取到整幅，PNG 序列/单帧的实际像素也与状态栏标称分辨率一致。
    var pr = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    work(function () {
      renderer.setPixelRatio(pr); // 恢复屏幕显示用的像素比
      resize();
    });
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
    var h = $("btnHtml"); h.disabled = false; h.textContent = "导出网页 HTML（单文件）";
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

  /* ---------- 导出单文件网页 HTML（1.2.5 完整版） ---------- */
  function b64FromBytes(bytes) {
    var bin = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  /* ---------- 导出烘焙（1.3.0）：把 VMD 动作 + 物理逐帧采样成骨骼关键帧 ----------
   * 导出的单文件网页不带 ammo（体积 +1MB 且需 wasm），改为把 IK/grant/物理的
   * 最终骨骼姿态直接烘焙进 GLB 动画轨道，查看器照常播放。 */
  function trackMoved(arr, stride) {
    for (var i = stride; i < arr.length; i += stride) {
      for (var k = 0; k < stride; k++) {
        if (Math.abs(arr[i + k] - arr[k]) > 1e-5) return true;
      }
    }
    return false;
  }
  function bakeMMDClip() {
    if (!mmdHelper || !mmdMesh || !mmdVmdClip) return null;
    var sk = mmdMesh.skeleton;
    if (!sk || !sk.bones || !sk.bones.length) return null;
    var duration = mmdVmdClip.duration || 0;
    if (!(duration > 0)) return null;
    var bones = sk.bones;
    var n = Math.min(900, Math.max(2, Math.round(duration * 30))); // 30fps 上限 900 帧（30s）
    var dt = duration / n;
    var times = new Float32Array(n + 1);
    var pos = [], quat = [];
    bones.forEach(function () { pos.push(new Float32Array((n + 1) * 3)); quat.push(new Float32Array((n + 1) * 4)); });
    var savedTime = animAction ? animAction.time : 0;
    var ph = mmdObjects();
    if (ph) ph.physics.reset();              // 物理从稳定初始态开始采样
    if (animAction) animAction.time = 0;
    mmdHelper.update(0);
    for (var f = 0; f <= n; f++) {
      times[f] = f * dt;
      for (var bi = 0; bi < bones.length; bi++) {
        var b = bones[bi];
        pos[bi][f * 3] = b.position.x; pos[bi][f * 3 + 1] = b.position.y; pos[bi][f * 3 + 2] = b.position.z;
        quat[bi][f * 4] = b.quaternion.x; quat[bi][f * 4 + 1] = b.quaternion.y;
        quat[bi][f * 4 + 2] = b.quaternion.z; quat[bi][f * 4 + 3] = b.quaternion.w;
      }
      mmdHelper.update(dt);                   // 同步循环，期间不会插入 rAF
    }
    if (animAction) animAction.time = savedTime;
    mmdHelper.update(0);                     // 把画面拨回导出前的进度
    var tracks = [];
    for (var k = 0; k < bones.length; k++) {
      var nm = bones[k].name;
      if (!nm || nm.indexOf(".") >= 0 || nm.indexOf("[") >= 0) continue; // 轨道名含分隔符无法绑定
      if (trackMoved(pos[k], 3)) tracks.push(new THREE.VectorKeyframeTrack(nm + ".position", times, pos[k]));
      if (trackMoved(quat[k], 4)) tracks.push(new THREE.QuaternionKeyframeTrack(nm + ".quaternion", times, quat[k]));
    }
    if (!tracks.length) return null;
    return new THREE.AnimationClip("vmd_baked", duration, tracks);
  }
  $("btnHtml").onclick = function () {
    var btn = this;
    if (exporting || !srcMeshes.length) return;
    exporting = true; btn.disabled = true; btn.textContent = "网页生成中...";
    statusEl.textContent = "EXPORTING HTML ...";
    var src = fullGroup.children[0];
    if (!src) { finishExport("导出失败：无模型"); return; }
    // 导出根：原对象（保留蒙皮/动画），临时摘出并烘焙 modelRoot 变换（不含自转，查看器自转）
    var exportRoot = new THREE.Group();
    exportRoot.add(src); // 自动从 fullGroup 摘出，稍后放回
    exportRoot.position.set(modelRoot.position.x, modelBaseY, modelRoot.position.z);
    exportRoot.scale.copy(modelRoot.scale);
    exportRoot.rotation.set(modelRoot.rotation.x, 0, modelRoot.rotation.z);
    var cfg = {
      v: 1, title: titleEl.textContent || "HOLOSTAGE", mode: state.render,
      preset: { css: PRESETS[currentPreset].css, main: PRESETS[currentPreset].main, g1: PRESETS[currentPreset].g1 },
      ui: uiColors,
      speed: state.speed, bobOn: state.bobOn, bobAmp: state.bobAmp, parallax: state.parallaxOn,
      swayOn: state.swayOn, swayAmp: state.swayAmp, hideDot: state.hideCenterDot, // 1.2.10
      physOn: state.physOn, physGravity: state.physGravity, physStrength: state.physStrength, // 1.3.0
      vmd: state.vmdName || "",           // 1.3.0: 已套用的 VMD 名称（查看器提示用）
      pulse: state.pulseOn, bloom: bloomBase, atmo: state.atmo,
      grid: gridGroup.visible, hud: $("inpHud").checked,
      anim: !!(mixer && animClips.length),
      rings: state.rings.map(function (r) { return { style: r.style, x: r.x, y: r.y, s: r.s, p: r.p, r: r.r, w: r.w }; }),
      ringMode: state.ringMode,
      ringAnchor: state.ringAnchor
    };
    // 1.3.0: PMX 场景先把 VMD 动作 + 物理逐帧烘焙成骨骼关键帧，随 GLB 一起走
    var exportClips = animClips.slice();
    if (mmdHelper && mmdMesh && mmdVmdClip) {
      statusEl.textContent = "BAKING MMD ANIMATION ...";
      var baked = null;
      try { baked = bakeMMDClip(); } catch (e) { baked = null; }
      if (baked) exportClips = [baked];
    }
    cfg.anim = !!exportClips.length;
    var name = (state.fileName.replace(/\.[^.]+$/, "") || "holo") + "_holo.html";
    new GLTFExporter().parse(exportRoot, function (glb) {
      fullGroup.add(src); // 放回
      var glbB64 = b64FromBytes(new Uint8Array(glb));
      var viewerURL = location.pathname.replace(/[^/]*$/, "") + "lib/viewer.js";
      if (bridge) viewerURL = "holo://f/" + encodeURI(viewerURL).replace(/#/g, "%23").replace(/\?/g, "%3F");
      fetch(viewerURL).then(function (r) { return r.text(); }).then(function (viewerJS) {
        var html = '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>' +
          escapeHtml(cfg.title) + ' — HoloStage</title>' +
          '<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;}</style>' +
          '</head><body>\n<script>window.HOLO_EXPORT=' + JSON.stringify(cfg) + ';window.HOLO_GLB="' + glbB64 + '";<\/script>\n' +
          '<script>' + viewerJS + '<\/script>\n</body></html>';
        if (bridge) {
          var htmlB64 = b64FromBytes(new TextEncoder().encode(html));
          bridge.postMessage({ type: "saveHtml", data: htmlB64, name: name });
        } else {
          downloadData(URL.createObjectURL(new Blob([html], { type: "text/html" })), name);
        }
        finishExport("网页已导出: " + name + "（浏览器直接打开）");
      }).catch(function (e) { fullGroup.add(src); finishExport("导出失败: " + e.message); });
    }, function (err) {
      fullGroup.add(src);
      finishExport("导出失败: " + (err && err.message ? err.message : err));
    }, { binary: true, animations: exportClips });
  };

  function downloadData(url, name) {
    var a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  }

  /* ---------- 尺寸与主循环 ---------- */
  window.addEventListener("resize", resize);
  resize();
  rebuildRing3D(); // 1.2.7: 首次构建 3D 全息环（默认经典模式关闭时不可见，切换即用）

  var last = performance.now();
  var spinAngle = 0, tAcc = 0;
  var mousePar = { x: 0, y: 0 };
  window.addEventListener("mousemove", function (e) {
    var r = stageEl.getBoundingClientRect();
    mousePar.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    mousePar.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
  });
  /* 相机交互（1.2.6）：滚轮缩放 / 左键拖动视角 / 右键复位 */
  stageEl.addEventListener("wheel", function (e) {
    e.preventDefault();
    camDist *= (e.deltaY > 0 ? 1.08 : 1 / 1.08);
    camDist = Math.max(1.2, Math.min(14, camDist));
    updateCamera();
  }, { passive: false });
  var camDrag = null;
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
    statusEl.textContent = "CAMERA RESET";
  });
  (function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min((now - last) / 1000, 0.1); last = now;
    tAcc += dt;
    // 骨骼动画（1.2.4）：导出时也持续采样，帧序列里动画随旋转同步演进
    // 1.3.0：PMX 走 MMDAnimationHelper，内部按 mixer → IK/grant → physics 顺序推进
    if (mmdHelper) { if (!anim.scrubbing) mmdHelper.update(dt); }
    else if (mixer && !anim.scrubbing) mixer.update(dt);
    if (mixer && animAction && !anim.scrubbing) {
      var clip = animClips[animClipIdx];
      var p = clip.duration ? Math.min(1, animAction.time / clip.duration) : 0;
      $("inpAProg").value = Math.round(p * 1000);
      $("valAProg").textContent = Math.round(p * 100) + "%";
    }
    if (!exporting) {
      spinAngle += state.speed * dt;
      var yaw = spinAngle, roll = 0;
      if (state.parallaxOn) { yaw += mousePar.x * 0.22; roll = mousePar.y * 0.1; }
      if (state.swayOn) { // 1.2.10: 待机摆动（慢频摇摆 + 轻微侧倾）
        yaw += Math.sin(tAcc * 0.8) * 0.06 * state.swayAmp;
        roll += Math.sin(tAcc * 0.6) * 0.035 * state.swayAmp;
      }
      modelRoot.rotation.y = yaw;
      modelRoot.rotation.z = roll;
      modelRoot.position.y = modelBaseY +
        (state.bobOn ? Math.sin(tAcc * 1.7) * 0.055 * state.bobAmp : 0);
      // 3D 全息环（1.2.8 经典模式）：环心跟随 + 六参数跟手映射 + 平面内自转
      updateRings3D(dt);
    }
    if (state.pulseOn) {
      var atmo = (state.render === "full") ? state.atmo : true;
      bloom.strength = atmo ? bloomBase * (1 + 0.22 * Math.sin(tAcc * 2.3)) : 0;
    }
    composer.render();
  })(last);

  statusEl.textContent = "READY — 滚轮缩放 · 左键拖动视角 · 右键复位 — 拖入 STL / OBJ / glTF / GLB / PLY / FBX / PMX / USDZ / ZIP（PMX 可再拖 .vmd 动作）";
})();

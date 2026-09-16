/* HoloStage 1.3.5.10(b33) — 本地自动绑骨（Mixamo 式分步拖标记）
 *
 * b33 按用户 Mixamo 截图重做交互：
 *   ① 纯净视口 —— 进入绑骨时临时隐藏全息装饰（动态背景/网格/呼吸/HUD/右侧面板），
 *      scene.background 换浅灰，另加一层中性地面网格；退出时全部还原。
 *   ② 自动取景 —— 按模型包围盒把相机移到正面平视、模型占屏 ~75%。
 *   ③ 可旋转缩放 —— 覆盖层通透（pointer-events:none，只有标记/按钮接事件），
 *      stageEl 既有 orbit（左键旋转/滚轮缩放/右键复位）直接可用。
 *   ④ 分步向导 —— Mixamo 五步：下巴 → 手腕 → 手肘 → 膝盖 → 裆部；每步只显示
 *      当前标记（脉动）与已完成标记（变暗），顶部一句话提示。
 *
 * 生成骨架/蒙皮逻辑与 b32 相同：标记与关节全部存 modelRoot 局部空间；
 * 骨架挂 fullGroup 下 Bone 根；蒙皮 attached 模式（父链是静态组节点）。
 *
 * 本模块不依赖 app.module 内部状态，全部经 ctx 注入：
 *   { camera, container, group(fullGroup), root(modelRoot), onBuilt(summary), onMsg(text) }
 */

import * as THREE from "three";

var ctx = null, active = false, built = false;
var arMeshes = [];             // 本模块创建的蒙皮网格 + 骨根（resetRig 时统一摘除）
var markers = [];              // {key,label,color,pos,el}
var wrapEl = null, dotsEl = null;
var dragMk = null;
var _ray = new THREE.Raycaster();
var _ndc = new THREE.Vector2();
var _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
var _plane = new THREE.Plane();
var _m4 = new THREE.Matrix4();
var savedRender = null;        // 进覆盖层前记住渲染方式，退出时还原
var rafId = 0;

/* 纯净视口（b33）：临时摘掉的舞台装饰与还原信息 */
var clean = null;              // { toggles:[{el,checked}], panelDisp, scene, bg, grid }
var gridHelper = null;
var step = 0;

/* 标记定义（颜色照搬 Mixamo Auto-Rigger 截图） */
var MARKER_DEFS = [
  { key: "chin",   label: "下巴 CHIN",   color: "#35d6e0", tip: "下颌尖" },
  { key: "wristR", label: "手腕 WRISTS", color: "#b5e352", tip: "右腕" },
  { key: "wristL", label: null,          color: "#b5e352", tip: "左腕（对称自动）" },
  { key: "elbowR", label: "手肘 ELBOWS", color: "#f0d24a", tip: "右肘" },
  { key: "elbowL", label: null,          color: "#f0d24a", tip: "左肘（对称自动）" },
  { key: "kneeR",  label: "膝盖 KNEES",  color: "#f5a623", tip: "右膝" },
  { key: "kneeL",  label: null,          color: "#f5a623", tip: "左膝（对称自动）" },
  { key: "groin",  label: "裆部 GROIN",  color: "#f06292", tip: "骨盆底" }
];

/* Mixamo 五步向导：每步放一组标记 */
var STEPS = [
  { keys: ["chin"],            text: "把青色圆环拖到下颌尖（头部下方）" },
  { keys: ["wristR", "wristL"], text: "把黄绿圆环拖到左右手腕 — 勾选「利用对称」只需拖右侧" },
  { keys: ["elbowR", "elbowL"], text: "把黄色圆环拖到左右手肘" },
  { keys: ["kneeR", "kneeL"],  text: "把橙色圆环拖到左右膝盖" },
  { keys: ["groin"],           text: "把粉色圆环拖到骨盆底（两腿之间）" }
];

function $(id) { return document.getElementById(id); }
function mk(key) { for (var i = 0; i < markers.length; i++) if (markers[i].key === key) return markers[i]; return null; }

/* ---------- 目标网格收集（静态网格，跳过描边壳 / 已隐藏） ---------- */
function targetMeshes() {
  var out = [];
  ctx.group.traverse(function (o) {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (o.userData && (o.userData.holoOutline || o.userData.holoARHidden)) return;
    if (!o.visible) return;
    out.push(o);
  });
  return out;
}

/* ---------- 包围盒（root 局部空间） ---------- */
function localBBox(meshes) {
  ctx.root.updateMatrixWorld(true);
  _m4.copy(ctx.root.matrixWorld).invert();
  var box = new THREE.Box3();
  meshes.forEach(function (m) {
    var b = new THREE.Box3().setFromObject(m);
    b.applyMatrix4(_m4);
    box.union(b);
  });
  return box;
}

/* ---------- 标记自动预放（按包围盒比例猜，用户可拖准） ---------- */
function autoPlace(box) {
  var size = box.getSize(new THREE.Vector3());
  var min = box.min;
  var H = size.y || 1, W = size.x || 1;
  var set = function (key, x, y, z) {
    var mk0 = mk(key); if (mk0) mk0.pos.set(x, y, z);
  };
  set("chin",   0, min.y + 0.86 * H, 0);
  set("groin",  0, min.y + 0.48 * H, 0);
  set("wristR", W / 2,  min.y + 0.80 * H, 0);
  set("wristL", -W / 2, min.y + 0.80 * H, 0);
  set("elbowR", W * 0.30, min.y + 0.80 * H, 0);
  set("elbowL", -W * 0.30, min.y + 0.80 * H, 0);
  set("kneeR",  W * 0.10, min.y + 0.25 * H, 0);
  set("kneeL",  -W * 0.10, min.y + 0.25 * H, 0);
}

/* ---------- 纯净视口（b33） ---------- */
function getScene() {
  if (ctx && ctx.root && ctx.root.parent) return ctx.root.parent;
  if (window.holoRoot) { var r = window.holoRoot(); if (r && r.parent) return r.parent; }
  return null;
}
function enterClean() {
  clean = { toggles: [], panelDisp: "", scene: null, bg: null, grid: null };
  ["inpBg", "inpGrid", "inpBob", "inpHud", "inpAtmo"].forEach(function (id) {
    // inpAtmo（全彩氛围）关掉 = bloom.strength 0 —— threshold=0 的全屏泛光在浅背景下会把模型洗白
    var e = $(id); if (!e) return;
    clean.toggles.push({ el: e, checked: e.checked });
    if (e.checked) { e.checked = false; e.dispatchEvent(new Event("change")); }
  });
  var panel = $("panel");
  if (panel) { clean.panelDisp = panel.style.display; panel.style.display = "none"; }
  var scene = getScene();
  if (scene) {
    clean.scene = scene;
    clean.bg = scene.background;
    scene.background = new THREE.Color(0xd7dade); // Mixamo 浅灰
    var meshes = targetMeshes();
    var box = localBBox(meshes);
    ctx.root.updateMatrixWorld(true);
    var wb = box.clone().applyMatrix4(ctx.root.matrixWorld);
    var size = wb.getSize(new THREE.Vector3());
    var span = Math.max(size.x, size.y, size.z) * 3 || 6;
    gridHelper = new THREE.GridHelper(span, 12, 0xb9bfc7, 0xd3d7dc);
    gridHelper.position.y = wb.min.y;
    gridHelper.userData.holoARGrid = true; // 自检/清理时与 App 自带网格区分
    scene.add(gridHelper);
    clean.grid = gridHelper;
  }
}
function exitClean() {
  if (!clean) return;
  if (clean.grid) { clean.scene.remove(clean.grid); clean.grid.geometry.dispose(); clean.grid.material.dispose(); }
  gridHelper = null;
  if (clean.scene) clean.scene.background = clean.bg;
  var panel = $("panel");
  if (panel) panel.style.display = clean.panelDisp;
  clean.toggles.forEach(function (t) {
    if (t.checked) { t.el.checked = true; t.el.dispatchEvent(new Event("change")); }
  });
  clean = null;
}

/* ---------- 自动取景（b33）：正面平视、模型占屏 ~75% ---------- */
function fitCamera() {
  var meshes = targetMeshes();
  if (!meshes.length) return;
  var box = localBBox(meshes);
  ctx.root.updateMatrixWorld(true);
  var wb = box.clone().applyMatrix4(ctx.root.matrixWorld);
  var c = wb.getCenter(new THREE.Vector3());
  var size = wb.getSize(new THREE.Vector3());
  var cam = ctx.camera;
  var r = ctx.container.getBoundingClientRect();
  var aspect = (r.width || 1) / (r.height || 1);
  var fov = (cam.fov || 45) * Math.PI / 180;
  var distV = (size.y * 0.5 * 1.32) / Math.tan(fov / 2);
  var distH = (size.x * 0.5 * 1.32) / (Math.tan(fov / 2) * aspect);
  var dist = Math.max(distV, distH, size.z * 1.2, 0.5);
  cam.position.set(c.x, c.y, c.z + dist);
  cam.lookAt(c.x, c.y, c.z);
  cam.updateMatrixWorld(true);
}

/* ---------- DOM ---------- */
function ensureDom() {
  if (wrapEl) return;
  if (!markers.length) {
    markers = MARKER_DEFS.map(function (d) {
      return { key: d.key, label: d.label, color: d.color, tip: d.tip,
               pos: new THREE.Vector3(), el: null };
    });
  }
  wrapEl = document.createElement("div");
  wrapEl.id = "autoRig";
  wrapEl.innerHTML =
    '<div id="arHeader">' +
    '  <span id="arStepNo"></span>' +
    '  <span id="arStepName"></span>' +
    '  <span id="arClose" title="退出绑骨">✕</span>' +
    '</div>' +
    '<div id="arGuide"></div>' +
    '<div id="arDots"></div>' +
    '<div id="arBottom">' +
    '  <button id="btnARBack">‹ 上一步</button>' +
    '  <label id="arSymWrap"><input type="checkbox" id="inpARSym" checked> 利用对称</label>' +
    '  <button id="btnARNext">下一步 ›</button>' +
    '</div>' +
    '<div id="arTools"><button id="btnARFit" title="重新取景">⌖ 取景</button></div>' +
    '<div id="arHint">左键拖动旋转 · 滚轮缩放 · 右键复位视角</div>';
  ctx.container.appendChild(wrapEl);
  dotsEl = $("arDots");
  // 覆盖层内的按下事件不许冒泡到 stageEl（orbit 绑在那里，否则拖标记会带着相机转）
  ["mousedown", "pointerdown", "wheel"].forEach(function (evt) {
    wrapEl.addEventListener(evt, function (e) { e.stopPropagation(); });
  });

  markers.forEach(function (mk0) {
    var d = document.createElement("div");
    d.className = "arDot";
    d.style.borderColor = mk0.color;
    d.title = mk0.tip;
    dotsEl.appendChild(d);
    mk0.el = d;
    d.addEventListener("pointerdown", onDown);
  });
  $("inpARSym").onchange = function () { /* 状态读取在 drag 中进行 */ };
  $("btnARBack").onclick = function () { if (step > 0) setStep(step - 1); else close(); };
  $("arClose").onclick = close;
  $("btnARNext").onclick = function () { if (step < STEPS.length - 1) setStep(step + 1); else build(); };
  $("btnARFit").onclick = fitCamera;
}

/* ---------- 分步向导 ---------- */
function setStep(i) {
  step = i;
  var keys = STEPS[i].keys;
  markers.forEach(function (mk0) {
    var el = mk0.el;
    el.classList.remove("cur", "done", "off");
    if (keys.indexOf(mk0.key) >= 0) el.classList.add("cur");
    else {
      // 已完成步的标记保留显示（变暗缩小），未到的隐藏
      var done = false;
      for (var s = 0; s < i; s++) if (STEPS[s].keys.indexOf(mk0.key) >= 0) { done = true; break; }
      el.classList.add(done ? "done" : "off");
    }
  });
  $("arStepNo").textContent = "步骤 " + (i + 1) + " / " + STEPS.length;
  var def = null;
  markers.forEach(function (mk0) { if (mk0.key === keys[0]) def = mk0; });
  $("arStepName").textContent = def && def.label ? def.label : "";
  $("arGuide").textContent = STEPS[i].text;
  $("btnARNext").textContent = i < STEPS.length - 1 ? "下一步 ›" : "生成骨架 ✓";
  $("btnARBack").style.visibility = i === 0 ? "hidden" : "";
  updateDots();
}

/* ---------- 屏幕投影 ---------- */
function updateDots() {
  if (!active) return;
  var r = ctx.container.getBoundingClientRect();
  ctx.camera.updateMatrixWorld();
  markers.forEach(function (mk0) {
    if (mk0.el.classList.contains("off")) return;
    _v.copy(mk0.pos);
    ctx.root.localToWorld(_v);
    _v.project(ctx.camera);
    if (_v.z > 1) { mk0.el.style.display = "none"; return; }
    mk0.el.style.display = "";
    mk0.el.style.left = ((_v.x * 0.5 + 0.5) * r.width) + "px";
    mk0.el.style.top = ((-_v.y * 0.5 + 0.5) * r.height) + "px";
  });
}
function loop() {
  if (!active) return;
  updateDots();
  rafId = requestAnimationFrame(loop);
}

/* ---------- 拖拽（事件直接挂在标记圆环上，舞台保持通透可旋转） ---------- */
function screenPos(mk0) {
  var r = ctx.container.getBoundingClientRect();
  _v.copy(mk0.pos); ctx.root.localToWorld(_v); _v.project(ctx.camera);
  return { x: (_v.x * 0.5 + 0.5) * r.width, y: (-_v.y * 0.5 + 0.5) * r.height };
}
function onDown(e) {
  var mk0 = null;
  markers.forEach(function (m2) { if (m2.el === e.currentTarget) mk0 = m2; });
  if (!mk0) return;
  e.preventDefault();
  dragMk = mk0;
  mk0.el.setPointerCapture(e.pointerId);
  _v.copy(mk0.pos); ctx.root.localToWorld(_v);
  ctx.camera.getWorldDirection(_v3);
  _plane.setFromNormalAndCoplanarPoint(_v3, _v);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
function onMove(e) {
  if (!dragMk) return;
  var r = ctx.container.getBoundingClientRect();
  _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, ctx.camera);
  if (!_ray.ray.intersectPlane(_plane, _v2)) return;
  ctx.root.worldToLocal(_v2);
  dragMk.pos.copy(_v2);
  var sym = $("inpARSym") ? $("inpARSym").checked : true;
  if (sym) {
    var otherKey = { wristR: "wristL", elbowR: "elbowL", kneeR: "kneeL" }[dragMk.key];
    if (otherKey) {
      var other = mk(otherKey);
      if (other) { other.pos.copy(dragMk.pos); other.pos.x = -other.pos.x; }
    }
  }
  updateDots();
}
function onUp() {
  dragMk = null;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
}

/* ---------- 骨架生成 ---------- */
function segDist(ax, ay, az, bx, by, bz, px, py, pz) {
  var abx = bx - ax, aby = by - ay, abz = bz - az;
  var apx = px - ax, apy = py - ay, apz = pz - az;
  var len2 = abx * abx + aby * aby + abz * abz;
  var t = len2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  var dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function build() {
  var meshes = targetMeshes();
  if (!meshes.length) { ctx.onMsg("自动绑骨：找不到可绑定的网格"); return; }
  if (mk("chin").pos.y <= mk("groin").pos.y) { ctx.onMsg("自动绑骨：下巴标记应高于裆部标记，请调整后再生成"); return; }

  var box = localBBox(meshes);
  var size = box.getSize(new THREE.Vector3());
  var maxDim = Math.max(size.x, size.y, size.z) || 1;

  /* 关节位置（root 局部） */
  var chin = mk("chin").pos.clone(), groin = mk("groin").pos.clone();
  var wristR = mk("wristR").pos.clone(), elbowR = mk("elbowR").pos.clone(), kneeR = mk("kneeR").pos.clone();
  var spine = groin.clone().lerp(chin, 0.35);
  var chest = groin.clone().lerp(chin, 0.72);
  var neck = groin.clone().lerp(chin, 0.92);
  var headTop = chin.clone(); headTop.y = Math.max(box.max.y, chin.y + 0.05 * size.y);
  // 肩：颈根 → 手肘方向 35%（T-pose / A-pose 都落在肩点附近）
  var shoulderR = neck.clone().lerp(elbowR, 0.35);
  var handR = wristR.clone().add(_v.copy(wristR).sub(elbowR).multiplyScalar(0.55));
  // 髋：裆部沿「裆→膝」水平方向外移
  _v.copy(kneeR).sub(groin); _v.y = 0;
  if (_v.lengthSq() < 1e-9) _v.set(1, 0, 0);
  _v.normalize();
  var hipOff = Math.max(0.07 * size.y, kneeR.distanceTo(groin) * 0.35);
  var hipR = groin.clone().addScaledVector(_v, hipOff);
  var ankleR = new THREE.Vector3(kneeR.x, box.min.y + 0.04 * size.y, kneeR.z);
  var toeR = ankleR.clone(); toeR.z += 0.12 * size.y;
  var mir = function (p) { var q = p.clone(); q.x = -q.x; return q; };
  var shoulderL = mir(shoulderR), handL = mir(handR), hipL = mir(hipR),
      ankleL = mir(ankleR), toeL = mir(toeR);

  /* 骨架：name, parent, 位置（root 局部，= 关节绝对位置，父骨减法在挂树时做） */
  var defs = [
    ["hips", null, groin],
    ["spine", "hips", spine], ["chest", "spine", chest],
    ["neck", "chest", neck], ["head", "neck", chin],
    ["shoulder_R", "chest", shoulderR], ["elbow_R", "shoulder_R", elbowR],
    ["wrist_R", "elbow_R", wristR], ["hand_R", "wrist_R", handR],
    ["shoulder_L", "chest", shoulderL], ["elbow_L", "shoulder_L", mir(elbowR)],
    ["wrist_L", "elbow_L", mk("wristL").pos], ["hand_L", "wrist_L", handL],
    ["thigh_R", "hips", hipR], ["knee_R", "thigh_R", kneeR],
    ["ankle_R", "knee_R", ankleR], ["foot_R", "ankle_R", toeR],
    ["thigh_L", "hips", hipL], ["knee_L", "thigh_L", mir(kneeR)],
    ["ankle_L", "knee_L", ankleL], ["foot_L", "ankle_L", toeL]
  ];
  var name2joint = {};
  defs.forEach(function (d) { name2joint[d[0]] = d[2]; });

  resetRig(); // 二次绑骨：先清上一次的产物
  var byName = {};
  var bones = [];
  var boneRoot = new THREE.Bone(); boneRoot.name = "ar_root";
  ctx.group.add(boneRoot);
  defs.forEach(function (d) {
    var b = new THREE.Bone(); b.name = d[0];
    var parent = d[1] ? byName[d[1]] : boneRoot;
    b.position.copy(d[2]);
    if (d[1]) b.position.sub(name2joint[d[1]]); // 父局部 = 绝对 − 父绝对
    parent.add(b);
    byName[d[0]] = b; bones.push(b);
  });

  /* 蒙皮骨段：每骨一段（父关节 → 本关节）；头/手/足的末梢延伸覆盖发顶/指尖/脚尖 */
  var segs = [];
  defs.forEach(function (d, i) {
    var a = d[1] ? name2joint[d[1]] : groin;
    var b = d[2];
    if (d[0] === "head") b = headTop;
    if (d[0] === "hand_R") b = handR;
    if (d[0] === "hand_L") b = handL;
    if (d[0] === "foot_R") b = toeR;
    if (d[0] === "foot_L") b = toeL;
    segs.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, bi: i });
  });
  var boneIndex = {}; bones.forEach(function (b, i) { boneIndex[b.name] = i; });

  var eps = maxDim * 0.02;
  var created = 0;
  meshes.forEach(function (mesh) {
    var geo = mesh.geometry;
    var pa = geo.attributes.position, n = pa.count;
    var si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
    // 顶点 → root 局部（骨段所在空间）
    _m4.copy(ctx.root.matrixWorld).invert().multiply(mesh.matrixWorld);
    var v = new THREE.Vector3();
    for (var i = 0; i < n; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(_m4);
      var b1 = -1, b2 = -1, d1 = Infinity, d2 = Infinity;
      for (var s = 0; s < segs.length; s++) {
        var g = segs[s];
        var dd = segDist(g.ax, g.ay, g.az, g.bx, g.by, g.bz, v.x, v.y, v.z);
        if (dd < d1) { d2 = d1; b2 = b1; d1 = dd; b1 = s; }
        else if (dd < d2) { d2 = dd; b2 = s; }
      }
      var w1 = 1 / Math.pow(d1 + eps, 3), w2 = b2 >= 0 ? 1 / Math.pow(d2 + eps, 3) : 0;
      var sum = w1 + w2;
      var s1 = segs[b1];
      si[i * 4] = boneIndex[bones[s1.bi].name]; sw[i * 4] = w1 / sum;
      if (b2 >= 0) {
        var s2 = segs[b2];
        si[i * 4 + 1] = boneIndex[bones[s2.bi].name]; sw[i * 4 + 1] = w2 / sum;
      }
    }
    geo.setAttribute("skinIndex", new THREE.Float32BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));

    var sk = new THREE.SkinnedMesh(geo, mesh.material);
    sk.name = (mesh.name || "mesh") + "_rig";
    // 与原网格同位：fullGroup 局部 = root 局部（fullGroup 恒等），直接复制原网格相对变换
    _m4.copy(ctx.group.matrixWorld).invert().multiply(mesh.matrixWorld);
    _m4.decompose(sk.position, sk.quaternion, sk.scale);
    ctx.group.add(sk);
    mesh.userData.holoARHidden = true;
    mesh.visible = false;
    created++;
  });

  boneRoot.updateMatrixWorld(true);
  var skeleton = new THREE.Skeleton(bones); // attached 模式：父链是静态组，根缩放自适应
  Array.prototype.forEach.call(ctx.group.children, function (o) {
    if (o.isSkinnedMesh && !o.userData.holoARBorn) {
      o.bind(skeleton);
      o.userData.holoARBorn = true;
      arMeshes.push(o);
    }
  });
  if (arMeshes.indexOf(boneRoot) < 0) arMeshes.push(boneRoot);
  built = true;

  close();
  ctx.onBuilt("自动绑骨完成 — " + bones.length + " 根骨 / " + created + " 蒙皮网格 — 已开启「显示骨架 + 姿势模式」，直接点选骨骼拖动摆姿势");
}

/* 清掉上次绑骨产物，恢复原网格显示（重新绑骨前调用） */
function resetRig() {
  arMeshes.forEach(function (o) {
    if (o.parent) o.parent.remove(o);
  });
  arMeshes = [];
  ctx.group.traverse(function (o) {
    if (o.userData && o.userData.holoARHidden) { o.visible = true; delete o.userData.holoARHidden; }
  });
  built = false;
}

/* ---------- 开 / 关 ---------- */
function open(c) {
  ctx = c;
  var meshes = targetMeshes();
  if (!meshes.length) { ctx.onMsg("自动绑骨：当前没有可绑定的静态网格"); return; }
  ensureDom();
  autoPlace(localBBox(meshes));
  resetRig(); // 模型重载后残留标记清掉
  enterClean();          // ① 纯净视口（先摘装饰再取景，避免 HUD 干扰量测）
  fitCamera();           // ② 自动取景
  wrapEl.style.display = "block";
  active = true;
  setStep(0);
  loop();
  // 线框模式下拖标记看不清模型 → 覆盖层期间强制全彩，退出时还原
  savedRender = $("selRender") ? $("selRender").value : null;
  if (savedRender && savedRender !== "full") {
    $("selRender").value = "full";
    $("selRender").dispatchEvent(new Event("change"));
  }
  ctx.onMsg("AUTO-RIGGER — 按步骤拖圆环到关节，左键旋转 / 滚轮缩放查看");
}
function close() {
  active = false;
  cancelAnimationFrame(rafId);
  if (wrapEl) wrapEl.style.display = "none";
  exitClean();           // 还原舞台装饰 / 面板 / 相机相关临时物
  if (savedRender !== null && $("selRender") && $("selRender").value !== savedRender) {
    $("selRender").value = savedRender;
    $("selRender").dispatchEvent(new Event("change"));
  }
  savedRender = null;
  if (ctx && !built) ctx.onMsg("已退出自动绑骨");
}
function isActive() { return active; }

/* ---------- 自检钩子（验证脚本用，只读/可复原） ---------- */
window.holoAutoRigInfo = function () {
  var bones = 0, skins = 0;
  if (ctx) ctx.group.traverse(function (o) {
    if (o.isBone) bones++;
    if (o.isSkinnedMesh && o.userData && o.userData.holoARBorn) skins++;
  });
  var visKeys = [];
  if (active) markers.forEach(function (mk0) {
    if (mk0.el.style.display !== "none" && !mk0.el.classList.contains("off")) visKeys.push(mk0.key);
  });
  /* b33 取景判据：相机位姿 + 可见网格世界盒 8 角投影到容器的屏幕盒 */
  var cam = null, scr = null;
  if (ctx && ctx.camera) {
    cam = { x: +ctx.camera.position.x.toFixed(3), y: +ctx.camera.position.y.toFixed(3), z: +ctx.camera.position.z.toFixed(3) };
    var ms = targetMeshes();
    if (ms.length) {
      var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      ms.forEach(function (m) {
        var bb = m.geometry.boundingBox || m.geometry.computeBoundingBox();
        bb = m.geometry.boundingBox;
        for (var i = 0; i < 8; i++) {
          _v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
          m.localToWorld(_v);
          mn[0] = Math.min(mn[0], _v.x); mn[1] = Math.min(mn[1], _v.y); mn[2] = Math.min(mn[2], _v.z);
          mx[0] = Math.max(mx[0], _v.x); mx[1] = Math.max(mx[1], _v.y); mx[2] = Math.max(mx[2], _v.z);
        }
      });
      ctx.camera.updateMatrixWorld(true);
      var r = ctx.container.getBoundingClientRect(), xs = [], ys = [];
      for (var j = 0; j < 8; j++) {
        _v2.set(j & 1 ? mx[0] : mn[0], j & 2 ? mx[1] : mn[1], j & 4 ? mx[2] : mn[2]);
        _v2.project(ctx.camera);
        xs.push((_v2.x * 0.5 + 0.5) * r.width);
        ys.push((-_v2.y * 0.5 + 0.5) * r.height);
      }
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      scr = { cx: +(((minX + maxX) / 2) / r.width).toFixed(3),
              cy: +(((minY + maxY) / 2) / r.height).toFixed(3),
              hFrac: +((maxY - minY) / r.height).toFixed(3) };
    }
  }
  return { active: active, built: built, bones: bones, skinnedMeshes: skins,
           step: step, visibleMarkers: visKeys,
           stepText: active ? document.getElementById("arGuide").textContent : "",
           cam: cam, screenBox: scr };
};
window.holoARTestPose = function (deg) {
  // 右前臂绕 X 转 deg 度；返回前臂区顶点（主权重 ∈ 肘/腕/手）在转动前后的平均世界坐标与位移。
  // 用区域顶点位移而非全模型包围盒——小臂旋转对整体 diag 几乎无感（b32 验证 W6 判据）。
  var bone = null, skm = null;
  if (ctx) ctx.group.traverse(function (o) {
    if (o.isBone && o.name === "elbow_R") bone = o;
    if (o.isSkinnedMesh && o.userData && o.userData.holoARBorn && !skm) skm = o;
  });
  if (!bone || !skm || !skm.skeleton) return null;
  var armIdx = {};
  skm.skeleton.bones.forEach(function (b, i) {
    if (b.name === "elbow_R" || b.name === "wrist_R" || b.name === "hand_R") armIdx[i] = 1;
  });
  var si = skm.geometry.attributes.skinIndex, pa = skm.geometry.attributes.position;
  var n = pa.count, stride = Math.max(1, Math.floor(n / 4000));
  function armAvg() {
    var cx = 0, cy = 0, cz = 0, cnt = 0, p = new THREE.Vector3();
    for (var i = 0; i < n; i += stride) {
      if (!armIdx[si.array[i * 4]]) continue;
      p.fromBufferAttribute(pa, i);
      skm.applyBoneTransform(i, p);
      skm.localToWorld(p);
      cx += p.x; cy += p.y; cz += p.z; cnt++;
    }
    return cnt ? [cx / cnt, cy / cnt, cz / cnt] : null;
  }
  var before = armAvg();
  var q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (deg || 90) * Math.PI / 180);
  bone.quaternion.copy(q);
  bone.updateMatrixWorld(true);
  var after = armAvg();
  var moved = 0;
  if (before && after) {
    moved = Math.sqrt(Math.pow(before[0] - after[0], 2) + Math.pow(before[1] - after[1], 2) +
                      Math.pow(before[2] - after[2], 2));
  }
  return { before: before, after: after, moved: moved };
};
window.holoARTestReset = function () {
  if (!ctx) return false;
  var ok = false;
  ctx.group.traverse(function (o) {
    if (o.isBone && o.name === "elbow_R") { o.quaternion.set(0, 0, 0, 1); o.updateMatrixWorld(true); ok = true; }
  });
  return ok;
};

export { open as openAutoRig, close as closeAutoRig, isActive as autoRigActive };

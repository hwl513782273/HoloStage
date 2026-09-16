/* HoloStage 1.3.5.9(b32) — 本地自动绑骨（Mixamo 式拖标记）
 *
 * 流程：无骨骼模型载入后点「自动绑骨」→ 舞台出现标记覆盖层（9 个彩色圆环，
 *       按包围盒自动预放，可拖到正确关节；利用对称时右半边自动镜像左半边）
 *       → NEXT：按标记生成人形骨架 + 顶点到骨段距离反比蒙皮 → 替换原静态网格
 *       → 现有「骨骼 / 姿态」系统（点选拖动 / 三轴 / 关键帧）直接接管。
 *
 * 坐标系约定：标记与关节全部存 modelRoot 局部空间（模型已归一化居中，x 镜像即左右对称）。
 * 骨架挂在 fullGroup 下的一个 Bone 根上；蒙皮用 attached 模式（父链是静态组节点，
 * normalizeModel 的根缩放会被 bindMatrixInverse 的逐帧重算自动抵消，无需手动 rebind）。
 *
 * 本模块不依赖 app.module 内部状态，全部经 ctx 注入：
 *   { camera, container, group(fullGroup), root(modelRoot), onBuilt(summary), onMsg(text) }
 */

import * as THREE from "three";

var ctx = null, active = false, built = false;
var arMeshes = [];             // 本模块创建的蒙皮网格 + 骨根（resetRig 时统一摘除）
var markers = [];              // {key,label,color,pos,mirror,el}
var wrapEl = null, dotsEl = null, dragEl = null, listEl = null;
var dragMk = null, hoverMk = null;
var _ray = new THREE.Raycaster();
var _ndc = new THREE.Vector2();
var _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
var _plane = new THREE.Plane();
var _m4 = new THREE.Matrix4();
var savedRender = null;        // 进覆盖层前记住渲染方式，BACK 时还原
var rafId = 0;

/* 标记定义（颜色照搬 Mixamo Auto-Rigger 截图）：mirror 指向 x 镜像伙伴 */
var MARKER_DEFS = [
  { key: "chin",   label: "CHIN 下巴",   color: "#35d6e0", mirror: null,      tip: "下颌尖" },
  { key: "wristR", label: "WRISTS 手腕", color: "#b5e352", mirror: "wristL",  tip: "右腕" },
  { key: "wristL", label: null,          color: "#b5e352", mirror: "wristR",  tip: "左腕（对称自动）" },
  { key: "elbowR", label: "ELBOWS 手肘", color: "#f0d24a", mirror: "elbowL",  tip: "右肘" },
  { key: "elbowL", label: null,          color: "#f0d24a", mirror: "elbowR",  tip: "左肘（对称自动）" },
  { key: "kneeR",  label: "KNEES 膝盖",  color: "#f5a623", mirror: "kneeL",   tip: "右膝" },
  { key: "kneeL",  label: null,          color: "#f5a623", mirror: "kneeR",   tip: "左膝（对称自动）" },
  { key: "groin",  label: "GROIN 裆部",  color: "#f06292", mirror: null,      tip: "骨盆底" }
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

/* ---------- DOM ---------- */
function ensureDom() {
  if (wrapEl) return;
  if (!markers.length) {
    markers = MARKER_DEFS.map(function (d) {
      return { key: d.key, label: d.label, color: d.color, mirror: d.mirror, tip: d.tip,
               pos: new THREE.Vector3(), el: null };
    });
  }
  wrapEl = document.createElement("div");
  wrapEl.id = "autoRig";
  wrapEl.innerHTML =
    '<div id="arHeader">AUTO-RIGGER 自动绑骨<span id="arClose" title="关闭">✕</span></div>' +
    '<div id="arDrag"></div>' +
    '<div id="arDots"></div>' +
    '<div id="arLeft"><div id="arList"></div>' +
    '  <label class="arRow arSym"><input type="checkbox" id="inpARSym" checked> 利用对称 Use Symmetry</label>' +
    '  <div class="arRow"><span class="arLbl">骨架 LOD</span>' +
    '    <select id="selARLOD"><option>Standard Skeleton（标准人形骨架）</option></select></div>' +
    '  <div class="arBtns"><button id="btnARBack">BACK 返回</button><button id="btnARNext">NEXT 生成骨架</button></div>' +
    '</div>' +
    '<div id="arRight"><b>Place markers 位置标记</b>' +
    '  <p>在模型上把彩色圆环拖到对应关节，然后点「NEXT 生成骨架」开始自动绑定。</p>' +
    '  <p class="arDim">标记已按体型比例自动预放，多数模型只需微调（甚至直接 NEXT）。</p>' +
    '  <p class="arDim">拖不准的一面开启「利用对称」：只拖右侧，左侧自动镜像。</p>' +
    '  <p class="arDim">生成的骨架接入「骨骼 / 姿态」面板：点选拖动 / 三轴微调 / 打关键帧。</p>' +
    '</div>';
  ctx.container.appendChild(wrapEl);
  dotsEl = $("arDots"); dragEl = $("arDrag"); listEl = $("arList");

  markers.forEach(function (mk0) {
    var d = document.createElement("div");
    d.className = "arDot";
    d.style.borderColor = mk0.color;
    d.dataset.key = mk0.key;
    dotsEl.appendChild(d);
    mk0.el = d;
  });
  buildList();
  $("inpARSym").onchange = function () { /* 状态读取在 drag 中进行 */ };
  $("btnARBack").onclick = close;
  $("arClose").onclick = close;
  $("btnARNext").onclick = function () { build(); };
  dragEl.addEventListener("pointerdown", onDown);
  dragEl.addEventListener("pointermove", onMove);
  dragEl.addEventListener("pointerup", onUp);
  dragEl.addEventListener("pointercancel", onUp);
}

function buildList() {
  var html = "";
  markers.forEach(function (mk0) {
    if (!mk0.label) return; // 镜像伙伴不单列（与 Mixamo 一致：一行两组圆环）
    html += '<div class="arRow arItem" data-key="' + mk0.key + '">' +
      '<span class="arChip" style="background:' + mk0.color + '"></span>' +
      '<span class="arLbl">' + mk0.label + "</span>" +
      '<span class="arTip">' + mk0.tip + "</span></div>";
  });
  listEl.innerHTML = html;
  Array.prototype.forEach.call(listEl.querySelectorAll(".arItem"), function (row) {
    row.onclick = function () { selectMarker(this.dataset.key); };
  });
}

function selectMarker(key) {
  var mk0 = mk(key);
  if (mk0 && !mk0.label && mk0.mirror) key = mk0.mirror; // 镜像伙伴归到主标记（列表行对应主标记）
  markers.forEach(function (m2) {
    var on = m2.key === key || (m2.mirror === key);
    m2.el.classList.toggle("sel", on);
  });
  Array.prototype.forEach.call(listEl.querySelectorAll(".arItem"), function (row) {
    row.classList.toggle("sel", row.dataset.key === key);
  });
}

/* ---------- 屏幕投影 ---------- */
function updateDots() {
  if (!active) return;
  var r = ctx.container.getBoundingClientRect();
  ctx.camera.updateMatrixWorld();
  markers.forEach(function (mk0) {
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

/* ---------- 拖拽 ---------- */
function screenPos(mk0) {
  var r = ctx.container.getBoundingClientRect();
  _v.copy(mk0.pos); ctx.root.localToWorld(_v); _v.project(ctx.camera);
  return { x: (_v.x * 0.5 + 0.5) * r.width, y: (-_v.y * 0.5 + 0.5) * r.height };
}
function onDown(e) {
  var r = ctx.container.getBoundingClientRect();
  var px = e.clientX - r.left, py = e.clientY - r.top;
  var best = null, bestD = 34 * 34;
  markers.forEach(function (mk0) {
    var s = screenPos(mk0);
    var dx = s.x - px, dy = s.y - py, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = mk0; }
  });
  if (!best) return;
  dragMk = best;
  selectMarker(best.mirror || best.key); // 选主标记（高亮成对）
  _v.copy(best.pos); ctx.root.localToWorld(_v);
  ctx.camera.getWorldDirection(_v3);
  _plane.setFromNormalAndCoplanarPoint(_v3, _v);
  dragEl.setPointerCapture(e.pointerId);
}
function onMove(e) {
  if (!dragMk) {
    var r = ctx.container.getBoundingClientRect();
    var px = e.clientX - r.left, py = e.clientY - r.top, hov = null, bd = 34 * 34;
    markers.forEach(function (mk0) {
      var s = screenPos(mk0), dx = s.x - px, dy = s.y - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; hov = mk0; }
    });
    if (hov !== hoverMk) {
      hoverMk = hov;
      dragEl.style.cursor = hov ? "grab" : "crosshair";
    }
    return;
  }
  var r2 = ctx.container.getBoundingClientRect();
  _ndc.set(((e.clientX - r2.left) / r2.width) * 2 - 1, -((e.clientY - r2.top) / r2.height) * 2 + 1);
  _ray.setFromCamera(_ndc, ctx.camera);
  if (!_ray.ray.intersectPlane(_plane, _v2)) return;
  ctx.root.worldToLocal(_v2);
  dragMk.pos.copy(_v2);
  var sym = $("inpARSym") ? $("inpARSym").checked : true;
  if (sym && dragMk.mirror) {
    var other = mk(dragMk.mirror);
    if (other) { other.pos.copy(dragMk.pos); other.pos.x = -other.pos.x; }
  }
  updateDots();
}
function onUp() { dragMk = null; }

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
    var segA = new Float32Array(segs.length), segD = new Float32Array(segs.length);
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
  var box = localBBox(meshes);
  autoPlace(box);
  resetRig(); // 模型重载后残留标记清掉
  wrapEl.style.display = "block";
  active = true;
  selectMarker("chin");
  updateDots();
  loop();
  // 线框模式下拖标记看不清模型 → 覆盖层期间强制全彩，BACK 时还原
  savedRender = $("selRender") ? $("selRender").value : null;
  if (savedRender && savedRender !== "full") {
    $("selRender").value = "full";
    $("selRender").dispatchEvent(new Event("change"));
  }
  ctx.onMsg("AUTO-RIGGER — 拖动彩色圆环到关节位置，NEXT 生成骨架（BACK 返回）");
}
function close() {
  active = false;
  cancelAnimationFrame(rafId);
  if (wrapEl) wrapEl.style.display = "none";
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
  return { active: active, built: built, bones: bones, skinnedMeshes: skins };
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

/* HoloStage 1.3.5 — 骨架可视化（Blender 风格八面体骨骼），App 与导出网页查看器共用
 *
 * 形状：每根骨画成 head → tail 的细长钻石（octahedral bone）—— 头尾各一个尖点，
 *       靠近 head 的 10% 处有一个方形截面（边长 = 长度 × 0.12），正是 Blender 的样子。
 * 承载：InstancedMesh（MMD 模型常有 300~500 根骨，逐个 Mesh 会拖垮帧率），
 *       每帧按骨骼世界矩阵重算实例矩阵；颜色按层级深度渐变，选中骨单独高亮。
 * 显示：depthTest=false + 高 renderOrder → 骨架永远浮在模型之上（穿透显示），
 *       配 AdditiveBlending，正好吃相机那层 UnrealBloom 发光。
 *
 * 本模块只负责「看」与「拾取」；姿态/关键帧的数据由调用方（app.module.js）持有。
 */

import * as THREE from "three";

var _UP = new THREE.Vector3(0, 1, 0);
var _head = new THREE.Vector3();
var _tail = new THREE.Vector3();
var _dir = new THREE.Vector3();
var _quat = new THREE.Quaternion();
var _scale = new THREE.Vector3();
var _mat4 = new THREE.Matrix4();

var _geo = null;
function octaGeometry() {
  if (_geo) return _geo;
  // 单位骨：head(0,0,0) → tail(0,1,0)；中间方形截面在 y=0.1、半径 0.12（Blender 比例）
  var r = 0.12, h = 0.1;
  var v = [
    [0, 0, 0], [r, h, r], [-r, h, r], [-r, h, -r], [r, h, -r], [0, 1, 0]
  ];
  var faces = [
    [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1],
    [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]
  ];
  var pos = [];
  faces.forEach(function (f) {
    f.forEach(function (i) { pos.push(v[i][0], v[i][1], v[i][2]); });
  });
  var g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  _geo = g;
  return g;
}

/** 从模型对象里捞出骨架。没有骨架（STL/OBJ/PLY 等纯几何）返回 null。 */
export function collectSkeleton(root) {
  if (!root) return null;
  var meshes = [];
  root.traverse(function (o) {
    if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones && o.skeleton.bones.length) meshes.push(o);
  });
  if (!meshes.length) return null;
  var bones = [], seen = {};
  meshes.forEach(function (m) {
    m.skeleton.bones.forEach(function (b) {
      if (b && !seen[b.uuid]) { seen[b.uuid] = 1; bones.push(b); }
    });
  });
  if (!bones.length) return null;

  var idx = {};
  bones.forEach(function (b, i) { idx[b.uuid] = i; });
  var n = bones.length;
  var parentIdx = new Int32Array(n);
  var childIdx = [];
  for (var i = 0; i < n; i++) childIdx.push([]);
  bones.forEach(function (b, k) {
    var p = b.parent, pi = -1;
    while (p) { // 中间可能夹着非骨骼节点，一直往上找到骨为止
      if (idx[p.uuid] !== undefined) { pi = idx[p.uuid]; break; }
      p = p.parent;
    }
    parentIdx[k] = pi;
    if (pi >= 0) childIdx[pi].push(k);
  });
  var depth = new Int32Array(n);
  bones.forEach(function (b, k) {
    var d = 0, p = parentIdx[k];
    while (p >= 0) { d++; p = parentIdx[p]; }
    depth[k] = d;
  });
  var roots = [];
  for (var j = 0; j < n; j++) if (parentIdx[j] < 0) roots.push(bones[j]);
  return { meshes: meshes, bones: bones, parentIdx: parentIdx, childIdx: childIdx, depth: depth, roots: roots };
}

/** 层级顺序（DFS）的扁平列表，供面板做缩进骨骼树。 */
export function boneTree(vis) {
  var out = [];
  function walk(i, d) {
    var b = vis.bones[i];
    out.push({ i: i, depth: d, name: (b && b.name) || ("bone" + i) });
    vis.childIdx[i].forEach(function (c) { walk(c, d + 1); });
  }
  vis.bones.forEach(function (b, i) { if (vis.parentIdx[i] < 0) walk(i, 0); });
  return out;
}

/**
 * 建骨架可视化层。
 * opts: { color: THREE.Color|number 主色, selectedColor }
 */
export function createSkeletonView(vis, opts) {
  opts = opts || {};
  var n = vis.bones.length;
  var baseColor = new THREE.Color(opts.color === undefined ? 0x3fb9ff : opts.color);
  var selColor = new THREE.Color(opts.selectedColor === undefined ? 0xffffff : opts.selectedColor);

  var mat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
  });
  var mesh = new THREE.InstancedMesh(octaGeometry(), mat, n);
  mesh.frustumCulled = false;
  mesh.renderOrder = 900;          // 浮在模型/环之上
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.name = "holoSkeleton";

  // 每骨颜色（按层级深度渐变，根最亮）
  var maxDepth = 1;
  for (var d = 0; d < n; d++) maxDepth = Math.max(maxDepth, vis.depth[d]);
  var colArr = new Float32Array(n * 3);
  for (var c = 0; c < n; c++) {
    var f = 1 - 0.55 * (vis.depth[c] / maxDepth);   // 根 1.0 → 末梢 0.45
    colArr[c * 3] = baseColor.r * f;
    colArr[c * 3 + 1] = baseColor.g * f;
    colArr[c * 3 + 2] = baseColor.b * f;
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  var posBuf = new Float32Array(n * 3);
  var selected = -1;
  var medianLen = 0;
  var visible = true;

  function refreshColors() {
    for (var i = 0; i < n; i++) {
      if (i === selected) {
        colArr[i * 3] = selColor.r; colArr[i * 3 + 1] = selColor.g; colArr[i * 3 + 2] = selColor.b;
      } else {
        var f = 1 - 0.55 * (vis.depth[i] / maxDepth);
        colArr[i * 3] = baseColor.r * f; colArr[i * 3 + 1] = baseColor.g * f; colArr[i * 3 + 2] = baseColor.b * f;
      }
    }
    mesh.instanceColor.needsUpdate = true;
  }

  function update() {
    if (!mesh.visible) return;
    // 1) 骨架世界矩阵刷新：对每个顶层骨更新整棵子树（比逐骨 updateWorldMatrix 快得多）
    for (var r = 0; r < vis.roots.length; r++) vis.roots[r].updateWorldMatrix(true, true);
    // 2) 抓所有骨的世界位置（直接读 matrixWorld，避免 getWorldPosition 的重复父链更新）
    for (var i = 0; i < n; i++) {
      var m = vis.bones[i].matrixWorld.elements;
      posBuf[i * 3] = m[12]; posBuf[i * 3 + 1] = m[13]; posBuf[i * 3 + 2] = m[14];
    }
    // 3) 每骨：head=自身，tail=第一个子骨（末梢骨则沿父→自身方向延伸等长）
    if (!medianLen) { // 中位骨长只算一次，用于给极短骨兜底，免得太小的骨看不见
      var lens = [];
      for (var k = 0; k < n; k++) {
        var ch = vis.childIdx[k];
        if (!ch.length) continue;
        var dx = posBuf[ch[0] * 3] - posBuf[k * 3];
        var dy = posBuf[ch[0] * 3 + 1] - posBuf[k * 3 + 1];
        var dz = posBuf[ch[0] * 3 + 2] - posBuf[k * 3 + 2];
        var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L > 1e-6) lens.push(L);
      }
      lens.sort(function (a, b) { return a - b; });
      medianLen = lens.length ? lens[lens.length >> 1] : 0.05;
    }
    var minLen = medianLen * 0.22;

    for (var j = 0; j < n; j++) {
      _head.set(posBuf[j * 3], posBuf[j * 3 + 1], posBuf[j * 3 + 2]);
      var kids = vis.childIdx[j], len;
      if (kids.length) {
        _tail.set(posBuf[kids[0] * 3], posBuf[kids[0] * 3 + 1], posBuf[kids[0] * 3 + 2]);
        len = _head.distanceTo(_tail);
      } else {
        var pi = vis.parentIdx[j];
        if (pi >= 0) { // 末梢：沿父→自身方向再延伸一个自身长度
          _dir.set(_head.x - posBuf[pi * 3], _head.y - posBuf[pi * 3 + 1], _head.z - posBuf[pi * 3 + 2]);
          len = _dir.length() || minLen;
          if (len < 1e-6) _dir.set(0, 1, 0); else _dir.multiplyScalar(1 / len);
        } else {       // 孤骨：朝上给个默认长度
          _dir.set(0, 1, 0); len = minLen;
        }
      }
      if (len < minLen) len = minLen;
      _dir.subVectors(_tail, _head);
      if (_dir.lengthSq() < 1e-12) _dir.set(0, 1, 0); else _dir.normalize();
      var thick = len * 0.11;                       // 钻石的胖瘦（Blender 比例）
      if (j === selected) { len *= 1.18; thick *= 1.5; }
      _quat.setFromUnitVectors(_UP, _dir);
      _scale.set(thick, len, thick);
      _mat4.compose(_head, _quat, _scale);
      mesh.setMatrixAt(j, _mat4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  var _ray = new THREE.Raycaster();
  function pick(ndcX, ndcY, camera) {
    _ray.setFromCamera({ x: ndcX, y: ndcY }, camera);
    var hits = _ray.intersectObject(mesh, false);
    return hits.length ? hits[0].instanceId : -1;
  }

  update();
  refreshColors();

  return {
    mesh: mesh,
    bones: vis.bones,
    update: update,
    pick: pick,
    getSelected: function () { return selected; },
    setSelected: function (i) { selected = (i >= 0 && i < n) ? i : -1; refreshColors(); update(); },
    setColor: function (hex) {
      baseColor.set(hex); refreshColors();
    },
    setVisible: function (v) {
      visible = !!v; mesh.visible = visible;
      if (visible) update();
    },
    isVisible: function () { return visible; },
    dispose: function () {
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.dispose();
      mat.dispose();
    }
  };
}

/** 骨架世界包围盒（给「相机聚焦到骨架」之类用；也可判断骨架是否离谱地大/小） */
export function skeletonBounds(vis) {
  var box = new THREE.Box3();
  vis.bones.forEach(function (b) {
    var m = b.matrixWorld.elements;
    box.expandByPoint(_head.set(m[12], m[13], m[14]));
  });
  return box;
}

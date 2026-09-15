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
  var dirBuf = new Float32Array(n * 3);  // 每根骨「实际画出来的朝向」（自检用：验末梢骨没被带歪）
  var selected = -1;
  var metrics = null;   // 骨长基准（无量纲，占骨架跨度的比例）—— 见 measureMetrics
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

  /* ---------- 骨长基准：存成「占骨架跨度的比例」（无量纲）----------
   * 为什么不缓存绝对值？用户拉「模型缩放」后骨的世界位置整体放大/缩小，
   * 而绝对值缓存不变 → minLen 失真，短骨会被下限全部撑成海胆。 */
  function spanOf() {
    var mnx = Infinity, mny = Infinity, mnz = Infinity;
    var mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (var i = 0; i < n; i++) {
      var x = posBuf[i * 3], y = posBuf[i * 3 + 1], z = posBuf[i * 3 + 2];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    return Math.max(mxx - mnx, mxy - mny, mxz - mnz) || 0;
  }
  function boneDist(a, b) {
    var dx = posBuf[a * 3] - posBuf[b * 3];
    var dy = posBuf[a * 3 + 1] - posBuf[b * 3 + 1];
    var dz = posBuf[a * 3 + 2] - posBuf[b * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  /* 只算一次：med = 中位骨长（极短骨的显示下限）；p90 = 90 分位（离群长骨的截断上限）。
   * 实测——阿古兽/白虎兽/朱雀兽/咲耶兽X 这些游戏包模型里，「特效 / 命中 / 挂点」骨
   * （TP01_xxx、FP01_xx、CP01_xx、head_0274 …）离父骨 9~23 倍于中位骨长，全是子骨 0 的末梢骨；
   * 而 p90 始终只有最长值的 1/4~1/2，所以 p90×1.8 既压得住巨刺，又只削到 Mixamo 大腿骨 2.6%。 */
  function measureMetrics() {
    var lens = [], k, L;
    for (k = 0; k < n; k++) {
      if (vis.childIdx[k].length) L = boneDist(k, vis.childIdx[k][0]);
      else if (vis.parentIdx[k] >= 0) L = boneDist(k, vis.parentIdx[k]);
      else continue;
      if (L > 1e-9) lens.push(L);
    }
    var span = spanOf();
    if (!lens.length || !(span > 1e-9)) { metrics = { med: 0.03, p90: 0.09 }; return; }
    lens.sort(function (a, b) { return a - b; });
    metrics = {
      med: lens[lens.length >> 1] / span,
      p90: lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))] / span
    };
  }
  /** 骨长的下限 / 上限 —— 唯一定义处，update() 与自检 drawnLengths() 共用（避免两处漂移）：
   *  下限 = 中位骨长 × 0.22（太小的骨看不见）
   *  上限 = min(p90 × 1.8, 骨架跨度 × 0.30)  ← 两道闸：p90 挡离群挂点骨，跨度闸保证
   *         「单根骨永远不超过骨架自身尺寸的 30%」，这条不改模型也能肉眼核验。 */
  function lengthBounds() {
    if (!metrics) measureMetrics();
    var span = spanOf();
    var medLen = metrics.med * span;
    var minLen = medLen * 0.22;
    var maxLen = Math.min(metrics.p90 * span * 1.8, span * 0.30);
    if (maxLen < medLen * 2.5) maxLen = medLen * 2.5;
    return { span: span, medLen: medLen, minLen: minLen, maxLen: maxLen };
  }
  /** 这根骨「原始」长度（未截断）：有子骨取到第一个子骨，末梢骨取到父骨的距离。 */
  function rawLenAt(j) {
    if (vis.childIdx[j].length) return boneDist(j, vis.childIdx[j][0]);
    if (vis.parentIdx[j] >= 0) return boneDist(j, vis.parentIdx[j]);
    return 0;
  }
  /** 这根骨「会画多长」。update() 与自检 drawnLengths() 共用，保证自检测的就是真代码。 */
  function boneLenAt(j, minLen, maxLen) {
    var L = rawLenAt(j);
    if (!(L > 1e-9)) L = minLen;
    if (L < minLen) L = minLen;
    if (L > maxLen) L = maxLen;
    return L;
  }
  function refreshPos() {
    // 骨架世界矩阵刷新：对每个顶层骨更新整棵子树（比逐骨 updateWorldMatrix 快得多）
    for (var r = 0; r < vis.roots.length; r++) vis.roots[r].updateWorldMatrix(true, true);
    // 抓所有骨的世界位置（直接读 matrixWorld，避免 getWorldPosition 的重复父链更新）
    for (var i = 0; i < n; i++) {
      var m = vis.bones[i].matrixWorld.elements;
      posBuf[i * 3] = m[12]; posBuf[i * 3 + 1] = m[13]; posBuf[i * 3 + 2] = m[14];
    }
  }

  function update() {
    if (!mesh.visible) return;
    refreshPos();
    var bd = lengthBounds();

    // 每骨：head = 自身，tail = 第一个子骨（末梢骨则沿「父→自身」方向延伸这段距离）
    for (var j = 0; j < n; j++) {
      _head.set(posBuf[j * 3], posBuf[j * 3 + 1], posBuf[j * 3 + 2]);
      var kids = vis.childIdx[j], pi = vis.parentIdx[j], back = false;
      if (kids.length) {
        _tail.set(posBuf[kids[0] * 3], posBuf[kids[0] * 3 + 1], posBuf[kids[0] * 3 + 2]);
      } else if (pi >= 0) {
        _tail.set(posBuf[pi * 3], posBuf[pi * 3 + 1], posBuf[pi * 3 + 2]);
        back = true;   // _tail − _head 指向父骨，要反向才是「父→自身」
      }
      var len = boneLenAt(j, bd.minLen, bd.maxLen);
      // ⚠️ 方向必须在这里独立算完。1.3.5 的写法是先在末梢骨分支里算好方向，随后又被
      //    `_dir.subVectors(_tail, _head)` 无条件覆盖，而末梢骨那一支的 _tail 还停在上一次
      //    「有子骨」那根骨的位置上 → 末梢骨方向变成随机值，画出来是一圈放射状乱刺。
      if (kids.length || pi >= 0) {
        _dir.subVectors(_tail, _head);
        if (back) _dir.negate();
      } else {
        _dir.set(0, 1, 0);   // 孤骨：朝上
      }
      if (_dir.lengthSq() < 1e-12) _dir.set(0, 1, 0); else _dir.normalize();
      dirBuf[j * 3] = _dir.x; dirBuf[j * 3 + 1] = _dir.y; dirBuf[j * 3 + 2] = _dir.z;
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
    /* 自检用：按 update() 的同一套规则报出每根骨现在会画多长（含下限 / 上限截断）。
       用来断言两件事——① 离群挂点骨被压住；② 正常长骨（如 Mixamo 大腿）没被误伤。 */
    drawnLengths: function () {
      refreshPos();
      var bd = lengthBounds();
      var out = [], leaf = 0, clamped = 0, clampedLeaf = 0, rawMax = 0;
      for (var k = 0; k < n; k++) {
        var isLeaf = !vis.childIdx[k].length;
        if (isLeaf) leaf++;
        var raw = rawLenAt(k);
        if (raw > rawMax) rawMax = raw;
        if (raw > bd.maxLen + 1e-9) { clamped++; if (isLeaf) clampedLeaf++; }
        out.push(boneLenAt(k, bd.minLen, bd.maxLen));
      }
      var sorted = out.slice().sort(function (a, b) { return a - b; });
      // 末梢骨朝向自检：画出来的方向 vs「父→自身」真值的平均余弦。
      // 1.3.5 的 bug 会让这个值掉到 ~0（方向被上根骨的陈旧 tail 覆盖），修好后应 ≈ 1。
      var sum = 0, cnt = 0;
      for (var m = 0; m < n; m++) {
        var pi = vis.parentIdx[m];
        if (vis.childIdx[m].length || pi < 0) continue;
        var dx = posBuf[m * 3] - posBuf[pi * 3];
        var dy = posBuf[m * 3 + 1] - posBuf[pi * 3 + 1];
        var dz = posBuf[m * 3 + 2] - posBuf[pi * 3 + 2];
        var L2 = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L2 < 1e-9) continue;
        sum += (dirBuf[m * 3] * dx + dirBuf[m * 3 + 1] * dy + dirBuf[m * 3 + 2] * dz) / L2;
        cnt++;
      }
      return {
        lens: out, span: bd.span, minLen: bd.minLen, maxLen: bd.maxLen, medLen: bd.medLen,
        max: sorted.length ? sorted[sorted.length - 1] : 0,
        median: sorted.length ? sorted[sorted.length >> 1] : 0,
        bones: sorted.length, leafBones: leaf,
        leafDirCos: cnt ? +(sum / cnt).toFixed(4) : 1,
        rawMax: rawMax, clamped: clamped, clampedLeaf: clampedLeaf,
        clampedShare: sorted.length ? +(clamped / sorted.length).toFixed(4) : 0
      };
    },
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

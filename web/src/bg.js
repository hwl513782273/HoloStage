/* HoloStage 1.3.3 — 程序化背景（App 与导出网页查看器共用）
 * 参考「深蓝科技底图」的元素结构：竖向渐变底 + 细网格 + 竖排二进制数字列 +
 * 六边形轮廓 + 线框圆盘（同心圆 + 辐条 + 小圆点）+ 斜向折线 + 散落方块 + 边缘压暗。
 *
 * 两条设计约束：
 *  1) 发光元素用当前配色主色 → 换配色背景跟着变；底色由主色压暗派生，永远比元素暗得多，
 *     保证加色混合（AdditiveBlending）的线框模型仍然突出，不会被背景吃掉。
 *  2) 固定种子伪随机（mulberry32）→ 同尺寸同配色下每次结果完全一致，
 *     导出多帧/多分辨率时不会抖动，也便于比对。
 */

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  var n = parseInt(String(hex).replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* 主色 → 压暗底色（f 越小越暗；用于渐变底与 SVG/CSS 侧的暗色） */
export function shadeCss(hex, f) {
  var c = hexToRgb(hex);
  return "rgb(" + Math.round(c[0] * f) + "," + Math.round(c[1] * f) + "," + Math.round(c[2] * f) + ")";
}

/**
 * 生成程序化背景画布。
 * @param {number} w 画布宽（像素）
 * @param {number} h 画布高（像素）
 * @param {string} mainHex 发光主色，如 "#3fb9ff"
 * @param {number} bright 亮度系数（1 = 标准，0 = 只剩暗底，可到 2）
 */
export function buildBackgroundCanvas(w, h, mainHex, bright) {
  var cv = document.createElement("canvas");
  cv.width = Math.max(2, Math.round(w));
  cv.height = Math.max(2, Math.round(h));
  var x = cv.getContext("2d");
  var W = cv.width, H = cv.height;
  var rgb = hexToRgb(mainHex);
  var b = (typeof bright === "number" && isFinite(bright)) ? bright : 1;
  function A(a) { return Math.max(0, Math.min(1, a * b)); }          // 元素透明度 × 亮度
  function el(a) { return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + A(a) + ")"; }
  function base(f) {                                                  // 不透明底色（不随亮度变，避免全黑）
    return "rgb(" + Math.round(rgb[0] * f) + "," + Math.round(rgb[1] * f) + "," + Math.round(rgb[2] * f) + ")";
  }
  var rnd = mulberry32(20260914);
  var S = Math.min(W, H);
  var u = Math.max(1, S / 900);                                       // 线宽基准

  /* 1. 渐变底（上暗下微亮） */
  var g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, base(0.045));
  g.addColorStop(0.55, base(0.085));
  g.addColorStop(1, base(0.145));
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  /* 2. 右中部大范围辉光 */
  var gx = W * 0.60, gy = H * 0.44;
  var rg = x.createRadialGradient(gx, gy, 0, gx, gy, S * 0.85);
  rg.addColorStop(0, el(0.17));
  rg.addColorStop(0.45, el(0.05));
  rg.addColorStop(1, el(0));
  x.fillStyle = rg;
  x.fillRect(0, 0, W, H);

  /* 3. 细网格（两层：密网格 + 每 5 格加粗） */
  var step = Math.max(18, Math.round(S / 18));
  x.lineWidth = Math.max(0.6, u * 0.6);
  x.strokeStyle = el(0.055);
  x.beginPath();
  for (var i = 0; i <= Math.ceil(W / step); i++) { x.moveTo(i * step, 0); x.lineTo(i * step, H); }
  for (var j = 0; j <= Math.ceil(H / step); j++) { x.moveTo(0, j * step); x.lineTo(W, j * step); }
  x.stroke();
  x.lineWidth = Math.max(0.8, u * 0.9);
  x.strokeStyle = el(0.09);
  x.beginPath();
  for (var i2 = 0; i2 <= Math.ceil(W / (step * 5)); i2++) { x.moveTo(i2 * step * 5, 0); x.lineTo(i2 * step * 5, H); }
  for (var j2 = 0; j2 <= Math.ceil(H / (step * 5)); j2++) { x.moveTo(0, j2 * step * 5); x.lineTo(W, j2 * step * 5); }
  x.stroke();

  /* 4. 竖排二进制数字列 */
  var fsz = Math.max(9, S / 52);
  x.font = fsz + "px Menlo, Consolas, monospace";
  x.textAlign = "center";
  x.textBaseline = "top";
  var cols = Math.max(6, Math.round(W / (S / 7)));
  var cw = W / cols;
  for (var c = 0; c < cols; c++) {
    var cxp = (c + 0.5) * cw + (rnd() - 0.5) * cw * 0.55;
    var y0 = rnd() * H * 0.35;
    var n = Math.round((H * (0.35 + rnd() * 0.62)) / (fsz * 1.45));
    for (var d = 0; d < n; d++) {
      var dy = y0 + d * fsz * 1.45;
      if (dy > H) break;
      var a = 0.09 + rnd() * 0.30;
      if (rnd() > 0.87) a += 0.32;                                    // 少量高亮位，制造"数据流"感
      x.fillStyle = el(a);
      x.fillText(rnd() > 0.5 ? "1" : "0", cxp, dy);
    }
  }

  /* 5. 六边形轮廓 */
  function hexPath(cx, cy, r, rot) {
    x.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = rot + i * Math.PI / 3;
      var px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
  }
  var hexes = [
    [0.63, 0.30, 0.155, 0.34, 0],
    [0.63, 0.30, 0.105, 0.20, 0],
    [0.82, 0.62, 0.10, 0.16, Math.PI / 6]
  ];
  for (var hI = 0; hI < hexes.length; hI++) {
    var hx = hexes[hI];
    x.lineWidth = Math.max(1, u * (hI === 0 ? 2.2 : 1.4));
    x.strokeStyle = el(hx[3]);
    hexPath(W * hx[0], H * hx[1], S * hx[2], hx[4]);
    x.stroke();
  }

  /* 6. 线框圆盘：同心圆 + 辐条 + 中心点（参考图右中部的"涡轮"） */
  var dcx = W * 0.63, dcy = H * 0.46;
  var rings = [[0.30, 0.22, 1.6], [0.385, 0.15, 1.3], [0.47, 0.10, 1.1]];
  for (var rI = 0; rI < rings.length; rI++) {
    x.beginPath();
    x.arc(dcx, dcy, S * rings[rI][0], 0, Math.PI * 2);
    x.lineWidth = Math.max(1, u * rings[rI][2]);
    x.strokeStyle = el(rings[rI][1]);
    x.stroke();
  }
  x.lineWidth = Math.max(1, u * 1.2);
  x.strokeStyle = el(0.24);
  x.beginPath();
  for (var sp = 0; sp < 28; sp++) {
    var sa = (sp / 28) * Math.PI * 2;
    x.moveTo(dcx + S * 0.30 * Math.cos(sa), dcy + S * 0.30 * Math.sin(sa));
    x.lineTo(dcx + S * 0.325 * Math.cos(sa), dcy + S * 0.325 * Math.sin(sa));
  }
  x.stroke();
  x.beginPath();
  x.arc(dcx, dcy, S * 0.055, 0, Math.PI * 2);
  x.fillStyle = el(0.10);
  x.fill();
  x.beginPath();
  x.arc(dcx, dcy, S * 0.012, 0, Math.PI * 2);
  x.fillStyle = el(0.55);
  x.fill();

  /* 7. 斜向折线（电路走线感：只走水平/垂直/45°） */
  x.lineWidth = Math.max(1, u * 1.2);
  for (var t = 0; t < 8; t++) {
    var px2 = rnd() * W, py2 = rnd() * H;
    x.beginPath();
    x.moveTo(px2, py2);
    var segs = 2 + Math.floor(rnd() * 4);
    for (var s2 = 0; s2 < segs; s2++) {
      var len = S * (0.05 + rnd() * 0.15);
      var dir = Math.floor(rnd() * 4);
      if (dir === 0) px2 += len; else if (dir === 1) px2 -= len;
      else if (dir === 2) py2 += len; else py2 -= len;
      x.lineTo(px2, py2);
    }
    x.strokeStyle = el(0.14 + rnd() * 0.10);
    x.stroke();
  }

  /* 8. 散落小方块 */
  for (var q = 0; q < 14; q++) {
    var qs = S * (0.006 + rnd() * 0.012);
    x.fillStyle = el(0.10 + rnd() * 0.10);
    x.fillRect(rnd() * W, rnd() * H, qs, qs);
  }

  /* 9. 边缘压暗（让画面聚焦中心） */
  var vg = x.createRadialGradient(W / 2, H / 2, S * 0.25, W / 2, H / 2, S * 0.95);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);

  return cv;
}

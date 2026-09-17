/* HoloStage 1.2.7 — 3D 全息环库（Canvas 纹理版，App 与导出查看器共用）
 * 经典模式专用：环是 three.js 场景里的真实平面（PlaneGeometry + CanvasTexture），
 * 环心固定在世界中心（= 初始画面中心 = 模型锚点），拖动视角时随相机透视环绕。
 * 画布 1200×1200（600 逻辑单位 ×2 超采样），配套 PlaneGeometry(RING3D_SIZE, RING3D_SIZE)。
 * 返回 { canvas, spin }：spin = 环平面内自转角速度 rad/s（正=顺时针），移植自 rings.js 的 CSS 动画。
 */

import { DATA_TEXT, toGreek, fillCircleText } from "./rings.js"; // 数据弧文字默认值/整圈补齐/希腊音译：与 rings.js 共用同一份

export var RING3D_SIZE = 3.8; // 世界直径：机位 dist≈4.875 + fov45 下 ≈ 画面高度 94%（与 1.0 一致）

export function ring3dSpin(style) {
  switch (style) {
    case "seg":   return Math.PI * 2 / 24;    // 24s 正转
    case "dial":  return -Math.PI * 2 / 40;   // 40s 反转
    case "dash":  return Math.PI * 2 / 56;    // 56s 慢转
    case "magic": return Math.PI * 2 / 30;
    default:      return Math.PI * 2 / 24;
  }
}

export function drawRingCanvas(style, color, hideDot, opts) {
  var cv = document.createElement("canvas");
  cv.width = 1200; cv.height = 1200;
  var x = cv.getContext("2d");
  x.scale(2, 2);
  x.translate(300, 300); // 原点 = 环心
  var TAU = Math.PI * 2, i, a;

  function circle(r, lw, alpha, dash) {
    x.beginPath(); x.arc(0, 0, r, 0, TAU);
    x.strokeStyle = color; x.lineWidth = lw; x.globalAlpha = alpha;
    x.setLineDash(dash || []);
    x.stroke(); x.setLineDash([]); x.globalAlpha = 1;
  }
  function dot(rx, ry, r, alpha) {
    x.beginPath(); x.arc(rx, ry, r, 0, TAU);
    x.fillStyle = color; x.globalAlpha = alpha; x.fill(); x.globalAlpha = 1;
  }
  function ringText(chars, r, size, alpha, fam) {
    x.fillStyle = color; x.globalAlpha = alpha;
    x.font = size + "px " + fam;
    x.textAlign = "center"; x.textBaseline = "middle";
    var step = Math.PI * 2 / chars.length; // b35: 字符已补齐，均匀铺满整圈 360°
    for (var k = 0; k < chars.length; k++) {
      x.save(); x.rotate(-Math.PI / 2 + k * step); x.translate(0, -r);
      x.fillText(chars[k], 0, 0); x.restore();
    }
    x.globalAlpha = 1;
  }

  if (style === "seg") {
    var R1 = 272, R2 = 232, segs = 22;
    x.fillStyle = color; x.globalAlpha = 0.16;
    for (i = 0; i < segs; i++) {
      var a0 = i / segs * TAU, a1 = a0 + (TAU / segs) * 0.62;
      x.beginPath();
      x.arc(0, 0, R1, a0, a1, false);
      x.arc(0, 0, R2, a1, a0, true);
      x.closePath(); x.fill();
    }
    x.globalAlpha = 1;

  } else if (style === "dial") {
    circle(210, 1.5, 0.35);
    x.strokeStyle = color; x.globalAlpha = 0.4;
    for (i = 0; i < 60; i++) {
      var ta = i / 60 * TAU, r0 = 196, r1 = i % 5 === 0 ? 182 : 189;
      x.beginPath();
      x.moveTo(r0 * Math.cos(ta), r0 * Math.sin(ta));
      x.lineTo(r1 * Math.cos(ta), r1 * Math.sin(ta));
      x.lineWidth = i % 5 === 0 ? 2.5 : 1;
      x.stroke();
    }
    x.globalAlpha = 1;
    if (!hideDot) dot(0, 0, 3, 0.7);

  } else if (style === "dash") {
    circle(250, 2, 0.5, [18, 12]);
    circle(262, 1, 0.22, [4, 8]);
    x.fillStyle = color; x.globalAlpha = 0.55;
    for (i = 0; i < 4; i++) {
      var qa = i / 4 * TAU + Math.PI / 4;
      var qx = 250 * Math.cos(qa), qy = 250 * Math.sin(qa);
      x.save(); x.translate(qx, qy); x.rotate(qa + Math.PI / 4);
      x.fillRect(-5, -5, 10, 10); x.restore();
    }
    x.globalAlpha = 1;

  } else if (style === "magic") {
    circle(272, 1.5, 0.55);
    circle(248, 1, 0.35, [5, 9]);
    var runes = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ";
    x.fillStyle = color; x.globalAlpha = 0.8;
    x.font = "24px Menlo, monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    for (i = 0; i < runes.length; i++) {
      x.save(); x.rotate(-Math.PI / 2 + i * (TAU / runes.length)); x.translate(0, -224);
      x.fillText(runes.charAt(i), 0, 0); x.restore();
    }
    x.globalAlpha = 1;
    x.strokeStyle = color; x.lineWidth = 1.4;
    x.globalAlpha = 0.9;
    x.beginPath(); x.moveTo(0, -190); x.lineTo(164.5, 95); x.lineTo(-164.5, 95); x.closePath(); x.stroke();
    x.globalAlpha = 0.5;
    x.beginPath(); x.moveTo(0, 190); x.lineTo(-164.5, -95); x.lineTo(164.5, -95); x.closePath(); x.stroke();
    x.globalAlpha = 1;
    circle(70, 1, 0.4);
    x.beginPath(); x.arc(272, 0, 6, 0, TAU);
    x.strokeStyle = color; x.lineWidth = 1.5; x.globalAlpha = 1; x.stroke();
    if (!hideDot) dot(0, 0, 7, 0.9);

  } else { /* data 数据弧（1.3.5：与 rings.js 同步，1/4 弧绕圆心转 180° → 对角两段） */
    function dataArcs() {
      circle(262, 5, 0.85, [411.5, 1234.7]);
      circle(234, 2, 0.6, [245, 1225.3]);
      circle(206, 8, 0.28, [89.9, 1204.4]);
      dot(234, 0, 4, 0.9);
    }
    x.lineCap = "round";
    dataArcs();
    x.save(); x.rotate(Math.PI); x.lineCap = "round"; dataArcs(); x.restore(); // 绕圆心转 180°（点对称 → 落在对角象限）
    x.lineCap = "butt";
    // 文字环不参与那 180° 旋转（转了会跑到左上且倒着写）
    // b35: 文字绕完整一圈（与 rings.js 同步）；字形三选：digi 数码文字 / latin 英文 / greek 希腊文
    var dTxt = String((opts && opts.text) || DATA_TEXT) || DATA_TEXT;
    var dScript = (opts && opts.script) || "digi";
    if (dScript === "greek") dTxt = toGreek(dTxt);
    var dFam = dScript === "digi" ? "'DigiCode', Menlo, monospace" : "Menlo, monospace";
    ringText(fillCircleText(dTxt, Math.PI * 2 * 176), 176, 20, 0.75, dFam);
  }

  return { canvas: cv, spin: ring3dSpin(style) };
}

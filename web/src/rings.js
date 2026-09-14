/* HoloStage 1.2.5 — 全息环 SVG 样式库（App 与导出网页查看器共用）
 * 样式：seg 分段弧 / dial 刻度盘 / dash 虚线环 / magic 魔法阵 / data 数据弧
 * 全部输出 600×600 viewBox，颜色用 currentColor（由容器 color 控制，配合 bloom 发光）
 */

export function RING_STYLES() {
  return [
    ["seg", "分段弧"],
    ["dial", "刻度盘"],
    ["dash", "虚线环"],
    ["magic", "魔法阵"],
    ["data", "数据弧"]
  ];
}

export function ringStyleLabel(style) {
  var found = RING_STYLES().filter(function (s) { return s[0] === style; });
  return found.length ? found[1] : style;
}

/* 六芒星顶点（r=190, cx=300）：(300,110) (464.5,395) (135.5,395) 及其 180° 翻转 */
export function buildRingSVG(style, seed, hideDot) {
  var cx = 300;
  var uid = "holoRing" + seed + "_";
  var inner = "";
  var i, a0, a1, large, p;

  if (style === "seg") {
    var R1 = 272, R2 = 232, segs = 22;
    var arcs = "";
    for (i = 0; i < segs; i++) {
      a0 = (i / segs) * Math.PI * 2;
      a1 = a0 + (Math.PI * 2 / segs) * 0.62;
      large = (a1 - a0) > Math.PI ? 1 : 0;
      arcs += '<path d="M ' + (cx + R1 * Math.cos(a0)) + ' ' + (cx + R1 * Math.sin(a0)) +
        ' A ' + R1 + ' ' + R1 + ' 0 ' + large + ' 1 ' + (cx + R1 * Math.cos(a1)) + ' ' + (cx + R1 * Math.sin(a1)) +
        ' L ' + (cx + R2 * Math.cos(a1)) + ' ' + (cx + R2 * Math.sin(a1)) +
        ' A ' + R2 + ' ' + R2 + ' 0 ' + large + ' 0 ' + (cx + R2 * Math.cos(a0)) + ' ' + (cx + R2 * Math.sin(a0)) +
        ' Z" fill="currentColor" opacity="0.16"/>';
    }
    inner = '<g class="ringSpin">' + arcs + '</g>';

  } else if (style === "dial") {
    var ticks = '<circle cx="300" cy="300" r="210" fill="none" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.35"/>';
    for (i = 0; i < 60; i++) {
      var ta = (i / 60) * Math.PI * 2, r0 = 196, r1 = i % 5 === 0 ? 182 : 189;
      ticks += '<line x1="' + (cx + r0 * Math.cos(ta)) + '" y1="' + (cx + r0 * Math.sin(ta)) +
        '" x2="' + (cx + r1 * Math.cos(ta)) + '" y2="' + (cx + r1 * Math.sin(ta)) +
        '" stroke="currentColor" stroke-width="' + (i % 5 === 0 ? 2.5 : 1) + '" stroke-opacity="0.4"/>';
    }
    if (!hideDot) ticks += '<circle cx="300" cy="300" r="3" fill="currentColor" opacity="0.7"/>';
    inner = '<g class="ringSpinRev">' + ticks + '</g>';

  } else if (style === "dash") {
    var sq = "";
    for (i = 0; i < 4; i++) {
      var qa = (i / 4) * Math.PI * 2 + Math.PI / 4;
      var qx = cx + 250 * Math.cos(qa), qy = cx + 250 * Math.sin(qa);
      sq += '<rect x="' + (qx - 5) + '" y="' + (qy - 5) + '" width="10" height="10" fill="currentColor" opacity="0.55"' +
        ' transform="rotate(' + (qa * 180 / Math.PI + 45) + ' ' + qx + ' ' + qy + ')"/>';
    }
    inner = '<g class="ringSpinSlow">' +
      '<circle cx="300" cy="300" r="250" fill="none" stroke="currentColor" stroke-width="2" stroke-opacity="0.5" stroke-dasharray="18 12"/>' +
      '<circle cx="300" cy="300" r="262" fill="none" stroke="currentColor" stroke-width="1" stroke-opacity="0.22" stroke-dasharray="4 8"/>' +
      sq + '</g>';

  } else if (style === "magic") {
    var runes = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ";
    var tp = uid + "rune";
    inner =
      '<circle cx="300" cy="300" r="272" fill="none" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.55"/>' +
      '<g class="ringSpinRev">' +
        '<circle cx="300" cy="300" r="248" fill="none" stroke="currentColor" stroke-width="1" stroke-opacity="0.35" stroke-dasharray="5 9"/>' +
        '<path id="' + tp + '" d="M 300 76 a 224 224 0 1 1 -0.01 0" fill="none"/>' +
        '<text font-size="24" fill="currentColor" opacity="0.8" letter-spacing="6"><textPath href="#' + tp + '">' + runes + '</textPath></text>' +
      '</g>' +
      '<g class="ringSpinSlow">' +
        '<polygon points="300,110 464.5,395 135.5,395" fill="none" stroke="currentColor" stroke-width="1.4" stroke-opacity="0.9"/>' +
        '<polygon points="300,490 135.5,205 464.5,205" fill="none" stroke="currentColor" stroke-width="1.4" stroke-opacity="0.5"/>' +
      '</g>' +
      '<g class="ringSpin">' +
        '<circle cx="300" cy="300" r="70" fill="none" stroke="currentColor" stroke-width="1" stroke-opacity="0.4"/>' +
        '<circle cx="572" cy="300" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '</g>' + (hideDot ? '' : '<circle cx="300" cy="300" r="7" fill="currentColor" opacity="0.9"/>');

  } else { /* data 数据弧（1.3.3：1/4 弧镜像成左右对称两条） */
    var dtp = uid + "lbl";
    // 每条弧取整角（90° / 60° / 25°），dasharray 按周长 2πr 折算：
    //   r262 → 1646.2，90° = 411.5 ｜ r234 → 1470.3，60° = 245.0 ｜ r206 → 1294.3，25° = 89.9
    // 一条弧 + 它关于竖直轴（x=300）的镜像 → 整体左右对称，不再是单侧挂弧
    var mir = function (s) { return '<g transform="translate(600,0) scale(-1,1)">' + s + '</g>'; };
    var arcOut = '<circle cx="300" cy="300" r="262" fill="none" stroke="currentColor" stroke-width="5" stroke-opacity="0.85" stroke-dasharray="411.5 1234.7" stroke-linecap="round"/>';
    var arcIn =
      '<circle cx="300" cy="300" r="234" fill="none" stroke="currentColor" stroke-width="2" stroke-opacity="0.6" stroke-dasharray="245 1225.3"/>' +
      '<circle cx="300" cy="300" r="206" fill="none" stroke="currentColor" stroke-width="8" stroke-opacity="0.28" stroke-dasharray="89.9 1204.4" stroke-linecap="round"/>' +
      '<circle cx="534" cy="300" r="4" fill="currentColor" opacity="0.9"/>';
    inner =
      '<g class="ringSpin">' + arcOut + mir(arcOut) + '</g>' +
      '<g class="ringSpinRev">' + arcIn + mir(arcIn) + '</g>' +
      '<g class="ringSpinSlow">' +
        '<path id="' + dtp + '" d="M 300 124 a 176 176 0 1 1 -0.01 0" fill="none"/>' +
        '<text font-size="20" fill="currentColor" opacity="0.75" letter-spacing="4"><textPath href="#' + dtp + '">HOLOSTAGE // SYS.LINK // 055-8821 // ONLINE</textPath></text>' +
      '</g>';
  }

  return '<svg viewBox="0 0 600 600" style="display:block;width:100%;height:100%;overflow:visible">' + inner + '</svg>';
}

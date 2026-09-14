/* HoloStage 1.3.4 — 动态背景层（相机跟随的全屏 GLSL 层）
 *
 * 与 1.3.3 的 bg.js 的区别：bg.js 把元素「画一次」做成 CanvasTexture 静态贴图挂在
 * scene.background 上（一张画）；这里改成「一层场景」——
 *   · 顶点着色器直接把平面写进裁剪空间（gl_Position = vec4(position.xy, ...)），
 *     所以它永远精确铺满画面（与相机 FOV / 视口比例 / 分辨率无关），不需要挂在相机上，
 *     也不需要因为导出尺寸变化而重建贴图；
 *   · 片元着色器按 uTime 演算，随 WebGL 画面一起进 PNG / GIF / 导出网页；
 *   · 所有尺寸都以「最短边」为单位（与 bg.js 的 S = min(W,H) 同一套口径），因此
 *     1080p 与 720p 导出的构图完全一致，不会因为分辨率不同而疏密不同。
 *
 * 元素（对齐用户选定的动效清单）：
 *   ① 竖排渐变底 + 右中辉光（呼吸）  ② 细网格（静态，不动）
 *   ③ 竖排二进制数字雨（下落 + 逐列速度差 + 扫过的亮头）
 *   ④ 六边形轮廓（缓慢自转，两个方向）  ⑤ 线框圆盘（辐条持续旋转）
 *   ⑥ 散落小方块（静态）  ⑦ 扫描带（周期性自上而下扫过）  ⑧ 边缘压暗
 * 注意：用户明确不要「网格位移 / 电路走线上光点跑动」，故网格保持静止、电路折线不做。
 * 亮度基准：以 1.3.3 静态底图（bg.js）为对照逐项校过 —— 四角/中心/整体亮度同量级，
 *           数字雨与线条元素的 alpha 都压到与之一致（见 1.3.4-自检 的对比图）。
 *
 * 颜色口径：uMain 传 sRGB 原值（与 bg.js 的 hexToRgb 一致），全部元素先在 sRGB 空间
 * 按 alpha 合成，最后整体做一次 sRGB→线性解码 —— 与 1.3.3 那条
 * 「canvas 画 sRGB → 纹理标记 SRGBColorSpace → 采样时解码」的链路等价。
 */
import * as THREE from "three";

/** "#rrggbb" → [r, g, b]（0..1，sRGB 原值，不解码） */
export function rgb01(hex) {
  var n = parseInt(String(hex).replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.999, 1.0);
}
`;

const FRAG = `
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uMain;
uniform float uBright;
uniform sampler2D uGlyph;

const float TAU = 6.283185307179586;

float h21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

vec3 toLin(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float sdHex(vec2 p, float r) {
  vec3 k = vec3(-0.8660254038, 0.5, 0.5773502692);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

float ringMask(float d, float w) {
  float aa = fwidth(d) + 1e-6;
  return 1.0 - smoothstep(w, w + aa, d);
}

float gridMask(vec2 p, float st, float w) {
  vec2 d = abs(fract(p / st + 0.5) - 0.5) * st;
  return ringMask(min(d.x, d.y), w);
}

void main() {
  vec2 su = max(uRes, vec2(2.0));
  float S = min(su.x, su.y);
  vec2 C = vec2(vUv.x, 1.0 - vUv.y);
  vec2 q = (C * su - 0.5 * su) / S;

  float br = clamp(uBright, 0.0, 2.0);
  vec3 base = uMain;
  float breath = 1.0 + 0.10 * sin(uTime * 0.8);

  /* 1. 竖向渐变底（上暗下微亮；底色不随亮度变，避免全黑） */
  float g1 = clamp(C.y / 0.55, 0.0, 1.0);
  float g2 = clamp((C.y - 0.55) / 0.45, 0.0, 1.0);
  vec3 col = base * mix(mix(0.045, 0.085, g1), 0.145, g2);

  /* 2. 右中部大范围辉光（随呼吸） */
  vec2 gc = (vec2(0.60, 0.44) - 0.5) * su / S;
  float dg = length(q - gc) / 0.85;
  float ga = 0.115 * pow(max(0.0, 1.0 - clamp(dg, 0.0, 1.0)), 1.6) * breath;
  col = mix(col, base, clamp(ga * br, 0.0, 1.0));

  /* 3. 细网格（静态：用户不要网格位移） */
  col = mix(col, base, clamp(0.055 * br, 0.0, 1.0) * gridMask(q, 1.0 / 18.0, 0.0009));
  col = mix(col, base, clamp(0.090 * br, 0.0, 1.0) * gridMask(q, 5.0 / 18.0, 0.0013));

  /* 4. 竖排二进制数字雨：每列独立速度下落 + 一道自上而下扫过的亮头 */
  {
    float cw = 1.0 / 7.0;
    float ch = 1.45 / 52.0;
    float qTop = -0.5 * (su.y / S);
    float qBot = 0.5 * (su.y / S);
    float colf = q.x / cw;
    float ci = floor(colf);
    float cs = h21(vec2(ci, 2.7));
    float y0 = qTop + (qBot - qTop) * 0.34 * cs;
    float scc = 0.55 + 1.35 * h21(vec2(ci, 5.1));
    float rowf = q.y / ch + uTime * scc;
    float ri = floor(rowf);
    float lcx = fract(colf) - 0.5 - (h21(vec2(ci, 11.3)) - 0.5) * 0.5;
    float lcy = fract(rowf) - 0.5;
    float gs = ch * 0.66;
    vec2 lp = vec2(lcx * cw, lcy * ch);
    float inBox = step(max(abs(lp.x), abs(lp.y)), gs * 0.5);
    float dglyph = step(0.5, h21(vec2(ci, ri * 1.37 + 0.5)));
    vec2 tuv = vec2((0.5 + lp.x / gs) * 0.5 + dglyph * 0.5, 0.5 - lp.y / gs);
    float glyph = texture2D(uGlyph, tuv).a * inBox;
    float a = 0.070 + 0.215 * h21(vec2(ci, ri * 2.13));
    float sr = q.y / ch;
    float headRow = (qTop + (qBot - qTop) * fract(uTime * 0.17 + cs * 0.7)) / ch;
    a += 0.17 * exp(-pow((sr - headRow) * 0.45, 2.0));
    if (h21(vec2(ci, ri * 3.7)) > 0.87) a += 0.13;
    a += (0.015 + 0.055 * h21(vec2(ci, 9.1))) * (0.4 + 0.6 * breath);
    float colOn = step(y0, q.y);   // 注意：active 是 GLSL ES 保留字，不可用作标识符
    col = mix(col, base, clamp(a * br, 0.0, 1.0) * glyph * colOn);
  }

  /* 5. 六边形轮廓（缓慢自转，两个方向） */
  {
    vec2 c1 = (vec2(0.63, 0.30) - 0.5) * su / S;
    vec2 c2 = (vec2(0.82, 0.62) - 0.5) * su / S;
    float a1 = uTime * 0.05;
    float a3 = -uTime * 0.07;
    col = mix(col, base, clamp(0.22 * br, 0.0, 1.0) * ringMask(abs(sdHex(rot(q - c1, a1), 0.155)), 0.0026) * breath);
    col = mix(col, base, clamp(0.14 * br, 0.0, 1.0) * ringMask(abs(sdHex(rot(q - c1, a1), 0.105)), 0.0019) * breath);
    col = mix(col, base, clamp(0.11 * br, 0.0, 1.0) * ringMask(abs(sdHex(rot(q - c2, a3), 0.100)), 0.0017) * breath);
  }

  /* 6. 线框圆盘：同心圆 + 辐条（持续旋转）+ 中心点 */
  {
    vec2 p = q - (vec2(0.63, 0.46) - 0.5) * su / S;
    float rr = length(p);
    col = mix(col, base, clamp(0.150 * br, 0.0, 1.0) * ringMask(abs(rr - 0.300), 0.0024) * breath);
    col = mix(col, base, clamp(0.100 * br, 0.0, 1.0) * ringMask(abs(rr - 0.385), 0.0020) * breath);
    col = mix(col, base, clamp(0.070 * br, 0.0, 1.0) * ringMask(abs(rr - 0.470), 0.0017) * breath);
    float ang = atan(p.y, p.x) + uTime * 0.28;
    float k = fract(ang / TAU * 28.0);
    float dAng = min(k, 1.0 - k) * (TAU / 28.0);
    float dLine = rr * sin(dAng);
    float within = step(0.300, rr) * step(rr, 0.326);
    col = mix(col, base, clamp(0.160 * br, 0.0, 1.0) * ringMask(dLine, 0.0011) * within * breath);
    col = mix(col, base, clamp(0.070 * br, 0.0, 1.0) * step(rr, 0.055) * breath);
    col = mix(col, base, clamp(0.450 * br, 0.0, 1.0) * step(rr, 0.012));
  }

  /* 7. 散落小方块（静态纹理细节，与 1.3.3 底图一致） */
  {
    float cell = 1.0 / 5.0;
    vec2 cid = floor(q / cell);
    float hh = h21(cid + 17.3);
    vec2 cc = (cid + 0.5) * cell + (vec2(h21(cid + 1.1), h21(cid + 2.2)) - 0.5) * cell * 0.7;
    vec2 dd = abs(q - cc);
    float sz = 0.006 + 0.010 * h21(cid + 3.3);
    float sqa = (0.055 + 0.075 * h21(cid + 4.4)) * br * step(hh, 0.14);
    col = mix(col, base, clamp(sqa, 0.0, 1.0) * step(max(dd.x, dd.y), sz));
  }

  /* 8. 扫描带：周期性自上而下扫过（用户选定的动效） */
  {
    float scz = fract(uTime * 0.055);
    float band = exp(-pow((C.y - scz) * 62.0, 2.0));
    col = mix(col, base, clamp(band * 0.045 * br, 0.0, 1.0));
  }

  /* 9. 边缘压暗 */
  col *= (1.0 - 0.55 * smoothstep(0.25, 0.95, length(q)));

  gl_FragColor = vec4(toLin(clamp(col, 0.0, 1.0)), 1.0);
}
`;

/**
 * 生成二进制字形图集：一张 2×1 的贴图，左格 "0"、右格 "1"，只当遮罩用。
 * 用真实等宽字体渲染，比在片元里现画字形更接近参考图里的数字质感。
 */
export function buildGlyphAtlas(px) {
  var G = Math.max(32, Math.round(px || 128));
  var cv = document.createElement("canvas");
  cv.width = G * 2;
  cv.height = G;
  var c = cv.getContext("2d");
  c.clearRect(0, 0, G * 2, G);
  c.fillStyle = "#ffffff";
  c.font = Math.round(G * 0.84) + "px Menlo, Monaco, Consolas, monospace";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("0", G * 0.5, G * 0.54);
  c.fillText("1", G * 1.5, G * 0.54);
  var t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * 建动态背景层。
 * @param {{mainHex?:string, bright?:number, speed?:number, motion?:boolean}} cfg
 * @returns {{mesh:THREE.Mesh, setMain, setBright, setSpeed, setMotion, setSize, tick, dispose}}
 */
export function createBackgroundLayer(cfg) {
  cfg = cfg || {};
  var st = {
    main: rgb01(cfg.mainHex || "#3fb9ff"),
    bright: (typeof cfg.bright === "number" && isFinite(cfg.bright)) ? cfg.bright : 1,
    speed: (typeof cfg.speed === "number" && isFinite(cfg.speed)) ? cfg.speed : 1,
    motion: cfg.motion !== false,
    t: 0
  };
  var glyph = buildGlyphAtlas(128);
  var uniforms = {
    uRes: { value: new THREE.Vector2(2, 2) },
    uTime: { value: 0 },
    uMain: { value: new THREE.Vector3(st.main[0], st.main[1], st.main[2]) },
    uBright: { value: st.bright },
    uGlyph: { value: glyph }
  };
  var mat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    fog: false
  });
  var geo = new THREE.PlaneGeometry(2, 2);
  var mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;   // 顶点着色器无视变换矩阵，包围盒判定无意义
  mesh.renderOrder = -1000;     // 最先画，铺在一切物体之下
  mesh.matrixAutoUpdate = false;
  mesh.name = "holoBgLayer";

  return {
    mesh: mesh,
    material: mat,
    setMain: function (hex) {
      var c = rgb01(hex);
      uniforms.uMain.value.set(c[0], c[1], c[2]);
    },
    setBright: function (v) { uniforms.uBright.value = (isFinite(v) ? v : 1); },
    setSpeed: function (v) { st.speed = (isFinite(v) ? Math.max(0, v) : 1); },
    setMotion: function (b) { st.motion = !!b; },
    setSize: function (w, h) {
      uniforms.uRes.value.set(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)));
    },
    /** dt 秒；动效关闭时不推进时间轴（画面冻结但依然渲染） */
    tick: function (dt) {
      if (st.motion) st.t += Math.max(0, Math.min(0.1, dt)) * st.speed;
      uniforms.uTime.value = st.t;
    },
    /** 导出静帧时需要「确定的一帧」：直接钉死时间轴 */
    setTime: function (t) { st.t = t; uniforms.uTime.value = t; },
    getTime: function () { return st.t; },
    dispose: function () {
      geo.dispose(); mat.dispose(); glyph.dispose();
    }
  };
}

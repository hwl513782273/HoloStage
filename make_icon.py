#!/usr/bin/env python3
"""HoloStage 图标生成 — SwitchLink 风格：满铺背景 + 大主体，不预烘焙圆角（四角 alpha=0 由蒙版处理）。"""
import math, os, shutil, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter

S = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "AppIcon.iconset")

# ---------- 背景：深空蓝黑渐变 ----------
img = Image.new("RGBA", (S, S))
px = img.load()
top = (8, 16, 34); bottom = (2, 6, 14)
for y in range(S):
    t = y / S
    r = int(top[0] + (bottom[0] - top[0]) * t)
    g = int(top[1] + (bottom[1] - top[1]) * t)
    b = int(top[2] + (bottom[2] - top[2]) * t)
    for x in range(S):
        px[x, y] = (r, g, b, 255)

glow_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
line_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow_layer)
ld = ImageDraw.Draw(line_layer)

CYAN = (63, 185, 255)

# ---------- 透视网格地台（下半部） ----------
def grid_line(p1, p2, draw):
    draw.line([p1, p2], fill=CYAN + (160,), width=3)
horizon_y = 640
cx = S / 2
for i in range(-6, 7):
    # 汇聚到消失点的纵线
    x_bottom = cx + i * 110
    draw_line = ((cx + i * 14, horizon_y), (x_bottom, S + 40))
    grid_line(*draw_line, ld)
for j, yy in enumerate([690, 760, 850, 960]):
    w = (yy - horizon_y) / (S + 40 - horizon_y)
    half = 14 + (6 * 110 - 14) * w
    grid_line((cx - half, yy), (cx + half, yy), ld)

# ---------- 中央全息环 ----------
rcx, rcy, rr = S / 2, 470, 300
gd.ellipse([rcx - rr, rcy - rr, rcx + rr, rcy + rr], outline=CYAN + (200,), width=10)
ld.ellipse([rcx - rr, rcy - rr, rcx + rr, rcy + rr], outline=CYAN + (230,), width=8)
for i in range(18):
    a0 = i * (2 * math.pi / 18)
    a1 = a0 + 2 * math.pi / 18 * 0.55
    r1, r2 = rr + 26, rr + 62
    ld.arc([rcx - r2, rcy - r2, rcx + r2, rcy + r2], start=math.degrees(a0), end=math.degrees(a1),
           fill=CYAN + (140,), width=12)

# ---------- 线框二十面体（主体生物替代） ----------
V = []
phi = (1 + math.sqrt(5)) / 2
for a in (-1, 1):
    for b in (-phi, phi):
        V.append((0, a, b)); V.append((a, b, 0)); V.append((b, 0, a))
# 归一化顶点到单位球
V = [(x / math.sqrt(1 + phi**2), y / math.sqrt(1 + phi**2), z / math.sqrt(1 + phi**2))
     for x, y, z in V]
# 去重
uniq = []
for v in V:
    if not any(abs(v[0]-u[0]) < 1e-4 and abs(v[1]-u[1]) < 1e-4 and abs(v[2]-u[2]) < 1e-4 for u in uniq):
        uniq.append(v)
V = uniq
E = []
for i in range(len(V)):
    for j in range(i + 1, len(V)):
        d = math.dist(V[i], V[j])
        if d < 1.1:  # 单位球二十面体边长 ~1.05
            E.append((i, j))

# 旋转（俯视 + 微倾）
def rot(v, ax, ay):
    x, y, z = v
    # 绕 Y
    x2 = x * math.cos(ay) + z * math.sin(ay)
    z2 = -x * math.sin(ay) + z * math.cos(ay)
    # 绕 X
    y3 = y * math.cos(ax) - z2 * math.sin(ax)
    z3 = y * math.sin(ax) + z2 * math.cos(ax)
    return x2, y3, z3

ax, ay = math.radians(-18), math.radians(24)
mcx, mcy, mr = S / 2, 430, 195
proj = []
for v in V:
    x, y, z = rot(v, ax, ay)
    persp = 2.6 / (2.6 - y * 0.6)
    proj.append((mcx + x * mr * persp, mcy - z * mr * persp))
for i, j in E:
    p1, p2 = proj[i], proj[j]
    ld.line([p1, p2], fill=CYAN + (255,), width=6)
    gd.line([p1, p2], fill=CYAN + (150,), width=10)
    for p in (p1, p2):
        ld.ellipse([p[0]-7, p[1]-7, p[0]+7, p[1]+7], fill=(220, 240, 255, 255))

# ---------- 辉光合成 ----------
glow = glow_layer.filter(ImageFilter.GaussianBlur(14))
glow2 = glow_layer.filter(ImageFilter.GaussianBlur(4))
img = Image.alpha_composite(img, glow)
img = Image.alpha_composite(img, glow2)
img = Image.alpha_composite(img, line_layer)

# ---------- 透明角蒙版（四角 alpha=0，radius=S*0.225） ----------
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S, S], radius=int(S * 0.225), fill=255)
img.putalpha(mask)

# ---------- 输出 iconset（逐档：先 resize 再套蒙版，四角 alpha=0） ----------
if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
# 去掉 alpha 参与缩放，逐档独立套蒙版
flat = Image.new("RGB", (S, S))
flat.paste(img.convert("RGB"), (0, 0))
sizes = [16, 32, 64, 128, 256, 512, 1024]
names = {16: ["icon_16x16.png"], 32: ["icon_16x16@2x.png", "icon_32x32.png"],
         64: ["icon_32x32@2x.png", "icon_64x64.png"], 128: ["icon_128x128.png"],
         256: ["icon_128x128@2x.png", "icon_256x256.png"],
         512: ["icon_256x256@2x.png", "icon_512x512.png"], 1024: ["icon_512x512@2x.png"]}
for s in sizes:
    im = flat.resize((s, s), Image.LANCZOS).convert("RGBA")
    m = Image.new("L", (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s, s], radius=int(s * 0.225), fill=255)
    im.putalpha(m)
    for n in names[s]:
        im.save(os.path.join(OUT, n))
        actual = Image.open(os.path.join(OUT, n)).size
        assert actual == (s, s), f"{n} 尺寸错误 {actual}"
subprocess.run(["iconutil", "-c", "icns", "-o",
                os.path.join(os.path.dirname(OUT), "AppIcon.icns"), OUT], check=True)
print("icon OK ->", os.path.join(os.path.dirname(OUT), "AppIcon.icns"))

"""One-off asset prep. Reads brand/ and reference/, writes public/.
Resizes in premultiplied alpha (the transparent logo has pure-black transparent pixels),
and traces the 32x32 favicon cell grid from real pixel coordinates."""
import json, re, numpy as np
from PIL import Image

SRC = 'brand/LOGO SIZE PNG...png'
im = Image.open(SRC).convert('RGBA')
a = np.array(im)
ys, xs = np.where(a[..., 3] > 0)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
side = max(x1 - x0, y1 - y0)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
pad = round(side * 0.04)
half = side // 2 + pad
box = (cx - half, cy - half, cx + half, cy + half)
crop = im.crop(box)
print('alpha bbox', (x0, y0, x1, y1), 'square box', box)

def premul_resize(img, n):
    return img.convert('RGBa').resize((n, n), Image.LANCZOS).convert('RGBA')

for n in (512, 128):
    premul_resize(crop, n).save(f'public/logo-{n}.png', optimize=True)

# favicon: sample real pixel at each cell centre
N = 32
w = crop.size[0]
step = w / N
px = np.array(crop)
tok = dict(re.findall(r'--([a-z-]+):\s*#([0-9a-fA-F]{6})', open('src/tokens.css', encoding='utf-8').read()))
tokmap = {'deep': 'green-deep', 'dark': 'green-dark', 'mid': 'green', 'lime': 'lime', 'cream': 'cream', 'shade': 'shade'}
pc = {k: np.array([int(tok[v][i:i + 2], 16) for i in (0, 2, 4)]) for k, v in tokmap.items()}
rows = []
for r in range(N):
    runs, cur = [], None
    for c in range(N):
        sx, sy = int((c + .5) * step), int((r + .5) * step)
        p = px[sy, sx]
        key = None
        if p[3] >= 128:
            key = min(pc, key=lambda k: ((pc[k] - p[:3].astype(int)) ** 2).sum())
        if cur and cur[0] == key:
            cur[2] += 1
        else:
            cur = [key, c, 1]
            runs.append(cur)
    rows.append([[k, s, l] for k, s, l in runs if k])
json.dump({'size': N, 'rows': rows}, open('public/favicon.cells.json', 'w'))
print('favicon cells written', sum(len(r) for r in rows), 'runs')

# palette coordinates for the reference banner (ink + neon)
b = np.array(Image.open('reference/SAMPUL SIZE JPG.jpg.jpeg').convert('RGB'))
for name, rgb in {'ink': (252, 252, 252), 'neon': (166, 250, 76)}.items():
    yy, xx = np.where((b == rgb).all(2))
    print(name, rgb, 'at', (int(xx[0]), int(yy[0])) if len(xx) else None)

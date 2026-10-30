"""Palette proof. For every token in src/tokens.css that carries a (x,y) provenance comment,
read the real pixel at that coordinate and compare. Also measures the alpha fringe of the resized logo
(premultiplied resize keeps fringe pixels bright; a straight resize darkens them toward black)."""
import json, re, sys
import numpy as np
from PIL import Image

SRC = {'logo': 'brand/LOGO SIZE PNG.png', 'banner': 'reference/SAMPUL SIZE JPG.jpg.jpeg'}
css = open('src/tokens.css', encoding='utf-8').read()
imgs = {k: np.array(Image.open(v).convert('RGB')) for k, v in SRC.items()}
out = {'checked': 0, 'bad': []}
for m in re.finditer(r'--([a-z-]+):\s*(#[0-9a-fA-F]{6});\s*/\*\s*(logo|banner)\s*\((\d+),(\d+)\)', css):
    name, hx, src, x, y = m.group(1), m.group(2).lower(), m.group(3), int(m.group(4)), int(m.group(5))
    px = imgs[src][y, x]
    real = '#%02x%02x%02x' % tuple(int(v) for v in px)
    out['checked'] += 1
    if real != hx:
        out['bad'].append({'token': name, 'declared': hx, 'pixel': real, 'at': [x, y]})
declared = len(re.findall(r'--[a-z-]+:\s*#[0-9a-fA-F]{6}', css))
out['declared'] = declared

a = np.array(Image.open('public/logo-512.png').convert('RGBA'))
edge = a[(a[..., 3] > 0) & (a[..., 3] < 255)]
out['fringe_px'] = int(len(edge))
out['fringe_mean_max_channel'] = float(edge[:, :3].max(1).mean()) if len(edge) else None
src = np.array(Image.open('brand/LOGO SIZE PNG...png').convert('RGBA'))
out['source_pure_black_transparent'] = int(((src[..., 3] == 0) & (src[..., :3].sum(2) == 0)).sum())
print(json.dumps(out))
sys.exit(0)

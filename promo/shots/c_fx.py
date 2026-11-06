import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from lib import *
from PIL import Image, ImageFilter
import numpy as np


def bout(t, k=1.70158):
    t = clamp(t) - 1
    return 1 + (k + 1) * t ** 3 + k * t ** 2


def spr(im, w, r=0):
    h = round(im.height * w / im.width)
    s = im.convert('RGBA').resize((w, h), Image.LANCZOS)
    return s.rotate(r, Image.BICUBIC, expand=True) if r else s


def shd(sp, b=16, o=0.6, pad=48):
    m = Image.new('L', (sp.width + 2 * pad, sp.height + 2 * pad), 0)
    m.paste(sp.getchannel('A').point(lambda v: int(v * o)), (pad, pad))
    s = Image.new('RGBA', m.size, (0, 0, 0, 255))
    s.putalpha(m.filter(ImageFilter.GaussianBlur(b)))
    return s


def put(cv, sp, cx, cy, k=1.0, a=1.0, rs=Image.BILINEAR):
    if k != 1:
        sp = sp.resize((max(1, round(sp.width * k)), max(1, round(sp.height * k))), rs)
    m = sp.getchannel('A')
    if a < 1:
        m = m.point(lambda v: int(v * a))
    cv.paste(sp, (round(cx - sp.width / 2), round(cy - sp.height / 2)), m)


def zoom(im, k, px, py, dx=0, dy=0):
    if k == 1 and not dx and not dy:
        return im
    x0, y0 = px - px / k - dx / k, py - py / k - dy / k
    return im.transform((W, H), Image.AFFINE, (1 / k, 0, x0, 0, 1 / k, y0), Image.BICUBIC, fillcolor=C['bg'])


def extra(g, sz):
    d = OUTS / 'promo_runs' / g
    if not d.exists():
        return []
    r = []
    for p in sorted(d.rglob('*.png')):
        if Image.open(p).size == sz:
            r.append(p)
    return r


def hits(cx, cy, w, h, box=(80, 780, 1020, 1020)):
    return not (cx + w / 2 < box[0] or cx - w / 2 > box[2] or cy + h / 2 < box[1] or cy - h / 2 > box[3])


def run(i, fn):
    n = shot(i)['dur']
    w = Wr(SEG / f'{i}.mp4')
    for f in range(n):
        w.put(fn(f))
    print(i, w.close(), 'frames')

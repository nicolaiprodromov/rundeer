import sys, pathlib, random
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw
from lib import *

GOLD = C['gold']


def pp(i):
    return OUTS / f'poster_{i:03d}.png'


def tp(i):
    return OUTS / f'poster_tex_{i}_01.png'


@lru_cache(None)
def ld(p):
    return Image.open(p).convert('RGB')


@lru_cache(None)
def sc(p, w, h, md='contain'):
    im = ld(p)
    return contain(im, w, h) if md == 'contain' else fit(im, w, h)


@lru_cache(None)
def mo(i):
    return [f for f in frames(OUTS / 'motion_posters' / f'motion_{i}.mp4', 1080, 1350)]


def mof(i, f):
    a = mo(i)
    return a[int(f * 12 / FPS) % len(a)]


def ctr(cv, im, cx=W // 2, cy=H // 2):
    cv.paste(im, (round(cx - im.width / 2), round(cy - im.height / 2)))
    return cv


def zoom(im, s, cx=0.5, cy=0.5):
    if abs(s - 1) < 1e-4:
        return im
    w, h = im.size
    cw, ch = w / s, h / s
    x0, y0 = (w - cw) * cx, (h - ch) * cy
    return im.resize((w, h), Image.BILINEAR, box=(x0, y0, x0 + cw, y0 + ch))


def pk(f, a=1.07, n=5):
    return lerp(a, 1.0, eout(f / n))


def tag(cv, t, x=None, y=None, sz=18, c=None, bgc=C['bg']):
    d = ImageDraw.Draw(cv)
    fn = font('mono', sz)
    b = d.textbbox((0, 0), t, font=fn)
    tw, th = b[2] - b[0], b[3] - b[1]
    x = W - 64 - tw if x is None else x
    y = H - 64 - th if y is None else y
    if bgc:
        d.rectangle((x - 10, y - 8, x + tw + 10, y + th + 10), fill=bgc)
    d.text((x - b[0], y - b[1]), t, font=fn, fill=c or C['soft'])
    return cv


@lru_cache(None)
def wm_img(sz=260):
    fn = font('bold', sz)
    b = fn.getbbox('rundeer')
    im = Image.new('L', (b[2] - b[0] + 8, b[3] - b[1] + 8), 0)
    ImageDraw.Draw(im).text((4 - b[0], 4 - b[1]), 'rundeer', font=fn, fill=255)
    return im


def wordmark(f, sub):
    cv = canvas()
    m = wm_img()
    s = lerp(1.32, 1.0, eout(f / 5))
    mm = m.resize((round(m.width * s), round(m.height * s)), Image.LANCZOS) if s != 1 else m
    cy = H // 2 - 34
    x, y = W // 2 - mm.width // 2, cy - mm.height // 2
    col = Image.new('RGB', mm.size, C['text'])
    cv.paste(col, (x, y), mm)
    if f >= 6:
        d = ImageDraw.Draw(cv)
        fn = font('mono', 28)
        k = min(len(sub), int((f - 6) * 4))
        t = sub[:k]
        full = d.textbbox((0, 0), sub, font=fn)
        tx = W // 2 - (full[2] - full[0]) // 2
        ty = cy + m.height // 2 + 58
        d.text((tx, ty), t, font=fn, fill=C['soft'])
        cw = d.textlength('M', font=fn)
        if k < len(sub) or (f // 8) % 2 == 0:
            cx = tx + d.textlength(t, font=fn) + (6 if k else 0)
            d.rectangle((cx, ty + 2, cx + cw * 0.62, ty + 30), fill=GOLD)
    return cv


def pal(p, q=12):
    a = np.asarray(ld(p).resize((216, 270)), np.float32).reshape(-1, 3)
    l = a @ np.array([0.299, 0.587, 0.114], np.float32)
    lo, hi = np.percentile(l, q), np.percentile(l, 100 - q)
    return [tuple(int(v) for v in a[m].mean(0)) for m in (l <= lo, l >= hi)]


def run(sid, gen):
    n = shot(sid)['dur']
    w = Wr(SEG / f'{sid}.mp4')
    for f in range(n):
        w.put(gen(f))
    k = w.close()
    k2 = nframes(SEG / f'{sid}.mp4')
    print(sid, k, k2, 'OK' if k2 == n else 'MISMATCH')


@lru_cache(None)
def scd(p, q, h, k):
    im = sc(p, q, h, 'fit')
    return im if k >= 1 else im.point(lambda v: int(v * k))


def dep(z, d):
    return 1 / (1 / z + d)


class Sc:
    def __init__(s):
        s.it = []

    def add(s, src, x, y, w, h, dp=0.0, dim=1.0, t0=-99, sh=False):
        s.it.append(dict(src=src, x=x, y=y, w=w, h=h, dp=dp, dim=dim, t0=t0, sh=sh))

    def base(s, it, pw, f):
        src = it['src']
        if callable(src):
            im = src(f)
            return im if it['dim'] >= 1 else im.point(lambda v, k=it['dim']: int(v * k))
        q = min(2048, max(8, 2 ** round(np.log2(max(pw, 8)))))
        return scd(src, q, max(1, round(q * it['h'] / it['w'])), it['dim'])

    def draw(s, f, cx, cy, z, par=dep, cv=None):
        cv = cv or canvas()
        d = ImageDraw.Draw(cv)
        for it in s.it:
            if f < it['t0']:
                continue
            zz = par(z, it['dp'])
            a = f - it['t0']
            pz = lerp(1.18, 1.0, eout(a / 4)) if it['t0'] > -99 else 1.0
            w, h = it['w'] * zz * pz, it['h'] * zz * pz
            x = W / 2 + (it['x'] + it['w'] / 2 - cx) * zz - w / 2
            y = H / 2 + (it['y'] + it['h'] / 2 - cy) * zz - h / 2
            if x >= W or y >= H or x + w <= 0 or y + h <= 0 or w < 2 or h < 2:
                continue
            if it['sh']:
                o = max(2, round(14 * zz))
                d.rectangle((round(x) + o, round(y) + o, round(x + w) + o, round(y + h) + o), fill=C['deep'])
            x0, y0, x1, y1 = max(0, round(x)), max(0, round(y)), min(W, round(x + w)), min(H, round(y + h))
            if x1 <= x0 or y1 <= y0:
                continue
            if a < 1 and it['t0'] > -99:
                d.rectangle((x0, y0, x1 - 1, y1 - 1), fill=C['text'])
                continue
            b = s.base(it, w, f)
            kx, ky = b.width / w, b.height / h
            bx = (max(0, (x0 - x) * kx), max(0, (y0 - y) * ky), min(b.width, (x1 - x) * kx), min(b.height, (y1 - y) * ky))
            cv.paste(b.resize((x1 - x0, y1 - y0), Image.BILINEAR, box=bx), (x0, y0))
        return cv

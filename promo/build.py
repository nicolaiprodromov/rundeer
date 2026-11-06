import sys
import numpy as np
from PIL import Image, ImageDraw
from lib import *

SP = spec()
G = SP['graphs']
TOT = SP['fmt']['total']
M = SP['safe']['hud_margin']
BX = SP['safe']['caption_box']
FK, FT, FL = font('mono', 21), font('bold', 66), font('mono', 21)
FH = font('mono', 16)
NOHUD = {'cold_open': 88, 'outro': 73}
HL = {'cold_open': '.rundeer/outputs/', 'mont_tex': '.rundeer/outputs/poster_tex_*.png → poster_*.png', 'mont_fire': '.rundeer/outputs/poster_000-029.png', 'mont_wall': '.rundeer/outputs/ · 60 files', 'tk_out': '.rundeer/outputs/tickets/', 'zn_out': '.rundeer/outputs/riso_zine/', 'sp_out': '.rundeer/outputs/specimen/', 'mo_out': '.rundeer/outputs/motion_posters/', 'outro': ''}
STK = {'stroke_width': 2, 'stroke_fill': (0, 0, 0, 150)}


def txt(s, f, col, sp=0):
    if '\n' in s:
        b = ImageDraw.Draw(Image.new('RGBA', (1, 1))).multiline_textbbox((0, 0), s, font=f, spacing=6)
        im = Image.new('RGBA', (b[2] + 4, b[3] + 8), (0, 0, 0, 0))
        ImageDraw.Draw(im).multiline_text((0, 0), s, font=f, fill=col, spacing=6)
        return im
    b = f.getbbox(s)
    w = b[2] + sp * len(s) + 4
    im = Image.new('RGBA', (w, b[3] + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if sp:
        x = 0
        for ch in s:
            d.text((x, 0), ch, font=f, fill=col)
            x += f.getlength(ch) + sp
    else:
        d.text((0, 0), s, font=f, fill=col)
    return im


def fade(im, a):
    if a >= 1:
        return im
    r = im.copy()
    r.putalpha(im.getchannel('A').point(lambda v: int(v * a)))
    return r


def scrim():
    w, h = BX[2] + 420, H - BX[1] + 220
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((x / w) ** 2 + ((h - y) / h) ** 2)
    t = np.clip(1 - (d - 0.35) / 0.65, 0, 1)
    a = 215 * t * t * (3 - 2 * t) + np.random.default_rng(0).uniform(-1.5, 1.5, (h, w))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'L'), (0, H - h)


SM, SO = scrim()


def cap(c):
    return {'t': c['t'], 'k': c['kicker'], 'kim': txt(c['kicker'], FK, C['gold'], 2), 'tim': txt(c['title'], FT, C['text']), 'lim': txt(c['line'], FL, C['muted'], 2)}


def put_cap(fr, c, f):
    a, b = c['t']
    if f < a or f > b:
        return
    io = min(1, (b - f) / 6)
    y = BX[3]
    for im, d in [(c['lim'], 0), (c['tim'], 3), (c['kim'], 6)]:
        y -= im.height + (14 if im is c['tim'] else 6)
        p = eout((f - a - (6 - d)) / 10) * io
        if p <= 0:
            continue
        o = int((1 - p) * 18)
        if im is c['kim']:
            n = int(len(c['k']) * clamp((f - a) / 10))
            im = im.crop((0, 0, max(1, int(im.width * n / max(1, len(c['k'])))), im.height))
        fr.alpha_composite(fade(im, p), (BX[0], y + o))


def hud(fr, gf, s, a):
    if a <= 0:
        return
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    q, mu, gl = C['quiet'] + (255,), C['muted'] + (255,), C['gold'] + (255,)
    for x0, y0, sx, sy in [(M, M, 1, 1), (W - M, M, -1, 1), (M, H - M, 1, -1), (W - M, H - M, -1, -1)]:
        d.line([(x0, y0), (x0 + 22 * sx, y0)], fill=q, width=1)
        d.line([(x0, y0), (x0, y0 + 22 * sy)], fill=q, width=1)
    d.text((M + 34, M - 9), 'rundeer', font=FH, fill=gl, **STK)
    d.text((M + 34 + FH.getlength('rundeer '), M - 9), '/ node workbench for AI image & video', font=FH, fill=mu, **STK)
    sec, ff = divmod(gf, FPS)
    tc = f'TC 00:{sec // 60:02d}:{sec % 60:02d}:{ff:02d}'
    d.text((W - M - 34 - FH.getlength(tc), M - 9), tc, font=FH, fill=mu, **STK)
    g = s.get('graph')
    lab = f'.rundeer/graphs/{G[g]["file"]}.json' if g else HL.get(s['id'], '')
    if lab:
        d.text((W - M - 34 - FH.getlength(lab), H - M - 9), lab, font=FH, fill=mu, **STK)
    px = int((W - 2 * M - 68) * gf / (TOT - 1))
    d.line([(M + 34, H - M), (M + 34 + px, H - M)], fill=gl, width=1)
    fr.alpha_composite(fade(L, a))


def ph(s):
    im = canvas()
    ImageDraw.Draw(im).text((W // 2 - 300, H // 2 - 40), f'[{s["id"]}] missing', font=font('mono', 60), fill=C['quiet'])
    return im


def src(s):
    p = SEG / f'{s["id"]}.mp4'
    n = s['dur']
    if not p.exists():
        print('missing', s['id'])
        im = ph(s)
        for _ in range(n):
            yield im
        return
    k, last = 0, None
    for im in frames(p):
        if k >= n:
            break
        last = im
        yield im
        k += 1
    if k < n:
        print('short', s['id'], k, n)
    while k < n:
        yield last
        k += 1


def run(out, only=None):
    w = Wr(out)
    gf = 0
    for s in SP['shots']:
        if only and s['id'] not in only:
            gf += s['dur']
            continue
        cs = [cap(c) for c in s.get('captions', [])]
        for f, im in enumerate(src(s)):
            fr = im.convert('RGBA')
            v = 0
            for c in cs:
                a, b = c['t']
                if a <= f <= b:
                    v = max(v, eout((f - a) / 8) * min(1, (b - f) / 6))
            if v > 0:
                blk = Image.new('RGBA', SM.size, (0, 0, 0, 255))
                blk.putalpha(SM.point(lambda x: int(x * v)))
                fr.alpha_composite(blk, SO)
            for c in cs:
                put_cap(fr, c, f)
            hud(fr, gf + f, s, clamp((NOHUD[s['id']] - f) / 6) if s['id'] in NOHUD else 1.0)
            w.put(fr)
        gf += s['dur']
    print(out, w.close())


if __name__ == '__main__':
    a = sys.argv[1:]
    run(OUT / (a[0] if a else 'rundeer_promo_60s.mp4'), set(a[1:]) or None)

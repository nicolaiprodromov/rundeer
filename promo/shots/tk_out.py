import sys, pathlib, math
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from c_fx import *

TW, PF, D, T0 = 1060, 1365 / 1800, 6, 75
SPOTS = [(880, 278, 6), (1340, 318, -6), (1000, 520, -4), (1300, 470, 5), (900, 300, 4), (1325, 335, -5), (1000, 520, 4), (1320, 612, -3)]

old = sorted((OUTS / 'tickets').glob('ticket_*.png'))
nw = extra('ticket_generator', (1800, 640))
nw = nw[1:] + nw[:1]
ps = ([x for pr in zip(nw, old) for x in pr] + old[len(nw):])[-len(SPOTS):]
n = len(ps)
SP = SPOTS[-n:]
LD = [5 + round(i * min(15, 52.5 / max(1, n - 1))) for i in range(n)]
IM = [Image.open(p).convert('RGBA').resize((TW, round(TW * 640 / 1800)), Image.LANCZOS) for p in ps]
TS = [im.rotate(s[2], Image.BICUBIC, expand=True) for im, s in zip(IM, SP)]
SH = [shd(t, 20, 0.85) for t in TS]
px = round(TW * PF)
MAIN, STUB = IM[-1].crop((0, 0, px, IM[-1].height)), IM[-1].crop((px, 0, TW, IM[-1].height))


def torn(t):
    p = 90
    c = Image.new('RGBA', (TW + 2 * p, IM[-1].height + 2 * p), (0, 0, 0, 0))
    c.alpha_composite(MAIN, (p, p))
    s = STUB.rotate(-7 * t, Image.BICUBIC, expand=True)
    cx, cy = p + px + STUB.width / 2 + 28 * t, p + STUB.height / 2 + 30 * t
    c.alpha_composite(s, (round(cx - s.width / 2), round(cy - s.height / 2)))
    r = c.rotate(SP[-1][2], Image.BICUBIC, expand=True)
    return r, shd(r, 20, 0.85)


def frame(f):
    cv = canvas()
    for i in range(n):
        u = (f - (LD[i] - D)) / D
        if u < 0:
            continue
        e = eout(u)
        k, dr, dy = 1 + 0.55 * (1 - e), (9 if (n - i) % 2 else -9) * (1 - e), -50 * (1 - e)
        cx, cy, a = SP[i]
        t, s = TS[i], SH[i]
        if i == n - 1 and f >= T0:
            t, s = torn(eout((f - T0) / 9))
        if dr:
            t = t.rotate(dr, Image.BILINEAR, expand=True)
        air = k - 1
        put(cv, s, cx + 14 + air * 140, cy + dy + 26 + air * 220, k * (1 + air * 0.3), clamp(1 - air * 1.3) * clamp(u * 2))
        put(cv, t, cx, cy + dy, k, clamp(u * 2.5))
    sx = sy = 0
    for L in LD:
        if f >= L:
            a = 7 * math.exp(-(f - L) / 2.5)
            sx += a * math.sin((f - L) * 2.1)
            sy += a * math.cos((f - L) * 1.7)
    return zoom(cv, 1 + 0.025 * eio((f - LD[-1]) / (89 - LD[-1])), 1200, 560, sx - 30, sy)


if __name__ == '__main__':
    run('tk_out', frame)

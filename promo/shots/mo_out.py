import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from c_fx import *

HB, HX, HY = 940, 1404, 540
TH, TY, GAP = 700, 402, 48
T1, T2, T3 = 45, 45, 52
NF = 36

vs = sorted((OUTS / 'motion_posters').glob('motion_*.mp4'))
d = OUTS / 'promo_runs' / 'motion_poster'
vs += sorted(d.rglob('*.mp4')) if d.exists() else []
CL = [list(frames(p, 1080, 1350))[:NF] for p in vs[:3]]
TW = round(TH * 1080 / 1350)
XS = [W / 2 + (j - 1) * (TW + GAP) for j in range(3)]
FM = font('mono', 16)


def si(f):
    return f * 12 // 30 % NF


def mx(k, a):
    return tuple(round(lerp(b, c, a)) for b, c in zip(C['bg'], C[k]))


def bar(cv, j, f, a):
    x0, y, p = XS[j] - TW / 2, TY + TH / 2 + 16, (si(f) + 1) / NF
    d = ImageDraw.Draw(cv)
    d.rectangle((x0, y, x0 + TW, y + 1), fill=mx('line', a))
    d.rectangle((x0, y, x0 + TW * p, y + 1), fill=mx('muted', a))
    d.rectangle((x0 + TW * p - 2, y - 3, x0 + TW * p + 1, y + 4), fill=mx('gold' if j == 1 else 'soft', a))
    d.text((x0, y + 12), vs[j].name, font=FM, fill=mx('quiet', a))
    d.text((x0 + TW, y + 12), f'{si(f) + 1:02d}/{NF}', font=FM, fill=mx('quiet', a), anchor='ra')


def clip(cv, j, f, cx, cy, h):
    im = CL[j][si(f)]
    w = round(h * 1080 / 1350)
    cv.paste(im.resize((w, round(h)), Image.BICUBIC), (round(cx - w / 2), round(cy - h / 2)))


def frame(f):
    cv = canvas()
    e0 = eout(f / 8)
    m, n = eout((f - T1) / 12), eout((f - T1) / 6)
    clip(cv, 1, f, lerp(HX, XS[1], m), lerp(HY, TY, n), lerp(HB, TH, n) * (1 + 0.06 * (1 - e0)))
    for j, t, s in ((0, T2, -1), (2, T3, 1)):
        u = eout((f - t) / 11)
        if u > 0:
            clip(cv, j, f, XS[j] + s * (1 - u) * 900, TY, TH * (1 + 0.04 * (1 - u)))
    a = eout((f - 66) / 8)
    if a > 0:
        for j in range(3):
            bar(cv, j, f, a)
    return cv


if __name__ == '__main__':
    run('mo_out', frame)

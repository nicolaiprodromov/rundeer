from bkit import *
from PIL import ImageFilter

PR = [13, 8, 14]
PW, PH = 736, 920
PX, PY = W - 96 - PW, (H - PH) // 2


@lru_cache(None)
def gm():
    x = np.linspace(0, 1, W)[None, :]
    y = np.linspace(0, 1, H)[:, None]
    g = 0.28 * np.clip(x * 1.6, 0, 1) * np.clip(1.3 - y, 0.25, 1)
    return g[..., None]


@lru_cache(None)
def bgd(p):
    b = fit(ld(p), W // 8, H // 8).filter(ImageFilter.GaussianBlur(3)).resize((W, H), Image.BILINEAR)
    return (np.asarray(b, np.float32) * gm()).astype(np.uint8)


@lru_cache(None)
def pan(p):
    return np.asarray(fit(ld(p), PW, PH))


def smear(a, b, e, bw):
    o = a.copy()
    if e <= 0:
        return o
    e = min(e, a.shape[1])
    o[:, :e] = b[:, :e]
    k = min(bw, a.shape[1] - e)
    if k > 0:
        al = np.linspace(1, 0, k, dtype=np.float32)[None, :, None] ** 1.6
        col = b[:, e - 1:e].astype(np.float32)
        o[:, e:e + k] = (col * al + a[:, e:e + k] * (1 - al)).astype(np.uint8)
    return o


ST = ['smear', 'blur', 'grain', 'dither', 'duotone', 'layout']


def lbl(cv, i, a):
    d = ImageDraw.Draw(cv)
    fm, fb = font('mono', 22), font('monob', 22)
    x, y = 96, 92
    ph = a >= 17
    k = max(0, min(len(ST), (a - 4) * len(ST) // 10 + 1)) if a >= 4 else 0
    d.text((x, y), f'{i + 1:02d}', font=fb, fill=GOLD)
    d.text((x + 44, y), '/ 03', font=fm, fill=C['quiet'])
    d.text((x, y + 58), f'poster_tex_{PR[i]}_01.png', font=fm, fill=C['text'])
    d.text((x, y + 88), '1776 × 2368 · AI TEXTURE', font=fm, fill=C['muted'])
    for j, t in enumerate(ST):
        yy = y + 146 + j * 36
        on = j < k
        cur = on and j == k - 1 and not ph
        d.rectangle((x + 2, yy + 4, x + 12, yy + 14), fill=GOLD if cur else (C['soft'] if on else C['line']))
        d.text((x + 30, yy - 2), t, font=fm, fill=C['text'] if cur else (C['muted'] if on else C['line']))
    yy = y + 146 + len(ST) * 36 + 22
    d.text((x, yy), f'poster_{PR[i]:03d}.png', font=fm, fill=C['text'] if ph else C['line'])
    d.text((x, yy + 30), '1080 × 1350 · GRAPH OUTPUT', font=fm, fill=C['muted'] if ph else C['line'])
    d.text((PX, PY - 40), 'STEP N' if ph else 'STEP 1', font=fb, fill=C['soft'])


def gen(f):
    i, a = divmod(f, 30)
    n = PR[i]
    T, P = pan(tp(n)), pan(pp(n))
    bt, bp = bgd(tp(n)), bgd(pp(n))
    w = eout((a - 15) / 6) if a >= 15 else 0.0
    e = round(w * PW) if w < 1 else PW + 400
    pn = smear(T, P, e, 220)
    bg = smear(bt, bp, round(w * W) if w < 1 else W + 600, 600)
    cv = Image.fromarray(bg)
    s = pk(a, 1.08, 4) if a < 15 else (pk(a - 15, 1.025, 5) if a < 21 else 1.0)
    im = Image.fromarray(pn)
    if a < 1:
        im = Image.new('RGB', im.size, C['text'])
    if s != 1:
        im = im.resize((round(PW * s), round(PH * s)), Image.BILINEAR)
    ctr(cv, im, PX + PW / 2, PY + PH / 2)
    if 15 <= a < 21 and 0 < e < PW:
        ImageDraw.Draw(cv).rectangle((PX + e - 2, PY, PX + e + 1, PY + PH), fill=C['text'])
    lbl(cv, i, a)
    return cv


if __name__ == '__main__':
    run('mont_tex', gen)

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from c_fx import *

PH, RT = 700, [-2, 1.8]
SL = [(890, 418), (1460, 590)]
ST = [0, 7]
WP = [(15, 25), (22, 32), (30, 40), (37, 47)]


def plates(pg):
    a = np.asarray(pg.convert('RGB'), float) / 255 + 1e-3
    L = a.sum(2)
    pa = np.median(a[L >= np.percentile(L, 99.5)], 0)
    d = -np.log(np.clip(a / pa, 1e-3, 1))
    v = d.reshape(-1, 3)
    m = np.linalg.norm(v, axis=1)
    u = v[m > 0.25] / m[m > 0.25, None]
    c = u.mean(0)
    _, _, vt = np.linalg.svd(u - c, full_matrices=False)
    t = (u - c) @ vt[0]
    i1, i2 = np.argsort(t)[[int(len(t) * 0.01), int(len(t) * 0.99)]]
    k = np.stack([u[i1], u[i2]], 1)
    cf = np.linalg.lstsq(k, v.T, rcond=None)[0].T
    mx = np.percentile(cf, 99.5, axis=0)
    cf, ik = np.clip(cf / mx, 0, 1), np.exp(-k * mx)
    o = cf.mean(0).argmin()
    cv = cf[:, o].reshape(a.shape[:2])[..., None]
    one = pa * (1 - cv * (1 - ik[:, o]))
    return Image.fromarray((np.clip(one, 0, 1) * 255).astype(np.uint8)), tuple(int(x * 255) for x in ik[:, o])


pgs = sorted((OUTS / 'riso_zine').glob('page_*.png'))[:2]
phs = [OUTS / f'zine_photo_{i}_01.png' for i in range(2)]
PW = round(PH * 1080 / 1528)
PG = [Image.open(p).convert('RGB').resize((PW, PH), Image.LANCZOS) for p in pgs]
PL = [plates(p) for p in PG]
PO = [fit(Image.open(p).convert('L'), PW, PH).convert('RGB') for p in phs]


def page(i, f):
    a, b = WP[2 * i], WP[2 * i + 1]
    y1 = round(PH * eout((f - a[0]) / (a[1] - a[0])))
    y2 = round(PH * eout((f - b[0]) / (b[1] - b[0])))
    im = PO[i].copy()
    if y1 > 0:
        im.paste(PL[i][0].crop((0, 0, PW, y1)), (0, 0))
    if y2 > 0:
        im.paste(PG[i].crop((0, 0, PW, y2)), (0, 0))
    d = ImageDraw.Draw(im)
    for y, c in ((y1, PL[i][1]), (y2, None)):
        if 0 < y < PH:
            d.rectangle((0, y - 3, PW, y + 1), fill=c or (250, 245, 232))
    return im


def frame(f):
    cv = canvas()
    for i in range(2):
        u = (f - ST[i]) / 7
        if u < 0:
            continue
        e = eout(u)
        k = 1 + 0.18 * (1 - e)
        sp = page(i, f).convert('RGBA').rotate(RT[i] + (6 if i else -6) * (1 - e), Image.BICUBIC, expand=True)
        cx, cy = SL[i]
        air = k - 1
        put(cv, shd(sp, 18, 0.9), cx + 14 + air * 160, cy + 24 + air * 240, k, clamp(1 - air * 3))
        put(cv, sp, cx, cy - 40 * (1 - e), k, clamp(u * 2.5))
    return zoom(cv, 1 + 0.03 * eio((f - 47) / 42), 1140, 560)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        for i, (im, c) in enumerate(PL):
            im.save(sys.argv[1] + f'/zp{i}.png')
            print(c)
    else:
        run('zn_out', frame)

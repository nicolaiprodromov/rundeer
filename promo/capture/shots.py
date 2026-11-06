import io, json, sys, pathlib
import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import lib
from pw import App, GR

W, H = lib.W, lib.H
G = {k: v['file'] for k, v in lib.spec()['graphs'].items()}
TEST = pathlib.Path(__file__).resolve().parent / 'test'


def nb(bx, t):
    t, _, y = t.partition('@')
    m = [b for b in bx.values() if b['t'] == t and (not y or b['type'] == y)]
    if len(m) != 1:
        raise KeyError(f'{t}: {len(m)} matches')
    return m[0]


def uni(bs):
    x0 = min(b['x'] for b in bs)
    y0 = min(b['y'] for b in bs)
    x1 = max(b['x'] + b['w'] for b in bs)
    y1 = max(b['y'] + b['h'] for b in bs)
    return x0, y0, x1, y1


def fit(r, a):
    x0, y0, x1, y1 = r
    ax0, ay0, ax1, ay1 = a
    z = min((ax1 - ax0) / (x1 - x0), (ay1 - ay0) / (y1 - y0))
    sx, sy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
    return cam_at((x0 + x1) / 2, (y0 + y1) / 2, sx, sy, z)


def cam_at(cx, cy, sx, sy, z):
    return (cx + (W / 2 - sx) / z, cy + (H / 2 - sy) / z, z)


def zoom_path(a, b, t):
    s0, s1 = 1 / a[2], 1 / b[2]
    s = s0 * (s1 / s0) ** t
    k = 0 if abs(s1 - s0) < 1e-9 else (s - s0) / (s1 - s0)
    return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 1 / s)


def pan_path(a, b, t):
    return (lib.lerp(a[0], b[0], t), lib.lerp(a[1], b[1], t), a[2] * (b[2] / a[2]) ** t)


def put(app, c):
    cx, cy, z = c
    app.cam(W / 2 - cx * z, H / 2 - cy * z, z)


def grab(app):
    return Image.open(io.BytesIO(app.shot())).convert('RGB').resize((W, H), Image.LANCZOS)


def mv_reveal(bx, n):
    p = nb(bx, 'Posters@preview')
    img = (p['x'] + 60, p['y'] + 145, p['x'] + p['w'] - 60, p['y'] + p['h'] - 87)
    a = fit(img, (1180 - 360, 520 - 356, 1180 + 360, 520 + 356))
    b = fit(uni(list(bx.values())), (300, 70, 1860, 1010))
    m = n - 20

    def g(f):
        if f <= m - 1:
            return zoom_path(a, b, lib.eio(f / (m - 1)))
        u = (f - m + 1) / 20
        return (b[0], b[1], b[2] * (1 + 0.012 * u))
    return g


def mv_glide(bx, n, src, dst, z0, z1, top=90):
    a0 = nb(bx, src)
    a1 = nb(bx, dst)
    s = cam_at(a0['x'] - 60, -40, 0, top, z0)
    e = cam_at(a1['x'] + a1['w'] + 60, -40, W, top, z1)
    return lambda f: pan_path(s, e, lib.ease(f / (n - 1)))


def anchored(r, a, ax, ay, sx, sy):
    z = min((a[2] - a[0]) / (r[2] - r[0]), (a[3] - a[1]) / (r[3] - r[1]))
    px, py = lib.lerp(r[0], r[2], ax), lib.lerp(r[1], r[3], ay)
    return z, px, py, sx, sy


def mv_push(bx, n, targets, k=1.12):
    r = uni([nb(bx, t) for t in targets])
    opts = [anchored(r, (1016, 70, 1860, 1010), 0, 0.5, 1016, 540), anchored(r, (90, 70, 1830, 780), 0.5, 0, 960, 70)]
    z1, px, py, sx, sy = max(opts, key=lambda o: o[0])
    z0 = z1 / k
    return lambda f: cam_at(px, py, sx, sy, z0 * (z1 / z0) ** lib.eio(f / (n - 1)))


def tg(i):
    return lib.shot(i)['targets']


SH = {
    'reveal': ('lpp', 1, lambda bx, n: mv_reveal(bx, n)),
    'tk_glide': ('tk', 3, lambda bx, n: mv_glide(bx, n, 'Ticket Count', 'Tickets@preview', 0.58, 0.66)),
    'tk_detail': ('tk', 1, lambda bx, n: mv_push(bx, n, tg('tk_detail'))),
    'zn_glide': ('zn', 3, lambda bx, n: mv_glide(bx, n, 'Page Count', 'Pages@preview', 0.58, 0.66)),
    'zn_detail': ('zn', 1, lambda bx, n: mv_push(bx, n, tg('zn_detail'))),
    'sp_glide': ('sp', 3, lambda bx, n: mv_glide(bx, n, 'Sheet Count', 'Sheets@preview', 0.58, 0.66)),
    'sp_detail': ('sp', 1, lambda bx, n: mv_push(bx, n, tg('sp_detail'))),
    'mo_glide': ('mo', 3, lambda bx, n: mv_glide(bx, n, 'Poster Count', 'Motion Posters', 0.52, 0.6)),
    'mo_detail': ('mo', 1, lambda bx, n: mv_push(bx, n, tg('mo_detail'))),
}


def hblur(im, r):
    if r < 1:
        return im
    a = np.asarray(im, dtype=np.float32)
    p = np.pad(a, ((0, 0), (r + 1, r), (0, 0)), mode='edge')
    c = np.cumsum(p, axis=1)
    o = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    return Image.fromarray(np.clip(o + 0.5, 0, 255).astype(np.uint8))


def frame(app, g, i, n, m, sh=0.3):
    c = g(i)
    put(app, c)
    app.seek((int(i * 12 / lib.FPS) % 36 + 0.5) / 12)
    im = grab(app)
    if m == 1:
        return im
    a, b = g(max(0, i - 0.5)), g(min(n - 1, i + 0.5))
    d = abs((b[0] - a[0]) * c[2]) * sh
    return hblur(im, int(round(d / 2)))


def prep(app, g):
    data = json.loads((GR / f'{G[g]}.cap.json').read_text(encoding='utf-8'))
    app.load(data)
    app.pg.evaluate('() => frameAll()')
    app.settle(120000)
    app.pg.wait_for_timeout(800)
    return app.boxes()


def run(ids, test=None):
    app = App(dsf=2)
    cur = None
    try:
        for i in ids:
            gk, m, mv = SH[i]
            if gk != cur:
                bx = prep(app, gk)
                cur = gk
            n = lib.shot(i)['dur']
            g = mv(bx, n)
            if test is not None:
                TEST.mkdir(exist_ok=True)
                fs = [min(n - 1, f if f >= 0 else n + f) for f in test]
                for f in fs:
                    frame(app, g, f, n, m).save(TEST / f'{i}_{f:03d}.png')
                print(i, 'test', [tuple(round(v, 3) for v in g(f)) for f in fs], flush=True)
                continue
            w = lib.Wr(lib.SEG / f'{i}.mp4')
            for f in range(n):
                w.put(frame(app, g, f, n, m))
            k = w.close()
            print(i, 'frames', k, 'of', n, flush=True)
            assert k == n
        print('errs', app.errs[:5], flush=True)
    finally:
        app.close()


if __name__ == '__main__':
    a = sys.argv[1:]
    t = None
    if a and a[0] == '--test':
        t = [int(v) for v in a[1].split(',')]
        a = a[2:]
    run(a or list(SH), t)

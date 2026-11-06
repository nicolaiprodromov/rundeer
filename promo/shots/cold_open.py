from bkit import *

O = OUTS


def full_h(p):
    return lambda f: ctr(canvas(), sc(p, W, H))


def bleed(p, cy=0.5):
    def g(f):
        im = ld(p)
        s = W / im.width
        im = im.resize((W, round(im.height * s)), Image.LANCZOS)
        y = round((im.height - H) * cy)
        return im.crop((0, y, W, y + H))
    return g


def wide(p, m=120):
    return lambda f: ctr(canvas(), sc(p, W - 2 * m, H - 2 * m))


def mot(i):
    return lambda f: ctr(canvas(), contain(mof(i, f), W, H))


A = [
    (full_h(pp(0)), 'poster_000.png'),
    (wide(O / 'tickets/ticket_002.png'), 'tickets/ticket_002.png'),
    (bleed(tp(2), 0.45), 'poster_tex_2_01.png'),
    (full_h(O / 'riso_zine/page_000.png'), 'riso_zine/page_000.png'),
    (full_h(O / 'specimen/sheet_002.png'), 'specimen/sheet_002.png'),
    (mot(0), 'motion_posters/motion_0.mp4'),
    (bleed(pp(14), 0.42), 'poster_014.png'),
    (wide(O / 'tickets/ticket_000.png'), 'tickets/ticket_000.png'),
]
B = [
    (bleed(tp(25), 0.5), 'poster_tex_25_01.png'),
    (full_h(pp(21)), 'poster_021.png'),
    (bleed(tp(13), 0.5), 'poster_tex_13_01.png'),
    (bleed(pp(8), 0.6), 'poster_008.png'),
    (full_h(O / 'specimen/sheet_000.png'), 'specimen/sheet_000.png'),
    (bleed(tp(19), 0.5), 'poster_tex_19_01.png'),
    (full_h(O / 'riso_zine/page_001.png'), 'riso_zine/page_001.png'),
    (bleed(pp(26), 0.35), 'poster_026.png'),
]


def cuts(st, ds, xs):
    r, t = [], st
    for d, x in zip(ds, xs):
        r.append((t, d, x))
        t += d
    return r


CU = cuts(0, [8, 7] * 4, A) + cuts(60, [4, 4, 4, 3] * 2, B)
SUB = 'node-based workbench for AI image & video'
_c = {}


def gen(f):
    if f >= 90:
        return wordmark(f - 90, SUB)
    t, d, (g, lb) = next(c for c in CU if c[0] <= f < c[0] + c[1])
    a = f - t
    k = (t, a if 'motion' in lb else 0)
    if k not in _c:
        _c[k] = g(a)
    im = zoom(_c[k], pk(a, 1.06 if f < 60 else 1.1, d))
    im = im.copy()
    tag(im, f'{lb}', sz=17)
    return im


if __name__ == '__main__':
    run('cold_open', gen)

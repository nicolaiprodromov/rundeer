from bkit import *

N, D = 30, 90
PH = H
PW = round(PH * 0.8)


def cuts():
    c = [2 + 4 * (1 - i / (N - 1)) ** 3 for i in range(N)]
    k = D / sum(c)
    b, s = [0], 0
    for v in c:
        s += v * k
        b.append(round(s))
    return b


B = cuts()


@lru_cache(None)
def pim(i, s):
    return sc(pp(i), round(PW * s), round(PH * s))


@lru_cache(None)
def pl(i):
    return pal(pp(i))


def hx(c):
    return '#%02X%02X%02X' % c


def gen(f):
    i = max(j for j in range(N) if B[j] <= f)
    a, d = f - B[i], B[i + 1] - B[i]
    cv = canvas()
    s = round(pk(a, 1.06, max(2, d)), 3)
    ctr(cv, pim(i, s))
    dr = ImageDraw.Draw(cv)
    lx = (W - PW) // 4
    fb = font('monob', 196)
    t = f'{i + 1:03d}'
    bb = dr.textbbox((0, 0), t, font=fb)
    tx = lx - (bb[2] - bb[0]) // 2
    dr.text((tx - bb[0], 380 - bb[1]), t, font=fb, fill=GOLD)
    fm = font('mono', 22)
    dr.text((tx, 380 + bb[3] - bb[1] + 30), f'/ {N:03d}  POSTERS', font=fm, fill=C['muted'])
    tw, g = 8, 4
    x0 = lx - (N * (tw + g) - g) // 2
    for j in range(N):
        x = x0 + j * (tw + g)
        dr.rectangle((x, 640, x + tw - 1, 664), fill=C['text'] if j < i else (GOLD if j == i else C['line']))
    rx = W - (W - PW) // 4
    p = pl(i)
    sw = 72
    for j, c in enumerate(p):
        y = 400 + j * (sw + 24)
        dr.rectangle((rx - 120, y, rx - 120 + sw, y + sw), fill=c)
        dr.text((rx - 120 + sw + 22, y + sw // 2 - 12), hx(c), font=fm, fill=C['soft'])
    dr.text((rx - 120, 400 - 52), 'DUOTONE', font=fm, fill=C['muted'])
    dr.text((rx - 120, 400 + 2 * (sw + 24) + 16), f'poster_{i:03d}.png', font=fm, fill=C['quiet'])
    return cv


if __name__ == '__main__':
    print(B)
    run('mont_fire', gen)

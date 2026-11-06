from bkit import *

CO, RO, CW, CH, G = 12, 5, 140, 175, 10
WW, WH = CO * CW + (CO - 1) * G, RO * CH + (RO - 1) * G
rd = random.Random(7)
PS, TS = list(range(30)), list(range(30))
rd.shuffle(PS)
rd.shuffle(TS)
S0 = (7 * (CW + G) + CW / 2, 1 * (CH + G) + CH / 2)
Z0 = 2.7


def build():
    s, cs = Sc(), []
    pi = ti = 0
    for r in range(RO):
        for c in range(CO):
            x, y = c * (CW + G), r * (CH + G)
            if (r + c) % 2 == 0:
                src, pi = pp(PS[pi]), pi + 1
            else:
                src, ti = tp(TS[ti]), ti + 1
            dd = math.hypot(x + CW / 2 - S0[0], (y + CH / 2 - S0[1]) * 1.3) + rd.uniform(0, 160)
            cs.append((dd, src, x, y))
    cs.sort(key=lambda v: v[0])
    for k, (dd, src, x, y) in enumerate(cs):
        s.add(src, x, y, CW, CH, t0=2 * int(k * 18 / len(cs)))
    return s


SC = build()


@lru_cache(None)
def mk():
    x = np.arange(W)[None, :]
    y = np.arange(H)[:, None]
    dx = np.maximum(0, x - 1000) / 420
    dy = np.maximum(0, 780 - y) / 300
    g = np.clip(1 - np.sqrt(dx ** 2 + dy ** 2), 0, 1) ** 1.4
    return g[..., None].astype(np.float32)


def gen(f):
    t = eio((f - 8) / 74)
    z = lerp(Z0, 1.0, t)
    cx, cy = lerp(S0[0], WW / 2, t), lerp(S0[1], WH / 2, t)
    cv = SC.draw(f, cx, cy, z, par=lambda z, d: z)
    k = 0.72 * ease((f - 4) / 8)
    if k > 0:
        a = np.asarray(cv, np.float32) * (1 - k * mk())
        cv = Image.fromarray(a.astype(np.uint8))
    return cv


if __name__ == '__main__':
    run('mont_wall', gen)

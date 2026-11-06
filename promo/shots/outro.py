from bkit import *

rd = random.Random(11)
SUB = 'node-based. AI-native. built for artists.'
Z0, Z1, NZ = 2.4, 0.36, 75


def assets():
    a = [(pp(i), 0.8) for i in range(30)] + [(tp(i), 0.75) for i in range(30)]
    a += [(OUTS / f'tickets/ticket_00{i}.png', 2.8125) for i in range(4)]
    a += [(OUTS / f'ticket_tex_{i}_01.png', 16 / 9) for i in range(4)]
    a += [(OUTS / f'riso_zine/page_00{i}.png', 1080 / 1528) for i in range(2)]
    a += [(OUTS / f'zine_photo_{i}_01.png', 2 / 3) for i in range(2)]
    a += [(OUTS / f'specimen/sheet_00{i}.png', 0.8) for i in range(3)]
    a += [(OUTS / f'specimen_glyph_{i}_01.png', 1.0) for i in range(3)]
    a += [(OUTS / f'motion_tex_{i}_01.png', 0.75) for i in range(3)]
    a += [(OUTS / 'live_poster.png', 0.8), (OUTS / 'live_letters_01.png', 0.75)]
    return a


def mov(i):
    return lambda f: mof(i, f)


def build():
    s, A = Sc(), assets()
    rh, g, X = 300, 16, 3300
    y = -1800
    while y < 1800:
        x = -X - rd.uniform(0, 400)
        while x < X:
            p, r = rd.choice(A)
            w = rh * r
            s.add(p, x, y, w, rh, dp=0.5, dim=0.32)
            x += w + g
        y += rh + g
    hero = [(pp(i), 0.8) for i in rd.sample(range(30), 22)] + [(tp(i), 0.75) for i in rd.sample(range(30), 8)]
    hero += [(OUTS / f'tickets/ticket_00{i}.png', 2.8125) for i in range(4)]
    hero += [(OUTS / f'riso_zine/page_00{i}.png', 1080 / 1528) for i in range(2)]
    hero += [(OUTS / f'specimen/sheet_00{i}.png', 0.8) for i in range(3)]
    hero += [(mov(1), 0.8), (mov(2), 0.8), (OUTS / 'live_poster.png', 0.8)]
    rd.shuffle(hero)
    cs = [(c, r) for r in range(-2, 3) for c in range(-4, 5) if (c, r) != (0, 0)]
    rd.shuffle(cs)
    mid, fr = hero[:len(cs)], hero[len(cs):]
    for (c, r), (p, ar) in zip(cs, mid):
        h = 520 if ar > 2 else rd.uniform(380, 460)
        w = h * ar if ar < 2 else 760
        h = w / ar
        cx, cy = c * 640 + rd.uniform(-110, 110), r * 600 + rd.uniform(-90, 90)
        s.add(p, cx - w / 2, cy - h / 2, w, h, dp=0.0, sh=True)
    s.add(mov(0), -180, -225, 360, 450, dp=0.0, sh=True)
    for k, (p, ar) in enumerate(fr):
        a = k / max(1, len(fr)) * 2 * math.pi + 0.6
        h = 560
        w = h * ar if ar < 2 else 900
        h = w / ar
        cx, cy = math.cos(a) * 1500, math.sin(a) * 820
        s.add(p, cx - w / 2, cy - h / 2, w, h, dp=-0.16, sh=True)
    return s


SC = build()


def gen(f):
    if f >= NZ:
        return wordmark(f - NZ, SUB)
    u = (f / (NZ - 1)) ** 1.25
    z = math.exp(lerp(math.log(Z0), math.log(Z1), u))
    return SC.draw(f, lerp(0, 260, u), lerp(0, -90, u), z)


if __name__ == '__main__':
    run('outro', gen)

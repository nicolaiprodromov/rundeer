import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from c_fx import *

SH_, SX, SY = 960, 1072, 60
K = SH_ / 1350
SW = round(1080 * K)
CX, CY, CS, CL = (67, 400, 733), (250, 582, 915), 280, 305
HD, FT = 222, 1250
TC, TS = (700, 390), 540
LD = [22 + round(i * 7.5) for i in range(9)]
FL = 7

shs = sorted((OUTS / 'specimen').glob('sheet_*.png')) + extra('glyph_specimen', (1080, 1350))
gls = [OUTS / f'specimen_glyph_{i}_01.png' for i in range(3)]
SHT = [Image.open(p).convert('RGB') for p in shs]
SS = [s.resize((SW, SH_), Image.LANCZOS) for s in SHT]
GL = [Image.open(p).convert('RGB').resize((TS, TS), Image.LANCZOS) for p in gls]
CELLS = [(x, y) for y in CY for x in CX]
rest = list(range(1, len(SS)))
CUT = 90
STEP = 15 if len(rest) <= 2 else max(4, 30 // len(rest))
CUTS = [(CUT + round(j * STEP), r) for j, r in enumerate(rest)]
FM = font('mono', 17)


def box(x, y):
    return round(x * K), round(y * K), round((x + CS) * K), round((y + CL) * K)


def build(f):
    s, im = SS[0], Image.new('RGB', (SW, SH_), SHT[0].getpixel((5, 5)))
    hw = round(SW * eout((f - 8) / 7))
    if hw > 0:
        im.paste(s.crop((0, 0, hw, round(HD * K))), (0, 0))
    for (x, y), L in zip(CELLS, LD):
        if f >= L:
            b = box(x, y)
            im.paste(s.crop(b), b[:2])
    u = eout((f - 82) / 6)
    if u > 0:
        fy = round(FT * K)
        c = s.crop((0, fy, SW, SH_))
        im.paste(c.crop((0, 0, SW, round(c.height * u))), (0, fy + round((1 - u) * 18)))
    return im


def tile(cv, g, k=1.0):
    t = GL[g]
    if k != 1:
        t = t.resize((round(TS * k), round(TS * k)), Image.BILINEAR)
    x, y = round(TC[0] - t.width / 2), round(TC[1] - t.height / 2)
    cv.paste(t, (x, y))
    d = ImageDraw.Draw(cv)
    d.rectangle((x - 1, y - 1, x + t.width, y + t.height), outline=C['line'])
    d.text((x, y - 30), 'AI GLYPH', font=FM, fill=C['soft'])
    d.text((x + t.width, y - 30), f'specimen_glyph_{g}_01.png', font=FM, fill=C['quiet'], anchor='ra')


def frame(f):
    cv = canvas()
    cut = max([c for c in CUTS if c[0] <= f], default=None)
    if cut:
        p = eout((f - cut[0]) / 5)
        if cut[1] < len(GL):
            tile(cv, cut[1], 1 + 0.05 * (1 - p))
        put(cv, SS[cut[1]].convert('RGBA'), SX + SW / 2, SY + SH_ / 2, 1 + 0.035 * (1 - p))
        return cv
    e = eout(f / 7)
    tile(cv, 0, 1 + 0.15 * (1 - e))
    e2 = eout((f - 3) / 7)
    if e2 > 0:
        put(cv, build(f).convert('RGBA'), SX + SW / 2, SY + SH_ / 2, 1 + 0.08 * (1 - e2), clamp(e2 * 3))
    for (x, y), L in zip(CELLS, LD):
        u = (f - (L - FL)) / FL
        if 0 <= u < 1:
            e = eout(u)
            sp = SHT[0].crop((x, y, x + CS, y + CL)).convert('RGBA')
            tx, ty = SX + (x + CS / 2) * K, SY + (y + CL / 2) * K
            k = K * lerp(1.7, 1, bout(u))
            put(cv, shd(sp, 14, 0.8), lerp(TC[0], tx, e) + 10, lerp(TC[1], ty, e) + 16, k, clamp(u * 3))
            put(cv, sp, lerp(TC[0], tx, e), lerp(TC[1], ty, e), k, clamp(u * 3))
    return cv


if __name__ == '__main__':
    run('sp_out', frame)

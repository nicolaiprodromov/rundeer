import json, math, pathlib, subprocess
from PIL import Image, ImageDraw, ImageFont

R = pathlib.Path(__file__).resolve().parent
ROOT = R.parent
OUTS = ROOT / '.rundeer' / 'outputs'
OUT = R / 'out'
SEG = OUT / 'seg'
W, H, FPS, BPM = 1920, 1080, 30, 120
BF = FPS * 60 // BPM
FD = pathlib.Path('C:/Windows/Fonts')
F = {'sans': FD / 'NeueMontreal-Regular.otf', 'bold': FD / 'NeueMontreal-Bold.ttf', 'light': FD / 'NeueMontreal-Light.ttf', 'mono': FD / 'consola.ttf', 'monob': FD / 'consolab.ttf'}
C = {'bg': (8, 8, 8), 'deep': (3, 3, 3), 'line': (46, 46, 46), 'text': (245, 245, 245), 'soft': (205, 205, 205), 'muted': (160, 160, 160), 'quiet': (100, 100, 100), 'gold': (255, 210, 80), 'pink': (255, 96, 255)}


def spec():
    return json.loads((R / 'spec.json').read_text(encoding='utf-8'))


def shot(i):
    return next(s for s in spec()['shots'] if s['id'] == i)


def font(k, s):
    return ImageFont.truetype(str(F[k]), s)


def clamp(t):
    return max(0.0, min(1.0, t))


def ease(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def eio(t):
    t = clamp(t)
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def eout(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def lerp(a, b, t):
    return a + (b - a) * t


def fit(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((max(w, round(im.width * s)), max(h, round(im.height * s))), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def contain(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def canvas(c='bg'):
    return Image.new('RGB', (W, H), C[c])


class Wr:
    def __init__(s, path, w=W, h=H, fps=FPS):
        path = pathlib.Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        s.w, s.h, s.n = w, h, 0
        s.p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', str(fps), str(path)], stdin=subprocess.PIPE)

    def put(s, im):
        if im.size != (s.w, s.h):
            im = im.resize((s.w, s.h), Image.LANCZOS)
        s.p.stdin.write(im.convert('RGB').tobytes())
        s.n += 1

    def close(s):
        s.p.stdin.close()
        s.p.wait()
        return s.n


def frames(path, w=W, h=H):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-'], stdout=subprocess.PIPE)
    n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield Image.frombytes('RGB', (w, h), b)
    p.wait()


def nframes(path):
    o = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout
    return int(o.strip())

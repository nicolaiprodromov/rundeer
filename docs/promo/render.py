import argparse, base64, functools, http.server, shutil, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FPS, DUR = 60, 30.0
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"]


def throttle(n):
    import psutil
    tot = psutil.cpu_count() or 1
    n = max(1, min(n, tot))
    cs = list(range(n))
    lo = psutil.BELOW_NORMAL_PRIORITY_CLASS if sys.platform == "win32" else 10
    me = psutil.Process()
    seen = set()

    def cap(p):
        try:
            p.cpu_affinity(cs)
            p.nice(lo)
            seen.add(p.pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    cap(me)

    def run():
        while True:
            for c in me.children(recursive=True):
                if c.pid not in seen:
                    cap(c)
            time.sleep(0.5)

    threading.Thread(target=run, daemon=True).start()
    print(f"cpu cap: {n}/{tot} threads ({100 * n // tot}%), below-normal priority", flush=True)


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    h = functools.partial(Q, directory=str(ROOT))
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def page(pw, port, qs):
    b = pw.chromium.launch(args=ARGS)
    p = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    errs = []
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    p.goto(f"http://127.0.0.1:{port}/docs/promo/index.html?{qs}", wait_until="networkidle")
    try:
        p.wait_for_function("!!window.__ready", timeout=60000)
        p.evaluate("window.__ready")
    except Exception:
        b.close()
        raise SystemExit("init failed: " + " | ".join(errs))
    return b, p, errs


def grab(p, t, fmt="png"):
    js = "([t,f])=>{__frame(t);return document.getElementById('c').toDataURL(f==='png'?'image/png':'image/jpeg',0.97)}"
    d = p.evaluate(js, [t, fmt])
    return base64.b64decode(d.split(",", 1)[1])


def stills(a, port):
    od = Path(a.out)
    od.mkdir(parents=True, exist_ok=True)
    ts = [float(x) for x in a.stills.split(",")]
    with sync_playwright() as pw:
        b, p, errs = page(pw, port, a.qs)
        for t in ts:
            f = od / f"{a.prefix}{t:05.2f}.png"
            f.write_bytes(grab(p, t))
            print(f)
        if errs:
            print("ERRORS:", *errs, sep="\n  ")
        b.close()


def check(a, port):
    js = "([n0,n1,f])=>{const e=[];for(let n=n0;n<n1;n++){try{__frame(n/f)}catch(x){e.push(n+': '+x.message)}}return e}"
    with sync_playwright() as pw:
        b, p, errs = page(pw, port, a.qs)
        bad = []
        for n in range(int(a.t0 * FPS), int(a.t1 * FPS), 120):
            bad += p.evaluate(js, [n, min(n + 120, int(a.t1 * FPS)), FPS])
        b.close()
    print("check:", "ok" if not bad and not errs else "\n".join(bad[:20] + errs[:5]))


def chunk(a, port, i, f0, f1, d):
    seg = d / f"seg{i:02d}.mkv"
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "png", "-i", "-",
                           "-c:v", "libx264rgb", "-crf", "0", "-preset", "ultrafast", str(seg)], stdin=subprocess.PIPE)
    with sync_playwright() as pw:
        b, p, errs = page(pw, port, a.qs)
        for n in range(f0, f1):
            ff.stdin.write(grab(p, n / FPS))
            if (n - f0) % 60 == 0:
                print(f"w{i} {n}/{f1}", flush=True)
        if errs:
            print(f"w{i} ERRORS:", *errs[:5], sep="\n  ")
        b.close()
    ff.stdin.close()
    ff.wait()
    return seg


def video(a, port):
    n0, n1 = int(a.t0 * FPS), int(a.t1 * FPS)
    d = Path(tempfile.mkdtemp(prefix="rdpromo_", dir=a.tmp))
    k = a.workers
    step = (n1 - n0 + k - 1) // k
    rng = [(i, n0 + i * step, min(n1, n0 + (i + 1) * step)) for i in range(k)]
    t = time.time()
    with ThreadPoolExecutor(k) as ex:
        segs = list(ex.map(lambda r: chunk(a, port, r[0], r[1], r[2], d), rng))
    lst = d / "list.txt"
    lst.write_text("".join(f"file '{s.as_posix()}'\n" for s in segs))
    master = d / "master.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(master)], check=True)
    mp4 = Path(a.video)
    mp4.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(master), "-c:v", "libx264", "-preset", "slow", "-crf", "12",
                    "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", "-an", str(mp4)], check=True)
    if a.gif:
        pal = d / "pal.png"
        vf = f"fps={a.gif_fps},scale={a.gif_w}:-1:flags=lanczos"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(master), "-vf", f"{vf},palettegen=max_colors=192:stats_mode=diff", str(pal)], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(master), "-i", str(pal), "-lavfi",
                        f"{vf}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle", "-loop", "0", a.gif], check=True)
    if not a.keep:
        shutil.rmtree(d, ignore_errors=True)
    print(f"done {time.time() - t:.0f}s -> {mp4}" + (f" + {a.gif}" if a.gif else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stills")
    ap.add_argument("--out", default=str(HERE / "out" / "stills"))
    ap.add_argument("--prefix", default="f")
    ap.add_argument("--solo")
    ap.add_argument("--ss", type=float, default=2)
    ap.add_argument("--video")
    ap.add_argument("--gif")
    ap.add_argument("--gif-w", type=int, default=640)
    ap.add_argument("--gif-fps", type=int, default=10)
    ap.add_argument("--t0", type=float, default=0)
    ap.add_argument("--t1", type=float, default=DUR)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--cores", type=int, default=20)
    ap.add_argument("--tmp", default=None)
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    throttle(a.cores)
    a.qs = f"ss={a.ss:g}" + (f"&solo={a.solo}" if a.solo else "")
    s = serve()
    try:
        if a.check:
            check(a, s.server_port)
        if a.stills:
            stills(a, s.server_port)
        if a.video:
            video(a, s.server_port)
    finally:
        s.shutdown()


if __name__ == "__main__":
    main()

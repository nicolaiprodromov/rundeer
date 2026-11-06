import subprocess, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import lib

D = pathlib.Path(__file__).resolve().parent / 'chk'
D.mkdir(exist_ok=True)
for i in sys.argv[1:]:
    p = lib.SEG / f'{i}.mp4'
    n = lib.nframes(p)
    d = lib.shot(i)['dur']
    print(i, n, d, 'OK' if n == d else 'MISMATCH', flush=True)
    for f in (0, d // 2, d - 1):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(p), '-vf', f'select=eq(n\\,{f})', '-vframes', '1', str(D / f'{i}_{f:03d}.png')])

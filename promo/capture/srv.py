import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT.parent), str(ROOT)]

import rundeer.web.server as S


def _no(*a, **k):
    raise RuntimeError('promo capture: command runs are blocked')


S.start_run = _no
S.run_plan = _no

if __name__ == '__main__':
    S.serve(host='127.0.0.1', port=int(sys.argv[1]), project_root=ROOT, enable_agent=False)

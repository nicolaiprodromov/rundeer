import json, os, pathlib, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

C = pathlib.Path(__file__).resolve().parent
ROOT = C.parents[1]
GR = C / 'graphs'
PORT = int(os.environ.get('PROMO_PORT', 8797))
URL = f'http://127.0.0.1:{PORT}/'
LOG = C / f'srv{PORT}.log'
BLOCKED = []

CSS = """
#rundeer-splash,.masthead,.ne-nmenu,.ne-side-resizer,#agentPalette,#agentConversation,#agentPaletteCard,#flog,#modalHint,#boxSelect,#addMenu,#appDialog,#helpModal{display:none!important}
#canvasWrap{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;z-index:5!important;cursor:none!important}
*{transition:none!important;animation-play-state:paused!important;caret-color:transparent!important}
video::-webkit-media-controls{display:none!important}
"""


def srv_up():
    p = subprocess.Popen([sys.executable, str(C / 'srv.py'), str(PORT)], cwd=str(ROOT), stdout=open(LOG, 'w', encoding='utf-8'), stderr=subprocess.STDOUT)
    for _ in range(120):
        try:
            urllib.request.urlopen(URL + 'api/state?light=1', timeout=2).read()
            return p
        except Exception:
            if p.poll() is not None:
                raise RuntimeError('server died: ' + LOG.read_text(encoding='utf-8', errors='replace'))
            time.sleep(0.5)
    p.kill()
    raise RuntimeError('server did not start')


def srv_down(p):
    if p and p.poll() is None:
        p.kill()
        p.wait(10)


def _routes(pg, runs):
    def run(rt):
        rq = rt.request
        if rq.method != 'POST':
            return rt.continue_()
        b = json.loads(rq.post_data or '{}')
        i = f'promo-{len(runs)}'
        runs.append({'id': i, 'name': b.get('output', {}).get('name'), 'dir': b.get('output', {}).get('dir')})
        rt.fulfill(status=200, content_type='application/json', body=json.dumps({'id': i, 'status': 'running'}))

    def runrec(rt):
        rq = rt.request
        if rq.method == 'POST':
            return rt.fulfill(status=200, content_type='application/json', body='{}')
        i = rq.url.split('/api/runs/')[1].split('?')[0].strip('/')
        rt.fulfill(status=200, content_type='application/json', body=json.dumps({'id': i, 'status': 'done', 'returncode': 0, 'startedAt': 0, 'endedAt': 1, 'output': ''}))

    def block(rt):
        BLOCKED.append((rt.request.method, rt.request.url))
        rt.fulfill(status=403, content_type='application/json', body='{"error":"blocked by promo capture"}')

    def wstate(rt):
        if rt.request.method == 'POST':
            return rt.fulfill(status=200, content_type='application/json', body='{"ok":true}')
        rt.fulfill(status=200, content_type='application/json', body='{"state":{}}')

    def postonly(rt):
        if rt.request.method == 'POST':
            return block(rt)
        rt.continue_()

    pg.route(re.compile(r'.*/api/run(\?.*)?$'), run)
    pg.route(re.compile(r'.*/api/plan(\?.*)?$'), block)
    pg.route(re.compile(r'.*/api/runs/promo-[^/]*(/.*)?$'), runrec)
    pg.route(re.compile(r'.*/api/runs/[^/]+/(display-log|cancel)$'), lambda rt: rt.fulfill(status=200, content_type='application/json', body='{}'))
    pg.route(re.compile(r'.*/api/web-state(\?.*)?$'), wstate)
    pg.route(re.compile(r'.*/api/graphs(/delete)?(\?.*)?$'), postonly)
    pg.route(re.compile(r'.*/api/settings-yaml(\?.*)?$'), postonly)
    pg.route(re.compile(r'.*/api/canvas-drop.*'), block)


class App:
    def __init__(s, dsf=2, w=1920, h=1080):
        s.runs = []
        s.p = srv_up()
        s.pw = sync_playwright().start()
        s.br = s.pw.chromium.launch(channel='chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
        s.cx = s.br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dsf)
        s.pg = s.cx.new_page()
        s.pg.set_default_timeout(0)
        s.errs = []
        s.pg.on('pageerror', lambda e: s.errs.append(str(e)))
        _routes(s.pg, s.runs)
        s.pg.goto(URL, wait_until='load')
        s.pg.wait_for_function("() => typeof loadGraphData === 'function' && window.RundeerNodes && window.RundeerNodes['cmd-image'] && Object.keys(NODE_BY_TYPE).length > 30 && typeof tabsState !== 'undefined' && tabsState.tabs.length > 0", timeout=60000)
        s.pg.wait_for_timeout(1500)
        s.pg.add_style_tag(content=CSS)

    def load(s, data):
        n = s.pg.evaluate("""(d) => { loadGraphData(d); renderGraph(); return {n: Object.keys(graph.nodes).length, e: graph.edges.length}; }""", data)
        s.pg.wait_for_timeout(300)
        return n

    def boxes(s):
        return s.pg.evaluate("""() => Object.fromEntries([...document.querySelectorAll('#nodeCanvas .ne-node')].map(el => { const n = graph.nodes[el.dataset.nodeId]; return [el.dataset.nodeId, {t: nodeDisplayTitle(n), type: n.type, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight}]; }))""")

    def settle(s, ms=60000):
        s.pg.wait_for_function("""() => { const im = [...document.querySelectorAll('#nodeCanvas img')]; return im.every(i => !i.getAttribute('src') ? false : (i.complete)); }""", timeout=ms, polling=250)

    def cam(s, x, y, z):
        s.pg.evaluate("""async ([x, y, z]) => {
            vp.x = x; vp.y = y; vp.zoom = z; applyViewport(); renderConnections();
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const im = [...document.querySelectorAll('#nodeCanvas img')].filter(i => i.getAttribute('src'));
            await Promise.all(im.map(i => i.complete ? (i.decode ? i.decode().catch(() => {}) : null) : new Promise(r => { i.addEventListener('load', r, {once: true}); i.addEventListener('error', r, {once: true}); })));
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }""", [x, y, z])

    def seek(s, t):
        s.pg.evaluate("""async (t) => {
            const vs = [...document.querySelectorAll('#nodeCanvas video')];
            await Promise.all(vs.map(v => new Promise(r => {
                const go = () => {
                    v.pause();
                    const tt = t % (v.duration || 1);
                    if (Math.abs(v.currentTime - tt) < 1e-4 && v.readyState >= 2) return r();
                    v.addEventListener('seeked', r, {once: true});
                    v.currentTime = tt;
                };
                if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, {once: true});
            })));
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }""", t)

    def shot(s, path=None):
        b = s.pg.screenshot(type='png', animations='disabled', caret='hide')
        if path:
            pathlib.Path(path).write_bytes(b)
        return b

    def close(s):
        try:
            s.cx.close()
            s.br.close()
            s.pw.stop()
        finally:
            srv_down(s.p)

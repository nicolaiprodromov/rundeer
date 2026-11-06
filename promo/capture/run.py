import copy, json, sys, time, pathlib
from pw import App, GR, ROOT, BLOCKED

SRC = ROOT / '.rundeer' / 'graphs'
PR = 'promo_runs'
KEEP = ('lastResult', 'lastOutputs', 'lastRunMs', 'lastRunStatus', 'lastRunCount')
OVR = {'riso_zine': {'n1': {'value': 2}}}
VIEW = {'motion_poster': {'n93': {'previewMode': 'slider'}}}


def rd(f):
    return json.loads((SRC / f'{f}.json').read_text(encoding='utf-8'))


def redirect(g, f):
    ns = g['nodes']
    for k, n in ns.items():
        if n['type'] != 'export':
            continue
        src = [e for e in g['edges'] if e['toNode'] == k and e['toSocket'] == 'name']
        if src:
            t = ns[src[0]['fromNode']]
            t['props']['extra'] = f'{PR}/{f}/' + t['props']['extra'].split('/')[-1]
        else:
            n['props']['name'] = f'{PR}/{f}/' + n['props']['name'].split('/')[-1]


def runcopy(f):
    g = rd(f)
    redirect(g, f)
    for k, p in OVR.get(f, {}).items():
        g['nodes'][k]['props'].update(p)
    for n in g['nodes'].values():
        for a in KEEP:
            n[a] = None if a != 'lastRunCount' else 0
    return g


def capcopy(f, res):
    g = rd(f)
    for k, p in OVR.get(f, {}).items():
        g['nodes'][k]['props'].update(p)
    for k, n in g['nodes'].items():
        r = res['nodes'][k]
        for a in KEEP:
            n[a] = r.get(a)
    for k, v in VIEW.get(f, {}).items():
        g['nodes'][k].update(v)
    return g


def go(f, app):
    g = runcopy(f)
    ld = app.load(g)
    print(f, 'loaded', ld, 'expected', len(g['nodes']), len(g['edges']), flush=True)
    assert ld['e'] == len(g['edges'])
    t0 = time.time()
    app.pg.evaluate("() => { window.__done = false; window.__err = null; runGraph().then(() => { window.__res = serializeGraph(); window.__done = true; }).catch(e => { window.__err = String(e); window.__done = true; }); }")
    while not app.pg.evaluate('() => window.__done'):
        app.pg.wait_for_timeout(30000)
        st = app.pg.evaluate("() => Object.values(graph.nodes).filter(n => n.lastRunStatus === 'done').length")
        print(f'  {f} {time.time() - t0:.0f}s done-nodes={st} fake-runs={len(app.runs)}', flush=True)
    (GR / f'{f}.run0.json').write_text(json.dumps(app.pg.evaluate('() => window.__res')), encoding='utf-8')
    app.pg.wait_for_timeout(1500)
    k = 0
    while k < 4:
        app.pg.wait_for_timeout(1000)
        k = 0 if app.pg.evaluate('() => _previewRefreshRunning') else k + 1
    res = app.pg.evaluate('() => serializeGraph()')
    log = app.pg.evaluate("() => (document.getElementById('runLogBody') || {}).textContent || ''")
    (GR / f'{f}.runlog.txt').write_text(log, encoding='utf-8')
    (GR / f'{f}.run.json').write_text(json.dumps(res), encoding='utf-8')
    bad = {k: (n['type'], n['title'], n.get('lastRunStatus')) for k, n in res['nodes'].items() if n.get('lastRunStatus') != 'done'}
    nolr = [(k, n['title']) for k, n in res['nodes'].items() if not n.get('lastResult')]
    print(f, 'err', app.pg.evaluate('() => window.__err'), 'secs', round(time.time() - t0), 'not-done', bad, 'no-result', nolr, flush=True)
    cap = capcopy(f, res)
    (GR / f'{f}.cap.json').write_text(json.dumps(cap), encoding='utf-8')
    return res


if __name__ == '__main__':
    GR.mkdir(exist_ok=True)
    if sys.argv[1] == '--cap':
        for f in sys.argv[2:]:
            res = json.loads((GR / f'{f}.run.json').read_text(encoding='utf-8'))
            (GR / f'{f}.cap.json').write_text(json.dumps(capcopy(f, res)), encoding='utf-8')
        sys.exit()
    app = App(dsf=1)
    try:
        for f in sys.argv[1:]:
            go(f, app)
            print('fake runs:', app.runs, flush=True)
        print('blocked:', BLOCKED, 'pageerrors:', app.errs[:10], flush=True)
    finally:
        app.close()

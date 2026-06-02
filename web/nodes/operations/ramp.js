function _rampStops(node) {
  let s = node.props.stops;
  if (!Array.isArray(s) || s.length < 2) {
    s = [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }];
    node.props.stops = s;
  }
  return s;
}

function _rampSample(stops, interp, t) {
  const s = stops.slice().sort((a, b) => a.pos - b.pos);
  const f = Math.max(0, Math.min(1, Number(t) || 0));
  if (f <= s[0].pos) return s[0].color;
  if (f >= s[s.length - 1].pos) return s[s.length - 1].color;
  let i = 0;
  while (i < s.length - 1 && s[i + 1].pos <= f) i++;
  if (interp === "constant") return s[i].color;
  const a = s[i], b = s[i + 1];
  let u = (f - a.pos) / Math.max(1e-8, b.pos - a.pos);
  if (interp === "ease") u = u * u * (3 - 2 * u);
  const ca = _hexToRgba(a.color), cb = _hexToRgba(b.color);
  return _rgbaToHex(ca.map((v, k) => v + (cb[k] - v) * u));
}

(window.RundeerNodes = window.RundeerNodes || {})["ramp"] = {
  migrate(node) {
    _rampStops(node);
    if (!node.props.interp) node.props.interp = "linear";
  },

  resizeMin(node, def) {
    return { w: 240, h: 232 };
  },

  resolve: async function (node, inputs, outputs, props, helpers) {
    const stops = _rampStops(node);
    const interp = String(props.interp || "linear");
    const facRaw = inputs.fac !== undefined && inputs.fac !== "" && inputs.fac !== null
      ? inputs.fac
      : Number(props.fac ?? 0.5);
    const fac = helpers._coerceMixInput(facRaw, { isFactor: true });
    if (!fac.isPath) {
      const f = Number(fac.scalar ?? fac.color?.[0] ?? 0);
      outputs.out = _rampSample(stops, interp, f);
      return;
    }
    helpers.appendRunLog(`  ↳ Ramp ${interp}\n`);
    const result = await helpers.graphFetchJSON("/api/uv/ramp", {
      method: "POST",
      body: JSON.stringify({ fac: fac.payload, stops, interp }),
    }, helpers.opts);
    if (result.error) throw new Error(`ramp: ${result.error}`);
    if (result.path) {
      outputs.out = result.path;
      node._uvImage = result.image || result.preview || "";
    } else if (result.color) {
      outputs.out = helpers._rgbaToHex(result.color);
    } else {
      outputs.out = "";
    }
  },

  buildBody(nodeId, node, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "ne-ramp-body";
    wrap.addEventListener("mousedown", (e) => e.stopPropagation());
    wrap.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const stops = _rampStops(node);
    const interp = () => String(node.props.interp || "linear");
    let sel = Math.max(0, Math.min(stops.length - 1, Number(node._rampSel ?? 0)));
    node._rampSel = sel;

    const commit = () => { ctx.scheduleAutosave(); ctx.schedulePreviewRefresh(); };
    const rebuild = () => {
      const el = document.querySelector(`[data-node-id="${nodeId}"]`);
      if (el) { el.dataset.signature = "stale"; ctx.renderNodes(); }
    };

    const bar = document.createElement("canvas");
    bar.className = "ne-ramp-bar";
    bar.width = 256;
    bar.height = 24;
    const g = bar.getContext("2d");

    const paintBar = () => {
      const w = bar.width, h = bar.height;
      for (let x = 0; x < w; x++) {
        g.fillStyle = _rampSample(node.props.stops, interp(), x / (w - 1));
        g.fillRect(x, 0, 1, h);
      }
    };

    bar.addEventListener("click", (e) => {
      const r = bar.getBoundingClientRect();
      let p = (e.clientX - r.left) / Math.max(1, r.width);
      p = Math.max(0, Math.min(1, p));
      const col = _rampSample(node.props.stops, interp(), p);
      node.props.stops.push({ pos: Math.round(p * 1000) / 1000, color: col });
      node._rampSel = node.props.stops.length - 1;
      commit();
      rebuild();
    });

    const track = document.createElement("div");
    track.className = "ne-ramp-track";
    const handles = [];
    stops.forEach((stop, idx) => {
      const h = document.createElement("div");
      h.className = "ne-ramp-stop" + (idx === sel ? " is-selected" : "");
      h.style.left = (Math.max(0, Math.min(1, stop.pos)) * 100) + "%";
      h.style.background = stop.color;
      h.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sel = idx;
        node._rampSel = idx;
        handles.forEach((el, k) => el.classList.toggle("is-selected", k === idx));
        syncControls();
        const tr = track.getBoundingClientRect();
        const mm = (ev) => {
          let p = (ev.clientX - tr.left) / Math.max(1, tr.width);
          p = Math.max(0, Math.min(1, p));
          node.props.stops[idx].pos = Math.round(p * 1000) / 1000;
          h.style.left = (p * 100) + "%";
          paintBar();
          syncControls();
        };
        const mu = () => {
          document.removeEventListener("mousemove", mm);
          document.removeEventListener("mouseup", mu);
          commit();
        };
        document.addEventListener("mousemove", mm);
        document.addEventListener("mouseup", mu);
      });
      handles.push(h);
      track.appendChild(h);
    });

    const ctrls = document.createElement("div");
    ctrls.className = "ne-ramp-controls";

    const colorIn = document.createElement("input");
    colorIn.type = "color";
    colorIn.className = "ne-ramp-color";
    colorIn.addEventListener("input", () => {
      if (sel == null) return;
      node.props.stops[sel].color = colorIn.value;
      if (handles[sel]) handles[sel].style.background = colorIn.value;
      paintBar();
      commit();
    });

    const posIn = document.createElement("input");
    posIn.type = "number";
    posIn.className = "ne-ramp-pos";
    posIn.min = 0;
    posIn.max = 1;
    posIn.step = 0.01;
    posIn.addEventListener("change", () => {
      if (sel == null) return;
      let p = Math.max(0, Math.min(1, Number(posIn.value) || 0));
      node.props.stops[sel].pos = p;
      if (handles[sel]) handles[sel].style.left = (p * 100) + "%";
      paintBar();
      commit();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ne-ramp-del";
    del.textContent = "\u2212";
    del.title = "Delete stop";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (node.props.stops.length <= 2) return;
      node.props.stops.splice(sel, 1);
      node._rampSel = Math.max(0, sel - 1);
      commit();
      rebuild();
    });

    const interpSel = document.createElement("select");
    interpSel.className = "ne-ramp-interp";
    for (const opt of ["linear", "ease", "constant"]) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      interpSel.appendChild(o);
    }
    interpSel.value = interp();
    interpSel.addEventListener("change", () => {
      node.props.interp = interpSel.value;
      paintBar();
      commit();
    });

    function syncControls() {
      const st = node.props.stops[sel];
      if (!st) return;
      colorIn.value = /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : _rgbaToHex(_hexToRgba(st.color) || [0, 0, 0, 1]);
      posIn.value = String(Math.round((Number(st.pos) || 0) * 1000) / 1000);
      del.disabled = node.props.stops.length <= 2;
    }

    ctrls.append(colorIn, posIn, del, interpSel);
    wrap.append(bar, track, ctrls);
    paintBar();
    syncControls();
    return wrap;
  },
};

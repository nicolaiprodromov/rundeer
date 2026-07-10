(window.RundeerNodes = window.RundeerNodes || {})["rgb"] = {
  migrate(node) {
    if (!node.props.color) node.props.color = "#ffffffff";
    if (!node.props.mode) node.props.mode = "rgb";
  },

  resizeMin() { return { w: 200, h: 150 }; },

  resolve: async function (node, inputs, outputs, props, helpers) {
    outputs.out = _rgbaToHex(_hexToRgba(props.color) || [1, 1, 1, 1]);
  },

  buildBody(nodeId, node, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "ne-rgb-body";
    wrap.addEventListener("mousedown", (e) => e.stopPropagation());
    wrap.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    if (!node.props.color) node.props.color = "#ffffffff";
    if (!node.props.mode) node.props.mode = "rgb";
    const mode = () => String(node.props.mode || "rgb");
    const rgba = () => _hexToRgba(node.props.color) || [1, 1, 1, 1];
    const commit = () => { ctx.scheduleAutosave(); ctx.schedulePreviewRefresh(); };
    const rebuild = () => {
      const el = document.querySelector(`[data-node-id="${nodeId}"]`);
      if (el) { el.dataset.signature = "stale"; ctx.renderNodes(); }
    };
    const setColor = (c) => { node.props.color = _rgbaToHex(c); swatch.value = node.props.color; commit(); };

    const top = document.createElement("div");
    top.className = "ne-rgb-top";
    const swatch = _colorField({ value: node.props.color, compact: true });
    swatch.classList.add("ne-rgb-swatch");
    swatch.addEventListener("input", () => { node.props.color = swatch.value; syncFields(); commit(); });

    const modeSel = document.createElement("select");
    modeSel.className = "ne-rgb-mode";
    for (const opt of ["rgb", "hsv", "hex"]) {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt.toUpperCase();
      modeSel.appendChild(o);
    }
    modeSel.value = mode();
    modeSel.addEventListener("change", () => { node.props.mode = modeSel.value; commit(); rebuild(); });
    top.append(swatch, modeSel);

    const fields = document.createElement("div");
    fields.className = "ne-rgb-fields";

    const mkRow = (lbl, min, max, step, get, set) => {
      const row = document.createElement("label");
      row.className = "ne-rgb-row";
      const cap = document.createElement("span");
      cap.className = "ne-rgb-cap";
      cap.textContent = lbl;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = min; inp.max = max; inp.step = step;
      inp.className = "ne-rgb-num";
      inp.value = String(get());
      inp.addEventListener("input", () => { set(Number(inp.value)); });
      row.append(cap, inp);
      row._sync = () => { inp.value = String(get()); };
      return row;
    };

    let rows = [];
    const syncFields = () => {
      swatch.value = node.props.color;
      rows.forEach((r) => r._sync && r._sync());
    };

    if (mode() === "hex") {
      const row = document.createElement("label");
      row.className = "ne-rgb-row is-hex";
      const cap = document.createElement("span");
      cap.className = "ne-rgb-cap";
      cap.textContent = "HEX";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.spellcheck = false;
      inp.className = "ne-rgb-hex";
      inp.value = node.props.color;
      inp.addEventListener("change", () => {
        const p = _hexToRgba(inp.value);
        if (p) setColor(p); else inp.value = node.props.color;
      });
      row.append(cap, inp);
      row._sync = () => { inp.value = node.props.color; };
      rows = [row];
      fields.append(row);
    } else if (mode() === "hsv") {
      const u8 = () => { const c = rgba(); const [h, s, v] = _rgbToHsv(c[0], c[1], c[2]); return [h, s, v, c[3]]; };
      const setHsv = (i, val) => {
        const cur = u8();
        cur[i] = val;
        const rgb = _hsvToRgb(cur[0], cur[1], cur[2]);
        setColor([rgb[0], rgb[1], rgb[2], cur[3]]);
      };
      rows = [
        mkRow("H", 0, 360, 1, () => Math.round(u8()[0]), (v) => setHsv(0, Math.max(0, Math.min(360, v)) / 1)),
        mkRow("S", 0, 100, 1, () => Math.round(u8()[1] * 100), (v) => setHsv(1, Math.max(0, Math.min(100, v)) / 100)),
        mkRow("V", 0, 100, 1, () => Math.round(u8()[2] * 100), (v) => setHsv(2, Math.max(0, Math.min(100, v)) / 100)),
        mkRow("A", 0, 255, 1, () => Math.round(rgba()[3] * 255), (v) => { const c = rgba(); setColor([c[0], c[1], c[2], Math.max(0, Math.min(255, v)) / 255]); }),
      ];
      fields.append(...rows);
    } else {
      const setCh = (i, val) => { const c = rgba(); c[i] = Math.max(0, Math.min(255, val)) / 255; setColor(c); };
      rows = [
        mkRow("R", 0, 255, 1, () => Math.round(rgba()[0] * 255), (v) => setCh(0, v)),
        mkRow("G", 0, 255, 1, () => Math.round(rgba()[1] * 255), (v) => setCh(1, v)),
        mkRow("B", 0, 255, 1, () => Math.round(rgba()[2] * 255), (v) => setCh(2, v)),
        mkRow("A", 0, 255, 1, () => Math.round(rgba()[3] * 255), (v) => setCh(3, v)),
      ];
      fields.append(...rows);
    }

    wrap.append(top, fields);
    return wrap;
  },
};

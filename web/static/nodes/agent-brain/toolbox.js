let _toolboxToolsCache = null;

async function _ensureToolboxCache(ctx) {
  if (_toolboxToolsCache) return _toolboxToolsCache;
  try {
    const data = await ctx.fetchJSON("/api/tools");
    _toolboxToolsCache = data;
    return data;
  } catch (_) {
    return null;
  }
}

(window.RundeerNodes = window.RundeerNodes || {})["toolbox"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    const disabledStr = String(props.disabled_tools || "");
    const disabledNames = disabledStr.split(",").map((s) => s.trim()).filter(Boolean);
    const overrides = {};
    for (const name of disabledNames) {
      overrides[name] = { enabled: false };
    }
    outputs.out = overrides;
  },

  buildBody(nodeId, node, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "ne-toolbox-body";

    const data = _toolboxToolsCache;
    if (!data || !data.categories) {
      const msg = document.createElement("div");
      msg.className = "ne-toolbox-loading";
      msg.textContent = "Loading tools\u2026";
      wrap.appendChild(msg);
      _ensureToolboxCache(ctx).then(() => {
        const el = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (el) { el.dataset.signature = "stale"; ctx.renderNodes(); }
      });
      return wrap;
    }

    const disabledStr = String(node.props.disabled_tools || "");
    const disabledSet = new Set(
      disabledStr.split(",").map((s) => s.trim()).filter(Boolean)
    );
    const allToolNames = data.tools.map((t) => t.name);
    const totalCount = allToolNames.length;
    const enabledCount = totalCount - [...disabledSet].filter((n) => allToolNames.includes(n)).length;

    function updateDisabledProp(newSet) {
      const val = [...newSet].filter((n) => allToolNames.includes(n)).join(",");
      node.props.disabled_tools = val;
      ctx.scheduleAutosave();
      ctx.schedulePreviewRefresh();
    }

    function refreshConnections() {
      requestAnimationFrame(ctx.renderConnections);
    }

    wrap.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    wrap.addEventListener("mousedown", (e) => e.stopPropagation());

    const master = document.createElement("div");
    master.className = "ne-toolbox-master";
    const masterCb = document.createElement("input");
    masterCb.type = "checkbox";
    masterCb.checked = enabledCount === totalCount;
    masterCb.indeterminate = enabledCount > 0 && enabledCount < totalCount;
    const masterLabel = document.createElement("span");
    masterLabel.className = "ne-toolbox-master-label";
    masterLabel.textContent = `All (${enabledCount}/${totalCount})`;
    master.append(masterCb, masterLabel);

    masterCb.addEventListener("mousedown", (e) => e.stopPropagation());
    masterCb.addEventListener("change", (e) => {
      e.stopPropagation();
      masterCb.indeterminate = false;
      if (masterCb.checked) disabledSet.clear();
      else allToolNames.forEach((n) => disabledSet.add(n));
      updateDisabledProp(disabledSet);
      const el = document.querySelector(`[data-node-id="${nodeId}"]`);
      if (el) { el.dataset.signature = "stale"; ctx.renderNodes(); }
    });

    wrap.appendChild(master);

    const catList = document.createElement("div");
    catList.className = "ne-toolbox-cats";

    for (let catIdx = 0; catIdx < data.categories.length; catIdx++) {
      const cat = data.categories[catIdx];
      const catTools = cat.tools || [];
      const catTotal = catTools.length;
      const catEnabled = catTools.filter((n) => !disabledSet.has(n)).length;
      const startOpen = catIdx < 2;

      const panel = document.createElement("div");
      const catCls = ["ne-toolbox-cat"];
      if (catEnabled < catTotal) catCls.push("has-disabled");
      if (catEnabled === 0) catCls.push("all-disabled");
      if (startOpen) catCls.push("is-open");
      panel.className = catCls.join(" ");

      const head = document.createElement("button");
      head.type = "button";
      head.className = "ne-toolbox-cat-head";
      const caret = document.createElement("span");
      caret.className = "ne-toolbox-caret";
      caret.textContent = "\u25b6";
      const catCb = document.createElement("input");
      catCb.type = "checkbox";
      catCb.checked = catEnabled === catTotal;
      catCb.indeterminate = catEnabled > 0 && catEnabled < catTotal;
      const catLabel = document.createElement("span");
      catLabel.className = "ne-toolbox-cat-label";
      catLabel.textContent = cat.label;
      const catCount = document.createElement("span");
      catCount.className = "ne-toolbox-cat-count";
      catCount.textContent = `${catEnabled}/${catTotal}`;
      head.append(caret, catCb, catLabel, catCount);

      const body = document.createElement("div");
      body.className = "ne-toolbox-cat-body";
      body.hidden = !startOpen;

      head.addEventListener("mousedown", (e) => e.stopPropagation());
      head.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.target === catCb || e.target.closest("input")) return;
        const wasOpen = panel.classList.contains("is-open");
        panel.classList.toggle("is-open");
        body.hidden = wasOpen;
        refreshConnections();
      });

      catCb.addEventListener("mousedown", (e) => e.stopPropagation());
      catCb.addEventListener("click", (e) => e.stopPropagation());
      catCb.addEventListener("change", (e) => {
        e.stopPropagation();
        const checked = catCb.checked;
        catCb.indeterminate = false;
        for (const toolName of catTools) {
          if (checked) disabledSet.delete(toolName);
          else disabledSet.add(toolName);
        }
        updateDisabledProp(disabledSet);
        const el = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (el) { el.dataset.signature = "stale"; ctx.renderNodes(); }
      });

      for (const toolName of catTools) {
        const isDisabled = disabledSet.has(toolName);
        const row = document.createElement("label");
        row.className = "ne-toolbox-tool" + (isDisabled ? " is-disabled" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !isDisabled;
        const nameSpan = document.createElement("span");
        nameSpan.className = "ne-toolbox-tool-name";
        nameSpan.textContent = toolName;
        row.append(cb, nameSpan);

        cb.addEventListener("mousedown", (e) => e.stopPropagation());
        cb.addEventListener("change", (e) => {
          e.stopPropagation();
          if (cb.checked) disabledSet.delete(toolName);
          else disabledSet.add(toolName);
          updateDisabledProp(disabledSet);
          const el = document.querySelector(`[data-node-id="${nodeId}"]`);
          if (el) { el.dataset.signature = "stale"; ctx.renderNodes(); }
        });

        body.appendChild(row);
      }

      panel.append(head, body);
      catList.appendChild(panel);
    }

    wrap.appendChild(catList);
    return wrap;
  },
};
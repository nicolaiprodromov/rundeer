(window.RundeerNodes = window.RundeerNodes || {})["run-trigger"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    outputs.run = true;
  },

  buildFooter(nodeId, node, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "ne-run-trigger-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ne-run-play";
    const graphBusy = Boolean(ctx._graphRunState());
    btn.title = graphBusy ? "A graph is already running" : (ctx.isNodeMuted(nodeId) ? "Unmute this node before running" : "Run connected command(s)");
    btn.disabled = graphBusy || ctx.isNodeMuted(nodeId);
    btn.setAttribute("aria-label", "Run connected command nodes");
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.74-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg><span>Run</span>`;
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      ctx.runFromTrigger(nodeId);
    });
    wrap.appendChild(btn);
    return wrap;
  },
};
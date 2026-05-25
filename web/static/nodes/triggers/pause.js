(window.RundeerNodes = window.RundeerNodes || {})["pause"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    outputs.out = inputs.in;
    outputs.in = inputs.in;
    await helpers.pauseGraphAtNode(helpers.nodeId, outputs, helpers.opts);
  },

  buildFooter(nodeId, node, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "ne-pause-node-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ne-pause-resume";
    btn.dataset.pauseResumeNode = nodeId;
    const active = ctx.isPauseNodeResumeReady(nodeId);
    btn.classList.toggle("is-active", active);
    btn.disabled = !active;
    btn.title = active ? "Resume graph flow" : "Available when graph execution is paused here";
    btn.setAttribute("aria-label", active ? "Resume graph flow" : "Resume graph flow when paused here");
    btn.innerHTML = `<span aria-hidden="true">\u25b6</span><span>Resume</span>`;
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (ctx.isPauseNodeResumeReady(nodeId)) ctx.resumeGraphRun("node");
    });
    wrap.appendChild(btn);
    return wrap;
  },
};
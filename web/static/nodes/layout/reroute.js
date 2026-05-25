(window.RundeerNodes = window.RundeerNodes || {})["reroute"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    outputs.out = inputs.in;
    const inc = helpers.activeIncomingEdges(helpers.nodeId, "in")[0];
    const src = inc ? helpers.graph.nodes[inc.fromNode] : null;
    const alias = src?._uvImage || src?.lastResult?.image || "";
    if (alias) node._uvImage = alias;
  },

  buildNode(id, node, def, ctx) {
    const el = document.createElement("div");
    el.className = "ne-node ne-reroute-node";
    el.dataset.nodeId = id;
    el.dataset.nodeType = node.type;
    el.dataset.category = def.category;
    el.dataset.signature = ctx.nodeSignature(node);
    el.classList.toggle("is-muted", Boolean(node.muted));
    el.style.width = `${node.width || def.defaultWidth || 88}px`;
    el.style.height = `${node.height || def.defaultHeight || 30}px`;

    function buildSocket(nodeId, isOutput) {
      const dot = document.createElement("div");
      dot.className = `ne-socket ne-reroute-socket ${isOutput ? "is-output" : "is-input"}`;
      dot.dataset.nodeId = nodeId;
      dot.dataset.socketId = isOutput ? "out" : "in";
      dot.dataset.socketType = "any";
      dot.dataset.isOutput = isOutput ? "1" : "0";
      dot.style.background = ctx.SOCKET_TYPES.any.color;
      dot.style.color = ctx.SOCKET_TYPES.any.color;
      dot.title = isOutput ? "Reroute output" : "Reroute input";
      const isConnected = isOutput
        ? ctx.graph.edges.some((edge) => edge.fromNode === nodeId && edge.fromSocket === "out")
        : ctx.graph.edges.some((edge) => edge.toNode === nodeId && edge.toSocket === "in");
      if (isConnected) dot.classList.add("is-connected");
      dot.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        ctx.startWire(e, nodeId, isOutput ? "out" : "in", "any", isOutput);
      });
      return dot;
    }

    const body = document.createElement("div");
    body.className = "ne-reroute-body";
    body.title = "Reroute";
    body.appendChild(buildSocket(id, false));
    body.appendChild(buildSocket(id, true));
    body.insertAdjacentHTML("beforeend", ctx.nodeMuteButtonMarkup(id, node, "ne-reroute-mute"));
    ctx.bindNodeMuteButton(body, id);
    body.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.classList.contains("ne-socket")) return;
      e.stopPropagation();
      ctx.startNodeDrag(e, id);
    });
    el.appendChild(body);

    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.classList.contains("ne-socket")) return;
      ctx.selectOnly(id);
    });
    return el;
  },

  resizeMin(node, def) {
    return { w: def?.defaultWidth || 88, h: def?.defaultHeight || 30 };
  },
};
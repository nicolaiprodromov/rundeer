function _swType(nodeId, sock, ctx) {
  const edge = ctx.activeIncomingEdges(nodeId, sock)[0];
  if (!edge) return null;
  const def = ctx.outputSocketDef(edge.fromNode, edge.fromSocket);
  return ctx.baseType(def?.type || "any");
}

(window.RundeerNodes = window.RundeerNodes || {})["switch"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    const useB = (inputs.sel !== undefined && inputs.sel !== "" && inputs.sel !== null)
      ? Boolean(inputs.sel)
      : Boolean(props.sel);
    outputs.out = useB ? inputs.b : inputs.a;
  },

  onEdgeChange(nodeId, changedSocket, ctx) {
    if (changedSocket !== "a" && changedSocket !== "b") return;
    const ta = _swType(nodeId, "a", ctx);
    const tb = _swType(nodeId, "b", ctx);
    if (ta == null || tb == null || ta === "any" || tb === "any" || ta === tb) return;
    ctx.graph.edges = ctx.graph.edges.filter(
      (e) => !(e.toNode === nodeId && e.toSocket === changedSocket)
    );
    ctx.renderGraph();
    ctx.scheduleAutosave();
  },
};

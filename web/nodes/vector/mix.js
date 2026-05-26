(window.RundeerNodes = window.RundeerNodes || {})["mix"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const mode = String(props.mode || "mix");
  const clamp = props.clamp !== false;
  const factorRaw = inputs.factor !== undefined && inputs.factor !== "" && inputs.factor !== null
    ? inputs.factor
    : Number(props.factor ?? 0.5);
  const aRaw = inputs.a !== undefined && inputs.a !== "" && inputs.a !== null
    ? inputs.a
    : (props.a ?? props.color_a ?? "#000000");
  const bRaw = inputs.b !== undefined && inputs.b !== "" && inputs.b !== null
    ? inputs.b
    : (props.b ?? props.color_b ?? "#ffffff");

  const factor = helpers._coerceMixInput(factorRaw, { isFactor: true });
  const a = helpers._coerceMixInput(aRaw, {});
  const b = helpers._coerceMixInput(bRaw, {});

  if (!factor.isPath && !a.isPath && !b.isPath) {
    const f = clamp ? Math.max(0, Math.min(1, Number(factor.scalar ?? factor.color?.[0] ?? 0))) : Number(factor.scalar ?? factor.color?.[0] ?? 0);
    const colA = a.color || [Number(a.scalar) || 0, Number(a.scalar) || 0, Number(a.scalar) || 0, 1];
    const colB = b.color || [Number(b.scalar) || 0, Number(b.scalar) || 0, Number(b.scalar) || 0, 1];
    const blended = helpers._jsBlend(colA, colB, mode);
    const out = colA.map((v, i) => (1 - f) * v + f * (blended[i] ?? v));
    outputs.out = helpers._rgbaToHex(out);
    helpers.appendRunLog(`  ↳ Mix(${mode}) → ${outputs.out} (scalar)\n`);
    return;
  }

  const payload = {
    mode,
    clamp,
    factor: factor.payload,
    a: a.payload,
    b: b.payload,
  };
  helpers.appendRunLog(`  ↳ Mix ${mode}\n`);
  const result = await helpers.graphFetchJSON("/api/uv/mix", {
    method: "POST",
    body: JSON.stringify(payload),
  }, helpers.opts);
  if (result.error) throw new Error(`mix: ${result.error}`);
  if (result.path) outputs.out = result.path;
  else if (result.color) outputs.out = helpers._rgbaToHex(result.color);
  else outputs.out = "";
  },

  canonicalInputSocketId(node, socketId) {
    if (socketId === "color_a") return "a";
    if (socketId === "color_b") return "b";
    return socketId;
  },

  migrate(node) {
    if (!node || node.type !== "mix") return node;
    node.props ||= {};
    if (node.props.a == null && node.props.color_a != null) node.props.a = node.props.color_a;
    if (node.props.b == null && node.props.color_b != null) node.props.b = node.props.color_b;
    delete node.props.color_a;
    delete node.props.color_b;
    return node;
  },

  migrateEdge(edge) {
    if (edge.toSocket === "color_a") edge.toSocket = "a";
    if (edge.toSocket === "color_b") edge.toSocket = "b";
    return edge;
  },
};
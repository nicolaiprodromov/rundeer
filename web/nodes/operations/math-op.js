(window.RundeerNodes = window.RundeerNodes || {})["math-op"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const op = props.op || "add";
  const eps = Number(inputs.eps ?? props.eps ?? 0.0001);
  const aRaw = inputs.a !== undefined && inputs.a !== "" && inputs.a !== null ? inputs.a : (props.a ?? 0);
  const bRaw = inputs.b !== undefined && inputs.b !== "" && inputs.b !== null ? inputs.b : (props.b ?? 0);
  const a = helpers._coerceMixInput(aRaw, {});
  const b = helpers._coerceMixInput(bRaw, {});

  if (!a.isPath && !b.isPath) {
    const av = Number(a.scalar ?? a.color?.[0] ?? 0);
    const bv = Number(b.scalar ?? b.color?.[0] ?? 0);
    let r = 0;
    switch (op) {
      case "add":           r = av + bv; break;
      case "subtract":      r = av - bv; break;
      case "multiply":      r = av * bv; break;
      case "divide":        r = bv === 0 ? 0 : av / bv; break;
      case "modulo":        r = bv === 0 ? 0 : av % bv; break;
      case "power":         r = Math.pow(av, bv); break;
      case "min":           r = Math.min(av, bv); break;
      case "max":           r = Math.max(av, bv); break;
      case "abs":           r = Math.abs(av); break;
      case "sqrt":          r = Math.sqrt(av); break;
      case "equal":         r = Math.abs(av - bv) <= eps; break;
      case "not-equal":     r = Math.abs(av - bv) > eps; break;
      case "greater":       r = av > bv; break;
      case "greater-equal": r = av >= bv; break;
      case "less":          r = av < bv; break;
      case "less-equal":    r = av <= bv; break;
    }
    outputs.out = r;
    helpers.appendRunLog(`  ↳ Math(${op}) → ${r}\n`);
    return;
  }

  helpers.appendRunLog(`  ↳ Math ${op}\n`);
  const result = await helpers.graphFetchJSON("/api/uv/math", {
    method: "POST",
    body: JSON.stringify({ op, eps, a: a.payload, b: b.payload }),
  }, helpers.opts);
  if (result.error) throw new Error(`math: ${result.error}`);
  outputs.out = (result.value != null) ? result.value : result.path;
  node._uvImage = result.image || result.preview || "";
} };
(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["sample-bundle"] = async function (node, inputs, outputs, props, helpers) {
  const v = inputs.bundle;
  const items = Array.isArray(v) ? v : (v !== undefined && v !== null && v !== "" ? [v] : []);
  const expr = String(props.expression ?? "").trim();
  const picked = helpers.parseSampleBundleExpression(expr, items.length);
  let chosen;
  if (picked === null) {
    chosen = items.slice();
  } else {
    chosen = picked.map((i) => items[i]);
  }
  const exprIsSingle = !!expr && expr !== "*" && !expr.includes(",") && !expr.includes(":");
  if (exprIsSingle && chosen.length === 1) {
    outputs.out = chosen[0];
  } else {
    outputs.out = chosen;
  }
  outputs.count = chosen.length;
};
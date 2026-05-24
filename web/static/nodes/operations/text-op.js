(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["text-op"] = async function (node, inputs, outputs, props, helpers) {
  const a = String(inputs.a ?? "");
  const b = String(inputs.b ?? "");
  const op = props.op || "to_string";
  const extra = String(props.extra ?? "");
  switch (op) {
    case "to_string": outputs.out = a; break;
    case "format":   outputs.out = (extra || "{a}").replace(/\{a\}/g, a).replace(/\{b\}/g, b); break;
    case "replace":  outputs.out = a.split(b).join(extra); break;
    case "upper":    outputs.out = a.toUpperCase(); break;
    case "lower":    outputs.out = a.toLowerCase(); break;
    case "trim":     outputs.out = a.trim(); break;
    case "slice": {
      const m = extra.split(":");
      const start = Number(m[0] || 0);
      const end = m[1] === undefined || m[1] === "" ? undefined : Number(m[1]);
      outputs.out = a.slice(start, end);
      break;
    }
    case "to_int":   outputs.out = parseInt(a, 10) || 0; break;
    case "to_float": outputs.out = parseFloat(a) || 0; break;
    case "length":   outputs.out = a.length; break;
    default:         outputs.out = a;
  }
};
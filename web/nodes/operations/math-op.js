(window.RundeerNodes = window.RundeerNodes || {})["math-op"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const a = Number(inputs.a ?? 0);
  const b = Number(inputs.b ?? 0);
  const op = props.op || "add";
  let r = 0;
  switch (op) {
    case "add":      r = a + b; break;
    case "subtract": r = a - b; break;
    case "multiply": r = a * b; break;
    case "divide":   r = b === 0 ? 0 : a / b; break;
    case "modulo":   r = b === 0 ? 0 : a % b; break;
    case "power":    r = Math.pow(a, b); break;
    case "min":      r = Math.min(a, b); break;
    case "max":      r = Math.max(a, b); break;
  }
  outputs.out = r;
} };
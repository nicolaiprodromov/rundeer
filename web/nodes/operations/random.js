(window.RundeerNodes = window.RundeerNodes || {})["random"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const pick = (key) => (inputs[key] !== undefined && inputs[key] !== "" && inputs[key] !== null) ? inputs[key] : props[key];
  const modeRaw = String(pick("mode") || "integer").trim().toLowerCase();
  const mode = ({ int: "integer", integer: "integer", float: "float", number: "float", str: "string", string: "string", text: "string" })[modeRaw] || "integer";
  let min = Number(pick("min") ?? 0);
  let max = Number(pick("max") ?? 100);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = mode === "string" ? 32 : 100;
  if (max < min) [min, max] = [max, min];
  if (mode === "float") {
    outputs.out = min + Math.random() * (max - min);
    return;
  }
  if (mode === "string") {
    const charsets = {
      alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
      lower_alpha: "abcdefghijklmnopqrstuvwxyz",
      upper_alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      numeric: "0123456789",
      hex: "0123456789abcdef",
      special: "!@#$%^&*()-_=+[]{};:,.<>/?",
      ascii: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.<>/?",
    };
    const charsetKey = String(pick("charset") || "alphanumeric").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const alphabet = charsets[charsetKey] || charsets.alphanumeric;
    const minLen = Math.max(0, Math.floor(min));
    const maxLen = Math.max(minLen, Math.floor(max));
    const length = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
    let value = "";
    for (let i = 0; i < length; i += 1) {
      value += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    outputs.out = value;
    return;
  }
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  outputs.out = hi < lo ? lo : lo + Math.floor(Math.random() * (hi - lo + 1));
} };
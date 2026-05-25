(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["prompt"] = async function (node, inputs, outputs, props, helpers) {
  const imageInputs = Array.isArray(inputs.input)
    ? inputs.input.filter((v) => v).map((v) => String(v))
    : (inputs.input ? [String(inputs.input)] : []);
  const imageNote = imageInputs.length
    ? ` + ${imageInputs.length} image${imageInputs.length === 1 ? "" : "s"}`
    : "";
  const pf_pick = (key) => (inputs[key] !== undefined && inputs[key] !== "" && inputs[key] !== null) ? inputs[key] : props[key];
  const pf_str = (key) => {
    const v = pf_pick(key);
    return (v == null) ? "" : String(v).trim();
  };
  const pf_num = (key) => {
    const v = pf_pick(key);
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const modelOverride = pf_str("model");
  const reasoningEffort = pf_str("reasoning_effort");
  const payload = {
    prompt: inputs.prompt || "",
    instructions: "Answer the user's prompt directly. Return only the response text.",
    images: imageInputs,
    model: modelOverride,
    reasoning_effort: (reasoningEffort && reasoningEffort !== "default") ? reasoningEffort : "",
    temperature: pf_num("temperature"),
    top_p: pf_num("top_p"),
    max_tokens: pf_num("max_tokens"),
    seed: pf_num("seed"),
    frequency_penalty: pf_num("frequency_penalty"),
    presence_penalty: pf_num("presence_penalty"),
    stop: pf_str("stop"),
  };
  const modelLabel = modelOverride || "RUNDEER_LLM_MODEL";
  const effortNote = payload.reasoning_effort ? ` (reasoning=${payload.reasoning_effort})` : "";
  helpers.appendRunLog(`  ↳ Prompting via ${modelLabel}${effortNote}${imageNote}…\n`);
  const result = await helpers.graphFetchJSON("/api/filter-prompt", {
    method: "POST",
    body: JSON.stringify(payload),
  }, helpers.opts);
  if (result.error) throw new Error(`prompt: ${result.error}`);
  outputs.out = result.filtered_prompt || inputs.prompt || "";
  helpers.appendRunLog(`  ↳ "${(outputs.out || "").slice(0, 80).replace(/\n/g, " ")}${outputs.out.length > 80 ? "…" : ""}"\n`);
};
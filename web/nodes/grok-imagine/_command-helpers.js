(function () {
  "use strict";

  function collectDefinitionMapForCommand(nodeId, ctx) {
    const definitions = {};
    const stack = [nodeId];
    const visited = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      for (const edge of ctx.activeIncomingEdges(current)) {
        const source = ctx.graph.nodes[edge.fromNode];
        if (!source || ctx.isNodeMuted(source)) continue;
        if (source.type === "definition") {
          const name = String(source.props?.name || "").trim().replace(/^@+/, "");
          const file = String(source.props?.file || "").trim();
          if (name && file) definitions[name] = file;
        }
        if (!visited.has(edge.fromNode)) stack.push(edge.fromNode);
      }
    }
    return definitions;
  }

  async function executeCommandNode(node, inputs, opts, ctx) {
    const cmdMap = {
      "cmd-image": "image", "cmd-video": "video", "cmd-edit": "edit",
      "cmd-merge": "merge", "cmd-extend": "extend",
    };
    const command = cmdMap[node.type];
    const p = node.props;

    const pick = (key) => (inputs[key] !== undefined && inputs[key] !== "" && inputs[key] !== null) ? inputs[key] : p[key];
    const num = (key, fallback) => {
      const v = pick(key);
      if (v === "" || v == null) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const optionalNum = (key) => {
      const v = pick(key);
      if (v === "" || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const str = (key, fallback) => {
      const v = pick(key);
      return (v === "" || v == null) ? (fallback ?? "") : String(v);
    };
    const bool = (key, fallback = false) => {
      const v = pick(key);
      if (v === "" || v == null) return fallback;
      if (typeof v === "string") return !["false", "0", "no", "off"].includes(v.trim().toLowerCase());
      return Boolean(v);
    };

    const inputList = Array.isArray(inputs.input)
      ? inputs.input.filter((v) => v).map((v) => String(v)).join(",")
      : (inputs.input || "");
    const outputDir = str("output_dir", ".rundeer/outputs");
    const outputName = str("output_name", "output");
    const model = str("model", "");
    const aspectRatio = str("aspect_ratio", "");
    const resolution = str("resolution", "");
    const usesImageModel = command === "image" || command === "merge" || command === "edit";
    const usesVideoModel = command === "video" || command === "extend" || command === "edit";
    const payload = {
      command,
      dryRun: Boolean(opts.dryRun),
      subject: inputs.subject || "",
      motion: inputs.motion || "",
      style: str("style", ""),
      batch: {
        iterations: num("iterations", 1),
        concurrency: optionalNum("concurrency"),
        grid: false,
        grid_only: false,
        grid_options: {
          rows: "auto",
          columns: "auto",
          padding: 0,
          bg_color: "#000000",
        },
        chain: bool("chain", false),
        chain_compose: bool("chain_compose", false),
        chain_threshold: num("chain_threshold", 12),
        chain_override: num("chain_override", 50),
        chain_dilate: num("chain_dilate", 6),
        chain_feather: num("chain_feather", 8),
        chain_min_region: num("chain_min_region", 64),
      },
      image: {
        model: usesImageModel ? model : "",
        aspect_ratio: command === "image" || command === "merge" || (command === "edit" && str("edit_type", "image") === "image") ? aspectRatio : "",
        resolution: command === "image" || command === "merge" || (command === "edit" && str("edit_type", "image") === "image") ? resolution : "",
      },
      video: {
        model: usesVideoModel ? model : "",
        aspect_ratio: command === "video" || (command === "edit" && str("edit_type", "image") === "video") ? aspectRatio : "",
        duration: num("duration", 6),
        resolution: command === "video" || (command === "edit" && str("edit_type", "image") === "video") ? (resolution || "720p") : "",
      },
      inputs: {
        input: inputList,
        startFrame: inputs.start_frame || "",
        source: inputs.source || "",
        editType: str("edit_type", "image"),
      },
      output: { dir: outputDir, name: outputName },
      references: {
        ids: str("reference_ids", ""),
        pad: bool("pad_reference", true),
        quality: num("ref_quality", 85),
      },
      definitions: collectDefinitionMapForCommand(node.id, ctx),
      extra: {},
    };

    ctx.appendRunLog(`  \u21b3 ${command} \u00b7 "${(payload.subject || "").slice(0, 50)}"\n`);

    const endpoint = payload.dryRun ? "/api/plan" : "/api/run";
    const result = await ctx.graphFetchJSON(endpoint, { method: "POST", body: JSON.stringify(payload) }, opts);

    if (payload.dryRun) {
      ctx.appendRunLog(result.output || "(no output)\n");
      ctx.bindRunLogToRun(result.id);
      await ctx.persistRunLogNow(result.id);
      return { id: result.id };
    }

    ctx.appendRunLog(`  \u21b3 run ${result.id}\n`);
    const runState = ctx.graphRunFromOpts(opts);
    if (runState && result.id) runState.activeRunIds.add(result.id);
    ctx.bindRunLogToRun(result.id);
    await ctx.persistRunLogNow(result.id);
    let final;
    try {
      final = await ctx.pollUntilDone(result.id, opts);
    } finally {
      if (runState && result.id) runState.activeRunIds.delete(result.id);
      await ctx.persistRunLogNow(result.id).catch(() => {});
    }

    const artifacts = await ctx.findArtifactsForRun(final, { output_dir: outputDir, output_name: outputName }, opts);
    return {
      id: result.id,
      firstArtifact: artifacts[0] || "",
      artifacts,
    };
  }

  window.RundeerNodeHelpers = window.RundeerNodeHelpers || {};
  window.RundeerNodeHelpers.executeCommandNode = executeCommandNode;
  window.RundeerNodeHelpers.collectDefinitionMapForCommand = collectDefinitionMapForCommand;
})();
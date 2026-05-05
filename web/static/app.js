// rundeer console — frontend controller.
// Talks to /api/state, /api/plan, /api/run, /api/runs/:id, /api/artifacts,
// /api/files, /api/tree, /api/references, /api/mentions, /api/artifact-meta.

const $ = (id) => document.getElementById(id);

const COMMAND_TAGLINE = {
  image: "A batch of stills routed through the chosen style brain.",
  video: "Motion clips generated from a subject and optional start frame.",
  edit: "Targeted edits over an image or video, optionally chained.",
  merge: "Composite two source frames through the style brain.",
  extend: "Continue an existing clip or remix it with new motion.",
  batch: "Replay a batch.json plan; multiple jobs back-to-back.",
  benchmark: "Sweep a benchmark template across the configured matrix.",
};

const STATUS_LABELS = {
  idle: "Idle", queued: "Queued", running: "Running", done: "Done",
  failed: "Failed", "plan-ready": "Plan ready", "plan-failed": "Plan failed",
  "run-failed": "Run failed", error: "Error",
};

const DEFAULT_WEB_SETTINGS = {
  artifact_view: "grid",
  artifact_size: "md",
  dock_expanded: false,
  output_open_on_run: true,
  output_panel_open: true,
  files_panel_open: true,
  artifacts_panel_open: true,
};

const DEFAULT_RATE_LIMITS = {
  enabled: false,
  per_second: null,
  per_minute: null,
  per_hour: null,
  per_day: null,
};

let DEER_FRAMES = [];

const state = {
  data: null,
  command: "image",
  references: new Set(),
  refTreeOpen: new Set(),    // collapse state for reference tree dirs
  fileTreeOpen: new Set(["/"]),
  fileTreeRoot: null,
  fileFilter: "",
  artifactView: "grid",      // grid | tree
  artifactSize: "md",
  artifactSearch: "",
  artifacts: [],
  pollHandle: null,
  outputBuffer: "",
  outputRendered: 0,
  outputTimer: null,
  mention: { open: false, items: [], index: 0, range: null, query: "" },
  mentionSeed: [],
  mentionIndex: [],
  mentionFetchTimer: null,
  mentionFetchController: null,
  mentionFetchSeq: 0,
  panels: { output: true, files: true, artifacts: true },
  settings: { web: { ...DEFAULT_WEB_SETTINGS }, rate_limits: { ...DEFAULT_RATE_LIMITS } },
  zoom: { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 },
  dockExpanded: false,
};

// --- Boot ---------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  bindStaticHandlers();
  startDeerAnimation();
  loadState();
  loadFileTree();
});

function bindStaticHandlers() {
  $("refreshButton").addEventListener("click", () => { loadState(); loadFileTree(); });
  $("settingsButton").addEventListener("click", openSettings);
  $("settingsBackdrop").addEventListener("click", closeSettings);
  $("settingsClose").addEventListener("click", closeSettings);
  $("settingsCancel").addEventListener("click", closeSettings);
  $("settingsForm").addEventListener("submit", saveSettings);
  $("refreshArtifactsButton").addEventListener("click", loadArtifacts);
  $("addDefinitionButton").addEventListener("click", addDefinitionRow);
  $("dryRunButton").addEventListener("click", () => submit({ dryRun: true }));
  $("runButton").addEventListener("click", () => submit({ dryRun: false }));

  document.querySelectorAll(".rail-item").forEach((btn) => {
    btn.addEventListener("click", () => setCommand(btn.dataset.command));
  });

  $("fileSearch").addEventListener("input", debounce((e) => {
    state.fileFilter = e.target.value.trim().toLowerCase();
    renderFileTree();
  }, 160));
  $("treeExpandAll").addEventListener("click", () => walkSetOpen(state.fileTreeRoot, true, state.fileTreeOpen));
  $("treeCollapseAll").addEventListener("click", () => { state.fileTreeOpen = new Set(["/"]); renderFileTree(); });

  $("refSearch").addEventListener("input", debounce(renderReferenceTree, 120));
  $("refExpandAll").addEventListener("click", () => { state.refTreeOpen = new Set(["__all__"]); renderReferenceTree(); });
  $("refCollapseAll").addEventListener("click", () => { state.refTreeOpen = new Set(); renderReferenceTree(); });
  $("refClearSelection").addEventListener("click", () => {
    state.references.clear();
    $("references").value = "";
    renderReferenceTree();
  });
  $("references").addEventListener("input", () => {
    state.references = new Set($("references").value.split(/[\s,]+/).filter(Boolean));
    renderReferenceTree();
  });
  $("style").addEventListener("change", () => loadReferenceTree());

  $("copyOutputButton").addEventListener("click", copyOutput);
  $("outputCollapseButton").addEventListener("click", () => togglePanel("output"));
  $("filesCollapseButton").addEventListener("click", () => togglePanel("files"));

  // Artifact dock controls
  $("artifactSearch").addEventListener("input", debounce((e) => {
    state.artifactSearch = e.target.value.trim().toLowerCase();
    renderArtifacts();
  }, 140));
  document.querySelectorAll("#artifactDock .seg-btn[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#artifactDock .seg-btn[data-view]").forEach((x) => x.classList.toggle("is-active", x === b));
      state.artifactView = b.dataset.view;
      renderArtifacts();
    });
  });
  document.querySelectorAll("#artifactDock .seg-btn[data-size]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#artifactDock .seg-btn[data-size]").forEach((x) => x.classList.toggle("is-active", x === b));
      state.artifactSize = b.dataset.size;
      $("artifactGrid").dataset.size = state.artifactSize;
    });
  });
  $("dockExpandButton").addEventListener("click", () => {
    if (!state.panels.artifacts) setPanelCollapsed("artifacts", false);
    state.dockExpanded = !state.dockExpanded;
    document.body.classList.toggle("dock-expanded", state.dockExpanded);
    $("dockExpandButton").textContent = state.dockExpanded ? "normal" : "large";
  });
  $("dockCollapseButton").addEventListener("click", () => togglePanel("artifacts"));

  bindLightbox();
  bindMentions();

  document.addEventListener("keydown", (e) => {
    if (!$("settingsPage").hidden && e.key === "Escape") { closeSettings(); return; }
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (e.key === "Enter") { e.preventDefault(); submit({ dryRun: e.shiftKey }); }
  });
}

function togglePanel(name) {
  setPanelCollapsed(name, state.panels[name]);
}

function setPanelCollapsed(name, collapsed) {
  state.panels[name] = !collapsed;
  const label = collapsed ? "show" : "hide";
  const icon = collapsed ? "+" : "−";

  if (name === "output") {
    setPanelButton("outputCollapseButton", label, icon, collapsed ? "Show output" : "Hide output");
    $("outputPanel").classList.toggle("is-collapsed", collapsed);
    updateAsideLayout();
  } else if (name === "files") {
    setPanelButton("filesCollapseButton", label, icon, collapsed ? "Show files" : "Hide files");
    $("filesPanel").classList.toggle("is-collapsed", collapsed);
    updateAsideLayout();
  } else if (name === "artifacts") {
    $("artifactDock").classList.toggle("is-collapsed", collapsed);
    $("dockCollapseButton").textContent = label;
    $("dockCollapseButton").setAttribute("aria-expanded", String(!collapsed));
  }
}

function setPanelButton(id, label, icon, title) {
  const btn = $(id);
  btn.setAttribute("aria-expanded", String(label === "hide"));
  btn.setAttribute("aria-label", title);
  btn.title = title;
  const iconNode = btn.querySelector("[aria-hidden='true']");
  const labelNode = btn.querySelector("span:last-child");
  if (iconNode) iconNode.textContent = icon;
  if (labelNode) labelNode.textContent = label;
}

function updateAsideLayout() {
  const aside = document.querySelector(".aside");
  if (!aside) return;
  const outputOpen = state.panels.output;
  const filesOpen = state.panels.files;
  aside.classList.toggle("is-output-collapsed", !outputOpen);
  aside.classList.toggle("is-files-collapsed", !filesOpen);
  if (outputOpen && filesOpen) aside.style.gridTemplateRows = "minmax(0, 1fr) minmax(0, 1fr)";
  else if (!outputOpen && filesOpen) aside.style.gridTemplateRows = "auto minmax(0, 1fr)";
  else if (outputOpen && !filesOpen) aside.style.gridTemplateRows = "minmax(0, 1fr) auto";
  else aside.style.gridTemplateRows = "auto auto";
}

// --- State load ---------------------------------------------------------

async function loadState() {
  try {
    const data = await fetchJSON("/api/state");
    state.data = data;
    hydrateSettingsFromState(data);
    hydrateMasthead(data);
    hydrateOptions(data);
    buildMentionIndex();
    loadMentionSeed();
    hydrateArtifacts(data.artifacts || []);
    setCommand(state.command);
    loadReferenceTree();
  } catch (err) {
    appendOutput(`Failed to load state: ${err.message}`, "error");
  }
}

function hydrateSettingsFromState(data) {
  const norm = (data.config && data.config.normalized) || {};
  state.settings = {
    web: normalizeWebSettings(norm.web),
    rate_limits: normalizeRateLimits(norm.rate_limits),
  };
  applyWebSettings(state.settings.web);
}

function normalizeWebSettings(web = {}) {
  return { ...DEFAULT_WEB_SETTINGS, ...(web || {}) };
}

function normalizeRateLimits(rateLimits = {}) {
  return { ...DEFAULT_RATE_LIMITS, ...(rateLimits || {}) };
}

function applyWebSettings(webSettings = state.settings.web) {
  const web = normalizeWebSettings(webSettings);
  state.settings.web = web;
  state.artifactView = web.artifact_view === "tree" ? "tree" : "grid";
  state.artifactSize = ["sm", "md", "lg"].includes(web.artifact_size) ? web.artifact_size : "md";
  state.dockExpanded = Boolean(web.dock_expanded);

  document.querySelectorAll("#artifactDock .seg-btn[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.artifactView);
  });
  document.querySelectorAll("#artifactDock .seg-btn[data-size]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.size === state.artifactSize);
  });
  $("artifactGrid").dataset.size = state.artifactSize;
  document.body.classList.toggle("dock-expanded", state.dockExpanded);
  $("dockExpandButton").textContent = state.dockExpanded ? "normal" : "large";

  setPanelCollapsed("output", web.output_panel_open === false);
  setPanelCollapsed("files", web.files_panel_open === false);
  setPanelCollapsed("artifacts", web.artifacts_panel_open === false);
  renderArtifacts();
}

async function loadArtifacts() {
  try {
    const data = await fetchJSON("/api/artifacts");
    hydrateArtifacts(data.artifacts || []);
  } catch (err) {
    appendOutput(`Failed to load artifacts: ${err.message}`, "error");
  }
}

async function loadFileTree() {
  try {
    const data = await fetchJSON("/api/tree");
    state.fileTreeRoot = data.tree;
    state.fileTreeOpen.add("");
    buildMentionIndex();
    if ($("filesRoot")) $("filesRoot").textContent = data.tree?.name ? `· ${data.tree.name}` : "";
    renderFileTree();
  } catch (err) {
    $("fileTree").innerHTML = `<div class="file-empty">tree unavailable: ${escape(err.message)}</div>`;
  }
}

async function loadReferenceTree() {
  const style = $("style").value || "";
  try {
    const params = new URLSearchParams();
    if (style) params.set("style", style);
    const data = await fetchJSON(`/api/references?${params.toString()}`);
    state.referenceItems = data.references || [];
    if (state.referenceItems.length) state.refTreeOpen.add(`style:${style || "*"}`);
    $("referenceMeta").textContent = state.referenceItems.length ? `· ${state.referenceItems.length}` : "";
    renderReferenceTree();
  } catch (err) {
    $("referenceTree").innerHTML = `<div class="reference-empty">references unavailable: ${escape(err.message)}</div>`;
  }
}

// --- Masthead -----------------------------------------------------------

function hydrateMasthead(data) {
  $("versionTag").textContent = data.version || "?";
  $("projectRoot").textContent = data.projectRoot || "?";
  const env = data.env || {};
  const keysOk = Boolean(env.VISION_API_KEY && env.MODEL_API_KEY);
  setStat("keyStatus", keysOk ? "ok" : "missing", keysOk ? "is-positive" : "is-quiet");
  setStat("stylesStat", String((data.styles || []).length), null);
  const cfgErr = data.config && data.config.error;
  setStat("configStat", cfgErr ? "error" : "ok", cfgErr ? "is-quiet" : "is-positive");
}

function setStat(id, value, mod) {
  const el = $(id);
  el.textContent = value;
  el.classList.remove("is-positive", "is-quiet");
  if (mod) el.classList.add(mod);
}

// --- Options ------------------------------------------------------------

function hydrateOptions(data) {
  const opt = data.options || {};
  fillSelect("imageModel", opt.imageModels || []);
  fillSelect("videoModel", opt.videoModels || []);
  fillSelect("imageAspectRatio", opt.aspectRatios || []);
  fillSelect("videoAspectRatio", opt.aspectRatios || []);
  fillSelect("imageResolution", (opt.imageResolutions || []).map((v) => v || "(default)"), opt.imageResolutions);
  fillSelect("videoResolution", opt.videoResolutions || []);

  const styles = (data.styles || []).map((s) => ({ value: s.name, label: s.name }));
  const select = $("style");
  select.innerHTML = "";
  if (styles.length === 0) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = "(no styles found)";
    select.appendChild(o);
  } else {
    for (const s of styles) {
      const o = document.createElement("option");
      o.value = s.value; o.textContent = s.label;
      select.appendChild(o);
    }
  }

  const norm = (data.config && data.config.normalized) || {};
  if (norm.image) {
    setIfEmpty("imageModel", norm.image.model);
    setIfEmpty("imageAspectRatio", norm.image.aspect_ratio);
    setIfEmpty("imageResolution", norm.image.resolution || "");
  }
  if (norm.video) {
    setIfEmpty("videoModel", norm.video.model);
    setIfEmpty("videoAspectRatio", norm.video.aspect_ratio);
    setIfEmpty("videoResolution", norm.video.resolution);
    setIfEmpty("duration", norm.video.duration);
  }
  if (norm.batch) setIfEmpty("outputDir", norm.batch.output_dir || ".rundeer/outputs");
  if (typeof norm.subject === "string") setIfEmpty("subject", norm.subject);
  if (typeof norm.style === "string") setIfEmpty("style", norm.style);
}

function fillSelect(id, labels, values) {
  const el = $(id);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = "";
  labels.forEach((label, i) => {
    const v = values ? (values[i] ?? "") : label;
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label === "" ? "(default)" : label;
    el.appendChild(o);
  });
  if (cur && Array.from(el.options).some((o) => o.value === cur)) el.value = cur;
}

function setIfEmpty(id, value) {
  const el = $(id);
  if (!el || value == null) return;
  if (el.tagName === "SELECT") {
    if (Array.from(el.options).some((o) => o.value === String(value))) el.value = String(value);
  } else if (el.value === "" || el.value == null) {
    el.value = String(value);
  }
}

// --- Command rail ------------------------------------------------------

function setCommand(name) {
  state.command = name;
  document.querySelectorAll(".rail-item").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.command === name);
  });
  $("commandTitle").textContent = capitalize(name);
  $("commandSub").textContent = COMMAND_TAGLINE[name] || "";
  $("ledgerCommand").textContent = name;
  document.querySelectorAll("[class*='command-']").forEach((el) => {
    const tags = Array.from(el.classList).filter((c) => c.startsWith("command-"));
    if (tags.length === 0) return;
    const matches = tags.includes(`command-${name}`);
    el.classList.toggle("is-hidden", !matches);
  });
}

// --- Reference tree -----------------------------------------------------

function renderReferenceTree() {
  const host = $("referenceTree");
  if (!host) return;
  host.innerHTML = "";
  const items = state.referenceItems || [];
  if (items.length === 0) {
    host.innerHTML = `<div class="reference-empty">no references for the selected style — drop images in <code>brain/&lt;Style&gt;/Reference/</code></div>`;
    return;
  }
  const q = ($("refSearch").value || "").trim().toLowerCase();
  const expandAll = state.refTreeOpen.has("__all__");

  // Group by style, then by referenceId-bucket of 25 for readability
  const byStyle = {};
  for (const it of items) {
    if (q && !(`${it.referenceId ?? ""}`.includes(q) || it.name.toLowerCase().includes(q) || (it.style || "").toLowerCase().includes(q))) continue;
    const k = it.style || "(default)";
    (byStyle[k] = byStyle[k] || []).push(it);
  }

  for (const styleName of Object.keys(byStyle).sort()) {
    const list = byStyle[styleName];
    const styleKey = `style:${styleName}`;
    const open = expandAll || state.refTreeOpen.has(styleKey) || q;
    const dir = document.createElement("div");
    dir.className = "ref-dir";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "ref-dir-head";
    head.innerHTML = `<span class="caret ${open ? "is-open" : ""}">▸</span><span class="ref-dir-name">${escape(styleName)}</span><span class="ref-dir-count">${list.length}</span>`;
    head.addEventListener("click", () => {
      if (state.refTreeOpen.has(styleKey)) state.refTreeOpen.delete(styleKey);
      else state.refTreeOpen.add(styleKey);
      renderReferenceTree();
    });
    dir.appendChild(head);
    if (open) {
      const grid = document.createElement("div");
      grid.className = "ref-dir-grid";
      list.forEach((p) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "reference-item";
        const idStr = String(p.referenceId ?? "");
        if (idStr && state.references.has(idStr)) item.classList.add("is-selected");
        item.innerHTML = `
          <img src="${escape(p.url)}" alt="${escape(p.name)}" loading="lazy">
          <strong>${escape(idStr || "—")} · ${escape(p.name)}</strong>`;
        item.addEventListener("click", () => toggleReference(idStr, item));
        grid.appendChild(item);
      });
      dir.appendChild(grid);
    }
    host.appendChild(dir);
  }
}

function toggleReference(id, el) {
  if (id == null || id === "") return;
  const key = String(id);
  if (state.references.has(key)) { state.references.delete(key); el.classList.remove("is-selected"); }
  else { state.references.add(key); el.classList.add("is-selected"); }
  $("references").value = Array.from(state.references).join(",");
}

// --- Definitions --------------------------------------------------------

function addDefinitionRow(initial = {}) {
  const row = document.createElement("div");
  row.className = "definition-row";
  row.innerHTML = `
    <input type="text" placeholder="name" value="${escape(initial.name || "")}">
    <input type="text" placeholder="path or function" value="${escape(initial.value || "")}">
    <button class="btn btn-ghost btn-tiny" type="button">×</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove());
  $("definitionRows").appendChild(row);
}

function collectDefinitions() {
  const out = [];
  document.querySelectorAll(".definition-row").forEach((row) => {
    const [name, value] = row.querySelectorAll("input");
    if (name.value.trim()) out.push({ name: name.value.trim(), value: value.value.trim() });
  });
  return out;
}

// --- File tree ----------------------------------------------------------

function walkSetOpen(node, open, set) {
  if (!node) return;
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.kind === "dir") {
      if (open) set.add(n.path || "");
      else set.delete(n.path || "");
      (n.children || []).forEach((c) => stack.push(c));
    }
  }
  renderFileTree();
}

async function toggleTreeNode(node) {
  const key = node.path || "";
  if (state.fileTreeOpen.has(key)) {
    state.fileTreeOpen.delete(key);
    renderFileTree();
    return;
  }
  state.fileTreeOpen.add(key);
  if (!node.loaded && !node.loading) {
    node.loading = true;
    renderFileTree();
    try {
      const data = await fetchJSON(`/api/tree?path=${encodeURIComponent(node.path || "")}`);
      node.children = data.tree.children || [];
      node.loaded = true;
      buildMentionIndex();
    } catch (err) {
      node.children = [{ name: `unavailable: ${err.message}`, path: `${node.path}/__error__`, kind: "file", size: 0 }];
    } finally {
      node.loading = false;
    }
  }
  renderFileTree();
}

function renderFileTree() {
  const host = $("fileTree");
  if (!host) return;
  host.innerHTML = "";
  if (!state.fileTreeRoot) {
    host.innerHTML = `<div class="file-empty">loading…</div>`;
    return;
  }
  const filtered = filterTree(state.fileTreeRoot, state.fileFilter);
  if (!filtered) {
    host.innerHTML = `<div class="file-empty">no matches in workspace tree</div>`;
    return;
  }
  // Render the root's children directly (skip the synthetic root chrome).
  (filtered.children || []).forEach((c) => host.appendChild(renderTreeNode(c, 0)));
}

function filterTree(node, q) {
  if (!q) return node;
  if (node.kind === "dir") {
    const kids = (node.children || []).map((c) => filterTree(c, q)).filter(Boolean);
    if (kids.length === 0 && !node.name.toLowerCase().includes(q)) return null;
    state.fileTreeOpen.add(node.path || "");
    return { ...node, children: kids };
  }
  return node.path.toLowerCase().includes(q) || node.name.toLowerCase().includes(q) ? node : null;
}

function renderTreeNode(node, depth) {
  const row = document.createElement("div");
  row.className = "tree-node";
  row.style.setProperty("--depth", depth);
  if (node.kind === "dir") {
    const open = state.fileTreeOpen.has(node.path || "");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "tree-row tree-dir";
    const count = node.loaded ? (node.children || []).length : "…";
    head.innerHTML = `<span class="caret ${open ? "is-open" : ""}">▸</span><span class="tree-icon">▢</span><span class="tree-name">${escape(node.name)}</span><span class="tree-count">${count}</span>`;
    head.addEventListener("click", () => toggleTreeNode(node));
    row.appendChild(head);
    if (open) {
      const inner = document.createElement("div");
      inner.className = "tree-children";
      if (node.loading) {
        const loading = document.createElement("div");
        loading.className = "file-empty tree-loading";
        loading.textContent = "loading…";
        inner.appendChild(loading);
      } else {
        (node.children || []).forEach((c) => inner.appendChild(renderTreeNode(c, depth + 1)));
      }
      row.appendChild(inner);
    }
  } else {
    const head = document.createElement("div");
    head.className = "tree-row tree-file";
    head.innerHTML = `<span class="caret"> </span><span class="tree-icon">${fileGlyph(node)}</span><span class="tree-name" title="${escape(node.path)}">${escape(node.name)}</span>
      <span class="tree-actions">
        <button type="button" data-act="open" title="Open">↗</button>
        <button type="button" data-act="copy-path" title="Copy path">⧉</button>
        <button type="button" data-act="mention" title="Insert @ reference into subject">@</button>
      </span>`;
    head.querySelector('[data-act="open"]').addEventListener("click", () => window.open(node.url, "_blank"));
    head.querySelector('[data-act="copy-path"]').addEventListener("click", () => navigator.clipboard.writeText(node.path));
    head.querySelector('[data-act="mention"]').addEventListener("click", () => insertAtCursor($("subject"), `@${node.path}`));
    row.appendChild(head);
  }
  return row;
}

function fileGlyph(n) {
  switch (n.kind) {
    case "image": return "▣";
    case "video": return "▶";
    case "text": return "≡";
    default: return "·";
  }
}

// --- Artifacts ----------------------------------------------------------

function hydrateArtifacts(artifacts) {
  state.artifacts = artifacts;
  setStat("artifactsStat", String(artifacts.length), artifacts.length > 0 ? null : "is-quiet");
  $("artifactCount").textContent = artifacts.length ? `· ${artifacts.length}` : "";
  renderArtifacts();
}

function renderArtifacts() {
  const grid = $("artifactGrid");
  const tree = $("artifactTree");
  const items = filterArtifacts();
  if (state.artifactView === "tree") {
    grid.hidden = true;
    tree.hidden = false;
    renderArtifactTree(tree, items);
  } else {
    grid.hidden = false;
    tree.hidden = true;
    renderArtifactGrid(grid, items);
  }
}

function filterArtifacts() {
  const q = state.artifactSearch;
  if (!q) return state.artifacts;
  return state.artifacts.filter((a) => a.path.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
}

function renderArtifactGrid(grid, items) {
  grid.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dock-empty";
    empty.innerHTML = `<pre>     ,/|     _.--''^_
    /, \\ '.   /
   {  \\   '-'
    \\ /</pre><span>no artifacts yet — runs will appear here as they finish</span>`;
    grid.appendChild(empty);
    return;
  }
  items.forEach((a) => grid.appendChild(buildArtifactCard(a)));
}

function buildArtifactCard(a) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "artifact-item" + (a.isGrid ? " is-grid" : "");
  let media;
  if (a.kind === "image") {
    media = `<img src="${escape(a.url)}" alt="${escape(a.name)}" loading="lazy">`;
  } else if (a.kind === "video") {
    media = `<video src="${escape(a.url)}" muted playsinline preload="metadata"></video>`;
  } else {
    media = `<div class="artifact-text">${escape(a.name)}</div>`;
  }
  card.innerHTML = `
    ${media}
    <div class="artifact-body">
      <div class="artifact-name">${escape(a.name)}</div>
      <div class="artifact-meta">
        <span>${a.kind}</span>
        ${a.isGrid ? '<span class="grid-tag">grid</span>' : ""}
        <span>${formatSize(a.size)}</span>
      </div>
    </div>`;
  card.addEventListener("click", () => openLightbox(a));
  return card;
}

function renderArtifactTree(host, items) {
  host.innerHTML = "";
  // Build tree by directory.
  const root = { name: "/", path: "", kind: "dir", children: [] };
  const dirs = new Map([["", root]]);
  for (const a of items) {
    const parts = a.path.split("/");
    let acc = "";
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      acc = i === 0 ? parts[0] : `${acc}/${parts[i]}`;
      let dir = dirs.get(acc);
      if (!dir) {
        dir = { name: parts[i], path: acc, kind: "dir", children: [] };
        dirs.set(acc, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push({ ...a, kind: a.kind || "file", children: null });
  }
  const empty = items.length === 0;
  if (empty) {
    host.innerHTML = `<div class="file-empty">no artifacts</div>`;
    return;
  }
  // Sort and render
  (function sort(n) {
    if (!n.children) return;
    n.children.sort((x, y) => (x.children ? 0 : 1) - (y.children ? 0 : 1) || x.name.localeCompare(y.name));
    n.children.forEach(sort);
  })(root);
  root.children.forEach((c) => host.appendChild(renderArtifactTreeNode(c, 0)));
}

function renderArtifactTreeNode(node, depth) {
  const row = document.createElement("div");
  row.className = "tree-node";
  row.style.setProperty("--depth", depth);
  if (node.kind === "dir") {
    const key = `art:${node.path}`;
    const open = state.fileTreeOpen.has(key) || depth < 1;
    const head = document.createElement("button");
    head.type = "button";
    head.className = "tree-row tree-dir";
    head.innerHTML = `<span class="caret ${open ? "is-open" : ""}">▸</span><span class="tree-icon">▢</span><span class="tree-name">${escape(node.name)}</span><span class="tree-count">${(node.children || []).length}</span>`;
    head.addEventListener("click", () => {
      if (state.fileTreeOpen.has(key)) state.fileTreeOpen.delete(key);
      else state.fileTreeOpen.add(key);
      renderArtifacts();
    });
    row.appendChild(head);
    if (open) {
      const inner = document.createElement("div");
      inner.className = "tree-children";
      (node.children || []).forEach((c) => inner.appendChild(renderArtifactTreeNode(c, depth + 1)));
      row.appendChild(inner);
    }
  } else {
    const head = document.createElement("div");
    head.className = "tree-row tree-file is-artifact";
    head.innerHTML = `<span class="caret"> </span><span class="tree-icon">${fileGlyph(node)}</span><span class="tree-name" title="${escape(node.path)}">${escape(node.name)}</span><span class="tree-meta">${formatSize(node.size)}</span>`;
    head.addEventListener("click", () => openLightbox(node));
    row.appendChild(head);
  }
  return row;
}

// --- Lightbox / artifact viewer ----------------------------------------

function bindLightbox() {
  $("lightboxClose").addEventListener("click", closeLightbox);
  $("lightboxOpen").addEventListener("click", () => state.lightboxItem && window.open(state.lightboxItem.url, "_blank"));
  $("lightboxCopy").addEventListener("click", () => state.lightboxItem && navigator.clipboard.writeText(state.lightboxItem.path));
  $("lightboxZoomIn").addEventListener("click", () => zoomBy(1.25));
  $("lightboxZoomOut").addEventListener("click", () => zoomBy(1 / 1.25));
  $("lightboxFit").addEventListener("click", resetZoom);
  document.addEventListener("keydown", (e) => {
    if ($("lightbox").hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(1 / 1.25);
    else if (e.key === "0") resetZoom();
    else if (e.key === "ArrowRight") stepLightbox(1);
    else if (e.key === "ArrowLeft") stepLightbox(-1);
  });
}

async function openLightbox(item) {
  state.lightboxItem = item;
  resetZoom();
  $("lightbox").hidden = false;
  document.body.classList.add("lightbox-open");
  $("lightboxName").textContent = item.name;
  $("lightboxMeta").textContent = `${item.kind} · ${formatSize(item.size)}`;
  const body = $("lightboxBody");
  body.innerHTML = "";
  if (item.kind === "image") {
    const wrap = document.createElement("div");
    wrap.className = "zoom-wrap";
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.name;
    img.draggable = false;
    wrap.appendChild(img);
    body.appendChild(wrap);
    bindZoomPan(wrap, img);
  } else if (item.kind === "video") {
    const v = document.createElement("video");
    v.src = item.url; v.controls = true; v.autoplay = false; v.playsInline = true;
    body.appendChild(v);
  } else {
    const pre = document.createElement("pre");
    pre.className = "lightbox-text";
    try { pre.textContent = await (await fetch(item.url)).text(); } catch { pre.textContent = "(cannot preview)"; }
    body.appendChild(pre);
  }
  // Side metadata
  try {
    const meta = await fetchJSON(`/api/artifact-meta?path=${encodeURIComponent(item.path)}`);
    renderLightboxSide(meta);
  } catch (e) {
    $("lightboxSide").innerHTML = `<div class="meta-row">metadata unavailable: ${escape(e.message)}</div>`;
  }
}

function renderLightboxSide(meta) {
  const rows = [
    ["name", meta.name],
    ["path", meta.path],
    ["kind", meta.kind],
    ["size", formatSize(meta.size)],
    ["modified", meta.mtime ? new Date(meta.mtime * 1000).toLocaleString() : "—"],
  ];
  if (meta.width && meta.height) rows.push(["dimensions", `${meta.width} × ${meta.height}`]);
  let html = `<dl class="meta-list">`;
  for (const [k, v] of rows) html += `<div class="meta-row"><dt>${escape(k)}</dt><dd>${escape(String(v ?? "—"))}</dd></div>`;
  html += `</dl>`;
  if (meta.preview) html += `<pre class="meta-preview">${escape(meta.preview)}</pre>`;
  $("lightboxSide").innerHTML = html;
}

function closeLightbox() {
  $("lightbox").hidden = true;
  document.body.classList.remove("lightbox-open");
  $("lightboxBody").innerHTML = "";
  $("lightboxSide").innerHTML = "";
  state.lightboxItem = null;
}

function stepLightbox(delta) {
  if (!state.lightboxItem) return;
  const items = filterArtifacts();
  const idx = items.findIndex((a) => a.path === state.lightboxItem.path);
  if (idx < 0) return;
  const next = items[(idx + delta + items.length) % items.length];
  if (next) openLightbox(next);
}

function bindZoomPan(wrap, img) {
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomBy(factor);
  }, { passive: false });
  wrap.addEventListener("mousedown", (e) => {
    state.zoom.dragging = true;
    state.zoom.startX = e.clientX - state.zoom.x;
    state.zoom.startY = e.clientY - state.zoom.y;
    wrap.classList.add("is-dragging");
  });
  window.addEventListener("mousemove", (e) => {
    if (!state.zoom.dragging) return;
    state.zoom.x = e.clientX - state.zoom.startX;
    state.zoom.y = e.clientY - state.zoom.startY;
    applyZoom(img);
  });
  window.addEventListener("mouseup", () => {
    state.zoom.dragging = false;
    wrap.classList.remove("is-dragging");
  });
  applyZoom(img);
}

function zoomBy(factor) {
  state.zoom.scale = Math.min(8, Math.max(0.1, state.zoom.scale * factor));
  const img = document.querySelector(".zoom-wrap img");
  if (img) applyZoom(img);
}

function resetZoom() {
  state.zoom = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };
  const img = document.querySelector(".zoom-wrap img");
  if (img) applyZoom(img);
}

function applyZoom(img) {
  img.style.transform = `translate(${state.zoom.x}px, ${state.zoom.y}px) scale(${state.zoom.scale})`;
  $("lightboxZoom").textContent = `${Math.round(state.zoom.scale * 100)}%`;
}

// --- Mentions / @-popover ----------------------------------------------

function buildMentionIndex() {
  const items = [];
  const seen = new Set();
  const definitions = (state.data && state.data.definitions) || [];

  for (const seed of state.mentionSeed) {
    addMentionIndexItem(items, seen, {
      kind: seed.kind,
      label: seed.label,
      name: seed.name || seed.label,
      value: seed.value,
      detail: seed.detail || "",
    });
  }

  for (const definitionFile of definitions) {
    for (const functionName of definitionFile.functions || []) {
      addMentionIndexItem(items, seen, {
        kind: "definition",
        label: `@${functionName}`,
        name: functionName,
        value: `@${functionName}`,
        detail: definitionFile.path || "definition",
      });
    }
  }

  addFileMentionItems(state.fileTreeRoot, items, seen);
  state.mentionIndex = items;
}

async function loadMentionSeed() {
  try {
    const data = await fetchJSON("/api/mentions?q=");
    state.mentionSeed = [];
    mergeMentionSeed(data.items || []);
    buildMentionIndex();
    if (state.mention.open) updateMentionSuggestions(state.mention.query);
  } catch (err) {
    state.mentionSeed = [];
  }
}

function mergeMentionSeed(items) {
  const seen = new Set(state.mentionSeed.map((item) => `${item.kind}:${item.value}`));
  for (const item of items || []) {
    const key = `${item.kind}:${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    state.mentionSeed.push({
      kind: item.kind,
      label: item.label,
      name: item.name || item.label,
      value: item.value,
      detail: item.detail || "",
    });
  }
}

function addMentionIndexItem(items, seen, item) {
  const key = `${item.kind}:${item.value}`;
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

function addFileMentionItems(node, items, seen) {
  if (!node) return;
  if (node.kind === "dir") {
    (node.children || []).forEach((child) => addFileMentionItems(child, items, seen));
    return;
  }
  if (!node.path) return;
  addMentionIndexItem(items, seen, {
    kind: "file",
    label: node.path,
    name: node.name || node.path,
    value: node.path,
    detail: `${node.kind || "file"} · ${formatSize(node.size)}`,
  });
}

function bindMentions() {
  const ta = $("subject");
  ta.addEventListener("input", onMentionInput);
  ta.addEventListener("keydown", onMentionKeydown);
  ta.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) updateMentionFromTextarea(ta);
  });
  ta.addEventListener("blur", () => setTimeout(closeMentions, 80));
  document.addEventListener("pointerdown", (e) => {
    if (!$("mentionPopover").contains(e.target) && e.target !== ta) closeMentions();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.mention.range) closeMentions();
  }, true);
}

function onMentionInput(event) {
  updateMentionFromTextarea(event.target);
}

function updateMentionFromTextarea(ta) {
  const value = ta.value;
  const caret = ta.selectionStart;
  if (caret !== ta.selectionEnd) { closeMentions(); return; }
  const range = findActiveMentionRange(value, caret);
  if (!range) { closeMentions(); return; }
  const query = value.slice(range.start + 1, range.end);
  state.mention.range = range;
  state.mention.query = query;
  updateMentionSuggestions(query);
}

function findActiveMentionRange(value, caret) {
  let cursor = caret - 1;
  let foundAt = -1;
  while (cursor >= 0 && caret - cursor <= 96) {
    const char = value[cursor];
    if (char === "@") { foundAt = cursor; break; }
    if (/\s/.test(char)) break;
    cursor--;
  }
  if (foundAt < 0) return null;
  if (foundAt > 0 && /\S/.test(value[foundAt - 1])) return null;
  const token = value.slice(foundAt + 1, caret);
  if (token.includes("@")) return null;
  return { start: foundAt, end: caret };
}

function updateMentionSuggestions(query, allowRemote = true) {
  if (state.mentionIndex.length === 0) buildMentionIndex();
  const normalized = normalizeMentionQuery(query);
  const matches = state.mentionIndex
    .map((item, order) => ({ item, order, score: scoreMention(item, query) }))
    .filter((match) => Number.isFinite(match.score))
    .sort((left, right) => left.score - right.score || left.item.label.length - right.item.label.length || left.order - right.order)
    .slice(0, 18)
    .map((match) => match.item);
  state.mention.items = matches;
  state.mention.index = 0;
  state.mention.open = matches.length > 0;
  renderMentions();
  if (allowRemote && normalized && matches.length < 12) scheduleMentionFetch(query);
}

function scheduleMentionFetch(query) {
  if (state.mentionFetchTimer) clearTimeout(state.mentionFetchTimer);
  state.mentionFetchTimer = setTimeout(() => fetchMentionMatches(query), 70);
}

async function fetchMentionMatches(query) {
  if (state.mentionFetchController) state.mentionFetchController.abort();
  const controller = new AbortController();
  const seq = ++state.mentionFetchSeq;
  state.mentionFetchController = controller;
  try {
    const data = await fetchJSON(`/api/mentions?q=${encodeURIComponent(query)}`, { signal: controller.signal });
    if (seq !== state.mentionFetchSeq || !state.mention.range || state.mention.query !== query) return;
    mergeMentionSeed(data.items || []);
    buildMentionIndex();
    if (state.mention.query === query) updateMentionSuggestions(query, false);
  } catch (err) {
    if (err.name !== "AbortError") closeMentions();
  }
}

function scoreMention(item, query) {
  const normalized = normalizeMentionQuery(query);
  if (!normalized) return item.kind === "definition" ? 0 : 25 + Math.min(item.value.length / 120, 12);
  const label = item.label.toLowerCase();
  const value = item.value.toLowerCase();
  const name = (item.name || "").toLowerCase();
  const labelQuery = normalized.startsWith("@") ? normalized : `@${normalized}`;
  if (label === labelQuery || value === normalized || name === normalized) return 0;
  if (label.startsWith(labelQuery) || name.startsWith(normalized)) return 1;
  if (value.startsWith(normalized)) return 2;
  const nameHit = name.indexOf(normalized);
  if (nameHit >= 0) return 4 + nameHit / 100;
  const valueHit = value.indexOf(normalized);
  if (valueHit >= 0) return 8 + valueHit / 100;
  return Infinity;
}

function normalizeMentionQuery(query) {
  return String(query || "").trim().toLowerCase().replace(/^@+/, "");
}

function onMentionKeydown(e) {
  if (!state.mention.open) return;
  if (e.key === "ArrowDown") { e.preventDefault(); state.mention.index = Math.min(state.mention.items.length - 1, state.mention.index + 1); renderMentions(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); state.mention.index = Math.max(0, state.mention.index - 1); renderMentions(); }
  else if (e.key === "Enter" || e.key === "Tab") {
    if (state.mention.items.length) { e.preventDefault(); applyMention(state.mention.items[state.mention.index]); }
  } else if (e.key === "Escape") {
    closeMentions();
  }
}

function renderMentions() {
  const pop = $("mentionPopover");
  if (!state.mention.open || state.mention.items.length === 0) {
    pop.hidden = true; pop.innerHTML = ""; return;
  }
  pop.hidden = false;
  pop.innerHTML = state.mention.items.map((item, index) => `
    <button type="button" class="mention-item ${index === state.mention.index ? "is-active" : ""}" data-index="${index}">
      <span class="mention-kind ${item.kind}">${item.kind === "definition" ? "fn" : "file"}</span>
      <span class="mention-label">${escape(item.label)}</span>
      <span class="mention-detail">${escape(item.detail || "")}</span>
    </button>`).join("");
  pop.querySelectorAll(".mention-item").forEach((el) => {
    el.addEventListener("mouseenter", () => { state.mention.index = Number(el.dataset.index); });
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); applyMention(state.mention.items[Number(el.dataset.index)]); });
  });
  const ta = $("subject");
  const rect = ta.getBoundingClientRect();
  const host = ta.parentElement.getBoundingClientRect();
  pop.style.left = `0px`;
  pop.style.top = `${rect.bottom - host.top + 4}px`;
  pop.style.width = `${rect.width}px`;
  const active = pop.querySelector(".mention-item.is-active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function applyMention(item) {
  if (!item || !state.mention.range) return;
  const ta = $("subject");
  const value = ta.value;
  const before = value.slice(0, state.mention.range.start);
  const after = value.slice(state.mention.range.end);
  const token = item.kind === "definition" ? item.value : `@${item.value}`;
  const insertion = after && /^\s/.test(after) ? token : `${token} `;
  const next = before + insertion + after;
  ta.value = next;
  const pos = (before + insertion).length;
  ta.setSelectionRange(pos, pos);
  if (item.kind === "definition" && !definitionExists(item.value.replace(/^@/, ""))) {
    addDefinitionRow({ name: item.value.replace(/^@/, ""), value: item.detail });
  }
  closeMentions();
  ta.focus();
}

function definitionExists(name) {
  return Array.from(document.querySelectorAll(".definition-row input:first-child")).some((i) => i.value.trim() === name);
}

function closeMentions() {
  if (state.mentionFetchTimer) {
    clearTimeout(state.mentionFetchTimer);
    state.mentionFetchTimer = null;
  }
  if (state.mentionFetchController) {
    state.mentionFetchController.abort();
    state.mentionFetchController = null;
  }
  state.mention.open = false;
  state.mention.items = [];
  state.mention.range = null;
  state.mention.query = "";
  const pop = $("mentionPopover");
  pop.hidden = true;
  pop.innerHTML = "";
}

function insertAtCursor(ta, text) {
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const sep = before && !/\s$/.test(before) ? " " : "";
  const insertion = text.endsWith(" ") || (after && /^\s/.test(after)) ? text : `${text} `;
  ta.value = before + sep + insertion + after;
  const pos = (before + sep + insertion).length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  closeMentions();
}

// --- Settings -----------------------------------------------------------

async function openSettings() {
  $("settingsPage").hidden = false;
  document.body.classList.add("settings-open");
  $("settingsStatus").textContent = "";
  hydrateSettingsForm(state.settings);
  try {
    const data = await fetchJSON("/api/settings");
    state.settings = {
      web: normalizeWebSettings(data.settings && data.settings.web),
      rate_limits: normalizeRateLimits(data.settings && data.settings.rate_limits),
    };
    if (data.configPath) $("settingsConfigPath").textContent = data.configPath;
    hydrateSettingsForm(state.settings);
  } catch (err) {
    $("settingsStatus").textContent = err.message;
  }
  $("settingsRateEnabled").focus();
}

function closeSettings() {
  $("settingsPage").hidden = true;
  document.body.classList.remove("settings-open");
}

function hydrateSettingsForm(settings) {
  const web = normalizeWebSettings(settings && settings.web);
  const rate = normalizeRateLimits(settings && settings.rate_limits);
  setSelectValue("settingsArtifactView", web.artifact_view);
  setSelectValue("settingsArtifactSize", web.artifact_size);
  setChecked("settingsDockExpanded", web.dock_expanded);
  setChecked("settingsOutputOnRun", web.output_open_on_run);
  setChecked("settingsOutputPanelOpen", web.output_panel_open);
  setChecked("settingsFilesPanelOpen", web.files_panel_open);
  setChecked("settingsArtifactsPanelOpen", web.artifacts_panel_open);
  setChecked("settingsRateEnabled", rate.enabled);
  setNumberOrBlank("settingsRateSecond", rate.per_second);
  setNumberOrBlank("settingsRateMinute", rate.per_minute);
  setNumberOrBlank("settingsRateHour", rate.per_hour);
  setNumberOrBlank("settingsRateDay", rate.per_day);
}

async function saveSettings(event) {
  event.preventDefault();
  const payload = { settings: collectSettings() };
  const saveButton = $("settingsSave");
  saveButton.disabled = true;
  $("settingsStatus").textContent = "saving";
  try {
    const data = await fetchJSON("/api/settings", { method: "POST", body: JSON.stringify(payload) });
    state.settings = {
      web: normalizeWebSettings(data.settings && data.settings.web),
      rate_limits: normalizeRateLimits(data.settings && data.settings.rate_limits),
    };
    applyWebSettings(state.settings.web);
    if (state.data && state.data.config && state.data.config.normalized) {
      state.data.config.normalized.web = state.settings.web;
      state.data.config.normalized.rate_limits = state.settings.rate_limits;
    }
    $("settingsStatus").textContent = "saved";
    setTimeout(closeSettings, 180);
  } catch (err) {
    $("settingsStatus").textContent = err.message;
  } finally {
    saveButton.disabled = false;
  }
}

function collectSettings() {
  return {
    web: {
      artifact_view: $("settingsArtifactView").value,
      artifact_size: $("settingsArtifactSize").value,
      dock_expanded: $("settingsDockExpanded").checked,
      output_open_on_run: $("settingsOutputOnRun").checked,
      output_panel_open: $("settingsOutputPanelOpen").checked,
      files_panel_open: $("settingsFilesPanelOpen").checked,
      artifacts_panel_open: $("settingsArtifactsPanelOpen").checked,
    },
    rate_limits: {
      enabled: $("settingsRateEnabled").checked,
      per_second: optionalNumber("settingsRateSecond"),
      per_minute: optionalNumber("settingsRateMinute"),
      per_hour: optionalNumber("settingsRateHour"),
      per_day: optionalNumber("settingsRateDay"),
    },
  };
}

function setSelectValue(id, value) {
  const el = $(id);
  if (!el) return;
  if (Array.from(el.options).some((option) => option.value === String(value))) el.value = String(value);
}

function setChecked(id, value) {
  const el = $(id);
  if (el) el.checked = Boolean(value);
}

function setNumberOrBlank(id, value) {
  const el = $(id);
  if (el) el.value = value == null ? "" : String(value);
}

function optionalNumber(id) {
  const text = ($(id).value || "").trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

// --- Submit -------------------------------------------------------------

async function submit({ dryRun }) {
  const payload = collectPayload(dryRun);
  if (!dryRun && !(payload.subject || "").trim()) {
    setPanelCollapsed("output", false);
    setOutputStatus("error", null);
    appendOutput("subject is empty — type something or pick a .md file.\n", "error");
    return;
  }
  if (state.settings.web.output_open_on_run !== false) setPanelCollapsed("output", false);
  resetOutput();
  setOutputStatus("queued", null);
  appendOutput(`→ ${dryRun ? "planning" : "running"} ${state.command}…\n`, "info");
  try {
    const endpoint = dryRun ? "/api/plan" : "/api/run";
    const result = await fetchJSON(endpoint, { method: "POST", body: JSON.stringify(payload) });
    if (dryRun) {
      const status = result.returncode === 0 ? "plan-ready" : "plan-failed";
      setOutputStatus(status, result.id);
      appendOutput(formatPlan(result), "");
    } else {
      setOutputStatus("running", result.id);
      pollRun(result.id);
    }
  } catch (err) {
    setOutputStatus("error", null);
    appendOutput(`Request failed: ${err.message}\n`, "error");
  }
}

function collectPayload(dryRun) {
  const v = (id) => $(id).value;
  const checked = (id) => $(id).checked;
  const num = (id) => { const raw = $(id).value; return raw === "" ? null : Number(raw); };
  let extra = {};
  const extraText = $("extraConfig").value.trim();
  if (extraText) {
    try { extra = JSON.parse(extraText); }
    catch (err) { throw new Error(`extra config JSON invalid: ${err.message}`); }
  }
  return {
    command: state.command,
    dryRun,
    subject: v("subject"),
    motion: v("motion"),
    style: v("style"),
    iterations: num("iterations"),
    concurrency: num("concurrency"),
    image: { model: v("imageModel"), aspectRatio: v("imageAspectRatio"), resolution: v("imageResolution") },
    video: {
      model: v("videoModel"), aspectRatio: v("videoAspectRatio"), resolution: v("videoResolution"),
      duration: num("duration"), concurrency: num("videoConcurrency"), outputDir: v("videoOutputDir"),
    },
    inputs: {
      input: v("input"), startFrame: v("startFrame"), source: v("source"), editType: v("editType"),
      batchFile: v("batchFile"), benchmarkConfig: v("benchmarkConfig"), benchmarkTemplate: v("benchmarkTemplate"),
    },
    output: { dir: v("outputDir"), name: v("outputName") },
    references: { ids: v("references"), pad: checked("padReference"), quality: num("refQuality") },
    definitions: collectDefinitions(),
    grid: {
      enabled: checked("grid"), only: checked("gridOnly"),
      rows: v("gridRows"), columns: v("gridColumns"), padding: num("gridPadding"), bg: v("gridBgColor"),
    },
    chain: {
      enabled: checked("chain"), compose: checked("chainCompose"),
      threshold: num("chainThreshold"), override: num("chainOverride"),
      dilate: num("chainDilate"), feather: num("chainFeather"), minRegion: num("chainMinRegion"),
    },
    extra,
  };
}

function pollRun(runId) {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = setInterval(async () => {
    try {
      const rec = await fetchJSON(`/api/runs/${encodeURIComponent(runId)}`);
      streamOutput(rec.output || "");
      setOutputStatus(rec.status, rec.id);
      if (rec.status === "done" || rec.status === "failed") {
        clearInterval(state.pollHandle);
        state.pollHandle = null;
        loadArtifacts();
      }
    } catch (err) {
      clearInterval(state.pollHandle);
      state.pollHandle = null;
      setOutputStatus("error", runId);
      appendOutput(`Polling failed: ${err.message}\n`, "error");
    }
  }, 1100);
}

function setOutputStatus(status, id) {
  const pill = $("runStatus");
  const key = String(status || "idle").toLowerCase();
  pill.dataset.state = key;
  pill.textContent = STATUS_LABELS[key] || capitalize(key);
  $("runId").textContent = id ? `id ${id}` : "no run";
}

function resetOutput() {
  state.outputBuffer = "";
  state.outputRendered = 0;
  if (state.outputTimer) { clearInterval(state.outputTimer); state.outputTimer = null; }
  $("terminalOutput").textContent = "";
}

function appendOutput(text, cls) {
  const term = $("terminalOutput");
  // Drop the empty placeholder once we have real content.
  const placeholder = term.querySelector(".terminal-empty");
  if (placeholder) placeholder.remove();
  const span = document.createElement("span");
  if (cls) span.className = `term-${cls}`;
  span.textContent = text;
  term.appendChild(span);
  term.scrollTop = term.scrollHeight;
}

// Stream new bytes from the latest poll in a token-by-token feel.
function streamOutput(full) {
  state.outputBuffer = full;
  if (!state.outputTimer) {
    state.outputTimer = setInterval(() => {
      const remaining = state.outputBuffer.length - state.outputRendered;
      if (remaining <= 0) return;
      // Render in 80-char chunks for a smooth-but-fast feel.
      const chunkSize = Math.max(40, Math.min(remaining, Math.ceil(remaining / 6)));
      const slice = state.outputBuffer.slice(state.outputRendered, state.outputRendered + chunkSize);
      state.outputRendered += slice.length;
      appendOutput(slice, "");
    }, 60);
  }
}

function copyOutput() {
  const text = $("terminalOutput").innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = $("copyOutputButton");
    const prev = btn.querySelector("span").textContent;
    btn.querySelector("span").textContent = "copied";
    btn.classList.add("is-flash");
    setTimeout(() => { btn.querySelector("span").textContent = prev; btn.classList.remove("is-flash"); }, 1100);
  });
}

function formatPlan(result) {
  const lines = [];
  if (result.command) lines.push(`$ ${result.command.join(" ")}`);
  if (result.configPath) lines.push(`config: ${result.configPath}`);
  if (typeof result.returncode === "number") lines.push(`exit: ${result.returncode}`);
  if (result.output) lines.push("", result.output);
  return lines.join("\n");
}

// --- Deer animation -----------------------------------------------------

function startDeerAnimation() {
  const target = $("asciiDeer");
  if (!target) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  fetch("/api/logo").then((r) => r.json()).then((data) => {
    DEER_FRAMES = (data && data.frames) || [];
    if (DEER_FRAMES.length === 0) return;
    target.textContent = DEER_FRAMES[0];
    if (reduced) return;
    let i = 0;
    setInterval(() => { i = (i + 1) % DEER_FRAMES.length; target.textContent = DEER_FRAMES[i]; }, 600);
  }).catch(() => {});
}

// --- Helpers ------------------------------------------------------------

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function formatSize(bytes) {
  if (!bytes) return "0 b";
  const k = 1024;
  const units = ["b", "k", "m", "g"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

(function () {
  const AgentChat = (window.AgentChat = window.AgentChat || {});

  
  let cfg = null;
  let ws = null;
  let wsBackoff = 500;
  let connected = false;
  let streamingMsg = null; 
  let toolCardById = {};
  let confirmCardById = {};
  let attachments = []; 
  let mentionState = null; 
  let snapshotTimer = null;
  let lastSentSnapshot = null;
  let history = [];
  let currentConv = null;
  let agents = [];
  let currentAgent = null;
  let stickToBottom = true;
  let sessionTokens = 0;
  let modelEl, streamEl, inputEl, attachBtnEl, fileInputEl;
  let composerEl, sendBtnEl, cancelBtnEl, newBtnEl, historyBtnEl, historyEl, historyListEl;
  let attachmentsEl, mentionPopEl, agentRootEl, agentDisabledEl, agentListEl, agentCreateBtnEl;

  
  AgentChat.init = function (options) {
    cfg = Object.assign({
      wsUrl: "",
      model: "agent",
      apiKeyPresent: true,
      getGraphSnapshot: () => ({ nodes: {}, edges: [], selection: [] }),
      applyGraphPatch: () => {},
      openBrainTab: () => {},
      applyBrainPatch: () => {},
      getBrainSnapshot: () => null,
    }, options || {});

    agentRootEl = document.getElementById("agentRoot");
    agentDisabledEl = document.getElementById("agentDisabledBody");
    if (!agentRootEl) return;
    agentRootEl.hidden = false;
    if (agentDisabledEl) agentDisabledEl.hidden = true;

    modelEl = document.getElementById("agentModel");
    streamEl = document.getElementById("agentStream");
    composerEl = document.getElementById("agentComposer");
    inputEl = document.getElementById("agentInput");
    sendBtnEl = document.getElementById("agentSendBtn");
    cancelBtnEl = document.getElementById("agentCancelBtn");
    attachBtnEl = document.getElementById("agentAttachBtn");
    fileInputEl = document.getElementById("agentFileInput");
    newBtnEl = document.getElementById("agentNewBtn");
    historyBtnEl = document.getElementById("agentHistoryBtn");
    const brainBtnEl = document.getElementById("agentBrainBtn");
    historyEl = document.getElementById("agentHistory");
    historyListEl = document.getElementById("agentHistoryList");
    agentListEl = document.getElementById("agentList");
    agentCreateBtnEl = document.getElementById("agentCreateBtn");
    attachmentsEl = document.getElementById("agentAttachments");
    mentionPopEl = createMentionPop();

    if (modelEl) modelEl.textContent = cfg.model || "agent";

    composerEl.addEventListener("submit", onSend);
    inputEl.addEventListener("keydown", onInputKey);
    inputEl.addEventListener("input", onInputChange);
    sendBtnEl.addEventListener("click", (e) => { e.preventDefault(); onSend(e); });
    cancelBtnEl.addEventListener("click", () => sendWS({ type: "cancel" }));
    newBtnEl.addEventListener("click", () => sendWS({ type: "new_conversation" }));
    historyBtnEl.addEventListener("click", toggleHistory);
    if (agentCreateBtnEl) agentCreateBtnEl.addEventListener("click", onCreateAgent);
    if (brainBtnEl) {
      brainBtnEl.addEventListener("click", () => {
        if (typeof cfg.openBrainTab === "function") cfg.openBrainTab(currentAgent && currentAgent.id);
      });
    }
    attachBtnEl.addEventListener("click", () => fileInputEl.click());
    fileInputEl.addEventListener("change", onFilesPicked);
    streamEl.addEventListener("dragover", (e) => { e.preventDefault(); streamEl.classList.add("is-dropping"); });
    streamEl.addEventListener("dragleave", () => streamEl.classList.remove("is-dropping"));
    streamEl.addEventListener("drop", onDrop);
    streamEl.addEventListener("scroll", () => {
      stickToBottom = isNearBottom();
    }, { passive: true });

    window.addEventListener("agent:patch-applied", scheduleSnapshotPush);
    window.addEventListener("graph:changed", scheduleSnapshotPush);

    setStatus("connecting");
    connect();
  };

  
  function connect() {
    try {
      ws = new WebSocket(cfg.wsUrl);
    } catch (err) {
      setStatus("error");
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      connected = true;
      wsBackoff = 500;
      setStatus("ready");
      pushSnapshot(true);
      sendWS({ type: "list_conversations" });
      sendWS({ type: "list_agents" });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleEvent(msg);
    };
    ws.onclose = () => {
      connected = false;
      setStatus("error");
      scheduleReconnect();
    };
    ws.onerror = () => setStatus("error");
  }

  function scheduleReconnect() {
    const delay = Math.min(wsBackoff, 8000);
    wsBackoff = Math.min(wsBackoff * 2, 8000);
    setTimeout(() => { if (!connected) connect(); }, delay);
  }

  function sendWS(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(payload)); return true; } catch { return false; }
  }

  
  function handleEvent(ev) {
    switch (ev.type) {
      case "ready":
        if (modelEl && ev.settings && ev.settings.model) modelEl.textContent = ev.settings.model;
        if (Array.isArray(ev.agents)) agents = ev.agents;
        if (ev.agent) currentAgent = ev.agent;
        updateAgentSelector();
        renderAgents();
        emitAgentSelected();
        break;
      case "agent_list":
        agents = ev.items || [];
        if (ev.active_id) {
          const found = agents.find((a) => a.id === ev.active_id);
          if (found) currentAgent = found;
        }
        updateAgentSelector();
        renderAgents();
        break;
      case "agent_selected":
        currentAgent = ev.agent || currentAgent;
        currentConv = null;
        history = [];
        clearStream();
        updateAgentSelector();
        renderAgents();
        emitAgentSelected();
        if (window.RundeerPalette && typeof window.RundeerPalette.showPane === "function") window.RundeerPalette.showPane("chat");
        sendWS({ type: "list_conversations" });
        break;
      case "conversation_list":
        history = ev.items || [];
        renderHistory();
        break;
      case "conversation_loaded":
        {
          const prevId = currentConv && currentConv.id;
          currentConv = ev.conversation;
          const replay = ev.events_replay || [];
          
          
          
          
          if (replay.length || (prevId && prevId !== (currentConv && currentConv.id))) {
            clearStream();
            for (const re of replay) replayEvent(re);
          }
          sendWS({ type: "list_conversations" });
        }
        break;
      case "graph_diff_note":
        appendDiffNote(ev.diff);
        break;
      case "message_start":
        if (ev.role === "assistant") {
          hideEmptyPlaceholder();
          streamingMsg = createMsg("assistant");
          streamEl.appendChild(streamingMsg.el);
          autoscroll();
          setStatus("streaming");
        }
        break;
      case "token":
        if (streamingMsg) {
          streamingMsg.raw = (streamingMsg.raw || "") + (ev.delta || "");
          renderMarkdownInto(streamingMsg.body, streamingMsg.raw);
          autoscroll();
        }
        break;
      case "reasoning":
        if (!streamingMsg) {
          hideEmptyPlaceholder();
          streamingMsg = createMsg("assistant");
          streamEl.appendChild(streamingMsg.el);
          setStatus("streaming");
        }
        appendReasoningDelta(streamingMsg, ev.delta || "");
        break;
      case "message_end":
        streamingMsg = null;
        break;
      case "tool_call":
        renderToolCall(ev);
        break;
      case "tool_result":
        finalizeToolCall(ev);
        break;
      case "graph_patch":
        appendPatchSummary(ev);
        try { cfg.applyGraphPatch(ev.ops || []); } catch (err) { console.warn(err); }
        pushSnapshot(true);
        break;
      case "brain_graph_patch":
        appendPatchSummary(ev, { brain: true });
        try {
          if (typeof cfg.applyBrainPatch === "function") cfg.applyBrainPatch(ev.ops || []);
        } catch (err) { console.warn(err); }
        pushBrainSnapshot(true);
        break;
      case "brain_compiled":
        appendBrainCompiled(ev.summary || {});
        break;
      case "brain_error":
        appendError("brain: " + (ev.message || "save failed"));
        break;
      case "confirm_request":
        renderConfirm(ev);
        break;
      case "usage":
        sessionTokens = ev.session_total || (sessionTokens + (ev.total_tokens || 0));
        updateTokenDisplay(sessionTokens);
        break;
      case "done":
        setStatus("ready");
        cancelBtnEl.hidden = true;
        sendBtnEl.hidden = false;
        sendWS({ type: "list_conversations" });
        break;
      case "error":
        appendError(ev.message || "unknown error");
        setStatus("error");
        cancelBtnEl.hidden = true;
        sendBtnEl.hidden = false;
        break;
      case "cancelled":
        appendError("turn cancelled");
        setStatus("ready");
        cancelBtnEl.hidden = true;
        sendBtnEl.hidden = false;
        break;
      case "replay_user":
        renderUserMsg(ev.text || "", ev.images || []);
        break;
      case "replay_assistant":
        if (ev.text || ev.reasoning) renderAssistantMsg(ev.text || "", ev.reasoning || "");
        for (const tc of (ev.tool_calls || [])) {
          const fn = tc.function || {};
          renderToolCall({ id: tc.id, name: fn.name, arguments: safeParse(fn.arguments), category: "?" });
        }
        break;
      case "replay_tool_result":
        finalizeToolCall({ id: ev.id, name: ev.name, status: ev.result && ev.result.error ? "error" : "ok", result: ev.result || {} });
        break;
    }
  }

  
  function setStatus(state) {
    void state;
  }
  function clearStream() {
    streamEl.innerHTML = "";
    toolCardById = {};
    confirmCardById = {};
    stickToBottom = true;
    sessionTokens = 0;
    updateTokenDisplay(0);
    showEmptyPlaceholder();
  }
  function updateTokenDisplay(tokens) {
    const el = document.getElementById("agentTokenCount");
    if (!el) return;
    if (!tokens) { el.textContent = ""; return; }
    el.textContent = tokens >= 1000 ? (tokens / 1000).toFixed(1) + "k tokens" : tokens + " tokens";
  }
  function showEmptyPlaceholder() {
    if (!streamEl || streamEl.querySelector(".ne-agent-empty")) return;
    const empty = document.createElement("div");
    empty.className = "ne-agent-empty";
    empty.innerHTML = "Ask the agent to build, connect, debug, or run a graph.<br><span class=\"ne-agent-empty-hint\">Type @ to mention files. Drag images here to attach.</span>";
    streamEl.appendChild(empty);
  }
  function hideEmptyPlaceholder() {
    const empty = streamEl.querySelector(".ne-agent-empty");
    if (empty) empty.remove();
  }
  function isNearBottom() {
    return !streamEl || (streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight) < 32;
  }
  function autoscroll(force = false) {
    if (!streamEl || (!force && !stickToBottom)) return;
    streamEl.scrollTop = streamEl.scrollHeight;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => { streamEl.scrollTop = streamEl.scrollHeight; });
    }
  }

  function createMsg(role) {
    const el = document.createElement("div");
    el.className = "ne-agent-msg";
    el.dataset.role = role;
    const head = document.createElement("div");
    head.className = "ne-agent-msg-role";
    head.textContent = role;
    const body = document.createElement("div");
    body.className = "ne-agent-msg-body";
    el.appendChild(head);
    el.appendChild(body);
    return { el, body, raw: "", reasoningRaw: "", reasoningEl: null, reasoningBody: null };
  }

  function appendReasoningDelta(msg, delta) {
    if (!msg || !delta) return;
    if (!msg.reasoningEl) {
      const wrap = document.createElement("details");
      wrap.className = "ne-agent-thinking";
      wrap.open = true;
      const summary = document.createElement("summary");
      summary.textContent = "thinking";
      const pre = document.createElement("pre");
      pre.className = "ne-agent-thinking-body";
      wrap.appendChild(summary);
      wrap.appendChild(pre);
      msg.el.insertBefore(wrap, msg.body);
      msg.reasoningEl = wrap;
      msg.reasoningBody = pre;
    }
    msg.reasoningRaw = (msg.reasoningRaw || "") + String(delta || "");
    msg.reasoningBody.textContent = msg.reasoningRaw;
    autoscroll();
  }

  function renderUserMsg(text, images) {
    hideEmptyPlaceholder();
    stickToBottom = true;
    const m = createMsg("user");
    m.body.textContent = text;
    if (images && images.length) {
      const wrap = document.createElement("div");
      wrap.className = "ne-agent-msg-images";
      for (const url of images) {
        const img = document.createElement("img");
        img.src = url;
        wrap.appendChild(img);
      }
      m.el.appendChild(wrap);
    }
    streamEl.appendChild(m.el);
    autoscroll(true);
  }

  function renderAssistantMsg(text, reasoning) {
    const m = createMsg("assistant");
    appendReasoningDelta(m, reasoning || "");
    renderMarkdownInto(m.body, text);
    streamEl.appendChild(m.el);
    autoscroll();
  }

  function renderMarkdownInto(el, text) {
    el.innerHTML = renderMarkdown(text || "");
  }

  function renderMarkdown(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { i += 1; continue; }

      const fence = trimmed.match(/^```\s*([\w.+-]*)\s*$/);
      if (fence) {
        const lang = fence[1] || "";
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const langAttr = lang ? ` data-lang="${escAttr(lang)}"` : "";
        out.push(`<pre class="ne-agent-md-code"><code${langAttr}>${escHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
        out.push("<hr>");
        i += 1;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          quote.push(lines[i].trim().replace(/^>\s?/, ""));
          i += 1;
        }
        out.push(`<blockquote>${renderInlineMarkdown(quote.join("\n")).replace(/\n/g, "<br>")}</blockquote>`);
        continue;
      }

      const list = trimmed.match(/^([-*+]|\d+[.)])\s+(.+)$/);
      if (list) {
        const ordered = /^\d/.test(list[1]);
        const tag = ordered ? "ol" : "ul";
        const items = [];
        while (i < lines.length) {
          const item = lines[i].trim().match(/^([-*+]|\d+[.)])\s+(.+)$/);
          if (!item || /^\d/.test(item[1]) !== ordered) break;
          items.push(`<li>${renderInlineMarkdown(item[2])}</li>`);
          i += 1;
        }
        out.push(`<${tag}>${items.join("")}</${tag}>`);
        continue;
      }

      const paragraph = [];
      while (i < lines.length) {
        const next = lines[i];
        const nextTrimmed = next.trim();
        if (!nextTrimmed) break;
        if (/^```/.test(nextTrimmed) || /^(#{1,4})\s+/.test(nextTrimmed) || /^>\s?/.test(nextTrimmed) || /^([-*+]|\d+[.)])\s+/.test(nextTrimmed) || /^(-{3,}|_{3,}|\*{3,})$/.test(nextTrimmed)) break;
        paragraph.push(next);
        i += 1;
      }
      out.push(`<p>${renderInlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
    }

    return out.join("") || "";
  }

  function renderInlineMarkdown(text) {
    const parts = [];
    const source = String(text || "");
    let last = 0;
    source.replace(/`([^`\n]+)`/g, (match, code, offset) => {
      if (offset > last) parts.push(renderInlinePlain(source.slice(last, offset)));
      parts.push(`<code>${escHtml(code)}</code>`);
      last = offset + match.length;
      return match;
    });
    if (last < source.length) parts.push(renderInlinePlain(source.slice(last)));
    return parts.join("");
  }

  function renderInlinePlain(text) {
    const source = String(text || "");
    const out = [];
    let last = 0;
    source.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, href, offset) => {
      if (offset > last) out.push(renderEmphasis(source.slice(last, offset)));
      if (isSafeHref(href)) {
        out.push(`<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer">${renderEmphasis(label)}</a>`);
      } else {
        out.push(escHtml(match));
      }
      last = offset + match.length;
      return match;
    });
    if (last < source.length) out.push(renderEmphasis(source.slice(last)));
    return out.join("");
  }

  function renderEmphasis(text) {
    return escHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/_([^_]+)_/g, "<em>$1</em>");
  }

  function isSafeHref(href) {
    const raw = String(href || "").trim();
    if (!raw || raw.startsWith("//")) return false;
    if (/^(https?:|mailto:)/i.test(raw)) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(raw);
  }

  function appendError(msg) {
    const m = createMsg("error");
    m.body.textContent = msg;
    streamEl.appendChild(m.el);
    autoscroll();
  }

  function appendDiffNote(diff) {
    const el = document.createElement("div");
    el.className = "ne-agent-diff-note";
    const lines = ["user edited graph:"];
    if (diff.added_nodes && diff.added_nodes.length) lines.push("  +" + diff.added_nodes.map((n) => `${n.id}(${n.type})`).join(", "));
    if (diff.removed_nodes && diff.removed_nodes.length) lines.push("  −" + diff.removed_nodes.map((n) => `${n.id}(${n.type})`).join(", "));
    if (diff.modified_nodes && diff.modified_nodes.length) lines.push("  ~" + diff.modified_nodes.map((n) => `${n.id}[${(n.changes||[]).join("+")}]`).join(", "));
    if (diff.added_edges && diff.added_edges.length) lines.push("  +" + diff.added_edges.length + " edge(s)");
    if (diff.removed_edges && diff.removed_edges.length) lines.push("  −" + diff.removed_edges.length + " edge(s)");
    el.textContent = lines.join("\n");
    streamEl.appendChild(el);
    autoscroll();
  }

  function appendPatchSummary(ev, opts) {
    const isBrain = !!(opts && opts.brain);
    const el = document.createElement("div");
    el.className = "ne-agent-patch" + (isBrain ? " is-brain" : "");
    const prefix = isBrain ? "🧠 brain · " : "↳ ";
    el.textContent = `${prefix}${ev.summary || (isBrain ? "brain updated" : "graph updated")} (${(ev.ops || []).length} op${(ev.ops || []).length === 1 ? "" : "s"})`;
    streamEl.appendChild(el);
    autoscroll();
  }

  function appendBrainCompiled(summary) {
    const el = document.createElement("div");
    el.className = "ne-agent-brain-compiled";
    const bits = [];
    if (summary.prompt_chars != null) bits.push(`prompt ${summary.prompt_chars} chars`);
    if (summary.tools_enabled != null) bits.push(`${summary.tools_enabled} tools`);
    el.textContent = "✓ brain recompiled — " + (bits.join(" · ") || "no changes");
    streamEl.appendChild(el);
    autoscroll();
  }

  function renderToolCall(ev) {
    const card = document.createElement("div");
    card.className = "ne-agent-tool";
    const head = document.createElement("div");
    head.className = "ne-agent-tool-head";
    head.innerHTML = `<span class="ne-agent-tool-glyph">▸</span><span class="ne-agent-tool-name"></span><span class="ne-agent-tool-summary"></span><span class="ne-agent-tool-status" data-status="running">running</span>`;
    const nameEl = head.querySelector(".ne-agent-tool-name");
    const summaryEl = head.querySelector(".ne-agent-tool-summary");
    const statusEl = head.querySelector(".ne-agent-tool-status");
    nameEl.textContent = ev.name || "?";
    summaryEl.textContent = summarizeArgs(ev.arguments);
    const body = document.createElement("div");
    body.className = "ne-agent-tool-body";
    body.hidden = true;
    body.appendChild(toolSection("arguments", JSON.stringify(ev.arguments || {}, null, 2)));
    head.addEventListener("click", () => { body.hidden = !body.hidden; });
    card.appendChild(head);
    card.appendChild(body);
    streamEl.appendChild(card);
    toolCardById[ev.id] = { card, body, statusEl };
    autoscroll();
  }

  function toolSection(label, text) {
    const wrap = document.createElement("div");
    wrap.className = "ne-agent-tool-section";
    const lbl = document.createElement("div");
    lbl.className = "ne-agent-tool-section-label";
    lbl.textContent = label;
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = text;
    wrap.appendChild(lbl);
    wrap.appendChild(pre);
    return wrap;
  }

  function finalizeToolCall(ev) {
    const slot = toolCardById[ev.id];
    if (!slot) return;
    slot.statusEl.textContent = ev.status || "ok";
    slot.statusEl.dataset.status = ev.status || "ok";
    slot.body.appendChild(toolSection("result", JSON.stringify(ev.result || {}, null, 2)));
    autoscroll();
  }

  function renderConfirm(ev) {
    const isSelfModify = (ev.category || "") === "self_modify";
    const card = document.createElement("div");
    card.className = "ne-agent-confirm" + (isSelfModify ? " is-self-modify" : "");
    const title = document.createElement("div");
    title.className = "ne-agent-confirm-title";
    title.textContent = isSelfModify
      ? "⚠ confirm — agent wants to modify itself"
      : "confirm — destructive action";
    const summary = document.createElement("div");
    summary.className = "ne-agent-confirm-summary";
    summary.textContent = `${ev.tool || "tool"}: ${ev.summary || ""}`;
    const actions = document.createElement("div");
    actions.className = "ne-agent-confirm-actions";
    let warn = null;
    if (isSelfModify) {
      warn = document.createElement("div");
      warn.className = "ne-agent-confirm-warning";
      warn.textContent =
        "The agent is asking to change its own brain (system prompt, tool list, " +
        "or settings). Approve only if you intended this. The change applies to " +
        "the next turn.";
    }
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn btn-tiny " + (isSelfModify ? "btn-danger" : "btn-primary");
    approve.textContent = isSelfModify ? "approve self-modify" : "approve";
    const deny = document.createElement("button");
    deny.type = "button";
    deny.className = "btn btn-ghost btn-tiny";
    deny.textContent = "deny";
    approve.addEventListener("click", () => {
      sendWS({ type: "confirm_response", approved: true, call_id: ev.id });
      card.remove();
    });
    deny.addEventListener("click", () => {
      sendWS({ type: "confirm_response", approved: false, call_id: ev.id });
      card.remove();
    });
    actions.appendChild(approve);
    actions.appendChild(deny);
    card.appendChild(title);
    if (warn) card.appendChild(warn);
    card.appendChild(summary);
    card.appendChild(actions);
    streamEl.appendChild(card);
    confirmCardById[ev.id] = card;
    autoscroll();
  }

  function summarizeArgs(args) {
    if (!args || typeof args !== "object") return "";
    const parts = [];
    for (const [k, v] of Object.entries(args)) {
      if (parts.length >= 3) { parts.push("…"); break; }
      const sv = typeof v === "string" ? v : JSON.stringify(v);
      parts.push(`${k}=${truncate(sv, 24)}`);
    }
    return parts.join(" ");
  }

  function truncate(str, n) {
    str = String(str ?? "");
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
  }

  function safeParse(s) {
    try { return JSON.parse(s || "{}"); } catch { return {}; }
  }

  
  function onSend(e) {
    if (e) e.preventDefault();
    const text = (inputEl.value || "").trim();
    if (!text && !attachments.length) return;
    if (!connected) return;
    renderUserMsg(text, attachments.map((a) => a.url));
    const graph = cfg.getGraphSnapshot();
    sendWS({
      type: "user_message",
      text,
      images: attachments.map((a) => a.url),
      graph,
    });
    lastSentSnapshot = JSON.stringify(graph);
    inputEl.value = "";
    autosizeInput();
    if (window.RundeerPalette && typeof window.RundeerPalette.updateInputLines === "function") window.RundeerPalette.updateInputLines();
    attachments = [];
    renderAttachments();
    cancelBtnEl.hidden = false;
    sendBtnEl.hidden = true;
    setStatus("streaming");
  }

  function onInputKey(e) {
    if (mentionState) {
      if (e.key === "ArrowDown") { mentionState.index = (mentionState.index + 1) % Math.max(1, mentionState.items.length); renderMentionPop(); e.preventDefault(); return; }
      if (e.key === "ArrowUp") { mentionState.index = (mentionState.index - 1 + mentionState.items.length) % Math.max(1, mentionState.items.length); renderMentionPop(); e.preventDefault(); return; }
      if (e.key === "Escape") { closeMentionPop(); e.preventDefault(); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        if (mentionState.items.length) { applyMention(mentionState.items[mentionState.index]); e.preventDefault(); return; }
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend(e);
    }
  }

  function onInputChange() {
    autosizeInput();
    if (window.RundeerPalette && typeof window.RundeerPalette.updateInputLines === "function") window.RundeerPalette.updateInputLines();
    const cursor = inputEl.selectionStart || inputEl.value.length;
    const before = inputEl.value.slice(0, cursor);
    const m = before.match(/(^|\s)@([\w./-]*)$/);
    if (m) openMentionPop(m[2] || "");
    else closeMentionPop();
  }

  function autosizeInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(160, inputEl.scrollHeight) + "px";
  }

  
  function onFilesPicked(e) {
    const files = [...(e.target.files || [])];
    for (const f of files) ingestFile(f);
    fileInputEl.value = "";
  }
  function onDrop(e) {
    e.preventDefault();
    streamEl.classList.remove("is-dropping");
    const files = [...(e.dataTransfer.files || [])];
    for (const f of files) ingestFile(f);
  }
  function ingestFile(file) {
    if (!file.type || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      attachments.push({ url: String(reader.result || ""), name: file.name });
      renderAttachments();
    };
    reader.readAsDataURL(file);
  }
  function renderAttachments() {
    if (!attachmentsEl) return;
    attachmentsEl.innerHTML = "";
    if (!attachments.length) { attachmentsEl.hidden = true; return; }
    attachmentsEl.hidden = false;
    attachments.forEach((a, i) => {
      const wrap = document.createElement("div");
      wrap.className = "ne-agent-attachment";
      const img = document.createElement("img");
      img.src = a.url;
      img.alt = a.name || "image";
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "ne-agent-attachment-remove";
      rm.textContent = "×";
      rm.addEventListener("click", () => { attachments.splice(i, 1); renderAttachments(); });
      wrap.appendChild(img);
      wrap.appendChild(rm);
      attachmentsEl.appendChild(wrap);
    });
  }

  
  function createMentionPop() {
    const el = document.createElement("div");
    el.className = "ne-agent-mention-pop";
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }
  async function openMentionPop(query) {
    try {
      const data = await fetch(`/api/mentions?q=${encodeURIComponent(query)}`).then((r) => r.json());
      mentionState = { query, items: (data.items || []).slice(0, 12), index: 0 };
      renderMentionPop();
    } catch {
      mentionState = null;
      mentionPopEl.hidden = true;
    }
  }
  function renderMentionPop() {
    if (!mentionState) { mentionPopEl.hidden = true; return; }
    mentionPopEl.innerHTML = "";
    mentionState.items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "ne-agent-mention-item" + (i === mentionState.index ? " is-active" : "");
      row.innerHTML = `<span>${escHtml(it.label || it.path || it.value || "?")}</span><span class="ne-agent-mention-item-meta">${escHtml(it.kind || "")}</span>`;
      row.addEventListener("mousedown", (e) => { e.preventDefault(); applyMention(it); });
      mentionPopEl.appendChild(row);
    });
    const rect = inputEl.getBoundingClientRect();
    mentionPopEl.style.left = rect.left + "px";
    mentionPopEl.style.top = (rect.top - mentionPopEl.offsetHeight - 4) + "px";
    mentionPopEl.hidden = mentionState.items.length === 0;
  }
  function applyMention(item) {
    const cursor = inputEl.selectionStart || inputEl.value.length;
    const before = inputEl.value.slice(0, cursor);
    const after = inputEl.value.slice(cursor);
    const replaced = before.replace(/@([\w./-]*)$/, "@" + (item.value || item.path || item.label || "") + " ");
    inputEl.value = replaced + after;
    inputEl.focus();
    inputEl.selectionStart = inputEl.selectionEnd = replaced.length;
    closeMentionPop();
  }
  function closeMentionPop() {
    mentionState = null;
    mentionPopEl.hidden = true;
  }
  function escHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escAttr(s) {
    return escHtml(s).replace(/'/g, "&#39;");
  }

  
  function scheduleSnapshotPush() {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => pushSnapshot(false), 250);
  }
  function pushSnapshot(force) {
    if (!connected) return;
    const snap = cfg.getGraphSnapshot();
    const key = JSON.stringify(snap);
    if (!force && key === lastSentSnapshot) return;
    lastSentSnapshot = key;
    sendWS({ type: "graph_snapshot", graph: snap });
  }

  let lastSentBrainSnapshot = null;
  function pushBrainSnapshot(force) {
    if (!connected) return;
    let snap = null;
    if (typeof cfg.getBrainSnapshot === "function") snap = cfg.getBrainSnapshot();
    if (!snap) return;
    const key = JSON.stringify(snap);
    if (!force && key === lastSentBrainSnapshot) return;
    lastSentBrainSnapshot = key;
    sendWS({ type: "brain_graph_snapshot", graph: snap, persist: true });
  }

  
  
  
  
  AgentChat.sendBrainSnapshot = function (snap, opts) {
    if (!snap || !connected) return;
    lastSentBrainSnapshot = JSON.stringify(snap);
    const persist = !(opts && opts.persist === false);
    sendWS({ type: "brain_graph_snapshot", graph: snap, persist });
  };

  
  function toggleHistory() {
    const palette = window.RundeerPalette;
    const wasOpen = palette && typeof palette.isPaneOpen === "function" ? palette.isPaneOpen("history") : !historyEl.hidden;
    if (palette && typeof palette.togglePane === "function") palette.togglePane("history");
    else historyEl.hidden = wasOpen;
    const open = palette && typeof palette.isPaneOpen === "function" ? palette.isPaneOpen("history") : !historyEl.hidden;
    historyBtnEl.setAttribute("aria-expanded", String(open));
    if (open) sendWS({ type: "list_conversations" });
  }
  function renderHistory() {
    if (!historyListEl) return;
    historyListEl.innerHTML = "";
    history.forEach((c) => {
      const li = document.createElement("li");
      li.className = "ne-agent-history-item" + (currentConv && c.id === currentConv.id ? " is-active" : "");
      const title = document.createElement("span");
      title.className = "ne-agent-history-title";
      title.textContent = c.title || c.id;
      title.addEventListener("click", () => {
        sendWS({ type: "load_conversation", id: c.id });
        if (window.RundeerPalette && typeof window.RundeerPalette.showPane === "function") window.RundeerPalette.showPane("chat");
      });
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "ne-agent-history-delete";
      rm.textContent = "×";
      rm.addEventListener("click", (e) => { e.stopPropagation(); sendWS({ type: "delete_conversation", id: c.id }); });
      li.appendChild(title);
      li.appendChild(rm);
      historyListEl.appendChild(li);
    });
  }

  function updateAgentSelector() {
    if (!currentAgent && agents.length) currentAgent = agents[0];
    if (modelEl) modelEl.textContent = (currentAgent && currentAgent.name) || cfg.model || "agent";
  }

  function emitAgentSelected() {
    try {
      window.dispatchEvent(new CustomEvent("agent:selected", { detail: { agent: currentAgent || null } }));
    } catch (_) {}
  }

  async function askAgentName(defaultName, title) {
    if (typeof window.openAppDialog === "function") {
      const result = await window.openAppDialog({
        title: title || "Agent name",
        message: "Saved under .rundeer/data/agent.",
        inputLabel: "Agent name",
        defaultValue: defaultName || "New agent",
        confirmText: "Save",
        cancelText: "Cancel",
      });
      return result.action === "confirm" ? String(result.value || "").trim() : "";
    }
    return String(window.prompt(title || "Agent name", defaultName || "New agent") || "").trim();
  }

  async function onCreateAgent(e) {
    if (e) e.preventDefault();
    const name = await askAgentName("New agent", "New agent");
    if (!name) return;
    sendWS({ type: "create_agent", name });
  }

  function renderAgents() {
    if (!agentListEl) return;
    agentListEl.innerHTML = "";
    if (!agents.length) {
      const empty = document.createElement("div");
      empty.className = "ne-agent-empty";
      empty.textContent = "no agents yet";
      agentListEl.appendChild(empty);
      return;
    }
    for (const agent of agents) {
      const row = document.createElement("div");
      row.className = "ne-agent-row" + (currentAgent && agent.id === currentAgent.id ? " is-active" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(Boolean(currentAgent && agent.id === currentAgent.id)));
      row.dataset.agentId = agent.id;

      const name = document.createElement("span");
      name.className = "ne-agent-row-name";
      name.textContent = agent.name || agent.id;
      row.appendChild(name);

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "ne-agent-row-action";
      rename.textContent = "✎";
      rename.title = "Rename agent";
      rename.setAttribute("aria-label", "Rename agent");
      rename.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const next = await askAgentName(agent.name || agent.id, "Rename agent");
        if (next && next !== agent.name) sendWS({ type: "rename_agent", id: agent.id, name: next });
      });
      row.appendChild(rename);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "ne-agent-row-action";
      del.textContent = "×";
      del.title = agent.id === "default" ? "Default agent cannot be deleted" : "Delete agent";
      del.setAttribute("aria-label", "Delete agent");
      del.disabled = agent.id === "default";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (agent.id === "default") return;
        if (!window.confirm || window.confirm(`Delete agent "${agent.name || agent.id}"?`)) {
          sendWS({ type: "delete_agent", id: agent.id });
        }
      });
      row.appendChild(del);

      row.addEventListener("click", () => {
        if (!currentAgent || agent.id !== currentAgent.id) sendWS({ type: "select_agent", id: agent.id });
        if (window.RundeerPalette && typeof window.RundeerPalette.showPane === "function") window.RundeerPalette.showPane("chat");
      });
      agentListEl.appendChild(row);
    }
  }

  AgentChat.requestAgents = function () {
    sendWS({ type: "list_agents" });
  };
  AgentChat.getSelectedAgentId = function () {
    return (currentAgent && currentAgent.id) || "default";
  };
  AgentChat.getSelectedAgentName = function () {
    return (currentAgent && currentAgent.name) || "Default";
  };

  function replayEvent(ev) {
    handleEvent(ev);
  }
})();

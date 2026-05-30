(window.RundeerNodes = window.RundeerNodes || {})["terminal"] = {
  usesDefaultHeight: true,

  buildBody(nodeId, node, ctx) {
    if (node._ts && node._ts.wrap) {
      const s = node._ts;
      requestAnimationFrame(() => {
        try { s.fitAddon && s.fitAddon.fit(); } catch (_) {}
      });
      return s.wrap;
    }

    const wrap = document.createElement("div");
    wrap.className = "ne-term-wrap";
    const statusBar = document.createElement("div");
    statusBar.className = "ne-term-status";
    statusBar.textContent = "disconnected";
    wrap.appendChild(statusBar);
    const container = document.createElement("div");
    container.className = "ne-term-container";
    wrap.appendChild(container);

    wrap.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const ts = { wrap, statusBar, container, term: null, fitAddon: null, ws: null, ro: null };
    node._ts = ts;
    node._cmdOutput = "";
    node._cmdExitCode = null;
    node._capturing = false;

    const _boot = () => {
      if (typeof Terminal === "undefined" || typeof FitAddon === "undefined") {
        setTimeout(_boot, 200);
        return;
      }

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Geist Mono', 'Consolas', monospace",
        theme: {
          background: "#0d0d0d",
          foreground: "#d4d4d4",
          cursor: "#d4d4d4",
          selectionBackground: "rgba(255,255,255,0.15)",
          black: "#0d0d0d",
          red: "#f44747",
          green: "#6a9955",
          yellow: "#dcdcaa",
          blue: "#569cd6",
          magenta: "#c586c0",
          cyan: "#4ec9b0",
          white: "#d4d4d4",
          brightBlack: "#808080",
          brightRed: "#f44747",
          brightGreen: "#6a9955",
          brightYellow: "#dcdcaa",
          brightBlue: "#569cd6",
          brightMagenta: "#c586c0",
          brightCyan: "#4ec9b0",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
        scrollback: 5000,
      });

      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      ts.term = term;
      ts.fitAddon = fitAddon;

      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch (_) {}
      });

      const _connectWS = () => {
        const ptyPort = window._rundeerPtyPort;
        if (!ptyPort) {
          statusBar.textContent = "no pty server";
          statusBar.dataset.state = "error";
          setTimeout(_connectWS, 2000);
          return;
        }

        const sid = (node.props && node.props.id) || node.inputs?.id || nodeId;
        const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${wsProto}//${location.hostname}:${ptyPort}`;
        const ws = new WebSocket(wsUrl);
        ts.ws = ws;
        statusBar.textContent = "connecting…";
        statusBar.dataset.state = "connecting";

        ws.onopen = () => {
          statusBar.textContent = "connected";
          statusBar.dataset.state = "connected";
          const props = node.props || {};
          const dims = _getDims(fitAddon);
          ws.send(JSON.stringify({
            type: "init",
            session_id: sid,
            shell: props.shell || "bash",
            cwd: props.cwd || "",
            cols: dims.cols,
            rows: dims.rows,
            allowed_patterns: props.allowed_patterns || "",
            yolo: Boolean(props.yolo),
          }));
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "output") {
              term.write(msg.data);
              if (node._capturing) {
                node._cmdOutput += msg.data;
              }
            } else if (msg.type === "spawned") {
              statusBar.textContent = `pid ${msg.pid}${msg.reconnected ? " (reconnected)" : ""}`;
              statusBar.dataset.state = "connected";
            } else if (msg.type === "killed") {
              statusBar.textContent = "session killed";
            } else if (msg.type === "error") {
              term.write(`\r\n\x1b[31m${msg.msg}\x1b[0m\r\n`);
            }
          } catch (_) {}
        };

        ws.onclose = () => {
          statusBar.textContent = "disconnected";
          statusBar.dataset.state = "disconnected";
          setTimeout(() => {
            if (ts.ws === ws) _connectWS();
          }, 3000);
        };

        ws.onerror = () => {
          statusBar.textContent = "error";
          statusBar.dataset.state = "error";
        };
      };

      term.onData((data) => {
        if (ts.ws && ts.ws.readyState === WebSocket.OPEN) {
          ts.ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      container.addEventListener("mouseup", () => {
        const sel = term.getSelection();
        if (sel && navigator.clipboard) {
          navigator.clipboard.writeText(sel).catch(() => {});
        }
      });

      const ro = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          const dims = _getDims(fitAddon);
          if (ts.ws && ts.ws.readyState === WebSocket.OPEN) {
            ts.ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        } catch (_) {}
      });
      ro.observe(container);
      ts.ro = ro;

      _connectWS();
    };

    requestAnimationFrame(_boot);
    return wrap;
  },

  resizeMin(node, def) {
    return { w: 320, h: 200 };
  },

  resolve: async function (node, inputs, outputs, props, helpers) {
    const ws = node._ts && node._ts.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      outputs.stdout = "";
      outputs.exit_code = -1;
      return;
    }

    if (inputs.clear) {
      ws.send(JSON.stringify({ type: "input", data: "clear\n" }));
    }

    if (inputs.refresh) {
      ws.send(JSON.stringify({
        type: "refresh",
        shell: props.shell || "bash",
        cwd: props.cwd || "",
      }));
      await new Promise((r) => setTimeout(r, 500));
    }

    const cmd = (inputs.command || "").trim();
    if (cmd) {
      const term = node._ts && node._ts.term;
      let prompt = "";
      if (term) {
        const buf = term.buffer.active;
        const cy = buf.baseY + buf.cursorY;
        const pL = [];
        for (let y = cy; y >= 0; y--) {
          const ln = buf.getLine(y);
          if (!ln) break;
          const s = ln.translateToString(true);
          if (!s && y < cy) break;
          pL.unshift(y === cy ? ln.translateToString(false).replace(/\s+$/, " ") : s);
        }
        prompt = pL.join("\n");
      }

      node._cmdOutput = "";
      node._capturing = true;

      ws.send(JSON.stringify({ type: "update_filters", allowed_patterns: props.allowed_patterns || "", yolo: Boolean(props.yolo) }));
      ws.send(JSON.stringify({ type: "command", cmd }));

      const deadline = Date.now() + 30000;
      let prevLen = 0;
      let idle = 0;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        const curLen = node._cmdOutput.length;
        if (curLen > 0 && curLen === prevLen) {
          if (++idle >= 2) break;
        } else {
          idle = 0;
          prevLen = curLen;
        }
      }
      node._capturing = false;

      const raw = _stripAnsi(node._cmdOutput).replace(/\r/g, "").trim();
      outputs.stdout = prompt ? prompt + raw : raw;
      outputs.exit_code = 0;
    } else {
      outputs.stdout = _stripAnsi(node._cmdOutput || "").replace(/\r/g, "").trim();
      outputs.exit_code = 0;
    }
  },

  buildFooter(nodeId, node, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "ne-term-footer";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "ne-term-btn";
    clearBtn.textContent = "Clear";
    clearBtn.title = "Clear terminal screen";
    clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ws = node._ts && node._ts.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: "clear\n" }));
      }
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "ne-term-btn";
    refreshBtn.textContent = "Restart";
    refreshBtn.title = "Kill and respawn the PTY session";
    refreshBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ws = node._ts && node._ts.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const props = node.props || {};
        ws.send(JSON.stringify({
          type: "refresh",
          shell: props.shell || "bash",
          cwd: props.cwd || "",
        }));
      }
    });

    wrap.appendChild(clearBtn);
    wrap.appendChild(refreshBtn);
    return wrap;
  },
};

function _stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]/g, "");
}

function _getDims(fitAddon) {
  try {
    const p = fitAddon.proposeDimensions();
    return { cols: p?.cols || 80, rows: p?.rows || 24 };
  } catch (_) {
    return { cols: 80, rows: 24 };
  }
}

(window.RundeerNodes = window.RundeerNodes || {})["text-input"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    outputs.out = String(props.value || "");
  },
  usesDefaultHeight: true,
  resizeMin(node, def) {
    const HEADER = 34;
    const PANEL_HEAD = 32;
    const SOCKET_ROW = 31;
    const TEXTAREA_ROW = 68;
    const FOOTER = 26;
    const MINIMIZED_BODY = 18;
    const BOTTOM_BUFFER = 6;
    if (node.minimized) return { w: 220, h: HEADER + MINIMIZED_BODY + FOOTER };
    const settingsCollapsed = Boolean(node.collapsedPanels?.["props:settings"]);
    let h = HEADER + SOCKET_ROW + TEXTAREA_ROW + PANEL_HEAD + FOOTER + BOTTOM_BUFFER;
    if (!settingsCollapsed) h += TEXTAREA_ROW;
    return { w: 220, h };
  },
};
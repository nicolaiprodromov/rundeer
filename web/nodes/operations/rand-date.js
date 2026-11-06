const _RD_WD = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const _RD_MO = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

(window.RundeerNodes = window.RundeerNodes || {})["rand-date"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const s = String(props.start || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (s && !m) throw new Error(`rand-date: start must be YYYY-MM-DD, got "${s}"`);
  const now = new Date();
  const d0 = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const span = Math.max(0, Math.trunc(Number(props.span ?? 120)) || 0);
  const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + Math.floor(Math.random() * (span + 1)));
  const p2 = (n) => String(n).padStart(2, "0");
  const tk = {
    WEEKDAY: _RD_WD[d.getDay()], WD: _RD_WD[d.getDay()].slice(0, 3),
    MONTH: _RD_MO[d.getMonth()], MON: _RD_MO[d.getMonth()].slice(0, 3),
    D: String(d.getDate()), DD: p2(d.getDate()),
    M: String(d.getMonth() + 1), MM: p2(d.getMonth() + 1),
    YYYY: String(d.getFullYear()), YY: String(d.getFullYear()).slice(2),
  };
  outputs.out = String(props.fmt ?? "{WEEKDAY}, {MONTH} {D}, {YYYY}").replace(/\{([A-Z]+)\}/g, (a, k) => (k in tk ? tk[k] : a));
  helpers.appendRunLog(`  ↳ Random Date → ${outputs.out}\n`);
} };

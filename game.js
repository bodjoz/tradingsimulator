"use strict";
/* Blind Market — trade anonymous historical charts. */

const DAYS_PER_YEAR = 252;
const SPEEDS = [0.5, 1, 2, 3, 5, 10, 20, 40, 80];
const COLORS = ["#4ea1ff", "#f5a524", "#b48cff", "#2ed3b7", "#ff6b9a"];
const LABELS = ["A", "B", "C", "D", "E"];
const MAJOR_INDEXES = ["^GSPC", "^IXIC", "^N225", "^FTSE", "^GDAXI"];   // benchmarks on the reveal screen

/* ---------- fee & tax presets ---------- */
// spread = full bid–ask spread in %; buys fill at mid*(1+s/2), sells at mid*(1-s/2)
const FEE_PRESETS = {
  zero:     { name: "Zero-commission app (2020s)", flat: 0, pct: 0, share: 0, min: 0, max: 0, spread: 0.05,
              desc: "No commission, but you pay a 0.05% bid–ask spread (payment-for-order-flow style)." },
  ibkr:     { name: "Interactive Brokers (fixed)", flat: 0, pct: 0, share: 0.005, min: 1, max: 1, spread: 0.02,
              desc: "$0.005 per share, $1 minimum, capped at 1% of trade value; 0.02% spread." },
  discount: { name: "Online discount broker (2000s)", flat: 9.99, pct: 0, share: 0, min: 0, max: 0, spread: 0.08,
              desc: "$9.99 flat per trade; 0.08% spread." },
  eubank:   { name: "European retail bank", flat: 0, pct: 0.25, share: 0, min: 12.5, max: 0, spread: 0.1,
              desc: "0.25% of trade value, minimum $12.50; 0.1% spread." },
  full:     { name: "Full-service broker (1980s)", flat: 0, pct: 1.5, share: 0, min: 40, max: 0, spread: 0.3,
              desc: "1.5% commission, $40 minimum; 0.3% spread. Over-trading is brutal." },
  none:     { name: "No costs (practice)", flat: 0, pct: 0, share: 0, min: 0, max: 0, spread: 0,
              desc: "Frictionless trading — unrealistic, but good for practice." },
  custom:   { name: "Custom…", desc: "Set your own commission and spread." },
};
const TAX_PRESETS = {
  none:   { name: "No taxes", st: 0, lt: 0, allow: 0, desc: "Gains are not taxed." },
  us:     { name: "US-style (short 32% / long 15%)", st: 32, lt: 15, allow: 0,
            desc: "Gains on lots held < 1 game year taxed at 32%, longer at 15%. Losses offset gains and carry forward." },
  flat26: { name: "Flat 26% (EU-style)", st: 26, lt: 26, allow: 0, desc: "All realized gains taxed at 26%. Losses carry forward." },
  uk:     { name: "UK-style (24%, $3,000 allowance)", st: 24, lt: 24, allow: 3000,
            desc: "First $3,000 of net gains each year tax-free, the rest at 24%." },
  custom: { name: "Custom…", desc: "Set your own rates and annual allowance." },
};

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt$ = (v, d = 2) => (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPx = v => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(d) + "%";
const fmtInt = v => Math.round(v).toLocaleString("en-US");
const cls = v => (v > 1e-9 ? "up" : v < -1e-9 ? "down" : "");
const rand = n => Math.floor(Math.random() * n);
const dayToDate = d => new Date(d * 86400000);
const fmtDate = d => dayToDate(d).toISOString().slice(0, 10);
const fmtMonth = d => dayToDate(d).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/* ---------- data ---------- */
const UNIVERSE = (window.MARKET_DATA || []).map(a => {
  const days = new Int32Array(a.d.length);
  let acc = 0;
  for (let i = 0; i < a.d.length; i++) { acc += a.d[i]; days[i] = acc; }
  return { ticker: a.ticker, name: a.name, kind: a.kind, region: a.region, days, px: a.p };
});

/* ---------- setup screen ---------- */
function fillSelect(sel, presets, def) {
  for (const [k, p] of Object.entries(presets)) sel.append(new Option(p.name, k, false, k === def));
}
const feeSel = $("#fee-preset"), taxSel = $("#tax-preset");
fillSelect(feeSel, FEE_PRESETS, "ibkr");
fillSelect(taxSel, TAX_PRESETS, "none");
function syncSetupHints() {
  $("#fee-desc").textContent = FEE_PRESETS[feeSel.value].desc;
  $("#tax-desc").textContent = TAX_PRESETS[taxSel.value].desc;
  $("#fee-custom").hidden = feeSel.value !== "custom";
  $("#tax-custom").hidden = taxSel.value !== "custom";
}
feeSel.onchange = taxSel.onchange = syncSetupHints;
syncSetupHints();

$("#setup-form").onsubmit = e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const num = k => parseFloat(f.get(k)) || 0;
  const fee = feeSel.value === "custom"
    ? { name: "Custom", flat: num("f_flat"), pct: num("f_pct"), share: num("f_share"), min: num("f_min"), max: 0, spread: num("f_spread") }
    : FEE_PRESETS[feeSel.value];
  const tax = taxSel.value === "custom"
    ? { name: "Custom", st: num("t_st"), lt: num("t_lt"), allow: num("t_allow") }
    : TAX_PRESETS[taxSel.value];
  startGame({
    capital: num("capital"),
    count: parseInt(f.get("count")),
    sessionDays: Math.round(num("years") * DAYS_PER_YEAR),
    prior: parseInt(f.get("prior")),
    pool: f.get("pool"),
    sync: f.get("sync"),
    fee, tax,
    taxOn: tax.st > 0 || tax.lt > 0,
    autopause: f.get("autopause") === "on",
  });
};

/* ---------- picking random charts ---------- */
function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

function pickAssets(cfg) {
  const need = cfg.prior + cfg.sessionDays;
  const pool = UNIVERSE.filter(a => (cfg.pool === "all" || a.kind === cfg.pool) && a.px.length >= need + 1);
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = rand(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

  if (cfg.sync === "same") {
    // Choose a calendar date, then keep the assets that have enough data around it.
    for (let attempt = 0; attempt < 200; attempt++) {
      const anchor = pool[rand(pool.length)];
      const start = cfg.prior + rand(anchor.px.length - need);
      const day0 = anchor.days[start];
      const ok = shuffle(pool.map(a => {
        const i = lowerBound(a.days, day0);
        return (i >= cfg.prior && i + cfg.sessionDays <= a.px.length && a.days[i] - day0 < 7) ? { a, start: i } : null;
      }).filter(Boolean));
      if (ok.length >= cfg.count || attempt === 199) return ok.slice(0, cfg.count);
    }
  }
  return shuffle(pool.slice()).slice(0, cfg.count).map(a => ({ a, start: cfg.prior + rand(a.px.length - need + 1) }));
}

/* ---------- game state ---------- */
let G = null;          // current game
let raf = 0;

function startGame(cfg) {
  const picks = pickAssets(cfg);
  if (!picks.length) { alert("No assets have enough history for these settings."); return; }
  cfg.count = picks.length;

  const assets = picks.map(({ a, start }, k) => {
    const from = start - cfg.prior, to = start + cfg.sessionDays;   // [from, to)
    const raw = a.px.slice(from, to);
    // Rescale so the session opens at a random "nice" price — hides the real level.
    const target = Math.round(15 + Math.random() * Math.random() * 400);
    const scale = target / raw[cfg.prior];
    return {
      k, label: LABELS[k], color: COLORS[k], meta: a,
      days: Array.from(a.days.slice(from, to)),
      px: raw.map(v => v * scale),
      raw, scale,
      shares: 0, lots: [], realized: 0, fees: 0, nTrades: 0, markers: [],
    };
  });

  G = {
    cfg, assets,
    t: 0, playing: false, speedIdx: 4, acc: 0, lastTs: 0,
    view: "full", log: false,
    cash: cfg.capital, feesTotal: 0, taxesPaid: 0,
    yearST: 0, yearLT: 0, carryLoss: 0, taxYear: 1,
    trades: [], equity: [], bench: [],
    benchUnits: assets.map(a => cfg.capital / assets.length / a.px[cfg.prior]),
    hover: null, ended: false,
  };
  recordEquity();

  $("#setup").hidden = true; $("#reveal").hidden = true; $("#game").hidden = false;
  buildCharts();
  updateAll();
  setPlaying(false);
  $("#btn-play").classList.add("paused-flash");
}

const priceAt = (a, t = G.t) => a.px[G.cfg.prior + t];
const mktValue = () => G.assets.reduce((s, a) => s + a.shares * priceAt(a), 0);
const equityNow = () => G.cash + mktValue();

function recordEquity() {
  G.equity[G.t] = equityNow();
  G.bench[G.t] = G.assets.reduce((s, a, i) => s + G.benchUnits[i] * priceAt(a), 0);
}

/* ---------- fees ---------- */
function commission(qty, price) {
  if (qty <= 0) return 0;
  const f = G.cfg.fee, value = qty * price;
  let c = f.flat + value * f.pct / 100 + qty * f.share;
  c = Math.max(c, f.min);
  if (f.max) c = Math.min(c, value * f.max / 100);
  return Math.round(c * 100) / 100;
}
const askPx = a => priceAt(a) * (1 + G.cfg.fee.spread / 200);
const bidPx = a => priceAt(a) * (1 - G.cfg.fee.spread / 200);

function maxBuyQty(a, budget = G.cash) {
  const ask = askPx(a);
  let q = Math.floor(budget / ask);
  while (q > 0 && q * ask + commission(q, ask) > budget + 1e-9) q--;
  return q;
}

/* ---------- trading ---------- */
function buy(a, qty) {
  qty = Math.floor(qty);
  if (qty <= 0) return "Enter a quantity.";
  const ask = askPx(a), fee = commission(qty, ask), cost = qty * ask + fee;
  if (cost > G.cash + 1e-9) return `Not enough cash (need ${fmt$(cost)}).`;
  G.cash -= cost; G.feesTotal += fee; a.fees += fee; a.nTrades++;
  a.shares += qty;
  a.lots.push({ q: qty, cost: cost / qty, t: G.t });
  a.markers.push({ t: G.t, side: "buy", px: priceAt(a) });
  G.trades.push({ t: G.t, a, side: "BUY", qty, px: ask, mid: priceAt(a), fee, total: -cost, pnl: null });
  afterTrade();
  return null;
}

function sell(a, qty, note) {
  qty = Math.floor(qty);
  if (qty <= 0) return "Enter a quantity.";
  if (qty > a.shares) return `You only hold ${fmtInt(a.shares)} shares.`;
  const bid = bidPx(a), fee = commission(qty, bid), proceeds = qty * bid - fee;
  const netPer = proceeds / qty;
  let left = qty, pnl = 0;
  while (left > 0) {
    const lot = a.lots[0], take = Math.min(left, lot.q);
    const gain = take * (netPer - lot.cost);
    if (G.t - lot.t >= DAYS_PER_YEAR) G.yearLT += gain; else G.yearST += gain;
    pnl += gain;
    lot.q -= take; left -= take;
    if (lot.q === 0) a.lots.shift();
  }
  G.cash += proceeds; G.feesTotal += fee; a.fees += fee; a.nTrades++;
  a.shares -= qty; a.realized += pnl;
  a.markers.push({ t: G.t, side: "sell", px: priceAt(a) });
  G.trades.push({ t: G.t, a, side: "SELL", qty, px: bid, mid: priceAt(a), fee, total: proceeds, pnl, note });
  afterTrade();
  return null;
}

function afterTrade() {
  recordEquity();
  updateAll();
}

/* ---------- taxes ---------- */
// Nets the year's short- and long-term gains (with loss carry-forward and allowance).
function computeTax(st, lt, carry) {
  const T = G.cfg.tax;
  st += carry;                                     // carried losses offset short-term first
  if (st < 0 && lt > 0) { const x = Math.min(-st, lt); st += x; lt -= x; }
  if (lt < 0 && st > 0) { const x = Math.min(-lt, st); lt += x; st -= x; }
  if (st + lt <= 0) return { tax: 0, carry: Math.min(0, st + lt) };
  let allow = T.allow || 0;
  if (T.st >= T.lt) { const x = Math.min(allow, Math.max(st, 0)); st -= x; allow -= x; lt -= Math.min(allow, Math.max(lt, 0)); }
  else { const x = Math.min(allow, Math.max(lt, 0)); lt -= x; allow -= x; st -= Math.min(allow, Math.max(st, 0)); }
  const tax = Math.max(st, 0) * T.st / 100 + Math.max(lt, 0) * T.lt / 100;
  return { tax: Math.round(tax * 100) / 100, carry: 0 };
}
const estimatedTax = () => G.cfg.taxOn ? computeTax(G.yearST, G.yearLT, G.carryLoss).tax : 0;

function settleTaxYear() {
  if (!G.cfg.taxOn) return;
  const { tax, carry } = computeTax(G.yearST, G.yearLT, G.carryLoss);
  const gains = G.yearST + G.yearLT;
  G.carryLoss = carry;
  if (tax > 0) {
    G.cash -= tax; G.taxesPaid += tax;
    G.trades.push({ t: G.t, a: null, side: "TAX", qty: 0, px: 0, fee: 0, total: -tax, pnl: null,
      note: `Year ${G.taxYear} tax on ${fmt$(gains)} net gains` });
  } else if (gains !== 0 || carry < 0) {
    G.trades.push({ t: G.t, a: null, side: "TAX", qty: 0, px: 0, fee: 0, total: 0, pnl: null,
      note: `Year ${G.taxYear}: no tax` + (carry < 0 ? `, ${fmt$(-carry)} loss carried forward` : "") });
  }
  G.yearST = G.yearLT = 0;
  G.taxYear++;
}

/* ---------- time ---------- */
function advanceDay() {
  if (G.t >= G.cfg.sessionDays - 1) { endGame(); return false; }
  G.t++;
  if (G.t % DAYS_PER_YEAR === 0) settleTaxYear();
  recordEquity();
  return true;
}

function loop(ts) {
  if (!G || G.ended) return;
  if (G.playing) {
    if (G.lastTs) G.acc += Math.min(0.25, (ts - G.lastTs) / 1000) * SPEEDS[G.speedIdx];
    G.lastTs = ts;
    let moved = false;
    while (G.acc >= 1) { G.acc -= 1; if (!advanceDay()) return; moved = true; }
    if (moved) updateAll();
  }
  raf = requestAnimationFrame(loop);
}

function setPlaying(p) {
  if (!G || G.ended) return;
  G.playing = p; G.lastTs = 0;
  const b = $("#btn-play");
  b.textContent = p ? "❚❚ Pause" : "▶ Play";
  b.classList.remove("paused-flash");
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

function changeSpeed(d) {
  G.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, G.speedIdx + d));
  $("#speed-label").textContent = SPEEDS[G.speedIdx] + " d/s";
}

/* ---------- UI: chart cards ---------- */
function buildCharts() {
  const host = $("#charts");
  host.innerHTML = "";
  for (const a of G.assets) {
    const card = el("div", "card");
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="dot" style="background:${a.color}"></span>Chart ${a.label}</div>
        <div style="text-align:right"><div class="card-price"></div><div class="card-chg"></div></div>
      </div>
      <canvas></canvas>
      <div class="pos">
        <div><span>Shares</span><b class="p-sh"></b></div>
        <div><span>Avg cost</span><b class="p-avg"></b></div>
        <div><span>Value</span><b class="p-val"></b></div>
        <div><span>Unrealized</span><b class="p-unr"></b></div>
      </div>
      <div class="trade">
        <input type="number" min="0" step="1" placeholder="Quantity (shares)">
        <button class="buy">Buy</button>
        <button class="sell">Sell</button>
      </div>
      <div class="quick">
        <button data-q="0.1">10% cash</button>
        <button data-q="0.25">25% cash</button>
        <button data-q="0.5">50% cash</button>
        <button data-q="1">Max</button>
        <button data-q="h0.5">½ holding</button>
        <button data-q="h1">All holding</button>
      </div>
      <div class="preview"></div>`;
    host.append(card);
    a.ui = {
      card, canvas: $("canvas", card), price: $(".card-price", card), chg: $(".card-chg", card),
      sh: $(".p-sh", card), avg: $(".p-avg", card), val: $(".p-val", card), unr: $(".p-unr", card),
      qty: $("input", card), preview: $(".preview", card), msg: null,
    };
    const ui = a.ui;
    ui.qty.oninput = () => { ui.msg = null; updatePreview(a); };
    ui.qty.onfocus = () => { if (G.cfg.autopause && G.playing) { setPlaying(false); } };
    ui.qty.onkeydown = e => { if (e.key === "Escape") ui.qty.blur(); };
    $(".buy", card).onclick = () => { ui.msg = buy(a, +ui.qty.value); if (!ui.msg) ui.qty.value = ""; updatePreview(a); };
    $(".sell", card).onclick = () => { ui.msg = sell(a, +ui.qty.value); if (!ui.msg) ui.qty.value = ""; updatePreview(a); };
    for (const b of card.querySelectorAll(".quick button")) {
      b.onclick = () => {
        const q = b.dataset.q;
        ui.qty.value = q[0] === "h" ? Math.floor(a.shares * parseFloat(q.slice(1))) : maxBuyQty(a, G.cash * parseFloat(q));
        ui.msg = null; updatePreview(a);
      };
    }
    ui.canvas.onmousemove = e => { const r = ui.canvas.getBoundingClientRect(); G.hover = { a, x: e.clientX - r.left }; drawChart(a); };
    ui.canvas.onmouseleave = () => { G.hover = null; drawChart(a); };
  }
}

function updatePreview(a) {
  const ui = a.ui, q = Math.floor(+ui.qty.value || 0);
  ui.preview.classList.toggle("err", !!ui.msg);
  if (ui.msg) { ui.preview.textContent = ui.msg; return; }
  if (q <= 0) { ui.preview.textContent = G.cfg.fee.spread ? `bid ${fmtPx(bidPx(a))} · ask ${fmtPx(askPx(a))}` : ""; return; }
  const ask = askPx(a), bid = bidPx(a), fb = commission(q, ask), fs = commission(q, bid);
  ui.preview.textContent = `Buy ≈ ${fmt$(q * ask + fb)} (fee ${fmt$(fb)}) · Sell ≈ ${fmt$(q * bid - fs)} (fee ${fmt$(fs)})`;
}

function updateAll() {
  const c = G.cfg;
  $("#clock-day").textContent = `Day ${G.t + 1} / ${c.sessionDays}`;
  const yr = Math.floor(G.t / DAYS_PER_YEAR) + 1, dIn = (G.t % DAYS_PER_YEAR) + 1;
  $("#clock-sub").textContent = `Year ${yr}, trading day ${dIn}`;
  $("#progress-bar").style.width = ((G.t + 1) / c.sessionDays * 100) + "%";

  for (const a of G.assets) {
    const p = priceAt(a), p0 = priceAt(a, 0), prev = G.t > 0 ? priceAt(a, G.t - 1) : a.px[c.prior - 1] ?? p;
    a.ui.price.textContent = fmtPx(p);
    const d = p / prev - 1, s = p / p0 - 1;
    a.ui.chg.innerHTML = `<span class="${cls(d)}">${fmtPct(d)} today</span> · <span class="${cls(s)}">${fmtPct(s)} since start</span>`;
    const cost = a.lots.reduce((s, l) => s + l.q * l.cost, 0);
    a.ui.sh.textContent = fmtInt(a.shares);
    a.ui.avg.textContent = a.shares ? fmtPx(cost / a.shares) : "—";
    a.ui.val.textContent = a.shares ? fmt$(a.shares * p, 0) : "—";
    const unr = a.shares * p - cost;
    a.ui.unr.innerHTML = a.shares ? `<span class="${cls(unr)}">${fmt$(unr, 0)}</span>` : "—";
    if (!a.ui.msg) updatePreview(a);
    drawChart(a);
  }

  const eq = equityNow(), ret = eq / c.capital - 1, mv = mktValue(), est = estimatedTax();
  const rows = [
    ["Total equity", `<span class="total">${fmt$(eq)}</span>`],
    ["Return", `<span class="${cls(ret)}">${fmtPct(ret)}</span>`],
    ["sep"],
    ["Cash", fmt$(G.cash)],
    ["Invested", fmt$(mv)],
    ["Fees paid", fmt$(G.feesTotal)],
  ];
  if (c.taxOn) {
    rows.push(["Taxes paid", fmt$(G.taxesPaid)]);
    rows.push(["Est. tax this year", fmt$(est)]);
    if (G.carryLoss < 0) rows.push(["Loss carry-fwd", fmt$(-G.carryLoss)]);
  }
  $("#stats").innerHTML = rows.map(r => r[0] === "sep" ? `<div class="sep"></div>` : `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join("");

  renderLog();
  drawEquity();
}

let logLen = -1;
function renderLog() {
  if (G.trades.length === logLen) return;
  logLen = G.trades.length;
  const ol = $("#log");
  if (!G.trades.length) { ol.innerHTML = `<li class="empty">No trades yet. Press Play (Space) to start the clock.</li>`; return; }
  ol.innerHTML = G.trades.slice().reverse().map(tr => {
    if (tr.side === "TAX") return `<li><span class="d">D${tr.t + 1}</span><span style="color:var(--warn)">${tr.note}</span><span class="r">${tr.total ? fmt$(tr.total) : ""}</span></li>`;
    const pnl = tr.pnl == null ? "" : ` <span class="${cls(tr.pnl)}">${fmt$(tr.pnl, 0)}</span>`;
    return `<li><span class="d">D${tr.t + 1}</span><span><b class="${tr.side === "BUY" ? "up" : "down"}">${tr.side}</b> ${fmtInt(tr.qty)} ${tr.a.label} @ ${fmtPx(tr.px)}${pnl}</span><span class="r">${fmt$(tr.total, 0)}</span></li>`;
  }).join("");
}

/* ---------- canvas drawing ---------- */
function setupCanvas(cv, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cssH || cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceTicks(lo, hi, n) {
  const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/* Draws a price chart. opts.reveal = show real dates and the full session. */
function drawChart(a, opts = {}) {
  const cv = opts.canvas || a.ui.canvas;
  const { ctx, w, h } = setupCanvas(cv);
  const c = G.cfg, P = c.prior;
  const lastIdx = P + G.t;                                  // local index of "now"
  const fullEnd = P + c.sessionDays - 1;
  let x0, x1;
  const view = opts.reveal ? "full" : G.view;
  if (view === "full") { x0 = 0; x1 = opts.reveal ? lastIdx : fullEnd; }
  else { const W = view === "1y" ? 252 : 63; x1 = Math.max(lastIdx + Math.round(W * 0.08), W); x0 = Math.max(0, x1 - W); }
  const visEnd = Math.min(lastIdx, x1);

  let lo = Infinity, hi = -Infinity;
  for (let i = x0; i <= visEnd; i++) { const v = a.px[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const useLog = G.log;
  const tf = v => useLog ? Math.log(v) : v;
  let tlo = tf(lo), thi = tf(hi);
  if (thi - tlo < 1e-9) { thi += 0.5; tlo -= 0.5; }
  const pad = (thi - tlo) * 0.08; tlo -= pad; thi += pad;

  const L = 6, R = 58, T = 8, B = opts.reveal ? 22 : 10;
  const X = i => L + (i - x0) / Math.max(1, x1 - x0) * (w - L - R);
  const Y = v => T + (1 - (tf(v) - tlo) / (thi - tlo)) * (h - T - B);

  // grid + price axis
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "middle";
  const ticks = useLog
    ? niceTicks(Math.exp(tlo), Math.exp(thi), 5)
    : niceTicks(tlo, thi, 5);
  for (const v of ticks) {
    const y = Y(v); if (y < T || y > h - B) continue;
    ctx.strokeStyle = "rgba(139,152,168,.12)"; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
    ctx.fillStyle = "#6b7685"; ctx.fillText(v >= 1000 ? fmtInt(v) : +v.toPrecision(4) + "", w - R + 6, y);
  }

  // date axis on reveal
  if (opts.reveal) {
    ctx.textBaseline = "top"; ctx.fillStyle = "#6b7685";
    const span = x1 - x0, n = Math.max(2, Math.floor((w - L - R) / 90));
    for (let k = 0; k <= n; k++) {
      const i = Math.round(x0 + span * k / n);
      const x = X(i), txt = fmtMonth(a.days[i]);
      ctx.textAlign = k === 0 ? "left" : k === n ? "right" : "center";
      ctx.fillText(txt, Math.min(x, w - R), h - B + 6);
    }
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
  }

  // session start divider + pre-history shading
  if (P > 0 && P >= x0 && P <= x1) {
    const xs = X(P);
    ctx.fillStyle = "rgba(139,152,168,.05)"; ctx.fillRect(L, T, xs - L, h - T - B);
    ctx.strokeStyle = "rgba(139,152,168,.35)"; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(xs, T); ctx.lineTo(xs, h - B); ctx.stroke(); ctx.setLineDash([]);
  }

  // avg cost line
  if (!opts.reveal && a.shares > 0) {
    const avg = a.lots.reduce((s, l) => s + l.q * l.cost, 0) / a.shares, y = Y(avg);
    if (y > T && y < h - B) {
      ctx.strokeStyle = "rgba(245,165,36,.6)"; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // price line (pre-history in grey, session in color)
  const drawSeg = (from, to, color, fill) => {
    if (to < from) return;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const x = X(i), y = Y(a.px[i]);
      if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.stroke();
    if (fill) {
      ctx.lineTo(X(to), h - B); ctx.lineTo(X(from), h - B); ctx.closePath();
      const g = ctx.createLinearGradient(0, T, 0, h - B);
      g.addColorStop(0, a.color + "38"); g.addColorStop(1, a.color + "00");
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.lineWidth = 1;
  };
  drawSeg(x0, Math.min(P, visEnd), "rgba(139,152,168,.7)", false);
  drawSeg(Math.max(P, x0), visEnd, a.color, true);

  // trade markers
  for (const m of a.markers) {
    const i = P + m.t; if (i < x0 || i > x1) continue;
    const x = X(i), y = Y(m.px), up = m.side === "buy";
    ctx.fillStyle = up ? "#2fbf71" : "#f0525e";
    ctx.beginPath();
    if (up) { ctx.moveTo(x, y + 4); ctx.lineTo(x - 5, y + 12); ctx.lineTo(x + 5, y + 12); }
    else { ctx.moveTo(x, y - 4); ctx.lineTo(x - 5, y - 12); ctx.lineTo(x + 5, y - 12); }
    ctx.closePath(); ctx.fill();
  }

  // last price tag
  if (!opts.reveal) {
    const v = a.px[lastIdx], y = Y(v);
    ctx.fillStyle = a.color;
    ctx.beginPath(); ctx.arc(X(lastIdx), y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(w - R + 2, y - 9, R - 2, 18);
    ctx.fillStyle = "#04121f"; ctx.font = "bold 11px ui-monospace, Menlo, monospace";
    ctx.fillText(fmtPx(v), w - R + 6, y);
  }

  // hover crosshair
  const hv = opts.reveal ? opts.hover : (G.hover && G.hover.a === a ? G.hover : null);
  if (hv) {
    const i = Math.round(x0 + (hv.x - L) / (w - L - R) * (x1 - x0));
    if (i >= x0 && i <= visEnd) {
      const x = X(i), v = a.px[i], y = Y(v);
      ctx.strokeStyle = "rgba(230,237,243,.25)";
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
      const rel = i - P;
      const label = (opts.reveal ? fmtDate(a.days[i]) : `Day ${rel >= 0 ? rel + 1 : rel}`) + `  ${fmtPx(v)}`;
      ctx.font = "11px ui-monospace, Menlo, monospace";
      const tw = ctx.measureText(label).width + 10;
      const bx = Math.min(Math.max(L, x - tw / 2), w - R - tw);
      ctx.fillStyle = "rgba(13,17,23,.9)"; ctx.fillRect(bx, T, tw, 18);
      ctx.fillStyle = "#e6edf3"; ctx.textBaseline = "middle"; ctx.fillText(label, bx + 5, T + 9);
    }
  }
}

function drawEquity(cv = $("#equity"), cssH = 140) {
  const { ctx, w, h } = setupCanvas(cv, cssH);
  const n = G.cfg.sessionDays, eq = G.equity, bh = G.bench, cap = G.cfg.capital;
  let lo = cap, hi = cap;
  for (let i = 0; i <= G.t; i++) { lo = Math.min(lo, eq[i], bh[i]); hi = Math.max(hi, eq[i], bh[i]); }
  const pad = (hi - lo) * 0.1 || cap * 0.02; lo -= pad; hi += pad;
  const X = i => 4 + i / Math.max(1, n - 1) * (w - 8);
  const Y = v => 4 + (1 - (v - lo) / (hi - lo)) * (h - 8);
  ctx.strokeStyle = "rgba(139,152,168,.3)"; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(0, Y(cap)); ctx.lineTo(w, Y(cap)); ctx.stroke(); ctx.setLineDash([]);
  const line = (arr, color, lw) => {
    ctx.beginPath();
    for (let i = 0; i <= G.t; i++) { const x = X(i), y = Y(arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
  };
  line(bh, "#8b98a8", 1.2);
  line(eq, "#4ea1ff", 1.8);
}

/* ---------- controls ---------- */
$("#btn-play").onclick = () => setPlaying(!G.playing);
$("#btn-step").onclick = () => { if (G.playing) setPlaying(false); if (advanceDay()) updateAll(); };
$("#speed-up").onclick = () => changeSpeed(1);
$("#speed-down").onclick = () => changeSpeed(-1);
$("#log-scale").onchange = e => { G.log = e.target.checked; updateAll(); };
for (const b of document.querySelectorAll("#view-seg button")) {
  b.onclick = () => {
    G.view = b.dataset.view;
    document.querySelectorAll("#view-seg button").forEach(x => x.classList.toggle("on", x === b));
    updateAll();
  };
}
$("#btn-end").onclick = () => {
  if (G.t < G.cfg.sessionDays - 1 && !confirm("End the game now? Open positions will be sold at the current price.")) return;
  endGame();
};
$("#btn-again").onclick = () => { $("#reveal").hidden = true; $("#setup").hidden = false; window.scrollTo(0, 0); };

document.addEventListener("keydown", e => {
  if (!G || G.ended || $("#game").hidden) return;
  if (e.target.tagName === "BUTTON") e.target.blur();   // so Space doesn't also re-click it
  const typing = e.target.tagName === "INPUT" || e.target.tagName === "SELECT";
  if (e.code === "Space" && !(typing && e.target.type !== "number")) { e.preventDefault(); setPlaying(!G.playing); }
  else if (typing) return;
  else if (e.key === "ArrowRight") { e.preventDefault(); $("#btn-step").click(); }
  else if (e.key === "+" || e.key === "=") changeSpeed(1);
  else if (e.key === "-" || e.key === "_") changeSpeed(-1);
});
window.addEventListener("resize", () => {
  if (!G) return;
  if (!$("#game").hidden) updateAll();
  if (!$("#reveal").hidden) G.assets.forEach(a => a.revealCanvas && drawChart(a, { canvas: a.revealCanvas, reveal: true }));
});

/* ---------- end & reveal ---------- */
function endGame() {
  if (G.ended) return;
  setPlaying(false);
  G.ended = true;
  cancelAnimationFrame(raf);
  for (const a of G.assets) if (a.shares > 0) sell(a, a.shares, "final liquidation");
  // settle the final (partial) tax year unless it was just settled on a year boundary
  if (G.yearST !== 0 || G.yearLT !== 0 || G.t % DAYS_PER_YEAR !== 0) settleTaxYear();
  recordEquity();
  showReveal();
}

/* ---------- benchmarks ---------- */
// Buy on day 0 and hold to the end. legs = [{ p0, p1, budget }] at mid prices.
// Gross: fractional shares, no costs. Net: whole shares, spread, commission, and tax on the final sale.
function buyAndHold(legs) {
  const c = G.cfg, half = c.fee.spread / 200;
  let gross = 0, net = 0, gain = 0;
  for (const { p0, p1, budget } of legs) {
    gross += budget * p1 / p0;
    const ask = p0 * (1 + half);
    let q = Math.floor(budget / ask);
    while (q > 0 && q * ask + commission(q, ask) > budget) q--;
    if (q <= 0) { net += budget; continue; }
    const cost = q * ask + commission(q, ask);
    const bid = p1 * (1 - half), proceeds = q * bid - commission(q, bid);
    net += budget - cost + proceeds;
    gain += proceeds - cost;
  }
  // buy-and-hold only realizes at the end, so all gains fall in one tax year
  const held = G.t >= DAYS_PER_YEAR;
  const tax = c.taxOn ? computeTax(held ? 0 : gain, held ? gain : 0, 0).tax : 0;
  return { gross, net: net - tax };
}

// Your own trades replayed at mid prices with no commission, spread or tax.
function playerGross() {
  return G.trades.reduce((s, tr) => s + (tr.side === "BUY" ? -1 : tr.side === "SELL" ? 1 : 0) * tr.qty * (tr.mid || 0), G.cfg.capital);
}

const gameYears = () => Math.max(G.t, 1) / DAYS_PER_YEAR;
const annualize = (r, yrs = gameYears()) => r <= -1 ? -1 : Math.pow(1 + r, 1 / yrs) - 1;

// Every strategy on the reveal table, as final values in dollars (gross and net).
function comparisonRows() {
  const c = G.cfg, P = c.prior, n = G.assets.length, cap = c.capital;
  const range = (d0, d1) => `${fmtDate(d0)} → ${fmtDate(d1)}`;
  const windowOf = a => [a.days[P], a.days[P + G.t]];
  const leg = (a, budget) => ({ p0: a.px[P], p1: a.px[P + G.t], budget });
  // Indexes are compared over the same calendar window(s) as your charts; with several
  // independent windows the capital is split equally across them.
  const windows = (c.sync === "same" || n === 1 ? [G.assets[0]] : G.assets).map(windowOf);
  const period = windows.length === 1 ? range(...windows[0]) : `your ${n} chart windows, 1/${n} in each`;

  const rows = [{ group: "Your trading", name: "You", you: true, period, gross: playerGross(), net: G.cash }];
  const mine = "Buy & hold the charts you played";
  if (n > 1) rows.push({ group: mine, name: `Equal weight, all ${n} charts`, period: c.sync === "same" ? period : "each chart's own window",
    ...buyAndHold(G.assets.map(a => leg(a, cap / n))) });
  for (const a of G.assets)
    rows.push({ group: mine, name: `All in ${a.label}: ${a.meta.name}`, color: a.color, period: range(...windowOf(a)), ...buyAndHold([leg(a, cap)]) });

  for (const tk of MAJOR_INDEXES) {
    const idx = UNIVERSE.find(u => u.ticker === tk);
    if (!idx) continue;
    // an index you played reuses its chart's window and prices, so both rows agree exactly
    const played = G.assets.find(a => a.meta === idx);
    const wins = played && windows.length === 1 ? [windowOf(played)] : windows;
    const legs = wins !== windows ? [leg(played, cap)] : wins.map(([d0, d1]) => {
      const i0 = lowerBound(idx.days, d0), i1 = lowerBound(idx.days, d1 + 1) - 1;
      if (i0 >= idx.px.length || i1 <= i0 || idx.days[i0] - d0 > 7 || d1 - idx.days[i1] > 7) return null;
      // priced like a fund at 100 so share-based commissions behave sensibly
      return { p0: 100, p1: 100 * idx.px[i1] / idx.px[i0], budget: cap / wins.length };
    });
    const row = { group: "Major indexes", name: idx.name + (played ? ` (= chart ${played.label})` : ""),
      period: wins.length === 1 ? range(...wins[0]) : period };
    if (legs.every(Boolean)) Object.assign(row, buyAndHold(legs));
    else Object.assign(row, { missing: `no data before ${fmtDate(idx.days[0])}` });
    rows.push(row);
  }
  return rows;
}

function renderComparison(rows) {
  const cap = G.cfg.capital, you = rows[0].net;
  const maxAbs = Math.max(...rows.filter(r => !r.missing).map(r => Math.abs(r.net / cap - 1)), 1e-9);
  let group = null;
  const body = rows.map(r => {
    const head = r.group !== group ? `<tr class="grp"><td colspan="9">${(group = r.group)}</td></tr>` : "";
    const name = `${r.color ? `<span class="dot" style="display:inline-block;background:${r.color}"></span> ` : ""}${r.name}`;
    if (r.missing) return head + `<tr><td>${name}</td><td class="muted">${r.period}</td><td colspan="7" class="muted">${r.missing}</td></tr>`;
    const g = r.gross / cap - 1, nt = r.net / cap - 1, diff = you - r.net;
    const w = Math.abs(nt) / maxAbs * 50;
    const bar = `<div class="bar"><i class="${nt < 0 ? "neg" : "pos"}" style="${nt < 0 ? "right" : "left"}:50%;width:${w}%"></i></div>`;
    return head + `<tr class="${r.you ? "you" : ""}">
      <td>${name}</td><td class="muted">${r.period}</td>
      <td class="n ${cls(g)}">${fmtPct(g, 1)}</td><td class="n ${cls(g)}">${fmtPct(annualize(g), 1)}</td>
      <td class="n ${cls(nt)}">${fmtPct(nt, 1)}</td><td class="n ${cls(nt)}">${fmtPct(annualize(nt), 1)}</td>
      <td>${bar}</td>
      <td class="n">${fmt$(r.net, 0)}</td>
      <td class="n ${r.you ? "" : cls(diff)}">${r.you ? "" : (diff > 0 ? "+" : "") + fmt$(diff, 0)}</td></tr>`;
  }).join("");
  $("#reveal-compare").innerHTML = `
    <thead><tr><th>Strategy</th><th>Period</th>
      <th class="n">Gross total</th><th class="n">Gross / yr</th><th class="n">Net total</th><th class="n">Net / yr</th>
      <th>Net return</th><th class="n">Net final</th><th class="n">You vs. it (net)</th></tr></thead>
    <tbody>${body}</tbody>`;
}

function showReveal() {
  const c = G.cfg;
  $("#game").hidden = true; $("#reveal").hidden = false; window.scrollTo(0, 0);

  const cmp = comparisonRows();
  const final = G.cash, ret = final / c.capital - 1, yrs = gameYears();
  const gross = cmp[0].gross, gret = gross / c.capital - 1;
  const spreadCost = G.trades.reduce((s, tr) => s + (tr.mid ? tr.qty * Math.abs(tr.px - tr.mid) : 0), 0);
  const nTrades = G.trades.filter(t => t.side !== "TAX").length;
  const ranked = cmp.filter(r => !r.missing).sort((x, y) => y.net - x.net);
  const rank = ranked.findIndex(r => r.you) + 1, best = ranked[0].you ? ranked[1] : ranked[0];

  let verdict;
  if (nTrades === 0) verdict = "You didn't trade at all — your money sat in cash the whole time.";
  else if (rank === 1) verdict = `You beat every benchmark — <b class="up">${fmt$(final - best.net, 0)}</b> ahead of the runner-up (${best.name}).`;
  else verdict = `You finished <b>#${rank} of ${ranked.length}</b> on net return. The best choice was ${best.name}, which would have left you <b class="down">${fmt$(best.net - final, 0)}</b> richer.`;

  $("#reveal-summary").innerHTML = `
    <div class="tile"><span>Final value (after fees${c.taxOn ? " & taxes" : ""})</span><b>${fmt$(final, 0)}</b><small>from ${fmt$(c.capital, 0)}</small></div>
    <div class="tile"><span>Net return</span><b class="${cls(ret)}">${fmtPct(ret)}</b><small>${fmtPct(annualize(ret))} / yr over ${yrs.toFixed(1)} game yrs</small></div>
    <div class="tile"><span>Gross return (before costs)</span><b class="${cls(gret)}">${fmtPct(gret)}</b><small>${fmtPct(annualize(gret))} / yr</small></div>
    <div class="tile"><span>Trades</span><b>${nTrades}</b><small>incl. final liquidation</small></div>
    <div class="tile"><span>Fees + spread paid</span><b>${fmt$(G.feesTotal + spreadCost, 0)}</b><small>${fmt$(G.feesTotal, 0)} fees · ${fmt$(spreadCost, 0)} spread</small></div>
    ${c.taxOn ? `<div class="tile"><span>Taxes paid</span><b>${fmt$(G.taxesPaid)}</b><small>${c.tax.name}</small></div>` : ""}
    <div class="verdict">${verdict}</div>`;
  renderComparison(cmp);

  const host = $("#reveal-assets");
  host.innerHTML = "";
  for (const a of G.assets) {
    const P = c.prior, i0 = P, i1 = P + G.t;
    const realRet = a.raw[i1] / a.raw[i0] - 1;
    const card = el("div", "card reveal-card");
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="dot" style="background:${a.color}"></span>${a.label}: ${a.meta.name}</div>
        <div class="card-chg ${cls(realRet)}" style="font-size:16px">${fmtPct(realRet, 1)}</div>
      </div>
      <div class="meta">${a.meta.ticker} · ${a.meta.kind} · ${a.meta.region} · ${fmtDate(a.days[i0])} → ${fmtDate(a.days[i1])}</div>
      <canvas style="height:200px"></canvas>
      <div class="kv">
        <div><span>Real price at start*</span><b>${fmtReal(a.raw[i0])}</b></div>
        <div><span>Real price at end*</span><b>${fmtReal(a.raw[i1])}</b></div>
        <div><span>Shown at ×${a.scale.toPrecision(3)}</span><b>${fmtPx(a.px[i0])} → ${fmtPx(a.px[i1])}</b></div>
        <div><span>Your trades</span><b>${a.nTrades}</b></div>
        <div><span>Fees on it</span><b>${fmt$(a.fees)}</b></div>
        <div><span>Your P/L (pre-tax)</span><b class="${cls(a.realized)}">${fmt$(a.realized, 0)}</b></div>
      </div>`;
    host.append(card);
    a.revealCanvas = $("canvas", card);
    const draw = hover => drawChart(a, { canvas: a.revealCanvas, reveal: true, hover });
    a.revealCanvas.onmousemove = e => draw({ x: e.clientX - a.revealCanvas.getBoundingClientRect().left });
    a.revealCanvas.onmouseleave = () => draw(null);
    draw(null);
  }

  // trade table
  const rows = G.trades.map(tr => {
    if (tr.side === "TAX") return `<tr class="taxrow"><td>${tr.t + 1}</td><td colspan="8">${tr.note}</td><td class="n">${tr.total ? fmt$(tr.total) : ""}</td></tr>`;
    const a = tr.a;
    return `<tr>
      <td>${tr.t + 1}</td><td>${fmtDate(a.days[c.prior + tr.t])}</td>
      <td><span class="dot" style="display:inline-block;background:${a.color}"></span> ${a.label} · ${a.meta.name}</td>
      <td class="${tr.side === "BUY" ? "up" : "down"}">${tr.side}${tr.note ? ` <span class="muted">(${tr.note})</span>` : ""}</td>
      <td class="n">${fmtInt(tr.qty)}</td><td class="n">${fmtPx(tr.px)}</td>
      <td class="n">${fmtReal(tr.px / a.scale)}</td>
      <td class="n">${fmt$(tr.fee)}</td>
      <td class="n ${tr.pnl == null ? "" : cls(tr.pnl)}">${tr.pnl == null ? "" : fmt$(tr.pnl)}</td>
      <td class="n">${fmt$(tr.total)}</td></tr>`;
  }).join("");
  const realizedSum = G.assets.reduce((s, a) => s + a.realized, 0);
  $("#reveal-trades").innerHTML = `
    <thead><tr><th>Game day</th><th>Real date</th><th>Asset</th><th>Side</th><th class="n">Qty</th><th class="n">Fill (shown)</th><th class="n">Fill (real*)</th><th class="n">Fee</th><th class="n">Realized P/L</th><th class="n">Cash flow</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="10" class="muted">No trades.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="7">Totals</td><td class="n">${fmt$(G.feesTotal)}</td><td class="n ${cls(realizedSum)}">${fmt$(realizedSum)}</td><td class="n">${c.taxOn ? "tax " + fmt$(-G.taxesPaid) : ""}</td></tr></tfoot>`;
}

function fmtReal(v) {
  return v >= 100 ? fmtInt(v) : v >= 1 ? v.toFixed(2) : v.toPrecision(3);
}

if (!UNIVERSE.length) alert("data.js is missing or empty — run tools/fetch_data.py first.");

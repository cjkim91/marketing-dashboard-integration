/* ═══════════════════════════════════════════════════════════════════════════
   Pulse · Marketing Performance Dashboard — app.js
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Chart.js defaults (theme-aware) ──────────────────────────────────────────
function applyChartTheme() {
  if (typeof Chart === "undefined") return;
  const c = getComputedStyle(document.documentElement);
  Chart.defaults.font.family = `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = c.getPropertyValue("--muted").trim();
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.plugins.tooltip.backgroundColor = c.getPropertyValue("--ink").trim();
  Chart.defaults.plugins.tooltip.titleColor = "#fff";
  Chart.defaults.plugins.tooltip.bodyColor = "#fff";
  Chart.defaults.plugins.tooltip.usePointStyle = true;
}

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  data: null,
  page: "overview",
  granularity: "day",
  metaLevel: "campaigns",
  compare: true,
  overviewTrend: "revenue_spend",
  startDate: "",
  endDate: "",
  charts: {},
  theme: localStorage.getItem("pulse:theme") || "light",
  sort: {
    landing:   { key: "sessions",  dir: "desc" },
    ga4Detail: { key: "purchases", dir: "desc" },
  },
  ga4Search: "",
  metaSearch: "",
};

// ── Theme palette resolver (re-evaluated per render) ─────────────────────────
function palette() {
  const c = getComputedStyle(document.documentElement);
  const v = (n) => c.getPropertyValue(n).trim();
  return {
    primary:       v("--primary"),
    primarySoft:   v("--primary-soft"),
    primarySoft2:  v("--primary-soft-2"),
    positive:      v("--positive"),
    positiveSoft:  v("--positive-soft"),
    negative:      v("--negative"),
    negativeSoft:  v("--negative-soft"),
    warning:       v("--warning"),
    warningSoft:   v("--warning-soft"),
    violet:        v("--violet"),
    violetSoft:    v("--violet-soft"),
    teal:          v("--teal"),
    tealSoft:      v("--teal-soft"),
    ink:           v("--ink"),
    muted:         v("--muted"),
    border:        v("--border"),
    grid:          v("--chart-grid"),
    surface:       v("--surface"),
    deviceArr: [v("--primary"), v("--positive"), v("--warning"), v("--violet")],
    channelArr: [
      v("--primary"), v("--violet"), v("--positive"), v("--warning"),
      v("--teal"), v("--negative"), "#8b5cf6", "#0ea5e9", "#f97316", "#a16207",
    ],
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  document.documentElement.setAttribute("data-theme", state.theme);
  applyChartTheme();

  bindControls();
  bindSortHeaders();
  bindThemeToggle();

  try {
    const response = await fetch("./data/dashboard.json", { cache: "no-store" });
    if (!response.ok) throw new Error("dashboard.json not found");
    state.data = await response.json();
    state.startDate = state.data.period?.since || "";
    state.endDate   = state.data.period?.until || "";

    if (state.data.defaults?.granularity) {
      // Honor builder default if it's a known granularity
      const g = state.data.defaults.granularity;
      if (["day", "week", "month"].includes(g)) {
        state.granularity = g;
        setActive("[data-granularity]", document.querySelector(`[data-granularity="${g}"]`));
      }
    }

    applyPreset("28");
    setDateInputs();
    updateFreshness();
    render();
  } catch (err) {
    console.error(err);
    document.getElementById("emptyState").classList.remove("hidden");
    document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
    const f = document.getElementById("freshness");
    f.setAttribute("data-state", "bad");
    f.querySelector(".freshness-text").textContent = "데이터 없음";
  }
}

// ── Controls ─────────────────────────────────────────────────────────────────
function bindControls() {
  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.page = btn.dataset.page;
      setActive("[data-page]", btn);
      document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
      const pageEl = document.getElementById(`${state.page}Page`);
      if (pageEl) pageEl.classList.remove("hidden");
      render();
    });
  });

  document.querySelectorAll("[data-granularity]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.granularity = btn.dataset.granularity;
      setActive("[data-granularity]", btn);
      render();
    });
  });

  document.querySelectorAll("[data-meta-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.metaLevel = btn.dataset.metaLevel;
      setActive("[data-meta-level]", btn);
      renderMeta();
    });
  });

  document.querySelectorAll("[data-overview-trend]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.overviewTrend = btn.dataset.overviewTrend;
      setActive("[data-overview-trend]", btn);
      renderOverview();
    });
  });

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyPreset(btn.dataset.preset);
      setActive("[data-preset]", btn);
    });
  });

  document.getElementById("startDate").addEventListener("change", (e) => {
    state.startDate = e.target.value;
    clearPresetActive();
    render();
  });
  document.getElementById("endDate").addEventListener("change", (e) => {
    state.endDate = e.target.value;
    clearPresetActive();
    render();
  });

  document.getElementById("compareToggle").addEventListener("change", (e) => {
    state.compare = e.target.checked;
    render();
  });

  const ga4Search = document.getElementById("ga4Search");
  if (ga4Search) {
    ga4Search.addEventListener("input", (e) => {
      state.ga4Search = e.target.value.toLowerCase();
      renderGa4DetailTable();
    });
  }
  const metaSearch = document.getElementById("metaSearch");
  if (metaSearch) {
    metaSearch.addEventListener("input", (e) => {
      state.metaSearch = e.target.value.toLowerCase();
      renderMetaReview();
    });
  }

  document.querySelectorAll("[data-jump]").forEach((el) => {
    el.addEventListener("click", () => {
      const btn = document.querySelector(`[data-page="${el.dataset.jump}"]`);
      if (btn) btn.click();
    });
  });
}

function bindThemeToggle() {
  document.getElementById("themeToggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
    localStorage.setItem("pulse:theme", state.theme);
    applyChartTheme();
    render();
  });
}

function bindSortHeaders() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key   = th.dataset.sortKey;
      const scope = th.dataset.sortScope || "default";
      const ss = state.sort[scope] || (state.sort[scope] = { key, dir: "desc" });
      if (ss.key === key) ss.dir = ss.dir === "desc" ? "asc" : "desc";
      else { ss.key = key; ss.dir = "desc"; }
      render();
    });
  });
}

function applyPreset(preset) {
  if (!state.data) return;
  const until = state.data.period?.until || "";
  if (!until) return;
  if (preset === "all") {
    state.startDate = state.data.period?.since || "";
    state.endDate   = until;
  } else {
    const days = parseInt(preset, 10);
    const untilDate = parseLocalDate(until);
    const sinceDate = new Date(untilDate);
    sinceDate.setDate(sinceDate.getDate() - days + 1);
    state.startDate = fmtDate(sinceDate);
    state.endDate   = until;
  }
  setDateInputs();
  render();
}

function clearPresetActive() {
  document.querySelectorAll("[data-preset]").forEach((b) => b.classList.remove("active"));
}
function setActive(selector, activeBtn) {
  document.querySelectorAll(selector).forEach((btn) => btn.classList.remove("active"));
  if (activeBtn) activeBtn.classList.add("active");
}
function setDateInputs() {
  document.getElementById("startDate").value = state.startDate;
  document.getElementById("endDate").value   = state.endDate;
}

// ── Freshness chip ───────────────────────────────────────────────────────────
function updateFreshness() {
  const el = document.getElementById("freshness");
  const txt = el.querySelector(".freshness-text");
  const d = state.data;
  if (!d) {
    el.setAttribute("data-state", "bad");
    txt.textContent = "데이터 없음";
    return;
  }
  const through  = d.data_through || d.period?.until;
  const expected = d.expected_through || kstYesterdayISO();
  const expectedDate = parseLocalDate(expected);
  const throughDate  = parseLocalDate(through);
  const lag = Math.round((expectedDate - throughDate) / 86400000);

  let label;
  let st = "ok";
  if (lag <= 0) {
    label = `${through} 까지 (전일) · 최신`;
    st = "ok";
  } else if (lag === 1) {
    label = `${through} 까지 · 1일 지연`;
    st = "warn";
  } else {
    label = `${through} 까지 · ${lag}일 지연`;
    st = "bad";
  }
  el.setAttribute("data-state", st);
  txt.textContent = label;
  el.title = `생성: ${fmtGeneratedAt(d.generated_at)}  ·  기대 D-1: ${expected}`;
}

// ── Render router ────────────────────────────────────────────────────────────
function render() {
  if (!state.data) return;
  document.getElementById("emptyState").classList.add("hidden");
  if (state.page === "overview") renderOverview();
  if (state.page === "ga4")      renderGa4();
  if (state.page === "meta")     renderMeta();
  if (state.page === "channels") renderChannels();
  applySortIcons();
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════
function renderOverview() {
  const ga4Rows  = filterByDate(state.data.ga4?.rows || []);
  const metaRows = filterByDate(state.data.meta?.campaigns || []);

  // Aggregate by period
  const ga4Period = aggregateRows(ga4Rows, ["period"], {
    sessions: "sum", users: "sum", new_users: "sum",
    detail_views: "sum", cart_adds: "sum", checkout_starts: "sum",
    purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  }).sort(sortPeriodAsc);
  ga4Period.forEach(recomputeGa4Derived);

  const metaPeriod = aggregateRows(metaRows, ["period"], {
    impressions: "sum", reach: "sum", clicks: "sum",
    conversions: "sum", spend: "sum", conversion_value: "sum",
  }).sort(sortPeriodAsc);
  metaPeriod.forEach(addMetaRates);

  const ga4Total = sumFields(ga4Period,
    ["sessions", "users", "detail_views", "cart_adds", "checkout_starts",
     "purchases", "revenue", "bounce_sessions", "total_duration"]);
  recomputeGa4Derived(ga4Total);
  const metaTotal = sumFields(metaPeriod,
    ["impressions", "reach", "clicks", "conversions", "spend", "conversion_value"]);
  addMetaRates(metaTotal);

  // Previous period totals
  const prev = previousPeriodTotals();

  // Period label
  document.getElementById("overviewPeriodLabel").textContent =
    `${state.startDate} → ${state.endDate} · ${gLabel()} 집계${state.compare ? " · 전기간 대비" : ""}`;

  // KPI band
  const blendedRoas = metaTotal.spend ? ga4Total.revenue / metaTotal.spend : 0;
  const prevBlendedRoas = prev.spend ? prev.revenue / prev.spend : 0;
  const blendedCac = ga4Total.purchases ? metaTotal.spend / ga4Total.purchases : 0;
  const prevBlendedCac = prev.purchases ? prev.spend / prev.purchases : 0;

  // Daily sparkline series (independent of state.granularity — always smooth)
  const dailyGa4  = dailySeries(ga4Rows, ["revenue", "purchases", "sessions"]);
  const dailyMeta = dailySeries(metaRows, ["spend"]);
  const blendedSeries = blendedSparkSeries(ga4Rows, metaRows);

  renderKpis("overviewKpis", [
    kpi("매출",    ga4Total.revenue,      "Total Revenue", prev.revenue, fmtMoney,   dailyGa4.revenue, false, "primary"),
    kpi("광고비",  metaTotal.spend,        "Meta Spend",    prev.spend,    fmtMoney,  dailyMeta.spend,  true,  "warning"),
    kpi("블렌디드 ROAS", blendedRoas,     "Revenue/Spend", prevBlendedRoas, fmtDecimal, blendedSeries.roas, false, "violet"),
    kpi("구매수",   ga4Total.purchases,   "Purchases",     prev.purchases, fmtInt,    dailyGa4.purchases, false, "positive"),
    kpi("블렌디드 CAC", blendedCac,       "Spend/Purchase", prevBlendedCac, fmtMoney, blendedSeries.cac,  true,  "warning"),
    kpi("유입",     ga4Total.sessions,    "Sessions",      prev.sessions, fmtInt,    dailyGa4.sessions, false, "primary"),
  ]);

  // Trend chart (configurable)
  renderOverviewTrend(ga4Period, metaPeriod);

  // Funnel
  const hasCheckout = !!state.data.ga4?.has_checkout;
  const hasCart     = !!state.data.ga4?.has_cart;
  const steps = funnelSteps(ga4Total, hasCart, hasCheckout);
  renderFunnel("overviewFunnel", steps);

  // Channel mix
  renderChannelMix(ga4Rows);

  // Top campaigns
  renderTopCampaigns(metaRows);

  // Heatmap (daily ROAS proxy)
  renderHeatmap(ga4Rows, metaRows);
}

function renderOverviewTrend(ga4Period, metaPeriod) {
  destroyChart("chartOverviewTrend");
  const canvas = document.getElementById("chartOverviewTrend");
  if (!canvas) return;

  // Merge by period
  const periods = Array.from(new Set([...ga4Period.map((r) => r.period), ...metaPeriod.map((r) => r.period)])).sort();
  const ga4By  = new Map(ga4Period.map((r)  => [r.period, r]));
  const metaBy = new Map(metaPeriod.map((r) => [r.period, r]));

  const pal = palette();
  let ds = [];
  if (state.overviewTrend === "revenue_spend") {
    ds = [
      lineDs("매출",   periods.map((p) => ga4By.get(p)?.revenue || 0),  pal.primary,  pal.primarySoft2, "y"),
      lineDs("광고비", periods.map((p) => metaBy.get(p)?.spend  || 0),  pal.warning,  pal.warningSoft, "y"),
    ];
  } else if (state.overviewTrend === "roas_cpa") {
    const roas = periods.map((p) => {
      const sp = metaBy.get(p)?.spend || 0;
      const rev = ga4By.get(p)?.revenue || 0;
      return sp ? rev / sp : 0;
    });
    const cpa = periods.map((p) => {
      const sp = metaBy.get(p)?.spend || 0;
      const purchases = ga4By.get(p)?.purchases || 0;
      return purchases ? sp / purchases : 0;
    });
    ds = [
      lineDs("블렌디드 ROAS", roas, pal.violet,  pal.violetSoft, "y"),
      lineDs("블렌디드 CAC",  cpa,  pal.warning, pal.warningSoft, "y1"),
    ];
  } else {
    ds = [
      lineDs("유입", periods.map((p) => ga4By.get(p)?.sessions  || 0), pal.primary,  pal.primarySoft2, "y"),
      lineDs("구매", periods.map((p) => ga4By.get(p)?.purchases || 0), pal.positive, pal.positiveSoft, "y1"),
    ];
  }

  const hasY1 = ds.some((d) => d.yAxisID === "y1");
  const isMoney = state.overviewTrend === "revenue_spend";
  state.charts.chartOverviewTrend = new Chart(canvas, {
    type: "line",
    data: { labels: periods, datasets: ds },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, padding: 14, usePointStyle: true, font: { size: 11, weight: "600" } } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.dataset.yAxisID === "y1" ? fmtDecimal(ctx.raw) : (isMoney ? fmtMoney(ctx.raw) : fmtInt(ctx.raw))}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
        y: { position: "left",  grid: { color: palette().grid }, border: { display: false },
             ticks: { maxTicksLimit: 5, callback: (v) => isMoney ? fmtMoney(v) : fmtInt(v) } },
        ...(hasY1 ? { y1: { position: "right", grid: { display: false }, border: { display: false },
                            ticks: { maxTicksLimit: 5, callback: (v) => fmtDecimal(v) } } } : {}),
      },
    },
  });
}

function renderChannelMix(rows) {
  const byChan = aggregateRows(rows, ["channel"], {
    sessions: "sum", purchases: "sum", revenue: "sum",
  }).sort((a, b) => b.revenue - a.revenue);
  const totalRev = byChan.reduce((s, r) => s + r.revenue, 0);
  const totalSess = byChan.reduce((s, r) => s + r.sessions, 0);

  const pal = palette();
  const colors = pal.channelArr;
  const labels = byChan.map((r) => r.channel || "(direct)");
  const values = byChan.map((r) => r.revenue);

  doughnutChart("chartChannelMix", labels, values, colors);

  document.getElementById("channelLegend").innerHTML = byChan.slice(0, 10).map((r, i) => {
    const revPct = totalRev ? (r.revenue / totalRev * 100) : 0;
    const sesPct = totalSess ? (r.sessions / totalSess * 100) : 0;
    return `
      <div class="legend-row">
        <span class="swatch" style="background:${colors[i % colors.length]}"></span>
        <span class="name">${esc(r.channel || "(direct)")}</span>
        <span class="value">${fmtMoney(r.revenue)}</span>
        <span class="pct">${revPct.toFixed(1)}% / 유입 ${sesPct.toFixed(1)}%</span>
      </div>
    `;
  }).join("");
}

function renderTopCampaigns(metaRows) {
  const grouped = aggregateRows(metaRows, ["campaign_name"], {
    spend: "sum", conversions: "sum", conversion_value: "sum",
    impressions: "sum", clicks: "sum",
  });
  grouped.forEach(addMetaRates);
  grouped.sort((a, b) => b.spend - a.spend);
  const top = grouped.slice(0, 6);
  const acctRoas = grouped.reduce((s, r) => s + r.conversion_value, 0) /
                   (grouped.reduce((s, r) => s + r.spend, 0) || 1);

  document.getElementById("overviewTopCampaigns").innerHTML = top.map((r) => {
    const cls = roasClass(r.roas, acctRoas);
    return `
      <tr>
        <td class="name-cell strong" title="${esc(r.campaign_name)}">${esc(r.campaign_name)}</td>
        <td class="num">${fmtMoney(r.spend)}</td>
        <td class="num">${fmtInt(r.conversions)}</td>
        <td class="num">${fmtMoney(r.conversion_value)}</td>
        <td class="num ${cls}">${fmtDecimal(r.roas)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">데이터 없음</td></tr>`;
}

function renderHeatmap(ga4Rows, metaRows) {
  // Group by day; show daily ROAS proxy
  const ga4ByDate  = new Map();
  ga4Rows.forEach((r) => {
    const t = ga4ByDate.get(r.date) || { revenue: 0, sessions: 0, purchases: 0 };
    t.revenue   += r.revenue   || 0;
    t.sessions  += r.sessions  || 0;
    t.purchases += r.purchases || 0;
    ga4ByDate.set(r.date, t);
  });
  const metaByDate = new Map();
  metaRows.forEach((r) => {
    const t = metaByDate.get(r.date) || { spend: 0 };
    t.spend += r.spend || 0;
    metaByDate.set(r.date, t);
  });

  // Collect unique dates within range
  const dates = Array.from(new Set([...ga4ByDate.keys(), ...metaByDate.keys()])).sort();
  if (!dates.length) {
    document.getElementById("overviewHeatmap").innerHTML =
      `<div style="color:var(--muted);padding:18px;text-align:center">선택 기간에 데이터가 없습니다</div>`;
    return;
  }

  // Build a Sun-Mon...Sat grid by ISO week starting Monday
  const cellByDate = new Map();
  dates.forEach((d) => {
    const ga = ga4ByDate.get(d)  || { revenue: 0, sessions: 0 };
    const mt = metaByDate.get(d) || { spend: 0 };
    const roas = mt.spend ? ga.revenue / mt.spend : null;
    cellByDate.set(d, { ...ga, ...mt, roas });
  });

  const startDate = parseLocalDate(dates[0]);
  const endDate   = parseLocalDate(dates[dates.length - 1]);
  // Snap to week start (Mon)
  const weekStart = new Date(startDate);
  const dow = weekStart.getDay() || 7; // 1..7 (Mon=1)
  weekStart.setDate(weekStart.getDate() - (dow - 1));

  const dowHeaders = ["월", "화", "수", "목", "금", "토", "일"];
  let html = `<div class="week-label"></div>` + dowHeaders.map((d) => `<div class="dow-head">${d}</div>`).join("");

  const roasValues = Array.from(cellByDate.values()).map((v) => v.roas).filter((v) => v != null && isFinite(v));
  const maxRoas = roasValues.length ? Math.max(...roasValues) : 1;
  const minRoas = roasValues.length ? Math.min(...roasValues) : 0;

  const cursor = new Date(weekStart);
  let safety = 0;
  while (cursor <= endDate && safety < 60) {
    // Week label = Mon date
    html += `<div class="week-label">${cursor.getMonth() + 1}/${cursor.getDate()}</div>`;
    for (let i = 0; i < 7; i++) {
      const iso = fmtDate(cursor);
      const inRange = iso >= state.startDate && iso <= state.endDate;
      const cell = cellByDate.get(iso);
      if (!cell || !inRange) {
        html += `<div class="heat-cell empty"><span class="hc-val">·</span></div>`;
      } else {
        const ratio = (cell.roas != null && maxRoas > minRoas)
          ? (cell.roas - minRoas) / (maxRoas - minRoas)
          : (cell.roas ? 0.5 : 0);
        const bg = heatColor(ratio, cell.roas);
        html += `
          <div class="heat-cell" style="background:${bg}" title="${iso} · 매출 ${fmtMoney(cell.revenue)} · 광고비 ${fmtMoney(cell.spend)} · ROAS ${cell.roas != null ? cell.roas.toFixed(2) : "-"}">
            <span class="hc-val">${cell.roas != null ? cell.roas.toFixed(1) : "-"}</span>
            <span class="hc-sub">${fmtCompact(cell.revenue)}</span>
          </div>
        `;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    safety++;
  }
  document.getElementById("overviewHeatmap").innerHTML = html;
}

function heatColor(ratio, roas) {
  // Lo=red, mid=warning, high=green
  const r = Math.max(0, Math.min(1, ratio));
  let alpha = 0.18 + 0.55 * r;
  if (roas == null || roas === 0) alpha = 0.06;
  if (r < 0.4)  return `rgba(220, 38, 38, ${alpha})`;
  if (r < 0.7)  return `rgba(217, 119, 6, ${alpha})`;
  return `rgba(5, 150, 105, ${alpha})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GA4 FUNNEL PAGE
// ═══════════════════════════════════════════════════════════════════════════
function renderGa4() {
  const allRows = state.data.ga4?.rows || [];
  const rows = filterByDate(allRows);
  const hasCheckout = !!state.data.ga4?.has_checkout;
  const hasCart     = !!state.data.ga4?.has_cart;

  const byPeriod = aggregateRows(rows, ["period"], {
    sessions: "sum", users: "sum", new_users: "sum",
    detail_views: "sum", cart_adds: "sum", checkout_starts: "sum",
    purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  }).sort(sortPeriodAsc);
  byPeriod.forEach(recomputeGa4Derived);

  const totals = sumFields(byPeriod,
    ["sessions", "users", "detail_views", "cart_adds", "checkout_starts",
     "purchases", "revenue", "bounce_sessions", "total_duration"]);
  recomputeGa4Derived(totals);

  const prev = previousGa4Totals();

  // Daily sparkline series (smooth, independent of state.granularity)
  const ds = dailySeries(rows, ["sessions", "detail_views", "cart_adds", "checkout_starts", "purchases", "revenue"]);

  // KPI band
  const kpis = [
    kpi("유입", totals.sessions, "Sessions", prev.sessions, fmtInt, ds.sessions, false, "primary"),
    kpi("상세조회", totals.detail_views, "view_item 세션", prev.detail_views, fmtInt, ds.detail_views, false, "primary"),
  ];
  if (hasCart)     kpis.push(kpi("장바구니", totals.cart_adds, "add_to_cart 세션", prev.cart_adds, fmtInt, ds.cart_adds, false, "primary"));
  if (hasCheckout) kpis.push(kpi("결제시작", totals.checkout_starts, "begin_checkout 세션", prev.checkout_starts, fmtInt, ds.checkout_starts, false, "primary"));
  kpis.push(
    kpi("구매", totals.purchases, "purchase 세션", prev.purchases, fmtInt, ds.purchases, false, "positive"),
    kpi("매출", totals.revenue, "Revenue", prev.revenue, fmtMoney, ds.revenue, false, "primary"),
  );
  // Pad to 6
  if (kpis.length < 6) {
    const dailyBounce = dailySeries(rows, ["bounce_rate"]);
    kpis.push(kpi("이탈률", totals.bounce_rate, "Bounce", prev.bounce_rate, fmtPct, dailyBounce.bounce_rate, true, "warning"));
  }
  renderKpis("ga4Kpis", kpis.slice(0, 6));

  // Funnel
  const steps = funnelSteps(totals, hasCart, hasCheckout);
  renderFunnel("ga4Funnel", steps, /*detailed=*/true);

  // Channel table
  renderGa4ChannelTable(rows);

  // Trend cells
  lineChartMini("chartGa4Sessions",  "ga4TSessions",  byPeriod, "sessions", fmtInt,  "primary");
  lineChartMini("chartGa4Purchases", "ga4TPurchases", byPeriod, "purchases", fmtInt, "positive");
  lineChartMini("chartGa4Revenue",   "ga4TRevenue",   byPeriod, "revenue",   fmtMoney, "primary");
  lineChartMini("chartGa4Bounce",    "ga4TBounce",    byPeriod, "bounce_rate", fmtPct, "warning");

  // Device
  renderGa4Device();

  // Landing
  renderGa4Landing();

  // Detail
  renderGa4DetailTable();
}

function renderGa4ChannelTable(rows) {
  const byChan = aggregateRows(rows, ["channel"], {
    sessions: "sum", detail_views: "sum", checkout_starts: "sum",
    purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  });
  byChan.forEach(recomputeGa4Derived);
  byChan.sort((a, b) => b.revenue - a.revenue);

  const totalSess = byChan.reduce((s, r) => s + r.sessions, 0) || 1;
  const maxSess = Math.max(...byChan.map((r) => r.sessions), 1);

  document.getElementById("ga4ChannelTable").innerHTML = byChan.slice(0, 12).map((r) => {
    const sharePct = (r.sessions / totalSess * 100).toFixed(1);
    const barPct = (r.sessions / maxSess * 100).toFixed(1);
    return `
      <tr>
        <td class="name-cell strong">${esc(r.channel || "(direct)")}</td>
        <td class="num">
          <div class="bar-cell">
            <span>${fmtInt(r.sessions)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${barPct}%"></div></div>
          </div>
        </td>
        <td class="num">${sharePct}%</td>
        <td class="num">${fmtInt(r.purchases)}</td>
        <td class="num">${fmtPct(r.purchase_rate)}</td>
        <td class="num">${fmtMoney(r.revenue)}</td>
      </tr>
    `;
  }).join("");
}

function renderGa4Device() {
  const rows = filterByDate(state.data.ga4?.device_rows || []);
  if (!rows.length) {
    document.getElementById("ga4DeviceTable").innerHTML =
      `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">기기 데이터 없음</td></tr>`;
    return;
  }

  const byDevice = aggregateRows(rows, ["device_category"], {
    sessions: "sum", users: "sum",
    detail_views: "sum", purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  }).sort((a, b) => b.sessions - a.sessions);
  byDevice.forEach(recomputeGa4Derived);

  const deviceLabels = { desktop: "데스크탑", mobile: "모바일", tablet: "태블릿" };
  const labels = byDevice.map((r) => deviceLabels[r.device_category] || r.device_category);
  doughnutChart("chartGa4Device", labels, byDevice.map((r) => r.sessions), palette().deviceArr);

  document.getElementById("ga4DeviceTable").innerHTML = byDevice.map((r) => `
    <tr>
      <td class="name-cell strong">${esc(deviceLabels[r.device_category] || r.device_category)}</td>
      <td class="num">${fmtInt(r.sessions)}</td>
      <td class="num">${fmtPct(r.purchase_rate)}</td>
      <td class="num">${fmtMoney(r.revenue)}</td>
      <td class="num">${fmtPct(r.bounce_rate)}</td>
    </tr>
  `).join("");
}

function renderGa4Landing() {
  const rows = filterByDate(state.data.ga4?.landing_rows || []);
  if (!rows.length) {
    document.getElementById("ga4LandingTable").innerHTML =
      `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">랜딩 데이터 없음</td></tr>`;
    return;
  }
  const byLanding = aggregateRows(rows, ["landing_page"], {
    sessions: "sum", users: "sum", purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  });
  byLanding.forEach((row) => {
    recomputeGa4Derived(row);
    row.purchase_rate = row.sessions ? row.purchases / row.sessions * 100 : 0;
  });

  const ss = state.sort.landing;
  byLanding.sort((a, b) => sortBy(a, b, ss.key, ss.dir));

  document.getElementById("ga4LandingTable").innerHTML = byLanding.slice(0, 50).map((r) => `
    <tr>
      <td class="name-cell" title="${esc(r.landing_page)}">${esc(r.landing_page)}</td>
      <td class="num">${fmtInt(r.sessions)}</td>
      <td class="num">${fmtPct(r.bounce_rate)}</td>
      <td class="num">${fmtPct(r.purchase_rate)}</td>
      <td class="num">${fmtMoney(r.revenue)}</td>
    </tr>
  `).join("");
}

function renderGa4DetailTable() {
  const rows = filterByDate(state.data.ga4?.rows || []);
  const grouped = aggregateRows(rows, ["period", "channel", "source", "medium", "campaign"], {
    sessions: "sum", users: "sum",
    detail_views: "sum", cart_adds: "sum", checkout_starts: "sum",
    purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  });
  grouped.forEach(recomputeGa4Derived);

  let filtered = grouped;
  if (state.ga4Search) {
    const q = state.ga4Search;
    filtered = grouped.filter((r) =>
      (r.source || "").toLowerCase().includes(q) ||
      (r.medium || "").toLowerCase().includes(q) ||
      (r.campaign || "").toLowerCase().includes(q) ||
      (r.channel || "").toLowerCase().includes(q));
  }

  const ss = state.sort.ga4Detail;
  filtered.sort((a, b) => sortBy(a, b, ss.key, ss.dir));

  document.getElementById("ga4Table").innerHTML = filtered.slice(0, 300).map((row) => `
    <tr>
      <td>${esc(row.period)}</td>
      <td>${esc(row.channel)}</td>
      <td>${esc(row.source)} / ${esc(row.medium)}</td>
      <td class="name-cell" title="${esc(row.campaign)}">${esc(row.campaign)}</td>
      <td class="num">${fmtInt(row.sessions)}</td>
      <td class="num">${fmtInt(row.detail_views)}</td>
      <td class="num">${fmtInt(row.purchases)}</td>
      <td class="num">${fmtPct(row.purchase_rate)}</td>
      <td class="num">${fmtMoney(row.revenue)}</td>
    </tr>
  `).join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// META PAGE
// ═══════════════════════════════════════════════════════════════════════════
function renderMeta() {
  const allRows = state.data.meta?.[state.metaLevel] || [];
  const rows = filterByDate(allRows);

  const byPeriod = aggregateRows(rows, ["period"], {
    impressions: "sum", reach: "sum", clicks: "sum",
    conversions: "sum", spend: "sum", conversion_value: "sum",
  }).sort(sortPeriodAsc);
  byPeriod.forEach(addMetaRates);

  const totals = sumFields(byPeriod,
    ["impressions", "reach", "clicks", "conversions", "spend", "conversion_value"]);
  addMetaRates(totals);

  const prev = previousMetaTotals();

  // Daily series for sparklines (smooth, granularity-independent)
  const ds = dailySeries(rows, ["spend", "impressions", "clicks", "conversions"]);
  const cpaSpark = dailyDerived(rows, (d) => d.conversions ? d.spend / d.conversions : 0);
  const roasSpark = dailyDerived(rows, (d) => d.spend ? d.conversion_value / d.spend : 0);

  // KPI band
  renderKpis("metaKpis", [
    kpi("광고비",  totals.spend, "Spend", prev.spend, fmtMoney, ds.spend, true, "warning"),
    kpi("노출",    totals.impressions, "Impressions", prev.impressions, fmtInt, ds.impressions, false, "primary"),
    kpi("클릭",    totals.clicks, "Clicks", prev.clicks, fmtInt, ds.clicks, false, "primary"),
    kpi("전환",    totals.conversions, "Conversions", prev.conversions, fmtInt, ds.conversions, false, "positive"),
    kpi("CPA",     totals.cpa, "Cost / Conversion", prev.cpa, fmtMoney, cpaSpark, true, "warning"),
    kpi("ROAS",    totals.roas, "Value / Spend", prev.roas, fmtDecimal, roasSpark, false, "violet"),
  ]);

  // Trend
  lineChartMini("chartMetaSpend",       "metaTSpend",       byPeriod, "spend",       fmtMoney,   "warning");
  lineChartMini("chartMetaConversions", "metaTConversions", byPeriod, "conversions", fmtInt,     "positive");
  const cpaRows = byPeriod.map((r) => ({ ...r, cpa: r.conversions ? r.spend / r.conversions : 0 }));
  lineChartMini("chartMetaCpa",  "metaTCpa",  cpaRows,  "cpa",  fmtMoney,   "warning");
  lineChartMini("chartMetaRoas", "metaTRoas", byPeriod, "roas", fmtDecimal, "violet");

  // Movers
  renderMetaMovers(allRows);

  // Placement heatmap
  renderMetaPlacementHeat();

  // Review table
  renderMetaReview();
}

function renderMetaReview() {
  const allRows = state.data.meta?.[state.metaLevel] || [];
  const rows = filterByDate(allRows);
  const keys = metaKeys(state.metaLevel);

  const curr = aggregateRows(rows, keys, {
    impressions: "sum", reach: "sum", clicks: "sum",
    conversions: "sum", spend: "sum", conversion_value: "sum",
  });
  curr.forEach(addMetaRates);
  curr.sort((a, b) => b.spend - a.spend);

  // Filter by search
  let filtered = curr;
  if (state.metaSearch) {
    const q = state.metaSearch;
    filtered = curr.filter((r) => keys.some((k) => (r[k] || "").toString().toLowerCase().includes(q)));
  }

  // Previous period
  const prevAll = filterByDateRange(allRows, ...prevPeriodWindow());
  const prevAgg = aggregateRows(prevAll, keys, {
    impressions: "sum", reach: "sum", clicks: "sum",
    conversions: "sum", spend: "sum", conversion_value: "sum",
  });
  prevAgg.forEach(addMetaRates);
  const prevMap = new Map(prevAgg.map((r) => [keys.map((k) => r[k] || "").join("||"), r]));

  // Account benchmarks
  const total = sumFields(curr, ["impressions", "clicks", "conversions", "spend", "conversion_value"]);
  addMetaRates(total);

  // Header
  document.getElementById("metaReviewTitle").textContent =
    `${metaLevelLabel(state.metaLevel)} 성과 리뷰`;

  const entityHeaders = keys.map((k) => `<th>${metaHeaderLabel(k)}</th>`).join("");
  document.getElementById("metaReviewHead").innerHTML = `
    <tr>
      ${entityHeaders}
      <th>상태</th>
      <th class="num">광고비</th>
      <th class="num">노출</th>
      <th class="num">CTR</th>
      <th class="num">전환</th>
      <th class="num">CVR</th>
      <th class="num">매출</th>
      <th class="num">CPA</th>
      <th class="num">ROAS</th>
    </tr>
  `;

  document.getElementById("metaReviewTable").innerHTML = filtered.slice(0, 80).map((row) => {
    const pk = keys.map((k) => row[k] || "").join("||");
    const p  = prevMap.get(pk);
    const status = metaStatus(row, total.roas);
    const roasCls = roasClass(row.roas, total.roas);
    const cpaCls  = cpaClass(row.cpa, total.cpa);
    const entityCells = keys.map((k) => {
      const val = row[k] || "-";
      const isName = k.endsWith("_name") || k === "placement";
      const cls = isName ? "name-cell" : "";
      return `<td class="${cls}" title="${esc(val)}">${esc(val)}</td>`;
    }).join("");

    return `
      <tr>
        ${entityCells}
        <td><span class="status-badge ${status.cls}">${status.label}</span></td>
        <td class="num">${fmtMoney(row.spend)}${p ? inlineDelta(row.spend, p.spend) : ""}</td>
        <td class="num">${fmtInt(row.impressions)}${p ? inlineDelta(row.impressions, p.impressions) : ""}</td>
        <td class="num">${fmtPct(row.ctr)}${p ? inlineDelta(row.ctr, p.ctr, true) : ""}</td>
        <td class="num">${fmtInt(row.conversions)}${p ? inlineDelta(row.conversions, p.conversions) : ""}</td>
        <td class="num">${fmtPct(row.cvr)}${p ? inlineDelta(row.cvr, p.cvr, true) : ""}</td>
        <td class="num">${fmtMoney(row.conversion_value)}${p ? inlineDelta(row.conversion_value, p.conversion_value) : ""}</td>
        <td class="num ${cpaCls}">${row.cpa ? fmtMoney(row.cpa) : "-"}${p && p.cpa && row.cpa ? inlineDelta(row.cpa, p.cpa) : ""}</td>
        <td class="num ${roasCls}">${fmtDecimal(row.roas)}${p ? inlineDelta(row.roas, p.roas, true) : ""}</td>
      </tr>
    `;
  }).join("");
}

function renderMetaMovers(allRows) {
  const keys = ["campaign_name"];
  const current = aggregateRows(filterByDate(allRows), keys, { spend: "sum", conversions: "sum", conversion_value: "sum" });
  const prev    = aggregateRows(filterByDateRange(allRows, ...prevPeriodWindow()), keys, { spend: "sum", conversions: "sum", conversion_value: "sum" });
  const prevMap = new Map(prev.map((r) => [r.campaign_name, r]));

  const movers = current.map((r) => {
    const p = prevMap.get(r.campaign_name) || { spend: 0, conversions: 0, conversion_value: 0 };
    const diff = r.spend - p.spend;
    const pct = p.spend ? (diff / p.spend) * 100 : (r.spend > 0 ? 100 : 0);
    return { ...r, prev: p, diff, pct };
  }).filter((r) => r.spend > 0 || r.prev.spend > 0);

  movers.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const top = movers.slice(0, 6);

  document.getElementById("metaMovers").innerHTML = top.map((r) => `
    <div class="mover ${r.diff > 0 ? "up" : r.diff < 0 ? "down" : ""}">
      <div>
        <div class="mover-name" title="${esc(r.campaign_name)}">${esc(r.campaign_name)}</div>
        <div class="mover-meta">현재 ${fmtMoney(r.spend)} · 전기 ${fmtMoney(r.prev.spend)}</div>
      </div>
      <div class="mover-current">${fmtInt(r.conversions)} 전환</div>
      <div class="mover-delta">${r.diff > 0 ? "▲" : r.diff < 0 ? "▼" : "—"} ${Math.abs(r.pct).toFixed(0)}%</div>
    </div>
  `).join("") || `<div style="color:var(--muted);padding:14px;text-align:center">전기간 비교 데이터 부족</div>`;
}

function renderMetaPlacementHeat() {
  const rows = filterByDate(state.data.meta?.placements || []);
  if (!rows.length) {
    document.getElementById("metaPlacementHeat").innerHTML =
      `<div style="color:var(--muted);padding:18px;text-align:center">지면 데이터 없음</div>`;
    return;
  }

  // Aggregate by platform × position
  const byPlatPos = new Map();
  const platforms = new Set();
  const positions = new Set();
  rows.forEach((r) => {
    const key = `${r.publisher_platform}||${r.platform_position}`;
    const t = byPlatPos.get(key) || {
      publisher_platform: r.publisher_platform, platform_position: r.platform_position,
      impressions: 0, clicks: 0, spend: 0, conversions: 0, conversion_value: 0,
    };
    t.impressions      += r.impressions      || 0;
    t.clicks           += r.clicks           || 0;
    t.spend            += r.spend            || 0;
    t.conversions      += r.conversions      || 0;
    t.conversion_value += r.conversion_value || 0;
    byPlatPos.set(key, t);
    platforms.add(r.publisher_platform);
    positions.add(r.platform_position);
  });
  byPlatPos.forEach((v) => addMetaRates(v));

  const platArr = Array.from(platforms).sort();
  const posArr  = Array.from(positions).sort();

  // Build per-platform grid (only positions used by that platform)
  const allRoas = Array.from(byPlatPos.values()).filter((v) => v.spend > 0 && v.roas > 0).map((v) => v.roas);
  const maxR = allRoas.length ? Math.max(...allRoas) : 0;
  const minR = allRoas.length ? Math.min(...allRoas) : 0;

  const platformLabel = (p) => ({
    facebook: "Facebook", instagram: "Instagram", audience_network: "AN", messenger: "Messenger"
  }[p] || p);
  const positionLabel = (p) => p.replace(/_/g, " ");

  let html = "";
  platArr.forEach((plat) => {
    const positionsForPlat = posArr.filter((pos) => byPlatPos.has(`${plat}||${pos}`));
    if (!positionsForPlat.length) return;
    const cols = positionsForPlat.length;
    html += `<div class="placement-row" style="grid-template-columns:100px repeat(${cols}, minmax(0,1fr));--cols:${cols}">`;
    html += `<div class="platform-label">${esc(platformLabel(plat))}</div>`;
    positionsForPlat.forEach((pos) => {
      const v = byPlatPos.get(`${plat}||${pos}`);
      if (!v || !v.spend) {
        html += `<div class="placement-cell empty">
          <div class="pos-name">${esc(positionLabel(pos))}</div>
          <div><div class="pos-val">-</div></div>
        </div>`;
      } else {
        const ratio = (maxR > minR) ? (v.roas - minR) / (maxR - minR) : 0.5;
        const bg = heatColor(ratio, v.roas);
        html += `<div class="placement-cell" style="background:${bg}" title="${esc(plat)} / ${esc(pos)}: ROAS ${v.roas.toFixed(2)}, 광고비 ${fmtMoney(v.spend)}">
          <div class="pos-name">${esc(positionLabel(pos))}</div>
          <div>
            <div class="pos-val">${v.roas.toFixed(2)}</div>
            <div class="pos-spend">${fmtCompact(v.spend)} · ${fmtInt(v.conversions)}전환</div>
          </div>
        </div>`;
      }
    });
    html += `</div>`;
  });

  html += `<div class="placement-legend"><span>낮음</span><span class="heat-scale"></span><span>높음 (ROAS)</span></div>`;
  document.getElementById("metaPlacementHeat").innerHTML = html;
}

function metaStatus(row, acctRoas) {
  if (!row.spend && !row.conversions) return { label: "데이터 없음", cls: "status-off" };
  if (acctRoas <= 0) return row.conversions > 0
    ? { label: "모니터링", cls: "status-warn" }
    : { label: "리뷰 필요", cls: "status-bad" };
  if (row.roas >= acctRoas * 1.2) return { label: "확장 고려", cls: "status-good" };
  if (row.roas >= acctRoas * 0.7) return { label: "모니터링",  cls: "status-warn" };
  return { label: "리뷰 필요", cls: "status-bad" };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHANNELS PAGE
// ═══════════════════════════════════════════════════════════════════════════
function renderChannels() {
  const ga4Rows  = filterByDate(state.data.ga4?.rows || []);
  const metaRows = filterByDate(state.data.meta?.campaigns || []);

  const byChan = aggregateRows(ga4Rows, ["channel"], {
    sessions: "sum", purchases: "sum", revenue: "sum",
  }).sort((a, b) => b.revenue - a.revenue);

  const metaTotal = sumFields(metaRows, ["spend", "conversions", "conversion_value"]);
  const ga4Total = sumFields(byChan, ["sessions", "purchases", "revenue"]);
  const blendedRoas = metaTotal.spend ? ga4Total.revenue / metaTotal.spend : 0;
  const blendedCac  = ga4Total.purchases ? metaTotal.spend / ga4Total.purchases : 0;

  // KPI
  renderKpis("channelsKpis", [
    kpi("총 매출",  ga4Total.revenue, "GA4 합산", null, fmtMoney, [], false, "primary"),
    kpi("총 광고비", metaTotal.spend,  "Meta",     null, fmtMoney, [], true,  "warning"),
    kpi("블렌디드 ROAS", blendedRoas, "Revenue/Spend", null, fmtDecimal, [], false, "violet"),
    kpi("총 구매",  ga4Total.purchases, "Purchases", null, fmtInt,    [], false, "positive"),
    kpi("블렌디드 CAC", blendedCac, "Spend/Purchase", null, fmtMoney, [], true,  "warning"),
    kpi("채널 수",  byChan.length, "Active", null, fmtInt, [], false, "primary"),
  ]);

  // Bar chart: revenue per channel + sessions share line
  destroyChart("chartChannelsBars");
  const canvas = document.getElementById("chartChannelsBars");
  if (canvas) {
    const labels = byChan.map((r) => r.channel || "(direct)");
    const totalSess = ga4Total.sessions || 1;
    const sessSharePct = byChan.map((r) => +(r.sessions / totalSess * 100).toFixed(1));
    const pal = palette();
    state.charts.chartChannelsBars = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          { type: "bar",  label: "매출",       data: byChan.map((r) => r.revenue),
            backgroundColor: pal.primary, borderRadius: 4, maxBarThickness: 38, yAxisID: "y" },
          { type: "line", label: "유입 비중 (%)", data: sessSharePct,
            borderColor: pal.violet, backgroundColor: pal.violet, tension: 0.3,
            pointRadius: 4, pointBackgroundColor: pal.violet, borderWidth: 2,
            yAxisID: "y1" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "top", align: "end",
            labels: { boxWidth: 8, boxHeight: 8, padding: 14, usePointStyle: true, font: { size: 11, weight: "600" } } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.dataset.yAxisID === "y1" ? fmtPct(ctx.raw) : fmtMoney(ctx.raw)}` } },
        },
        scales: {
          x: { grid: { display: false } },
          y:  { position: "left",  grid: { color: pal.grid }, border: { display: false },
                ticks: { callback: (v) => fmtMoney(v) } },
          y1: { position: "right", grid: { display: false }, border: { display: false },
                ticks: { callback: (v) => fmtPct(v) }, suggestedMax: Math.max(...sessSharePct) * 1.4 },
        },
      },
    });
  }

  // Table
  const totalSess = byChan.reduce((s, r) => s + r.sessions, 0) || 1;
  const totalRev = byChan.reduce((s, r) => s + r.revenue, 0) || 1;
  document.getElementById("channelsTable").innerHTML = byChan.map((r) => {
    const aov = r.purchases ? r.revenue / r.purchases : 0;
    const pRate = r.sessions ? (r.purchases / r.sessions) * 100 : 0;
    return `
      <tr>
        <td class="name-cell strong">${esc(r.channel || "(direct)")}</td>
        <td class="num">${fmtInt(r.sessions)}</td>
        <td class="num">${(r.sessions / totalSess * 100).toFixed(1)}%</td>
        <td class="num">${fmtInt(r.purchases)}</td>
        <td class="num">${fmtPct(pRate)}</td>
        <td class="num">${fmtMoney(r.revenue)}</td>
        <td class="num">${(r.revenue / totalRev * 100).toFixed(1)}%</td>
        <td class="num">${fmtMoney(aov)}</td>
      </tr>
    `;
  }).join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// Reusable: KPIs, Funnel, Charts
// ═══════════════════════════════════════════════════════════════════════════

function kpi(label, value, helper, previous, formatter, sparkPoints, lowerIsBetter = false, color = "primary") {
  return { label, value, helper, previous, formatter, sparkPoints, lowerIsBetter, color };
}

function renderKpis(containerId, items) {
  const el = document.getElementById(containerId);
  el.innerHTML = items.map((item) => {
    const deltaHtml = state.compare ? deltaBlock(item.value, item.previous, false, item.lowerIsBetter) : "";
    const sparkHtml = sparklineSvg(item.sparkPoints, item.color);
    return `
      <article class="kpi">
        <div class="kpi-label">
          <span class="kpi-icon" style="background:var(--${item.color}-soft);color:var(--${item.color})">${kpiIcon()}</span>
          ${esc(item.label)}
        </div>
        <div class="kpi-value">${esc(item.formatter(item.value))}</div>
        <div class="kpi-meta">
          <span>${esc(item.helper)}</span>
          ${deltaHtml}
        </div>
        ${sparkHtml}
      </article>
    `;
  }).join("");
}

function kpiIcon() {
  // Tiny generic icon (varies via background color)
  return `<svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor"><circle cx="5" cy="5" r="2.5"/></svg>`;
}

function sparklineSvg(values, colorKey = "primary") {
  if (!values || !values.length) return `<svg class="kpi-sparkline" viewBox="0 0 160 32" aria-hidden="true"></svg>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 160, H = 32, pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + i * ((W - pad * 2) / Math.max(values.length - 1, 1));
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `0,${H} ${pts} ${W},${H}`;
  return `
    <svg class="kpi-sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${area}" fill="var(--${colorKey}-soft)"></polygon>
      <polyline points="${pts}" fill="none" stroke="var(--${colorKey})" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"></polyline>
    </svg>
  `;
}

function metricsSparkline(rows, key) {
  return rows.map((r) => Number(r[key] || 0));
}

// Aggregate by calendar date (independent of state.granularity) so sparklines
// always render as smooth daily series rather than dramatic 3-point lines.
function dailySeries(rows, metrics) {
  const byDate = new Map();
  rows.forEach((r) => {
    if (!r.date) return;
    const t = byDate.get(r.date) || {};
    metrics.forEach((m) => { t[m] = (t[m] || 0) + Number(r[m] || 0); });
    byDate.set(r.date, t);
  });
  const dates = Array.from(byDate.keys()).sort();
  const out = {};
  metrics.forEach((m) => { out[m] = dates.map((d) => byDate.get(d)[m] || 0); });
  return out;
}

// Daily derived series (e.g. CPA, ROAS) — accepts a fn that takes a daily-sum
// row and returns a derived number.
function dailyDerived(rows, deriveFn) {
  const byDate = new Map();
  rows.forEach((r) => {
    if (!r.date) return;
    const t = byDate.get(r.date) || {};
    Object.keys(r).forEach((k) => {
      if (typeof r[k] === "number") t[k] = (t[k] || 0) + r[k];
    });
    byDate.set(r.date, t);
  });
  const dates = Array.from(byDate.keys()).sort();
  return dates.map((d) => deriveFn(byDate.get(d) || {}) || 0);
}

// Daily blended ROAS / CAC arrays combining GA4 + Meta
function blendedSparkSeries(ga4Rows, metaRows) {
  const ga = new Map();
  ga4Rows.forEach((r) => {
    if (!r.date) return;
    const t = ga.get(r.date) || { revenue: 0, purchases: 0 };
    t.revenue += r.revenue || 0;
    t.purchases += r.purchases || 0;
    ga.set(r.date, t);
  });
  const me = new Map();
  metaRows.forEach((r) => {
    if (!r.date) return;
    const t = me.get(r.date) || { spend: 0 };
    t.spend += r.spend || 0;
    me.set(r.date, t);
  });
  const dates = Array.from(new Set([...ga.keys(), ...me.keys()])).sort();
  const roas = [], cac = [];
  dates.forEach((d) => {
    const g = ga.get(d) || { revenue: 0, purchases: 0 };
    const m = me.get(d) || { spend: 0 };
    roas.push(m.spend ? g.revenue / m.spend : 0);
    cac.push(g.purchases ? m.spend / g.purchases : 0);
  });
  return { roas, cac };
}

// ── Funnel ───────────────────────────────────────────────────────────────────
function funnelSteps(totals, hasCart, hasCheckout) {
  const steps = [
    ["유입",       totals.sessions, null],
    ["상세조회",   totals.detail_views, totals.sessions],
  ];
  if (hasCart && totals.cart_adds > 0) {
    steps.push(["장바구니", totals.cart_adds, totals.detail_views]);
  }
  if (hasCheckout && totals.checkout_starts > 0) {
    steps.push(["결제 시작", totals.checkout_starts, steps[steps.length - 1][1]]);
  }
  steps.push(["구매 완료", totals.purchases, steps[steps.length - 1][1]]);
  return steps;
}

function renderFunnel(id, steps, detailed = false) {
  const maxVal = Math.max(...steps.map((s) => Number(s[1] || 0)), 1);
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.className = "funnel" + (detailed ? " funnel-detailed" : "");
  wrap.innerHTML = steps.map(([label, value, fromValue], i) => {
    const w = Math.max(Number(value || 0) / maxVal * 100, 1);
    let arrow = "";
    if (i > 0 && fromValue) {
      const rate = (Number(value || 0) / fromValue * 100);
      const drop = 100 - rate;
      arrow = `<div class="funnel-arrow"><span class="conv-rate">${rate.toFixed(1)}% 전환</span>${drop > 0 ? `<span class="drop">−${drop.toFixed(1)}% 이탈</span>` : ""}</div>`;
    }
    return `
      ${arrow}
      <div class="funnel-step">
        <div class="funnel-head">
          <span class="funnel-name">${esc(label)}</span>
          <span class="funnel-value">${fmtInt(value)}</span>
        </div>
        <div class="funnel-track"><div class="funnel-fill" style="width:${w}%"></div></div>
      </div>
    `;
  }).join("");
}

// ── Chart helpers ────────────────────────────────────────────────────────────
function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

function lineDs(label, data, color, fill, yAxisID = "y") {
  return {
    label, data,
    borderColor: color,
    backgroundColor: fill,
    fill: true,
    tension: 0.32,
    pointRadius: data.length <= 14 ? 3 : 0,
    pointHoverRadius: 5,
    pointBackgroundColor: color,
    borderWidth: 2,
    yAxisID,
  };
}

function lineChartMini(canvasId, latestId, rows, valueKey, formatter, colorKey) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !rows.length) {
    if (latestId) {
      const el = document.getElementById(latestId);
      if (el) el.textContent = "-";
    }
    return;
  }
  const pal = palette();
  const color = pal[colorKey] || pal.primary;
  const fill  = pal[`${colorKey}Soft`] || pal.primarySoft;
  const latest = rows[rows.length - 1];
  if (latestId) {
    const el = document.getElementById(latestId);
    if (el) el.textContent = latest ? formatter(latest[valueKey]) : "-";
  }
  const values = rows.map((r) => Number(r[valueKey] || 0));
  const labels = rows.map((r) => r.period);

  state.charts[canvasId] = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: fill,
        fill: true,
        tension: 0.32,
        pointRadius: rows.length <= 14 ? 2.5 : 0,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: { callbacks: { label: (ctx) => ` ${formatter(ctx.raw)}` } },
      },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: false },
      },
    },
  });
}

function doughnutChart(canvasId, labels, data, colors) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const total = data.reduce((s, v) => s + v, 0);
  state.charts[canvasId] = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data, backgroundColor: colors,
        borderWidth: 2,
        borderColor: palette().surface,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtInt(ctx.raw)} (${(ctx.raw / total * 100).toFixed(1)}%)` } },
      },
    },
  });
}

// ── Aggregation & helpers ────────────────────────────────────────────────────
function aggregateRows(rows, keys, metrics) {
  const map = new Map();
  rows.forEach((raw) => {
    const row = { ...raw, period: periodKey(raw.date) };
    const k = keys.map((f) => row[f] || "").join("||");
    if (!map.has(k)) {
      const base = {};
      keys.forEach((f) => { base[f] = row[f] || ""; });
      Object.keys(metrics).forEach((m) => { base[m] = 0; });
      map.set(k, base);
    }
    const target = map.get(k);
    Object.keys(metrics).forEach((m) => { target[m] += Number(row[m] || 0); });
  });
  return Array.from(map.values());
}

function sumFields(rows, fields) {
  const out = {};
  fields.forEach((f) => { out[f] = rows.reduce((s, r) => s + Number(r[f] || 0), 0); });
  return out;
}

function recomputeGa4Derived(row) {
  const s = row.sessions || 0;
  row.bounce_rate              = s ? (row.bounce_sessions || 0) / s * 100 : 0;
  row.avg_session_duration     = s ? (row.total_duration  || 0) / s : 0;
  row.detail_view_rate         = s ? (row.detail_views    || 0) / s * 100 : 0;
  row.cart_rate                = s ? (row.cart_adds       || 0) / s * 100 : 0;
  row.checkout_rate            = s ? (row.checkout_starts || 0) / s * 100 : 0;
  row.purchase_rate            = s ? (row.purchases       || 0) / s * 100 : 0;
  row.detail_to_purchase_rate  = row.detail_views   ? (row.purchases || 0) / row.detail_views   * 100 : 0;
  row.checkout_to_purchase_rate = row.checkout_starts ? (row.purchases || 0) / row.checkout_starts * 100 : 0;
  row.aov                      = row.purchases ? (row.revenue || 0) / row.purchases : 0;
}

function addMetaRates(row) {
  const imp  = row.impressions  || 0;
  const clk  = row.clicks       || 0;
  const conv = row.conversions  || 0;
  const sp   = row.spend        || 0;
  const cv   = row.conversion_value || 0;
  row.ctr  = imp  ? clk  / imp  * 100 : 0;
  row.cvr  = clk  ? conv / clk  * 100 : 0;
  row.cpc  = clk  ? sp   / clk       : 0;
  row.cpa  = conv ? sp   / conv      : 0;
  row.roas = sp   ? cv   / sp        : 0;
  row.cpm  = imp  ? sp   / imp * 1000 : 0;
}

function filterByDate(rows) {
  return rows.filter((r) => {
    const d = r.date;
    return (!state.startDate || d >= state.startDate) &&
           (!state.endDate   || d <= state.endDate);
  });
}
function filterByDateRange(rows, startDate, endDate) {
  return rows.filter((r) => {
    const d = r.date;
    return (!startDate || d >= startDate) && (!endDate || d <= endDate);
  });
}

function prevPeriodWindow() {
  if (!state.startDate || !state.endDate) return [null, null];
  const start = parseLocalDate(state.startDate);
  const end   = parseLocalDate(state.endDate);
  const days  = Math.round((end - start) / 86400000) + 1;
  const prevEnd   = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);
  return [fmtDate(prevStart), fmtDate(prevEnd)];
}

function previousGa4Totals() {
  if (!state.compare) return {};
  const [s, e] = prevPeriodWindow();
  if (!s) return {};
  const rows = filterByDateRange(state.data.ga4?.rows || [], s, e);
  const totals = sumFields(rows, [
    "sessions", "users", "new_users", "detail_views", "cart_adds",
    "checkout_starts", "purchases", "revenue", "bounce_sessions", "total_duration",
  ]);
  recomputeGa4Derived(totals);
  return totals;
}

function previousMetaTotals() {
  if (!state.compare) return {};
  const [s, e] = prevPeriodWindow();
  if (!s) return {};
  const rows = filterByDateRange(state.data.meta?.campaigns || [], s, e);
  const totals = sumFields(rows, ["impressions", "reach", "clicks", "conversions", "spend", "conversion_value"]);
  addMetaRates(totals);
  return totals;
}

function previousPeriodTotals() {
  if (!state.compare) return { revenue: 0, spend: 0, sessions: 0, purchases: 0 };
  const g = previousGa4Totals();
  const m = previousMetaTotals();
  return {
    revenue: g.revenue || 0,
    sessions: g.sessions || 0,
    purchases: g.purchases || 0,
    spend: m.spend || 0,
  };
}

function periodKey(dateValue) {
  if (!dateValue) return "";
  if (state.granularity === "day") return dateValue;
  const d = parseLocalDate(dateValue);
  if (state.granularity === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const mon = new Date(d);
  const day = mon.getDay() || 7;
  mon.setDate(mon.getDate() - day + 1);
  return `${mon.getFullYear()}-W${weekNum(mon)}`;
}
function weekNum(date) {
  const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return String(Math.ceil(((t - ys) / 86400000 + 1) / 7)).padStart(2, "0");
}
function sortPeriodAsc(a, b) { return a.period.localeCompare(b.period); }
function sortBy(a, b, key, dir) {
  const av = Number(a[key]); const bv = Number(b[key]);
  const aN = isFinite(av); const bN = isFinite(bv);
  if (aN && bN) return dir === "asc" ? av - bv : bv - av;
  const sa = String(a[key] || ""); const sb = String(b[key] || "");
  return dir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
}

// ── Meta key helpers ─────────────────────────────────────────────────────────
function metaKeys(level) {
  if (level === "campaigns") return ["campaign_name"];
  if (level === "adsets")    return ["campaign_name", "adset_name"];
  if (level === "ads")       return ["campaign_name", "adset_name", "ad_name"];
  return ["campaign_name", "adset_name", "ad_name", "placement"];
}
function metaHeaderLabel(key) {
  return { campaign_name: "캠페인", adset_name: "광고세트", ad_name: "광고", placement: "지면" }[key] || key;
}
function metaLevelLabel(level) {
  return { campaigns: "캠페인", adsets: "광고세트", ads: "광고", placements: "지면" }[level] || level;
}

// ── Class helpers ───────────────────────────────────────────────────────────
function roasClass(value, benchmark) {
  if (benchmark <= 0) return "";
  if (value >= benchmark * 1.1) return "cell-good";
  if (value >= benchmark * 0.7) return "cell-warn";
  return "cell-bad";
}
function cpaClass(value, benchmark) {
  if (benchmark <= 0 || value <= 0) return "";
  if (value <= benchmark * 0.9) return "cell-good";
  if (value <= benchmark * 1.3) return "cell-warn";
  return "cell-bad";
}

// ── Delta ────────────────────────────────────────────────────────────────────
function deltaBlock(current, previous, pointDiff = false, lowerIsBetter = false) {
  if (previous == null || Number(previous) === 0) return `<span class="delta flat">—</span>`;
  const diff = Number(current || 0) - Number(previous || 0);
  const pct  = diff / Math.abs(Number(previous)) * 100;
  const isGood = lowerIsBetter ? diff <= 0 : diff >= 0;
  const cls = diff === 0 ? "flat" : isGood ? "up" : "down";
  const txt = pointDiff
    ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`
    : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
  return `<span class="delta ${cls}">${txt}</span>`;
}
function inlineDelta(current, previous, pointDiff = false) {
  if (previous == null || Number(previous) === 0) return "";
  const diff = Number(current || 0) - Number(previous || 0);
  const pct  = diff / Math.abs(Number(previous)) * 100;
  const cls  = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const txt  = pointDiff
    ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`
    : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
  return `<span class="delta-inline ${cls}">${txt}</span>`;
}

// ── Sort icons ───────────────────────────────────────────────────────────────
function applySortIcons() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    const scope = th.dataset.sortScope || "default";
    const ss = state.sort[scope];
    th.classList.remove("sort-asc", "sort-desc");
    if (ss && th.dataset.sortKey === ss.key) {
      th.classList.add(ss.dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

// ── Formatters ───────────────────────────────────────────────────────────────
function fmtInt(v)      { return Math.round(Number(v || 0)).toLocaleString("ko-KR"); }
function fmtMoney(v)    { return `₩${Math.round(Number(v || 0)).toLocaleString("ko-KR")}`; }
function fmtPct(v)      { return `${Number(v || 0).toFixed(1)}%`; }
function fmtDecimal(v)  { return Number(v || 0).toFixed(2); }
function fmtCompact(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e8) return `₩${(n/1e8).toFixed(1)}억`;
  if (Math.abs(n) >= 1e4) return `₩${(n/1e4).toFixed(1)}만`;
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function fmtGeneratedAt(v) { return v ? new Date(v).toLocaleString("ko-KR") : "-"; }
function parseLocalDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function gLabel() {
  return { day: "일별", week: "주별", month: "월별" }[state.granularity] || state.granularity;
}
function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function kstYesterdayISO() {
  // KST = UTC+9
  const now = new Date();
  const ms = now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60 * 1000;
  const kst = new Date(ms);
  kst.setDate(kst.getDate() - 1);
  return `${kst.getFullYear()}-${String(kst.getMonth()+1).padStart(2,"0")}-${String(kst.getDate()).padStart(2,"0")}`;
}

// ── Boot ─────────────────────────────────────────────────────────────────────
init();

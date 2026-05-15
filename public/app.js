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
  // Overview controls
  trendMode: "absolute",     // "absolute" | "share" (유입/구매 차트에만 적용)
  heatmapMetric: "roas",     // "roas" | "revenue" | "cvr"
  heatmapCampaign: "",       // "" = 전체, else campaign_name
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

  document.querySelectorAll("[data-trend-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.trendMode = btn.dataset.trendMode;
      setActive("[data-trend-mode]", btn);
      renderOverview();
    });
  });

  document.querySelectorAll("[data-heatmap-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.heatmapMetric = btn.dataset.heatmapMetric;
      setActive("[data-heatmap-metric]", btn);
      renderOverview();
    });
  });

  const heatmapCampaign = document.getElementById("heatmapCampaign");
  if (heatmapCampaign) {
    heatmapCampaign.addEventListener("change", (e) => {
      state.heatmapCampaign = e.target.value;
      renderOverview();
    });
  }

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyPreset(btn.dataset.preset);
      setActive("[data-preset]", btn);
    });
  });

  ["input", "change"].forEach((evt) => {
    document.getElementById("startDate").addEventListener(evt, (e) => {
      if (!e.target.value) return;
      state.startDate = e.target.value;
      clearPresetActive();
      render();
    });
    document.getElementById("endDate").addEventListener(evt, (e) => {
      if (!e.target.value) return;
      state.endDate = e.target.value;
      clearPresetActive();
      render();
    });
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

  // ── KPI 단위 비교: 현재 1단위(일/주/월) vs 직전 1단위 ─────────────────────
  const [curS, curE] = currentUnitWindow();
  const [prvS, prvE] = previousUnitWindow();
  const ga4Curr  = unitGa4Totals(curS, curE);
  const ga4Prev  = unitGa4Totals(prvS, prvE);
  const metaCurr = unitMetaTotals(curS, curE);
  const metaPrev = unitMetaTotals(prvS, prvE);

  // Period label
  const curLabel = curS && curE ? (curS === curE ? curS : `${curS} → ${curE}`) : "-";
  const prvLabel = prvS && prvE ? (prvS === prvE ? prvS : `${prvS} → ${prvE}`) : "-";
  document.getElementById("overviewPeriodLabel").textContent =
    `KPI: ${curLabel} (${unitLabel()}) vs ${prvLabel} (${unitDeltaLabel()}) · 시계열/표/히트맵: ${state.startDate} → ${state.endDate}`;

  // Daily sparkline series (date-range 컨텍스트)
  const dailyGa4  = dailySeries(ga4Rows, ["revenue", "purchases", "sessions", "detail_views", "cart_adds", "checkout_starts"]);
  const dailyMeta = dailySeries(metaRows, ["spend"]);
  const blendedSeries = blendedSparkSeries(ga4Rows, metaRows);

  // ── KPI 1행: 퍼널 순서 ────────────────────────────────────────────────────
  const hasCart     = !!state.data.ga4?.has_cart;
  const hasCheckout = !!state.data.ga4?.has_checkout;
  const unitTag = formatUnitTag(curS, curE);
  const funnelKpis = [
    kpi("유입",     ga4Curr.sessions,      `Sessions · ${unitTag}`,      ga4Prev.sessions,      fmtInt,   dailyGa4.sessions,      false, "primary"),
    kpi("상세조회", ga4Curr.detail_views,  `view_item · ${unitTag}`,     ga4Prev.detail_views,  fmtInt,   dailyGa4.detail_views,  false, "primary"),
  ];
  if (hasCart)     funnelKpis.push(kpi("장바구니", ga4Curr.cart_adds,       `add_to_cart · ${unitTag}`,     ga4Prev.cart_adds,       fmtInt, dailyGa4.cart_adds,       false, "primary"));
  if (hasCheckout) funnelKpis.push(kpi("결제시작", ga4Curr.checkout_starts, `begin_checkout · ${unitTag}`,  ga4Prev.checkout_starts, fmtInt, dailyGa4.checkout_starts, false, "primary"));
  funnelKpis.push(
    kpi("구매",  ga4Curr.purchases, `Purchases · ${unitTag}`, ga4Prev.purchases, fmtInt,   dailyGa4.purchases, false, "positive"),
    kpi("매출",  ga4Curr.revenue,   `Revenue · ${unitTag}`,   ga4Prev.revenue,   fmtMoney, dailyGa4.revenue,   false, "primary"),
  );
  renderKpis("overviewKpis", funnelKpis.slice(0, 6));

  // ── KPI 2행: 효율 (광고비 / 블렌디드 ROAS / 블렌디드 CAC) ─────────────────
  const blendedRoasC = metaCurr.spend ? ga4Curr.revenue / metaCurr.spend : 0;
  const blendedRoasP = metaPrev.spend ? ga4Prev.revenue / metaPrev.spend : 0;
  const blendedCacC  = ga4Curr.purchases ? metaCurr.spend / ga4Curr.purchases : 0;
  const blendedCacP  = ga4Prev.purchases ? metaPrev.spend / ga4Prev.purchases : 0;
  renderKpis("overviewEffKpis", [
    kpi("광고비",         metaCurr.spend, `Meta Spend · ${unitTag}`,     metaPrev.spend, fmtMoney,   dailyMeta.spend,    true,  "warning"),
    kpi("블렌디드 ROAS",  blendedRoasC,   `Revenue/Spend · ${unitTag}`,  blendedRoasP,   fmtDecimal, blendedSeries.roas, false, "violet"),
    kpi("블렌디드 CAC",   blendedCacC,    `Spend/Purchase · ${unitTag}`, blendedCacP,    fmtMoney,   blendedSeries.cac,  true,  "warning"),
  ]);

  // ── 퍼널 (선택 기간 합산) ─────────────────────────────────────────────────
  const ga4Total = sumFields(ga4Rows,
    ["sessions", "users", "detail_views", "cart_adds", "checkout_starts",
     "purchases", "revenue", "bounce_sessions", "total_duration"]);
  recomputeGa4Derived(ga4Total);
  const steps = funnelSteps(ga4Total, hasCart, hasCheckout);
  renderFunnel("overviewFunnel", steps);

  // Top campaigns
  renderTopCampaigns(metaRows);

  // 유입 · 구매 · 구매율 시계열 (채널 분해, 공통 범례·토글)
  renderOverviewTrends(ga4Rows);

  // 채널 드릴다운 테이블
  renderOverviewChannelTable(ga4Rows);

  // 히트맵 (메트릭 + 캠페인 셀렉터)
  populateHeatmapCampaignSelect(state.data.meta?.campaigns || []);
  renderHeatmap(ga4Rows, metaRows);
}

// ── 채널 분해 시계열 (유입·구매·구매율 3개를 한 카드에) ─────────────────────
function renderOverviewTrends(ga4Rows) {
  // 공통 채널 셋 — 유입 기준 상위 6 + 기타
  const channelTotals = new Map();
  ga4Rows.forEach((r) => {
    const ch = r.channel || "(direct)";
    channelTotals.set(ch, (channelTotals.get(ch) || 0) + (r.sessions || 0));
  });
  const topChannels = Array.from(channelTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([ch]) => ch);
  const hasOthers = channelTotals.size > topChannels.length;
  const allChannels = hasOthers ? [...topChannels, "기타"] : topChannels;

  const pal = palette();
  const colors = pal.channelArr;
  const colorOf = (ch, i) => (ch === "기타" ? "#94A3B8" : colors[i % colors.length]);

  // 공통 범례 렌더링
  const legendEl = document.getElementById("overviewTrendLegend");
  if (legendEl) {
    legendEl.innerHTML = allChannels.map((ch, i) =>
      `<span class="trend-legend-item"><span class="swatch" style="background:${colorOf(ch, i)}"></span>${esc(ch)}</span>`
    ).join("");
  }

  // 채널×기간 집계 (한 번만 계산해서 3개 차트에 공유)
  const grouped = aggregateRows(ga4Rows, ["period", "channel"], {
    sessions: "sum", purchases: "sum",
  });
  const periods = Array.from(new Set(grouped.map((r) => r.period))).sort();
  const byKey = new Map();
  grouped.forEach((r) => {
    byKey.set(`${r.period}||${r.channel || "(direct)"}`, r);
  });
  // 기타 합산
  const otherByPeriod = new Map(periods.map((p) => [p, { sessions: 0, purchases: 0 }]));
  if (hasOthers) {
    grouped.forEach((r) => {
      const ch = r.channel || "(direct)";
      if (topChannels.includes(ch)) return;
      const t = otherByPeriod.get(r.period);
      t.sessions += r.sessions || 0;
      t.purchases += r.purchases || 0;
    });
  }

  const cellOf = (period, channel) => {
    if (channel === "기타") return otherByPeriod.get(period) || { sessions: 0, purchases: 0 };
    return byKey.get(`${period}||${channel}`) || { sessions: 0, purchases: 0 };
  };

  renderChannelChart("chartOverviewTraffic",  periods, allChannels, colorOf, state.trendMode,
    (cell) => cell.sessions || 0, fmtInt, /*shareable*/ true);
  renderChannelChart("chartOverviewPurchase", periods, allChannels, colorOf, state.trendMode,
    (cell) => cell.purchases || 0, fmtInt, /*shareable*/ true);
  // 구매율은 비중 모드 무시 (라인 유지)
  renderChannelChart("chartOverviewCvr",      periods, allChannels, colorOf, "absolute",
    (cell) => cell.sessions ? (cell.purchases || 0) / cell.sessions * 100 : 0,
    (v) => `${Number(v).toFixed(1)}%`, /*shareable*/ false);

  function renderChannelChart(canvasId, periods, channels, colorOf, mode, valueFn, formatter, shareable) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const rawByChannel = channels.map((ch) => periods.map((p) => valueFn(cellOf(p, ch))));
    const useShare = mode === "share" && shareable;
    let displayValues = rawByChannel;
    if (useShare) {
      const totals = periods.map((_, i) => rawByChannel.reduce((s, vs) => s + vs[i], 0));
      displayValues = rawByChannel.map((vs) => vs.map((v, i) => (totals[i] ? (v / totals[i]) * 100 : 0)));
    }

    const datasets = channels.map((ch, i) => {
      const color = colorOf(ch, i);
      return {
        label: ch,
        data: displayValues[i],
        borderColor: color,
        backgroundColor: useShare ? color + "CC" : color + "33",
        fill: useShare ? (i === 0 ? "origin" : "-1") : false,
        tension: 0.32,
        pointRadius: periods.length <= 14 ? 2 : 0,
        pointHoverRadius: 4,
        pointBackgroundColor: color,
        borderWidth: 1.8,
      };
    });

    state.charts[canvasId] = new Chart(canvas, {
      type: "line",
      data: { labels: periods, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false }, // 공통 범례 사용
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${useShare ? fmtPct(ctx.raw) : formatter(ctx.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } } },
          y: {
            stacked: useShare,
            beginAtZero: true,
            max: useShare ? 100 : undefined,
            grid: { color: palette().grid },
            border: { display: false },
            ticks: { maxTicksLimit: 4, font: { size: 10 }, callback: (v) => useShare ? fmtPct(v) : formatter(v) },
          },
        },
      },
    });
  }
}

// ── 채널 드릴다운 테이블 (단위 1개 + 단위 대비 델타 + 총합) ─────────────────
function renderOverviewChannelTable(_unused) {
  const [curS, curE] = currentUnitWindow();
  const [prvS, prvE] = previousUnitWindow();
  const allRows = state.data.ga4?.rows || [];
  const curRows = filterByDateRange(allRows, curS, curE);
  const prvRows = filterByDateRange(allRows, prvS, prvE);

  const curAgg = aggregateRows(curRows, ["channel"], {
    sessions: "sum", purchases: "sum", revenue: "sum",
  }).sort((a, b) => b.revenue - a.revenue);

  const prvAgg = aggregateRows(prvRows, ["channel"], {
    sessions: "sum", purchases: "sum", revenue: "sum",
  });
  const prvMap = new Map(prvAgg.map((r) => [r.channel || "(direct)", r]));

  if (!curAgg.length) {
    document.getElementById("overviewChannelTable").innerHTML =
      `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">선택 단위에 데이터 없음</td></tr>`;
    return;
  }

  const totalSess = curAgg.reduce((s, r) => s + r.sessions, 0) || 1;
  const totalRev  = curAgg.reduce((s, r) => s + r.revenue, 0)  || 1;
  const totalPurch = curAgg.reduce((s, r) => s + r.purchases, 0);
  const totalPRate = totalSess ? (totalPurch / totalSess) * 100 : 0;
  const totalAOV   = totalPurch ? totalRev / totalPurch : 0;
  const prvTotal = sumFields(prvAgg, ["sessions", "purchases", "revenue"]);
  const prvPRate = prvTotal.sessions ? (prvTotal.purchases / prvTotal.sessions) * 100 : 0;
  const prvAOV   = prvTotal.purchases ? prvTotal.revenue / prvTotal.purchases : 0;

  const totalRow = `
    <tr class="total-row">
      <td class="name-cell strong">총합 (전체 채널)</td>
      <td class="num">${fmtInt(totalSess)}${inlineDelta(totalSess, prvTotal.sessions)}</td>
      <td class="num">100.0%</td>
      <td class="num">${fmtInt(totalPurch)}${inlineDelta(totalPurch, prvTotal.purchases)}</td>
      <td class="num">${fmtPct(totalPRate)}${inlineDelta(totalPRate, prvPRate, true)}</td>
      <td class="num">${fmtMoney(totalRev)}${inlineDelta(totalRev, prvTotal.revenue)}</td>
      <td class="num">100.0%</td>
      <td class="num">${fmtMoney(totalAOV)}${inlineDelta(totalAOV, prvAOV)}</td>
    </tr>
  `;

  const rowsHtml = curAgg.map((r) => {
    const ch = r.channel || "(direct)";
    const p = prvMap.get(ch);
    const sessShare = (r.sessions / totalSess) * 100;
    const revShare  = (r.revenue  / totalRev)  * 100;
    const pRate = r.sessions ? (r.purchases / r.sessions) * 100 : 0;
    const aov   = r.purchases ? r.revenue / r.purchases : 0;
    const pPRate = p && p.sessions ? (p.purchases / p.sessions) * 100 : 0;
    const pAOV   = p && p.purchases ? p.revenue / p.purchases : 0;
    return `
      <tr>
        <td class="name-cell strong">${esc(ch)}</td>
        <td class="num">${fmtInt(r.sessions)}${p ? inlineDelta(r.sessions, p.sessions) : ""}</td>
        <td class="num">${sessShare.toFixed(1)}%</td>
        <td class="num">${fmtInt(r.purchases)}${p ? inlineDelta(r.purchases, p.purchases) : ""}</td>
        <td class="num">${fmtPct(pRate)}${p ? inlineDelta(pRate, pPRate, true) : ""}</td>
        <td class="num">${fmtMoney(r.revenue)}${p ? inlineDelta(r.revenue, p.revenue) : ""}</td>
        <td class="num">${revShare.toFixed(1)}%</td>
        <td class="num">${fmtMoney(aov)}${p ? inlineDelta(aov, pAOV) : ""}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("overviewChannelTable").innerHTML = totalRow + rowsHtml;
}

// ── 히트맵 캠페인 셀렉터 옵션 채우기 ────────────────────────────────────────
function populateHeatmapCampaignSelect(allMetaRows) {
  const sel = document.getElementById("heatmapCampaign");
  if (!sel) return;
  // Top campaigns by spend overall (date-range)
  const filtered = filterByDate(allMetaRows);
  const byCamp = aggregateRows(filtered, ["campaign_name"], { spend: "sum" })
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 30);
  const currentValue = state.heatmapCampaign;
  const opts = [`<option value="">전체 캠페인</option>`].concat(
    byCamp.map((r) => `<option value="${esc(r.campaign_name)}"${currentValue === r.campaign_name ? " selected" : ""}>${esc(r.campaign_name)} (${fmtCompact(r.spend)})</option>`)
  );
  // Preserve user selection even if not in top 30 (rare)
  if (currentValue && !byCamp.some((r) => r.campaign_name === currentValue)) {
    opts.push(`<option value="${esc(currentValue)}" selected>${esc(currentValue)}</option>`);
  }
  sel.innerHTML = opts.join("");
}

function renderTopCampaigns(_unused) {
  // 단위(일/주/월) 1개 데이터 — 상단 KPI와 동일한 윈도우
  const [curS, curE] = currentUnitWindow();
  const [prvS, prvE] = previousUnitWindow();
  const allCamps = state.data.meta?.campaigns || [];
  const curRows = filterByDateRange(allCamps, curS, curE);
  const prvRows = filterByDateRange(allCamps, prvS, prvE);

  const curAgg = aggregateRows(curRows, ["campaign_name"], {
    impressions: "sum", clicks: "sum", spend: "sum",
    conversions: "sum", conversion_value: "sum",
  });
  curAgg.forEach(addMetaRates);
  curAgg.sort((a, b) => b.spend - a.spend);
  const top = curAgg.slice(0, 6);

  const prvAgg = aggregateRows(prvRows, ["campaign_name"], {
    impressions: "sum", clicks: "sum", spend: "sum",
    conversions: "sum", conversion_value: "sum",
  });
  prvAgg.forEach(addMetaRates);
  const prvMap = new Map(prvAgg.map((r) => [r.campaign_name, r]));

  // 총합 (전체 캠페인, 표시되지 않은 것 포함)
  const curTotal = sumFields(curAgg, ["impressions", "clicks", "spend", "conversions", "conversion_value"]);
  addMetaRates(curTotal);
  const prvTotal = sumFields(prvAgg, ["impressions", "clicks", "spend", "conversions", "conversion_value"]);
  addMetaRates(prvTotal);

  const totalRow = `
    <tr class="total-row">
      <td class="name-cell strong">총합 (전체 캠페인)</td>
      <td class="num">${fmtInt(curTotal.impressions)}${inlineDelta(curTotal.impressions, prvTotal.impressions)}</td>
      <td class="num">${fmtInt(curTotal.clicks)}${inlineDelta(curTotal.clicks, prvTotal.clicks)}</td>
      <td class="num">${fmtPct(curTotal.ctr)}${inlineDelta(curTotal.ctr, prvTotal.ctr, true)}</td>
      <td class="num">${fmtMoney(curTotal.spend)}${inlineDelta(curTotal.spend, prvTotal.spend)}</td>
      <td class="num">${fmtInt(curTotal.conversions)}${inlineDelta(curTotal.conversions, prvTotal.conversions)}</td>
      <td class="num">${fmtMoney(curTotal.conversion_value)}${inlineDelta(curTotal.conversion_value, prvTotal.conversion_value)}</td>
      <td class="num">${fmtDecimal(curTotal.roas)}${inlineDelta(curTotal.roas, prvTotal.roas, true)}</td>
    </tr>
  `;

  const rowsHtml = top.map((r) => {
    const p = prvMap.get(r.campaign_name);
    const cls = roasClass(r.roas, curTotal.roas);
    return `
      <tr>
        <td class="name-cell strong" title="${esc(r.campaign_name)}">${esc(r.campaign_name)}</td>
        <td class="num">${fmtInt(r.impressions)}${p ? inlineDelta(r.impressions, p.impressions) : ""}</td>
        <td class="num">${fmtInt(r.clicks)}${p ? inlineDelta(r.clicks, p.clicks) : ""}</td>
        <td class="num">${fmtPct(r.ctr)}${p ? inlineDelta(r.ctr, p.ctr, true) : ""}</td>
        <td class="num">${fmtMoney(r.spend)}${p ? inlineDelta(r.spend, p.spend) : ""}</td>
        <td class="num">${fmtInt(r.conversions)}${p ? inlineDelta(r.conversions, p.conversions) : ""}</td>
        <td class="num">${fmtMoney(r.conversion_value)}${p ? inlineDelta(r.conversion_value, p.conversion_value) : ""}</td>
        <td class="num ${cls}">${fmtDecimal(r.roas)}${p ? inlineDelta(r.roas, p.roas, true) : ""}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("overviewTopCampaigns").innerHTML =
    (top.length ? totalRow + rowsHtml : `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">선택 단위에 데이터 없음</td></tr>`);
}

function renderHeatmap(ga4Rows, metaRows) {
  const metric = state.heatmapMetric;        // "roas" | "revenue" | "cvr"
  const campaign = state.heatmapCampaign;    // "" = 전체

  // Campaign filter
  let mFiltered = metaRows;
  let gFiltered = ga4Rows;
  if (campaign) {
    mFiltered = metaRows.filter((r) => r.campaign_name === campaign);
    // ga4 campaign mapping은 정확치 않을 수 있어 부분일치 fallback
    gFiltered = ga4Rows.filter((r) => (r.campaign || "") === campaign);
    // 부분일치가 0건이면 전체 ga4를 유지(ROAS만 메타 필터링)
    if (!gFiltered.length) gFiltered = ga4Rows;
  }

  // Group by date
  const ga4ByDate  = new Map();
  gFiltered.forEach((r) => {
    const t = ga4ByDate.get(r.date) || { revenue: 0, sessions: 0, purchases: 0 };
    t.revenue   += r.revenue   || 0;
    t.sessions  += r.sessions  || 0;
    t.purchases += r.purchases || 0;
    ga4ByDate.set(r.date, t);
  });
  const metaByDate = new Map();
  mFiltered.forEach((r) => {
    const t = metaByDate.get(r.date) || { spend: 0 };
    t.spend += r.spend || 0;
    metaByDate.set(r.date, t);
  });

  const dates = Array.from(new Set([...ga4ByDate.keys(), ...metaByDate.keys()])).sort();
  const target = document.getElementById("overviewHeatmap");
  const subEl = document.getElementById("overviewHeatmapSub");

  // Update subtitle
  if (subEl) {
    const metricLabel = { roas: "ROAS", revenue: "매출", cvr: "구매율" }[metric] || metric;
    const campaignLabel = campaign ? `“${campaign}”` : "전체 캠페인";
    subEl.textContent = `${metricLabel} · ${campaignLabel} · 진할수록 값 높음`;
  }

  if (!dates.length) {
    target.innerHTML = `<div style="color:var(--muted);padding:18px;text-align:center">선택 기간에 데이터가 없습니다</div>`;
    return;
  }

  // Compute metric value per date
  const cellByDate = new Map();
  dates.forEach((d) => {
    const ga = ga4ByDate.get(d)  || { revenue: 0, sessions: 0, purchases: 0 };
    const mt = metaByDate.get(d) || { spend: 0 };
    const roas = mt.spend ? ga.revenue / mt.spend : null;
    const cvr  = ga.sessions ? (ga.purchases / ga.sessions) * 100 : null;
    let value;
    if (metric === "roas")    value = roas;
    else if (metric === "cvr") value = cvr;
    else                       value = ga.revenue || null;
    cellByDate.set(d, { ...ga, ...mt, roas, cvr, value });
  });

  // Build grid (Mon..Sun rows)
  const startDate = parseLocalDate(dates[0]);
  const endDate   = parseLocalDate(dates[dates.length - 1]);
  const weekStart = new Date(startDate);
  const dow = weekStart.getDay() || 7;
  weekStart.setDate(weekStart.getDate() - (dow - 1));

  const dowHeaders = ["월", "화", "수", "목", "금", "토", "일"];
  let html = `<div class="week-label"></div>` + dowHeaders.map((d) => `<div class="dow-head">${d}</div>`).join("");

  const values = Array.from(cellByDate.values()).map((v) => v.value).filter((v) => v != null && isFinite(v));
  const maxV = values.length ? Math.max(...values) : 1;
  const minV = values.length ? Math.min(...values) : 0;

  const fmtMetric = (v) => {
    if (v == null) return "-";
    if (metric === "roas") return v.toFixed(2);
    if (metric === "cvr")  return `${v.toFixed(1)}%`;
    return fmtCompact(v);
  };
  // 보조 라벨: revenue 모드면 세션, 그 외면 매출 컴팩트 표기
  const subLabel = (cell) => {
    if (metric === "revenue") return `${fmtInt(cell.sessions)} 세션`;
    return fmtCompact(cell.revenue);
  };

  const cursor = new Date(weekStart);
  let safety = 0;
  while (cursor <= endDate && safety < 60) {
    html += `<div class="week-label">${cursor.getMonth() + 1}/${cursor.getDate()}</div>`;
    for (let i = 0; i < 7; i++) {
      const iso = fmtDate(cursor);
      const inRange = iso >= state.startDate && iso <= state.endDate;
      const cell = cellByDate.get(iso);
      if (!cell || !inRange) {
        html += `<div class="heat-cell empty"><span class="hc-val">·</span></div>`;
      } else {
        const ratio = (cell.value != null && maxV > minV)
          ? (cell.value - minV) / (maxV - minV)
          : (cell.value ? 0.5 : 0);
        const bg = heatColor(ratio, cell.value);
        const title = `${iso} · 매출 ${fmtMoney(cell.revenue)} · 광고비 ${fmtMoney(cell.spend)} · ROAS ${cell.roas != null ? cell.roas.toFixed(2) : "-"} · 구매율 ${cell.cvr != null ? cell.cvr.toFixed(1) + "%" : "-"}`;
        html += `
          <div class="heat-cell" style="background:${bg}" title="${esc(title)}">
            <span class="hc-val">${fmtMetric(cell.value)}</span>
            <span class="hc-sub">${esc(subLabel(cell))}</span>
          </div>
        `;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    safety++;
  }
  target.innerHTML = html;
}

function heatColor(ratio, value) {
  // Lo=red, mid=warning, high=green — 가독성을 위해 alpha 범위 확장
  const r = Math.max(0, Math.min(1, ratio));
  let alpha = 0.30 + 0.65 * r;
  if (value == null || value === 0) alpha = 0.08;
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
        <div class="kpi-head">
          <div class="kpi-label">
            <span class="kpi-icon" style="background:var(--${item.color}-soft);color:var(--${item.color})">${kpiIcon()}</span>
            ${esc(item.label)}
          </div>
          ${deltaHtml}
        </div>
        <div class="kpi-value">${esc(item.formatter(item.value))}</div>
        <div class="kpi-helper">${esc(item.helper)}</div>
        <div class="kpi-spark">${sparkHtml}</div>
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

// ── Granularity-aware unit windows (overview KPI 비교용) ────────────────────
// 현재 단위: state.endDate가 속한 일/주/월의 시작 ~ state.endDate
// 직전 단위: 현재 단위 길이와 동일하게 1단위 전으로 이동
function unitStart(dateStr, granularity) {
  const d = parseLocalDate(dateStr);
  if (granularity === "week") {
    const dow = d.getDay() || 7; // Mon=1..Sun=7
    const mon = new Date(d);
    mon.setDate(mon.getDate() - (dow - 1));
    return mon;
  }
  if (granularity === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d);
}

function currentUnitWindow() {
  if (!state.endDate) return [null, null];
  const start = unitStart(state.endDate, state.granularity);
  const end   = parseLocalDate(state.endDate);
  return [fmtDate(start), fmtDate(end)];
}

function previousUnitWindow() {
  if (!state.endDate) return [null, null];
  const start = unitStart(state.endDate, state.granularity);
  const end   = parseLocalDate(state.endDate);
  const daysInCurrent = Math.round((end - start) / 86400000) + 1;

  let prevStart;
  if (state.granularity === "week") {
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
  } else if (state.granularity === "month") {
    prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  } else {
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 1);
  }
  const prevEnd = new Date(prevStart);
  prevEnd.setDate(prevEnd.getDate() + daysInCurrent - 1);
  return [fmtDate(prevStart), fmtDate(prevEnd)];
}

function unitGa4Totals(since, until) {
  if (!since || !until) return {};
  const rows = filterByDateRange(state.data.ga4?.rows || [], since, until);
  const totals = sumFields(rows, [
    "sessions", "users", "new_users", "detail_views", "cart_adds",
    "checkout_starts", "purchases", "revenue", "bounce_sessions", "total_duration",
  ]);
  recomputeGa4Derived(totals);
  return totals;
}

function unitMetaTotals(since, until) {
  if (!since || !until) return {};
  const rows = filterByDateRange(state.data.meta?.campaigns || [], since, until);
  const totals = sumFields(rows, ["impressions", "reach", "clicks", "conversions", "spend", "conversion_value"]);
  addMetaRates(totals);
  return totals;
}

function unitLabel() {
  return { day: "당일", week: "이번 주", month: "이번 달" }[state.granularity] || "현재";
}
function unitDeltaLabel() {
  return { day: "전일 대비", week: "전주 대비", month: "전월 대비" }[state.granularity] || "전기간 대비";
}
// KPI helper에 들어가는 짧은 단위 표기 ("5/14", "5/11–5/14", "5월 1–14일")
function formatUnitTag(since, until) {
  if (!since || !until) return "";
  if (state.granularity === "day") {
    const d = parseLocalDate(since);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  if (state.granularity === "month") {
    const s = parseLocalDate(since);
    const e = parseLocalDate(until);
    return `${s.getMonth() + 1}월 ${s.getDate()}–${e.getDate()}일`;
  }
  // week
  const s = parseLocalDate(since);
  const e = parseLocalDate(until);
  return `${s.getMonth() + 1}/${s.getDate()}–${e.getMonth() + 1}/${e.getDate()}`;
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

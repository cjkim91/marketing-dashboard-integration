// ── Chart.js global defaults ──────────────────────────────────────────────────
if (typeof Chart !== "undefined") {
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = "#647184";
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.cornerRadius = 6;
  Chart.defaults.plugins.tooltip.padding = 9;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
}

// ── Application state ─────────────────────────────────────────────────────────
const state = {
  data: null,
  page: "ga4",
  granularity: "week",
  metaLevel: "campaigns",
  startDate: "",
  endDate: "",
  charts: {},        // Chart.js instances keyed by canvas id
  sortLanding: { key: "sessions", dir: "desc" },
  sortGa4Detail: { key: "purchases", dir: "desc" },
};

// ── Label maps ────────────────────────────────────────────────────────────────
const metaLevelLabels = {
  campaigns: "캠페인",
  adsets: "광고세트",
  ads: "광고",
  placements: "Placement",
};

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  primary:       "#1f5f99",
  primarySoft:   "rgba(31,95,153,0.12)",
  positive:      "#177245",
  positiveSoft:  "rgba(23,114,69,0.12)",
  negative:      "#b33a3a",
  negativeSoft:  "rgba(179,58,58,0.12)",
  warning:       "#9b6400",
  warningSoft:   "rgba(155,100,0,0.12)",
  neutral:       "#9aa8ba",
  device: ["#1f5f99", "#177245", "#9b6400", "#6b3fa0"],
};

// ═════════════════════════════════════════════════════════════════════════════
// Init & Controls
// ═════════════════════════════════════════════════════════════════════════════

async function init() {
  bindControls();
  bindSortHeaders();
  try {
    const response = await fetch("./data/dashboard.json", { cache: "no-store" });
    if (!response.ok) throw new Error("dashboard.json not found");
    state.data = await response.json();
    state.startDate = state.data.period?.since || "";
    state.endDate   = state.data.period?.until || "";
    document.getElementById("dataStatus").textContent = [
      `기간 ${state.startDate} ~ ${state.endDate}`,
      `생성 ${fmtGeneratedAt(state.data.generated_at)}`,
    ].join(" · ");
    setDateInputs();
    render();
  } catch {
    document.getElementById("dataStatus").textContent = "데이터 파일 없음";
    document.getElementById("emptyState").classList.remove("hidden");
    document.getElementById("ga4Page").classList.add("hidden");
    document.getElementById("metaPage").classList.add("hidden");
  }
}

function bindControls() {
  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.page = btn.dataset.page;
      setActive("[data-page]", btn);
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
  document.querySelectorAll("[data-preset]").forEach((btn) => btn.classList.remove("active"));
}

function setActive(selector, activeBtn) {
  document.querySelectorAll(selector).forEach((btn) => btn.classList.remove("active"));
  activeBtn.classList.add("active");
}

function setDateInputs() {
  document.getElementById("startDate").value = state.startDate;
  document.getElementById("endDate").value   = state.endDate;
}

// ── Sort headers ──────────────────────────────────────────────────────────────
function bindSortHeaders() {
  // Landing table sort
  document.querySelectorAll("#ga4LandingTable").forEach(() => {});
  document.querySelectorAll("th.sortable[data-sort-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      const table = th.closest("table");

      // Determine which sort state to use based on the tbody sibling
      const tbody = table.querySelector("tbody");
      let sortState;
      if (tbody && tbody.id === "ga4LandingTable") sortState = state.sortLanding;
      else sortState = state.sortGa4Detail;

      if (sortState.key === key) {
        sortState.dir = sortState.dir === "desc" ? "asc" : "desc";
      } else {
        sortState.key = key;
        sortState.dir = "desc";
      }
      updateSortIcons(table, key, sortState.dir);
      render();
    });
  });
}

function updateSortIcons(table, activeKey, dir) {
  table.querySelectorAll("th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sortKey === activeKey) {
      th.classList.add(dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function applySortState() {
  // Apply current sort states to table headers on render
  const landingTable = document.getElementById("ga4LandingTable")?.closest("table");
  if (landingTable) updateSortIcons(landingTable, state.sortLanding.key, state.sortLanding.dir);

  const ga4Table = document.getElementById("ga4Table")?.closest("table");
  if (ga4Table) updateSortIcons(ga4Table, state.sortGa4Detail.key, state.sortGa4Detail.dir);
}

// ═════════════════════════════════════════════════════════════════════════════
// Render router
// ═════════════════════════════════════════════════════════════════════════════

function render() {
  if (!state.data) return;
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("ga4Page").classList.toggle("hidden", state.page !== "ga4");
  document.getElementById("metaPage").classList.toggle("hidden", state.page !== "meta");
  if (state.page === "ga4") renderGa4();
  if (state.page === "meta") renderMeta();
  applySortState();
}

// ═════════════════════════════════════════════════════════════════════════════
// GA4
// ═════════════════════════════════════════════════════════════════════════════

function renderGa4() {
  const rows = filterByDate(state.data.ga4?.rows || []);
  const hasCheckout = !!(state.data.ga4?.has_checkout);

  const byPeriod = aggregateRows(rows, ["period"], {
    sessions: "sum", users: "sum", new_users: "sum",
    detail_views: "sum", checkout_starts: "sum", purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  }).sort(sortPeriodAsc);
  byPeriod.forEach(recomputeGa4Derived);

  const totals = sumFields(byPeriod,
    ["sessions", "users", "new_users", "detail_views", "checkout_starts", "purchases", "revenue",
     "bounce_sessions", "total_duration"]);
  recomputeGa4Derived(totals);

  const cur  = byPeriod[byPeriod.length - 1] || {};
  const prev = byPeriod[byPeriod.length - 2] || null;

  // ── KPI cards ───────────────────────────────────────────────────────────
  const kpis = [
    kpi("유입", totals.sessions, "Sessions", cur.sessions, prev?.sessions, byPeriod, "sessions", fmtInt),
    kpi("상세조회", totals.detail_views, "view_item", cur.detail_views, prev?.detail_views, byPeriod, "detail_views", fmtInt),
  ];
  if (hasCheckout) {
    kpis.push(kpi("결제시작", totals.checkout_starts, "begin_checkout", cur.checkout_starts, prev?.checkout_starts, byPeriod, "checkout_starts", fmtInt));
  } else {
    kpis.push(kpi("신규 유저", totals.new_users, "New Users", cur.new_users, prev?.new_users, byPeriod, "new_users", fmtInt));
  }
  kpis.push(
    kpi("구매", totals.purchases, "purchase", cur.purchases, prev?.purchases, byPeriod, "purchases", fmtInt),
    kpi("매출", totals.revenue, "Revenue", cur.revenue, prev?.revenue, byPeriod, "revenue", fmtMoney),
    kpi("이탈률", totals.bounce_rate, "Bounce Rate", cur.bounce_rate, prev?.bounce_rate, byPeriod, "bounce_rate", fmtPct, true, true),
  );
  renderKpis("ga4Summary", kpis);

  // ── Trend charts ─────────────────────────────────────────────────────────
  lineChart("chartGa4Sessions", "ga4TSessions", byPeriod, "period", "sessions", fmtInt, C.primary, C.primarySoft);
  lineChart("chartGa4Purchases", "ga4TPurchases", byPeriod, "period", "purchases", fmtInt, C.positive, C.positiveSoft);
  lineChart("chartGa4Revenue", "ga4TRevenue", byPeriod, "period", "revenue", fmtMoney, C.primary, C.primarySoft);
  lineChart("chartGa4Bounce", "ga4TBounce", byPeriod, "period", "bounce_rate", fmtPct, C.warning, C.warningSoft);

  // ── Funnel ───────────────────────────────────────────────────────────────
  const funnelSteps = [
    ["유입", totals.sessions, null],
    ["상세페이지 조회", totals.detail_views, totals.sessions],
  ];
  if (hasCheckout && totals.checkout_starts > 0) {
    funnelSteps.push(["결제 시작", totals.checkout_starts, totals.detail_views]);
    funnelSteps.push(["구매 완료", totals.purchases, totals.checkout_starts]);
  } else {
    funnelSteps.push(["구매 완료", totals.purchases, totals.detail_views]);
  }
  renderFunnel("ga4Funnel", funnelSteps);

  // ── Channel bar chart ────────────────────────────────────────────────────
  const channelRows = aggregateRows(rows, ["channel"], {
    sessions: "sum", detail_views: "sum", checkout_starts: "sum",
    purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  }).sort((a, b) => b.purchases - a.purchases || b.sessions - a.sessions);
  channelRows.forEach(recomputeGa4Derived);

  barChartH(
    "chartGa4Channels",
    "ga4ChannelWrap",
    channelRows.slice(0, 10),
    "channel",
    "purchases",
    (v, row) => `구매 ${fmtInt(v)} · 구매율 ${fmtPct(row.purchase_rate)} · 유입 ${fmtInt(row.sessions)}`,
    C.primary,
  );

  // ── Device ───────────────────────────────────────────────────────────────
  renderGa4Device();

  // ── Landing page ─────────────────────────────────────────────────────────
  renderGa4Landing();

  // ── Detail table ─────────────────────────────────────────────────────────
  const grouped = aggregateRows(rows, ["period", "channel", "source", "medium", "campaign"], {
    sessions: "sum", users: "sum", new_users: "sum",
    detail_views: "sum", checkout_starts: "sum", purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  });
  grouped.forEach(recomputeGa4Derived);

  const { key: sk, dir: sd } = state.sortGa4Detail;
  grouped.sort((a, b) => {
    const diff = (Number(b[sk]) || 0) - (Number(a[sk]) || 0);
    return sd === "asc" ? -diff : diff;
  });

  document.getElementById("ga4Table").innerHTML = grouped.slice(0, 300).map((row) => `
    <tr>
      <td>${esc(row.period)}</td>
      <td>${esc(row.channel)}</td>
      <td>${esc(row.source)} / ${esc(row.medium)}</td>
      <td>${esc(row.campaign)}</td>
      <td class="num">${fmtInt(row.sessions)}</td>
      <td class="num">${fmtInt(row.detail_views)}</td>
      <td class="num">${fmtInt(row.checkout_starts)}</td>
      <td class="num">${fmtInt(row.purchases)}</td>
      <td class="num">${fmtPct(row.detail_view_rate)}</td>
      <td class="num">${fmtPct(row.checkout_rate)}</td>
      <td class="num">${fmtPct(row.purchase_rate)}</td>
      <td class="num">${fmtMoney(row.revenue)}</td>
      <td class="num">${fmtPct(row.bounce_rate)}</td>
      <td class="num">${fmtDuration(row.avg_session_duration)}</td>
    </tr>
  `).join("");
}

function renderGa4Device() {
  const rows = filterByDate(state.data.ga4?.device_rows || []);
  if (!rows.length) {
    document.getElementById("ga4DeviceTable").innerHTML =
      `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">기기별 데이터 없음 (파이프라인 재실행 필요)</td></tr>`;
    return;
  }

  const byDevice = aggregateRows(rows, ["device_category"], {
    sessions: "sum", users: "sum", new_users: "sum",
    detail_views: "sum", checkout_starts: "sum", purchases: "sum", revenue: "sum",
    bounce_sessions: "sum", total_duration: "sum",
  }).sort((a, b) => b.sessions - a.sessions);
  byDevice.forEach(recomputeGa4Derived);

  const deviceLabels = { desktop: "데스크탑", mobile: "모바일", tablet: "태블릿" };

  // Doughnut chart
  doughnutChart(
    "chartGa4Device",
    byDevice.map((r) => deviceLabels[r.device_category] || r.device_category),
    byDevice.map((r) => r.sessions),
    C.device,
  );

  // Table
  document.getElementById("ga4DeviceTable").innerHTML = byDevice.map((row) => `
    <tr>
      <td><strong>${esc(deviceLabels[row.device_category] || row.device_category)}</strong></td>
      <td class="num">${fmtInt(row.sessions)}</td>
      <td class="num">${fmtInt(row.detail_views)}</td>
      <td class="num">${fmtInt(row.purchases)}</td>
      <td class="num">${fmtPct(row.purchase_rate)}</td>
      <td class="num">${fmtMoney(row.revenue)}</td>
      <td class="num">${fmtPct(row.bounce_rate)}</td>
      <td class="num">${fmtDuration(row.avg_session_duration)}</td>
    </tr>
  `).join("");
}

function renderGa4Landing() {
  const rows = filterByDate(state.data.ga4?.landing_rows || []);
  if (!rows.length) {
    document.getElementById("ga4LandingTable").innerHTML =
      `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">랜딩페이지 데이터 없음 (파이프라인 재실행 필요)</td></tr>`;
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

  const { key: sk, dir: sd } = state.sortLanding;
  byLanding.sort((a, b) => {
    const diff = (Number(b[sk]) || 0) - (Number(a[sk]) || 0);
    return sd === "asc" ? -diff : diff;
  });

  document.getElementById("ga4LandingTable").innerHTML = byLanding.slice(0, 100).map((row) => `
    <tr>
      <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis" title="${esc(row.landing_page)}">${esc(row.landing_page)}</td>
      <td class="num">${fmtInt(row.sessions)}</td>
      <td class="num">${fmtPct(row.bounce_rate)}</td>
      <td class="num">${fmtDuration(row.avg_session_duration)}</td>
      <td class="num">${fmtInt(row.purchases)}</td>
      <td class="num">${fmtPct(row.purchase_rate)}</td>
      <td class="num">${fmtMoney(row.revenue)}</td>
    </tr>
  `).join("");
}

// ═════════════════════════════════════════════════════════════════════════════
// Meta
// ═════════════════════════════════════════════════════════════════════════════

function renderMeta() {
  const rawRows = filterByDate(state.data.meta?.[state.metaLevel] || []);
  const keys = metaKeys(state.metaLevel);

  const byPeriod = aggregateRows(rawRows, ["period"], {
    impressions: "sum", reach: "sum", clicks: "sum",
    conversions: "sum", spend: "sum", conversion_value: "sum",
  }).sort(sortPeriodAsc);
  byPeriod.forEach(addMetaRates);

  const totals = sumFields(byPeriod,
    ["impressions", "reach", "clicks", "conversions", "spend", "conversion_value"]);
  addMetaRates(totals);

  const cur  = byPeriod[byPeriod.length - 1] || {};
  const prev = byPeriod[byPeriod.length - 2] || null;

  // ── KPI cards ───────────────────────────────────────────────────────────
  renderKpis("metaSummary", [
    kpi("비용", totals.spend, "Spend", cur.spend, prev?.spend, byPeriod, "spend", fmtMoney),
    kpi("노출", totals.impressions, "Impressions", cur.impressions, prev?.impressions, byPeriod, "impressions", fmtInt),
    kpi("전환", totals.conversions, "Conversions", cur.conversions, prev?.conversions, byPeriod, "conversions", fmtInt),
    kpi("CPA", totals.cpa, "Cost / Conversion", cur.cpa, prev?.cpa, byPeriod, "cpa", fmtMoney, false, true),
    kpi("CTR", totals.ctr, "Clicks / Impressions", cur.ctr, prev?.ctr, byPeriod, "ctr", fmtPct, true),
    kpi("ROAS", totals.roas, "Value / Spend", cur.roas, prev?.roas, byPeriod, "roas", fmtDecimal, true),
  ]);

  // ── Trend charts ─────────────────────────────────────────────────────────
  lineChart("chartMetaSpend", "metaTSpend", byPeriod, "period", "spend", fmtMoney, C.negative, C.negativeSoft);
  lineChart("chartMetaConversions", "metaTConversions", byPeriod, "period", "conversions", fmtInt, C.positive, C.positiveSoft);
  const cpaRows = byPeriod.map((r) => ({ ...r, cpa: r.conversions ? r.spend / r.conversions : 0 }));
  lineChart("chartMetaCpa", "metaTCpa", cpaRows, "period", "cpa", fmtMoney, C.warning, C.warningSoft);
  lineChart("chartMetaRoas", "metaTRoas", byPeriod, "period", "roas", fmtDecimal, C.primary, C.primarySoft);

  // ── Drilldown bar chart ──────────────────────────────────────────────────
  document.getElementById("metaLevelTitle").textContent = `${metaLevelLabels[state.metaLevel]} 성과`;
  document.getElementById("metaTableTitle").textContent = `${metaLevelLabels[state.metaLevel]}별 성과 테이블`;

  const grouped = aggregateRows(rawRows, ["period", ...keys], {
    impressions: "sum", reach: "sum", clicks: "sum",
    conversions: "sum", spend: "sum", conversion_value: "sum",
  });
  grouped.forEach(addMetaRates);
  const previousMap = buildPreviousMap(grouped, keys);

  const latestPeriod = byPeriod[byPeriod.length - 1]?.period;
  const latestRows = grouped
    .filter((r) => r.period === latestPeriod)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 14)
    .map((r) => ({ ...r, _label: metaDisplayLabel(r) }));

  barChartH(
    "chartMetaDrilldown",
    "metaDrilldownWrap",
    latestRows,
    "_label",
    "spend",
    (v, row) => {
      const prev = previousMap.get(prevKey(row, keys));
      return `${fmtMoney(v)}${deltaText(v, prev?.spend)} · ${fmtInt(row.conversions)} 전환 · ROAS ${fmtDecimal(row.roas)}`;
    },
    C.primary,
  );

  // ── Detail table ─────────────────────────────────────────────────────────
  renderMetaHead(keys);
  renderMetaTable(grouped, previousMap, keys);
}

function renderMetaHead(keys) {
  const entityHeaders = keys.map((k) => `<th>${metaHeaderLabel(k)}</th>`).join("");
  document.getElementById("metaTableHead").innerHTML = `
    <tr>
      <th>기간</th>
      ${entityHeaders}
      <th class="num">노출</th>
      <th class="num">도달</th>
      <th class="num">클릭</th>
      <th class="num">전환</th>
      <th class="num">비용</th>
      <th class="num">CTR</th>
      <th class="num">CVR</th>
      <th class="num">CPM</th>
      <th class="num">CPA</th>
      <th class="num">ROAS</th>
    </tr>
  `;
}

function renderMetaTable(grouped, previousMap, keys) {
  const sorted = grouped
    .filter((r) => r.impressions || r.spend)
    .sort((a, b) => b.period.localeCompare(a.period) || b.spend - a.spend)
    .slice(0, 400);

  document.getElementById("metaTable").innerHTML = sorted.map((row) => {
    const prev = previousMap.get(prevKey(row, keys));
    const entityCells = keys.map((k) => `<td>${esc(row[k] || "-")}</td>`).join("");
    return `
      <tr>
        <td>${esc(row.period)}</td>
        ${entityCells}
        <td class="num">${fmtInt(row.impressions)}${inlineDelta(row.impressions, prev?.impressions)}</td>
        <td class="num">${fmtInt(row.reach)}</td>
        <td class="num">${fmtInt(row.clicks)}${inlineDelta(row.clicks, prev?.clicks)}</td>
        <td class="num">${fmtInt(row.conversions)}${inlineDelta(row.conversions, prev?.conversions)}</td>
        <td class="num">${fmtMoney(row.spend)}${inlineDelta(row.spend, prev?.spend)}</td>
        <td class="num">${fmtPct(row.ctr)}${inlineDelta(row.ctr, prev?.ctr, true)}</td>
        <td class="num">${fmtPct(row.cvr)}${inlineDelta(row.cvr, prev?.cvr, true)}</td>
        <td class="num">${fmtMoney(row.cpm)}</td>
        <td class="num">${row.cpa ? fmtMoney(row.cpa) : "-"}${row.cpa && prev?.cpa ? inlineDelta(row.cpa, prev.cpa) : ""}</td>
        <td class="num">${fmtDecimal(row.roas)}${inlineDelta(row.roas, prev?.roas, true)}</td>
      </tr>
    `;
  }).join("");
}

// ═════════════════════════════════════════════════════════════════════════════
// Chart helpers (Chart.js)
// ═════════════════════════════════════════════════════════════════════════════

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

function lineChart(canvasId, latestId, rows, labelKey, valueKey, formatter, color, fillColor) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !rows.length) return;

  const latest = rows[rows.length - 1];
  if (latestId) {
    const el = document.getElementById(latestId);
    if (el) el.textContent = latest ? formatter(latest[valueKey]) : "-";
  }

  const values = rows.map((r) => Number(r[valueKey] || 0));
  const labels = rows.map((r) => r[labelKey]);

  state.charts[canvasId] = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: fillColor,
        fill: true,
        tension: 0.35,
        pointRadius: rows.length <= 12 ? 3 : 2,
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
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatter(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: 8,
            maxRotation: 0,
          },
        },
        y: {
          grid: { color: "#edf2f7" },
          border: { display: false },
          ticks: {
            maxTicksLimit: 5,
            callback: (v) => formatter(v),
          },
        },
      },
    },
  });
}

function barChartH(canvasId, wrapperId, rows, labelKey, valueKey, tooltipFn, color) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  const wrapper = document.getElementById(wrapperId);
  if (!canvas || !rows.length) return;

  const height = Math.max(rows.length * 42 + 24, 120);
  if (wrapper) wrapper.style.height = height + "px";

  const labels = rows.map((r) => r[labelKey] || "-");
  const values = rows.map((r) => Number(r[valueKey] || 0));
  const maxVal = Math.max(...values, 1);

  state.charts[canvasId] = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: values.map((v) => v === maxVal ? color : color + "bb"),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${tooltipFn(ctx.raw, rows[ctx.dataIndex])}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "#edf2f7" },
          border: { display: false },
          ticks: {
            maxTicksLimit: 5,
            callback: (v) => {
              // auto-format based on magnitude
              if (v >= 1000000) return (v / 1000000).toFixed(1) + "M";
              if (v >= 1000) return (v / 1000).toFixed(0) + "K";
              return String(v);
            },
          },
        },
        y: {
          grid: { display: false },
          ticks: {
            font: { size: 11, weight: "700" },
            callback: (_, i) => {
              const label = labels[i] || "";
              return label.length > 28 ? label.slice(0, 26) + "…" : label;
            },
          },
        },
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
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: "#fff",
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            padding: 14,
            font: { size: 11, weight: "700" },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${fmtInt(ctx.raw)} (${(ctx.raw / total * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// KPI cards & sparklines
// ═════════════════════════════════════════════════════════════════════════════

function kpi(label, value, helper, current, previous, rows, metric, formatter,
             pointDiff = false, lowerIsBetter = false) {
  return { label, value, helper, current, previous, rows, metric, formatter, pointDiff, lowerIsBetter };
}

function renderKpis(id, items) {
  document.getElementById(id).innerHTML = items.map((item) => {
    const deltaHtml = deltaBlock(item.current, item.previous, item.pointDiff, item.lowerIsBetter);
    return `
      <article class="kpi-card">
        <div class="kpi-label">${esc(item.label)}</div>
        <div class="kpi-value">${esc(item.formatter(item.value))}</div>
        <div class="kpi-meta">
          <span>${esc(item.helper)}</span>
          ${deltaHtml}
        </div>
        ${sparklineSvg(item.rows, item.metric)}
      </article>
    `;
  }).join("");
}

function sparklineSvg(rows, metric) {
  if (!rows || !rows.length) return `<svg class="sparkline" viewBox="0 0 160 32" aria-hidden="true"></svg>`;
  const values = rows.map((r) => Number(r[metric] || 0));
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
    <svg class="sparkline" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <polygon class="area" points="${area}" fill="var(--primary-soft)"></polygon>
      <polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round"></polyline>
    </svg>
  `;
}

// ═════════════════════════════════════════════════════════════════════════════
// Funnel
// ═════════════════════════════════════════════════════════════════════════════

function renderFunnel(id, steps) {
  // steps: [label, value, prevStepValue]
  const maxVal = Math.max(...steps.map((s) => Number(s[1] || 0)), 1);
  document.getElementById(id).innerHTML = steps.map(([label, value, fromValue], i) => {
    const width = Math.max(Number(value || 0) / maxVal * 100, 1);
    const convRate = fromValue && fromValue > 0
      ? (Number(value || 0) / fromValue * 100).toFixed(1) + "% 전환"
      : "";
    return `
      ${i > 0 ? `<div class="funnel-arrow">↓ ${convRate}</div>` : ""}
      <div class="funnel-step">
        <div class="funnel-head">
          <span>${esc(label)}</span>
          <span>${fmtInt(value)}</span>
        </div>
        <div class="funnel-track">
          <div class="funnel-fill" style="width:${width}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

// ═════════════════════════════════════════════════════════════════════════════
// Data aggregation
// ═════════════════════════════════════════════════════════════════════════════

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
    Object.keys(metrics).forEach((m) => {
      target[m] += Number(row[m] || 0);
    });
  });
  return Array.from(map.values());
}

function sumFields(rows, fields) {
  const out = {};
  fields.forEach((f) => {
    out[f] = rows.reduce((s, r) => s + Number(r[f] || 0), 0);
  });
  return out;
}

function recomputeGa4Derived(row) {
  const s = row.sessions || 0;
  row.bounce_rate        = s ? (row.bounce_sessions || 0) / s * 100 : 0;
  row.avg_session_duration = s ? (row.total_duration || 0) / s : 0;
  row.detail_view_rate   = s ? (row.detail_views || 0) / s * 100 : 0;
  row.checkout_rate      = s ? (row.checkout_starts || 0) / s * 100 : 0;
  row.purchase_rate      = s ? (row.purchases || 0) / s * 100 : 0;
  row.detail_to_purchase_rate = row.detail_views
    ? (row.purchases || 0) / row.detail_views * 100 : 0;
  row.checkout_to_purchase_rate = row.checkout_starts
    ? (row.purchases || 0) / row.checkout_starts * 100 : 0;
}

function addMetaRates(row) {
  const imp  = row.impressions || 0;
  const clk  = row.clicks || 0;
  const conv = row.conversions || 0;
  const sp   = row.spend || 0;
  const cv   = row.conversion_value || 0;
  row.ctr  = imp  ? clk  / imp  * 100 : 0;
  row.cvr  = clk  ? conv / clk  * 100 : 0;
  row.cpc  = clk  ? sp   / clk       : 0;
  row.cpa  = conv ? sp   / conv      : 0;
  row.roas = sp   ? cv   / sp        : 0;
  row.cpm  = imp  ? sp   / imp * 1000 : 0;
}

function buildPreviousMap(rows, keys) {
  const byEntity = new Map();
  rows.forEach((row) => {
    const ek = keys.map((k) => row[k] || "").join("||");
    if (!byEntity.has(ek)) byEntity.set(ek, []);
    byEntity.get(ek).push(row);
  });
  const previous = new Map();
  byEntity.forEach((items) => {
    items.sort(sortPeriodAsc);
    for (let i = 1; i < items.length; i++) {
      previous.set(prevKey(items[i], keys), items[i - 1]);
    }
  });
  return previous;
}

function prevKey(row, keys) {
  return [row.period, ...keys.map((k) => row[k] || "")].join("||");
}

function filterByDate(rows) {
  return rows.filter((r) => {
    const d = r.date;
    return (!state.startDate || d >= state.startDate) &&
           (!state.endDate   || d <= state.endDate);
  });
}

function periodKey(dateValue) {
  if (!dateValue) return "";
  if (state.granularity === "day") return dateValue;
  const d = parseLocalDate(dateValue);
  if (state.granularity === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
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

// ═════════════════════════════════════════════════════════════════════════════
// Meta helpers
// ═════════════════════════════════════════════════════════════════════════════

function metaKeys(level) {
  if (level === "campaigns")  return ["campaign_name"];
  if (level === "adsets")     return ["campaign_name", "adset_name"];
  if (level === "ads")        return ["campaign_name", "adset_name", "ad_name"];
  return ["campaign_name", "adset_name", "ad_name", "placement"];
}

function metaHeaderLabel(key) {
  return { campaign_name: "캠페인", adset_name: "광고세트", ad_name: "광고", placement: "Placement" }[key] || key;
}

function metaDisplayLabel(row) {
  if (state.metaLevel === "placements") return `${row.ad_name || "-"} · ${row.placement || "-"}`;
  if (state.metaLevel === "ads")        return row.ad_name || "-";
  if (state.metaLevel === "adsets")     return row.adset_name || "-";
  return row.campaign_name || "-";
}

// ═════════════════════════════════════════════════════════════════════════════
// Delta indicators
// ═════════════════════════════════════════════════════════════════════════════

function deltaBlock(current, previous, pointDiff = false, lowerIsBetter = false) {
  if (previous == null || Number(previous) === 0) {
    return `<span class="delta flat">-</span>`;
  }
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

function deltaText(current, previous) {
  if (previous == null || Number(previous) === 0) return "";
  const diff = Number(current || 0) - Number(previous || 0);
  const pct  = diff / Math.abs(Number(previous)) * 100;
  return ` (${pct > 0 ? "+" : ""}${pct.toFixed(0)}%)`;
}

// ═════════════════════════════════════════════════════════════════════════════
// Formatters
// ═════════════════════════════════════════════════════════════════════════════

function fmtInt(v)      { return Math.round(Number(v || 0)).toLocaleString("ko-KR"); }
function fmtMoney(v)    { return `₩${Math.round(Number(v || 0)).toLocaleString("ko-KR")}`; }
function fmtPct(v)      { return `${Number(v || 0).toFixed(1)}%`; }
function fmtDecimal(v)  { return Number(v || 0).toFixed(2); }
function fmtDate(d)     { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

function fmtDuration(seconds) {
  const s = Math.round(Number(seconds || 0));
  if (s === 0) return "-";
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}초`;
  return `${m}분 ${r.toString().padStart(2, "0")}초`;
}

function fmtGeneratedAt(v) {
  if (!v) return "-";
  return new Date(v).toLocaleString("ko-KR");
}

function parseLocalDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function esc(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ═════════════════════════════════════════════════════════════════════════════
// Boot
// ═════════════════════════════════════════════════════════════════════════════

init();

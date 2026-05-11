const state = {
  data: null,
  page: "ga4",
  granularity: "week",
  metaLevel: "campaigns",
  startDate: "",
  endDate: "",
};

const metaLevelLabels = {
  campaigns: "캠페인",
  adsets: "광고세트",
  ads: "광고",
  placements: "Placement",
};

const chartColors = {
  primary: "#1F5F99",
  positive: "#177245",
  negative: "#B33A3A",
  warning: "#9B6400",
  neutral: "#9AA8BA",
};

async function init() {
  bindControls();
  try {
    const response = await fetch("./data/dashboard.json", { cache: "no-store" });
    if (!response.ok) throw new Error("dashboard.json not found");
    state.data = await response.json();
    state.startDate = state.data.period?.since || "";
    state.endDate = state.data.period?.until || "";
    document.getElementById("dataStatus").textContent = [
      `기간 ${state.startDate} ~ ${state.endDate}`,
      `생성 ${formatGeneratedAt(state.data.generated_at)}`,
    ].join(" · ");
    setDateInputs();
    render();
  } catch (error) {
    document.getElementById("dataStatus").textContent = "데이터 파일 없음";
    document.getElementById("emptyState").classList.remove("hidden");
    document.getElementById("ga4Page").classList.add("hidden");
    document.getElementById("metaPage").classList.add("hidden");
  }
}

function bindControls() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.page = button.dataset.page;
      setActive("[data-page]", button);
      render();
    });
  });

  document.querySelectorAll("[data-granularity]").forEach((button) => {
    button.addEventListener("click", () => {
      state.granularity = button.dataset.granularity;
      setActive("[data-granularity]", button);
      render();
    });
  });

  document.querySelectorAll("[data-meta-level]").forEach((button) => {
    button.addEventListener("click", () => {
      state.metaLevel = button.dataset.metaLevel;
      setActive("[data-meta-level]", button);
      renderMeta();
    });
  });

  document.getElementById("startDate").addEventListener("change", (event) => {
    state.startDate = event.target.value;
    render();
  });

  document.getElementById("endDate").addEventListener("change", (event) => {
    state.endDate = event.target.value;
    render();
  });
}

function setActive(selector, activeButton) {
  document.querySelectorAll(selector).forEach((button) => button.classList.remove("active"));
  activeButton.classList.add("active");
}

function setDateInputs() {
  document.getElementById("startDate").value = state.startDate;
  document.getElementById("endDate").value = state.endDate;
}

function render() {
  if (!state.data) return;
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("ga4Page").classList.toggle("hidden", state.page !== "ga4");
  document.getElementById("metaPage").classList.toggle("hidden", state.page !== "meta");
  if (state.page === "ga4") renderGa4();
  if (state.page === "meta") renderMeta();
}

function renderGa4() {
  const rows = filterByDate(state.data.ga4?.rows || []);
  const byPeriod = aggregateRows(rows, ["period"], {
    sessions: "sum",
    users: "sum",
    detail_views: "sum",
    purchases: "sum",
    revenue: "sum",
  }).sort(sortPeriodAsc);
  byPeriod.forEach(addGa4Rates);

  const totals = sumRows(byPeriod, ["sessions", "users", "detail_views", "purchases", "revenue"]);
  addGa4Rates(totals);
  const current = byPeriod[byPeriod.length - 1] || {};
  const previous = byPeriod[byPeriod.length - 2] || null;

  renderKpis("ga4Summary", [
    kpi("유입", totals.sessions, "sessions", current.sessions, previous?.sessions, byPeriod, "sessions", fmtInt),
    kpi("상세조회", totals.detail_views, "view_item", current.detail_views, previous?.detail_views, byPeriod, "detail_views", fmtInt),
    kpi("구매", totals.purchases, "purchase", current.purchases, previous?.purchases, byPeriod, "purchases", fmtInt),
    kpi("매출", totals.revenue, "purchase revenue", current.revenue, previous?.revenue, byPeriod, "revenue", fmtMoney),
  ]);

  renderChartGrid("ga4Trend", [
    lineChartCard("유입 추이", byPeriod, "period", "sessions", fmtInt),
    lineChartCard("상세조회 추이", byPeriod, "period", "detail_views", fmtInt),
    lineChartCard("구매 추이", byPeriod, "period", "purchases", fmtInt),
    lineChartCard("매출 추이", byPeriod, "period", "revenue", fmtMoney),
  ]);

  renderFunnel("ga4Funnel", [
    ["유입", totals.sessions, "sessions"],
    ["상세페이지 조회", totals.detail_views, "view_item"],
    ["구매", totals.purchases, "purchase only"],
  ]);

  const channelRows = aggregateRows(rows, ["channel"], {
    sessions: "sum",
    detail_views: "sum",
    purchases: "sum",
    revenue: "sum",
  }).sort((a, b) => b.purchases - a.purchases || b.sessions - a.sessions);
  channelRows.forEach(addGa4Rates);
  renderBars("ga4ChannelBars", channelRows.slice(0, 10), "channel", "purchases", (row) => {
    return `${fmtInt(row.purchases)} 구매 · ${fmtPct(row.purchase_rate)} · ${fmtInt(row.sessions)} 유입`;
  });

  const grouped = aggregateRows(rows, ["period", "channel", "source", "medium", "campaign"], {
    sessions: "sum",
    users: "sum",
    detail_views: "sum",
    purchases: "sum",
    revenue: "sum",
  });
  grouped.forEach(addGa4Rates);
  grouped.sort((a, b) => b.period.localeCompare(a.period) || b.purchases - a.purchases || b.sessions - a.sessions);

  document.getElementById("ga4Table").innerHTML = grouped.slice(0, 300).map((row) => `
    <tr>
      <td>${escapeHtml(row.period)}</td>
      <td>${escapeHtml(row.channel)}</td>
      <td>${escapeHtml(row.source)} / ${escapeHtml(row.medium)}</td>
      <td>${escapeHtml(row.campaign)}</td>
      <td class="num">${fmtInt(row.sessions)}</td>
      <td class="num">${fmtInt(row.detail_views)}</td>
      <td class="num">${fmtInt(row.purchases)}</td>
      <td class="num">${fmtPct(row.detail_view_rate)}</td>
      <td class="num">${fmtPct(row.purchase_rate)}</td>
      <td class="num">${fmtMoney(row.revenue)}</td>
    </tr>
  `).join("");
}

function renderMeta() {
  const rawRows = filterByDate(state.data.meta?.[state.metaLevel] || []);
  const keys = metaKeys(state.metaLevel);
  const byPeriod = aggregateRows(rawRows, ["period"], {
    impressions: "sum",
    clicks: "sum",
    conversions: "sum",
    spend: "sum",
    conversion_value: "sum",
  }).sort(sortPeriodAsc);
  byPeriod.forEach(addMetaRates);

  const totals = sumRows(byPeriod, ["impressions", "clicks", "conversions", "spend", "conversion_value"]);
  addMetaRates(totals);
  const current = byPeriod[byPeriod.length - 1] || {};
  const previous = byPeriod[byPeriod.length - 2] || null;

  renderKpis("metaSummary", [
    kpi("비용", totals.spend, "Spend", current.spend, previous?.spend, byPeriod, "spend", fmtMoney),
    kpi("전환", totals.conversions, "Conversions", current.conversions, previous?.conversions, byPeriod, "conversions", fmtInt),
    kpi("CTR", totals.ctr, "Clicks / Impressions", current.ctr, previous?.ctr, byPeriod, "ctr", fmtPct, true),
    kpi("ROAS", totals.roas, "Value / Spend", current.roas, previous?.roas, byPeriod, "roas", fmtDecimal, true),
  ]);

  renderChartGrid("metaTrend", [
    lineChartCard("비용 추이", byPeriod, "period", "spend", fmtMoney),
    lineChartCard("전환 추이", byPeriod, "period", "conversions", fmtInt),
    lineChartCard("CPA 추이", byPeriod.map((row) => ({ ...row, cpa: row.conversions ? row.spend / row.conversions : 0 })), "period", "cpa", fmtMoney),
    lineChartCard("ROAS 추이", byPeriod, "period", "roas", fmtDecimal),
  ]);

  const grouped = aggregateRows(rawRows, ["period", ...keys], {
    impressions: "sum",
    clicks: "sum",
    conversions: "sum",
    spend: "sum",
    conversion_value: "sum",
  });
  grouped.forEach(addMetaRates);
  const previousMap = buildPreviousMap(grouped, keys);

  document.getElementById("metaLevelTitle").textContent = `${metaLevelLabels[state.metaLevel]} 성과`;
  document.getElementById("metaTableTitle").textContent = `${metaLevelLabels[state.metaLevel]}별 상세 테이블`;

  const latestPeriod = byPeriod[byPeriod.length - 1]?.period;
  const latestRows = grouped
    .filter((row) => row.period === latestPeriod)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 12)
    .map((row) => ({ ...row, display_label: metaDisplayLabel(row) }));
  renderBars("metaLevelBars", latestRows, "display_label", "spend", (row) => {
    const prev = previousMap.get(previousKey(row, keys));
    return `${fmtMoney(row.spend)}${delta(row.spend, prev?.spend)} · ${fmtInt(row.conversions)} 전환 · ${fmtDecimal(row.roas)} ROAS`;
  });

  renderMetaHead(keys);
  renderMetaTable(grouped, previousMap, keys);
}

function kpi(label, value, helper, current, previous, rows, metric, formatter, pointDiff = false) {
  return { label, value, helper, current, previous, rows, metric, formatter, pointDiff };
}

function renderKpis(id, items) {
  document.getElementById(id).innerHTML = items.map((item) => `
    <article class="kpi-card">
      <div class="kpi-label">${escapeHtml(item.label)}</div>
      <div class="kpi-value">${escapeHtml(item.formatter(item.value))}</div>
      <div class="kpi-meta">
        <span>${escapeHtml(item.helper)}</span>
        ${delta(item.current, item.previous, item.pointDiff)}
      </div>
      ${sparkline(item.rows, item.metric)}
    </article>
  `).join("");
}

function renderChartGrid(id, cards) {
  document.getElementById(id).innerHTML = cards.join("");
}

function lineChartCard(title, rows, labelKey, valueKey, formatter) {
  const latest = rows[rows.length - 1];
  return `
    <article class="chart-card">
      <div class="chart-title">
        <span>${escapeHtml(title)}</span>
        <span>${latest ? escapeHtml(formatter(latest[valueKey])) : "-"}</span>
      </div>
      ${lineChart(rows, labelKey, valueKey)}
    </article>
  `;
}

function sparkline(rows, metric) {
  if (!rows.length) return `<svg class="sparkline" viewBox="0 0 160 34" aria-hidden="true"></svg>`;
  const points = chartPoints(rows, metric, 160, 34, 3);
  const area = `0,34 ${points} 160,34`;
  return `
    <svg class="sparkline" viewBox="0 0 160 34" aria-hidden="true">
      <polygon class="area" points="${area}"></polygon>
      <polyline points="${points}"></polyline>
    </svg>
  `;
}

function lineChart(rows, labelKey, valueKey) {
  const width = 520;
  const height = 180;
  const points = chartPoints(rows, valueKey, width, height, 18);
  const circles = points.split(" ").map((point) => {
    const [x, y] = point.split(",");
    return `<circle class="point" cx="${x}" cy="${y}" r="3"></circle>`;
  }).join("");
  const first = rows[0]?.[labelKey] || "";
  const last = rows[rows.length - 1]?.[labelKey] || "";
  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(valueKey)} trend">
      <line class="grid-line" x1="0" y1="42" x2="${width}" y2="42"></line>
      <line class="grid-line" x1="0" y1="92" x2="${width}" y2="92"></line>
      <line class="grid-line" x1="0" y1="142" x2="${width}" y2="142"></line>
      <polyline points="${points}"></polyline>
      ${circles}
      <text x="0" y="176" fill="#647184" font-size="12">${escapeHtml(first)}</text>
      <text x="${width}" y="176" text-anchor="end" fill="#647184" font-size="12">${escapeHtml(last)}</text>
    </svg>
  `;
}

function chartPoints(rows, metric, width, height, pad) {
  if (rows.length === 1) {
    const y = height / 2;
    return `${pad},${y} ${width - pad},${y}`;
  }
  const values = rows.map((row) => Number(row[metric] || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = pad + index * ((width - pad * 2) / (values.length - 1));
    const y = pad + (1 - ((value - min) / range)) * (height - pad * 2);
    return `${round(x)},${round(y)}`;
  }).join(" ");
}

function renderFunnel(id, steps) {
  const max = Math.max(...steps.map((step) => Number(step[1] || 0)), 1);
  document.getElementById(id).innerHTML = steps.map(([label, value, helper]) => {
    const width = Math.max(Number(value || 0) / max * 100, 1);
    return `
      <div class="funnel-step">
        <div class="funnel-head">
          <span>${escapeHtml(label)}</span>
          <span>${fmtInt(value)} · ${escapeHtml(helper)}</span>
        </div>
        <div class="funnel-track">
          <div class="funnel-fill" style="width:${width}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderBars(id, rows, labelKey, valueKey, valueLabel) {
  const max = Math.max(...rows.map((row) => Number(row[valueKey] || 0)), 1);
  document.getElementById(id).innerHTML = rows.map((row) => {
    const width = Math.max(Number(row[valueKey] || 0) / max * 100, 1);
    const label = row[labelKey] || "-";
    return `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-value">${valueLabel(row)}</div>
      </div>
    `;
  }).join("");
}

function metaKeys(level) {
  if (level === "campaigns") return ["campaign_name"];
  if (level === "adsets") return ["campaign_name", "adset_name"];
  if (level === "ads") return ["campaign_name", "adset_name", "ad_name"];
  return ["campaign_name", "adset_name", "ad_name", "placement"];
}

function renderMetaHead(keys) {
  const entityHeaders = keys.map((key) => `<th>${metaHeaderLabel(key)}</th>`).join("");
  document.getElementById("metaTableHead").innerHTML = `
    <tr>
      <th>기간</th>
      ${entityHeaders}
      <th class="num">노출</th>
      <th class="num">클릭</th>
      <th class="num">전환</th>
      <th class="num">비용</th>
      <th class="num">CTR</th>
      <th class="num">CVR</th>
      <th class="num">CPA</th>
      <th class="num">ROAS</th>
    </tr>
  `;
}

function renderMetaTable(grouped, previousMap, keys) {
  const sorted = grouped
    .filter((row) => row.impressions || row.spend)
    .sort((a, b) => b.period.localeCompare(a.period) || b.spend - a.spend)
    .slice(0, 400);

  document.getElementById("metaTable").innerHTML = sorted.map((row) => {
    const previous = previousMap.get(previousKey(row, keys));
    const entityCells = keys.map((key) => `<td>${escapeHtml(row[key] || "-")}</td>`).join("");
    const cpa = row.conversions ? row.spend / row.conversions : 0;
    const previousCpa = previous?.conversions ? previous.spend / previous.conversions : null;
    return `
      <tr>
        <td>${escapeHtml(row.period)}</td>
        ${entityCells}
        <td class="num">${fmtInt(row.impressions)}${delta(row.impressions, previous?.impressions)}</td>
        <td class="num">${fmtInt(row.clicks)}${delta(row.clicks, previous?.clicks)}</td>
        <td class="num">${fmtInt(row.conversions)}${delta(row.conversions, previous?.conversions)}</td>
        <td class="num">${fmtMoney(row.spend)}${delta(row.spend, previous?.spend)}</td>
        <td class="num">${fmtPct(row.ctr)}${delta(row.ctr, previous?.ctr, true)}</td>
        <td class="num">${fmtPct(row.cvr)}${delta(row.cvr, previous?.cvr, true)}</td>
        <td class="num">${fmtMoney(cpa)}${delta(cpa, previousCpa)}</td>
        <td class="num">${fmtDecimal(row.roas)}${delta(row.roas, previous?.roas, true)}</td>
      </tr>
    `;
  }).join("");
}

function aggregateRows(rows, keys, metrics) {
  const map = new Map();
  rows.forEach((raw) => {
    const row = { ...raw, period: periodKey(raw.date) };
    const key = keys.map((field) => row[field] || "").join("||");
    if (!map.has(key)) {
      const base = {};
      keys.forEach((field) => {
        base[field] = row[field] || "";
      });
      Object.keys(metrics).forEach((metric) => {
        base[metric] = 0;
      });
      map.set(key, base);
    }
    const target = map.get(key);
    Object.keys(metrics).forEach((metric) => {
      target[metric] += Number(row[metric] || 0);
    });
  });
  return Array.from(map.values());
}

function sumRows(rows, metrics) {
  const total = {};
  metrics.forEach((metric) => {
    total[metric] = rows.reduce((sum, row) => sum + Number(row[metric] || 0), 0);
  });
  return total;
}

function addGa4Rates(row) {
  row.detail_view_rate = row.sessions ? row.detail_views / row.sessions * 100 : 0;
  row.purchase_rate = row.sessions ? row.purchases / row.sessions * 100 : 0;
  row.detail_to_purchase_rate = row.detail_views ? row.purchases / row.detail_views * 100 : 0;
}

function addMetaRates(row) {
  row.ctr = row.impressions ? row.clicks / row.impressions * 100 : 0;
  row.cvr = row.clicks ? row.conversions / row.clicks * 100 : 0;
  row.roas = row.spend ? row.conversion_value / row.spend : 0;
}

function buildPreviousMap(rows, keys) {
  const byEntity = new Map();
  rows.forEach((row) => {
    const entityKey = keys.map((key) => row[key] || "").join("||");
    if (!byEntity.has(entityKey)) byEntity.set(entityKey, []);
    byEntity.get(entityKey).push(row);
  });
  const previous = new Map();
  byEntity.forEach((items) => {
    items.sort(sortPeriodAsc);
    for (let i = 1; i < items.length; i += 1) {
      previous.set(previousKey(items[i], keys), items[i - 1]);
    }
  });
  return previous;
}

function previousKey(row, keys) {
  return [row.period, ...keys.map((key) => row[key] || "")].join("||");
}

function filterByDate(rows) {
  return rows.filter((row) => {
    const value = row.date;
    return (!state.startDate || value >= state.startDate) && (!state.endDate || value <= state.endDate);
  });
}

function periodKey(dateValue) {
  if (state.granularity === "day") return dateValue;
  const date = parseLocalDate(dateValue);
  if (state.granularity === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  const monday = new Date(date);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  return `${monday.getFullYear()}-W${weekNumber(monday)}`;
}

function weekNumber(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return String(Math.ceil((((target - yearStart) / 86400000) + 1) / 7)).padStart(2, "0");
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function sortPeriodAsc(a, b) {
  return a.period.localeCompare(b.period);
}

function delta(current, previous, pointDiff = false) {
  if (previous === undefined || previous === null || Number(previous) === 0) {
    return `<span class="delta flat">-</span>`;
  }
  const diff = Number(current || 0) - Number(previous || 0);
  const pct = diff / Math.abs(Number(previous)) * 100;
  const className = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const text = pointDiff ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}` : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
  return `<span class="delta ${className}">${text}</span>`;
}

function metaHeaderLabel(key) {
  return {
    campaign_name: "캠페인",
    adset_name: "광고세트",
    ad_name: "광고",
    placement: "Placement",
  }[key] || key;
}

function metaDisplayLabel(row) {
  if (state.metaLevel === "placements") return `${row.ad_name || "-"} · ${row.placement || "-"}`;
  if (state.metaLevel === "ads") return row.ad_name || "-";
  if (state.metaLevel === "adsets") return row.adset_name || "-";
  return row.campaign_name || "-";
}

function fmtInt(value) {
  return Math.round(Number(value || 0)).toLocaleString("ko-KR");
}

function fmtMoney(value) {
  return `₩${Math.round(Number(value || 0)).toLocaleString("ko-KR")}`;
}

function fmtPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function fmtDecimal(value) {
  return Number(value || 0).toFixed(2);
}

function formatGeneratedAt(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR");
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();

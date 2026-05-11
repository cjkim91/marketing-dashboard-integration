const state = {
  data: null,
  page: "ga4",
  granularity: "week",
  metaLevel: "campaigns",
  startDate: "",
  endDate: "",
};

const metricLabels = {
  impressions: "노출",
  clicks: "클릭",
  conversions: "전환",
  spend: "비용",
  ctr: "CTR",
  cvr: "CVR",
  roas: "ROAS",
  sessions: "유입",
  detail_views: "상세조회",
  purchases: "구매",
  revenue: "매출",
};

const metaLevelLabels = {
  campaigns: "캠페인",
  adsets: "광고세트",
  ads: "광고",
  placements: "Placement",
};

async function init() {
  bindControls();
  try {
    const response = await fetch("./data/dashboard.json", { cache: "no-store" });
    if (!response.ok) throw new Error("dashboard.json not found");
    state.data = await response.json();
    state.startDate = state.data.period?.since || "";
    state.endDate = state.data.period?.until || "";
    document.getElementById("dataStatus").textContent = `생성 시각: ${formatGeneratedAt(state.data.generated_at)}`;
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
  const grouped = aggregateRows(rows, ["period", "channel", "source", "medium", "campaign"], {
    sessions: "sum",
    users: "sum",
    detail_views: "sum",
    purchases: "sum",
    revenue: "sum",
  });
  grouped.forEach(addGa4Rates);

  const totals = sumRows(grouped, ["sessions", "users", "detail_views", "purchases", "revenue"]);
  addGa4Rates(totals);
  renderSummary("ga4Summary", [
    ["유입", fmtInt(totals.sessions), `${fmtInt(totals.users)} users`],
    ["상세페이지 조회", fmtInt(totals.detail_views), `${fmtPct(totals.detail_view_rate)} / 유입`],
    ["구매", fmtInt(totals.purchases), `${fmtPct(totals.purchase_rate)} / 유입`],
    ["매출", fmtMoney(totals.revenue), "purchase revenue"],
  ]);

  const channelRows = aggregateRows(rows, ["channel"], {
    sessions: "sum",
    detail_views: "sum",
    purchases: "sum",
    revenue: "sum",
  }).sort((a, b) => b.sessions - a.sessions);
  channelRows.forEach(addGa4Rates);
  renderBars("ga4FunnelChart", channelRows.slice(0, 8), "channel", "sessions", (row) => {
    return `${fmtInt(row.sessions)} 유입 · ${fmtInt(row.detail_views)} 상세 · ${fmtInt(row.purchases)} 구매`;
  });

  const sorted = grouped
    .filter((row) => row.sessions || row.detail_views || row.purchases)
    .sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      return b.sessions - a.sessions;
    })
    .slice(0, 250);

  document.getElementById("ga4Table").innerHTML = sorted.map((row) => `
    <tr>
      <td>${escapeHtml(row.period)}</td>
      <td>${escapeHtml(row.channel)}</td>
      <td>${escapeHtml(row.source)} / ${escapeHtml(row.medium)}</td>
      <td>${escapeHtml(row.campaign)}</td>
      <td class="num">${fmtInt(row.sessions)}</td>
      <td class="num">${fmtInt(row.detail_views)}</td>
      <td class="num">${fmtInt(row.purchases)}</td>
      <td class="num">${fmtPct(row.purchase_rate)}</td>
      <td class="num">${fmtMoney(row.revenue)}</td>
    </tr>
  `).join("");
}

function renderMeta() {
  const rows = filterByDate(state.data.meta?.[state.metaLevel] || []);
  const keys = metaKeys(state.metaLevel);
  const grouped = aggregateRows(rows, ["period", ...keys], {
    impressions: "sum",
    clicks: "sum",
    conversions: "sum",
    spend: "sum",
    conversion_value: "sum",
  });
  grouped.forEach(addMetaRates);
  const previousMap = buildPreviousMap(grouped, keys);

  const totals = sumRows(grouped, ["impressions", "clicks", "conversions", "spend", "conversion_value"]);
  addMetaRates(totals);
  renderSummary("metaSummary", [
    ["노출", fmtInt(totals.impressions), "Meta delivery"],
    ["클릭", fmtInt(totals.clicks), `${fmtPct(totals.ctr)} CTR`],
    ["전환", fmtInt(totals.conversions), `${fmtPct(totals.cvr)} CVR`],
    ["비용", fmtMoney(totals.spend), `${fmtDecimal(totals.roas)} ROAS`],
  ]);

  const trendRows = aggregateRows(rows, ["period"], {
    spend: "sum",
    conversions: "sum",
    clicks: "sum",
    impressions: "sum",
    conversion_value: "sum",
  }).sort((a, b) => a.period.localeCompare(b.period));
  trendRows.forEach(addMetaRates);
  renderBars("metaTrendChart", trendRows, "period", "spend", (row) => {
    return `${fmtMoney(row.spend)} · ${fmtInt(row.conversions)} 전환 · ${fmtPct(row.ctr)} CTR`;
  });

  document.getElementById("metaTableTitle").textContent = `${metaLevelLabels[state.metaLevel]}별 성과`;
  renderMetaHead(keys);
  renderMetaTable(grouped, previousMap, keys);
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
      <th class="num">ROAS</th>
    </tr>
  `;
}

function renderMetaTable(grouped, previousMap, keys) {
  const sorted = grouped
    .filter((row) => row.impressions || row.spend)
    .sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      return b.spend - a.spend;
    })
    .slice(0, 300);

  document.getElementById("metaTable").innerHTML = sorted.map((row) => {
    const previous = previousMap.get(previousKey(row, keys));
    const entityCells = keys.map((key) => `<td>${escapeHtml(row[key] || "-")}</td>`).join("");
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
    items.sort((a, b) => a.period.localeCompare(b.period));
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

function renderSummary(id, items) {
  document.getElementById(id).innerHTML = items.map(([label, value, helper]) => `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(helper)}</small>
    </article>
  `).join("");
}

function renderBars(id, rows, labelKey, valueKey, valueLabel) {
  const max = Math.max(...rows.map((row) => Number(row[valueKey] || 0)), 1);
  document.getElementById(id).innerHTML = rows.map((row) => {
    const width = Math.max(Number(row[valueKey] || 0) / max * 100, 1);
    return `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHtml(row[labelKey] || "-")}">${escapeHtml(row[labelKey] || "-")}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-value">${escapeHtml(valueLabel(row))}</div>
      </div>
    `;
  }).join("");
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();

const $ = (id) => document.getElementById(id);
const LIVE_CACHE_KEY = "nasdaq-alert-live-data-v2";
const FETCH_TIMEOUT_MS = 8000;

const INDICES = [
  {
    key: "ndx",
    symbol: "^NDX",
    displaySymbol: "Nasdaq-100 (^NDX)",
    messageName: "Nasdaq-100"
  },
  {
    key: "spx",
    symbol: "^GSPC",
    displaySymbol: "S&P 500 (^GSPC)",
    messageName: "S&P 500"
  }
];

function yahooUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
}

function proxyUrl(url) {
  return "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
}

function proxyUrls(url) {
  return [
    { url, source: "Yahoo chart API" },
    { url: proxyUrl(url), source: "Yahoo chart API + AllOrigins proxy" },
    { url: "https://corsproxy.io/?" + encodeURIComponent(url), source: "Yahoo chart API + CORS proxy" }
  ];
}

function fmtNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtTime(value) {
  if (!value) return "暂无更新时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function setMessage(text) {
  $("messageBox").textContent = text;
}
function saveLiveCache(items) {
  const okItems = items.filter((item) => item.ok);
  if (!okItems.length) return;
  try {
    const merged = new Map();
    const existing = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) || "null");
    if (existing && Array.isArray(existing.indices)) {
      existing.indices.forEach((item) => merged.set(item.key, item));
    }
    okItems.forEach((item) => merged.set(item.key, item));
    localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({
      saved_at: new Date().toISOString(),
      indices: Array.from(merged.values())
    }));
  } catch (error) {
    // Local storage can be disabled in private browsing; ignore cache failures.
  }
}

function loadLiveCache() {
  try {
    const raw = localStorage.getItem(LIVE_CACHE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.indices) || !cached.indices.length) return false;
    renderAll(cached.indices, { fromCache: true, savedAt: cached.saved_at });
    return true;
  } catch (error) {
    return false;
  }
}

const MARKET_TIME_ZONE = "America/New_York";
const BEIJING_TIME_ZONE = "Asia/Shanghai";
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday]
  };
}

function getTimeZoneOffsetMs(timeZone, date) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - date.getTime();
}

function makeZonedDate(timeZone, year, month, day, hour, minute) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const firstOffset = getTimeZoneOffsetMs(timeZone, utcGuess);
  const firstPass = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(timeZone, firstPass);
  return new Date(utcGuess.getTime() - secondOffset);
}

function isTradingWeekday(parts) {
  return parts.weekday >= 1 && parts.weekday <= 5;
}

function formatBeijingTime(date) {
  return date.toLocaleString("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatEasternTime(date) {
  return date.toLocaleString("zh-CN", {
    timeZone: MARKET_TIME_ZONE,
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function findNextMarketOpen(now) {
  const base = getZonedParts(now, MARKET_TIME_ZONE);
  for (let offset = 0; offset < 10; offset += 1) {
    const candidate = makeZonedDate(MARKET_TIME_ZONE, base.year, base.month, base.day + offset, 9, 30);
    const candidateParts = getZonedParts(candidate, MARKET_TIME_ZONE);
    if (isTradingWeekday(candidateParts) && candidate > now) return candidate;
  }
  return null;
}

function getMarketStatus(now = new Date()) {
  const parts = getZonedParts(now, MARKET_TIME_ZONE);
  const minutes = parts.hour * 60 + parts.minute;
  const nextOpen = findNextMarketOpen(now);

  if (!isTradingWeekday(parts)) {
    return {
      status: "美股休市",
      reason: "当前为周末",
      nextOpen,
      hint: "周末行情通常不会实时变化，页面数据可能停留在上一个交易日。"
    };
  }

  if (minutes < MARKET_OPEN_MINUTES) {
    return {
      status: "盘前未开盘",
      reason: "未到常规交易时段",
      nextOpen,
      hint: "常规交易开始后，价格变化会更接近实时行情。"
    };
  }

  if (minutes >= MARKET_OPEN_MINUTES && minutes < MARKET_CLOSE_MINUTES) {
    const closeTime = makeZonedDate(MARKET_TIME_ZONE, parts.year, parts.month, parts.day, 16, 0);
    return {
      status: "美股交易中",
      reason: "常规交易时段",
      nextOpen: closeTime,
      nextOpenLabel: "今日收盘",
      hint: "当前处于美股常规交易时段，点击按钮可以刷新最新数据。"
    };
  }

  return {
    status: "美股已收盘",
    reason: "今日常规交易结束",
    nextOpen,
    hint: "收盘后价格通常变化较少，下一次明显更新通常在下个交易日开盘后。"
  };
}

function renderMarketStatus() {
  const market = getMarketStatus();
  const label = market.nextOpenLabel || "下次开盘";
  $("marketStatusText").textContent = market.status;
  $("marketReason").textContent = market.reason;
  $("nextOpenTime").textContent = market.nextOpen ? `${label}：北京时间 ${formatBeijingTime(market.nextOpen)}` : "--";
  $("marketEtTime").textContent = formatEasternTime(new Date());
  $("marketHint").textContent = market.hint;
}

function normalizeYahooChart(payload, source, indexConfig) {
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  if (!result) throw new Error("行情接口没有返回有效数据");

  const meta = result.meta || {};
  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  const closes = ((quote && quote.close) || []).filter((v) => v !== null && Number(v) > 0).map(Number);
  if (closes.length < 2 && !meta.previousClose && !meta.chartPreviousClose) throw new Error("收盘价数据不足");

  const currentPrice = Number(meta.regularMarketPrice || closes[closes.length - 1]);
  const previousClose = Number(meta.previousClose || meta.chartPreviousClose || closes[closes.length - 2]);
  if (!currentPrice || !previousClose) throw new Error("价格字段为空");

  const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
  const timestamp = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString();
  const recentCloses = closes.slice(-5);

  return {
    ok: true,
    key: indexConfig.key,
    source,
    symbol: indexConfig.symbol,
    display_symbol: indexConfig.displaySymbol,
    message_name: indexConfig.messageName,
    current_price: currentPrice,
    previous_close: previousClose,
    change_percent: changePercent,
    recent_closes: recentCloses,
    updated_at: timestamp,
    error: null
  };
}

async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIndexData(indexConfig) {
  const url = yahooUrl(indexConfig.symbol);
  const candidates = proxyUrls(url);
  const errors = [];

  for (const candidate of candidates) {
    try {
      const payload = await fetchJson(candidate.url);
      return normalizeYahooChart(payload, candidate.source, indexConfig);
    } catch (error) {
      errors.push(`${candidate.source}: ${error.message}`);
    }
  }

  throw new Error(errors[0] || "行情接口暂时不可用");
}

async function fetchLiveData() {
  const results = await Promise.allSettled(INDICES.map(fetchIndexData));
  return results.map((result, index) => {
    const config = INDICES[index];
    if (result.status === "fulfilled") return result.value;
    return {
      ok: false,
      key: config.key,
      symbol: config.symbol,
      display_symbol: config.displaySymbol,
      message_name: config.messageName,
      error: result.reason && result.reason.message ? result.reason.message : "刷新失败"
    };
  });
}

function fmtSignedPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  const number = Number(value);
  return (number >= 0 ? "+" : "") + number.toFixed(2) + "%";
}

function setTone(element, value) {
  element.className = "change " + (value > 0 ? "up" : value < 0 ? "down" : "flat");
}

function renderSparkline(key, values) {
  const container = $(`${key}Sparkline`);
  const trend = $(`${key}SparklineTrend`);
  const prices = (values || []).map(Number).filter((value) => Number.isFinite(value) && value > 0).slice(-5);

  if (!container || !trend) return;

  if (prices.length < 2) {
    container.innerHTML = `<div class="sparkline-empty">等待数据</div>`;
    trend.textContent = "--";
    trend.className = "change flat";
    return;
  }

  const width = 240;
  const height = 70;
  const padding = 8;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const points = prices.map((price, index) => {
    const x = padding + (index * (width - padding * 2)) / (prices.length - 1);
    const y = height - padding - ((price - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const first = prices[0];
  const last = prices[prices.length - 1];
  const changePercent = ((last - first) / first) * 100;
  const tone = changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat";
  const label = fmtSignedPercent(changePercent);

  trend.textContent = label;
  trend.className = `change ${tone}`;
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="最近 5 日走势 ${label}" preserveAspectRatio="none">
      <polyline class="sparkline-grid" points="${padding},${height / 2} ${width - padding},${height / 2}"></polyline>
      <polyline class="sparkline-line ${tone}" points="${points}"></polyline>
    </svg>
  `;
}

function setChange(element, value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    element.textContent = "--";
    element.className = "change flat";
    return;
  }

  const change = Number(value);
  element.textContent = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
  element.className = "change " + (change > 0 ? "up" : change < 0 ? "down" : "flat");
}

function renderIndex(data) {
  const key = data.key;
  const badge = $(`${key}Badge`);
  const changeEl = $(`${key}ChangePercent`);

  $(`${key}Symbol`).textContent = data.display_symbol || data.symbol || "--";
  $(`${key}CurrentPrice`).textContent = fmtNumber(data.current_price);
  $(`${key}PreviousClose`).textContent = fmtNumber(data.previous_close);
  setChange(changeEl, data.change_percent);
  $(`${key}UpdatedAt`).textContent = data.ok ? "数据更新时间：" + fmtTime(data.updated_at) : "暂未获取到最新数据";
  renderSparkline(key, data.recent_closes);

  badge.className = "mini-badge";
  if (data.ok) {
    badge.textContent = "已更新";
    if (Number(data.change_percent) > 0) badge.classList.add("up");
    if (Number(data.change_percent) < 0) badge.classList.add("down");
  } else {
    badge.textContent = "未更新";
    badge.classList.add("warn");
  }
}

function renderRelativeInsight(dataByKey) {
  const ndx = dataByKey.get("ndx");
  const spx = dataByKey.get("spx");
  const summary = $("relativeSummary");
  const ndxEl = $("relativeNdx");
  const spxEl = $("relativeSpx");
  const spreadEl = $("relativeSpread");
  const detail = $("relativeDetail");

  if (!ndx || !spx || !ndx.ok || !spx.ok || Number.isNaN(Number(ndx.change_percent)) || Number.isNaN(Number(spx.change_percent))) {
    summary.textContent = "等待数据刷新";
    ndxEl.textContent = "--";
    spxEl.textContent = "--";
    spreadEl.textContent = "--";
    detail.textContent = "刷新后会自动判断科技股今天是强于还是弱于大盘。";
    setTone(summary, 0);
    return null;
  }

  const ndxChange = Number(ndx.change_percent);
  const spxChange = Number(spx.change_percent);
  const spread = ndxChange - spxChange;
  const absSpread = Math.abs(spread).toFixed(2);

  ndxEl.textContent = fmtSignedPercent(ndxChange);
  spxEl.textContent = fmtSignedPercent(spxChange);
  spreadEl.textContent = (spread >= 0 ? "+" : "") + spread.toFixed(2) + " 个百分点";
  setTone(ndxEl, ndxChange);
  setTone(spxEl, spxChange);
  setTone(spreadEl, spread);

  if (Math.abs(spread) < 0.15) {
    summary.textContent = "科技股与大盘接近";
    detail.textContent = `纳指 100 与标普 500 的涨跌幅只差 ${absSpread} 个百分点，今天表现比较接近。`;
    setTone(summary, 0);
  } else if (spread > 0) {
    summary.textContent = "科技股强于大盘";
    detail.textContent = `纳指 100 跑赢标普 500 ${absSpread} 个百分点，说明科技/成长方向今天更强。`;
    setTone(summary, 1);
  } else {
    summary.textContent = "科技股弱于大盘";
    detail.textContent = `纳指 100 跑输标普 500 ${absSpread} 个百分点，说明科技/成长方向今天弱于整体市场。`;
    setTone(summary, -1);
  }

  return {
    spread,
    summary: summary.textContent,
    detail: detail.textContent
  };
}
function renderAll(items, options = {}) {
  const dataByKey = new Map(items.map((item) => [item.key, item]));
  INDICES.forEach((config) => {
    const data = dataByKey.get(config.key) || {
      ok: false,
      key: config.key,
      symbol: config.symbol,
      display_symbol: config.displaySymbol,
      error: "暂无数据"
    };
    renderIndex(data);
  });

  const relativeInsight = renderRelativeInsight(dataByKey);
  const okItems = items.filter((item) => item.ok);
  const failedItems = items.filter((item) => !item.ok);
  const status = $("dataStatus");
  status.classList.toggle("warn", okItems.length === 0);
  status.textContent = okItems.length > 0 ? "数据已更新" : "数据待更新";

  const sources = [...new Set(okItems.map((item) => item.source).filter(Boolean))];
  $("source").textContent = sources.length ? sources.join(" / ") : "--";

  if (okItems.length > 0) {
    const lines = okItems.map((item) => {
      const change = item.change_percent >= 0 ? `+${item.change_percent.toFixed(2)}%` : `${item.change_percent.toFixed(2)}%`;
      return `${item.display_symbol}：${change}，当前 ${fmtNumber(item.current_price)}`;
    });
    const failedText = failedItems.length ? `\n\n未更新：${failedItems.map((item) => item.display_symbol).join("、")}，可以稍后再点一次刷新。` : "";
    const insightText = relativeInsight ? `\n\n相对表现：${relativeInsight.summary}。${relativeInsight.detail}` : "";
    const cacheText = options.fromCache ? `\n\n已先显示本机缓存，正在后台刷新最新行情。缓存时间：${fmtTime(options.savedAt)}` : "";
    setMessage(`数据读取成功。\n${lines.join("\n")}\n更新时间：${fmtTime(okItems[0].updated_at)}${insightText}${cacheText}${failedText}`);
  } else {
    setMessage(`暂时没有最新数据。\n\n原因：${failedItems.map((item) => `${item.display_symbol}：${item.error}`).join("\n")}\n\n这是公开静态页面，只负责展示数据；通知功能仍在你的本地电脑运行。`);
  }
}

function renderLegacyCachedData(data) {
  renderAll([
    {
      ok: Boolean(data.ok),
      key: "ndx",
      source: data.source,
      symbol: data.symbol || "^NDX",
      display_symbol: data.display_symbol || "Nasdaq-100 (^NDX)",
      current_price: data.current_price,
      previous_close: data.previous_close,
      change_percent: data.change_percent,
      recent_closes: data.recent_closes,
      updated_at: data.updated_at,
      error: data.error
    }
  ]);
}

async function loadCachedData() {
  try {
    const response = await fetch("data.json?ts=" + Date.now(), { cache: "no-store" });
    const data = await response.json();
    if (Array.isArray(data.indices)) renderAll(data.indices);
    else if (data.indices && typeof data.indices === "object") renderAll(Object.values(data.indices));
    else renderLegacyCachedData(data);
  } catch (error) {
    renderAll(INDICES.map((config) => ({
      ok: false,
      key: config.key,
      symbol: config.symbol,
      display_symbol: config.displaySymbol,
      error: "本地缓存 data.json 读取失败：" + error.message
    })));
  }
}

async function refreshLive() {
  const button = $("refreshButton");
  button.disabled = true;
  button.textContent = "刷新中...";
  $("dataStatus").textContent = "刷新中";
  INDICES.forEach((config) => {
    const badge = $(`${config.key}Badge`);
    badge.textContent = "刷新中";
    badge.className = "mini-badge warn";
  });
  setMessage("正在实时请求 Nasdaq-100 和 S&P 500 数据，请稍等...");

  try {
    const startedAt = performance.now();
    const data = await fetchLiveData();
    saveLiveCache(data);
    renderAll(data);
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    setMessage($("messageBox").textContent + `\n\n刷新耗时：${elapsedSeconds} 秒。`);
  } catch (error) {
    setMessage("实时刷新失败：" + error.message + "\n\n我会保留页面上的缓存数据。你可以稍后再点一次刷新。");
    $("dataStatus").textContent = "刷新失败";
    $("dataStatus").classList.add("warn");
  } finally {
    button.disabled = false;
    button.textContent = "实时刷新";
  }
}

$("refreshButton").addEventListener("click", refreshLive);
renderMarketStatus();
setInterval(renderMarketStatus, 60000);
if (!loadLiveCache()) loadCachedData();
setTimeout(refreshLive, 80);













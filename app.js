const $ = (id) => document.getElementById(id);
const LIVE_CACHE_KEY = "nasdaq-alert-live-data-v2";
const AGENT_MEMORY_KEY = "nasdaq-alert-agent-memory-v1";
const BROWSER_NOTIFY_KEY = "nasdaq-alert-browser-notify-v1";
const BROWSER_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
let latestAgentItems = [];
let latestAgentOptions = {};
let latestRelativeInsight = null;
let latestAgentTrace = null;

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

function makeTraceId() {
  return "trace-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 6);
}

function startAgentTrace(trigger) {
  latestAgentTrace = {
    id: makeTraceId(),
    trigger,
    status: "running",
    summary: "Agent 正在观察",
    started_at: new Date().toISOString(),
    started_ms: performance.now(),
    duration_ms: null,
    steps: []
  };
  renderAgentTrace(latestAgentTrace);
  return latestAgentTrace;
}

function addTraceStep(trace, name, status = "success", detail = "", durationMs = 0) {
  if (!trace) return;
  trace.steps.push({
    name,
    status,
    detail,
    duration_ms: Math.max(0, Math.round(durationMs)),
    at: new Date().toISOString()
  });
  renderAgentTrace(trace);
}

function finishAgentTrace(trace, status = "success", summary = "Agent 检查完成") {
  if (!trace) return;
  trace.status = status;
  trace.summary = summary;
  trace.duration_ms = Math.max(0, Math.round(performance.now() - trace.started_ms));
  renderAgentTrace(trace);
}

function traceStatusLabel(status) {
  if (status === "running") return "运行中";
  if (status === "success") return "成功";
  if (status === "warning") return "部分成功";
  if (status === "error") return "失败";
  if (status === "skipped") return "跳过";
  return status || "未知";
}

function traceTriggerLabel(trigger) {
  const labels = {
    live_refresh: "实时刷新",
    browser_cache: "浏览器缓存",
    page_data: "页面数据",
    agent_check: "Agent 检查"
  };
  return labels[trigger] || trigger || "--";
}

function renderAgentTrace(trace = latestAgentTrace) {
  const summary = $("traceSummary");
  const id = $("traceId");
  const trigger = $("traceTrigger");
  const status = $("traceStatus");
  const duration = $("traceDuration");
  const steps = $("traceSteps");
  if (!summary || !id || !trigger || !status || !duration || !steps) return;

  if (!trace) {
    summary.textContent = "等待追踪";
    id.textContent = "trace --";
    trigger.textContent = "--";
    status.textContent = "等待";
    duration.textContent = "--";
    steps.innerHTML = `<div class="trace-empty">刷新或点击 Agent 检查后，这里会显示每一步做了什么。</div>`;
    return;
  }

  summary.textContent = trace.summary || "Agent Trace";
  id.textContent = trace.id.replace("trace-", "#");
  trigger.textContent = traceTriggerLabel(trace.trigger);
  status.textContent = traceStatusLabel(trace.status);
  status.className = `trace-status ${trace.status}`;
  duration.textContent = trace.duration_ms === null ? "运行中" : `${trace.duration_ms} ms`;

  if (!trace.steps.length) {
    steps.innerHTML = `<div class="trace-empty">Trace 已创建，等待步骤写入。</div>`;
    return;
  }

  steps.innerHTML = trace.steps.map((step, index) => `
    <div class="trace-step ${step.status}">
      <span>${index + 1}</span>
      <div>
        <div class="trace-step-top">
          <b>${step.name}</b>
          <em>${traceStatusLabel(step.status)} · ${step.duration_ms} ms</em>
        </div>
        <p>${step.detail || "--"}</p>
      </div>
    </div>
  `).join("");
}
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
function getBrowserNotifyState() {
  try {
    const raw = localStorage.getItem(BROWSER_NOTIFY_KEY);
    return raw ? JSON.parse(raw) : { enabled: false, last_up_at: null, last_down_at: null };
  } catch (error) {
    return { enabled: false, last_up_at: null, last_down_at: null };
  }
}

function saveBrowserNotifyState(state) {
  try {
    localStorage.setItem(BROWSER_NOTIFY_KEY, JSON.stringify(state));
  } catch (error) {
    // Ignore local storage failures.
  }
}

function updateBrowserNotifyStatus() {
  const status = $("browserNotifyStatus");
  const enableButton = $("enableBrowserNotifyButton");
  const disableButton = $("disableBrowserNotifyButton");
  if (!status || !enableButton) return;

  if (!("Notification" in window)) {
    status.textContent = "当前浏览器不支持";
    enableButton.disabled = true;
    if (disableButton) disableButton.disabled = true;
    return;
  }

  const state = getBrowserNotifyState();
  if (Notification.permission === "granted" && state.enabled) {
    status.textContent = "已开启";
    enableButton.textContent = "已开启网页通知";
    enableButton.disabled = true;
    if (disableButton) disableButton.disabled = false;
  } else if (Notification.permission === "denied") {
    status.textContent = "浏览器已拒绝";
    enableButton.textContent = "已被浏览器拒绝";
    enableButton.disabled = true;
    if (disableButton) disableButton.disabled = true;
  } else if (Notification.permission === "granted" && !state.enabled) {
    status.textContent = "已关闭";
    enableButton.textContent = "重新开启网页通知";
    enableButton.disabled = false;
    if (disableButton) disableButton.disabled = true;
  } else {
    status.textContent = "未开启";
    enableButton.textContent = "开启网页通知";
    enableButton.disabled = false;
    if (disableButton) disableButton.disabled = true;
  }
}

async function enableBrowserNotifications() {
  if (!("Notification" in window)) {
    setMessage("当前浏览器不支持网页通知。\n\n你仍然可以使用页面内的 Agent 检查和观察日志。");
    updateBrowserNotifyStatus();
    return;
  }

  const permission = await Notification.requestPermission();
  const state = getBrowserNotifyState();
  state.enabled = permission === "granted";
  saveBrowserNotifyState(state);
  updateBrowserNotifyStatus();

  if (permission === "granted") {
    new Notification("Nasdaq-100 提醒已开启", {
      body: "网页通知只在当前浏览器授权后生效；达到 ±5% 阈值时会提醒。"
    });
    setMessage("网页通知已开启。\n\n当页面实时刷新发现 Nasdaq-100 达到 +5% 或 -5% 阈值时，会发送浏览器通知。");
  } else {
    setMessage("网页通知没有开启。\n\n如果你点了拒绝，需要在浏览器的网站权限里重新允许通知。");
  }
}

function disableBrowserNotifications() {
  const state = getBrowserNotifyState();
  state.enabled = false;
  saveBrowserNotifyState(state);
  updateBrowserNotifyStatus();
  setMessage("网页通知已关闭。\n\n这只会关闭本网站在当前浏览器里的通知开关；浏览器系统权限不会被网页自动撤销。以后想恢复，点击重新开启网页通知即可。");
}
function canSendBrowserNotification(direction) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const state = getBrowserNotifyState();
  if (!state.enabled) return false;

  const key = direction === "up" ? "last_up_at" : "last_down_at";
  const lastAt = state[key] ? new Date(state[key]).getTime() : 0;
  return Date.now() - lastAt > BROWSER_NOTIFY_COOLDOWN_MS;
}

function markBrowserNotificationSent(direction) {
  const state = getBrowserNotifyState();
  const key = direction === "up" ? "last_up_at" : "last_down_at";
  state[key] = new Date().toISOString();
  state.enabled = true;
  saveBrowserNotifyState(state);
}

function maybeSendBrowserAlert(items, options = {}) {
  if (!options.allowNotify) return "disabled";
  const ndx = items.find((item) => item.key === "ndx");
  if (!ndx || !ndx.ok || Number.isNaN(Number(ndx.change_percent))) return "no_valid_data";

  const change = Number(ndx.change_percent);
  const direction = change >= 5 ? "up" : change <= -5 ? "down" : null;
  if (!direction) return "below_threshold";
  if (!canSendBrowserNotification(direction)) return "permission_or_cooldown";

  const title = direction === "up"
    ? `Nasdaq-100 涨幅提醒：${fmtSignedPercent(change)}`
    : `Nasdaq-100 跌幅提醒：${fmtSignedPercent(change)}`;
  const body = `当前价格 ${fmtNumber(ndx.current_price)}，昨日收盘 ${fmtNumber(ndx.previous_close)}。仅供行情提醒，不构成投资建议。`;
  new Notification(title, { body });
  markBrowserNotificationSent(direction);
  return "sent";
}
function getLiveCache() {
  try {
    const raw = localStorage.getItem(LIVE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function updateCacheStatus(state, savedAt) {
  const status = $("cacheStatus");
  const hint = $("cacheHint");
  if (!status) return;

  const cache = savedAt ? { saved_at: savedAt } : getLiveCache();
  if (state === "cleared") {
    status.textContent = "已清除";
    if (hint) hint.textContent = "本机缓存已清除，下次打开会重新请求最新数据。";
    return;
  }

  if (cache && cache.saved_at) {
    status.textContent = "已缓存：" + fmtTime(cache.saved_at);
    if (hint) hint.textContent = "缓存只保存在当前浏览器，不会写入 GitHub，也不会同步给别人。";
  } else {
    status.textContent = "暂无缓存";
    if (hint) hint.textContent = "首次刷新成功后，浏览器会自动保存一份轻量缓存。";
  }
}

function clearLiveCache() {
  try {
    localStorage.removeItem(LIVE_CACHE_KEY);
  } catch (error) {
    // Ignore local storage failures.
  }
  updateCacheStatus("cleared");
  setMessage("本机缓存已清除。\n\n这只会清除当前浏览器里的行情缓存，不会影响 GitHub 页面，也不会影响别人打开网页。你可以点击实时刷新重新写入缓存。");
}

function saveLiveCache(items) {
  const okItems = items.filter((item) => item.ok);
  if (!okItems.length) return;
  try {
    const merged = new Map();
    const existing = getLiveCache();
    if (existing && Array.isArray(existing.indices)) {
      existing.indices.forEach((item) => merged.set(item.key, item));
    }
    okItems.forEach((item) => merged.set(item.key, item));
    const savedAt = new Date().toISOString();
    localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({
      saved_at: savedAt,
      indices: Array.from(merged.values())
    }));
    updateCacheStatus("saved", savedAt);
  } catch (error) {
    // Local storage can be disabled in private browsing; ignore cache failures.
  }
}

function loadLiveCache() {
  try {
    const cached = getLiveCache();
    if (!cached || !Array.isArray(cached.indices) || !cached.indices.length) return false;
    const trace = startAgentTrace("browser_cache");
    addTraceStep(trace, "读取浏览器缓存", "success", `读取到 ${cached.indices.length} 个指数的本机缓存。`, 1);
    renderAll(cached.indices, { fromCache: true, savedAt: cached.saved_at, trace });
    finishAgentTrace(trace, "success", "已先显示浏览器缓存");
    updateCacheStatus("loaded", cached.saved_at);
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
function describeAgentAge(updatedAt) {
  if (!updatedAt) return "暂无更新时间";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "更新时间格式异常";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 2) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  return `${Math.round(minutes / 60)} 小时前更新`;
}

function setAgentStep(id, text, tone = "") {
  const element = $(id);
  if (!element) return;
  element.textContent = text;
  element.className = tone ? `agent-tone ${tone}` : "";
}

function getAgentMemory() {
  try {
    const raw = localStorage.getItem(AGENT_MEMORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveAgentMemoryEntry(entry) {
  const history = [entry, ...getAgentMemory()].slice(0, 5);
  try {
    localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(history));
  } catch (error) {
    // Ignore storage failures; the Agent can still show a one-time check.
  }
  return history;
}

function getAgentSnapshot(items, relativeInsight, options = {}) {
  const ndx = items.find((item) => item.key === "ndx");
  const spx = items.find((item) => item.key === "spx");
  if (!ndx || !ndx.ok || Number.isNaN(Number(ndx.change_percent))) return null;

  return {
    checked_at: new Date().toISOString(),
    data_updated_at: ndx.updated_at || null,
    ndx_change: Number(ndx.change_percent),
    ndx_price: Number(ndx.current_price),
    spx_change: spx && spx.ok && !Number.isNaN(Number(spx.change_percent)) ? Number(spx.change_percent) : null,
    relative_summary: relativeInsight ? relativeInsight.summary : "暂无相对表现",
    market_status: getMarketStatus().status,
    source: options.fromCache ? "本机缓存" : "实时/页面数据"
  };
}

function agentToneClass(value) {
  const number = Number(value);
  if (number > 0) return "up";
  if (number < 0) return "down";
  return "flat";
}

function describeAgentMomentum(current, previous) {
  if (!previous) return "首次记录";
  const delta = Number(current.ndx_change) - Number(previous.ndx_change);
  const absDelta = Math.abs(delta);
  if (absDelta < 0.1) return "基本持平";
  return delta > 0 ? `更强 +${delta.toFixed(2)} 点` : `走弱 ${delta.toFixed(2)} 点`;
}

function renderAgentTimeline(history = getAgentMemory()) {
  const list = $("agentTimelineList");
  const count = $("agentTimelineCount");
  if (!list || !count) return;

  count.textContent = `${history.length} 条`;
  if (!history.length) {
    list.innerHTML = `<div class="agent-timeline-empty">暂无观察日志。点击 Agent 检查后，这里会显示最近 5 次轨迹。</div>`;
    return;
  }

  list.innerHTML = history.map((item, index) => {
    const previous = history[index + 1];
    const tone = agentToneClass(item.ndx_change);
    const momentum = describeAgentMomentum(item, previous);
    const momentumTone = momentum.startsWith("更强") ? "ok" : momentum.startsWith("走弱") ? "danger" : "warn";
    const market = item.market_status || "市场状态未知";
    const relative = item.relative_summary || "暂无相对表现";
    const source = item.source || "页面数据";

    return `
      <div class="agent-timeline-item">
        <div class="agent-timeline-dot ${tone}"></div>
        <div class="agent-timeline-main">
          <div class="agent-timeline-top">
            <b>${fmtTime(item.checked_at)}</b>
            <strong class="change ${tone}">${fmtSignedPercent(item.ndx_change)}</strong>
          </div>
          <p>${relative}；${market}；${source}</p>
          <span class="agent-tone ${momentumTone}">${momentum}</span>
        </div>
      </div>
    `;
  }).join("");
}
function renderAgentMemory(snapshot = null, history = getAgentMemory(), compareHistory = history) {
  const lastAt = $("agentLastCheckAt");
  const lastNdx = $("agentLastNdx");
  const deltaEl = $("agentMemoryDelta");
  const note = $("agentMemoryNote");
  if (!lastAt || !lastNdx || !deltaEl || !note) return;
  renderAgentTimeline(history);

  const last = history[0];
  if (last) {
    lastAt.textContent = fmtTime(last.checked_at);
    lastNdx.textContent = fmtSignedPercent(last.ndx_change);
    lastNdx.className = last.ndx_change > 0 ? "change up" : last.ndx_change < 0 ? "change down" : "change flat";
  } else {
    lastAt.textContent = "暂无";
    lastNdx.textContent = "--";
    lastNdx.className = "change flat";
  }

  const previous = compareHistory[0];
  if (snapshot && previous) {
    const delta = snapshot.ndx_change - Number(previous.ndx_change);
    const absDelta = Math.abs(delta);
    if (absDelta < 0.1) {
      deltaEl.textContent = "基本持平";
      deltaEl.className = "agent-tone warn";
      note.textContent = `本次与上次只差 ${absDelta.toFixed(2)} 个百分点，Agent 判断变化不大。`;
    } else if (delta > 0) {
      deltaEl.textContent = `更强 +${delta.toFixed(2)} 点`;
      deltaEl.className = "agent-tone ok";
      note.textContent = `本次纳指 100 比上次更强，Agent 会继续观察是否接近 5% 提醒阈值。`;
    } else {
      deltaEl.textContent = `走弱 ${delta.toFixed(2)} 点`;
      deltaEl.className = "agent-tone danger";
      note.textContent = `本次纳指 100 比上次走弱，Agent 会关注是否继续接近下跌提醒阈值。`;
    }
    return;
  }

  if (snapshot && !previous) {
    deltaEl.textContent = "首次记录";
    deltaEl.className = "agent-tone ok";
    note.textContent = "已经保存第一次 Agent 检查。下次检查时会自动做对比。";
    return;
  }

  if (last) {
    deltaEl.textContent = "等待本次检查";
    deltaEl.className = "agent-tone warn";
    note.textContent = "浏览器里已有 Agent 记忆，点击 Agent 检查即可和上次对比。";
  } else {
    deltaEl.textContent = "等待检查";
    deltaEl.className = "agent-tone warn";
    note.textContent = "点击 Agent 检查后，会把本次结果存在当前浏览器里。";
  }
}

function clearAgentMemory() {
  try {
    localStorage.removeItem(AGENT_MEMORY_KEY);
  } catch (error) {
    // Ignore local storage failures.
  }
  renderAgentTrace();
renderAgentMemory();
  setMessage("Agent 记忆已清除。\n\n这只会清除当前浏览器里的 Agent 检查历史，不会影响别人打开网页。下一次点击 Agent 检查会重新开始记录。");
}
function renderAgent(items, relativeInsight, options = {}) {
  const summary = $("agentSummary");
  if (!summary) return;

  latestAgentItems = items;
  latestAgentOptions = options;
  latestRelativeInsight = relativeInsight;

  const ndx = items.find((item) => item.key === "ndx");
  const spx = items.find((item) => item.key === "spx");
  const okItems = items.filter((item) => item.ok);
  const market = getMarketStatus();
  const sourceText = options.fromCache ? "本机缓存" : "实时/页面数据";
  const currentSnapshot = getAgentSnapshot(items, relativeInsight, options);
  renderAgentMemory(currentSnapshot);

  if (!okItems.length || !ndx || !ndx.ok) {
    summary.textContent = "等待可用行情";
    summary.className = "change flat";
    setAgentStep("agentStepData", "还没有拿到 Nasdaq-100 的有效价格。", "warn");
    setAgentStep("agentStepSignal", "信号不足，暂不判断强弱。", "warn");
    setAgentStep("agentStepAction", "先点一次实时刷新；如果失败，稍后再试。", "warn");
    return;
  }

  const ndxChange = Number(ndx.change_percent);
  const spxChange = spx && spx.ok ? Number(spx.change_percent) : null;
  const absChange = Math.abs(ndxChange);
  const threshold = 5;
  const distance = Math.max(0, threshold - absChange);
  const ageText = describeAgentAge(ndx.updated_at);
  const marketText = market.status;

  setAgentStep(
    "agentStepData",
    `${sourceText}已读取：Nasdaq-100 ${fmtSignedPercent(ndxChange)}，${ageText}，当前状态：${marketText}。`,
    options.fromCache ? "warn" : "ok"
  );

  if (relativeInsight) {
    setAgentStep("agentStepSignal", `${relativeInsight.summary}；距离 5% 提醒阈值还差 ${distance.toFixed(2)} 个百分点。`, absChange >= 4 ? "warn" : "ok");
  } else if (spxChange !== null) {
    setAgentStep("agentStepSignal", `纳指 ${fmtSignedPercent(ndxChange)}，标普 ${fmtSignedPercent(spxChange)}，正在等待完整强弱判断。`, "warn");
  } else {
    setAgentStep("agentStepSignal", `纳指 ${fmtSignedPercent(ndxChange)}，标普数据暂缺。`, "warn");
  }

  if (absChange >= threshold) {
    summary.textContent = ndxChange > 0 ? "Agent：已达到上涨提醒区" : "Agent：已达到下跌提醒区";
    summary.className = `change ${ndxChange > 0 ? "up" : "down"}`;
    setAgentStep("agentStepAction", "已达到 5% 阈值；如果你本地提醒程序在运行，会按配置发送通知。", ndxChange > 0 ? "ok" : "danger");
  } else if (absChange >= 4) {
    summary.textContent = "Agent：接近提醒阈值";
    summary.className = "change flat";
    setAgentStep("agentStepAction", "离 5% 阈值很近，可以稍后再刷新一次观察变化。", "warn");
  } else if (market.status !== "美股交易中") {
    summary.textContent = "Agent：先看缓存，等开盘";
    summary.className = "change flat";
    setAgentStep("agentStepAction", "当前不在常规交易时段，页面可先展示缓存，开盘后再看实时变化。", "warn");
  } else {
    summary.textContent = "Agent：正常观察中";
    summary.className = "change up";
    setAgentStep("agentStepAction", "当前没有触发 5% 提醒，继续保持自动刷新/手动刷新即可。", "ok");
  }
}

function runAgentCheck() {
  const trace = startAgentTrace("agent_check");
  if (!latestAgentItems.length) {
    addTraceStep(trace, "检查输入数据", "error", "页面还没有可检查的数据。", 0);
    finishAgentTrace(trace, "error", "Agent 检查失败");
    setMessage("Agent 暂时没有可检查的数据。请先点击实时刷新，或者等待页面自动读取缓存。");
    return;
  }

  const options = { ...latestAgentOptions, manual: true, trace };
  const snapshotStartedAt = performance.now();
  const snapshot = getAgentSnapshot(latestAgentItems, latestRelativeInsight, options);
  addTraceStep(trace, "生成 Agent 快照", snapshot ? "success" : "error", snapshot ? "已生成本次 Nasdaq-100 观察快照。" : "当前没有可保存的 Nasdaq-100 有效数据。", performance.now() - snapshotStartedAt);
  if (!snapshot) {
    renderAgent(latestAgentItems, latestRelativeInsight, options);
    finishAgentTrace(trace, "error", "Agent 检查无有效数据");
    setMessage("Agent 已检查，但当前没有可保存的 Nasdaq-100 有效数据。请稍后再刷新一次。");
    return;
  }

  const memoryStartedAt = performance.now();
  const previousHistory = getAgentMemory();
  const savedHistory = saveAgentMemoryEntry(snapshot);
  addTraceStep(trace, "保存 Agent 记忆", "success", `已保存到浏览器记忆，当前共 ${savedHistory.length} 条。`, performance.now() - memoryStartedAt);
  renderAgent(latestAgentItems, latestRelativeInsight, options);
  renderAgentMemory(snapshot, savedHistory, previousHistory);
  finishAgentTrace(trace, "success", "Agent 检查 Trace 完成");
  setMessage($("messageBox").textContent + "\n\nAgent 已完成检查，并把本次结果保存到当前浏览器记忆里。观察日志会保留最近 5 次记录。");
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

  const trace = options.trace;
  const relativeStartedAt = performance.now();
  const relativeInsight = renderRelativeInsight(dataByKey);
  if (trace) addTraceStep(trace, "计算相对表现", relativeInsight ? "success" : "skipped", relativeInsight ? relativeInsight.summary : "缺少完整指数数据，跳过强弱判断。", performance.now() - relativeStartedAt);

  const notifyStartedAt = performance.now();
  const notifyResult = maybeSendBrowserAlert(items, options);
  if (trace) {
    const notifyStatus = notifyResult === "sent" ? "success" : "skipped";
    const notifyDetails = {
      sent: "已发送网页通知。",
      disabled: "本次不是通知型刷新，跳过网页通知。",
      no_valid_data: "没有可用于通知判断的 Nasdaq-100 数据。",
      below_threshold: "未达到 ±5% 阈值，不发送通知。",
      disabled_by_user: "用户已关闭网页通知。",
      permission_or_cooldown: "未授权通知或仍在冷却时间内。"
    };
    addTraceStep(trace, "判断网页通知", notifyStatus, notifyDetails[notifyResult] || "通知判断完成。", performance.now() - notifyStartedAt);
  }

  const agentStartedAt = performance.now();
  renderAgent(items, relativeInsight, options);
  if (trace) addTraceStep(trace, "运行规则 Agent", "success", $("agentSummary").textContent || "Agent 判断完成。", performance.now() - agentStartedAt);
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
  const trace = startAgentTrace("page_data");
  const startedAt = performance.now();
  try {
    const response = await fetch("data.json?ts=" + Date.now(), { cache: "no-store" });
    const data = await response.json();
    addTraceStep(trace, "读取页面 data.json", "success", "已读取 GitHub Pages 上的静态数据文件。", performance.now() - startedAt);
    if (Array.isArray(data.indices)) renderAll(data.indices, { trace });
    else if (data.indices && typeof data.indices === "object") renderAll(Object.values(data.indices), { trace });
    else {
      renderLegacyCachedData(data);
      addTraceStep(trace, "兼容旧数据格式", "warning", "data.json 是旧格式，只渲染 Nasdaq-100。", 1);
    }
    finishAgentTrace(trace, "success", "页面数据 Trace 完成");
  } catch (error) {
    addTraceStep(trace, "读取页面 data.json", "error", error.message, performance.now() - startedAt);
    renderAll(INDICES.map((config) => ({
      ok: false,
      key: config.key,
      symbol: config.symbol,
      display_symbol: config.displaySymbol,
      error: "本地缓存 data.json 读取失败：" + error.message
    })), { trace });
    finishAgentTrace(trace, "error", "页面数据读取失败");
  }
}

async function refreshLive() {
  const trace = startAgentTrace("live_refresh");
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
  addTraceStep(trace, "创建刷新任务", "success", "用户或页面触发实时刷新。", 0);

  try {
    const startedAt = performance.now();
    const data = await fetchLiveData();
    addTraceStep(trace, "请求行情接口", "success", `返回 ${data.filter((item) => item.ok).length}/${data.length} 个有效指数。`, performance.now() - startedAt);
    const cacheStartedAt = performance.now();
    saveLiveCache(data);
    addTraceStep(trace, "写入浏览器缓存", "success", "把本次有效数据保存到当前浏览器。", performance.now() - cacheStartedAt);
    renderAll(data, { allowNotify: true, trace });
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    finishAgentTrace(trace, "success", "实时刷新 Trace 完成");
    setMessage($("messageBox").textContent + `\n\n刷新耗时：${elapsedSeconds} 秒。`);
  } catch (error) {
    addTraceStep(trace, "请求行情接口", "error", error.message, 0);
    finishAgentTrace(trace, "error", "实时刷新失败");
    setMessage("实时刷新失败：" + error.message + "\n\n我会保留页面上的缓存数据。你可以稍后再点一次刷新。");
    $("dataStatus").textContent = "刷新失败";
    $("dataStatus").classList.add("warn");
  } finally {
    button.disabled = false;
    button.textContent = "实时刷新";
  }
}

$("refreshButton").addEventListener("click", refreshLive);
const enableBrowserNotifyButton = $("enableBrowserNotifyButton");
if (enableBrowserNotifyButton) enableBrowserNotifyButton.addEventListener("click", enableBrowserNotifications);
const disableBrowserNotifyButton = $("disableBrowserNotifyButton");
if (disableBrowserNotifyButton) disableBrowserNotifyButton.addEventListener("click", disableBrowserNotifications);
const clearCacheButton = $("clearCacheButton");
if (clearCacheButton) clearCacheButton.addEventListener("click", clearLiveCache);
const agentButton = $("agentButton");
if (agentButton) agentButton.addEventListener("click", runAgentCheck);
const clearAgentMemoryButton = $("clearAgentMemoryButton");
if (clearAgentMemoryButton) clearAgentMemoryButton.addEventListener("click", clearAgentMemory);
renderAgentTrace();
renderAgentMemory();
renderMarketStatus();
updateCacheStatus();
setInterval(renderMarketStatus, 60000);
if (!loadLiveCache()) loadCachedData();
setTimeout(refreshLive, 80);





























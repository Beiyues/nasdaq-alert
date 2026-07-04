const $ = (id) => document.getElementById(id);
const SYMBOL = "^NDX";
const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX?range=5d&interval=1d";
const PROXY_URL = "https://api.allorigins.win/raw?url=" + encodeURIComponent(YAHOO_URL);

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

function normalizeYahooChart(payload, source) {
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  if (!result) throw new Error("行情接口没有返回有效数据");

  const meta = result.meta || {};
  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  const closes = ((quote && quote.close) || []).filter((v) => v !== null && Number(v) > 0).map(Number);
  if (closes.length < 2 && !meta.previousClose) throw new Error("收盘价数据不足");

  const currentPrice = Number(meta.regularMarketPrice || closes[closes.length - 1]);
  const previousClose = Number(meta.previousClose || meta.chartPreviousClose || closes[closes.length - 2]);
  if (!currentPrice || !previousClose) throw new Error("价格字段为空");

  const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
  const timestamp = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString();

  return {
    ok: true,
    source,
    symbol: SYMBOL,
    display_symbol: "Nasdaq-100 (^NDX)",
    current_price: currentPrice,
    previous_close: previousClose,
    change_percent: changePercent,
    updated_at: timestamp,
    error: null
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return response.json();
}

async function fetchLiveData() {
  try {
    const payload = await fetchJson(YAHOO_URL);
    return normalizeYahooChart(payload, "Yahoo chart API");
  } catch (directError) {
    const payload = await fetchJson(PROXY_URL);
    const data = normalizeYahooChart(payload, "Yahoo chart API + CORS proxy");
    data.proxy_note = directError.message;
    return data;
  }
}

function render(data) {
  $("symbol").textContent = data.display_symbol || data.symbol || SYMBOL;
  $("source").textContent = data.source || "--";
  $("currentPrice").textContent = fmtNumber(data.current_price);
  $("previousClose").textContent = fmtNumber(data.previous_close);

  const status = $("dataStatus");
  status.classList.toggle("warn", !data.ok);
  status.textContent = data.ok ? "数据已更新" : "数据待更新";

  const changeEl = $("changePercent");
  if (data.change_percent === null || data.change_percent === undefined) {
    changeEl.textContent = "--";
    changeEl.className = "change flat";
  } else {
    const change = Number(data.change_percent);
    changeEl.textContent = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
    changeEl.className = "change " + (change > 0 ? "up" : change < 0 ? "down" : "flat");
  }

  $("updatedAt").textContent = "数据更新时间：" + fmtTime(data.updated_at);

  if (data.ok) {
    const extra = data.proxy_note ? `\n说明：直连接口失败，已通过公开代理刷新。` : "";
    setMessage(`数据读取成功。\n标的：${data.display_symbol || data.symbol}\n当前涨跌幅：${changeEl.textContent}\n更新时间：${fmtTime(data.updated_at)}${extra}`);
  } else {
    setMessage(`暂时没有最新数据。\n\n原因：${data.error || "未知错误"}\n\n这是公开静态页面，只负责展示数据；通知功能仍在你的本地电脑运行。`);
  }
}

async function loadCachedData() {
  try {
    const response = await fetch("data.json?ts=" + Date.now(), { cache: "no-store" });
    render(await response.json());
  } catch (error) {
    render({ ok: false, symbol: SYMBOL, error: "本地缓存 data.json 读取失败：" + error.message });
  }
}

async function refreshLive() {
  const button = $("refreshButton");
  button.disabled = true;
  button.textContent = "刷新中...";
  $("dataStatus").textContent = "刷新中";
  setMessage("正在实时请求 Nasdaq-100 数据，请稍等...");

  try {
    const data = await fetchLiveData();
    render(data);
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
loadCachedData();
setTimeout(refreshLive, 600);

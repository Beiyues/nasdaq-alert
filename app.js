const $ = (id) => document.getElementById(id);

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

function render(data) {
  $("symbol").textContent = data.display_symbol || data.symbol || "^NDX";
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
    setMessage(
      `数据读取成功。\n标的：${data.display_symbol || data.symbol}\n当前涨跌幅：${changeEl.textContent}\n更新时间：${fmtTime(data.updated_at)}`
    );
  } else {
    setMessage(
      `暂时没有最新数据。\n\n原因：${data.error || "未知错误"}\n\n这是公开静态页面，只负责展示数据；通知功能仍在你的本地电脑运行。`
    );
  }
}

async function refresh() {
  const response = await fetch("data.json?ts=" + Date.now());
  render(await response.json());
}

$("refreshButton").addEventListener("click", refresh);
refresh();
setInterval(refresh, 60000);

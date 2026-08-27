const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const SYMBOL = "ETHUSDT";
const REST_BASE = "https://fapi.binance.com";
const intervals = ["5m","15m","30m","1h","4h","1d"];
const streams = [...intervals.map(tf => `ethusdt@kline_${tf}`), "ethusdt@ticker"];
const BINANCE_WS = "wss://fstream.binance.com/stream?streams=" + streams.join("/");

let binanceSocket;
let reconnectTimer;
let latestTicker = null;
const latestCandles = new Map();

app.get("/api/klines", async (req, res) => {
  try {
    const interval = String(req.query.interval || "5m");
    const limit = Math.min(Number(req.query.limit || 500), 1000);
    if (!intervals.includes(interval)) return res.status(400).json({error:"Unsupported interval"});
    const r = await fetch(`${REST_BASE}/fapi/v1/klines?symbol=${SYMBOL}&interval=${interval}&limit=${limit}`);
    res.status(r.status).json(await r.json());
  } catch {
    res.status(500).json({error:"Failed to load klines"});
  }
});

app.get("/api/ticker", async (_req, res) => {
  try {
    if (latestTicker) return res.json(latestTicker);
    const r = await fetch(`${REST_BASE}/fapi/v1/ticker/24hr?symbol=${SYMBOL}`);
    res.status(r.status).json(await r.json());
  } catch {
    res.status(500).json({error:"Failed to load ticker"});
  }
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ETHUSDT Futures Live</title>
<script src="https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js"></script>
<style>
*{box-sizing:border-box}body{margin:0;background:#060a13;color:#e8eef8;font-family:Arial,sans-serif}
.app{max-width:1500px;margin:auto;padding:18px}.top{display:flex;justify-content:space-between;gap:15px;align-items:center;flex-wrap:wrap}
h1{margin:0}.badge{color:#f0b90b}.live{color:#22c55e}.muted{color:#77869b;font-size:13px}
.price{font-size:30px;font-weight:800}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
.card{background:#0d1421;border:1px solid #1e2a3e;border-radius:12px;padding:12px}.card span{color:#77869b;font-size:12px}.card b{display:block;margin-top:5px}
.panel{background:#0a101b;border:1px solid #1e2a3e;border-radius:14px;overflow:hidden}.bar{display:flex;justify-content:space-between;gap:12px;padding:10px;border-bottom:1px solid #172235;flex-wrap:wrap}
.btns{display:flex;gap:6px;flex-wrap:wrap}.btn{background:#101b2c;color:#aab7c9;border:1px solid #26364e;border-radius:8px;padding:8px 10px;cursor:pointer}.btn.active{background:#f0b90b;color:#07111f;border-color:#f0b90b;font-weight:800}
.ohlc{display:flex;gap:10px;color:#77869b;font-size:12px;flex-wrap:wrap}.ohlc b{color:#d7e0ec}
#chart{height:68vh;min-height:460px}.footer{padding:8px 10px;color:#6f7d90;font-size:11px;border-top:1px solid #172235}
.pos{color:#22c55e}.neg{color:#ef4444}@media(max-width:700px){.stats{grid-template-columns:1fr 1fr}.app{padding:8px}#chart{min-height:500px}}
</style>
</head>
<body>
<div class="app">
  <div class="top">
    <div>
      <h1>ETHUSDT <span class="badge">Futures</span></h1>
      <div class="muted">Binance USDⓈ-M · <span id="status">Подключение...</span></div>
    </div>
    <div>
      <div class="muted">Текущая цена</div>
      <div id="price" class="price">—</div>
      <div id="change">—</div>
    </div>
  </div>

  <div class="stats">
    <div class="card"><span>24ч максимум</span><b id="high">—</b></div>
    <div class="card"><span>24ч минимум</span><b id="low">—</b></div>
    <div class="card"><span>Объём 24ч</span><b id="vol">—</b></div>
    <div class="card"><span>Таймфрейм</span><b id="tf">5m</b></div>
  </div>

  <div class="panel">
    <div class="bar">
      <div class="btns">
        <button class="btn active" data-tf="5m">5m</button>
        <button class="btn" data-tf="15m">15m</button>
        <button class="btn" data-tf="30m">30m</button>
        <button class="btn" data-tf="1h">1h</button>
        <button class="btn" data-tf="4h">4h</button>
        <button class="btn" data-tf="1d">1d</button>
      </div>
      <div class="ohlc">
        <span>O <b id="o">—</b></span><span>H <b id="h">—</b></span>
        <span>L <b id="l">—</b></span><span>C <b id="c">—</b></span>
      </div>
    </div>
    <div id="chart"></div>
    <div class="footer">Источник: Binance Futures · live через WebSocket</div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
let active="5m", socket;
const chart=LightweightCharts.createChart($("chart"),{autoSize:true,layout:{background:{type:LightweightCharts.ColorType.Solid,color:"#0a101b"},textColor:"#8796aa"},grid:{vertLines:{color:"#142033"},horzLines:{color:"#142033"}},timeScale:{timeVisible:true,secondsVisible:false}});
const cs=chart.addSeries(LightweightCharts.CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",borderUpColor:"#22c55e",borderDownColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444"});
const vs=chart.addSeries(LightweightCharts.HistogramSeries,{priceScaleId:"volume",priceFormat:{type:"volume"},lastValueVisible:false,priceLineVisible:false});
chart.priceScale("volume").applyOptions({scaleMargins:{top:.82,bottom:0},borderVisible:false});
function fmt(v){const n=Number(v);return Number.isFinite(n)?n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}
function compact(v){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:2}).format(n):"—"}
function vc(o,c){return +c>=+o?"rgba(34,197,94,.42)":"rgba(239,68,68,.42)"}
function ohlc(k){$("o").textContent=fmt(k.o??k.open);$("h").textContent=fmt(k.h??k.high);$("l").textContent=fmt(k.l??k.low);$("c").textContent=fmt(k.c??k.close)}
function ticker(d){const ch=+(d.P??d.priceChangePercent);$("price").textContent=fmt(d.c??d.lastPrice);$("high").textContent=fmt(d.h??d.highPrice);$("low").textContent=fmt(d.l??d.lowPrice);$("vol").textContent=compact(d.q??d.quoteVolume)+" USDT";$("change").textContent=(ch>0?"+":"")+ch.toFixed(2)+"%";$("change").className=ch>=0?"pos":"neg"}
async function hist(tf){const r=await fetch("/api/klines?interval="+tf+"&limit=500");const a=await r.json();const c=a.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));const v=a.map(k=>({time:Math.floor(k[0]/1000),value:+k[5],color:vc(k[1],k[4])}));cs.setData(c);vs.setData(v);if(c.length){$("price").textContent=fmt(c.at(-1).close);ohlc(c.at(-1))}chart.timeScale().fitContent()}
async function snap(){try{const r=await fetch("/api/ticker");ticker(await r.json())}catch{}}
function connect(){const p=location.protocol==="https:"?"wss:":"ws:";socket=new WebSocket(p+"//"+location.host);socket.onopen=()=>{$("status").textContent="LIVE";$("status").className="live"};socket.onclose=()=>{setTimeout(connect,1500)};socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="ticker")ticker(m.data);if(m.type==="kline"&&m.interval===active){const k=m.data;const c={time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c};cs.update(c);vs.update({time:c.time,value:+k.v,color:vc(k.o,k.c)});$("price").textContent=fmt(c.close);ohlc(k)}}}
document.querySelectorAll(".btn").forEach(b=>b.onclick=()=>{active=b.dataset.tf;$("tf").textContent=active;document.querySelectorAll(".btn").forEach(x=>x.classList.toggle("active",x===b));hist(active)});
snap();hist(active);connect();
</script>
</body>
</html>`);
});

function broadcast(obj){
  const text = JSON.stringify(obj);
  for(const client of wss.clients){
    if(client.readyState===WebSocket.OPEN) client.send(text);
  }
}

function connectBinance(){
  clearTimeout(reconnectTimer);
  if(binanceSocket){try{binanceSocket.terminate()}catch{}}
  const ws = new WebSocket(BINANCE_WS);
  binanceSocket = ws;

  ws.on("message", raw => {
    try{
      const m = JSON.parse(raw.toString());
      const stream = m.stream, d = m.data;
      if(stream?.endsWith("@ticker")){
        latestTicker = d;
        broadcast({type:"ticker", data:d});
      } else if(stream?.includes("@kline_") && d?.k){
        latestCandles.set(d.k.i, d.k);
        broadcast({type:"kline", interval:d.k.i, data:d.k});
      }
    }catch{}
  });

  ws.on("close", () => {
    if(binanceSocket !== ws) return;
    reconnectTimer = setTimeout(connectBinance, 1500);
  });

  ws.on("error", () => {});
}

wss.on("connection", client => {
  if(latestTicker) client.send(JSON.stringify({type:"ticker", data:latestTicker}));
  for(const [interval, data] of latestCandles){
    client.send(JSON.stringify({type:"kline", interval, data}));
  }
});

connectBinance();
server.listen(PORT, "0.0.0.0", () => console.log("Running on", PORT));

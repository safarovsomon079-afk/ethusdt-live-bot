const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index-live.html'));
});

const browserSocket = new WebSocket.Server({
  server,
  path: '/ws'
});

const streams = [
  'ethusdt@aggTrade',
  'ethusdt@ticker',
  'ethusdt@kline_5m',
  'ethusdt@kline_15m',
  'ethusdt@kline_30m',
  'ethusdt@kline_1h',
  'ethusdt@kline_4h',
  'ethusdt@kline_1d'
].join('/');

browserSocket.on('connection', client => {
  let binance = null;
  let retryTimer = null;
  let hostIndex = 0;

  const hosts = [
    'wss://fstream.binance.com',
    'wss://fstream.binance.com:9443',
    'wss://fstream.binancefuture.com'
  ];

  function connectBinance() {
    if (client.readyState !== WebSocket.OPEN) return;

    const url = hosts[hostIndex] + '/stream?streams=' + streams;
    binance = new WebSocket(url);

    binance.on('message', data => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data.toString());
      }
    });

    binance.on('error', () => {
      binance.close();
    });

    binance.on('close', () => {
      hostIndex = (hostIndex + 1) % hosts.length;

      if (client.readyState === WebSocket.OPEN) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connectBinance, 1500);
      }
    });
  }

  connectBinance();

  client.on('close', () => {
    clearTimeout(retryTimer);

    if (binance) {
      binance.close();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('ETHUSDT LIVE monitor running on port', PORT);
});

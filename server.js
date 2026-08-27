const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index-live.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('ETHUSDT LIVE monitor running on port', PORT);
});

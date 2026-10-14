import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TJ_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-test-'));
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';

const { createApp } = await import('../server/app.js');

let server;
let base;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const writeHeaders = { 'X-TJ': '1', 'Content-Type': 'application/json' };

test('health check', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('rejects writes without the anti-CSRF header', async () => {
  const res = await fetch(`${base}/api/trades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-01-01', symbol: 'EURUSD', direction: 'long' }),
  });
  assert.equal(res.status, 403);
});

test('create, read, update and delete a trade', async () => {
  const create = await fetch(`${base}/api/trades`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ date: '2026-01-15', symbol: 'eurusd', direction: 'long', pnl: 42.5 }),
  });
  assert.equal(create.status, 201);
  const trade = await create.json();
  assert.equal(trade.symbol, 'EURUSD');
  assert.equal(trade.pnl, 42.5);
  assert.deepEqual(trade.images, []);

  const list = await (await fetch(`${base}/api/trades?from=2026-01-01&to=2026-01-31`)).json();
  assert.equal(list.length, 1);

  const updated = await (await fetch(`${base}/api/trades/${trade.id}`, {
    method: 'PUT',
    headers: writeHeaders,
    body: JSON.stringify({ date: '2026-01-15', symbol: 'EURUSD', direction: 'short', pnl: -10 }),
  })).json();
  assert.equal(updated.direction, 'short');
  assert.equal(updated.pnl, -10);

  const del = await fetch(`${base}/api/trades/${trade.id}`, { method: 'DELETE', headers: { 'X-TJ': '1' } });
  assert.equal(del.status, 204);
  assert.equal((await fetch(`${base}/api/trades/${trade.id}`)).status, 404);
});

test('rejects invalid trade payloads', async () => {
  const res = await fetch(`${base}/api/trades`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ date: 'not-a-date', symbol: 'X', direction: 'long', pnl: 0 }),
  });
  assert.equal(res.status, 400);
});

test('requires a result (pnl) even though other fields are optional', async () => {
  const res = await fetch(`${base}/api/trades`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ date: '2026-03-01', symbol: 'AAPL', direction: 'long' }),
  });
  assert.equal(res.status, 400);
});

test('uploads an image for a trade and serves it back', async () => {
  const trade = await (await fetch(`${base}/api/trades`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ date: '2026-02-01', symbol: 'GBPUSD', direction: 'long', pnl: 0 }),
  })).json();

  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const upload = await fetch(`${base}/api/trades/${trade.id}/images`, {
    method: 'POST',
    headers: { 'X-TJ': '1', 'Content-Type': 'image/png' },
    body: png,
  });
  assert.equal(upload.status, 201);
  const image = await upload.json();
  assert.equal(image.mime, 'image/png');

  const file = await fetch(`${base}${image.url}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');

  const del = await fetch(`${base}/api/images/${image.id}`, { method: 'DELETE', headers: { 'X-TJ': '1' } });
  assert.equal(del.status, 204);
});

test('rejects non-image uploads', async () => {
  const trade = await (await fetch(`${base}/api/trades`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ date: '2026-02-02', symbol: 'GBPUSD', direction: 'long', pnl: 0 }),
  })).json();
  const res = await fetch(`${base}/api/trades/${trade.id}/images`, {
    method: 'POST',
    headers: { 'X-TJ': '1', 'Content-Type': 'text/plain' },
    body: 'not an image',
  });
  assert.equal(res.status, 415);
});

test('settings roundtrip', async () => {
  const put = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: writeHeaders,
    body: JSON.stringify({ currency: 'USD' }),
  });
  assert.equal((await put.json()).currency, 'USD');
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).currency, 'USD');
});

test('storage overview lists the default location', async () => {
  const storage = await (await fetch(`${base}/api/storage`)).json();
  assert.equal(storage.activeId, 'default');
  assert.ok(storage.locations.some((l) => l.isDefault));
});

test('serves the app shell', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});

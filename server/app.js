import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { config } from './config.js';
import * as db from './db.js';
import * as storage from './storage.js';
import { HttpError } from './storage.js';

const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP', 'JPY', 'NONE'];

/* ---------- Hilfsfunktionen ---------- */

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > limit) {
      req.resume();
      return reject(new HttpError(413, 'Die Datei ist zu groß.'));
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooBig = true;
      else chunks.push(chunk);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'Die Datei ist zu groß.')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, config.maxJsonBytes);
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Ungültiges JSON.');
  }
}

function checkHost(req) {
  const raw = String(req.headers.host || '').toLowerCase();
  const host = raw.startsWith('[') ? raw.slice(1, raw.indexOf(']')) : raw.replace(/:\d+$/, '');
  const ok =
    !host.includes('.') || // localhost, Rechnername, MagicDNS-Kurzname
    net.isIP(host) !== 0 ||
    /\.(ts\.net|local|lan|home|internal)$/.test(host) ||
    config.allowedHosts.includes(host);
  if (!ok) throw new HttpError(403, 'Hostname nicht erlaubt. Über TJ_ALLOWED_HOSTS freigeben.');
}

/* ---------- Validierung ---------- */

const optNum = (v, label) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new HttpError(400, `${label}: ungültige Zahl.`);
  return n;
};

const optText = (v, max, label) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (s.length > max) throw new HttpError(400, `${label}: maximal ${max} Zeichen.`);
  return s || null;
};

function parseTrade(body) {
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new HttpError(400, 'Datum fehlt oder ist ungültig.');
  }
  const time = body.time ? String(body.time) : null;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Uhrzeit ist ungültig.');

  const symbol = String(body.symbol || '').trim().toUpperCase();
  if (!symbol) throw new HttpError(400, 'Bitte ein Symbol angeben.');
  if (symbol.length > 40) throw new HttpError(400, 'Symbol ist zu lang.');

  if (!['long', 'short'].includes(body.direction)) throw new HttpError(400, 'Richtung muss Long oder Short sein.');

  let rating = optNum(body.rating, 'Bewertung');
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new HttpError(400, 'Bewertung muss zwischen 1 und 5 liegen.');
  }

  return {
    date,
    time,
    symbol,
    direction: body.direction,
    entryPrice: optNum(body.entryPrice, 'Einstieg'),
    exitPrice: optNum(body.exitPrice, 'Ausstieg'),
    stopLoss: optNum(body.stopLoss, 'Stop-Loss'),
    takeProfit: optNum(body.takeProfit, 'Take-Profit'),
    size: optNum(body.size, 'Größe'),
    fees: optNum(body.fees, 'Gebühren'),
    pnl: optNum(body.pnl, 'Ergebnis'),
    setup: optText(body.setup, 80, 'Setup'),
    rating,
    notes: optText(body.notes, 10000, 'Notizen'),
    review: optText(body.review, 10000, 'Nachbetrachtung'),
  };
}

const parseId = (s) => {
  const id = Number(s);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Ungültige ID.');
  return id;
};

/* ---------- API-Routen ---------- */

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/health$/, async (req, res) => sendJson(res, 200, { ok: true }));

route('GET', /^\/api\/trades$/, async (req, res, m, url) => {
  const from = url.searchParams.get('from') || undefined;
  const to = url.searchParams.get('to') || undefined;
  sendJson(res, 200, db.listTrades({ from, to }));
});

route('POST', /^\/api\/trades$/, async (req, res) => {
  const trade = db.createTrade(parseTrade(await readJson(req)));
  sendJson(res, 201, trade);
});

route('GET', /^\/api\/trades\/(\d+)$/, async (req, res, m) => {
  const trade = db.getTrade(parseId(m[1]));
  if (!trade) throw new HttpError(404, 'Trade nicht gefunden.');
  sendJson(res, 200, trade);
});

route('PUT', /^\/api\/trades\/(\d+)$/, async (req, res, m) => {
  const trade = db.updateTrade(parseId(m[1]), parseTrade(await readJson(req)));
  if (!trade) throw new HttpError(404, 'Trade nicht gefunden.');
  sendJson(res, 200, trade);
});

route('DELETE', /^\/api\/trades\/(\d+)$/, async (req, res, m) => {
  const images = db.deleteTrade(parseId(m[1]));
  if (!images) throw new HttpError(404, 'Trade nicht gefunden.');
  await Promise.all(images.map(storage.removeImageFile));
  res.writeHead(204).end();
});

route('POST', /^\/api\/trades\/(\d+)\/images$/, async (req, res, m) => {
  const trade = db.getTrade(parseId(m[1]));
  if (!trade) {
    req.resume();
    throw new HttpError(404, 'Trade nicht gefunden.');
  }
  const buffer = await readBody(req, config.maxUploadBytes);
  const saved = await storage.saveImage({
    buffer,
    tradeId: trade.id,
    tradeDate: trade.date,
    symbol: trade.symbol,
  });
  let originalName = null;
  try {
    originalName = decodeURIComponent(String(req.headers['x-filename'] || '')).slice(0, 200) || null;
  } catch {
    /* ungültig kodierter Name wird ignoriert */
  }
  const image = db.addImage({
    tradeId: trade.id,
    storageDir: saved.storageDir,
    filename: saved.filename,
    originalName,
    mime: saved.mime,
    size: saved.size,
  });
  sendJson(res, 201, image);
});

route('GET', /^\/api\/images\/(\d+)\/file$/, async (req, res, m) => {
  const row = db.getImageRow(parseId(m[1]));
  if (!row) throw new HttpError(404, 'Bild nicht gefunden.');
  const abs = storage.resolveInside(row.storage_dir, row.filename);
  let stat;
  try {
    stat = await fs.promises.stat(abs);
  } catch {
    throw new HttpError(404, 'Bilddatei nicht gefunden – ist das Laufwerk angeschlossen?');
  }
  res.writeHead(200, {
    'Content-Type': row.mime,
    'Content-Length': stat.size,
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  fs.createReadStream(abs).pipe(res);
});

route('DELETE', /^\/api\/images\/(\d+)$/, async (req, res, m) => {
  const row = db.deleteImageRow(parseId(m[1]));
  if (!row) throw new HttpError(404, 'Bild nicht gefunden.');
  await storage.removeImageFile(row);
  res.writeHead(204).end();
});

route('GET', /^\/api\/settings$/, async (req, res) => {
  sendJson(res, 200, { currency: db.getSetting('currency', 'EUR') });
});

route('PUT', /^\/api\/settings$/, async (req, res) => {
  const body = await readJson(req);
  if (body.currency !== undefined) {
    if (!CURRENCIES.includes(body.currency)) throw new HttpError(400, 'Unbekannte Währung.');
    db.setSetting('currency', body.currency);
  }
  sendJson(res, 200, { currency: db.getSetting('currency', 'EUR') });
});

async function storageOverview() {
  const active = storage.activeLocation();
  return {
    activeId: active.id,
    platform: process.platform,
    locations: await Promise.all(storage.allLocations().map((l) => storage.describeLocation(l, active.id))),
    suggestions: await storage.detectDrives(),
  };
}

route('GET', /^\/api\/storage$/, async (req, res) => sendJson(res, 200, await storageOverview()));

route('POST', /^\/api\/storage\/locations$/, async (req, res) => {
  const body = await readJson(req);
  await storage.addLocation(body.name, body.path, Boolean(body.activate));
  sendJson(res, 201, await storageOverview());
});

route('PUT', /^\/api\/storage\/active$/, async (req, res) => {
  const body = await readJson(req);
  await storage.setActive(String(body.id || ''));
  sendJson(res, 200, await storageOverview());
});

route('DELETE', /^\/api\/storage\/locations\/([\w-]+)$/, async (req, res, m) => {
  storage.removeLocation(m[1]);
  sendJson(res, 200, await storageOverview());
});

route('GET', /^\/api\/export$/, async (req, res) => {
  const body = JSON.stringify(
    { exportedAt: new Date().toISOString(), currency: db.getSetting('currency', 'EUR'), trades: db.listTrades() },
    null,
    2,
  );
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="trading-journal-export.json"',
    'Cache-Control': 'no-store',
  });
  res.end(body);
});

async function handleApi(req, res, url) {
  // Schreibende Anfragen brauchen einen eigenen Header. Fremde Webseiten können ihn
  // ohne CORS-Freigabe nicht setzen – das schützt vor CSRF.
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-tj'] !== '1') {
    throw new HttpError(403, 'Anfrage abgelehnt.');
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.pattern);
    if (m) return r.handler(req, res, m, url);
  }
  throw new HttpError(404, 'Unbekannter API-Pfad.');
}

/* ---------- Statische Dateien ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Methode nicht erlaubt.');
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Ungültiger Pfad.');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.resolve(config.publicDir, `.${rel}`);
  if (!abs.startsWith(config.publicDir + path.sep)) throw new HttpError(404, 'Nicht gefunden.');
  let stat;
  try {
    stat = await fs.promises.stat(abs);
    if (!stat.isFile()) throw new Error('keine Datei');
  } catch {
    throw new HttpError(404, 'Nicht gefunden.');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs).pipe(res);
}

/* ---------- Server ---------- */

function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  if (res.headersSent) return res.destroy();
  sendJson(res, status, { error: status === 500 ? 'Interner Serverfehler.' : err.message });
}

export function createApp() {
  db.init();
  storage.ensureDefault();

  return http.createServer((req, res) => {
    (async () => {
      checkHost(req);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
      return serveStatic(req, res, url.pathname);
    })().catch((err) => sendError(res, err));
  });
}

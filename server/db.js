import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let db;

export function init() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(path.join(config.dataDir, 'journal.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS trades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date  TEXT NOT NULL,
      trade_time  TEXT,
      symbol      TEXT NOT NULL,
      direction   TEXT NOT NULL CHECK (direction IN ('long', 'short')),
      entry_price REAL,
      exit_price  REAL,
      stop_loss   REAL,
      take_profit REAL,
      size        REAL,
      fees        REAL,
      pnl         REAL,
      setup       TEXT,
      rating      INTEGER,
      notes       TEXT,
      review      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(trade_date);

    CREATE TABLE IF NOT EXISTS images (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id      INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      storage_dir   TEXT NOT NULL,
      filename      TEXT NOT NULL,
      original_name TEXT,
      mime          TEXT NOT NULL,
      size          INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_images_trade ON images(trade_id);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

const toTrade = (r) => ({
  id: r.id,
  date: r.trade_date,
  time: r.trade_time,
  symbol: r.symbol,
  direction: r.direction,
  entryPrice: r.entry_price,
  exitPrice: r.exit_price,
  stopLoss: r.stop_loss,
  takeProfit: r.take_profit,
  size: r.size,
  fees: r.fees,
  pnl: r.pnl,
  setup: r.setup,
  rating: r.rating,
  notes: r.notes,
  review: r.review,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  images: [],
});

export const toImage = (r) => ({
  id: r.id,
  tradeId: r.trade_id,
  url: `/api/images/${r.id}/file`,
  name: r.original_name,
  mime: r.mime,
  size: r.size,
  createdAt: r.created_at,
});

function attachImages(trades) {
  if (!trades.length) return trades;
  const byId = new Map(trades.map((t) => [t.id, t]));
  const rows = db
    .prepare(
      `SELECT * FROM images WHERE trade_id IN (${trades.map(() => '?').join(',')}) ORDER BY id`,
    )
    .all(...trades.map((t) => t.id));
  for (const r of rows) byId.get(r.trade_id).images.push(toImage(r));
  return trades;
}

export function listTrades({ from, to } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('trade_date >= ?'); params.push(from); }
  if (to) { where.push('trade_date <= ?'); params.push(to); }
  const sql = `SELECT * FROM trades ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY trade_date, COALESCE(trade_time, ''), id`;
  return attachImages(db.prepare(sql).all(...params).map(toTrade));
}

export function getTrade(id) {
  const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  return row ? attachImages([toTrade(row)])[0] : null;
}

const fields = (t) => ({
  date: t.date, time: t.time, symbol: t.symbol, direction: t.direction,
  entry: t.entryPrice, exit: t.exitPrice, sl: t.stopLoss, tp: t.takeProfit,
  size: t.size, fees: t.fees, pnl: t.pnl, setup: t.setup, rating: t.rating,
  notes: t.notes, review: t.review,
});

export function createTrade(t) {
  const info = db
    .prepare(
      `INSERT INTO trades (trade_date, trade_time, symbol, direction, entry_price, exit_price,
         stop_loss, take_profit, size, fees, pnl, setup, rating, notes, review)
       VALUES (:date, :time, :symbol, :direction, :entry, :exit, :sl, :tp, :size, :fees, :pnl,
         :setup, :rating, :notes, :review)`,
    )
    .run(fields(t));
  return getTrade(Number(info.lastInsertRowid));
}

export function updateTrade(id, t) {
  const info = db
    .prepare(
      `UPDATE trades SET trade_date = :date, trade_time = :time, symbol = :symbol,
         direction = :direction, entry_price = :entry, exit_price = :exit, stop_loss = :sl,
         take_profit = :tp, size = :size, fees = :fees, pnl = :pnl, setup = :setup,
         rating = :rating, notes = :notes, review = :review, updated_at = datetime('now')
       WHERE id = :id`,
    )
    .run({ ...fields(t), id });
  return info.changes ? getTrade(id) : null;
}

/** Löscht den Trade und gibt die Bild-Zeilen zurück, damit die Dateien entfernt werden können. */
export function deleteTrade(id) {
  const images = db.prepare('SELECT * FROM images WHERE trade_id = ?').all(id);
  const info = db.prepare('DELETE FROM trades WHERE id = ?').run(id);
  return info.changes ? images : null;
}

export function addImage({ tradeId, storageDir, filename, originalName, mime, size }) {
  const info = db
    .prepare(
      `INSERT INTO images (trade_id, storage_dir, filename, original_name, mime, size)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(tradeId, storageDir, filename, originalName, mime, size);
  return toImage(db.prepare('SELECT * FROM images WHERE id = ?').get(Number(info.lastInsertRowid)));
}

export const getImageRow = (id) => db.prepare('SELECT * FROM images WHERE id = ?').get(id) ?? null;

export function deleteImageRow(id) {
  const row = getImageRow(id);
  if (!row) return null;
  db.prepare('DELETE FROM images WHERE id = ?').run(id);
  return row;
}

export const countImagesInDir = (dir) =>
  db.prepare('SELECT COUNT(*) AS n FROM images WHERE storage_dir = ?').get(dir).n;

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}

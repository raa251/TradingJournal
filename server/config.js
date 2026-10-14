import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  publicDir: path.join(root, 'public'),
  // Standardmäßig nur lokal erreichbar. Für Zugriff im LAN: HOST=0.0.0.0
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  // Datenbank und (Standard-)Bilderordner
  dataDir: path.resolve(process.env.TJ_DATA_DIR || path.join(root, 'data')),
  maxUploadBytes: 30 * 1024 * 1024,
  maxJsonBytes: 1024 * 1024,
  // Zusätzlich erlaubte Hostnamen (kommagetrennt), z. B. eigene Domain
  allowedHosts: (process.env.TJ_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
};

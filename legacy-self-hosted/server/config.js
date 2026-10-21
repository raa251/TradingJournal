import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  publicDir: path.join(root, 'public'),
  // Only reachable locally by default. For LAN access: HOST=0.0.0.0
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  // Database and (default) image folder
  dataDir: path.resolve(process.env.TJ_DATA_DIR || path.join(root, 'data')),
  maxUploadBytes: 30 * 1024 * 1024,
  maxJsonBytes: 1024 * 1024,
  // Additionally allowed hostnames (comma-separated), e.g. a custom domain
  allowedHosts: (process.env.TJ_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
};

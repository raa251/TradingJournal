import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as db from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_ID = 'default';
const defaultLocation = () => ({
  id: DEFAULT_ID,
  name: 'Standard (Datenordner auf dem Server)',
  path: path.join(config.dataDir, 'images'),
});

export function ensureDefault() {
  fsSync.mkdirSync(defaultLocation().path, { recursive: true });
}

const customLocations = () => {
  try {
    return JSON.parse(db.getSetting('storage_locations', '[]'));
  } catch {
    return [];
  }
};

export const allLocations = () => [defaultLocation(), ...customLocations()];

export function activeLocation() {
  const id = db.getSetting('storage_active', DEFAULT_ID);
  return allLocations().find((l) => l.id === id) ?? defaultLocation();
}

/** Prüft, ob in das Verzeichnis geschrieben werden kann. Legt es bei Bedarf an. */
async function assertWritable(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.tj-test-${crypto.randomBytes(4).toString('hex')}`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
  } catch (err) {
    throw new HttpError(400, `Ordner ist nicht beschreibbar: ${err.code || err.message}`);
  }
}

/** Freien/gesamten Platz ermitteln; bei noch nicht existierendem Ordner den nächsten vorhandenen Elternordner nutzen. */
async function diskSpace(dir) {
  let probe = dir;
  for (let i = 0; i < 10; i++) {
    try {
      const s = await fs.statfs(probe);
      return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return { free: null, total: null };
}

async function isDirectory(dir) {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

export async function describeLocation(loc, activeId) {
  const available = await isDirectory(loc.path);
  const space = available ? await diskSpace(loc.path) : { free: null, total: null };
  return {
    ...loc,
    isDefault: loc.id === DEFAULT_ID,
    active: loc.id === activeId,
    available,
    ...space,
    imageCount: db.countImagesInDir(loc.path),
  };
}

const PSEUDO_FS = new Set([
  'proc', 'sysfs', 'tmpfs', 'devtmpfs', 'devpts', 'cgroup', 'cgroup2', 'overlay',
  'squashfs', 'autofs', 'mqueue', 'securityfs', 'debugfs', 'tracefs', 'fusectl', 'configfs',
]);

/** Erkennt angeschlossene Laufwerke als Vorschläge für den Bilder-Speicherort. */
export async function detectDrives() {
  const found = [];
  const suggest = async (name, mountPoint) => {
    const space = await diskSpace(mountPoint);
    found.push({ name, path: path.join(mountPoint, 'TradingJournal-Bilder'), ...space });
  };

  try {
    if (process.platform === 'win32') {
      for (let c = 65; c <= 90; c++) {
        const letter = String.fromCharCode(c);
        const root = `${letter}:\\`;
        if (fsSync.existsSync(root)) await suggest(`Laufwerk ${letter}:`, root);
      }
    } else if (process.platform === 'darwin') {
      for (const entry of await fs.readdir('/Volumes')) await suggest(entry, path.join('/Volumes', entry));
    } else {
      const mounts = await fs.readFile('/proc/mounts', 'utf8');
      for (const line of mounts.split('\n')) {
        const [device, rawPoint, fsType] = line.split(' ');
        if (!rawPoint || PSEUDO_FS.has(fsType)) continue;
        const mountPoint = rawPoint.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
        if (/^\/(mnt|media|run\/media)\//.test(mountPoint)) {
          await suggest(`${path.basename(mountPoint)} (${device})`, mountPoint);
        }
      }
    }
  } catch {
    // Erkennung ist optional – ein Pfad kann immer manuell eingegeben werden.
  }

  const known = new Set(allLocations().map((l) => path.resolve(l.path)));
  return found.filter((f) => !known.has(path.resolve(f.path)));
}

export async function addLocation(name, dirPath, activate) {
  const cleanName = String(name || '').trim().slice(0, 60);
  const raw = String(dirPath || '').trim();
  if (!raw || !path.isAbsolute(raw)) {
    throw new HttpError(400, 'Bitte einen absoluten Pfad angeben, z. B. D:\\Trading\\Bilder oder /mnt/usb/Trading');
  }
  const resolved = path.resolve(raw);
  if (allLocations().some((l) => path.resolve(l.path) === resolved)) {
    throw new HttpError(409, 'Dieser Speicherort ist bereits vorhanden.');
  }
  await assertWritable(resolved);
  const loc = {
    id: `loc-${crypto.randomBytes(4).toString('hex')}`,
    name: cleanName || path.basename(resolved) || resolved,
    path: resolved,
  };
  db.setSetting('storage_locations', JSON.stringify([...customLocations(), loc]));
  if (activate) db.setSetting('storage_active', loc.id);
  return loc;
}

export async function setActive(id) {
  const loc = allLocations().find((l) => l.id === id);
  if (!loc) throw new HttpError(404, 'Speicherort nicht gefunden.');
  if (loc.id !== DEFAULT_ID && !(await isDirectory(loc.path))) {
    throw new HttpError(409, 'Das Laufwerk bzw. der Ordner ist gerade nicht verfügbar.');
  }
  await assertWritable(loc.path);
  db.setSetting('storage_active', loc.id);
}

export function removeLocation(id) {
  if (id === DEFAULT_ID) throw new HttpError(400, 'Der Standard-Speicherort kann nicht entfernt werden.');
  const list = customLocations();
  if (!list.some((l) => l.id === id)) throw new HttpError(404, 'Speicherort nicht gefunden.');
  db.setSetting('storage_locations', JSON.stringify(list.filter((l) => l.id !== id)));
  if (db.getSetting('storage_active') === id) db.setSetting('storage_active', DEFAULT_ID);
}

/** Erkennt das Bildformat an den ersten Bytes – dem Client-Mime-Type wird nicht vertraut. */
export function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  const head = buf.toString('latin1', 0, 12);
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return { mime: 'image/gif', ext: 'gif' };
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (head.slice(4, 8) === 'ftyp' && /^(avif|avis)/.test(buf.toString('latin1', 8, 12))) {
    return { mime: 'image/avif', ext: 'avif' };
  }
  return null;
}

/** Löst einen relativen Dateinamen innerhalb des Speicherorts auf und verhindert Pfad-Ausbrüche. */
export function resolveInside(root, relative) {
  const abs = path.resolve(root, ...relative.split('/'));
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new HttpError(400, 'Ungültiger Dateipfad.');
  return abs;
}

export async function saveImage({ buffer, tradeId, tradeDate, symbol }) {
  const kind = sniffImage(buffer);
  if (!kind) throw new HttpError(415, 'Nur PNG, JPEG, WebP, GIF oder AVIF werden unterstützt.');

  const loc = activeLocation();
  if (!(await isDirectory(loc.path))) {
    throw new HttpError(503, `Speicherort „${loc.name}“ ist nicht verfügbar. Ist das Laufwerk angeschlossen?`);
  }

  const [year, month] = tradeDate.split('-');
  const safeSymbol = symbol.replace(/[^A-Za-z0-9_-]+/g, '') || 'trade';
  const rand = crypto.randomBytes(3).toString('hex');
  const filename = `${year}/${month}/${tradeDate}_${safeSymbol}_T${tradeId}_${rand}.${kind.ext}`;
  const abs = resolveInside(loc.path, filename);

  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer, { flag: 'wx' });
  } catch (err) {
    throw new HttpError(507, `Bild konnte nicht gespeichert werden (${err.code || err.message}).`);
  }
  return { storageDir: loc.path, filename, mime: kind.mime, size: buffer.length };
}

export async function removeImageFile(row) {
  try {
    await fs.unlink(resolveInside(row.storage_dir, row.filename));
  } catch {
    // Datei bereits weg oder Laufwerk nicht verbunden – Datenbankeintrag wird trotzdem entfernt.
  }
}

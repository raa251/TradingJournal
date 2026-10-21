/* Optional local folder mirror, on top of the Supabase cloud sync.
   Supported on desktop Chrome/Edge and Android Chrome (File System Access
   API). Not available on iOS/Safari or Firefox - those browsers don't
   expose showDirectoryPicker() at all, so this module quietly does
   nothing there and the Settings screen explains the limitation.

   Nothing here is required for the app to work: it is a best-effort
   mirror of trades (as JSON) and setup screenshots onto a folder the
   person picked, so there is always a plain-file copy on that device
   in addition to the cloud copy in Supabase. */

const DB_NAME = 'trading-journal-local';
const STORE = 'handles';
const KEY = 'backup-dir';

export const supportsLocalBackup = typeof window.showDirectoryPicker === 'function';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let cachedHandle = null;

/** Returns the stored directory handle if we still have read/write permission, else null. */
export async function getActiveHandle() {
  if (!supportsLocalBackup) return null;
  if (!cachedHandle) cachedHandle = await idbGet(KEY);
  if (!cachedHandle) return null;
  const perm = await cachedHandle.queryPermission({ mode: 'readwrite' });
  return perm === 'granted' ? cachedHandle : null;
}

/** Must be called from a click handler (user gesture) - either to pick a new folder
 *  or to re-grant permission to the previously picked one after a page reload. */
export async function chooseFolder() {
  if (!supportsLocalBackup) throw new Error('This browser does not support picking a local folder.');
  const handle = await window.showDirectoryPicker({ id: 'trading-journal', mode: 'readwrite' });
  await idbSet(KEY, handle);
  cachedHandle = handle;
  return handle;
}

/** Re-requests permission on the already-picked folder (needed after a reload in most browsers). */
export async function reconnectFolder() {
  if (!supportsLocalBackup) return null;
  const handle = cachedHandle || (await idbGet(KEY));
  if (!handle) return null;
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return null;
  cachedHandle = handle;
  return handle;
}

export async function forgetFolder() {
  cachedHandle = null;
  await idbDelete(KEY);
}

export async function folderInfo() {
  const handle = cachedHandle || (await idbGet(KEY));
  return handle ? { name: handle.name } : null;
}

function tradeFolderName(trade) {
  const safeSymbol = String(trade.symbol || 'trade').replace(/[^A-Za-z0-9_-]+/g, '');
  return `${trade.date}_${safeSymbol}_${trade.id}`;
}

async function getSubdir(root, name) {
  return root.getDirectoryHandle(name, { create: true });
}

/** Mirrors one trade's JSON (and creates its folder for images) onto the local folder. Best-effort. */
export async function mirrorTrade(trade) {
  const handle = await getActiveHandle();
  if (!handle) return;
  try {
    const tradesDir = await getSubdir(handle, 'trades');
    const tradeDir = await getSubdir(tradesDir, tradeFolderName(trade));
    const fileHandle = await tradeDir.getFileHandle('trade.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(trade, null, 2));
    await writable.close();
  } catch (err) {
    console.warn('Local backup: could not write trade JSON', err);
  }
}

/** Mirrors one uploaded image file into the trade's local folder. Best-effort. */
export async function mirrorImage(trade, file) {
  const handle = await getActiveHandle();
  if (!handle) return;
  try {
    const tradesDir = await getSubdir(handle, 'trades');
    const tradeDir = await getSubdir(tradesDir, tradeFolderName(trade));
    const fileHandle = await tradeDir.getFileHandle(file.name || `image-${Date.now()}`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
  } catch (err) {
    console.warn('Local backup: could not write image', err);
  }
}

/** Removes a trade's local mirror folder (if any). Best-effort. */
export async function removeTradeMirror(trade) {
  const handle = await getActiveHandle();
  if (!handle) return;
  try {
    const tradesDir = await getSubdir(handle, 'trades');
    await tradesDir.removeEntry(tradeFolderName(trade), { recursive: true });
  } catch (err) {
    // Folder may already be gone - not an error worth surfacing.
  }
}

/** Removes one mirrored image file from a trade's local folder (if any). Best-effort. */
export async function removeImageFile(trade, filename) {
  const handle = await getActiveHandle();
  if (!handle || !filename) return;
  try {
    const tradesDir = await getSubdir(handle, 'trades');
    const tradeDir = await getSubdir(tradesDir, tradeFolderName(trade));
    await tradeDir.removeEntry(filename);
  } catch (err) {
    // File may already be gone or was never mirrored - not an error worth surfacing.
  }
}

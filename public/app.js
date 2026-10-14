/* Trading Journal – PWA-Frontend. Kein Framework, keine Build-Schritte. */

/* ---------- API-Client ---------- */

const api = {
  async req(method, path, body) {
    const opts = { method, headers: {} };
    if (!['GET', 'HEAD'].includes(method)) opts.headers['X-TJ'] = '1';
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (res.status === 204) return null;
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json().catch(() => null) : null;
    if (!res.ok) throw new Error((data && data.error) || `Fehler ${res.status}`);
    return data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
  put: (p, b) => api.req('PUT', p, b),
  del: (p) => api.req('DELETE', p),

  listTrades: (from, to) => api.get(`/api/trades?${new URLSearchParams({ from, to })}`),
  getTrade: (id) => api.get(`/api/trades/${id}`),
  createTrade: (t) => api.post('/api/trades', t),
  updateTrade: (id, t) => api.put(`/api/trades/${id}`, t),
  deleteTrade: (id) => api.del(`/api/trades/${id}`),
  uploadImage: async (tradeId, file) => {
    const res = await fetch(`/api/trades/${tradeId}/images`, {
      method: 'POST',
      headers: {
        'X-TJ': '1',
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'bild'),
      },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Fehler ${res.status}`);
    return data;
  },
  deleteImage: (id) => api.del(`/api/images/${id}`),
  getSettings: () => api.get('/api/settings'),
  setSettings: (s) => api.put('/api/settings', s),
  getStorage: () => api.get('/api/storage'),
  addLocation: (name, path, activate) => api.post('/api/storage/locations', { name, path, activate }),
  setActiveLocation: (id) => api.put('/api/storage/active', { id }),
  removeLocation: (id) => api.del(`/api/storage/locations/${id}`),
};

/* ---------- Status / Helfer ---------- */

const state = {
  view: 'calendar',
  cursor: startOfMonth(new Date()),
  trades: [],
  loading: false,
  currency: 'EUR',
};

const $main = document.getElementById('main');
const $modalRoot = document.getElementById('modalRoot');
const $toast = document.getElementById('toast');

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthRange(cursor) {
  const from = isoDate(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const to = isoDate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  return { from, to };
}
const CUR_SYMBOL = { EUR: '€', USD: '$', CHF: 'CHF', GBP: '£', JPY: '¥', NONE: '' };
function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const sym = CUR_SYMBOL[state.currency] ?? '';
  const s = n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return state.currency === 'NONE' ? s : `${n >= 0 ? '' : ''}${s} ${sym}`.trim();
}
function pnlClass(n) { return n > 0 ? 'pnl-pos' : n < 0 ? 'pnl-neg' : ''; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showToast(msg, isError) {
  $toast.textContent = msg;
  $toast.classList.toggle('show', true);
  $toast.style.borderColor = isError ? 'var(--danger)' : 'var(--border)';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => $toast.classList.remove('show'), 3200);
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ---------- Routing / Tabs ---------- */

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  render();
}

async function render() {
  if (state.view === 'calendar') return renderCalendarView();
  if (state.view === 'stats') return renderStatsView();
  if (state.view === 'settings') return renderSettingsView();
}

/* ---------- Kalenderansicht ---------- */

async function loadMonthTrades() {
  const { from, to } = monthRange(state.cursor);
  state.loading = true;
  try {
    state.trades = await api.listTrades(from, to);
  } catch (err) {
    showToast(err.message, true);
    state.trades = [];
  } finally {
    state.loading = false;
  }
}

async function renderCalendarView() {
  $main.innerHTML = `<div class="cal-header">
      <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="prevMonth">‹</button>
      <button class="btn btn-ghost btn-sm" id="todayBtn">Heute</button></div>
      <h2 id="monthLabel"></h2>
      <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="nextMonth">›</button></div>
    </div>
    <div class="cal-summary" id="calSummary"></div>
    <div class="cal-grid" id="calGrid"></div>
    <div id="dayTrades"></div>`;

  document.getElementById('prevMonth').onclick = () => { state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1); renderCalendarView(); };
  document.getElementById('nextMonth').onclick = () => { state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1); renderCalendarView(); };
  document.getElementById('todayBtn').onclick = () => { state.cursor = startOfMonth(new Date()); state.selectedDay = isoDate(new Date()); renderCalendarView(); };

  document.getElementById('monthLabel').textContent = state.cursor.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  await loadMonthTrades();
  drawCalGrid();
  drawCalSummary();

  const selected = state.selectedDay && state.trades.some((t) => t.date === state.selectedDay)
    ? state.selectedDay
    : isoDate(new Date()) >= monthRange(state.cursor).from && isoDate(new Date()) <= monthRange(state.cursor).to
      ? isoDate(new Date())
      : null;
  if (selected) selectDay(selected);
}

function drawCalSummary() {
  const total = state.trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = state.trades.filter((t) => (t.pnl ?? 0) > 0).length;
  const losses = state.trades.filter((t) => (t.pnl ?? 0) < 0).length;
  document.getElementById('calSummary').innerHTML = `
    <span>Trades: <b>${state.trades.length}</b></span>
    <span>Gewinn/Verlust: <b class="${pnlClass(total)}">${fmtMoney(total)}</b></span>
    <span>Gewonnen/Verloren: <b>${wins} / ${losses}</b></span>`;
}

function drawCalGrid() {
  const grid = document.getElementById('calGrid');
  const y = state.cursor.getFullYear();
  const m = state.cursor.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // Montag = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = isoDate(new Date());

  const byDate = new Map();
  for (const t of state.trades) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }

  const dows = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  let html = dows.map((d) => `<div class="cal-dow">${d}</div>`).join('');

  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      html += `<div class="cal-day outside"></div>`;
      continue;
    }
    const dateStr = `${y}-${pad(m + 1)}-${pad(dayNum)}`;
    const dayTrades = byDate.get(dateStr) || [];
    const pnl = dayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const isToday = dateStr === today;
    html += `<div class="cal-day${isToday ? ' today' : ''}" data-date="${dateStr}">
        <span class="d-num">${dayNum}</span>
        ${dayTrades.length ? `<span class="d-pnl ${pnlClass(pnl)}">${fmtMoney(pnl)}</span><span class="d-count">${dayTrades.length} Trade${dayTrades.length > 1 ? 's' : ''}</span>` : ''}
      </div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.cal-day[data-date]').forEach((cell) => {
    cell.addEventListener('click', () => selectDay(cell.dataset.date));
  });
}

function selectDay(dateStr) {
  state.selectedDay = dateStr;
  document.querySelectorAll('.cal-day').forEach((c) => c.style.outline = c.dataset.date === dateStr ? '2px solid var(--accent)' : '');
  const dayTrades = state.trades.filter((t) => t.date === dateStr);
  const label = new Date(`${dateStr}T00:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
  const box = document.getElementById('dayTrades');
  box.innerHTML = `<div class="section-title">${label}</div>` +
    (dayTrades.length
      ? dayTrades.map(tradeRowHtml).join('')
      : `<div class="empty-hint">Keine Trades an diesem Tag.<br><button class="btn btn-sm" id="addForDay">+ Trade erfassen</button></div>`);
  box.querySelectorAll('.trade-row').forEach((row) => row.addEventListener('click', () => openTradeForm(Number(row.dataset.id))));
  const addBtn = document.getElementById('addForDay');
  if (addBtn) addBtn.addEventListener('click', () => openTradeForm(null, dateStr));
}

function tradeRowHtml(t) {
  const thumb = t.images[0] ? `<img class="thumb" src="${t.images[0].url}" alt="">` : '';
  const time = t.time ? ` · ${t.time}` : '';
  return `<div class="trade-row" data-id="${t.id}">
      ${thumb}
      <div>
        <div><span class="symbol">${escapeHtml(t.symbol)}</span> <span class="badge ${t.direction}">${t.direction === 'long' ? 'Long' : 'Short'}</span></div>
        <div class="meta">${escapeHtml(t.setup || '')}${time}</div>
      </div>
      <div class="pnl ${pnlClass(t.pnl ?? 0)}">${t.pnl != null ? fmtMoney(t.pnl) : '–'}</div>
    </div>`;
}

/* ---------- Statistik ---------- */

async function renderStatsView() {
  $main.innerHTML = `<div class="section-title">Statistik (gesamter Zeitraum)</div><div id="statsBody" class="muted">Lade…</div>`;
  let all;
  try {
    all = await api.listTrades();
  } catch (err) {
    document.getElementById('statsBody').textContent = err.message;
    return;
  }
  const closed = all.filter((t) => t.pnl != null);
  const total = closed.reduce((s, t) => s + t.pnl, 0);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const best = closed.reduce((m, t) => Math.max(m, t.pnl), 0);
  const worst = closed.reduce((m, t) => Math.min(m, t.pnl), 0);

  const bySymbol = new Map();
  for (const t of closed) bySymbol.set(t.symbol, (bySymbol.get(t.symbol) || 0) + t.pnl);
  const topSymbols = [...bySymbol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  document.getElementById('statsBody').innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><div class="label">Gesamt-P&L</div><div class="value ${pnlClass(total)}">${fmtMoney(total)}</div></div>
      <div class="stat-box"><div class="label">Trades gesamt</div><div class="value">${all.length}</div></div>
      <div class="stat-box"><div class="label">Trefferquote</div><div class="value">${winRate.toFixed(1)} %</div></div>
      <div class="stat-box"><div class="label">Profit-Faktor</div><div class="value">${Number.isFinite(pf) ? pf.toFixed(2) : '∞'}</div></div>
      <div class="stat-box"><div class="label">Ø Gewinn</div><div class="value pnl-pos">${fmtMoney(avgWin)}</div></div>
      <div class="stat-box"><div class="label">Ø Verlust</div><div class="value pnl-neg">${fmtMoney(avgLoss)}</div></div>
      <div class="stat-box"><div class="label">Bester Trade</div><div class="value pnl-pos">${fmtMoney(best)}</div></div>
      <div class="stat-box"><div class="label">Schlechtester Trade</div><div class="value pnl-neg">${fmtMoney(worst)}</div></div>
    </div>
    <div class="section-title">P&L nach Symbol</div>
    ${topSymbols.length ? topSymbols.map(([sym, p]) => `
      <div class="trade-row" style="cursor:default">
        <div class="symbol">${escapeHtml(sym)}</div>
        <div class="pnl ${pnlClass(p)}">${fmtMoney(p)}</div>
      </div>`).join('') : '<div class="empty-hint">Noch keine abgeschlossenen Trades.</div>'}
    <div class="section-title">Export</div>
    <a class="btn btn-outline" href="/api/export" download>Alle Trades als JSON exportieren</a>
  `;
}

/* ---------- Einstellungen ---------- */

async function renderSettingsView() {
  $main.innerHTML = `<div class="muted">Lade…</div>`;
  let settings, storage;
  try {
    [settings, storage] = await Promise.all([api.getSettings(), api.getStorage()]);
  } catch (err) {
    $main.innerHTML = `<div class="empty-hint">${escapeHtml(err.message)}</div>`;
    return;
  }
  state.currency = settings.currency;

  $main.innerHTML = `
    <div class="card">
      <div class="section-title" style="margin-top:0">Währung</div>
      <select id="currencySelect">
        ${['EUR', 'USD', 'CHF', 'GBP', 'JPY', 'NONE'].map((c) => `<option value="${c}" ${c === settings.currency ? 'selected' : ''}>${c === 'NONE' ? 'Keine / Punkte' : c}</option>`).join('')}
      </select>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">Bilder-Speicherort</div>
      <p class="muted" style="margin-top:0;font-size:0.85rem">
        Setup-Bilder werden auf diesem Server gespeichert. Läuft der Server auf dem Raspberry Pi,
        kann hier ein beliebiges angeschlossenes Laufwerk (z. B. unter <code>/mnt/…</code>) oder ein
        Nextcloud-Datenordner gewählt werden.
      </p>
      <div id="locList"></div>
      <div id="driveSuggestions"></div>
      <button class="btn btn-outline btn-sm" id="addLocBtn" style="margin-top:8px">+ Ordner/Laufwerk hinzufügen</button>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">App</div>
      <p class="muted" style="margin-top:0;font-size:0.85rem">
        Für Zugriff von Laptop und Smartphone über Tailscale: Server mit <code>HOST=0.0.0.0</code> starten
        und über die Tailscale-Adresse des Raspberry Pi aufrufen. Diese Seite lässt sich auf dem
        Smartphone über „Zum Startbildschirm“ als App installieren.
      </p>
      <button class="btn btn-outline btn-sm" id="exportBtn">Daten exportieren (JSON)</button>
    </div>
  `;

  document.getElementById('currencySelect').addEventListener('change', async (e) => {
    try {
      await api.setSettings({ currency: e.target.value });
      state.currency = e.target.value;
      showToast('Währung gespeichert.');
    } catch (err) {
      showToast(err.message, true);
    }
  });
  document.getElementById('exportBtn').addEventListener('click', () => { window.location.href = '/api/export'; });
  document.getElementById('addLocBtn').addEventListener('click', () => openLocationForm());

  drawLocations(storage);
}

function drawLocations(storage) {
  document.getElementById('locList').innerHTML = storage.locations.map((loc) => `
    <div class="loc-row">
      <span class="dot ${loc.available ? 'ok' : 'bad'}"></span>
      <div style="flex:1">
        <div class="name">${escapeHtml(loc.name)} ${loc.active ? '<span class="badge long">Aktiv</span>' : ''}</div>
        <div class="path">${escapeHtml(loc.path)}</div>
        <div class="muted" style="font-size:0.75rem">${loc.imageCount} Bild(er)${loc.free != null ? ` · ${(loc.free / 1e9).toFixed(1)} GB frei` : ''}${!loc.available ? ' · nicht erreichbar' : ''}</div>
      </div>
      ${!loc.active ? `<button class="btn btn-sm btn-outline" data-act="${loc.id}">Aktivieren</button>` : ''}
      ${!loc.isDefault ? `<button class="btn btn-sm btn-danger" data-rm="${loc.id}">Entfernen</button>` : ''}
    </div>`).join('');

  document.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await api.setActiveLocation(btn.dataset.act);
      showToast('Speicherort aktiviert.');
      renderSettingsView();
    } catch (err) { showToast(err.message, true); }
  }));
  document.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Diesen Speicherort aus der Liste entfernen? Dateien werden nicht gelöscht.')) return;
    try {
      await api.removeLocation(btn.dataset.rm);
      showToast('Entfernt.');
      renderSettingsView();
    } catch (err) { showToast(err.message, true); }
  }));

  document.getElementById('driveSuggestions').innerHTML = storage.suggestions.length
    ? `<div class="muted" style="font-size:0.78rem;margin:8px 0 4px">Gefundene Laufwerke:</div>` +
      storage.suggestions.map((s) => `
        <div class="suggest-row">
          <span>${escapeHtml(s.name)}<br><span class="muted">${escapeHtml(s.path)}</span></span>
          <button class="btn btn-sm" data-use="${escapeHtml(s.path)}" data-name="${escapeHtml(s.name)}">Nutzen</button>
        </div>`).join('')
    : '';
  document.querySelectorAll('[data-use]').forEach((btn) => btn.addEventListener('click', () => openLocationForm(btn.dataset.name, btn.dataset.use)));
}

function openLocationForm(name = '', path = '') {
  const node = el(`<div class="overlay"><div class="sheet">
    <div class="sheet-header"><h3>Speicherort hinzufügen</h3><button class="icon-btn" id="closeModal">✕</button></div>
    <div class="field"><label>Name</label><input id="locName" value="${escapeHtml(name)}" placeholder="z. B. Nextcloud-Bilder"></div>
    <div class="field"><label>Absoluter Pfad</label><input id="locPath" value="${escapeHtml(path)}" placeholder="/mnt/usb/Trading oder D:\\Trading\\Bilder"></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;margin-bottom:10px"><input type="checkbox" id="locActivate" style="width:auto" checked> Direkt aktivieren</label>
    <div class="error-msg" id="locErr"></div>
    <div class="sheet-actions"><button class="btn btn-outline" id="locCancel">Abbrechen</button><button class="btn" id="locSave">Speichern</button></div>
  </div></div>`);
  $modalRoot.appendChild(node);
  const close = () => node.remove();
  node.querySelector('#closeModal').onclick = close;
  node.querySelector('#locCancel').onclick = close;
  node.addEventListener('click', (e) => { if (e.target === node) close(); });
  node.querySelector('#locSave').onclick = async () => {
    const n = node.querySelector('#locName').value.trim();
    const p = node.querySelector('#locPath').value.trim();
    const activate = node.querySelector('#locActivate').checked;
    try {
      await api.addLocation(n, p, activate);
      showToast('Speicherort hinzugefügt.');
      close();
      renderSettingsView();
    } catch (err) {
      node.querySelector('#locErr').textContent = err.message;
    }
  };
}

/* ---------- Trade-Formular ---------- */

document.getElementById('btnAdd').addEventListener('click', () => openTradeForm(null, state.selectedDay || isoDate(new Date())));

async function openTradeForm(id, presetDate) {
  let trade = null;
  if (id) {
    try {
      trade = await api.getTrade(id);
    } catch (err) {
      showToast(err.message, true);
      return;
    }
  }
  const t = trade || { date: presetDate || isoDate(new Date()), time: '', symbol: '', direction: 'long', images: [] };
  const pendingImages = []; // Bilder, bevor der Trade gespeichert ist, zwischenspeichern

  const node = el(`<div class="overlay"><div class="sheet">
    <div class="sheet-header">
      <h3>${trade ? 'Trade bearbeiten' : 'Neuer Trade'}</h3>
      <button class="icon-btn" id="closeModal">✕</button>
    </div>
    <form id="tradeForm">
      <div class="row2">
        <div class="field"><label>Datum</label><input type="date" id="f_date" value="${t.date}" required></div>
        <div class="field"><label>Uhrzeit (optional)</label><input type="time" id="f_time" value="${t.time || ''}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Symbol</label><input id="f_symbol" value="${escapeHtml(t.symbol || '')}" placeholder="z. B. EURUSD" required></div>
        <div class="field"><label>Richtung</label>
          <div class="seg" id="f_direction" data-value="${t.direction}">
            <button type="button" class="long ${t.direction === 'long' ? 'active' : ''}" data-v="long">Long</button>
            <button type="button" class="short ${t.direction === 'short' ? 'active' : ''}" data-v="short">Short</button>
          </div>
        </div>
      </div>
      <div class="row3">
        <div class="field"><label>Einstieg</label><input type="text" inputmode="decimal" id="f_entry" value="${t.entryPrice ?? ''}"></div>
        <div class="field"><label>Ausstieg</label><input type="text" inputmode="decimal" id="f_exit" value="${t.exitPrice ?? ''}"></div>
        <div class="field"><label>Größe</label><input type="text" inputmode="decimal" id="f_size" value="${t.size ?? ''}"></div>
      </div>
      <div class="row3">
        <div class="field"><label>Stop-Loss</label><input type="text" inputmode="decimal" id="f_sl" value="${t.stopLoss ?? ''}"></div>
        <div class="field"><label>Take-Profit</label><input type="text" inputmode="decimal" id="f_tp" value="${t.takeProfit ?? ''}"></div>
        <div class="field"><label>Gebühren</label><input type="text" inputmode="decimal" id="f_fees" value="${t.fees ?? ''}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Ergebnis (P&L)</label><input type="text" inputmode="decimal" id="f_pnl" value="${t.pnl ?? ''}"></div>
        <div class="field"><label>Setup / Strategie</label><input id="f_setup" value="${escapeHtml(t.setup || '')}" placeholder="z. B. Breakout"></div>
      </div>
      <div class="field">
        <label>Bewertung der Ausführung</label>
        <div class="rating" id="f_rating" data-value="${t.rating || 0}">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" class="${n <= (t.rating || 0) ? 'on' : ''}">★</button>`).join('')}
        </div>
      </div>
      <div class="field"><label>Notizen (Setup, Plan, Emotionen …)</label><textarea id="f_notes">${escapeHtml(t.notes || '')}</textarea></div>
      <div class="field"><label>Nachbetrachtung</label><textarea id="f_review">${escapeHtml(t.review || '')}</textarea></div>

      <div class="field">
        <label>Setup-Bilder</label>
        <div class="img-grid" id="imgGrid"></div>
        <input type="file" id="fileInput" accept="image/*" multiple style="display:none">
      </div>

      <div class="error-msg" id="formErr"></div>
      <div class="sheet-actions">
        ${trade ? '<button type="button" class="btn btn-danger" id="deleteBtn">Löschen</button>' : ''}
        <button type="submit" class="btn" id="saveBtn">Speichern</button>
      </div>
    </form>
  </div></div>`);
  $modalRoot.appendChild(node);

  const close = () => node.remove();
  node.querySelector('#closeModal').onclick = close;
  node.addEventListener('click', (e) => { if (e.target === node) close(); });

  node.querySelector('#f_direction').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    node.querySelector('#f_direction').dataset.value = b.dataset.v;
    node.querySelectorAll('#f_direction button').forEach((x) => x.classList.toggle('active', x === b));
  });
  node.querySelector('#f_rating').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = Number(b.dataset.v);
    const cur = Number(node.querySelector('#f_rating').dataset.value);
    const next = cur === v ? 0 : v; // erneut klicken = zurücksetzen
    node.querySelector('#f_rating').dataset.value = next;
    node.querySelectorAll('#f_rating button').forEach((x) => x.classList.toggle('on', Number(x.dataset.v) <= next));
  });

  function renderImages() {
    const grid = node.querySelector('#imgGrid');
    const saved = t.images.map((img) => `
      <div class="img-thumb" data-img="${img.id}">
        <img src="${img.url}" alt="">
        <button type="button" class="rm" data-rm-img="${img.id}">✕</button>
      </div>`).join('');
    const pending = pendingImages.map((p, i) => p.uploading
      ? `<div class="img-thumb uploading">Lädt…</div>`
      : `<div class="img-thumb" data-pending="${i}"><img src="${p.url}" alt=""></div>`).join('');
    grid.innerHTML = saved + pending + (trade || true ? `<button type="button" class="upload-btn" id="addImgBtn">+</button>` : '');
    const addBtn = document.getElementById('addImgBtn');
    if (addBtn) addBtn.onclick = () => node.querySelector('#fileInput').click();
    grid.querySelectorAll('[data-rm-img]').forEach((b) => b.onclick = async () => {
      const imgId = Number(b.dataset.rmImg);
      try {
        await api.deleteImage(imgId);
        t.images = t.images.filter((im) => im.id !== imgId);
        renderImages();
      } catch (err) { showToast(err.message, true); }
    });
    grid.querySelectorAll('img').forEach((img) => img.addEventListener('click', (e) => {
      if (e.target.closest('[data-rm-img]')) return;
      openLightbox(img.src);
    }));
  }
  renderImages();

  node.querySelector('#fileInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) {
      if (trade) {
        const placeholder = { uploading: true };
        pendingImages.push(placeholder);
        renderImages();
        try {
          const img = await api.uploadImage(trade.id, file);
          t.images.push(img);
        } catch (err) {
          showToast(err.message, true);
        } finally {
          pendingImages.splice(pendingImages.indexOf(placeholder), 1);
          renderImages();
        }
      } else {
        // Neuer Trade: Bild merken, nach dem Anlegen hochladen
        pendingImages.push({ file, url: URL.createObjectURL(file), uploading: false });
        renderImages();
      }
    }
  });

  if (trade) {
    node.querySelector('#deleteBtn').addEventListener('click', async () => {
      if (!confirm('Diesen Trade inkl. Bildern wirklich löschen?')) return;
      try {
        await api.deleteTrade(trade.id);
        showToast('Trade gelöscht.');
        close();
        if (state.view === 'calendar') renderCalendarView();
      } catch (err) {
        node.querySelector('#formErr').textContent = err.message;
      }
    });
  }

  node.querySelector('#tradeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = node.querySelector('#saveBtn');
    saveBtn.disabled = true;
    const numOrNull = (v) => (v.trim() === '' ? null : v.trim());
    const payload = {
      date: node.querySelector('#f_date').value,
      time: node.querySelector('#f_time').value || null,
      symbol: node.querySelector('#f_symbol').value,
      direction: node.querySelector('#f_direction').dataset.value,
      entryPrice: numOrNull(node.querySelector('#f_entry').value),
      exitPrice: numOrNull(node.querySelector('#f_exit').value),
      stopLoss: numOrNull(node.querySelector('#f_sl').value),
      takeProfit: numOrNull(node.querySelector('#f_tp').value),
      size: numOrNull(node.querySelector('#f_size').value),
      fees: numOrNull(node.querySelector('#f_fees').value),
      pnl: numOrNull(node.querySelector('#f_pnl').value),
      setup: node.querySelector('#f_setup').value,
      rating: Number(node.querySelector('#f_rating').dataset.value) || null,
      notes: node.querySelector('#f_notes').value,
      review: node.querySelector('#f_review').value,
    };
    try {
      let saved;
      if (trade) {
        saved = await api.updateTrade(trade.id, payload);
      } else {
        saved = await api.createTrade(payload);
        for (const p of pendingImages) {
          if (p.file) {
            try { await api.uploadImage(saved.id, p.file); } catch (err) { showToast(`Bild-Upload fehlgeschlagen: ${err.message}`, true); }
          }
        }
      }
      showToast('Gespeichert.');
      close();
      state.selectedDay = payload.date;
      if (state.view === 'calendar') {
        state.cursor = startOfMonth(new Date(`${payload.date}T00:00:00`));
        renderCalendarView();
      } else {
        render();
      }
    } catch (err) {
      node.querySelector('#formErr').textContent = err.message;
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function openLightbox(src) {
  const node = el(`<div class="lightbox"><button class="close">✕</button><img src="${src}" alt=""></div>`);
  node.addEventListener('click', () => node.remove());
  document.body.appendChild(node);
}

/* ---------- PWA: Service Worker & Installation ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('btnInstall').hidden = false;
});
document.getElementById('btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('btnInstall').hidden = true;
});
window.addEventListener('appinstalled', () => { document.getElementById('btnInstall').hidden = true; });

/* ---------- Start ---------- */

(async function init() {
  try {
    const s = await api.getSettings();
    state.currency = s.currency;
  } catch { /* Server evtl. noch nicht bereit – Standardwährung verwenden */ }
  render();
})();

/* Trading Journal – PWA frontend. No framework, no build step.
   Data lives in Supabase (Postgres + Storage + Auth) so it syncs between
   devices/people for free; see supabase-client.js for that layer and
   local-backup.js for the optional local-folder mirror. */

import { api, auth } from './supabase-client.js';
import * as localBackup from './local-backup.js';

/* ---------- Offline cache (trade metadata only, for the calendar/stats
   screens to still show something useful without a connection) ---------- */

const offlineCache = {
  key: (from, to) => `tj-cache-${from || ''}-${to || ''}`,
  save(from, to, trades) {
    try { localStorage.setItem(offlineCache.key(from, to), JSON.stringify(trades)); } catch { /* storage full/unavailable - skip */ }
  },
  load(from, to) {
    try { return JSON.parse(localStorage.getItem(offlineCache.key(from, to)) || 'null'); } catch { return null; }
  },
};

async function listTradesWithCache(from, to) {
  try {
    const trades = await api.listTrades(from, to);
    offlineCache.save(from, to, trades);
    return trades;
  } catch (err) {
    const cached = offlineCache.load(from, to);
    if (cached) {
      showToast('Offline – showing cached data from this device.');
      return cached;
    }
    throw err;
  }
}

/* ---------- State / helpers ---------- */

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
const $authScreen = document.getElementById('authScreen');
const $appRoot = document.getElementById('app');

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
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return state.currency === 'NONE' ? s : `${s} ${sym}`.trim();
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

/* ---------- Routing / tabs ---------- */

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

/* ---------- Calendar view ---------- */

async function loadMonthTrades() {
  const { from, to } = monthRange(state.cursor);
  state.loading = true;
  try {
    state.trades = await listTradesWithCache(from, to);
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
      <button class="btn btn-ghost btn-sm" id="todayBtn">Today</button></div>
      <h2 id="monthLabel"></h2>
      <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="nextMonth">›</button></div>
    </div>
    <div class="cal-summary" id="calSummary"></div>
    <div class="cal-grid" id="calGrid"></div>
    <div id="dayTrades"></div>`;

  document.getElementById('prevMonth').onclick = () => { state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1); renderCalendarView(); };
  document.getElementById('nextMonth').onclick = () => { state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1); renderCalendarView(); };
  document.getElementById('todayBtn').onclick = () => { state.cursor = startOfMonth(new Date()); state.selectedDay = isoDate(new Date()); renderCalendarView(); };

  document.getElementById('monthLabel').textContent = state.cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

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
    <span>P&L: <b class="${pnlClass(total)}">${fmtMoney(total)}</b></span>
    <span>Won/Lost: <b>${wins} / ${losses}</b></span>`;
}

function drawCalGrid() {
  const grid = document.getElementById('calGrid');
  const y = state.cursor.getFullYear();
  const m = state.cursor.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = isoDate(new Date());

  const byDate = new Map();
  for (const t of state.trades) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }

  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
        ${dayTrades.length ? `<span class="d-pnl ${pnlClass(pnl)}">${fmtMoney(pnl)}</span><span class="d-count">${dayTrades.length} trade${dayTrades.length > 1 ? 's' : ''}</span>` : ''}
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
  const label = new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: '2-digit' });
  const box = document.getElementById('dayTrades');
  box.innerHTML = `<div class="section-title">${label}</div>` +
    (dayTrades.length
      ? dayTrades.map(tradeRowHtml).join('')
      : `<div class="empty-hint">No trades on this day.<br><button class="btn btn-sm" id="addForDay">+ Add trade</button></div>`);
  box.querySelectorAll('.trade-row').forEach((row) => row.addEventListener('click', () => openTradeView(Number(row.dataset.id))));
  box.querySelectorAll('.trade-edit').forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTradeForm(Number(btn.dataset.id));
  }));
  const addBtn = document.getElementById('addForDay');
  if (addBtn) addBtn.addEventListener('click', () => openTradeForm(null, dateStr));
}

function tradeRowHtml(t) {
  // Images are intentionally not shown in the calendar list, only in the trade view/edit forms.
  const time = t.time ? ` · ${t.time}` : '';
  return `<div class="trade-row" data-id="${t.id}">
      <div>
        <div><span class="symbol">${escapeHtml(t.symbol)}</span> <span class="badge ${t.direction}">${t.direction === 'long' ? 'Long' : 'Short'}</span></div>
        <div class="meta">${escapeHtml(t.setup || '')}${time}</div>
      </div>
      <div class="pnl ${pnlClass(t.pnl ?? 0)}">${t.pnl != null ? fmtMoney(t.pnl) : '–'}</div>
      <button type="button" class="icon-btn trade-edit" data-id="${t.id}" title="Edit" aria-label="Edit">✎</button>
    </div>`;
}

/* ---------- Stats ---------- */

async function renderStatsView() {
  $main.innerHTML = `
    <section class="stats-section stats-section-month">
      <div class="stats-section-header">
        <span class="stats-section-icon">📅</span>
        <div class="cal-header" style="margin-bottom:0;flex:1">
          <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="statsPrev">‹</button></div>
          <h2 id="statsMonthLabel"></h2>
          <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="statsNext">›</button></div>
        </div>
      </div>
      <div id="statsMonthBody" class="muted">Loading…</div>
    </section>

    <section class="stats-section stats-section-all">
      <div class="stats-section-header">
        <span class="stats-section-icon">∑</span>
        <h2>All time</h2>
      </div>
      <div id="statsAllBody" class="muted">Loading…</div>
    </section>

    <div class="section-title">Export</div>
    <a class="btn btn-outline" href="/api/export" download>Export all trades as JSON</a>
  `;

  if (!state.statsCursor) state.statsCursor = startOfMonth(new Date());

  document.getElementById('statsPrev').onclick = () => { state.statsCursor = new Date(state.statsCursor.getFullYear(), state.statsCursor.getMonth() - 1, 1); renderMonthStats(); };
  document.getElementById('statsNext').onclick = () => { state.statsCursor = new Date(state.statsCursor.getFullYear(), state.statsCursor.getMonth() + 1, 1); renderMonthStats(); };

  await renderMonthStats();

  let all;
  try {
    all = await listTradesWithCache();
  } catch (err) {
    document.getElementById('statsAllBody').textContent = err.message;
    return;
  }
  document.getElementById('statsAllBody').innerHTML = statsHtml(all);
}

async function renderMonthStats() {
  document.getElementById('statsMonthLabel').textContent = state.statsCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const { from, to } = monthRange(state.statsCursor);
  let monthTrades;
  try {
    monthTrades = await listTradesWithCache(from, to);
  } catch (err) {
    document.getElementById('statsMonthBody').textContent = err.message;
    return;
  }
  document.getElementById('statsMonthBody').innerHTML = monthTrades.length
    ? statsHtml(monthTrades)
    : '<div class="empty-hint">No trades in this month.</div>';
}

function statsHtml(all) {
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

  return `
    <div class="stat-grid">
      <div class="stat-box"><div class="label">Total P&L</div><div class="value ${pnlClass(total)}">${fmtMoney(total)}</div></div>
      <div class="stat-box"><div class="label">Total trades</div><div class="value">${all.length}</div></div>
      <div class="stat-box"><div class="label">Win rate</div><div class="value">${winRate.toFixed(1)} %</div></div>
      <div class="stat-box"><div class="label">Profit factor</div><div class="value">${Number.isFinite(pf) ? pf.toFixed(2) : '∞'}</div></div>
      <div class="stat-box"><div class="label">Avg. win</div><div class="value pnl-pos">${fmtMoney(avgWin)}</div></div>
      <div class="stat-box"><div class="label">Avg. loss</div><div class="value pnl-neg">${fmtMoney(avgLoss)}</div></div>
      <div class="stat-box"><div class="label">Best trade</div><div class="value pnl-pos">${fmtMoney(best)}</div></div>
      <div class="stat-box"><div class="label">Worst trade</div><div class="value pnl-neg">${fmtMoney(worst)}</div></div>
    </div>
    <div class="section-title">P&L by symbol</div>
    ${topSymbols.length ? topSymbols.map(([sym, p]) => `
      <div class="trade-row" style="cursor:default">
        <div class="symbol">${escapeHtml(sym)}</div>
        <div class="pnl ${pnlClass(p)}">${fmtMoney(p)}</div>
      </div>`).join('') : '<div class="empty-hint">No closed trades yet.</div>'}
  `;
}

/* ---------- Settings ---------- */

async function renderSettingsView() {
  $main.innerHTML = `<div class="muted">Loading…</div>`;
  let settings;
  try {
    settings = await api.getSettings();
  } catch (err) {
    $main.innerHTML = `<div class="empty-hint">${escapeHtml(err.message)}</div>`;
    return;
  }
  state.currency = settings.currency;

  const session = await auth.getSession();
  const email = session?.user?.email || '';
  const folder = await localBackup.folderInfo();

  $main.innerHTML = `
    <div class="card">
      <div class="section-title" style="margin-top:0">Account</div>
      <div class="account-row">
        <span class="dot ok"></span>
        <span class="email">${escapeHtml(email)}</span>
      </div>
      <p class="muted" style="font-size:0.8rem">Your trades and screenshots are private to this account - nobody else can see them, even other people using this same app.</p>
      <button class="btn btn-outline btn-sm" id="signOutBtn">Sign out</button>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">Currency</div>
      <select id="currencySelect">
        ${['EUR', 'USD', 'CHF', 'GBP', 'JPY', 'NONE'].map((c) => `<option value="${c}" ${c === settings.currency ? 'selected' : ''}>${c === 'NONE' ? 'None / points' : c}</option>`).join('')}
      </select>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">Cloud sync</div>
      <p class="muted" style="margin-top:0;font-size:0.85rem">
        Trades and setup screenshots are stored securely in the cloud and sync
        automatically across every device you sign in on - no network setup,
        no Tailscale, nothing to install on a server.
      </p>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">Local backup folder</div>
      ${localBackup.supportsLocalBackup ? `
        <p class="muted" style="margin-top:0;font-size:0.85rem">
          Optionally mirror every trade and screenshot as plain files into a folder
          on this device, in addition to the cloud. Useful as a personal backup or
          to feed the files into something else (e.g. your own sync tool).
        </p>
        <div class="backup-status">
          <span class="dot ${folder ? 'ok' : 'bad'}"></span>
          <span>${folder ? `Backing up to <span class="folder-name">${escapeHtml(folder.name)}</span>` : 'Not set up on this device'}</span>
        </div>
        <button class="btn btn-outline btn-sm" id="chooseFolderBtn">${folder ? 'Change folder' : 'Choose folder'}</button>
        <button class="btn btn-outline btn-sm" id="reconnectFolderBtn" style="display:none">Reconnect folder</button>
        ${folder ? '<button class="btn btn-outline btn-sm" id="stopFolderBtn">Stop local backup</button>' : ''}
      ` : `
        <p class="muted" style="margin-top:0;font-size:0.85rem">
          Your browser doesn't support picking a local folder (this is a limitation
          of Safari/iOS and Firefox, not of this app). Your data is still fully
          synced via the cloud - use <b>Export data</b> below to save a manual copy
          to this device whenever you like.
        </p>
      `}
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">App</div>
      <p class="muted" style="margin-top:0;font-size:0.85rem">
        Add this page to your home screen / install it as an app to use it like a
        native app on your phone or laptop.
      </p>
      <div id="installRow">
        ${isStandalone()
          ? '<span class="muted" style="font-size:0.85rem">✓ Installed as an app</span>'
          : '<button class="btn btn-outline btn-sm" id="installBtn">Install app</button>'}
      </div>
      <button class="btn btn-outline btn-sm" id="exportBtn" style="margin-top:8px">Export data (JSON)</button>
    </div>
  `;

  document.getElementById('currencySelect').addEventListener('change', async (e) => {
    try {
      await api.setSettings({ currency: e.target.value });
      state.currency = e.target.value;
      showToast('Currency saved.');
    } catch (err) {
      showToast(err.message, true);
    }
  });
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await auth.signOut();
  });
  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      const data = await api.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'trading-journal-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  const chooseFolderBtn = document.getElementById('chooseFolderBtn');
  if (chooseFolderBtn) {
    chooseFolderBtn.addEventListener('click', async () => {
      try {
        await localBackup.chooseFolder();
        showToast('Local backup folder set.');
        renderSettingsView();
      } catch (err) {
        if (err.name !== 'AbortError') showToast(err.message, true);
      }
    });
  }
  const reconnectFolderBtn = document.getElementById('reconnectFolderBtn');
  if (reconnectFolderBtn) {
    reconnectFolderBtn.addEventListener('click', async () => {
      const ok = await localBackup.reconnectFolder();
      showToast(ok ? 'Reconnected.' : 'Could not reconnect to the folder.', !ok);
      renderSettingsView();
    });
  }
  const stopFolderBtn = document.getElementById('stopFolderBtn');
  if (stopFolderBtn) {
    stopFolderBtn.addEventListener('click', async () => {
      await localBackup.forgetFolder();
      showToast('Local backup stopped.');
      renderSettingsView();
    });
  }
  if (localBackup.supportsLocalBackup && folder) {
    localBackup.getActiveHandle().then((handle) => {
      if (!handle && reconnectFolderBtn) reconnectFolderBtn.style.display = '';
    });
  }

  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        renderSettingsView();
      } else {
        showToast('Use your browser\'s menu: "Add to Home Screen" (iOS/Safari) or "Install app" (Chrome/Edge menu).');
      }
    });
  }
}

/* ---------- Trade form ---------- */

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
  const pendingImages = []; // images staged before a new trade is saved

  const node = el(`<div class="overlay"><div class="sheet">
    <div class="sheet-header">
      <h3>${trade ? 'Edit trade' : 'New trade'}</h3>
      <button class="icon-btn" id="closeModal">✕</button>
    </div>
    <form id="tradeForm">
      <div class="row2">
        <div class="field"><label>Date</label><input type="date" id="f_date" value="${t.date}" required></div>
        <div class="field"><label>Time (optional)</label><input type="time" id="f_time" value="${t.time || ''}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Symbol</label><input id="f_symbol" value="${escapeHtml(t.symbol || '')}" placeholder="e.g. EURUSD" required></div>
        <div class="field"><label>Direction</label>
          <div class="seg" id="f_direction" data-value="${t.direction}">
            <button type="button" class="long ${t.direction === 'long' ? 'active' : ''}" data-v="long">Long</button>
            <button type="button" class="short ${t.direction === 'short' ? 'active' : ''}" data-v="short">Short</button>
          </div>
        </div>
      </div>
      <div class="row3">
        <div class="field"><label>Entry (optional)</label><input type="text" inputmode="decimal" id="f_entry" value="${t.entryPrice ?? ''}"></div>
        <div class="field"><label>Exit (optional)</label><input type="text" inputmode="decimal" id="f_exit" value="${t.exitPrice ?? ''}"></div>
        <div class="field"><label>Size (optional)</label><input type="text" inputmode="decimal" id="f_size" value="${t.size ?? ''}"></div>
      </div>
      <div class="row3">
        <div class="field"><label>Stop-loss (optional)</label><input type="text" inputmode="decimal" id="f_sl" value="${t.stopLoss ?? ''}"></div>
        <div class="field"><label>Take-profit (optional)</label><input type="text" inputmode="decimal" id="f_tp" value="${t.takeProfit ?? ''}"></div>
        <div class="field"><label>Fees (optional)</label><input type="text" inputmode="decimal" id="f_fees" value="${t.fees ?? ''}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Result (P&L)</label><input type="text" inputmode="decimal" id="f_pnl" value="${t.pnl ?? ''}" required></div>
        <div class="field"><label>Setup / strategy (optional)</label><input id="f_setup" value="${escapeHtml(t.setup || '')}" placeholder="e.g. Breakout"></div>
      </div>
      <div class="field">
        <label>Execution rating (optional)</label>
        <div class="rating" id="f_rating" data-value="${t.rating || 0}">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" class="${n <= (t.rating || 0) ? 'on' : ''}">★</button>`).join('')}
        </div>
      </div>
      <div class="field"><label>Notes (optional – setup, plan, emotions …)</label><textarea id="f_notes">${escapeHtml(t.notes || '')}</textarea></div>
      <div class="field"><label>Review (optional)</label><textarea id="f_review">${escapeHtml(t.review || '')}</textarea></div>

      <div class="field">
        <label>Setup screenshots (optional)</label>
        <div class="img-grid" id="imgGrid"></div>
      </div>

      <div class="error-msg" id="formErr"></div>
      <div class="sheet-actions">
        ${trade ? '<button type="button" class="btn btn-danger" id="deleteBtn">Delete</button>' : ''}
        <button type="submit" class="btn" id="saveBtn">Save</button>
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
    const next = cur === v ? 0 : v; // click again to reset
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
      ? `<div class="img-thumb uploading">Uploading…</div>`
      : `<div class="img-thumb" data-pending="${i}"><img src="${p.url}" alt=""></div>`).join('');
    grid.innerHTML = saved + pending + `<label class="upload-btn"><span aria-hidden="true">+</span><span class="visually-hidden">Add screenshots</span><input type="file" id="fileInput" class="visually-hidden" accept="image/*" multiple></label>`;
    grid.querySelector('#fileInput').addEventListener('change', onFilesSelected);
    grid.querySelectorAll('[data-rm-img]').forEach((b) => b.onclick = async () => {
      const imgId = Number(b.dataset.rmImg);
      const removedImage = t.images.find((im) => im.id === imgId);
      try {
        await api.deleteImage(imgId);
        t.images = t.images.filter((im) => im.id !== imgId);
        renderImages();
        if (removedImage) localBackup.removeImageFile(t, removedImage.name).catch(() => {});
      } catch (err) { showToast(err.message, true); }
    });
    grid.querySelectorAll('img').forEach((img) => img.addEventListener('click', (e) => {
      if (e.target.closest('[data-rm-img]')) return;
      openLightbox(img.src);
    }));
  }
  async function onFilesSelected(e) {
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
          localBackup.mirrorImage(t, file).catch(() => {});
        } catch (err) {
          showToast(err.message, true);
        } finally {
          pendingImages.splice(pendingImages.indexOf(placeholder), 1);
          renderImages();
        }
      } else {
        // New trade: stage the image, upload once the trade has been created
        pendingImages.push({ file, url: URL.createObjectURL(file), uploading: false });
        renderImages();
      }
    }
  }
  renderImages();

  if (trade) {
    node.querySelector('#deleteBtn').addEventListener('click', async () => {
      if (!confirm('Delete this trade and its images?')) return;
      try {
        await api.deleteTrade(trade.id);
        localBackup.removeTradeMirror(trade).catch(() => {});
        showToast('Trade deleted.');
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
        localBackup.mirrorTrade(saved).catch(() => {});
      } else {
        saved = await api.createTrade(payload);
        localBackup.mirrorTrade(saved).catch(() => {});
        for (const p of pendingImages) {
          if (p.file) {
            try {
              await api.uploadImage(saved.id, p.file);
              localBackup.mirrorImage(saved, p.file).catch(() => {});
            } catch (err) { showToast(`Image upload failed: ${err.message}`, true); }
          }
        }
      }
      showToast('Saved.');
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

/* ---------- Trade view (read-only) ---------- */

async function openTradeView(id) {
  let t;
  try {
    t = await api.getTrade(id);
  } catch (err) {
    showToast(err.message, true);
    return;
  }

  const node = el(`<div class="overlay"><div class="sheet">
    <div class="sheet-header">
      <h3>${escapeHtml(t.symbol)} <span class="badge ${t.direction}">${t.direction === 'long' ? 'Long' : 'Short'}</span></h3>
      <button class="icon-btn" id="closeModal">✕</button>
    </div>
    <div id="viewBody"></div>
  </div></div>`);
  $modalRoot.appendChild(node);
  const close = () => node.remove();
  node.querySelector('#closeModal').onclick = close;
  node.addEventListener('click', (e) => { if (e.target === node) close(); });

  node.querySelector('#viewBody').innerHTML = tradeViewHtml(t);
  node.querySelectorAll('.img-thumb img').forEach((img) => img.addEventListener('click', () => openLightbox(img.src)));

  node.querySelector('#editFromView').addEventListener('click', () => {
    close();
    openTradeForm(t.id);
  });
}

function viewField(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="field"><label>${label}</label><div>${value}</div></div>`;
}

function tradeViewHtml(t) {
  const dateLabel = new Date(`${t.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: '2-digit' });
  const stars = t.rating ? '★'.repeat(t.rating) + '☆'.repeat(5 - t.rating) : '';
  return `
    ${viewField('Date', `${dateLabel}${t.time ? ` · ${t.time}` : ''}`)}
    ${viewField('Result (P&L)', `<span class="${pnlClass(t.pnl ?? 0)}">${fmtMoney(t.pnl)}</span>`)}
    ${viewField('Entry', t.entryPrice)}
    ${viewField('Exit', t.exitPrice)}
    ${viewField('Size', t.size)}
    ${viewField('Stop-loss', t.stopLoss)}
    ${viewField('Take-profit', t.takeProfit)}
    ${viewField('Fees', t.fees)}
    ${viewField('Setup / strategy', escapeHtml(t.setup))}
    ${viewField('Execution rating', stars)}
    ${viewField('Notes', escapeHtml(t.notes || '').replace(/\n/g, '<br>'))}
    ${viewField('Review', escapeHtml(t.review || '').replace(/\n/g, '<br>'))}
    ${t.images.length ? `<div class="field"><label>Setup screenshots</label><div class="img-grid">
        ${t.images.map((img) => `<div class="img-thumb"><img src="${img.url}" alt=""></div>`).join('')}
      </div></div>` : ''}
    <div class="sheet-actions"><button type="button" class="btn btn-block" id="editFromView">✎ Edit trade</button></div>
  `;
}

function openLightbox(src) {
  const node = el(`<div class="lightbox"><button class="close">✕</button><img src="${src}" alt=""></div>`);
  node.addEventListener('click', () => node.remove());
  document.body.appendChild(node);
}

/* ---------- PWA: service worker & install prompt ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (state.view === 'settings') renderSettingsView();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  if (state.view === 'settings') renderSettingsView();
});

/* ---------- Auth screen ---------- */

function showApp() {
  $authScreen.hidden = true;
  $appRoot.hidden = false;
}

function showAuthScreen() {
  $appRoot.hidden = true;
  $authScreen.hidden = false;
}

function setupAuthForm() {
  const tabs = document.getElementById('authTabs');
  const form = document.getElementById('authForm');
  const submitBtn = document.getElementById('authSubmit');
  const errEl = document.getElementById('authErr');
  const infoEl = document.getElementById('authInfo');
  const forgotBtn = document.getElementById('authForgot');

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tabs.dataset.value = b.dataset.v;
    tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    submitBtn.textContent = b.dataset.v === 'signup' ? 'Create account' : 'Sign in';
    errEl.textContent = '';
    infoEl.textContent = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    infoEl.textContent = '';
    submitBtn.disabled = true;
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    try {
      if (tabs.dataset.value === 'signup') {
        const { data, error } = await auth.signUp(email, password);
        if (error) throw error;
        if (!data.session) {
          infoEl.textContent = 'Account created. Check your email to confirm it, then sign in.';
        }
      } else {
        const { error } = await auth.signIn(email, password);
        if (error) throw error;
      }
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  forgotBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    infoEl.textContent = '';
    const email = document.getElementById('authEmail').value.trim();
    if (!email) {
      errEl.textContent = 'Enter your email above first.';
      return;
    }
    try {
      const { error } = await auth.resetPassword(email);
      if (error) throw error;
      infoEl.textContent = 'Password reset email sent - check your inbox.';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/* ---------- Start ---------- */

(async function init() {
  setupAuthForm();
  auth.onChange(async (session) => {
    if (!session) {
      showAuthScreen();
      return;
    }
    showApp();
    try {
      const s = await api.getSettings();
      state.currency = s.currency;
    } catch { /* settings row may not exist yet - fall back to default currency */ }
    render();
  });
})();

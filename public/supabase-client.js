/* Supabase-backed data layer. Keeps the same shape the UI already expects
   (see the old self-hosted `api` object) so the rest of the app barely
   had to change: listTrades/getTrade/createTrade/... all still exist,
   they just talk to Supabase (Postgres + Storage + Auth) instead of a
   local Node server. */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Public by design: this is the "anon" key, safe to ship to the browser.
// Actual data access is enforced server-side by Postgres Row Level Security
// and Storage policies (see the migration in the project), so this key on
// its own cannot read or write another user's trades or images.
export const SUPABASE_URL = 'https://awwsndasgqrixvqecatw.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3d3NuZGFzZ3FyaXh2cWVjYXR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjkzMDMsImV4cCI6MjEwODAwNTMwM30.RQY5uOWeUW90q5Vx-q3wbUxAwhPRgO1Ea5pht1Yk5i4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const BUCKET = 'trade-images';
const SIGNED_URL_TTL = 60 * 60; // 1 hour; regenerated on every fetch, nothing is cached long-term

function must(error) {
  if (error) throw new Error(error.message || String(error));
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  must(error);
  if (!data.user) throw new Error('Not signed in.');
  return data.user.id;
}

async function signedImageUrl(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL);
  if (error) return null; // file might be mid-upload or briefly unavailable; UI just shows a broken thumb
  return data.signedUrl;
}

function toTrade(row) {
  return {
    id: row.id,
    date: row.trade_date,
    time: row.trade_time,
    symbol: row.symbol,
    direction: row.direction,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    size: row.size,
    fees: row.fees,
    pnl: row.pnl,
    setup: row.setup,
    rating: row.rating,
    notes: row.notes,
    review: row.review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    images: [], // filled in by attachImages()
  };
}

async function attachImages(trades) {
  if (!trades.length) return trades;
  const { data: rows, error } = await supabase
    .from('trade_images')
    .select('*')
    .in('trade_id', trades.map((t) => t.id))
    .order('created_at');
  must(error);
  const byTrade = new Map(trades.map((t) => [t.id, t]));
  await Promise.all((rows || []).map(async (r) => {
    byTrade.get(r.trade_id).images.push({
      id: r.id,
      tradeId: r.trade_id,
      url: await signedImageUrl(r.storage_path),
      storagePath: r.storage_path,
      name: r.original_name,
      mime: r.mime,
      size: r.size,
      createdAt: r.created_at,
    });
  }));
  return trades;
}

const toDbFields = (t) => ({
  trade_date: t.date,
  trade_time: t.time || null,
  symbol: String(t.symbol || '').trim().toUpperCase(),
  direction: t.direction,
  entry_price: numOrNull(t.entryPrice),
  exit_price: numOrNull(t.exitPrice),
  stop_loss: numOrNull(t.stopLoss),
  take_profit: numOrNull(t.takeProfit),
  size: numOrNull(t.size),
  fees: numOrNull(t.fees),
  pnl: numOrNull(t.pnl),
  setup: t.setup || null,
  rating: t.rating || null,
  notes: t.notes || null,
  review: t.review || null,
});

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function safeFilename(name) {
  return String(name || 'image').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(-120) || 'image';
}

export const api = {
  async listTrades(from, to) {
    let q = supabase.from('trades').select('*').order('trade_date').order('trade_time', { nullsFirst: true });
    if (from) q = q.gte('trade_date', from);
    if (to) q = q.lte('trade_date', to);
    const { data, error } = await q;
    must(error);
    return attachImages((data || []).map(toTrade));
  },

  async getTrade(id) {
    const { data, error } = await supabase.from('trades').select('*').eq('id', id).maybeSingle();
    must(error);
    if (!data) throw new Error('Trade not found.');
    return (await attachImages([toTrade(data)]))[0];
  },

  async createTrade(t) {
    if (!t.date) throw new Error('Date is missing or invalid.');
    if (!t.symbol) throw new Error('Please enter a symbol.');
    if (!['long', 'short'].includes(t.direction)) throw new Error('Direction must be long or short.');
    if (numOrNull(t.pnl) === null) throw new Error('Result is required.');
    const user_id = await currentUserId();
    const { data, error } = await supabase.from('trades').insert({ ...toDbFields(t), user_id }).select().single();
    must(error);
    return (await attachImages([toTrade(data)]))[0];
  },

  async updateTrade(id, t) {
    if (numOrNull(t.pnl) === null) throw new Error('Result is required.');
    const { data, error } = await supabase.from('trades').update(toDbFields(t)).eq('id', id).select().maybeSingle();
    must(error);
    if (!data) throw new Error('Trade not found.');
    return (await attachImages([toTrade(data)]))[0];
  },

  async deleteTrade(id) {
    const { data: images } = await supabase.from('trade_images').select('storage_path').eq('trade_id', id);
    if (images && images.length) {
      await supabase.storage.from(BUCKET).remove(images.map((i) => i.storage_path));
    }
    const { error } = await supabase.from('trades').delete().eq('id', id);
    must(error);
  },

  async uploadImage(tradeId, file) {
    const user_id = await currentUserId();
    const path = `${user_id}/${tradeId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    must(upErr);
    const { data, error } = await supabase.from('trade_images').insert({
      trade_id: tradeId,
      user_id,
      storage_path: path,
      original_name: file.name || null,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    }).select().single();
    must(error);
    return {
      id: data.id,
      tradeId: data.trade_id,
      url: await signedImageUrl(path),
      storagePath: path,
      name: data.original_name,
      mime: data.mime,
      size: data.size,
      createdAt: data.created_at,
    };
  },

  async deleteImage(id) {
    const { data: row } = await supabase.from('trade_images').select('storage_path').eq('id', id).maybeSingle();
    if (row) await supabase.storage.from(BUCKET).remove([row.storage_path]);
    const { error } = await supabase.from('trade_images').delete().eq('id', id);
    must(error);
  },

  async getSettings() {
    const user_id = await currentUserId();
    const { data, error } = await supabase.from('user_settings').select('currency').eq('user_id', user_id).maybeSingle();
    must(error);
    return { currency: data?.currency || 'EUR' };
  },

  async setSettings(s) {
    const user_id = await currentUserId();
    const { error } = await supabase.from('user_settings').upsert({ user_id, currency: s.currency });
    must(error);
    return { currency: s.currency };
  },

  async exportAll() {
    const trades = await api.listTrades();
    return { exportedAt: new Date().toISOString(), trades };
  },
};

/* ---------- Auth ---------- */

export const auth = {
  getSession: () => supabase.auth.getSession().then(({ data }) => data.session),
  onChange: (cb) => supabase.auth.onAuthStateChange((_event, session) => cb(session)),
  signUp: (email, password) => supabase.auth.signUp({ email, password }),
  signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
  signOut: () => supabase.auth.signOut(),
  resetPassword: (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
};

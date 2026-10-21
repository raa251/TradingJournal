# Migration to Supabase + optional local folder — TODO

Status board for moving Trading Journal from the self-hosted
Raspberry-Pi/SQLite backend to a Supabase-backed app (free tier) that can
be shared with other people, plus an optional local-folder mirror for
offline/backup use on laptop and phone. Mirrored as GitHub issues for
visibility; check items off here and in the issues as they land.

- [x] Supabase project created (`trading-journal`, eu-central-1)
- [x] Database schema: `trades`, `trade_images`, `user_settings`, all with
      Row Level Security scoped to `user_id = auth.uid()`
- [x] Storage bucket `trade-images` with per-user folder policies
- [x] Security advisor warnings resolved (function `search_path`)
- [x] `public/supabase-client.js`: Supabase-backed drop-in replacement for
      the old `api` object, plus an `auth` helper
- [x] `public/local-backup.js`: optional local-folder mirror module (File
      System Access API; desktop Chrome/Edge + Android Chrome only)
- [x] Old self-hosted server moved to `legacy-self-hosted/` (kept as a
      fallback, not deleted)
- [ ] **Sign-in/sign-up screen actually wired up** — the HTML exists in
      `index.html` but nothing shows/hides it or handles form submit yet.
      The app cannot log anyone in right now. (#1)
- [ ] **Fix `renderSettingsView` crash** — calls an undefined
      `auth_supabaseUser()`. (#1)
- [ ] **Local folder mirroring actually wired into trade/image flows** —
      `local-backup.js` is only used by the Settings "choose folder" UI;
      creating/editing/deleting a trade or uploading/deleting an image
      never calls `mirrorTrade` / `mirrorImage` / `removeTradeMirror`. (#2)
- [ ] Root `README.md` still describes the old self-hosted setup — rewrite
      for the Supabase + optional local-folder architecture. (#3)
- [ ] End-to-end test: sign up, create a trade with images, confirm it
      shows up after reload and from a second browser session (simulating
      the colleague's device), confirm local folder actually receives
      files on a Chromium-based browser. (#4)
- [ ] Host the static frontend for free (Vercel/Cloudflare Pages/Netlify)
      so it's reachable without running anything on a Pi at all. (#5)
- [ ] Invite the colleague: have them sign up their own account (separate,
      private journal — enforced by RLS, not just by UI). (#6)

See the GitHub issues on this repo for the same list with more detail.

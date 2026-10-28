# TODO

## Architecture decision (2026-10-25)

Supabase was tried and then **fully reverted** (commit `8c98288`). Final
setup: there is no shared backend at all. Each person runs their own
separate, fully local copy of the original self-hosted app:

- **You**: keep running it on the Raspberry Pi, reachable over Tailscale,
  with a choosable image storage folder - exactly as before.
- **Colleague**: runs the same app locally on his own machine(s), no
  Tailscale, no network exposure. If he uses it on both a laptop and a
  phone, those are two independent, unsynced copies (his choice, not a
  limitation he needs solved right now).

This gives both people a completely separate, private journal by
construction (separate installs/databases), at zero cost, with no login
and no cloud dependency.

## Remaining steps

- [x] Move `legacy-self-hosted/*` back to the repo root (server, tests,
      deploy, scripts, package.json)
- [x] Restore `public/` (app.js, index.html, styles.css, manifest, sw.js)
      to the pre-Supabase version; remove `supabase-client.js` /
      `local-backup.js`
- [x] Close the now-obsolete Supabase GitHub issues (#7-#10, #3)
- [x] Supabase project from the experiment (`trading-journal`, ref
      `awwsndasgqrixvqecatw`) is already auto-paused (inactive, free tier,
      costs nothing). Full deletion isn't available via API/MCP - if you
      want it gone entirely, delete it yourself from the Supabase
      dashboard; otherwise it's harmless as-is.
- [ ] Write colleague setup instructions: how to get the code and run it
      locally on his own machine (covered in README's "Running your own
      copy" section - verify it's clear enough for a non-dev colleague)
- [ ] Double-check `npm test` and a manual smoke run both still work after
      the revert (done once already after the revert commit; re-verify
      after any further change)

## Still open from before (unrelated to Supabase)

- #2 Weekend delete - option to delete all Saturday/Sunday entries from
  the calendar
- #4 Storage management option - bulk-delete images older than a chosen
  age (1 day/week/month/3 months/6 months/1 year/all), trades stay intact,
  with a confirmation dialog

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
- [x] Write colleague setup instructions: how to get the code and run it
      locally on his own machine (README's "Giving a copy to someone else"
      section)
- [x] `npm test` passes after every change since the revert (10/10)

## Done (previously open, unrelated to Supabase)

- [x] #4 Storage management option - Settings -> Storage cleanup lets you
      bulk-delete images older than a chosen age (1 day/week/month/3
      months/6 months/1 year/all); trades stay intact, only the image
      files/rows are removed, with a confirmation dialog first
      (commits `37b3b6f`, `f6eab42`).
- [x] #2 Weekend delete - clarified with the user as "hide weekend
      columns", not "delete weekend trades". Settings -> Calendar ->
      "Hide Saturday/Sunday columns" switches the calendar to a 5-day
      week; existing weekend trades are kept and stay visible in the day
      view/stats/export (commits `c643325`, `6f55c76`).

No open items remain right now.

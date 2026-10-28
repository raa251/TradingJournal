# Trading Journal

A self-hosted trading journal PWA: calendar view, log individual trades,
attach setup screenshots - usable from both laptop and phone.

- **No build step, no dependencies.** Plain `node:http` plus Node's built-in
  `node:sqlite`. Only needs Node **>= 22.5**.
- **PWA**: installable on a phone's home screen, app shell is cached via a
  service worker. The data itself (trades, images) always comes live from
  the server - an offline data store is deliberately not built in, since
  this is a server-backed journal with a selectable image path.
- **Freely choosable image storage location**: under *Settings -> Storage
  location* you can point new setup screenshots at any folder reachable by
  the server (e.g. an attached drive or a Nextcloud data folder) as the
  active location. The server automatically detects attached drives as
  suggestions.

## Run locally (for testing)

```bash
npm start
# or with autoreload during development:
npm run dev
```

By default the app only listens locally at <http://localhost:3000>, with
no login (see the note below). Data lands in `./data/` (SQLite file +
default image folder), which is excluded via `.gitignore`.

Environment variables (optional):

| Variable            | Purpose                                                   | Default        |
|---------------------|------------------------------------------------------------|----------------|
| `PORT`               | Port                                                       | `3000`         |
| `HOST`               | Bind address. `0.0.0.0` for access from the network/Tailscale | `127.0.0.1`    |
| `TJ_DATA_DIR`        | Folder for the DB + default images                         | `./data`       |
| `TJ_ALLOWED_HOSTS`   | Additional allowed hostnames, comma-separated               | *(empty)*      |

## Tests

```bash
npm test
```

## Running on a Raspberry Pi (alongside Nextcloud, over Tailscale)

1. Clone the repo onto the Pi (Node >= 22.5 must be installed):
   ```bash
   git clone <repo-url> ~/tradingjournal
   cd ~/tradingjournal
   ```
2. Pick a data folder - either local on the Pi's SD card/SSD, or an extra
   attached drive, e.g. `/mnt/usb/tradingjournal-data`.
3. Copy `deploy/tradingjournal.service` to `/etc/systemd/system/`, adjust
   the paths/variables, then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now tradingjournal
   ```
4. The service listens on the whole (Tailscale) network via `HOST=0.0.0.0`.
   Open it from your laptop/phone via the Pi's Tailscale IP or MagicDNS
   name, e.g. `http://raspberrypi.<your-tailnet>.ts.net:3000`.
5. On your phone, open the page and install it as an app via "Add to Home
   Screen" (iOS) or the install button (Android/Chrome).
6. Under *Settings -> Image storage location* you can then set, for
   example, your Nextcloud data folder (or an external drive) as the
   storage location for setup screenshots, so they get backed up
   automatically along with the rest of Nextcloud.

**Security note:** The app currently has **no login**. It is meant to run
only inside your own network, locked down via Tailscale. Never expose the
server directly to the open internet/port-forwarding with `HOST=0.0.0.0`
without putting authentication in front of it first (e.g. Tailscale
Serve/Funnel with access restrictions, or a reverse proxy with basic auth).

## Giving a copy to someone else (e.g. a colleague)

There is no shared backend and no login - each person who wants their own
journal just runs their own separate copy of this app. Their data (and
yours) never touches anyone else's machine.

1. They clone this repo onto their own laptop (needs Node **>= 22.5**):
   ```bash
   git clone <repo-url> trading-journal
   cd trading-journal
   npm start
   ```
2. They open <http://localhost:3000> in their browser. That's it - no
   Tailscale, no network setup, nothing to expose. Their trades/images are
   stored only on that machine (`./data/` by default).
3. If they also want it on their phone: a phone can't run the Node server
   itself in the same simple way (Android users could try running it under
   Termux; this isn't tested here). The straightforward option is to just
   use it from the laptop, or run a second, completely separate copy
   wherever else they want it - by design these copies don't sync with
   each other, exactly like two independent notebooks.

## Data model

- **Trade**: date, time, symbol, direction (long/short), entry, exit,
  stop-loss, take-profit, size, fees, result (P&L), setup, rating
  (1-5 stars), notes, review - plus any number of images. Only date,
  direction, symbol and result are required; everything else is optional.
- **Image**: multiple per trade, filename/path stored in the DB, the
  actual file lives in the chosen storage location under `YEAR/MONTH/...`.
- **Export**: *Stats -> Export all trades as JSON*.

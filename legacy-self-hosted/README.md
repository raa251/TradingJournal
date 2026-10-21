# Legacy: self-hosted version (Raspberry Pi + Tailscale)

This is the original single-device version of Trading Journal: a plain
Node.js server (`server/`) storing data in a local SQLite file and images
on a local/attached drive, meant to run on a Raspberry Pi and be reached
over Tailscale.

**The project has since moved to a Supabase-backed version** (see the
repo root `README.md`) so it can be shared with other people, synced
across devices, and hosted for free without exposing a home network. This
folder is kept only as a reference / fallback if you ever want to go back
to a fully self-hosted, single-user setup.

To run this version:

```bash
cd legacy-self-hosted
npm start
```

See the comments in `server/config.js` for environment variables, and
`deploy/tradingjournal.service` for the systemd unit used on the Pi.

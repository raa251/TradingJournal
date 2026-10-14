# Trading Journal

Eine selbst gehostete Trading-Journal-PWA: Kalenderansicht, Trades erfassen,
Setup-Bilder anhängen – von Laptop und Smartphone aus nutzbar.

- **Kein Build-Schritt, keine Abhängigkeiten.** Reines `node:http` + das in
  Node eingebaute `node:sqlite`. Braucht nur Node **≥ 22.5**.
- **PWA**: installierbar auf dem Smartphone-Homescreen, App-Shell wird per
  Service Worker gecacht. Die Daten selbst (Trades, Bilder) kommen immer
  live vom Server – ein Offline-Datenspeicher ist bewusst nicht eingebaut,
  da es sich um ein Server-gestütztes Journal mit wählbarem Bilderpfad
  handelt.
- **Bilder-Speicherort frei wählbar**: unter *Einstellungen → Speicherort*
  lässt sich ein beliebiger, auf dem Server erreichbarer Ordner (z. B. eine
  angeschlossene Festplatte oder ein Nextcloud-Datenordner) als aktiver
  Speicherort für neue Setup-Bilder setzen. Der Server erkennt angeschlossene
  Laufwerke automatisch als Vorschlag.

## Lokal starten (zum Testen)

```bash
npm start
# oder mit Autoreload während der Entwicklung:
npm run dev
```

Standardmäßig läuft die App nur lokal unter <http://localhost:3000>, ohne
Login (siehe Hinweis unten). Daten landen in `./data/` (SQLite-Datei +
Standard-Bilderordner), das ist in `.gitignore` ausgeschlossen.

Umgebungsvariablen (optional):

| Variable            | Zweck                                                    | Default        |
|---------------------|-----------------------------------------------------------|----------------|
| `PORT`               | Port                                                      | `3000`         |
| `HOST`               | Bind-Adresse. `0.0.0.0` für Zugriff aus dem Netz/Tailscale | `127.0.0.1`    |
| `TJ_DATA_DIR`        | Ordner für DB + Standard-Bilder                           | `./data`       |
| `TJ_ALLOWED_HOSTS`   | Zusätzliche erlaubte Hostnamen, kommagetrennt              | *(leer)*       |

## Tests

```bash
npm test
```

## Betrieb auf dem Raspberry Pi (neben Nextcloud, per Tailscale)

1. Repo auf den Pi klonen (Node ≥ 22.5 muss installiert sein):
   ```bash
   git clone <repo-url> ~/tradingjournal
   cd ~/tradingjournal
   ```
2. Datenordner wählen – entweder lokal auf der SD-Karte/SSD des Pi, oder ein
   extra angeschlossenes Laufwerk, z. B. `/mnt/usb/tradingjournal-data`.
3. `deploy/tradingjournal.service` nach `/etc/systemd/system/` kopieren,
   Pfade/Variablen anpassen, dann:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now tradingjournal
   ```
4. Der Dienst lauscht per `HOST=0.0.0.0` im gesamten (Tailscale-)Netz. Von
   Laptop/Smartphone aus über die Tailscale-IP oder den MagicDNS-Namen des
   Pi aufrufen, z. B. `http://raspberrypi.<dein-tailnet>.ts.net:3000`.
5. Auf dem Smartphone die Seite öffnen und über „Zum Startbildschirm
   hinzufügen“ (iOS) bzw. den Installieren-Button (Android/Chrome) als App
   installieren.
6. Unter *Einstellungen → Bilder-Speicherort* kann anschließend z. B. der
   Nextcloud-Datenordner (oder eine externe Platte) als Speicherort für
   Setup-Bilder gesetzt werden, damit sie z. B. automatisch mitgesichert
   werden.

**Sicherheitshinweis:** Die App hat aktuell **keinen Login**. Das ist für den
Betrieb ausschließlich im eigenen, per Tailscale abgeschotteten Netz gedacht.
Server niemals direkt mit `HOST=0.0.0.0` ins offene Internet/Portforwarding
stellen, ohne vorher eine Authentifizierung (z. B. per Tailscale Serve/Funnel
mit Zugriffsbeschränkung, oder einen Reverse Proxy mit Basic Auth) davorzusetzen.

## Datenmodell

- **Trade**: Datum, Uhrzeit, Symbol, Richtung (Long/Short), Einstieg,
  Ausstieg, Stop-Loss, Take-Profit, Größe, Gebühren, Ergebnis (P&L), Setup,
  Bewertung (1–5 Sterne), Notizen, Nachbetrachtung – plus beliebig viele
  Bilder.
- **Bild**: pro Trade mehrere, Dateiname/Pfad in der DB, tatsächliche Datei
  im gewählten Speicherort unter `JAHR/MONAT/…`.
- **Export**: *Statistik → Alle Trades als JSON exportieren*.

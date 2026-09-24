# Auction collector

Collects Tesla auctions from permitted sources into one SQLite store that TesBids
and TeslaTracker can both read. Sources today: Cars & Bids and Copart.

## How it works

- Drives a normal, visible Chrome, either one you already run (attached over CDP)
  or one it launches with headless off.
- Opens each source's public Tesla search page and reads the JSON the page loads
  for itself. If none arrives, it falls back to reading listing links from the page.
- Sends `From: bot@tesbids.com` and `X-Bot: TesBidsBot/1.0` headers so the source's
  team can recognize the traffic.
- Waits between pages (10 s by default).
- **Stops if a bot challenge doesn't clear on its own.** It records the run as
  `blocked` and moves on. No stealth plugins, fingerprint spoofing, CAPTCHA
  solving or IP rotation. If you see `blocked`, ask your contact to allowlist
  the VM's IP.
- **Skips saving if a run finds far fewer cars than usual** (`suspicious`), so an
  outage never shows up as a market crash.
- Stores facts only (year, model, mileage, bid, end time, result, damage/title
  for Copart) and the link back. No photos or descriptions.

## One-time setup

1. Fill in `collector/permissions.json` for each source: who granted access and
   when. A source with an empty entry is skipped. Set `writtenConfirmation` to
   `true` once you have it by email.
2. On a VM with a fixed IP, start Chrome with a dedicated profile:

   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/tesbids-chrome
   ```

   Keep this port private (bind to localhost, or firewall it). Anyone who can
   reach it controls the browser.

3. `npm install`

## Running

```bash
# First run: save the raw JSON and don't write to the database, to confirm field names
npm run collect -- --source all --cdp http://127.0.0.1:9222 --dump data/raw --dry-run

# Normal run
npm run collect -- --source all --cdp http://127.0.0.1:9222
```

The field names in `sources/*.js` are best guesses. After the first `--dump`,
check `data/raw/*.json`. If a column prints empty in the dry-run table, update
`mapItem` in that source file.

Schedule it every 30–60 minutes with cron or a systemd timer:

```cron
*/30 * * * * cd /srv/teslaapps && npm run collect -- --cdp http://127.0.0.1:9222 >> data/collector.log 2>&1
```

## Data

`data/auctions.db` (SQLite):

- `auctions`: one row per listing per source, unique on `(source, source_id)`, VIN indexed
- `bid_history`: every observed change in bid, bid count or status
- `runs`: each run's outcome (`ok`, `blocked`, `suspicious`, `error`) and count

## Known limits

- Copart shows ~20 lots per search page. This version reads the first page only;
  pagination comes after the first real run shows how the page loads more.
- Copart usually masks VINs in search results, so cross-source matching by VIN
  mostly works for Cars & Bids and future sources.

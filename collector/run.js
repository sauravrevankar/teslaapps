// Collects Tesla auctions from permitted sources into the shared store.
//
//   node collector/run.js --source all --cdp http://127.0.0.1:9222
//   node collector/run.js --source copart --dump data/raw --dry-run
//
// Options:
//   --source      all | carsandbids | copart          (default: all)
//   --cdp         attach to your running Chrome (started with --remote-debugging-port)
//   --chrome      path to a Chrome binary to launch instead (headless off)
//   --db          SQLite file                         (default: data/auctions.db)
//   --dump        folder to save raw captured JSON, for checking field names
//   --dry-run     parse and print, but don't write to the database
//   --pause       milliseconds to wait between pages  (default: 10000)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AuctionStore, looksLikeOutage } from './db.js';
import { BlockedError, capture, openBrowser, politePause } from './browser.js';
import { validRecord } from './normalize.js';
import * as carsandbids from './sources/carsandbids.js';
import * as copart from './sources/copart.js';

export const SOURCES = { carsandbids, copart };
const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadPermissions(file = path.join(HERE, 'permissions.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function permitted(permissions, sourceId) {
  const p = permissions[sourceId];
  return Boolean(p && p.grantedBy && p.grantedOn);
}

// Runs one source end to end. Returns a summary; never throws for a block.
export async function collect(source, { context, store, dump, dryRun = false, pauseMs = 10000, captureOptions = {} }) {
  const runId = store.startRun(source.id);
  const records = [];
  try {
    for (const [i, url] of source.pages.entries()) {
      if (i > 0) await politePause(pauseMs);
      const { page, responses } = await capture(context, url, { source: source.id, match: source.match, ...captureOptions });
      if (dump) {
        fs.mkdirSync(dump, { recursive: true });
        const file = path.join(dump, `${source.id}-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify(responses, null, 2));
      }
      let found = source.parse(responses);
      if (!found.length) found = await source.fromDom(page);
      await page.close();
      records.push(...found.filter(validRecord));
    }
  } catch (err) {
    const outcome = err instanceof BlockedError ? 'blocked' : 'error';
    store.finishRun(runId, { outcome, found: records.length, detail: err.message });
    return { source: source.id, outcome, found: records.length, detail: err.message, records };
  }

  if (looksLikeOutage(records.length, store.recentCounts(source.id))) {
    const detail = `found ${records.length}, far below recent runs; not saving`;
    store.finishRun(runId, { outcome: 'suspicious', found: records.length, detail });
    return { source: source.id, outcome: 'suspicious', found: records.length, detail, records };
  }

  let created = 0;
  let changed = 0;
  if (!dryRun) {
    const now = new Date().toISOString();
    for (const r of records) {
      const res = store.upsert(r, now);
      if (res.created) created += 1;
      else if (res.changed) changed += 1;
    }
  }
  store.finishRun(runId, { outcome: 'ok', found: records.length, detail: `${created} new, ${changed} updated` });
  return { source: source.id, outcome: 'ok', found: records.length, created, changed, records };
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: 'all' },
      cdp: { type: 'string' },
      chrome: { type: 'string' },
      db: { type: 'string', default: 'data/auctions.db' },
      dump: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      pause: { type: 'string', default: '10000' },
    },
  });

  const permissions = loadPermissions();
  const wanted = values.source === 'all' ? Object.keys(SOURCES) : [values.source];
  const unknown = wanted.filter((s) => !SOURCES[s]);
  if (unknown.length) throw new Error(`Unknown source: ${unknown.join(', ')}`);
  const allowed = wanted.filter((s) => permitted(permissions, s));
  for (const s of wanted.filter((x) => !allowed.includes(x))) {
    console.warn(`Skipping ${s}: add grantedBy and grantedOn to collector/permissions.json first.`);
  }
  if (!allowed.length) return;

  fs.mkdirSync(path.dirname(values.db), { recursive: true });
  const store = new AuctionStore(values.db);
  const browser = await openBrowser({ cdpUrl: values.cdp, executablePath: values.chrome });
  try {
    for (const [i, s] of allowed.entries()) {
      if (i > 0) await politePause(Number(values.pause));
      const result = await collect(SOURCES[s], {
        context: browser.context, store, dump: values.dump, dryRun: values['dry-run'], pauseMs: Number(values.pause),
      });
      const extra = result.outcome === 'ok' ? `${result.created ?? 0} new, ${result.changed ?? 0} updated` : result.detail;
      console.log(`${SOURCES[s].label}: ${result.outcome}, ${result.found} Tesla listings (${extra})`);
      if (values['dry-run']) console.table(result.records.slice(0, 10).map((r) =>
        ({ id: r.sourceId, title: r.title, miles: r.miles, bid: r.currentBid, ends: r.endsAt })));
    }
  } finally {
    await browser.close();
    store.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { AuctionStore, looksLikeOutage } from '../collector/db.js';
import { openBrowser } from '../collector/browser.js';
import { collect, permitted } from '../collector/run.js';
import { cleanVin, teslaModel, toIso, toNumber, validRecord } from '../collector/normalize.js';
import * as carsandbids from '../collector/sources/carsandbids.js';
import * as copart from '../collector/sources/copart.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('normalize helpers', () => {
  assert.equal(toNumber('$72,500'), 72500);
  assert.equal(toNumber('n/a'), null);
  assert.equal(toIso(1790500000), toIso(1790500000000));
  assert.equal(cleanVin('5YJ3E1EA7PF******'), null);
  assert.equal(cleanVin('7saygdef5mf123456'), '7SAYGDEF5MF123456');
  assert.equal(teslaModel('2021 TESLA MODEL Y'), 'Model Y');
  assert.equal(teslaModel('2019 Porsche Taycan'), null);
});

test('Cars & Bids mapping keeps Teslas and reads results', () => {
  const records = carsandbids.parse([{ body: fixture('carsandbids-search.json') }]).filter(validRecord);
  assert.equal(records.length, 2);
  const [truck, sig] = records;
  assert.equal(truck.url, 'https://carsandbids.com/auctions/K1NJ48pj');
  assert.equal(truck.model, 'Cybertruck');
  assert.equal(truck.miles, 6200);
  assert.equal(truck.reserve, 'reserve');
  assert.equal(sig.status, 'sold');
  assert.equal(sig.soldPrice, 43500);
  assert.equal(sig.reserve, 'no_reserve');
});

test('Copart mapping keeps damage and title, drops masked VINs', () => {
  const records = copart.parse([{ body: fixture('copart-search.json') }]).filter(validRecord);
  assert.equal(records.length, 2);
  assert.equal(records[0].url, 'https://www.copart.com/lot/71554684');
  assert.equal(records[0].vin, null);
  assert.equal(records[0].damage, 'FRONT END');
  assert.equal(records[1].vin, '7SAYGDEF5MF123456');
  assert.equal(records[1].model, 'Model Y');
  assert.equal(records[1].currentBid, 17250);
});

test('store upserts, keeps known values and records bid history', () => {
  const store = new AuctionStore();
  const base = copart.mapItem(fixture('copart-search.json').data.results.content[1]);
  assert.equal(store.upsert(base, '2026-09-24T10:00:00Z').created, true);
  const same = store.upsert(base, '2026-09-24T11:00:00Z');
  assert.equal(same.changed, false);
  const raised = store.upsert({ ...base, currentBid: 18000, vin: null }, '2026-09-24T12:00:00Z');
  assert.equal(raised.changed, true);
  const row = store.get('copart', base.sourceId);
  assert.equal(row.current_bid, 18000);
  assert.equal(row.vin, '7SAYGDEF5MF123456', 'a missing VIN must not erase the known one');
  assert.deepEqual(store.history(row.id).map((h) => h.current_bid), [17250, 18000]);
  assert.equal(store.byVin('7SAYGDEF5MF123456').length, 1);
  store.close();
});

test('outage check flags sharp drops only after enough history', () => {
  assert.equal(looksLikeOutage(3, [40, 42]), false);
  assert.equal(looksLikeOutage(3, [40, 42, 38, 41]), true);
  assert.equal(looksLikeOutage(35, [40, 42, 38, 41]), false);
});

test('sources need recorded permission', () => {
  assert.equal(permitted({ copart: { grantedBy: '', grantedOn: '' } }, 'copart'), false);
  assert.equal(permitted({ copart: { grantedBy: 'Jane (cofounder)', grantedOn: '2026-09-24' } }, 'copart'), true);
});

// Browser tests against a local stand-in for the real sites.
let server;
let base;
let browser;

before(async () => {
  const search = JSON.stringify(fixture('carsandbids-search.json'));
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/v2/autos/auctions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(search);
    }
    if (req.url === '/search/tesla') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<title>Search</title><script>fetch("/v2/autos/auctions?q=tesla")</script>');
    }
    if (req.url === '/challenge') {
      res.writeHead(403, { 'content-type': 'text/html' });
      return res.end('<title>Just a moment...</title><p>Checking your browser</p>');
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  browser = await openBrowser({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.close();
});

const localSource = (pages) => ({ ...carsandbids, pages, match: (u) => u.includes('/v2/autos/auctions') });

test('collect captures the page JSON and saves Tesla listings', async () => {
  const store = new AuctionStore();
  const result = await collect(localSource([`${base}/search/tesla`]), {
    context: browser.context, store, captureOptions: { settleMs: 3000 },
  });
  assert.equal(result.outcome, 'ok');
  assert.equal(result.found, 2);
  assert.equal(result.created, 2);
  assert.equal(store.get('carsandbids', 'K1NJ48pj').current_bid, 72000);
  store.close();
});

test('collect stops on a challenge it cannot pass instead of retrying', async () => {
  const store = new AuctionStore();
  const result = await collect(localSource([`${base}/challenge`]), {
    context: browser.context, store, captureOptions: { challengeWaitMs: 2000 },
  });
  assert.equal(result.outcome, 'blocked');
  assert.match(result.detail, /cloudflare challenge/);
  store.close();
});

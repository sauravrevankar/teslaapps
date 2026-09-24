// Shared auction store. One row per (source, source listing); bid_history keeps
// every change we observe so TesBids and TeslaTracker can chart it.

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  vin TEXT,
  year INTEGER,
  model TEXT,
  trim TEXT,
  miles INTEGER,
  location TEXT,
  current_bid REAL,
  bid_count INTEGER,
  ends_at TEXT,
  status TEXT,
  sold_price REAL,
  reserve TEXT,
  damage TEXT,
  title_type TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS auctions_vin ON auctions (vin);
CREATE TABLE IF NOT EXISTS bid_history (
  auction_id INTEGER NOT NULL REFERENCES auctions (id),
  seen_at TEXT NOT NULL,
  current_bid REAL,
  bid_count INTEGER,
  status TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT,
  found INTEGER,
  detail TEXT
);
`;

const FIELDS = [
  ['url', 'url'], ['title', 'title'], ['vin', 'vin'], ['year', 'year'], ['model', 'model'],
  ['trim', 'trim'], ['miles', 'miles'], ['location', 'location'], ['current_bid', 'currentBid'],
  ['bid_count', 'bidCount'], ['ends_at', 'endsAt'], ['status', 'status'], ['sold_price', 'soldPrice'],
  ['reserve', 'reserve'], ['damage', 'damage'], ['title_type', 'titleType'],
];

export class AuctionStore {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    const cols = FIELDS.map(([c]) => c);
    // A missing value in a later capture never erases one we already know.
    this.upsertStmt = this.db.prepare(`
      INSERT INTO auctions (source, source_id, ${cols.join(', ')}, first_seen, last_seen)
      VALUES (:source, :source_id, ${cols.map((c) => ':' + c).join(', ')}, :now, :now)
      ON CONFLICT (source, source_id) DO UPDATE SET
        ${cols.map((c) => `${c} = COALESCE(excluded.${c}, auctions.${c})`).join(',\n        ')},
        last_seen = excluded.last_seen
      RETURNING id`);
    this.getStmt = this.db.prepare('SELECT * FROM auctions WHERE source = ? AND source_id = ?');
    this.historyStmt = this.db.prepare(
      'INSERT INTO bid_history (auction_id, seen_at, current_bid, bid_count, status) VALUES (?, ?, ?, ?, ?)');
  }

  // Returns { id, created, changed }.
  upsert(record, now = new Date().toISOString()) {
    const before = this.getStmt.get(record.source, record.sourceId);
    const params = { source: record.source, source_id: record.sourceId, now };
    for (const [col, key] of FIELDS) params[col] = record[key] ?? null;
    const { id } = this.upsertStmt.get(params);
    const after = this.getStmt.get(record.source, record.sourceId);
    const changed = !before
      || before.current_bid !== after.current_bid
      || before.bid_count !== after.bid_count
      || before.status !== after.status;
    if (changed) this.historyStmt.run(id, now, after.current_bid, after.bid_count, after.status);
    return { id, created: !before, changed };
  }

  get(source, sourceId) {
    return this.getStmt.get(source, sourceId);
  }

  history(auctionId) {
    return this.db.prepare('SELECT * FROM bid_history WHERE auction_id = ? ORDER BY seen_at').all(auctionId);
  }

  // The same car listed on several sites, matched by VIN.
  byVin(vin) {
    return this.db.prepare('SELECT * FROM auctions WHERE vin = ? ORDER BY last_seen DESC').all(vin);
  }

  startRun(source, now = new Date().toISOString()) {
    return this.db.prepare('INSERT INTO runs (source, started_at) VALUES (?, ?) RETURNING id').get(source, now).id;
  }

  finishRun(runId, { outcome, found = null, detail = null }, now = new Date().toISOString()) {
    this.db.prepare('UPDATE runs SET finished_at = ?, outcome = ?, found = ?, detail = ? WHERE id = ?')
      .run(now, outcome, found, detail, runId);
  }

  recentCounts(source, limit = 5) {
    return this.db.prepare(
      "SELECT found FROM runs WHERE source = ? AND outcome = 'ok' ORDER BY id DESC LIMIT ?")
      .all(source, limit).map((r) => r.found);
  }

  close() {
    this.db.close();
  }
}

// A sharp drop usually means a block or a page change, not a market event.
// (A blocked tracker once showed Tesla inventory "collapsing" for days.)
export function looksLikeOutage(found, recentCounts, { minRuns = 3, ratio = 0.4 } = {}) {
  if (recentCounts.length < minRuns) return false;
  const sorted = [...recentCounts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median > 0 && found < median * ratio;
}

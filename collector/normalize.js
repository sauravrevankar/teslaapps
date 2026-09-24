// Helpers that turn loosely typed source data into the shared auction record.
//
// Auction record (what every source adapter returns):
// {
//   source, sourceId, url, title, vin, year, model, trim, miles, location,
//   currentBid, bidCount, endsAt, status, soldPrice, reserve, damage, titleType
// }
// status: 'live' | 'sold' | 'not_sold' | 'ended'
// reserve: 'no_reserve' | 'reserve' | null

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const TESLA_MODELS = [
  ['Cybertruck', /cybertruck/i],
  ['Model S', /model\s*s\b/i],
  ['Model 3', /model\s*3\b/i],
  ['Model X', /model\s*x\b/i],
  ['Model Y', /model\s*y\b/i],
  ['Roadster', /roadster/i],
  ['Semi', /\bsemi\b/i],
];

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && String(value).match(/\d/) ? n : null;
}

// Accepts ISO strings, epoch seconds or epoch milliseconds.
export function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Masked VINs (Copart shows e.g. 5YJ3E1EA*******) are not usable for matching.
export function cleanVin(value) {
  if (!value) return null;
  const vin = String(value).trim().toUpperCase();
  return VIN_RE.test(vin) ? vin : null;
}

export function teslaModel(text) {
  const found = TESLA_MODELS.find(([, re]) => re.test(String(text || '')));
  return found ? found[0] : null;
}

export function parseYear(text) {
  const m = String(text || '').match(/\b(20[0-3]\d|19\d\d)\b/);
  return m ? Number(m[1]) : null;
}

export function isTesla(record) {
  return /tesla/i.test(`${record.make || ''} ${record.title || ''}`) || record.model !== null;
}

// Drops anything that can't be stored or linked back to the source.
export function validRecord(record) {
  return Boolean(record && record.source && record.sourceId && record.url && isTesla(record));
}

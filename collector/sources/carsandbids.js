// Cars & Bids: live Tesla auctions from the public search page.
//
// The search page loads its results as JSON from /v2/autos/auctions. We read
// those responses as the page receives them. Field names below are best
// guesses from public examples; run once with --dump and adjust mapItem if a
// field comes back empty.

import { cleanVin, parseYear, teslaModel, toIso, toNumber } from '../normalize.js';

export const id = 'carsandbids';
export const label = 'Cars & Bids';
export const pages = ['https://carsandbids.com/search/tesla'];
export const match = (url) => /carsandbids\.com\/v2\/autos\/auctions/.test(url);

function listFrom(body) {
  if (Array.isArray(body)) return body;
  return body?.auctions ?? body?.results ?? body?.data ?? [];
}

function statusOf(a) {
  const s = String(a.status ?? a.state ?? '').toLowerCase();
  if (/sold/.test(s) && !/not/.test(s)) return 'sold';
  if (/reserve not met|not sold|no sale/.test(s)) return 'not_sold';
  if (/ended|closed|complete/.test(s)) return 'ended';
  return 'live';
}

export function mapItem(a) {
  const auctionId = a.id ?? a.auction_id ?? a.auctionId;
  const title = a.title ?? [a.year, a.make, a.model].filter(Boolean).join(' ');
  const status = statusOf(a);
  const currentBid = toNumber(a.current_bid ?? a.currentBid ?? a.high_bid ?? a.bid);
  return {
    source: id,
    sourceId: auctionId != null ? String(auctionId) : null,
    url: a.url ? new URL(a.url, 'https://carsandbids.com').href
      : auctionId != null ? `https://carsandbids.com/auctions/${auctionId}` : null,
    title,
    make: a.make ?? 'Tesla',
    vin: cleanVin(a.vin),
    year: toNumber(a.year) ?? parseYear(title),
    model: teslaModel(`${a.model ?? ''} ${title}`),
    trim: a.sub_title ?? a.subtitle ?? null,
    miles: toNumber(a.mileage ?? a.miles),
    location: a.location ?? null,
    currentBid,
    bidCount: toNumber(a.bid_count ?? a.bidCount ?? a.bids),
    endsAt: toIso(a.auction_end ?? a.end_date ?? a.ends_at ?? a.endsAt),
    status,
    soldPrice: status === 'sold' ? toNumber(a.sale_price ?? a.sold_price) ?? currentBid : null,
    reserve: a.no_reserve === true ? 'no_reserve' : a.no_reserve === false ? 'reserve' : null,
    damage: null,
    titleType: a.title_status ?? null,
  };
}

export function parse(responses) {
  return responses.flatMap((r) => listFrom(r.body)).map(mapItem);
}

// Fallback when no JSON was seen: auction links on the page give at least the
// id, title and link.
export async function fromDom(page) {
  const links = await page.$$eval('a[href*="/auctions/"]', (as) =>
    as.map((a) => ({ href: a.href, text: (a.getAttribute('title') || a.textContent || '').trim() })));
  const seen = new Set();
  return links.flatMap(({ href, text }) => {
    const m = href.match(/\/auctions\/([A-Za-z0-9]+)/);
    if (!m || seen.has(m[1]) || !text) return [];
    seen.add(m[1]);
    return [mapItem({ id: m[1], url: href, title: text })];
  });
}

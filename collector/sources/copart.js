// Copart: Tesla lots from the public make search.
//
// The search page loads results from /public/lots/search-results. Copart uses
// short field codes (ln = lot number, lcy = year, orr = odometer, hb = high
// bid, ad = auction date, yn = yard). These are best guesses; confirm on the
// first run with --dump and adjust mapItem if a field comes back empty.
//
// Copart lots are mostly salvage or damaged cars, so damage and title type
// are kept to label them clearly on TesBids.

import { cleanVin, parseYear, teslaModel, toIso, toNumber } from '../normalize.js';

export const id = 'copart';
export const label = 'Copart';
export const pages = ['https://www.copart.com/vehicle-search-make/TESLA'];
export const match = (url) => /copart\.com\/public\/lots\/(search-results|vehicle-finder-search-results)/.test(url);

function listFrom(body) {
  return body?.data?.results?.content ?? body?.results?.content ?? body?.content ?? [];
}

export function mapItem(l) {
  const lot = l.ln ?? l.lotNumberStr ?? l.lotNumber;
  const title = l.ld ?? [l.lcy, l.mkn, l.lm].filter(Boolean).join(' ');
  return {
    source: id,
    sourceId: lot != null ? String(lot) : null,
    url: lot != null ? `https://www.copart.com/lot/${lot}` : null,
    title,
    make: l.mkn ?? 'Tesla',
    vin: cleanVin(l.fv), // usually masked on public search, so often null
    year: toNumber(l.lcy) ?? parseYear(title),
    model: teslaModel(`${l.lm ?? ''} ${title}`),
    trim: l.ltd ?? null,
    miles: toNumber(l.orr),
    location: l.yn ?? l.syn ?? null,
    currentBid: toNumber(l.hb ?? l.dynamicLotDetails?.currentBid),
    bidCount: null,
    endsAt: toIso(l.ad),
    status: 'live',
    soldPrice: null,
    reserve: null,
    damage: l.dd ?? null,
    titleType: l.td ?? l.tgd ?? null,
  };
}

export function parse(responses) {
  return responses.flatMap((r) => listFrom(r.body)).map(mapItem);
}

export async function fromDom(page) {
  const links = await page.$$eval('a[href*="/lot/"]', (as) =>
    as.map((a) => ({ href: a.href, text: (a.textContent || '').trim() })));
  const seen = new Set();
  return links.flatMap(({ href, text }) => {
    const m = href.match(/\/lot\/(\d+)/);
    if (!m || seen.has(m[1])) return [];
    seen.add(m[1]);
    return [mapItem({ ln: m[1], ld: text || undefined, mkn: 'Tesla' })];
  });
}

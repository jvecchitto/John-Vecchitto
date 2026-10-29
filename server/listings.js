// Imports an MLS export (CSV) and matches each listing to a parcel.
// IDX feeds usually carry active listings only, so expired/withdrawn land
// listings come from an MLS search exported to CSV by the realtor.

import { parse } from 'csv-parse/sync';
import { splitAddress, normalizeTown } from './address.js';

const COLUMN_CANDIDATES = {
  address: ['address', 'streetaddress', 'fulladdress', 'propertyaddress', 'unparsedaddress', 'addressline'],
  streetNumber: ['streetnumber', 'streetno', 'stno'],
  streetName: ['streetname', 'street'],
  town: ['city', 'town', 'municipality'],
  zip: ['zip', 'zipcode', 'postalcode'],
  status: ['status', 'standardstatus', 'mlsstatus', 'listingstatus'],
  listPrice: ['listprice', 'currentprice', 'price', 'askingprice'],
  originalPrice: ['originallistprice', 'originalprice', 'origlistprice'],
  dom: ['dom', 'daysonmarket', 'cdom', 'cumulativedaysonmarket'],
  agent: ['listagent', 'listagentfullname', 'listingagent', 'agent', 'listagentname'],
  agentPhone: ['listagentphone', 'agentphone', 'listagentdirectphone', 'listagentpreferredphone'],
  office: ['listoffice', 'listofficename', 'office', 'brokerage'],
  mls: ['mls', 'mlsnumber', 'listingid', 'mlsid', 'listnumber'],
  offMarketDate: ['expirationdate', 'expiredate', 'offmarketdate', 'withdrawndate', 'statuschangedate', 'statuschangetimestamp'],
  listDate: ['listdate', 'listingcontractdate', 'onmarketdate'],
  acres: ['acres', 'lotacres', 'lotsizeacres', 'acreage'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const toDate = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
};

export function parseListingsCsv(text) {
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  if (!rows.length) return { listings: [], columns: {} };
  const headers = Object.keys(rows[0]);
  const columns = {};
  for (const [logical, cands] of Object.entries(COLUMN_CANDIDATES)) {
    const hit = cands.map((c) => headers.find((h) => norm(h) === c)).find(Boolean);
    if (hit) columns[logical] = hit;
  }
  if (!columns.address && !columns.streetName) throw new Error('Could not find an address column in the CSV.');
  if (!columns.town) throw new Error('Could not find a city/town column in the CSV.');

  const listings = rows.map((r) => {
    const col = (k) => (columns[k] ? r[columns[k]] : '');
    const address = col('address') || `${col('streetNumber')} ${col('streetName')}`.trim();
    return {
      address,
      town: col('town'),
      zip: String(col('zip') || '').slice(0, 5),
      status: col('status'),
      listPrice: toNum(col('listPrice')),
      originalPrice: toNum(col('originalPrice')),
      dom: toNum(col('dom')),
      agent: col('agent'),
      agentPhone: col('agentPhone'),
      office: col('office'),
      mls: col('mls'),
      offMarketDate: toDate(col('offMarketDate')),
      listDate: toDate(col('listDate')),
      acres: toNum(col('acres')),
    };
  }).filter((l) => l.address && l.town);
  return { listings, columns };
}

// Returns Map(parcelId -> { listing, confidence }).
export function matchListings(parcels, listings) {
  const byExact = new Map();
  const byStreet = new Map();
  for (const p of parcels) {
    const { number, street } = splitAddress(p.location);
    const town = normalizeTown(p.town);
    if (number) byExact.set(`${number} ${street}|${town}`, p);
    const key = `${street}|${town}`;
    if (!byStreet.has(key)) byStreet.set(key, []);
    byStreet.get(key).push(p);
  }

  const matches = new Map();
  for (const l of listings) {
    const { number, street } = splitAddress(l.address);
    const town = normalizeTown(l.town);
    let parcel = number ? byExact.get(`${number} ${street}|${town}`) : null;
    let confidence = 'exact address';
    if (!parcel) {
      const candidates = byStreet.get(`${street}|${town}`) || [];
      if (candidates.length === 1) {
        parcel = candidates[0];
        confidence = 'same street, only vacant parcel';
      } else if (candidates.length > 1 && l.acres) {
        const best = candidates
          .map((p) => ({ p, diff: Math.abs(p.acres - l.acres) / l.acres }))
          .sort((a, b) => a.diff - b.diff)[0];
        if (best.diff <= 0.15) {
          parcel = best.p;
          confidence = 'same street, acreage match';
        }
      }
    }
    if (!parcel) continue;
    const prev = matches.get(parcel.id);
    // Keep the most recent listing per parcel.
    const date = (x) => x.offMarketDate || x.listDate || '';
    if (!prev || date(l) > date(prev.listing)) matches.set(parcel.id, { listing: l, confidence });
  }
  return matches;
}

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CtParcelClient, DEFAULT_LAYER_URL } from './ctParcels.js';
import { floodZoneAt } from './flood.js';
import { parseListingsCsv, matchListings } from './listings.js';
import { scoreLead } from './score.js';
import { ENTITLEMENT_OPTIONS } from './landType.js';
import { JsonStore } from './store.js';
import { demoFetch, DEMO_LISTINGS_CSV } from './demo.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const LEAD_STATUSES = ['New', 'Researching', 'Contacted', 'Follow up', 'Not interested', 'Listed', 'Do not contact'];
const LEAD_FIELDS = ['status', 'entitlement', 'phone', 'email', 'notes'];

export function createApp({
  demo = false,
  dataDir = path.join(root, 'data'),
  layerUrl = DEFAULT_LAYER_URL,
  password = '',
  fetchImpl = demo ? demoFetch : globalThis.fetch,
} = {}) {
  const parcels = new CtParcelClient({ layerUrl, fetchImpl });
  const leads = new JsonStore(path.join(dataDir, demo ? 'demo-leads.json' : 'leads.json'), { leads: {} });
  const listings = new JsonStore(path.join(dataDir, demo ? 'demo-listings.json' : 'listings.json'), { listings: [], importedAt: null });
  const cache = new Map(); // search key -> { at, parcels }
  const CACHE_MS = 6 * 3600 * 1000;

  if (demo) {
    listings.load().then((s) => {
      if (!s.listings.length) {
        s.listings = parseListingsCsv(DEMO_LISTINGS_CSV).listings;
        s.importedAt = new Date().toISOString();
      }
    });
  }

  async function searchParcels({ zip, town }) {
    const key = `${zip || ''}|${(town || '').toUpperCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.parcels;
    const found = await parcels.findLand({ zip, town });
    cache.set(key, { at: Date.now(), parcels: found });
    return found;
  }

  async function buildResults(query) {
    const found = await searchParcels(query);
    const { listings: all } = await listings.load();
    const { leads: saved } = await leads.load();
    const matches = matchListings(found, all);
    return found.map((p) => {
      const m = matches.get(p.id);
      const { score, reasons, listingKind } = scoreLead(p, m?.listing);
      return { ...p, listing: m?.listing || null, matchConfidence: m?.confidence || null, listingKind, score, reasons, lead: saved[p.id] || null };
    }).sort((a, b) => b.score - a.score);
  }

  const app = express();

  if (password) {
    app.use((req, res, next) => {
      const [, encoded] = (req.headers.authorization || '').split(' ');
      const decoded = Buffer.from(encoded || '', 'base64').toString();
      if (decoded.slice(decoded.indexOf(':') + 1) === password) return next();
      res.set('WWW-Authenticate', 'Basic realm="CT Land Leads"').status(401).send('Password required');
    });
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(root, 'public')));
  app.use('/vendor/leaflet', express.static(path.join(root, 'node_modules', 'leaflet', 'dist')));

  const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(err.status || 502).json({ error: err.message });
  });

  const readQuery = (req) => {
    const zip = String(req.query.zip || '').trim();
    const town = String(req.query.town || '').trim();
    if (zip && !/^06\d{3}$/.test(zip)) throw Object.assign(new Error('Enter a 5-digit Connecticut zip code (06xxx).'), { status: 400 });
    if (!zip && !town) throw Object.assign(new Error('Enter a zip code or a town.'), { status: 400 });
    return { zip, town };
  };

  app.get('/api/config', wrap(async (req, res) => {
    const { listings: all, importedAt } = await listings.load();
    res.json({ demo, entitlementOptions: ENTITLEMENT_OPTIONS, leadStatuses: LEAD_STATUSES, listingCount: all.length, listingsImportedAt: importedAt });
  }));

  app.get('/api/search', wrap(async (req, res) => {
    res.json({ results: await buildResults(readQuery(req)) });
  }));

  app.get('/api/flood', wrap(async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat and lon required' });
    res.json(await floodZoneAt({ lat, lon }, fetchImpl));
  }));

  app.post('/api/listings', express.text({ type: '*/*', limit: '25mb' }), wrap(async (req, res) => {
    let parsed;
    try {
      parsed = parseListingsCsv(req.body || '');
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const store = await listings.load();
    // Replace listings with the same MLS number, keep the rest.
    const incoming = new Set(parsed.listings.map((l) => l.mls).filter(Boolean));
    store.listings = store.listings.filter((l) => !l.mls || !incoming.has(l.mls)).concat(parsed.listings);
    store.importedAt = new Date().toISOString();
    await listings.save();
    res.json({ imported: parsed.listings.length, total: store.listings.length, columns: parsed.columns });
  }));

  app.delete('/api/listings', wrap(async (req, res) => {
    const store = await listings.load();
    store.listings = [];
    store.importedAt = null;
    await listings.save();
    res.json({ ok: true });
  }));

  app.put('/api/leads/:id', wrap(async (req, res) => {
    const store = await leads.load();
    const prev = store.leads[req.params.id] || {};
    const next = { ...prev };
    for (const f of LEAD_FIELDS) if (typeof req.body[f] === 'string') next[f] = req.body[f].slice(0, 5000);
    if (req.body.parcel && typeof req.body.parcel === 'object') {
      const { owner, location, town, acres } = req.body.parcel;
      next.parcel = { owner, location, town, acres };
    }
    next.updatedAt = new Date().toISOString();
    store.leads[req.params.id] = next;
    await leads.save();
    res.json(next);
  }));

  app.get('/api/leads', wrap(async (req, res) => {
    const { leads: saved } = await leads.load();
    res.json({ leads: Object.entries(saved).map(([id, l]) => ({ id, ...l })) });
  }));

  app.get('/api/export.csv', wrap(async (req, res) => {
    const results = await buildResults(readQuery(req));
    const cols = [
      ['Score', (r) => r.score], ['Town', (r) => r.town], ['Location', (r) => r.location], ['Acres', (r) => r.acres],
      ['Land type', (r) => r.landType], ['Zone', (r) => r.zone], ['Owner', (r) => r.owner], ['Co-owner', (r) => r.coOwner],
      ['Mailing address', (r) => r.mailAddress], ['Mailing city', (r) => r.mailCity], ['Mailing state', (r) => r.mailState],
      ['Mailing zip', (r) => r.mailZip], ['Assessed total', (r) => r.assessedTotal], ['Last sale date', (r) => r.saleDate],
      ['Last sale price', (r) => r.salePrice], ['MLS status', (r) => r.listing?.status], ['MLS #', (r) => r.listing?.mls],
      ['List price', (r) => r.listing?.listPrice], ['Listing agent', (r) => r.listing?.agent], ['Listing office', (r) => r.listing?.office],
      ['Lead status', (r) => r.lead?.status], ['Approval status', (r) => r.lead?.entitlement], ['Phone', (r) => r.lead?.phone],
      ['Email', (r) => r.lead?.email], ['Notes', (r) => r.lead?.notes], ['Why', (r) => r.reasons.map((x) => x.why).join('; ')],
    ];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map(([h]) => h).join(','), ...results.map((r) => cols.map(([, f]) => esc(f(r))).join(','))];
    res.type('text/csv').attachment(`land-leads-${req.query.zip || req.query.town}.csv`).send(lines.join('\n'));
  }));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const demo = process.env.DEMO === '1';
  createApp({ demo, password: process.env.APP_PASSWORD || '', layerUrl: process.env.PARCEL_LAYER_URL || DEFAULT_LAYER_URL })
    .listen(port, () => console.log(`CT Land Leads running at http://localhost:${port}${demo ? ' (demo data)' : ''}`));
}

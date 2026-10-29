import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAddress, normalizeStreet } from '../server/address.js';
import { classifyLand } from '../server/landType.js';
import { scoreLead, isAbsentee, listingKind } from '../server/score.js';
import { resolveFields, buildWhere, CtParcelClient } from '../server/ctParcels.js';
import { parseListingsCsv, matchListings } from '../server/listings.js';
import { demoFetch, DEMO_LISTINGS_CSV } from '../server/demo.js';

test('splitAddress handles land-style addresses', () => {
  assert.deepEqual(splitAddress('0 Old Post Road'), { number: '', street: 'OLD POST RD' });
  assert.deepEqual(splitAddress('Lot 3 Forest Lane'), { number: '', street: 'FOREST LN' });
  assert.deepEqual(splitAddress('REAR 12 MAIN ST'), { number: '12', street: 'MAIN ST' });
  assert.deepEqual(splitAddress('45-47 Boston Post Rd.'), { number: '45', street: 'BOSTON POST RD' });
  assert.equal(normalizeStreet('12 North Main Street Unit 4'), '12 N MAIN ST');
});

test('classifyLand', () => {
  assert.equal(classifyLand({ stateUseDesc: 'RES VACANT LAND', assessedBuilding: 0 }), 'Residential buildable lot');
  assert.equal(classifyLand({ stateUseDesc: 'FOREST PA 490', assessedBuilding: 0 }), 'Farm / Forest / Open Space (PA 490)');
  assert.equal(classifyLand({ stateUseDesc: 'RES VAC UNDEVELOPABLE' }), 'Undevelopable');
  assert.equal(classifyLand({ stateUseDesc: 'COM VAC LAND' }), 'Commercial vacant');
  assert.equal(classifyLand({ stateUseDesc: 'SINGLE FAM', assessedBuilding: 300000 }), null);
  assert.equal(classifyLand({ stateUseDesc: 'PARKING LOT', assessedBuilding: 90000 }), null);
  assert.equal(classifyLand({ stateUseDesc: '', assessedBuilding: 0 }), 'Vacant land');
});

test('absentee is based on town, not street', () => {
  assert.equal(isAbsentee({ owner: 'X', town: 'MADISON', mailCity: 'MADISON', mailAddress: '9 SHORE LN', location: '88 GREEN HILL RD' }), false);
  assert.equal(isAbsentee({ owner: 'X', town: 'MADISON', mailCity: 'HAMDEN', mailZip: '06514', propZip: '06443' }), true);
  assert.equal(isAbsentee({ owner: 'CURRENT OWNER', town: 'MADISON', mailCity: 'X' }), false);
});

test('scoreLead rewards expired listings and estates, flags active listings', () => {
  const now = Date.parse('2026-10-01');
  const parcel = { owner: 'ESTATE OF J DOE', town: 'MADISON', mailCity: 'NAPLES', mailState: 'FL', acres: 6, saleDate: '1990-01-01', salePrice: 0 };
  const hot = scoreLead(parcel, { status: 'Expired', offMarketDate: '2026-09-01', listPrice: 100, originalPrice: 120, dom: 200 }, now);
  assert.equal(hot.listingKind, 'expired');
  assert.ok(hot.score >= 90, `expected high score, got ${hot.score}`);
  const active = scoreLead(parcel, { status: 'Active' }, now);
  assert.ok(active.reasons.some((r) => /do not solicit/.test(r.why)));
  assert.ok(active.score < hot.score);
  assert.equal(listingKind('Withdrawn'), 'expired');
  const fresh = scoreLead({ owner: 'A', town: 'MADISON', mailCity: 'MADISON', acres: 1, saleDate: '2026-01-01', salePrice: 90000 }, null, now);
  assert.ok(fresh.score <= 10);
});

test('resolveFields matches by name or alias and builds a zip query', () => {
  const fields = resolveFields([
    { name: 'Property_Zip', alias: 'Property Zip', type: 'esriFieldTypeString' },
    { name: 'Town_Name', alias: 'Town Name', type: 'esriFieldTypeString' },
    { name: 'FLD_17', alias: 'Land Acres', type: 'esriFieldTypeDouble' },
  ]);
  assert.equal(fields.propZip.name, 'Property_Zip');
  assert.equal(fields.acres.name, 'FLD_17');
  assert.equal(buildWhere(fields, { zip: '06443' }), "(Property_Zip = '06443' OR Property_Zip LIKE '06443%')");
  assert.equal(buildWhere(fields, { town: "O'Hara" }), "UPPER(Town_Name) = 'O''HARA'");
});

test('end to end against the demo service: paging, land filter, listing match', async () => {
  const client = new CtParcelClient({ fetchImpl: demoFetch });
  const parcels = await client.findLand({ zip: '06443' });
  assert.equal(parcels.length, 7, 'the single-family house is filtered out');
  assert.ok(parcels.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
  const { listings } = parseListingsCsv(DEMO_LISTINGS_CSV);
  const matches = matchListings(parcels, listings);
  const byLoc = Object.fromEntries(parcels.map((p) => [p.location, matches.get(p.id)]));
  assert.equal(byLoc['0 OLD POST RD'].listing.mls, 'DEMO1001');
  assert.equal(byLoc['88 GREEN HILL RD'].confidence, 'exact address');
  assert.equal(byLoc['LOT 3 FOREST LN'].listing.status, 'Withdrawn');
});

test('parseListingsCsv rejects files without an address column', () => {
  assert.throws(() => parseListingsCsv('Foo,Bar\n1,2\n'), /address/);
});

test('floodZoneAt parses the FEMA response', async () => {
  const { floodZoneAt } = await import('../server/flood.js');
  assert.deepEqual(await floodZoneAt({ lat: 41.28, lon: -72.6 }, demoFetch), { zone: 'AE', subtype: '', inFloodplain: true });
});

test('health check works without the password; everything else needs it', async () => {
  const { createApp } = await import('../server/index.js');
  const { mkdtemp } = await import('node:fs/promises');
  const os = await import('node:os');
  const dataDir = await mkdtemp(`${os.tmpdir()}/leads-`);
  const server = createApp({ demo: true, password: 's3cret:x', dataDir }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/api/config`)).status, 401);
    const auth = { Authorization: `Basic ${Buffer.from('any:s3cret:x').toString('base64')}` };
    assert.equal((await fetch(`${base}/api/config`, { headers: auth })).status, 200);
  } finally {
    server.close();
  }
});
